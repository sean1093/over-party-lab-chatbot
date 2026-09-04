/**
 * Secret configuration, read from Apps Script script properties.
 *
 * Set them once per Apps Script project:
 *   Project Settings -> Script properties -> Add script property
 *
 *   LINE_CHANNEL_ACCESS_TOKEN  Messaging API channel access token
 *   SPREADSHEET_ID             ID of the spreadsheet holding the cocktail data
 *   DEBUG_USER_ID              LINE user ID used by `test_send()` (debug only)
 *
 * Every accessor is a function so that a missing property fails at the point of
 * use with a readable message, instead of throwing while the bundle loads.
 */
export const PROPERTY_KEYS = {
  channelAccessToken: 'LINE_CHANNEL_ACCESS_TOKEN',
  spreadsheetId: 'SPREADSHEET_ID',
  debugUserId: 'DEBUG_USER_ID',
} as const;

const read = (key: string): string => {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new Error(
      `Missing script property "${key}". Set it in Apps Script -> Project Settings -> Script properties.`
    );
  }
  return value;
};

const properties = {
  channelAccessToken: (): string => read(PROPERTY_KEYS.channelAccessToken),
  spreadsheetId: (): string => read(PROPERTY_KEYS.spreadsheetId),
  debugUserId: (): string => read(PROPERTY_KEYS.debugUserId),
};

export default properties;
