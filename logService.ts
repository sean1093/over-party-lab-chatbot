/** Anything the Apps Script logger accepts. */
export type Loggable = string | object;

export const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

const logService = {
    /**
     * Writes one line per entry to the execution log.
     *
     * `console.log` only: on the V8 runtime it and the legacy `Logger.log` both
     * write to Cloud Logging, so calling both duplicated every line.
     */
    log: (msg: Loggable) => {
        if (Array.isArray(msg)) {
            msg.forEach((entry) => console.log(entry));
        } else {
            console.log(msg);
        }
    }
};

export default logService;
