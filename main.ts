/**
 * Bundle entry point.
 *
 * Everything exported here is re-exposed as a global Apps Script function by
 * `scripts/build.mjs`, which is how Apps Script resolves webhook handlers and
 * functions run from the editor.
 */
export { default as doPost } from './app';
export { test_post, test_send } from './debug';
