import logService, { errorMessage } from './logService';
import properties, { isConfigurationError } from './properties';
import { LINE_LIMITS } from './lineMessage';
import type { Message } from './lineMessage';

/** Messaging API base URL; the endpoint name ('reply' / 'push') is appended. */
const API_BASE_URL = 'https://api.line.me/v2/bot/message/';

interface SendResult {
  ok: boolean;
  status: number;
  body: string;
}

/**
 * POSTs to the Messaging API.
 *
 * `muteHttpExceptions` is essential: without it `UrlFetchApp.fetch` throws on a
 * failure status (4xx/5xx) and the LINE error body — which names the offending
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

  const response = UrlFetchApp.fetch(API_BASE_URL + endpoint, options);
  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    logService.log(`[lineService.${endpoint}] Failed with status ${status}: ${body}`);
    return { ok: false, status, body };
  }

  logService.log(`[lineService.${endpoint}] Sent ${status}`);
  return { ok: true, status, body };
};

/**
 * Enforces the 1..5 message objects the API requires. An empty array is a
 * caller bug, but sending it would waste the single-use reply token on a 400.
 */
const sendable = (endpoint: string, messages: Message[]): Message[] | null => {
  if (messages.length === 0) {
    logService.log(`[lineService.${endpoint}] Nothing to send`);
    return null;
  }
  if (messages.length > LINE_LIMITS.messagesPerRequest) {
    logService.log(
      `[lineService.${endpoint}] Trimmed ${messages.length} messages to ` +
        `${LINE_LIMITS.messagesPerRequest}`
    );
    return messages.slice(0, LINE_LIMITS.messagesPerRequest);
  }
  return messages;
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
    const payload = sendable('reply', messages);
    if (!payload) return { ok: false, status: 0, body: 'no messages' };
    try {
      return request('reply', { replyToken, messages: payload });
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
    const payload = sendable('push', messages);
    if (!payload) return { ok: false, status: 0, body: 'no messages' };
    try {
      return request('push', { to, messages: payload });
    } catch (error) {
      if (isConfigurationError(error)) throw error;
      logService.log('[lineService.push] Error: ' + errorMessage(error));
      return { ok: false, status: 0, body: errorMessage(error) };
    }
  },
};

export default lineService;
