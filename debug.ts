/**
 * Debug utilities for testing the chatbot locally
 *
 * Usage:
 * - test_post(): Simulates a POST request from LINE webhook
 * - test_send(): Sends a test message directly to LINE
 */

import lineService from './lineService';
import doPost from './app';
import properties from './properties';

/**
 * Test the doPost function by simulating a LINE webhook event.
 * Change the message text to test different scenarios.
 *
 * The lookup, the analytics row and the reply payload are all exercised, but
 * the reply itself fails with "Invalid reply token": real tokens only come
 * from real webhook deliveries. Check the execution log for the built reply.
 */
export function test_post(): void {
  const data = {
    events: [
      {
        message: {
          text: 'woody'  // Change this to test different cocktail names
        },
        source: {
          userId: properties.debugUserId()
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
export function test_send(): void {
  lineService.push(properties.debugUserId(), [
    {
      type: 'text',
      text: 'Hello! This is a test message from Over Party Lab Bot.'
    }
  ]);
}



