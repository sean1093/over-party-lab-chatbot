import logService from './logService';
import CONFIG from './config';

const lineService = {
    pushMsg: (config) => {
        logService.log('[LineService.pushMsg] Push message');

        const { type, to, replyToken, messages } = config;
        const payload = { messages };
        if (to) {
            payload.to = to;
        }
        if (replyToken) {
            payload.replyToken = replyToken; 
        }
      
        const option = {
            'headers': {
                'Content-Type': 'application/json; charset=UTF-8',
                'Authorization': 'Bearer ' + CONFIG.LINE.CHANNEL_ACCESS_TOKEN
            },
            'method': 'post',
            'payload': JSON.stringify(payload)
        };
      
        UrlFetchApp.fetch(CONFIG.LINE.URL_LINE + type, option);
        logService.log('[LineService.pushMsg] Push message successfully');
    }
};

export default lineService;
