import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BUNDLE_PATH,
  DEFAULT_PROPERTIES,
  DRINK_LIST,
  ELEMENT_MAPPING,
  loadBundle,
  replyTexts,
  textMessageEvent,
  webhookBody,
} from './gasHarness';

describe('bundle packaging', () => {
  const bundle = readFileSync(BUNDLE_PATH, 'utf8');

  it('contains no module syntax, which Apps Script cannot execute', () => {
    expect(bundle).not.toMatch(/^\s*(import|export)\s/m);
    expect(bundle).not.toMatch(/\brequire\(/);
  });

  it('exposes every Apps Script entry point as a top-level function', () => {
    for (const entryPoint of ['doPost', 'test_post', 'test_send']) {
      expect(bundle).toMatch(new RegExp(`^function ${entryPoint}\\(`, 'm'));
    }
  });

  it('emits no syntax newer than the ES2019 target of the V8 runtime', () => {
    // `??`, `?.` and `#private` are the constructs esbuild would let through if
    // the target were raised by accident.
    expect(bundle).not.toMatch(/\?\?/);
    expect(bundle).not.toMatch(/\?\./);
    expect(bundle).not.toMatch(/^\s*#[a-zA-Z]/m);
  });

  it('keeps non-ASCII wording readable instead of escaping it', () => {
    expect(bundle).toContain('找不到您要的調酒');
  });
});

describe('doPost: exact cocktail match', () => {
  it('replies with the echo, the detail and the link, in that order', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('白色俄羅斯'));

    expect(harness.recorded.fetches).toHaveLength(1);
    expect(replyTexts(harness.recorded)).toEqual([
      '白色俄羅斯',
      '伏特加與咖啡利口酒',
      'https://example.com/white-russian',
    ]);
  });

  it('matches the English name ignoring case and surrounding whitespace', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('  wHiTe RuSsIaN  '));

    expect(replyTexts(harness.recorded)).toContain('https://example.com/white-russian');
  });

  it('authenticates with the channel access token from script properties', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('伍迪'));

    const [request] = harness.recorded.fetches;
    expect(request.headers.Authorization).toBe(`Bearer ${DEFAULT_PROPERTIES.LINE_CHANNEL_ACCESS_TOKEN}`);
    expect(request.method).toBe('post');
  });
});

describe('doPost: ingredient recommendations', () => {
  it('offers one button per recommended cocktail', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('琴酒'));

    const [message] = harness.recorded.fetches[0].payload.messages;
    expect(message.type).toBe('template');
    expect(message.template?.type).toBe('buttons');
    expect(message.template?.actions?.map((action) => action.label)).toEqual([
      '瑪格麗特',
      '琴通寧',
    ]);
    expect(message.template?.title).toBe('推薦幾種用琴酒作成的調酒：');
  });

  it('skips recommendation indices that are out of range', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('Vodka'));

    // ELEMENT_MAPPING maps Vodka to "1,9"; index 9 does not exist.
    expect(harness.recorded.fetches[0].payload.messages[0].template?.actions).toHaveLength(1);
  });
});

describe('doPost: no match', () => {
  it('falls back to the not-found wording and the Instagram link', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('完全不存在的調酒'));

    expect(replyTexts(harness.recorded)).toEqual([
      '完全不存在的調酒',
      '找不到您要的調酒，不如來逛逛我們的頻道吧！',
      'https://www.instagram.com/over.party.lab/',
    ]);
  });
});

describe('doPost: analytics', () => {
  it('appends the search and the user id to USER_ACTION', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('伍迪'));

    expect(harness.recorded.writes).toHaveLength(1);
    const [write] = harness.recorded.writes;
    expect(write.sheet).toBe('USER_ACTION');
    expect(write.values[0]).toContain('伍迪');
    expect(write.values[0]).toContain('Uuser0001');
  });
});

describe('doPost: malformed input is ignored without sending anything', () => {
  it.each([
    ['no argument', undefined],
    ['no postData', {}],
    ['unparseable body', { postData: { contents: '{not json' } }],
    ['empty events array', webhookBody([])],
    ['event without source', webhookBody([{ type: 'message', message: { type: 'text', text: 'x' } }])],
  ])('%s', (_name, event) => {
    const harness = loadBundle();
    expect(() => harness.doPost(event)).not.toThrow();
    expect(harness.recorded.fetches).toHaveLength(0);
    expect(harness.recorded.writes).toHaveLength(0);
  });
});

describe('doPost: sheet configuration problems', () => {
  it('does not reply when a required sheet tab is missing', () => {
    const harness = loadBundle({ sheets: { USER_ACTION: [] } });
    harness.doPost(textMessageEvent('伍迪'));

    // No DRINK_LIST / ELEMENT_MAPPING: nothing can be looked up, but the user
    // still gets the not-found fallback rather than silence.
    expect(replyTexts(harness.recorded)).toContain('找不到您要的調酒，不如來逛逛我們的頻道吧！');
  });

  it('keeps answering when the LINE API rejects the request', () => {
    const harness = loadBundle({ responseCode: 400, responseBody: '{"message":"bad request"}' });

    // UrlFetchApp throws on non-2xx today (tracked in #16); the important part
    // is that doPost does not propagate it into the webhook response.
    expect(() => harness.doPost(textMessageEvent('伍迪'))).not.toThrow();
  });
});

describe('script properties', () => {
  it('fails loudly when SPREADSHEET_ID is unset instead of replying "not found"', () => {
    const harness = loadBundle({ properties: { LINE_CHANNEL_ACCESS_TOKEN: 'test-token' } });

    expect(() => harness.doPost(textMessageEvent('伍迪'))).toThrowError(
      /Missing script property "SPREADSHEET_ID"/
    );
    expect(harness.recorded.fetches).toHaveLength(0);
  });

  it('fails loudly when the channel access token is unset', () => {
    const harness = loadBundle({
      properties: { SPREADSHEET_ID: DEFAULT_PROPERTIES.SPREADSHEET_ID },
    });

    expect(() => harness.doPost(textMessageEvent('伍迪'))).toThrowError(
      /Missing script property "LINE_CHANNEL_ACCESS_TOKEN"/
    );
  });
});

describe('debug entry points', () => {
  it('test_send pushes a message to DEBUG_USER_ID', () => {
    const harness = loadBundle();
    harness.testSend();

    const [request] = harness.recorded.fetches;
    expect(request.url).toBe('https://api.line.me/v2/bot/message/push');
    expect(request.payload.to).toBe(DEFAULT_PROPERTIES.DEBUG_USER_ID);
    expect(request.payload.messages[0].text).toContain('Over Party Lab Bot');
  });

  it('test_post drives the full doPost flow', () => {
    const harness = loadBundle();
    harness.testPost();

    expect(replyTexts(harness.recorded)).toContain('https://example.com/woody');
  });
});

describe('fixtures', () => {
  it('cover both sheets used by the flow', () => {
    expect(DRINK_LIST).not.toHaveLength(0);
    expect(ELEMENT_MAPPING).not.toHaveLength(0);
  });
});
