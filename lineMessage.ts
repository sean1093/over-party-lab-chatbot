/**
 * LINE message objects and the limits the Messaging API enforces on them.
 *
 * These limits are hard: exceeding any of them makes the send fail with
 * `400 Bad Request` and the user receives nothing at all — not even the
 * not-found fallback. Every builder here therefore clamps its input rather
 * than trusting the spreadsheet or what the user typed.
 *
 * Source: Messaging API reference, "Template messages" and "Message objects".
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
  /** Buttons template: at least 1, at most 4 actions. */
  templateActions: 4,
  /** Buttons template `title`. */
  templateTitle: 40,
  /** Buttons template `text` when a title is present (160 without one). */
  templateText: 60,
  /** Action `label`. */
  actionLabel: 20,
  /** `altText` of a template message. */
  altText: 400,
  /** Messages per request. */
  messagesPerRequest: 5,
} as const;

/**
 * Clamps to a character budget, appending an ellipsis when something was cut.
 *
 * Iterates code points so a surrogate pair (an emoji in a cocktail name) is
 * never split into an invalid string.
 */
export function clamp(text: string, limit: number): string {
  const characters = Array.from(text);
  if (characters.length <= limit) return text;
  return `${characters.slice(0, limit - 1).join('')}…`;
}

/** Text messages for the given contents, skipping blanks (LINE rejects `text: ''`). */
export function textMessages(...contents: Array<string | undefined>): Message[] {
  return contents
    .filter((content): content is string => Boolean(content))
    .map((content) => ({ type: 'text', text: content }));
}

/**
 * A buttons template offering one action per recommended name.
 *
 * Returns `null` when there is nothing to offer: a template with zero actions
 * is rejected by LINE, so the caller has to fall back to a text reply.
 */
export function recommendationMessage(names: string[], userMessage: string): Message | null {
  const actions: MessageAction[] = names
    .slice(0, LINE_LIMITS.templateActions)
    .map((name) => ({
      type: 'message',
      label: clamp(name, LINE_LIMITS.actionLabel),
      // `text` is what the user sends back, so it must stay the exact name.
      text: name,
    }));

  if (actions.length === 0) return null;

  const heading = WORDING.recommendation_head + userMessage + WORDING.recommendation_tail;
  return {
    type: 'template',
    altText: clamp(heading, LINE_LIMITS.altText),
    template: {
      type: 'buttons',
      title: clamp(heading, LINE_LIMITS.templateTitle),
      text: clamp(WORDING.see_more, LINE_LIMITS.templateText),
      actions,
    },
  };
}
