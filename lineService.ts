import logService from './logService';
import CONFIG from './config';
import properties from './properties';

interface MessageConfig {
    type: string;
    to?: string;
    replyToken?: string;
    messages: Array<{
        type: string;
        text?: string;
        altText?: string;
        template?: object;
    }>;
}

const lineService = {
    pushMsg: (config: MessageConfig): void => {
        try {
            logService.log('[LineService.pushMsg] Push message');

            const { type, to, replyToken, messages } = config;
            const payload: any = { messages };
            if (to) {
                payload.to = to;
            }
            if (replyToken) {
                payload.replyToken = replyToken;
            }

            const option = {
                'headers': {
                    'Content-Type': 'application/json; charset=UTF-8',
                    'Authorization': 'Bearer ' + properties.channelAccessToken()
                },
                'method': 'post' as GoogleAppsScript.URL_Fetch.HttpMethod,
                'payload': JSON.stringify(payload)
            };

            const response = UrlFetchApp.fetch(CONFIG.LINE.URL_LINE + type, option);
            const statusCode = response.getResponseCode();

            if (statusCode >= 200 && statusCode < 300) {
                logService.log('[LineService.pushMsg] Push message successfully');
            } else {
                logService.log(`[LineService.pushMsg] Failed with status: ${statusCode}`);
                logService.log(response.getContentText());
            }
        } catch (error) {
            logService.log('[LineService.pushMsg] Error: ' + error.message);
            throw error;
        }
    }
};

export default lineService;
