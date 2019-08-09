import lineService from './lineService';

import doPost from './app';
import { CONFIG_DEBUG } from './config';

function test_post() {
  const data = {
        events: [
          {
            message: {
              text: 'woody'
            },
            source: {
              userId: CONFIG_DEBUG.USERID
            }
          }
        ]
      };
  const testData = {
    postData: {
      contents: JSON.stringify(data)
    }
  };
  doPost(testData);
}

function test_send() {
  var messageConfig = {
    type: 'push',
    to: CONFIG_DEBUG.USERID,
    messages: [
      {
        'type': 'text',
        'text': 'test'
      }
    ]
  };
  lineService.pushMsg(messageConfig);
}



