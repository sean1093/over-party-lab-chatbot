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
        console.log(msg);
        Logger.log(msg);
    }
};

export default logService;
  