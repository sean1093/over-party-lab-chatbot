// service
import logService from './logService';
import lineService from './lineService';
import sheetService from './sheetService';
// config
import CONFIG from './config';
import WORDING from './wording';

// interface
interface ReceiveMessage {
    replyToken: string;
    userId: string;
    userMessage: string;
};

interface ReplyMessage {
    type: string;
    to: string;
    messages: Array<Message>;
};

interface Message {
    type: string;
    text: string;
    template?: object;
};

const addTextMessage = (msg, content) => {
    if (content) {
        msg.push({
            'type': 'text',
            'text': content
        });
    }
}

const getConfig = {
    singleReply: (id: string, msgs: Array<string> = []):ReplyMessage => {
        const messages = msgs.map((msg: string) => {
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
    normalReply: function(to, userMessage, link, detail) {
        const messages = [];
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
    buttonReply: function(target, nameList, userId, userMessage) { 
        const replyMessages = [];
        const recommandation = target.split(',');
    
        // create replyMessages
        for (let i = 0; i < recommandation.length; i++) {
            const index = parseInt(recommandation[i]);
            replyMessages.push({
                "type": "message",
                "label": nameList[index],
                "text": nameList[index]
            });
        }
        const displayText = WORDING.recommandation_head + userMessage + WORDING.recommandation_tail;
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

const parseLineMessage = (e: any): ReceiveMessage => {
    if (e && e.postData && e.postData.contents) {
        // convet message to JSON format
        const msg = JSON.parse(e.postData.contents);
        const event = msg.events[0];
        if (event) {
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
    return null;
};

// default apps script post method
export default function doPost(e) {
    logService.log('[doPost]');
    const { replyToken, userMessage, userId } = parseLineMessage(e);

    // save user action
    sheetService.save({
        search: userMessage,
        user: userId
    });

    // SELECT link, detail FROM DRINK_LIST WHERE name = name OR nameen = name
    const searchResult = sheetService.query({
        select: ['link', 'detail'],
        from: 'DRINK_LIST',
        where: {
            name: userMessage,
            nameen: userMessage
        }
    });

    let config = {};   
    const { link, detail } = searchResult; 
    if (link == null) {
        // if can't find cocktail, try to recommands
        // SELECT recommandation FROM ELEMENT_MAPPING WHERE name = name OR nameen = name  
        logService.log('[doPost] find recommands');   
        const recommands = sheetService.query({
            select: ['recommandation'],
            from: 'ELEMENT_MAPPING',
            where: {
                name: userMessage,
                nameen: userMessage
            }
        });
        
        // if there are nothing to recommand, return default not found wording
        if (recommands.recommandation == null) {    
            config = getConfig.normalReply(userId, userMessage, CONFIG.OVERPARTYLAB.IG, WORDING.not_found);
        } else {
            // retrun to ask type
            const nameList = sheetService.query({
                select: ['name'],
                from: 'DRINK_LIST',
                where: {}
            }); 
            config = getConfig.buttonReply(recommands.recommandation, nameList.name, userId, userMessage);
        }
    } else {
        // create normal reply
        config = getConfig.normalReply(userId, userMessage, link, detail);
    }
    logService.log([config]);
    lineService.pushMsg(config);
}
