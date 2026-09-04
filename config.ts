/**
 * Non-secret configuration.
 *
 * Secrets (channel access token, spreadsheet ID, debug user ID) are NOT stored
 * here — they live in Apps Script's script properties, see `properties.ts`.
 * That keeps this file safe to commit and keeps credentials out of the source
 * that `clasp push` uploads.
 */
const CONFIG = {
  LINE: {
    // Messaging API base URL; the endpoint name ('reply' / 'push') is appended.
    URL_LINE: 'https://api.line.me/v2/bot/message/',
  },
  SHEET_NAMES: {
    DRINK_LIST: 'DRINK_LIST',
    ELEMENT_MAPPING: 'ELEMENT_MAPPING',
    USER_ACTION: 'USER_ACTION',
  },
  // 1-based column positions, applied to every sheet tab.
  COLUMN_KEY_MAPPING: {
    name: 1, // Column A: name (Chinese)
    nameen: 2, // Column B: name (English)
    link: 3, // Column C: link to recipe/video
    detail: 4, // Column D: description
    recommendation: 5, // Column E: recommendations (ELEMENT_MAPPING only)
  },
  OVERPARTYLAB: {
    IG: 'https://www.instagram.com/over.party.lab/',
  },
} as const;

export type ColumnKey = keyof typeof CONFIG.COLUMN_KEY_MAPPING;

export default CONFIG;
