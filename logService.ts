export const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

const logService = {
    log: (msg: unknown) => {
        if (msg instanceof Array) {
            msg.forEach((e) => {
                logService.printLog(e);
            });
        } else {
            logService.printLog(msg);
        }
    },
    printLog: (msg: unknown) => {
        // Both Apps Script loggers accept `string | object`; anything else
        // (numbers, undefined) has to be rendered before it is passed on.
        const payload: string | object = typeof msg === 'object' && msg !== null ? msg : String(msg);
        console.log(payload);
        Logger.log(payload);
    }
};

export default logService;
  