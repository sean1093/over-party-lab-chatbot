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
  withToken,
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
  it('appends the row instead of computing the target range', () => {
    const harness = loadBundle({ now: '2026-01-02T03:04:05' });
    harness.doPost(textMessageEvent('伍迪'));

    // `appendRow` targets the bottom of the data region server-side, so unlike
    // the previous getLastRow-then-setValues it cannot overwrite a row another
    // execution just wrote. The index stays a number: appendRow would treat a
    // leading "=" as a formula, which renumbers itself when the tab is sorted.
    expect(harness.recorded.writes).toEqual([
      {
        sheet: 'USER_ACTION',
        a1: 'append',
        values: [[0, '伍迪', 'Uuser0001', '2026-01-02 03:04:05']],
      },
    ]);
  });

  it('takes and releases the script lock around the write', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('伍迪'));

    expect(harness.recorded.lockAttempts).toEqual([1000]);
    expect(harness.recorded.lockReleases).toBe(1);
  });

  it('replies before writing, and holds the lock across the write itself', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('伍迪'));

    // The reply token expires about a minute after the webhook and the write
    // contends for a script lock, so recording the search must never be what
    // delays or costs the user their answer. The write has to happen *inside*
    // the lock, or getLastRow-then-append is not atomic and two deliveries can
    // resolve the same index again.
    expect(harness.recorded.calls).toEqual(['read', 'send', 'lock', 'write', 'unlock']);
  });

  it('still records the search when the lock cannot be taken', () => {
    const harness = loadBundle({ lockAvailable: false });
    harness.doPost(textMessageEvent('伍迪'));

    // Losing an analytics row would be worse than a repeated index, and
    // appendRow cannot overwrite anything either way.
    expect(harness.recorded.writes).toHaveLength(1);
    expect(harness.recorded.lockReleases).toBe(0);
    expect(harness.recorded.logs).toContain(
      '[sheetService.save] Lock unavailable; index may repeat'
    );
  });

  it.each([
    ['2026-01-02T03:04:05', '2026-01-02 03:04:05'],
    // Every field two digits already, so a formatter that pads unconditionally
    // or truncates would show up here and not in the padded case above.
    ['2026-12-25T23:59:59', '2026-12-25 23:59:59'],
  ])('formats %s as %s', (now, expected) => {
    const harness = loadBundle({ now });
    harness.doPost(textMessageEvent('伍迪'));

    expect(harness.recorded.writes[0].values[0][3]).toBe(expected);
  });

  it('numbers each row of a batch in sequence', () => {
    const harness = loadBundle();
    const event = (text: string, token: string) => ({
      type: 'message',
      replyToken: token,
      message: { type: 'text', id: '1', text },
      source: { type: 'user', userId: 'Uuser0001' },
    });
    harness.doPost(webhookBody([event('伍迪', 't1'), event('白色俄羅斯', 't2')]));

    expect(harness.recorded.writes.map((write) => write.values[0][0])).toEqual([0, 1]);
  });

  it('keeps every row of a batch instead of overwriting the previous one', () => {
    const harness = loadBundle();
    harness.doPost(
      webhookBody([
        {
          type: 'message',
          replyToken: 'token-a',
          message: { type: 'text', id: '1', text: '伍迪' },
          source: { type: 'user', userId: 'Uuser0001' },
        },
        {
          type: 'message',
          replyToken: 'token-b',
          message: { type: 'text', id: '2', text: '白色俄羅斯' },
          source: { type: 'user', userId: 'Uuser0002' },
        },
      ])
    );

    expect(harness.recorded.writes.map((write) => write.values[0][1])).toEqual([
      '伍迪',
      '白色俄羅斯',
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
    expect(harness.recorded.logs).toContain('[textMessageEvent] skipping message/sticker');
  });

  it('records the trimmed search term, not what the user typed', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('  伍迪  '));

    // The lookup normalises before matching, so the counted row has to be
    // normalised too: otherwise "伍迪" and "  伍迪  " are two search terms in
    // every downstream count of this tab.
    expect(harness.recorded.writes[0].values[0][1]).toBe('伍迪');
  });

  it('ignores a message that only looks non-empty', () => {
    const harness = loadBundle();
    // U+200B is a format character, not whitespace, so `trim` leaves it: the
    // bot would spend a reply echoing an invisible message.
    harness.doPost(textMessageEvent('\u200b\u200b'));

    expect(harness.recorded.fetches).toHaveLength(0);
    expect(harness.recorded.writes).toHaveLength(0);
  });
});

describe('doPost: malformed input is ignored without sending anything', () => {
  it.each([
    ['no argument', undefined],
    ['no postData', withToken({})],
    ['unparseable body', withToken({ postData: { contents: '{not json' } })],
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
    [
      // The one documented event that carries `message.type: "text"` AND its
      // own reply token under a different `event.type`, so it is what pins the
      // `event.type` half of the filter. Answering it would re-reply to every
      // message a user edits.
      'messageEdited',
      {
        type: 'messageEdited',
        mode: 'active',
        replyToken: '950e63e8f46542ab89f645b4c2a1180a',
        message: { type: 'text', id: '610830548529053697', text: '伍迪' },
        source: { type: 'group', groupId: 'Ca56f94637c', userId: 'U4af4980629' },
      },
    ],
    [
      // A standby-channel event belongs to the linked module, which is
      // answering the user; replying would talk over it.
      'standby-mode text message',
      {
        type: 'message',
        mode: 'standby',
        replyToken: '950e63e8f46542ab89f645b4c2a1180a',
        message: { type: 'text', id: '1', text: '伍迪' },
        source: { type: 'user', userId: 'U1' },
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
    ['an unparseable body', withToken({ postData: { contents: '{not json' } })],
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
    expect(harness.recorded.logs).toContain('[textMessageEvent] skipping object entry');
  });

  it('tolerates an events property that is not an array', () => {
    const harness = loadBundle();
    // `for...of` over a non-iterable throws, which would surface to LINE as a
    // 500 and put the webhook at risk of being disabled. The request has to be
    // authentic, or it never reaches the parser this defends.
    const body = JSON.stringify({ destination: DEFAULT_PROPERTIES.BOT_USER_ID, events: {} });
    expect(() => harness.doPost(withToken({ postData: { contents: body } }))).not.toThrow();
    expect(harness.recorded.logs).toContain('[parseDelivery] body carries no event array');
    expect(harness.recorded.fetches).toHaveLength(0);
  });
});

describe('logging', () => {
  it.each([
    ['a scalar line', withToken({ postData: { contents: '{not json' } })],
    // `logService.log` flattens an array and logs each entry separately, which
    // is the path the reply payload takes.
    ['a flattened array', textMessageEvent('伍迪')],
  ])('writes %s once, to console only', (_name, event) => {
    const harness = loadBundle();
    harness.doPost(event);

    expect(harness.recorded.logs).toContain('[doPost]');
    // On the V8 runtime console.log and the legacy Logger.log both reach Cloud
    // Logging, so calling both duplicated every line in the execution log.
    expect(harness.recorded.loggerLogs).toEqual([]);
    expect(harness.recorded.logs.filter((line) => line === '[doPost]')).toHaveLength(1);
  });

  it('includes the underlying error text rather than an empty message', () => {
    const harness = loadBundle();
    harness.doPost(withToken({ postData: { contents: '{not json' } }));

    const prefix = '[parseDelivery] Error: ';
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
      '[sheetService] Error: Sheet "DRINK_LIST" not found'
    );
  });
});

describe('Sheets round-trips', () => {
  it('reads only the mapped columns, whatever else the tab holds', () => {
    const harness = loadBundle({
      sheets: {
        DRINK_LIST: [
          // A stray note in column J: reading to getLastColumn() would carry
          // every intervening cell for every row.
          ['name', 'nameen', 'link', 'detail', '', '', '', '', '', 'note'],
          ['伍迪', 'Woody', 'https://example.com/woody', '威士忌基底', '', '', '', '', '', 'x'],
        ],
        ELEMENT_MAPPING: [['name', 'nameen', 'link', 'detail', 'recommendation']],
        USER_ACTION,
      },
    });
    harness.doPost(textMessageEvent('伍迪'));

    expect(replyTexts(harness.recorded)).toEqual([
      '伍迪',
      '威士忌基底',
      'https://example.com/woody',
    ]);
    expect(harness.recorded.sheetReads).toEqual(['DRINK_LIST']);
    // 4 mapped columns wide, not out to the stray note in column J.
    expect(harness.recorded.sheetRanges).toEqual(['DRINK_LIST 1x5 from R2C1']);
  });

  it('never asks for more columns than the tab actually has', () => {
    // A user can delete columns, shrinking the grid below the mapped width.
    // Requesting past the grid throws, the error is swallowed, and every
    // lookup degrades into "not found".
    const harness = loadBundle({
      maxColumns: 4,
      sheets: {
        DRINK_LIST: [
          ['name', 'nameen', 'link', 'detail'],
          ['伍迪', 'Woody', 'https://example.com/woody', '威士忌基底'],
        ],
        ELEMENT_MAPPING: [['name', 'nameen', 'link', 'detail']],
        USER_ACTION,
      },
    });
    harness.doPost(textMessageEvent('伍迪'));

    expect(harness.recorded.sheetRanges).toEqual(['DRINK_LIST 1x4 from R2C1']);
    expect(replyTexts(harness.recorded)).toEqual([
      '伍迪',
      '威士忌基底',
      'https://example.com/woody',
    ]);
  });

  it('reads nothing from a tab that has no data rows', () => {
    const harness = loadBundle({
      sheets: {
        DRINK_LIST: [['name', 'nameen', 'link', 'detail']],
        ELEMENT_MAPPING: [],
        USER_ACTION,
      },
    });
    harness.doPost(textMessageEvent('伍迪'));

    // An out-of-grid range would throw, be swallowed, and turn every lookup
    // into "not found" with the cause visible only in the log.
    expect(
      harness.recorded.logs.filter((line) => line.includes('[sheetService.findRow] Error'))
    ).toEqual([]);
    expect(harness.recorded.logs.filter((line) => line.includes('out of bounds'))).toEqual([]);
    expect(replyTexts(harness.recorded)).toContain('找不到您要的調酒，不如來逛逛我們的頻道吧！');
  });
  it('reads each tab once per execution, not once per column', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('伍迪'));

    // A match in DRINK_LIST needs the name, link and detail columns; the
    // previous implementation issued one getSheetValues per column per lookup.
    expect(harness.recorded.sheetReads).toEqual(['DRINK_LIST']);
  });

  it('does not re-read a tab for every event in a batch', () => {
    const harness = loadBundle();
    const event = (text: string, token: string) => ({
      type: 'message',
      replyToken: token,
      message: { type: 'text', id: '1', text },
      source: { type: 'user', userId: 'Uuser0001' },
    });
    harness.doPost(
      webhookBody([event('伍迪', 't1'), event('琴酒', 't2'), event('不存在', 't3')])
    );

    // Three events, two tabs between them: three replies but only two reads.
    expect(harness.recorded.fetches).toHaveLength(3);
    expect(harness.recorded.sheetReads.sort()).toEqual(['DRINK_LIST', 'ELEMENT_MAPPING']);
  });

  it('never asks for rows outside the grid', () => {
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
    expect(harness.recorded.logs).toContain('[textMessageEvent] empty message text');
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
    expect(harness.recorded.logs).toContain('[textMessageEvent] event has no reply token');
  });

  it.each([
    ['a numeric message text', { message: { type: 'text', id: '1', text: 7 }, replyToken: 't' }],
    ['an object message text', { message: { type: 'text', id: '1', text: {} }, replyToken: 't' }],
    ['a numeric reply token', { message: { type: 'text', id: '1', text: '伍迪' }, replyToken: 42 }],
    [
      'a whitespace reply token',
      { message: { type: 'text', id: '1', text: '伍迪' }, replyToken: '   ' },
    ],
  ])('sends nothing for %s', (_name, fields) => {
    // Nothing LINE sends looks like this, so coercing it into a search or a
    // reply token would turn a platform change into a wrong answer or a 400.
    const harness = loadBundle();
    harness.doPost(webhookBody([{ type: 'message', source: { userId: 'U1' }, ...fields }]));

    expect(harness.recorded.fetches).toHaveLength(0);
    expect(harness.recorded.writes).toHaveLength(0);
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
    [
      'SPREADSHEET_ID',
      {
        LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
        WEBHOOK_TOKEN: DEFAULT_PROPERTIES.WEBHOOK_TOKEN,
        BOT_USER_ID: DEFAULT_PROPERTIES.BOT_USER_ID,
      },
      /"SPREADSHEET_ID"/,
    ],
    [
      'LINE_CHANNEL_ACCESS_TOKEN',
      {
        SPREADSHEET_ID: DEFAULT_PROPERTIES.SPREADSHEET_ID,
        WEBHOOK_TOKEN: DEFAULT_PROPERTIES.WEBHOOK_TOKEN,
        BOT_USER_ID: DEFAULT_PROPERTIES.BOT_USER_ID,
      },
      /"LINE_CHANNEL_ACCESS_TOKEN"/,
    ],
  ])('doPost fails loudly when %s is unset', (_name, properties, expected) => {
    const harness = loadBundle({ properties });

    expect(() => harness.doPost(textMessageEvent('伍迪'))).toThrowError(expected);
  });

  it('sends nothing at all when the spreadsheet is unreachable', () => {
    const harness = loadBundle({
      properties: {
        LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
        WEBHOOK_TOKEN: DEFAULT_PROPERTIES.WEBHOOK_TOKEN,
        BOT_USER_ID: DEFAULT_PROPERTIES.BOT_USER_ID,
      },
    });

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

describe('webhook authentication', () => {
  const forgedDelivery = (destination: string) => ({
    destination,
    events: [
      {
        type: 'message',
        replyToken: 'reply-token-0001',
        message: { type: 'text', id: '1', text: '伍迪' },
        source: { type: 'user', userId: 'Uattacker' },
      },
    ],
  });

  it.each([
    ['no token at all', undefined],
    ['an empty token', ''],
    ['a wrong token', 'not-the-token'],
    ['the token of a different deployment', 'test-webhook-token-2'],
  ])('rejects a request with %s', (_name, token) => {
    const harness = loadBundle();
    const request = {
      postData: { contents: JSON.stringify(forgedDelivery(DEFAULT_PROPERTIES.BOT_USER_ID)) },
    };
    const output = harness.doPost(
      token === undefined ? request : withToken(request, token)
    ) as { content: string };

    // Apps Script cannot read request headers, so LINE's x-line-signature is
    // unavailable; the shared secret in the URL is what stands in for it.
    expect(harness.recorded.fetches).toHaveLength(0);
    expect(harness.recorded.writes).toHaveLength(0);
    expect(harness.recorded.sheetReads).toHaveLength(0);
    expect(harness.recorded.logs).toContain('[doPost] rejected: webhook token mismatch');
    // Still a 200: a rejected request must not make LINE retry or disable the
    // webhook, and the caller learns nothing from the response.
    expect(output.content).toBe('{"status":"ok"}');
  });

  it.each([
    ['another bot', 'Usomeoneelsesbot'],
    ['an empty destination', ''],
    // LINE documents user IDs as U[0-9a-f]{32}: the comparison stays exact so a
    // future "helpful" normalisation cannot widen it.
    ['this bot with the case folded', DEFAULT_PROPERTIES.BOT_USER_ID.toUpperCase()],
  ])('rejects a delivery addressed to %s', (_name, destination) => {
    const harness = loadBundle();
    const output = harness.doPost(
      withToken({ postData: { contents: JSON.stringify(forgedDelivery(destination)) } })
    ) as { content: string };

    // Defence in depth rather than a second secret: `destination` is the bot's
    // own user ID and arrives inside the body the caller controls, but a leaked
    // URL alone is still not enough to forge a delivery.
    expect(harness.recorded.fetches).toHaveLength(0);
    expect(harness.recorded.writes).toHaveLength(0);
    expect(harness.recorded.logs).toContain('[doPost] rejected: destination is not this bot');
    expect(output.content).toBe('{"status":"ok"}');
  });

  it('answers a request that carries both the token and this bot as destination', () => {
    const harness = loadBundle();
    harness.doPost(textMessageEvent('伍迪'));

    expect(harness.recorded.fetches).toHaveLength(1);
  });

  it.each([
    ['WEBHOOK_TOKEN', 'WEBHOOK_TOKEN', /"WEBHOOK_TOKEN"/],
    ['BOT_USER_ID', 'BOT_USER_ID', /"BOT_USER_ID"/],
  ])('fails loudly when %s is unset rather than accepting anything', (_name, omit, expected) => {
    const properties = { ...DEFAULT_PROPERTIES };
    delete properties[omit];
    const harness = loadBundle({ properties });

    expect(() => harness.doPost(textMessageEvent('伍迪'))).toThrowError(expected);
    expect(harness.recorded.fetches).toHaveLength(0);
  });

  it('rejects the request without reading the body at all', () => {
    const harness = loadBundle();
    let bodyReads = 0;
    harness.doPost({
      parameter: { token: 'wrong' },
      postData: {
        // Counts every look at the body, so this fails if the token is checked
        // after the delivery is parsed rather than before it.
        get contents() {
          bodyReads += 1;
          return JSON.stringify({ destination: DEFAULT_PROPERTIES.BOT_USER_ID, events: [] });
        },
      },
    });

    expect(bodyReads).toBe(0);
    expect(harness.recorded.calls).toEqual([]);
  });

  it('rejects a token that is not a string, even when it wraps the real secret', () => {
    const harness = loadBundle();
    // Apps Script puts strings in `e.parameter` and arrays in `e.parameters`.
    // Narrowing to a string before comparing is what makes a future switch to
    // `parameters` fail closed instead of accepting `[<secret>]`.
    const output = harness.doPost({
      parameter: { token: [DEFAULT_PROPERTIES.WEBHOOK_TOKEN] },
      postData: { contents: JSON.stringify(forgedDelivery(DEFAULT_PROPERTIES.BOT_USER_ID)) },
    }) as { content: string };

    expect(harness.recorded.calls).toEqual([]);
    expect(harness.recorded.logs).toContain('[doPost] rejected: webhook token mismatch');
    expect(output.content).toBe('{"status":"ok"}');
  });
});
