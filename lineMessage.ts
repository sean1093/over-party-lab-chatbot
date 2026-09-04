/**
 * LINE message objects and the limits the Messaging API enforces on them.
 *
 * These limits are hard: exceeding any of them makes the send fail with
 * `400 Bad Request` and the user receives nothing at all — not even the
 * not-found fallback. Every builder here therefore clamps its input rather
 * than trusting the spreadsheet or what the user typed.
 *
 * Two counting units are in play, and mixing them up is how an "obviously
 * clamped" payload still gets rejected:
 *
 * - `text` and `altText` are counted in **UTF-16 code units**, so one emoji
 *   costs 2. Clamp those with `clampCodeUnits`.
 * - `title`, template `text`, action `label` and action `text` are counted in
 *   **grapheme clusters**. Clamp those with `clampCharacters`, which counts
 *   code points: always >= the grapheme count, so the result stays under the
 *   limit.
 *
 * Sources: Messaging API reference (Template messages, Message objects) and
 * https://developers.line.biz/en/docs/messaging-api/text-character-count/
 */
import WORDING from './wording';

export interface MessageAction {
  type: 'message';
  label: string;
  text: string;
}

export interface ButtonsTemplate {
  type: 'buttons';
  title: string;
  text: string;
  actions: MessageAction[];
}

export interface TextMessage {
  type: 'text';
  text: string;
}

export interface TemplateMessage {
  type: 'template';
  altText: string;
  template: ButtonsTemplate;
}

export type Message = TextMessage | TemplateMessage;

export const LINE_LIMITS = {
  /** Message objects per request: at least 1, at most 5. */
  messagesPerRequest: 5,
  /** Text message `text`, in UTF-16 code units. */
  textMessage: 5000,
  /** `altText` of a template message, in UTF-16 code units. */
  altText: 400,
  /** Buttons template: at least 1, at most 4 actions. */
  templateActions: 4,
  /** Buttons template `title`, in grapheme clusters. */
  templateTitle: 40,
  /** Buttons template `text` when a title is present (160 without one). */
  templateText: 60,
  /** Action `label`, in grapheme clusters. */
  actionLabel: 20,
  /** Action `text`, in grapheme clusters. */
  actionText: 300,
} as const;

const ELLIPSIS = '…';

/**
 * Clamps a grapheme-counted field.
 *
 * Counts code points, which is never fewer than the grapheme count, so the
 * result is always within the limit. A surrogate pair is never split.
 */
export function clampCharacters(text: string, limit: number): string {
  const characters = Array.from(text);
  if (characters.length <= limit) return text;
  return characters.slice(0, limit - 1).join('') + ELLIPSIS;
}

/**
 * Clamps a UTF-16-counted field.
 *
 * `String#length` is the unit LINE counts here, so this is the only correct
 * measure for `text` and `altText`: a code-point clamp under-counts astral
 * characters two to one and lets an over-long payload through.
 */
export function clampCodeUnits(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let end = limit - ELLIPSIS.length;
  const lastUnit = text.charCodeAt(end - 1);
  // Do not leave a high surrogate stranded without its pair.
  if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) {
    end -= 1;
  }
  return text.slice(0, end) + ELLIPSIS;
}

/**
 * Text messages for the given contents.
 *
 * Blanks are skipped (LINE rejects `text: ''`) and each message is clamped:
 * a long `detail` cell would otherwise fail the whole request, taking the
 * link and the echo down with it.
 */
export function textMessages(...contents: Array<string | undefined>): Message[] {
  return contents
    .filter((content): content is string => Boolean(content))
    .map((content) => ({
      type: 'text',
      text: clampCodeUnits(content, LINE_LIMITS.textMessage),
    }));
}

/**
 * A buttons template offering one action per recommended name.
 *
 * Returns `null` when there is nothing offerable: a template with zero actions
 * is rejected by LINE, so the caller has to fall back to a text reply.
 */
export function recommendationMessage(names: string[], userMessage: string): Message | null {
  const actions: MessageAction[] = names
    // A blank label is rejected, and a name longer than the action limit cannot
    // be offered at all: `text` is what the button sends back, so truncating it
    // would produce a button whose tap can never match a row.
    .filter((name) => name.trim() !== '' && Array.from(name).length <= LINE_LIMITS.actionText)
    .slice(0, LINE_LIMITS.templateActions)
    .map((name) => ({
      type: 'message',
      label: clampCharacters(name, LINE_LIMITS.actionLabel),
      text: name,
    }));

  if (actions.length === 0) return null;

  const heading = WORDING.recommendation_head + userMessage + WORDING.recommendation_tail;
  return {
    type: 'template',
    altText: clampCodeUnits(heading, LINE_LIMITS.altText),
    template: {
      type: 'buttons',
      title: clampCharacters(heading, LINE_LIMITS.templateTitle),
      text: clampCharacters(WORDING.see_more, LINE_LIMITS.templateText),
      actions,
    },
  };
}
