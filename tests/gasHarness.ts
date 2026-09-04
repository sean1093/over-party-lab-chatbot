/**
 * Test harness for the built Apps Script bundle.
 *
 * The bot only ever runs inside the Apps Script V8 runtime, so the honest way
 * to test it is to evaluate the real build output (`dist/Code.js`) in a
 * `node:vm` context with the Apps Script globals stubbed, and then drive the
 * entry points the same way Apps Script does: by global function name.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const BUNDLE_PATH = 'dist/Code.js';

export type Cell = string | number | undefined;
export type SheetRow = Cell[];

export interface LineAction {
  type: string;
  label: string;
  text: string;
}

export interface LineTemplate {
  type: string;
  title?: string;
  text?: string;
  actions?: LineAction[];
}

export interface LineMessage {
  type: string;
  text?: string;
  altText?: string;
  template?: LineTemplate;
}

export interface LinePayload {
  to?: string;
  replyToken?: string;
  messages: LineMessage[];
}

export interface FetchRecord {
  url: string;
  method: string;
  headers: Record<string, string>;
  payload: LinePayload;
}

export interface SheetWrite {
  sheet: string;
  a1: string;
  values: SheetRow[];
}

export interface Recorded {
  fetches: FetchRecord[];
  writes: SheetWrite[];
  logs: string[];
}

export interface HarnessOptions {
  /** Sheet tab name -> data rows (header row excluded). */
  sheets?: Record<string, SheetRow[]>;
  /** Script properties; omit a key to simulate an unset property. */
  properties?: Record<string, string>;
  /** HTTP status returned by the stubbed LINE API. */
  responseCode?: number;
  /** Body returned by the stubbed LINE API. */
  responseBody?: string;
}

export interface Harness {
  /** Invokes the global `doPost`, exactly as the Apps Script web app does. */
  doPost: (event: unknown) => unknown;
  /** Invokes the global `test_post` from `debug.ts`. */
  testPost: () => unknown;
  /** Invokes the global `test_send` from `debug.ts`. */
  testSend: () => unknown;
  recorded: Recorded;
}

export const DEFAULT_PROPERTIES: Record<string, string> = {
  LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
  SPREADSHEET_ID: 'test-spreadsheet-id',
  DEBUG_USER_ID: 'Udebuguser',
};

export const DRINK_LIST: SheetRow[] = [
  // name, nameen, link, detail
  ['伍迪', 'Woody', 'https://example.com/woody', '威士忌基底，煙燻風味'],
  ['白色俄羅斯', 'White Russian', 'https://example.com/white-russian', '伏特加與咖啡利口酒'],
  ['瑪格麗特', 'Margarita', 'https://example.com/margarita', '經典龍舌蘭調酒'],
  ['琴通寧', 'Gin & Tonic', 'https://example.com/gin-tonic', '琴酒與通寧水'],
];

export const ELEMENT_MAPPING: SheetRow[] = [
  // name, nameen, link, detail, recommendation
  ['琴酒', 'Gin', '', '', '2,3'],
  ['伏特加', 'Vodka', '', '', '1,9'], // 9 is deliberately out of range
];

interface FetchRequest {
  method: string;
  headers: Record<string, string>;
  payload: string;
}

export function loadBundle(options: HarnessOptions = {}): Harness {
  const code = readFileSync(BUNDLE_PATH, 'utf8');
  const sheets = options.sheets ?? {
    DRINK_LIST,
    ELEMENT_MAPPING,
    USER_ACTION: [],
  };
  const properties = options.properties ?? DEFAULT_PROPERTIES;
  const recorded: Recorded = { fetches: [], writes: [], logs: [] };

  const record = (message: unknown): void => {
    recorded.logs.push(String(message));
  };

  const makeSheet = (name: string, rows: SheetRow[]) => ({
    getLastRow: () => rows.length + 1, // data rows + header row
    getSheetValues: (startRow: number, startCol: number, numRows: number, numCols: number) =>
      rows
        .slice(startRow - 2, startRow - 2 + numRows)
        .map((row) => Array.from({ length: numCols }, (_, i) => row[startCol - 1 + i] ?? '')),
    getRange: (a1: string) => ({
      setValues: (values: SheetRow[]) => {
        recorded.writes.push({ sheet: name, a1, values });
      },
    }),
  });

  const sandbox: Record<string, unknown> = {
    console: { log: record, info: record, warn: record, error: record },
    Logger: { log: record },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => properties[key] ?? null,
      }),
    },
    SpreadsheetApp: {
      openById: (id: string) => {
        if (id !== properties.SPREADSHEET_ID) {
          throw new Error(`unexpected spreadsheet id: ${id}`);
        }
        return {
          getSheetByName: (name: string) => (name in sheets ? makeSheet(name, sheets[name]) : null),
        };
      },
    },
    UrlFetchApp: {
      fetch: (url: string, request: FetchRequest) => {
        recorded.fetches.push({
          url,
          method: request.method,
          headers: request.headers,
          payload: JSON.parse(request.payload) as LinePayload,
        });
        return {
          getResponseCode: () => options.responseCode ?? 200,
          getContentText: () => options.responseBody ?? '{}',
        };
      },
    },
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(code, context);

  // Entry points are looked up as globals, so the build's footer shims and the
  // "Apps Script resolves handlers by global function name" contract are both
  // exercised rather than assumed.
  const callGlobal = (name: string, ...args: unknown[]): unknown => {
    const fn = vm.runInContext(name, context);
    if (typeof fn !== 'function') {
      throw new Error(`global "${name}" is not a function in ${BUNDLE_PATH}`);
    }
    return (fn as (...called: unknown[]) => unknown)(...args);
  };

  return {
    doPost: (event: unknown) => callGlobal('doPost', event),
    testPost: () => callGlobal('test_post'),
    testSend: () => callGlobal('test_send'),
    recorded,
  };
}

export function webhookBody(events: unknown[], destination = 'Ubotdestination'): unknown {
  return { postData: { contents: JSON.stringify({ destination, events }) } };
}

/**
 * A webhook body with a single message event. `text: undefined` produces a
 * sticker event, i.e. a message event that carries no `text` property at all.
 */
export function textMessageEvent(text: string | undefined, userId = 'Uuser0001'): unknown {
  return webhookBody([
    {
      type: 'message',
      replyToken: 'reply-token-0001',
      message: text === undefined ? { type: 'sticker', id: '1' } : { type: 'text', id: '1', text },
      source: { type: 'user', userId },
    },
  ]);
}

/** Texts of the messages in the single recorded LINE request. */
export function replyTexts(recorded: Recorded): Array<string | undefined> {
  if (recorded.fetches.length !== 1) {
    throw new Error(`expected exactly 1 LINE request, got ${recorded.fetches.length}`);
  }
  return recorded.fetches[0].payload.messages.map((message) => message.text);
}
