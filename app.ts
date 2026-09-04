// service
import logService, { errorMessage } from './logService';
import lineService from './lineService';
import sheetService from './sheetService';
import { isConfigurationError } from './properties';
// config
import CONFIG from './config';
import WORDING from './wording';

// interfaces
interface ReceiveMessage {
    replyToken: string;
    userId: string;
    userMessage: string;
}

interface ReplyMessage {
    type: string;
    to: string;
    messages: Array<Message>;
}

interface Message {
    type: string;
    text?: string;
    altText?: string;
    template?: object;
}

const addTextMessage = (msg: Array<Message>, content: string): void => {
    if (content) {
        msg.push({
            'type': 'text',
            'text': content
        });
    }
}

const getConfig = {
    singleReply: (id: string, msgs: Array<string> = []): ReplyMessage => {
        const messages = msgs.map((msg: string): Message => {
            const resultMsg: Message = {
                type: 'text',
                text: msg
            };
            return resultMsg;
        })
        return {
            type: 'push',
            to: id,
            messages: messages
        };
    },
    normalReply: (to: string, userMessage: string, link: string, detail: string): ReplyMessage => {
        const messages: Array<Message> = [];
        addTextMessage(messages, userMessage);
        addTextMessage(messages, detail);
        addTextMessage(messages, link);
        return {
            type: 'push',
            to,
            messages
        };
    },
    // return button message to let user feedback
    buttonReply: (target: string, nameList: Array<string>, userId: string, userMessage: string): ReplyMessage => {
        const replyMessages: Array<any> = [];
        const recommendation = target.split(',');

        // create replyMessages
        for (let i = 0; i < recommendation.length; i++) {
            const index = parseInt(recommendation[i]);
            if (nameList[index]) {
                replyMessages.push({
                    "type": "message",
                    "label": nameList[index],
                    "text": nameList[index]
                });
            }
        }
        const displayText = WORDING.recommendation_head + userMessage + WORDING.recommendation_tail;
        return {
            type: 'push',
            to: userId,
            messages: [{
                "type": "template",
                "altText": displayText,
                "template": {
                    "type": "buttons",
                    "title": displayText,
                    "text": WORDING.see_more,
                    "actions": replyMessages
                }
            }]
        };
    }
};

const parseLineMessage = (e: any): ReceiveMessage | null => {
    try {
        if (e && e.postData && e.postData.contents) {
            // convert message to JSON format
            const msg = JSON.parse(e.postData.contents);
            const event = msg.events[0];
            if (event && event.message && event.source) {
                const {
                    replyToken,
                    message: { text: userMessage },
                    source: { userId }
                } = event;
                const receiveMessage: ReceiveMessage = {
                    replyToken,
                    userId,
                    userMessage
                };
                return receiveMessage;
            }
        }
    } catch (error) {
        // No script property is read in this block, so no ConfigurationError
        // can originate here.
        logService.log('[parseLineMessage] Error: ' + errorMessage(error));
    }
    return null;
};

// default apps script post method
export default function doPost(e: any): void {
    try {
        logService.log('[doPost]');
        const parsedMessage = parseLineMessage(e);

        if (!parsedMessage) {
            logService.log('[doPost] Invalid message format');
            return;
        }

        const { userMessage, userId } = parsedMessage;

        // save user action
        sheetService.save({
            search: userMessage,
            user: userId
        });

        // SELECT link, detail FROM DRINK_LIST WHERE name = name OR nameen = name
        const searchResult: any = sheetService.query({
            select: ['link', 'detail'],
            from: 'DRINK_LIST',
            where: {
                name: userMessage,
                nameen: userMessage
            }
        });

        let config: ReplyMessage;
        const { link, detail } = searchResult;
        if (link == null) {
            // if can't find cocktail, try to recommend
            // SELECT recommendation FROM ELEMENT_MAPPING WHERE name = name OR nameen = name
            logService.log('[doPost] find recommendations');
            const recommendations: any = sheetService.query({
                select: ['recommendation'],
                from: 'ELEMENT_MAPPING',
                where: {
                    name: userMessage,
                    nameen: userMessage
                }
            });

            // if there are nothing to recommend, return default not found wording
            if (recommendations.recommendation == null) {
                config = getConfig.normalReply(userId, userMessage, CONFIG.OVERPARTYLAB.IG, WORDING.not_found);
            } else {
                // return to ask type
                const nameList: any = sheetService.query({
                    select: ['name'],
                    from: 'DRINK_LIST',
                    where: {}
                });
                config = getConfig.buttonReply(recommendations.recommendation, nameList.name, userId, userMessage);
            }
        } else {
            // create normal reply
            config = getConfig.normalReply(userId, userMessage, link, detail);
        }
        logService.log([config]);
        lineService.pushMsg(config);
    } catch (error) {
        // Surfaced as a failed execution so a misconfigured deployment is obvious.
        if (isConfigurationError(error)) throw error;
        logService.log('[doPost] Error: ' + errorMessage(error));
    }
}
