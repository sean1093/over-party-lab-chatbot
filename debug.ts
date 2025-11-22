/**
 * Debug utilities for testing the chatbot locally
 *
 * Usage:
 * - test_post(): Simulates a POST request from LINE webhook
 * - test_send(): Sends a test message directly to LINE
 */

import lineService from './lineService';
import doPost from './app';
import CONFIG from './config';

/**
 * Test the doPost function by simulating a LINE webhook event
 * Change the message text to test different scenarios
 */
function test_post(): void {
  const data = {
    events: [
      {
        message: {
          text: 'woody'  // Change this to test different cocktail names
        },
        source: {
          userId: CONFIG.CONFIG_DEBUG.USERID
        },
        replyToken: 'test-reply-token'
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

/**
 * Test sending a message directly to LINE
 * Useful for testing the LINE API connection
 */
function test_send(): void {
  const messageConfig = {
    type: 'push',
    to: CONFIG.CONFIG_DEBUG.USERID,
    messages: [
      {
        'type': 'text',
        'text': 'Hello! This is a test message from Over Party Lab Bot.'
      }
    ]
  };
  lineService.pushMsg(messageConfig);
}



