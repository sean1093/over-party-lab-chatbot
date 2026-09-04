import { describe, expect, it } from 'vitest';
import { LINE_LIMITS, clamp, recommendationMessage, textMessages } from '../lineMessage';

describe('clamp', () => {
  it('leaves text within the budget untouched', () => {
    expect(clamp('short', 10)).toBe('short');
    expect(clamp('exactly-10', 10)).toBe('exactly-10');
  });

  it('marks truncation with an ellipsis and never exceeds the budget', () => {
    const clamped = clamp('0123456789abcdef', 10);
    expect(clamped).toBe('012345678…');
    expect(Array.from(clamped)).toHaveLength(10);
  });

  it('never splits a surrogate pair', () => {
    // Four astral characters: cutting by code unit would produce a lone surrogate.
    const clamped = clamp('🍸🍸🍸🍸', 3);
    expect(clamped).toBe('🍸🍸…');
    expect(clamped).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
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

  it('clamps altText to 400 characters', () => {
    const message = recommendationMessage(['琴通寧'], 'ㄅ'.repeat(2000));

    if (message?.type !== 'template') throw new Error('expected a template message');
    expect(Array.from(message.altText).length).toBeLessThanOrEqual(LINE_LIMITS.altText);
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
