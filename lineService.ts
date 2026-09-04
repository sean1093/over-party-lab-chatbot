import logService, { errorMessage } from './logService';
import CONFIG from './config';
import properties, { isConfigurationError } from './properties';
import type { Message } from './lineMessage';

interface SendResult {
  ok: boolean;
  status: number;
  body: string;
}

/**
 * POSTs to the Messaging API.
 *
 * `muteHttpExceptions` is essential: without it `UrlFetchApp.fetch` throws on
 * any non-2xx response and the LINE error body — which names the offending
 * property, e.g. `messages[0].template.actions: size must be between 1 and 4` —
 * is truncated into the exception message and effectively lost.
 */
const request = (endpoint: string, payload: object): SendResult => {
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    headers: { Authorization: 'Bearer ' + properties.channelAccessToken() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(CONFIG.LINE.URL_LINE + endpoint, options);
  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    logService.log(`[lineService.${endpoint}] Failed with status ${status}: ${body}`);
    return { ok: false, status, body };
  }

  logService.log(`[lineService.${endpoint}] Sent ${status}`);
  return { ok: true, status, body };
};

const lineService = {
  /**
   * Answers a webhook event with the Reply API.
   *
   * Replies are free of charge, whereas push messages count against the
   * monthly quota; and a reply token works for group and room events, where
   * `source.userId` may be absent.
   *
   * The token is single-use and expires about a minute after the webhook, so
   * this has to happen inside the same execution.
   */
  reply: (replyToken: string, messages: Message[]): SendResult => {
    try {
      return request('reply', { replyToken, messages });
    } catch (error) {
      // A missing script property must fail the execution, not degrade into a
      // silently unanswered webhook.
      if (isConfigurationError(error)) throw error;
      logService.log('[lineService.reply] Error: ' + errorMessage(error));
      return { ok: false, status: 0, body: errorMessage(error) };
    }
  },

  /**
   * Sends an unsolicited message. Counts against the monthly message quota, so
   * it is only used where no reply token exists (`debug.ts`).
   */
  push: (to: string, messages: Message[]): SendResult => {
    try {
      return request('push', { to, messages });
    } catch (error) {
      if (isConfigurationError(error)) throw error;
      logService.log('[lineService.push] Error: ' + errorMessage(error));
      return { ok: false, status: 0, body: errorMessage(error) };
    }
  },
};

export default lineService;
