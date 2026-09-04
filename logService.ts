/** Anything both Apps Script loggers accept. */
export type Loggable = string | object;

export const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

const logService = {
    log: (msg: Loggable) => {
        if (Array.isArray(msg)) {
            msg.forEach((entry) => {
                logService.printLog(entry);
            });
        } else {
            logService.printLog(msg);
        }
    },
    printLog: (msg: Loggable) => {
        console.log(msg);
        Logger.log(msg);
    }
};

export default logService;
