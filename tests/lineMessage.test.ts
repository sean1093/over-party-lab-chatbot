import { describe, expect, it } from 'vitest';
import {
  LINE_LIMITS,
  clampCharacters,
  clampCodeUnits,
  recommendationMessage,
  textMessages,
} from '../lineMessage';

describe('clampCharacters (grapheme-counted fields)', () => {
  it('leaves text within the budget untouched', () => {
    expect(clampCharacters('short', 10)).toBe('short');
    expect(clampCharacters('exactly-10', 10)).toBe('exactly-10');
  });

  it('marks truncation with an ellipsis and never exceeds the budget', () => {
    const clamped = clampCharacters('0123456789abcdef', 10);
    expect(clamped).toBe('012345678…');
    expect(Array.from(clamped)).toHaveLength(10);
  });

  it('never splits a surrogate pair', () => {
    const clamped = clampCharacters('🍸🍸🍸🍸', 3);
    expect(clamped).toBe('🍸🍸…');
    expect(clamped).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe('clampCodeUnits (UTF-16-counted fields)', () => {
  it('measures in UTF-16 units, not code points', () => {
    // 300 emoji are 300 code points but 600 UTF-16 units; a code-point clamp
    // would consider this within a 400 budget and LINE would reject it.
    const clamped = clampCodeUnits('🍸'.repeat(300), 400);
    expect(clamped.length).toBeLessThanOrEqual(400);
  });

  it('leaves text within the budget untouched', () => {
    expect(clampCodeUnits('abc', 10)).toBe('abc');
  });

  it('never leaves a stranded high surrogate', () => {
    const clamped = clampCodeUnits('🍸'.repeat(10), 7);
    expect(clamped.length).toBeLessThanOrEqual(7);
    expect(clamped).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(clamped.endsWith('…')).toBe(true);
  });
});

describe('textMessages', () => {
  it('builds one text message per non-empty content, in order', () => {
    expect(textMessages('a', 'b')).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ]);
  });

  it('drops blank and missing content, which LINE rejects with 400', () => {
    expect(textMessages('a', '', undefined, 'b')).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ]);
  });

  it('clamps each message to the 5000 UTF-16 unit text limit', () => {
    const [message] = textMessages('a'.repeat(6000));

    if (message.type !== 'text') throw new Error('expected a text message');
    expect(message.text.length).toBe(LINE_LIMITS.textMessage);
    expect(message.text.endsWith('…')).toBe(true);
  });

  it('counts emoji as two UTF-16 units, as LINE does', () => {
    // 3000 emoji are 6000 UTF-16 units; a code-point clamp would let them pass.
    const [message] = textMessages('🍸'.repeat(3000));

    if (message.type !== 'text') throw new Error('expected a text message');
    expect(message.text.length).toBeLessThanOrEqual(LINE_LIMITS.textMessage);
  });
});

describe('recommendationMessage', () => {
  it('builds one action per name', () => {
    const message = recommendationMessage(['琴通寧', '馬丁尼'], '琴酒');

    expect(message).toEqual({
      type: 'template',
      altText: '推薦幾種用琴酒作成的調酒：',
      template: {
        type: 'buttons',
        title: '推薦幾種用琴酒作成的調酒：',
        text: '選一種看更多',
        actions: [
          { type: 'message', label: '琴通寧', text: '琴通寧' },
          { type: 'message', label: '馬丁尼', text: '馬丁尼' },
        ],
      },
    });
  });

  it('keeps at most 4 actions, the LINE maximum for a buttons template', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    const message = recommendationMessage(names, 'x');

    expect(message?.type).toBe('template');
    if (message?.type !== 'template') throw new Error('expected a template message');
    expect(message.template.actions).toHaveLength(LINE_LIMITS.templateActions);
    expect(message.template.actions.map((action) => action.label)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns null with no names, because a 0-action template is rejected', () => {
    expect(recommendationMessage([], 'x')).toBeNull();
  });

  it('clamps the title to 40 characters when the user sends a long message', () => {
    const message = recommendationMessage(['琴通寧'], 'ㄅ'.repeat(200));

    if (message?.type !== 'template') throw new Error('expected a template message');
    expect(Array.from(message.template.title).length).toBeLessThanOrEqual(
      LINE_LIMITS.templateTitle
    );
    expect(message.template.title.endsWith('…')).toBe(true);
  });

  it('clamps altText to 400 UTF-16 units even for astral characters', () => {
    const message = recommendationMessage(['琴通寧'], '🍸'.repeat(500));

    if (message?.type !== 'template') throw new Error('expected a template message');
    expect(message.altText.length).toBeLessThanOrEqual(LINE_LIMITS.altText);
  });

  it('skips a name too long to be an action text, which would fail the request', () => {
    // `text` is capped at 300 and cannot be truncated without breaking the
    // round trip, so such a name is not offerable at all.
    const tooLong = 'ㄅ'.repeat(LINE_LIMITS.actionText + 1);
    expect(recommendationMessage([tooLong], 'x')).toBeNull();
    expect(recommendationMessage([tooLong, '琴通寧'], 'x')).toEqual(
      expect.objectContaining({
        template: expect.objectContaining({
          actions: [{ type: 'message', label: '琴通寧', text: '琴通寧' }],
        }),
      })
    );
  });

  it('skips blank and whitespace-only names, which LINE rejects as labels', () => {
    expect(recommendationMessage(['   ', ''], 'x')).toBeNull();
    expect(recommendationMessage(['   ', '琴通寧'], 'x')).toEqual(
      expect.objectContaining({
        template: expect.objectContaining({
          actions: [{ type: 'message', label: '琴通寧', text: '琴通寧' }],
        }),
      })
    );
  });

  it('clamps a label to 20 characters but keeps the postback text exact', () => {
    const longName = '非常長的調酒名稱'.repeat(5);
    const message = recommendationMessage([longName], 'x');

    if (message?.type !== 'template') throw new Error('expected a template message');
    const [action] = message.template.actions;
    expect(Array.from(action.label).length).toBeLessThanOrEqual(LINE_LIMITS.actionLabel);
    // The label is cosmetic; `text` is what the user sends back, so truncating
    // it would break the follow-up lookup.
    expect(action.text).toBe(longName);
  });
});
