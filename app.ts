// service
import logService, { errorMessage } from './logService';
import lineService from './lineService';
import sheetService from './sheetService';
import properties, { isConfigurationError } from './properties';
// config
import CONFIG from './config';
import WORDING from './wording';
import { recommendationMessage, textMessages } from './lineMessage';
import type { Message } from './lineMessage';

interface TextMessageEvent {
    replyToken: string;
    userId: string;
    userMessage: string;
}

/** Narrows an unvalidated value to an object whose fields can be read. */
const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;

/** A field of the webhook payload, or '' when it is absent or not a string. */
const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Zero-width characters: `String#trim` leaves them, since they are format
 * characters rather than whitespace, so a message that looks empty to the user
 * would otherwise be searched for.
 */
const ZERO_WIDTH = /[\u200b-\u200d\ufeff]/g;

/** `e.postData.contents`, or null when the request carries no body. */
const requestBody = (e: unknown): string | null => {
    if (!e || typeof e !== 'object' || !('postData' in e)) return null;
    const postData = e.postData;
    if (!postData || typeof postData !== 'object' || !('contents' in postData)) return null;
    return typeof postData.contents === 'string' ? postData.contents : null;
};

/** A query-string parameter of the request, or '' when absent. */
const requestParameter = (e: unknown, name: string): string => {
    const parameter = asRecord(asRecord(e)?.parameter);
    return asString(parameter?.[name]);
};

/**
 * One webhook delivery: who it was addressed to, and what happened.
 *
 * LINE may batch several events into a single request, and sends an empty
 * array to verify the webhook URL.
 */
interface WebhookDelivery {
    destination: string;
    events: unknown[];
}

const parseDelivery = (e: unknown): WebhookDelivery => {
    try {
        const contents = requestBody(e);
        if (!contents) {
            return { destination: '', events: [] };
        }
        const body = asRecord(JSON.parse(contents));
        const events = body?.events;
        if (Array.isArray(events)) {
            return { destination: asString(body?.destination), events };
        }
        // Distinguishable from the empty array LINE verifies the URL with: a
        // body this bot cannot read at all is a platform change, not a ping.
        logService.log('[parseDelivery] body carries no event array');
        return { destination: asString(body?.destination), events: [] };
    } catch (error) {
        // No script property is read in this block, so no ConfigurationError
        // can originate here.
        logService.log('[parseDelivery] Error: ' + errorMessage(error));
        return { destination: '', events: [] };
    }
};

/**
 * A text message this bot can answer, or null.
 *
 * Every field is validated rather than assumed: the payload is external input,
 * and a sticker or image event carries a `message` object with no `text`, which
 * used to reach the sheet as an empty search and an empty analytics row.
 */
const textMessageEvent = (raw: unknown): TextMessageEvent | null => {
    const event = asRecord(raw);
    if (!event) {
        logService.log(`[textMessageEvent] skipping ${typeof raw} entry`);
        return null;
    }

    const message = asRecord(event.message);
    const eventType = asString(event.type);
    const messageType = asString(message?.type);
    if (eventType !== 'message' || messageType !== 'text') {
        // `messageEdited` also carries a text message and a reply token, so the
        // event type has to be checked, not just the message type.
        logService.log(
            `[textMessageEvent] skipping ${eventType || 'unknown'}/${messageType || '-'}`
        );
        return null;
    }

    if (asString(event.mode) === 'standby') {
        // A standby-channel event belongs to the linked module, which is
        // answering the user; replying would talk over it. Such events also
        // arrive without a reply token, so this is belt and braces.
        logService.log('[textMessageEvent] skipping standby event');
        return null;
    }

    const replyToken = asString(event.replyToken).trim();
    if (!replyToken) {
        logService.log('[textMessageEvent] event has no reply token');
        return null;
    }

    const userMessage = asString(message?.text).replace(ZERO_WIDTH, '').trim();
    if (!userMessage) {
        logService.log('[textMessageEvent] empty message text');
        return null;
    }

    // `source` is absent from nothing LINE sends, but `source.userId` is absent
    // from group and room events the user has not consented to; those still get
    // an answer, with an empty user in the analytics row.
    return { replyToken, userId: asString(asRecord(event.source)?.userId), userMessage };
};

/**
 * Resolves a recommendation cell into cocktail names.
 *
 * Cells hold comma-separated 0-based indices into the DRINK_LIST name column.
 * Out-of-range and non-numeric entries are dropped: a stale index must never
 * put an `undefined` label into a button.
 */
const recommendedNames = (recommendation: string, nameList: string[]): string[] =>
    recommendation
        .split(',')
        .map((entry) => nameList[parseInt(entry, 10)])
        // Blank names are dropped by the message builder, which owns payload
        // validity; here only missing indices have to be filtered out.
        .filter((name): name is string => Boolean(name));

/** The reply for one incoming text message. */
const buildReply = (userMessage: string): Message[] => {
    // SELECT link, detail FROM DRINK_LIST WHERE name = userMessage OR nameen = userMessage
    const drink = sheetService.findRow(
        CONFIG.SHEET_NAMES.DRINK_LIST,
        { name: userMessage, nameen: userMessage },
        ['link', 'detail']
    );

    if (drink) {
        // Matched: reply even when a cell is empty — a cocktail is often added
        // before its video exists, and its description is still the best
        // answer. `textMessages` drops the empty parts.
        return textMessages(userMessage, drink.detail, drink.link);
    }

    // if we can't find the cocktail, try to recommend by ingredient
    logService.log('[doPost] find recommendations');
    const ingredient = sheetService.findRow(
        CONFIG.SHEET_NAMES.ELEMENT_MAPPING,
        { name: userMessage, nameen: userMessage },
        ['recommendation']
    );

    if (ingredient?.recommendation) {
        const names = recommendedNames(
            ingredient.recommendation,
            sheetService.columnValues(CONFIG.SHEET_NAMES.DRINK_LIST, 'name')
        );
        const template = recommendationMessage(names, userMessage);
        // `template` is null when every index was stale: fall through instead
        // of sending a template with no buttons, which LINE rejects.
        if (template) {
            return [template];
        }
    }

    return textMessages(userMessage, WORDING.not_found, CONFIG.OVERPARTYLAB.IG);
};

/**
 * Answers one text message event.
 *
 * The reply goes first: the reply token expires about a minute after the
 * webhook, and the analytics write contends for a script lock. Recording the
 * search must never be what costs the user their answer.
 */
const handleTextMessage = ({ replyToken, userId, userMessage }: TextMessageEvent): void => {
    const messages = buildReply(userMessage);
    logService.log(messages);
    lineService.reply(replyToken, messages);

    // save user action
    sheetService.save({ search: userMessage, user: userId });
};

/** `{"status":"ok"}` as JSON, the acknowledgement every delivery gets. */
const acknowledge = (): GoogleAppsScript.Content.TextOutput =>
    ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(
        ContentService.MimeType.JSON
    );

/**
 * Apps Script web app entry point for the LINE webhook.
 *
 * Answers 200 for every payload LINE can send: the platform redelivers on a
 * non-2xx and may suspend a webhook that keeps failing, so an unparseable body,
 * an unanswerable event or a rejected request must not report failure.
 *
 * The one exception is a missing script property, which is rethrown below: a
 * deployment that answers "not found" to everyone must not look healthy.
 *
 * Authenticity is checked twice before anything is read or written. Apps Script
 * web apps cannot see request headers, so LINE's `x-line-signature` is not
 * available here — the webhook URL carries a shared secret instead, and the
 * payload's `destination` has to be this bot. Both are unguessable, so a
 * forged request cannot reach the spreadsheet or the Messaging API.
 */
export default function doPost(e: unknown): GoogleAppsScript.Content.TextOutput {
    logService.log('[doPost]');

    if (requestParameter(e, 'token') !== properties.webhookToken()) {
        // No detail in the log and no detail in the response: an unauthenticated
        // caller learns nothing beyond "something answered".
        logService.log('[doPost] rejected: webhook token mismatch');
        return acknowledge();
    }

    const { destination, events } = parseDelivery(e);
    if (destination !== properties.botUserId()) {
        logService.log('[doPost] rejected: destination is not this bot');
        return acknowledge();
    }

    for (const event of events) {
        try {
            const message = textMessageEvent(event);
            if (message) {
                handleTextMessage(message);
            }
        } catch (error) {
            // Surfaced as a failed execution so a misconfigured deployment is
            // obvious rather than silently answering every user "not found".
            if (isConfigurationError(error)) throw error;
            // One bad event must not abort the rest of the batch.
            logService.log('[doPost] Error: ' + errorMessage(error));
        }
    }
    return acknowledge();
}
