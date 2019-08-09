import CONFIG from './config';
import logService from './logService';
import lineService from './lineService';
import sheetService from './sheetService';


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

const getConfig = {
    singleReply: (id: string, msgs: Array<string> = []):ReplyMessage => {
        const messages = msgs.map((msg: string) => {
            const resultMsg:Message = {
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
    normalReply: function(userId, userMessage, link, detail) {
        return {
            type: 'push',
            to: userId,
            messages: createMessage(userMessage, link, detail)
        };
    },
  buttonReply: function(target, nameList, userId, userMessage) {
    //logService.log(['--buttonReply--']);
    //logService.log([target]);   
    var replyMessages = [];
    var recommandation = target.split(',');
 
    // create replyMessages
    for (var i = 0; i < recommandation.length; i++) {
      var index = parseInt(recommandation[i]);
      replyMessages.push({
        "type": "message",
        "label": nameList[index],
        "text": nameList[index]
      });
    }
    //logService.log([replyMessages]);
    var displayText = '推薦幾種用'+userMessage+'作成的調酒：';
    return {
      type: 'push',
      to: userId,
      messages: [{
        "type": "template",
        "altText": displayText,
        "template": {
           "type": "buttons",
           "title": displayText,
           "text": "選一種看更多",
           "actions": replyMessages
         }
       }]
    };  
  }
};

export default function doPost(e) {
    logService.log('[doPost]'); 
    var config = {};
    
    if (e.postData && e.postData.contents) {
        var msg = JSON.parse(e.postData.contents);
        if (msg.events[0]) {
        var replyToken =  msg.events[0].replyToken;
        var userMessage = msg.events[0].message.text;
        var userId = msg.events[0].source && msg.events[0].source.userId;
        logService.log([userMessage, userId]);
        
        // save user action
        sheetService.save({
            search: userMessage,
            user: userId
        });
        
        // lineService.pushMsg(getConfig.singleReply(userId, '正在為您搜尋...'));

        // SELECT link, detail FROM DRINK_LIST WHERE name = name OR nameen = name
        const result = sheetService.query({
            select: ['link', 'detail'],
            from: 'DRINK_LIST',
            where: {
            name: userMessage,
            nameen: userMessage
            }
        });
        
        let { link, detail } = result;
        config = getConfig.normalReply(userId, userMessage, link, detail);
        
        if (link == null) {
            // if can't find cocktail, try to recommands
            // SELECT recommandation FROM ELEMENT_MAPPING WHERE name = name OR nameen = name     
            var recommands = sheetService.query({
            select: ['recommandation'],
            from: 'ELEMENT_MAPPING',
            where: {
                name: userMessage,
                nameen: userMessage
            }
            });
            
            logService.log(['recommands', recommands]);
            if (recommands.recommandation == null) {
            detail = '找不到您要的調酒，不如來逛逛我們的頻道吧！';
            link = CONFIG.OVERPARTYLAB.IG;       
            config = getConfig.normalReply(userId, userMessage, link, detail);
            } else {
            // ask type
            var nameList = sheetService.query({
                select: ['name'],
                from: 'DRINK_LIST'
            }); 
            config = getConfig.buttonReply(recommands.recommandation, nameList.name, userId, userMessage);
            }
        } 
        logService.log([config]);
        lineService.pushMsg(config);
        }
    }
}

function replyMessage(userMessage, userId, link, detail) {
      var config = {
          type: 'push',
          to: userId,
          //to: 'U56ac886431fc02e3447a040fc4fd07e0',
          messages: createMessage(userMessage, link, detail)
        };
      lineService.pushMsg(config);
}

function createMessage(userMessage, link, detail) {
  var returnMsg = [{
      'type': 'text',
      'text': userMessage
  }];
  if (detail) {
    returnMsg.push({
      'type': 'text',
      'text': detail
    });
  }
  if (link) {
    returnMsg.push({
      'type': 'text',
      'text': link
    });
  } 
  return returnMsg;
}
