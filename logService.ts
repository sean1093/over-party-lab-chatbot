const logService = {
    log: (msg) => {
        if (msg instanceof Array) {
            msg.forEach((e) => {
                logService.printLog(e);
            });
        } else {
            logService.printLog(msg);
        }
    },
    printLog: (msg) => {
        console.log(msg);
        Logger.log(msg);
    }
};

export default logService;
  