/**
 * Secret configuration, read from Apps Script script properties.
 *
 * Set them once per Apps Script project:
 *   Project Settings -> Script properties -> Add script property
 *
 *   LINE_CHANNEL_ACCESS_TOKEN  Messaging API channel access token
 *   SPREADSHEET_ID             ID of the spreadsheet holding the cocktail data
 *   WEBHOOK_TOKEN              shared secret appended to the webhook URL
 *   BOT_USER_ID                this bot's own user ID, as sent in `destination`
 *   DEBUG_USER_ID              LINE user ID used by `test_send()` (debug only)
 *
 * Every accessor is a function so that a missing property fails at the point of
 * use with a readable message, instead of throwing while the bundle loads.
 */
export const PROPERTY_KEYS = {
  channelAccessToken: 'LINE_CHANNEL_ACCESS_TOKEN',
  spreadsheetId: 'SPREADSHEET_ID',
  webhookToken: 'WEBHOOK_TOKEN',
  botUserId: 'BOT_USER_ID',
  debugUserId: 'DEBUG_USER_ID',
} as const;

/**
 * Thrown when a required script property is missing.
 *
 * Deliberately distinct from runtime errors: services that swallow errors to
 * keep the bot answering MUST rethrow this one, otherwise a deployment with an
 * unset property answers "not found" to every user while looking healthy.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export const isConfigurationError = (error: unknown): boolean =>
  error instanceof ConfigurationError;

const read = (key: string): string => {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new ConfigurationError(
      `Missing script property "${key}". Set it in Apps Script -> Project Settings -> Script properties.`
    );
  }
  return value;
};

const properties = {
  channelAccessToken: (): string => read(PROPERTY_KEYS.channelAccessToken),
  spreadsheetId: (): string => read(PROPERTY_KEYS.spreadsheetId),
  webhookToken: (): string => read(PROPERTY_KEYS.webhookToken),
  botUserId: (): string => read(PROPERTY_KEYS.botUserId),
  debugUserId: (): string => read(PROPERTY_KEYS.debugUserId),
};

export default properties;
