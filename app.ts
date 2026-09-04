// service
import logService, { errorMessage } from './logService';
import lineService from './lineService';
import sheetService from './sheetService';
import { isConfigurationError } from './properties';
// config
import CONFIG from './config';
import WORDING from './wording';
import { recommendationMessage, textMessages } from './lineMessage';
import type { Message } from './lineMessage';

interface ReceiveMessage {
    replyToken: string;
    userId: string;
    userMessage: string;
}

interface WebhookEvent {
    type?: string;
    replyToken?: string;
    message?: { type?: string; text?: string };
    source?: { userId?: string };
}

/** `e.postData.contents`, or null when the request carries no body. */
const requestBody = (e: unknown): string | null => {
    if (!e || typeof e !== 'object' || !('postData' in e)) return null;
    const postData = e.postData;
    if (!postData || typeof postData !== 'object' || !('contents' in postData)) return null;
    return typeof postData.contents === 'string' ? postData.contents : null;
};

const parseLineMessage = (e: unknown): ReceiveMessage | null => {
    try {
        const contents = requestBody(e);
        if (contents) {
            // Shape asserted rather than validated: the payload comes from the
            // LINE platform and every field is read defensively below.
            const body = JSON.parse(contents) as { events?: WebhookEvent[] };
            const event = body.events?.[0];
            if (event && event.message && event.source) {
                const { replyToken, message, source } = event;
                if (!replyToken) {
                    // Standby-mode events carry no reply token. Manufacturing
                    // an empty one only spends the execution on a 400.
                    logService.log('[parseLineMessage] event has no reply token');
                    return null;
                }
                // A non-text message (sticker, image) carries no `text`. Today
                // that undefined flows through into the lookup and the
                // analytics row; #14 is what filters those events out.
                const userMessage = message.text as string;
                return {
                    replyToken,
                    userId: source.userId ?? '',
                    userMessage
                };
            }
        }
    } catch (error) {
        // No script property is read in this block, so no ConfigurationError
        // can originate here.
        logService.log('[parseLineMessage] Error: ' + errorMessage(error));
    }
    return null;
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

// default apps script post method
export default function doPost(e: unknown): void {
    try {
        logService.log('[doPost]');
        const parsedMessage = parseLineMessage(e);

        if (!parsedMessage) {
            logService.log('[doPost] Invalid message format');
            return;
        }

        const { replyToken, userMessage, userId } = parsedMessage;

        // save user action
        sheetService.save({
            search: userMessage,
            user: userId
        });

        const messages = buildReply(userMessage);
        logService.log(messages);
        lineService.reply(replyToken, messages);
    } catch (error) {
        // Surfaced as a failed execution so a misconfigured deployment is obvious.
        if (isConfigurationError(error)) throw error;
        logService.log('[doPost] Error: ' + errorMessage(error));
    }
}
