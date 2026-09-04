import logService, { errorMessage } from './logService';

/**
 * Remembers which webhook events have been handled, so a duplicate delivery is
 * answered once.
 *
 * LINE states that the same webhook event may reach the bot server more than
 * once — "by different reasons such as network routing problem", so this is not
 * limited to the redelivery feature — and that `webhookEventId` is how to detect
 * it. A second delivery of an already-answered event would otherwise append a
 * second analytics row and spend an execution on a reply token that is already
 * used.
 *
 * Best effort by construction, and deliberately so:
 *
 * - The script cache holds at most 1,000 items and may evict earlier, so this
 *   removes the duplicates that actually occur rather than guaranteeing
 *   exactly-once delivery.
 * - `get` then `put` is not atomic, so two *simultaneous* copies of one event
 *   can both pass. Serialising every event behind a lock would spend the
 *   2-second webhook response budget to close a gap far narrower than the one
 *   this shuts.
 * - Every failure errs towards answering the user: a cache error means the
 *   event is processed again, never dropped.
 */
const KEY_PREFIX = 'webhookEvent:';

/**
 * How long an id is remembered.
 *
 * LINE does not disclose the redelivery interval, and a redelivered event's
 * reply token is unusable 20 minutes after the event, so an hour covers any
 * duplicate that could still produce a reply while keeping the 1,000-item cache
 * from filling with ids nobody will see again.
 */
const RETENTION_SECONDS = 3600;

/** Whether this event has already been handled by an earlier delivery. */
export const wasHandled = (webhookEventId: string): boolean => {
    if (!webhookEventId) {
        // Nothing to key on: answering twice beats not answering at all.
        return false;
    }
    try {
        return CacheService.getScriptCache().get(KEY_PREFIX + webhookEventId) !== null;
    } catch (error) {
        logService.log('[eventDedupe] Cache unavailable: ' + errorMessage(error));
        return false;
    }
};

/**
 * Records that this event has been handled.
 *
 * Called *after* handling, never before: a delivery that failed part-way
 * through is exactly what redelivery exists to retry, so it must stay
 * unrecorded.
 */
export const markHandled = (webhookEventId: string): void => {
    if (!webhookEventId) {
        return;
    }
    try {
        CacheService.getScriptCache().put(KEY_PREFIX + webhookEventId, '1', RETENTION_SECONDS);
    } catch (error) {
        logService.log('[eventDedupe] Cache unavailable: ' + errorMessage(error));
    }
};
