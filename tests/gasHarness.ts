/**
 * Test harness for the built Apps Script bundle.
 *
 * The bot only ever runs inside the Apps Script V8 runtime, so the honest way
 * to test it is to evaluate the real build output (`dist/Code.js`) in a
 * `node:vm` context with the Apps Script globals stubbed, and then drive the
 * entry points the same way Apps Script does: by global function name.
 *
 * The stubs deliberately reproduce the *awkward* parts of the real APIs — a
 * `getSheetValues` range that leaves the grid throws, `UrlFetchApp.fetch`
 * throws on a non-2xx response unless `muteHttpExceptions` is set — because a
 * forgiving stub turns a test into false confidence.
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
  muteHttpExceptions?: boolean;
}

export interface SheetWrite {
  sheet: string;
  a1: string;
  values: SheetRow[];
}

export interface Recorded {
  fetches: FetchRecord[];
  writes: SheetWrite[];
  /** Lines passed to `console.log`, rendered as text. */
  logs: string[];
  /** Non-string payloads handed to the loggers, as received. */
  objectLogs: object[];
  /** Lines passed to `Logger.log`; both sinks must receive the same text. */
  loggerLogs: string[];
}

/** A row returned by `sheetService.findRow`. */
export type FoundRow = Record<string, string>;

export interface SaveData {
  search: string;
  user: string;
}

/** The subset of `sheetService` the suite drives directly. */
export interface SheetService {
  findRow: (from: string, where: Record<string, string>, select: string[]) => FoundRow | null;
  columnValues: (from: string, colName: string) => string[];
  save: (data: SaveData) => void;
}

export interface HarnessOptions {
  /** Sheet tab name -> rows *including the header row*, as the real tabs have. */
  sheets?: Record<string, SheetRow[]>;
  /** Script properties; omit a key to simulate an unset property. */
  properties?: Record<string, string>;
  /** HTTP status returned by the stubbed LINE API. */
  responseCode?: number;
  /** Body returned by the stubbed LINE API. */
  responseBody?: string;
  /** Freezes the clock inside the sandbox, e.g. '2026-01-02T03:04:05'. */
  now?: string;
}

export interface Harness {
  /** Invokes the global `doPost`, exactly as the Apps Script web app does. */
  doPost: (event: unknown) => unknown;
  /** Invokes the global `test_post` from `debug.ts`. */
  testPost: () => unknown;
  /** Invokes the global `test_send` from `debug.ts`. */
  testSend: () => unknown;
  /** The bundle's `sheetService`, for contracts `doPost` cannot reach alone. */
  sheetService: SheetService;
  recorded: Recorded;
}

export const DEFAULT_PROPERTIES: Record<string, string> = {
  LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
  SPREADSHEET_ID: 'test-spreadsheet-id',
  DEBUG_USER_ID: 'Udebuguser',
};

export const DRINK_LIST: SheetRow[] = [
  ['name', 'nameen', 'link', 'detail'],
  ['伍迪', 'Woody', 'https://example.com/woody', '威士忌基底，煙燻風味'],
  ['白色俄羅斯', 'White Russian', 'https://example.com/white-russian', '伏特加與咖啡利口酒'],
  ['琴通寧', 'Gin & Tonic', 'https://example.com/gin-tonic', '琴酒與通寧水'],
  ['馬丁尼', 'Martini', 'https://example.com/martini', '琴酒與香艾酒'],
  ['無介紹', 'NoDetail', 'https://example.com/no-detail', ''], // blank detail cell
  [7, '007', 'https://example.com/007', '純伏特加'], // numeric cell: Sheets returns a Number
];

export const ELEMENT_MAPPING: SheetRow[] = [
  ['name', 'nameen', 'link', 'detail', 'recommendation'],
  ['琴酒', 'Gin', '', '', '2,3'], // 琴通寧, 馬丁尼
  ['伏特加', 'Vodka', '', '', '1,9'], // 白色俄羅斯; 9 is deliberately out of range
];

export const USER_ACTION: SheetRow[] = [['index', 'search', 'user', 'time']];

interface FetchRequest {
  method: string;
  headers: Record<string, string>;
  payload: string;
  muteHttpExceptions?: boolean;
}

export function loadBundle(options: HarnessOptions = {}): Harness {
  const code = readFileSync(BUNDLE_PATH, 'utf8');
  const sheets = options.sheets ?? { DRINK_LIST, ELEMENT_MAPPING, USER_ACTION };
  const properties = options.properties ?? DEFAULT_PROPERTIES;
  const recorded: Recorded = { fetches: [], writes: [], logs: [], objectLogs: [], loggerLogs: [] };

  const makeSheet = (name: string, rows: SheetRow[]) => ({
    getLastRow: () => rows.length,
    getSheetValues: (startRow: number, startCol: number, numRows: number, numCols: number) => {
      if (startRow < 1 || numRows < 1 || startRow - 1 + numRows > rows.length) {
        throw new Error(
          `Those rows are out of bounds (sheet "${name}" has ${rows.length} rows, ` +
            `asked for ${numRows} from row ${startRow})`
        );
      }
      return rows
        .slice(startRow - 1, startRow - 1 + numRows)
        .map((row) => Array.from({ length: numCols }, (_, i) => row[startCol - 1 + i] ?? ''));
    },
    getRange: (a1: string) => ({
      setValues: (values: SheetRow[]) => {
        recorded.writes.push({ sheet: name, a1, values });
      },
    }),
  });

  const frozenTime = options.now === undefined ? undefined : new Date(options.now).getTime();
  class FrozenDate extends Date {
    constructor(value?: number | string | Date) {
      super(value === undefined ? (frozenTime as number) : value);
    }

    static now(): number {
      return frozenTime as number;
    }
  }

  const record = (sink: string[]) => (message: unknown) => {
    sink.push(String(message));
    if (message !== null && typeof message === 'object') {
      recorded.objectLogs.push(message);
    }
  };

  const sandbox: Record<string, unknown> = {
    console: { log: record(recorded.logs) },
    Logger: { log: record(recorded.loggerLogs) },
    Date: frozenTime === undefined ? Date : FrozenDate,
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
          muteHttpExceptions: request.muteHttpExceptions,
        });
        const status = options.responseCode ?? 200;
        const body = options.responseBody ?? '{}';
        if ((status < 200 || status >= 300) && !request.muteHttpExceptions) {
          // Real UrlFetchApp.fetch throws unless muteHttpExceptions is set.
          throw new Error(
            `Request failed for ${url} returned code ${status}. Truncated server response: ${body}`
          );
        }
        return { getResponseCode: () => status, getContentText: () => body };
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

  const namespace = vm.runInContext('OverPartyLab', context) as { sheetService: SheetService };

  return {
    doPost: (event: unknown) => callGlobal('doPost', event),
    testPost: () => callGlobal('test_post'),
    testSend: () => callGlobal('test_send'),
    sheetService: namespace.sheetService,
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
