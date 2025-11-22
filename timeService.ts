/**
 * Utility functions for time formatting and manipulation
 */

/**
 * Appends a leading zero to single-digit numbers
 * @param n - The number to format
 * @returns Formatted string with leading zero if needed
 */
const appendZero = (n: number): string => n < 10 ? `0${n}` : n.toString();

/**
 * Converts a Date object to a formatted string
 * @param d - The Date object to convert
 * @returns Formatted date string in YYYY-MM-DD HH:MM:SS format
 */
const timeConvertService = (d: Date): string => {
    const year = d.getFullYear();
    const month = appendZero(d.getMonth() + 1);
    const date = appendZero(d.getDate());
    const hour = appendZero(d.getHours());
    const min = appendZero(d.getMinutes());
    const sec = appendZero(d.getSeconds());
    const YYYY = year.toString();
    const MM = month.toString();
    const DD = date.toString();
    const HHMMSS = `${hour}:${min}:${sec}`;
    const formatTime = `${YYYY}-${MM}-${DD} ${HHMMSS}`;
    return formatTime;
};

const timeService = {
    /**
     * Gets the current time formatted as YYYY-MM-DD HH:MM:SS
     * @returns Current time string
     */
    getCurrentTime: (): string => timeConvertService(new Date()),

    /**
     * Gets the current year
     * @returns Current year as number
     */
    getCurrentYear: (): number => (new Date()).getFullYear()
};

export default timeService;
  