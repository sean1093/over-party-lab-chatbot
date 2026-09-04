/**
 * Timestamp formatting for the analytics sheet.
 *
 * Hand-rolled rather than `Utilities.formatDate`, so the format does not depend
 * on the script's time zone setting and is deterministic in tests.
 */

/** Zero-pads to two digits, so timestamps sort lexicographically. */
const appendZero = (n: number): string => (n < 10 ? `0${n}` : n.toString());

const timeService = {
    /** The current local time as `YYYY-MM-DD HH:MM:SS`. */
    getCurrentTime: (): string => {
        const now = new Date();
        const date = [
            now.getFullYear(),
            appendZero(now.getMonth() + 1),
            appendZero(now.getDate())
        ].join('-');
        const time = [
            appendZero(now.getHours()),
            appendZero(now.getMinutes()),
            appendZero(now.getSeconds())
        ].join(':');
        return `${date} ${time}`;
    }
};

export default timeService;
