/**
 * Bundle entry point.
 *
 * Everything exported here is re-exposed as a global Apps Script function by
 * `scripts/build.mjs`, which is how Apps Script resolves webhook handlers and
 * functions run from the editor.
 */
export { default as doPost } from './app';
export { test_post, test_send } from './debug';

/**
 * Not an Apps Script entry point (the build only shims the three functions in
 * `ENTRY_POINTS`); exported so the test suite can assert the service contracts
 * — such as "a missing script property is rethrown, never swallowed" — that
 * `doPost` alone cannot reach independently.
 */
export { default as sheetService } from './sheetService';
