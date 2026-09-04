import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILD_TARGET, ENTRY_POINTS, GLOBAL_NAME } from '../scripts/buildConfig.mjs';
import {
  BUNDLE_PATH,
  DEFAULT_PROPERTIES,
  USER_ACTION,
  loadBundle,
  replyTexts,
  textMessageEvent,
  webhookBody,
} from './gasHarness';
import type { SheetService } from './gasHarness';

describe('build contract', () => {
  const bundle = readFileSync(BUNDLE_PATH, 'utf8');

  it('targets the ES2019 dialect Apps Script V8 accepts', () => {
    // Asserted on the build configuration itself: grepping the output for newer
    // syntax only catches constructs the sources happen to contain today.
    expect(BUILD_TARGET).toBe('es2019');
  });

  it('contains no module syntax, which Apps Script cannot execute', () => {
    expect(bundle).not.toMatch(/^\s*(import|export)\s/m);
    expect(bundle).not.toMatch(/\brequire\(/);
  });

  it('exposes every declared entry point as a top-level function', () => {
    for (const entryPoint of ENTRY_POINTS) {
      expect(bundle).toMatch(new RegExp(`^function ${entryPoint}\\(`, 'm'));
    }
  });

  it('adds no global function beyond the declared entry points', () => {
    const declared = [...bundle.matchAll(/^function ([A-Za-z_$][\w$]*)\(/gm)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...ENTRY_POINTS].sort());
    expect(bundle).toMatch(new RegExp(`^var ${GLOBAL_NAME} = `, 'm'));
  });

  it('emits no syntax newer than the target', () => {
    expect(bundle).not.toMatch(/\?\?/);
    expect(bundle).not.toMatch(/\?\./);
    expect(bundle).not.toMatch(/^\s*#[a-zA-Z]/m);
  });

  it('keeps non-ASCII wording readable instead of escaping it', () => {
    expect(bundle).toContain('找不到您要的調酒');
  });

  it('ships a deployable manifest pinned to the V8 runtime', () => {
    expect(existsSync('dist/appsscript.json')).toBe(true);
    const manifest = JSON.parse(readFileSync('dist/appsscript.json', 'utf8')) as {
      runtimeVersion?: string;
      webapp?: { access?: string; executeAs?: string };
    };
    // The ES2019 target above is only valid because the runtime is V8; the
    // legacy Rhino runtime cannot parse the bundle at all.
    expect(manifest.runtimeVersion).toBe('V8');
    // LINE posts anonymously, so the web app has to accept anonymous requests.
    expect(manifest.webapp?.access).toBe('ANYONE_ANONYMOUS');
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

  it('finds a cocktail whose name cell is numeric', () => {
    // Sheets hands back a Number for numerically-formatted cells.
    const harness = loadBundle();
    harness.doPost(textMessageEvent('007'));

    expect(replyTexts(harness.recorded)).toContain('https://example.com/007');
  });

  it('never sends an empty text message when a cell is blank', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('無介紹'));

    // LINE rejects an empty `text`, so the blank detail must be dropped.
    expect(replyTexts(harness.recorded)).toEqual(['無介紹', 'https://example.com/no-detail']);
    for (const message of harness.recorded.fetches[0].payload.messages) {
      expect(message.text).not.toBe('');
    }
  });

  it('answers with the Reply API, not a chargeable push', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('伍迪'));

    const [request] = harness.recorded.fetches;
    // Replies are free; push messages count against the monthly quota.
    expect(request.url).toBe('https://api.line.me/v2/bot/message/reply');
    expect(request.method).toBe('post');
    expect(request.headers.Authorization).toBe(
      `Bearer ${DEFAULT_PROPERTIES.LINE_CHANNEL_ACCESS_TOKEN}`
    );
    expect(request.payload.replyToken).toBe('reply-token-0001');
    expect(request.payload.to).toBeUndefined();
  });

  it('sets muteHttpExceptions so the LINE error body stays readable', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('伍迪'));

    expect(harness.recorded.fetches[0].muteHttpExceptions).toBe(true);
  });
});

describe('doPost: ingredient recommendations', () => {
  it('builds the exact buttons template LINE expects', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('琴酒'));

    expect(harness.recorded.fetches[0].payload.messages).toEqual([
      {
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
      },
    ]);
  });

  it('skips recommendation indices that are out of range', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('Vodka'));

    // ELEMENT_MAPPING maps Vodka to "1,9"; index 9 does not exist.
    expect(harness.recorded.fetches[0].payload.messages[0].template?.actions).toEqual([
      { type: 'message', label: '白色俄羅斯', text: '白色俄羅斯' },
    ]);
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
  it('appends [index, search, user, timestamp] below the last row', () => {
    const harness = loadBundle({ now: '2026-01-02T03:04:05' });
    harness.doPost(textMessageEvent('伍迪'));

    expect(harness.recorded.writes).toEqual([
      {
        sheet: 'USER_ACTION',
        a1: 'USER_ACTION!A2:D2',
        values: [[0, '伍迪', 'Uuser0001', '2026-01-02 03:04:05']],
      },
    ]);
  });

  it('pads single-digit date parts so timestamps stay sortable', () => {
    const harness = loadBundle({ now: '2026-01-02T03:04:05' });
    harness.doPost(textMessageEvent('伍迪'));

    expect(harness.recorded.writes[0].values[0][3]).toBe('2026-01-02 03:04:05');
  });

  it('ignores a non-text message entirely', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent(undefined));

    // A sticker used to reach the sheet as `undefined`: an empty analytics row
    // and a lookup that could match a blank cell.
    expect(harness.recorded.writes).toHaveLength(0);
    expect(harness.recorded.fetches).toHaveLength(0);
    expect(harness.recorded.logs).toContain('[doPost] skipping message/sticker');
  });
});

describe('doPost: malformed input is ignored without sending anything', () => {
  it.each([
    ['no argument', undefined],
    ['no postData', {}],
    ['unparseable body', { postData: { contents: '{not json' } }],
    ['empty events array', webhookBody([])],
    [
      'event without source',
      webhookBody([{ type: 'message', message: { type: 'text', text: 'x' } }]),
    ],
  ])('%s', (_name, event) => {
    const harness = loadBundle();
    expect(() => harness.doPost(event)).not.toThrow();
    expect(harness.recorded.fetches).toHaveLength(0);
    expect(harness.recorded.writes).toHaveLength(0);
  });
});

describe('doPost: webhook deliveries carrying several events', () => {
  const messageEvent = (text: string, token: string, userId: string) => ({
    type: 'message',
    replyToken: token,
    message: { type: 'text', id: '1', text },
    source: { type: 'user', userId },
  });

  it('answers every event in the batch, each with its own reply token', () => {
    const harness = loadBundle();
    harness.doPost(
      webhookBody([
        messageEvent('伍迪', 'token-a', 'Uuser0001'),
        messageEvent('白色俄羅斯', 'token-b', 'Uuser0002'),
      ])
    );

    expect(harness.recorded.fetches.map((request) => request.payload.replyToken)).toEqual([
      'token-a',
      'token-b',
    ]);
    expect(harness.recorded.fetches[0].payload.messages[2].text).toBe(
      'https://example.com/woody'
    );
    expect(harness.recorded.fetches[1].payload.messages[2].text).toBe(
      'https://example.com/white-russian'
    );
    expect(harness.recorded.writes).toHaveLength(2);
  });

  it('keeps answering the rest of the batch when one event fails', () => {
    const harness = loadBundle({
      sheets: {
        DRINK_LIST: [
          ['name', 'nameen', 'link', 'detail'],
          ['伍迪', 'Woody', 'https://example.com/woody', '威士忌基底'],
        ],
        ELEMENT_MAPPING: [['name', 'nameen', 'link', 'detail', 'recommendation']],
        USER_ACTION,
      },
    });
    harness.doPost(
      webhookBody([
        // No source: userId is missing, but the reply must still go out.
        { type: 'message', replyToken: 'token-a', message: { type: 'text', id: '1', text: '伍迪' } },
        messageEvent('伍迪', 'token-b', 'Uuser0002'),
      ])
    );

    expect(harness.recorded.fetches.map((request) => request.payload.replyToken)).toEqual([
      'token-a',
      'token-b',
    ]);
  });

  it.each([
    ['follow', { type: 'follow', replyToken: 't', source: { type: 'user', userId: 'U1' } }],
    ['unfollow', { type: 'unfollow', source: { type: 'user', userId: 'U1' } }],
    ['join', { type: 'join', replyToken: 't', source: { type: 'group', groupId: 'G1' } }],
    [
      'postback',
      { type: 'postback', replyToken: 't', postback: { data: 'x' }, source: { userId: 'U1' } },
    ],
    [
      'image message',
      {
        type: 'message',
        replyToken: 't',
        message: { type: 'image', id: '1' },
        source: { userId: 'U1' },
      },
    ],
  ])('skips a %s event without touching the sheet', (_name, event) => {
    const harness = loadBundle();
    harness.doPost(webhookBody([event]));

    expect(harness.recorded.fetches).toHaveLength(0);
    expect(harness.recorded.writes).toHaveLength(0);
  });

  it('still answers the text events in a mixed batch', () => {
    const harness = loadBundle();
    harness.doPost(
      webhookBody([
        { type: 'follow', replyToken: 't1', source: { type: 'user', userId: 'U1' } },
        messageEvent('伍迪', 'token-b', 'Uuser0002'),
        { type: 'message', replyToken: 't3', message: { type: 'sticker', id: '1' }, source: {} },
      ])
    );

    expect(harness.recorded.fetches).toHaveLength(1);
    expect(harness.recorded.fetches[0].payload.replyToken).toBe('token-b');
  });
});

describe('doPost: webhook response', () => {
  it.each([
    ['a text message', textMessageEvent('伍迪')],
    ['the empty events array LINE verifies with', webhookBody([])],
    ['an unparseable body', { postData: { contents: '{not json' } }],
    ['no argument at all', undefined],
  ])('returns a JSON 200 for %s', (_name, event) => {
    const harness = loadBundle();
    // LINE retries or disables a webhook that reports failure, so every
    // delivery has to be acknowledged.
    const output = harness.doPost(event) as { content: string; mimeType: string };

    expect(output.content).toBe('{"status":"ok"}');
    expect(output.mimeType).toBe('application/json');
  });

  it('answers the valid events around a malformed entry in the array', () => {
    const harness = loadBundle();
    // `null` makes the type check throw; without per-event isolation the rest
    // of the batch would never be answered.
    harness.doPost(
      webhookBody([
        null,
        {
          type: 'message',
          replyToken: 'token-b',
          message: { type: 'text', id: '1', text: '伍迪' },
          source: { type: 'user', userId: 'Uuser0002' },
        },
      ])
    );

    expect(harness.recorded.fetches).toHaveLength(1);
    expect(harness.recorded.fetches[0].payload.replyToken).toBe('token-b');
    expect(harness.recorded.logs.some((line) => line.startsWith('[doPost] Error:'))).toBe(true);
  });

  it('tolerates an events property that is not an array', () => {
    const harness = loadBundle();
    // `for...of` over a non-iterable throws, which would surface to LINE as a
    // 500 and put the webhook at risk of being disabled.
    expect(() =>
      harness.doPost({ postData: { contents: '{"destination":"U0","events":{}}' } })
    ).not.toThrow();
    expect(harness.recorded.fetches).toHaveLength(0);
  });
});

describe('logging', () => {
  it('writes the same lines to console and to Logger', () => {
    const harness = loadBundle();
    harness.doPost({ postData: { contents: '{not json' } });

    expect(harness.recorded.logs).toContain('[doPost]');
    expect(harness.recorded.loggerLogs).toEqual(harness.recorded.logs);
  });

  it('includes the underlying error text rather than an empty message', () => {
    const harness = loadBundle();
    harness.doPost({ postData: { contents: '{not json' } });

    const prefix = '[parseEvents] Error: ';
    const line = harness.recorded.logs.find((entry) => entry.startsWith(prefix));
    expect(line).toBeDefined();
    expect(line?.slice(prefix.length)).not.toBe('');
  });

  it('logs the built reply payload as an object, not as "[object Object]"', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('伍迪'));

    // logService.log flattens arrays and hands each message to both sinks;
    // both Apps Script loggers only accept `string | object`.
    expect(harness.recorded.objectLogs).toContainEqual({ type: 'text', text: '伍迪' });
  });

  it('reports which sheet tab is missing', () => {
    const harness = loadBundle({ sheets: { USER_ACTION } });
    harness.doPost(textMessageEvent('伍迪'));

    expect(harness.recorded.logs).toContain(
      '[sheetService.findRow] Error: Sheet "DRINK_LIST" not found'
    );
  });
});

describe('sheet access stays inside the grid', () => {
  it('never requests more rows than the tab has', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('伍迪'));

    expect(harness.recorded.logs.filter((line) => line.includes('out of bounds'))).toEqual([]);
    expect(replyTexts(harness.recorded)).toContain('https://example.com/woody');
  });
});

describe('rows with empty cells', () => {
  it('still answers with the description when the matched row has no link', () => {
    // A cocktail is often added before its video exists. Branching on the
    // `link` cell instead of on the row would drop that description and send
    // "not found" for a drink that is in the sheet.
    const harness = loadBundle({
      sheets: {
        DRINK_LIST: [
          ['name', 'nameen', 'link', 'detail'],
          ['新品調酒', 'NewDrink', '', '尚未有影片的新品'],
        ],
        ELEMENT_MAPPING: [['name', 'nameen', 'link', 'detail', 'recommendation']],
        USER_ACTION,
      },
    });
    harness.doPost(textMessageEvent('新品調酒'));

    expect(replyTexts(harness.recorded)).toEqual(['新品調酒', '尚未有影片的新品']);
  });

  it('never matches a blank cell, which would leak an unrelated row', () => {
    const harness = loadBundle({
      sheets: {
        DRINK_LIST: [
          ['name', 'nameen', 'link', 'detail'],
          ['', '', 'https://example.com/orphan', '孤兒列'],
          ['伍迪', 'Woody', 'https://example.com/woody', '威士忌基底'],
        ],
        ELEMENT_MAPPING: [['name', 'nameen', 'link', 'detail', 'recommendation']],
        USER_ACTION,
      },
    });

    // An empty search value equals every blank cell in the column, so the
    // lookup itself has to refuse it — doPost's trim is only the outer guard.
    expect(harness.sheetService.findRow('DRINK_LIST', { name: '   ' }, ['link'])).toBeNull();
    expect(harness.sheetService.findRow('DRINK_LIST', { name: '' }, ['link'])).toBeNull();

    // And a whitespace-only message never reaches the sheet at all.
    harness.doPost(textMessageEvent('   '));
    expect(harness.recorded.fetches).toHaveLength(0);
    expect(harness.recorded.writes).toHaveLength(0);
    expect(harness.recorded.logs).toContain('[doPost] empty message text');
  });

  it('reads nothing from a tab that holds only a header row', () => {
    // getSheetValues with numRows < 1 throws in real Sheets; the error would be
    // swallowed and every lookup would degrade into "not found".
    const harness = loadBundle({
      sheets: {
        DRINK_LIST: [['name', 'nameen', 'link', 'detail']],
        ELEMENT_MAPPING: [['name', 'nameen', 'link', 'detail', 'recommendation']],
        USER_ACTION,
      },
    });
    harness.doPost(textMessageEvent('伍迪'));

    expect(harness.recorded.logs.filter((line) => line.includes('out of bounds'))).toEqual([]);
    expect(harness.sheetService.columnValues('DRINK_LIST', 'name')).toEqual([]);
    expect(harness.sheetService.findRow('DRINK_LIST', { name: '伍迪' }, ['link'])).toBeNull();
  });

  it('stringifies numeric cells, which the message objects require', () => {
    // Sheets returns a Number for a numerically-formatted cell, and `text` and
    // `label` are String properties: `"text": 2024` fails the whole request.
    const harness = loadBundle({
      sheets: {
        DRINK_LIST: [
          ['name', 'nameen', 'link', 'detail'],
          [7, '007', 'https://example.com/007', 2024],
        ],
        ELEMENT_MAPPING: [
          ['name', 'nameen', 'link', 'detail', 'recommendation'],
          ['伏特加', 'Vodka', '', '', '0'],
        ],
        USER_ACTION,
      },
    });

    harness.doPost(textMessageEvent('007'));
    harness.doPost(textMessageEvent('伏特加'));

    for (const request of harness.recorded.fetches) {
      for (const message of request.payload.messages) {
        if (message.type === 'text') expect(typeof message.text).toBe('string');
        for (const action of message.template?.actions ?? []) {
          expect(typeof action.label).toBe('string');
          expect(typeof action.text).toBe('string');
        }
      }
    }

    expect(harness.recorded.fetches[0].payload.messages[1].text).toBe('2024');
    expect(harness.recorded.fetches[1].payload.messages[0].template?.actions).toEqual([
      { type: 'message', label: '7', text: '7' },
    ]);
  });
});

describe('reply tokens', () => {
  it('sends nothing for an event without a reply token', () => {
    // Standby-mode events carry none; posting `replyToken: ""` only spends the
    // execution on an "Invalid reply token" 400.
    const harness = loadBundle();
    harness.doPost(
      webhookBody([
        {
          type: 'message',
          message: { type: 'text', id: '1', text: '伍迪' },
          source: { type: 'user', userId: 'Uuser0001' },
        },
      ])
    );

    expect(harness.recorded.fetches).toHaveLength(0);
    expect(harness.recorded.writes).toHaveLength(0);
    expect(harness.recorded.logs).toContain('[doPost] event has no reply token');
  });

  it('clamps an oversized cell instead of failing the whole reply', () => {
    const harness = loadBundle({
      sheets: {
        DRINK_LIST: [
          ['name', 'nameen', 'link', 'detail'],
          ['長篇', 'Long', 'https://example.com/long', 'ㄅ'.repeat(6000)],
        ],
        ELEMENT_MAPPING: [['name', 'nameen', 'link', 'detail', 'recommendation']],
        USER_ACTION,
      },
    });
    harness.doPost(textMessageEvent('長篇'));

    const { messages } = harness.recorded.fetches[0].payload;
    expect(messages).toHaveLength(3);
    for (const message of messages) {
      expect((message.text ?? '').length).toBeLessThanOrEqual(5000);
    }
    expect(messages[2].text).toBe('https://example.com/long');
  });
});

describe('debug push entry point', () => {
  it('test_send fails loudly when the channel access token is unset', () => {
    // push swallows runtime errors to keep the bot answering; a missing script
    // property must stay the exception, or a misconfigured deployment looks
    // healthy from the Apps Script editor.
    const harness = loadBundle({
      properties: {
        SPREADSHEET_ID: DEFAULT_PROPERTIES.SPREADSHEET_ID,
        DEBUG_USER_ID: DEFAULT_PROPERTIES.DEBUG_USER_ID,
      },
    });

    expect(() => harness.testSend()).toThrowError(/"LINE_CHANNEL_ACCESS_TOKEN"/);
    expect(harness.recorded.fetches).toHaveLength(0);
  });
});

describe('message count bounds', () => {
  it('sends nothing rather than an empty reply, which LINE rejects', () => {
    // The Reply API requires 1..5 message objects. Spending the single-use
    // reply token on a guaranteed 400 would leave the user unanswered.
    const harness = loadBundle();
    const result = harness.lineService.reply('reply-token-0001', []);

    expect(result.ok).toBe(false);
    expect(harness.recorded.fetches).toHaveLength(0);
    expect(harness.recorded.logs).toContain('[lineService.reply] Nothing to send');
  });

  it('trims to the 5 message objects the API accepts', () => {
    const harness = loadBundle();
    const messages = Array.from({ length: 7 }, (_, i) => ({ type: 'text', text: `m${i}` }));
    harness.lineService.reply('reply-token-0001', messages);

    expect(harness.recorded.fetches[0].payload.messages).toHaveLength(5);
    expect(harness.recorded.logs).toContain('[lineService.reply] Trimmed 7 messages to 5');
  });
});

describe('LINE API rejection', () => {
  it('does not let a failed request escape into the webhook response', () => {
    const harness = loadBundle({ responseCode: 400, responseBody: '{"message":"bad request"}' });

    expect(() => harness.doPost(textMessageEvent('伍迪'))).not.toThrow();
  });

  it('logs the status and the LINE error body instead of reporting success', () => {
    const harness = loadBundle({ responseCode: 400, responseBody: '{"message":"bad request"}' });
    harness.doPost(textMessageEvent('伍迪'));

    // With muteHttpExceptions the response is returned instead of thrown, so
    // the body naming the offending property survives into the log.
    expect(harness.recorded.logs).toContain(
      '[lineService.reply] Failed with status 400: {"message":"bad request"}'
    );
    expect(harness.recorded.logs.some((line) => line.includes('Sent 200'))).toBe(false);
  });
});

describe('script properties', () => {
  it.each([
    ['SPREADSHEET_ID', { LINE_CHANNEL_ACCESS_TOKEN: 'test-token' }, /"SPREADSHEET_ID"/],
    [
      'LINE_CHANNEL_ACCESS_TOKEN',
      { SPREADSHEET_ID: DEFAULT_PROPERTIES.SPREADSHEET_ID },
      /"LINE_CHANNEL_ACCESS_TOKEN"/,
    ],
  ])('doPost fails loudly when %s is unset', (_name, properties, expected) => {
    const harness = loadBundle({ properties });

    expect(() => harness.doPost(textMessageEvent('伍迪'))).toThrowError(expected);
  });

  it('sends nothing at all when the spreadsheet is unreachable', () => {
    const harness = loadBundle({ properties: { LINE_CHANNEL_ACCESS_TOKEN: 'test-token' } });

    expect(() => harness.doPost(textMessageEvent('伍迪'))).toThrow();
    // Silently answering "not found" to every user is the failure mode this
    // guards against.
    expect(harness.recorded.fetches).toHaveLength(0);
  });

  it.each([
    ['findRow', (service: SheetService) =>
      service.findRow('DRINK_LIST', { name: '伍迪' }, ['link'])],
    ['columnValues', (service: SheetService) => service.columnValues('DRINK_LIST', 'name')],
    ['save', (service: SheetService) => service.save({ search: '伍迪', user: 'Uuser0001' })],
  ])('sheetService.%s rethrows a missing property instead of swallowing it', (_name, call) => {
    const harness = loadBundle({ properties: { LINE_CHANNEL_ACCESS_TOKEN: 'test-token' } });

    expect(() => call(harness.sheetService)).toThrowError(/"SPREADSHEET_ID"/);
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
