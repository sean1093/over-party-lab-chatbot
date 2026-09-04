/**
 * Build configuration shared by `scripts/build.mjs` and the test suite.
 *
 * Kept free of side effects so the contract it encodes (V8-compatible target,
 * the set of Apps Script entry points, the required clasp rootDir) can be
 * asserted directly instead of being inferred from the bundle text.
 */

/** Directory `clasp push` uploads; must match `.clasp.json`'s rootDir. */
export const OUT_DIR = 'dist';

export const OUT_FILE = `${OUT_DIR}/Code.js`;

/** Name of the IIFE global the bundle assigns itself to. */
export const GLOBAL_NAME = 'OverPartyLab';

/**
 * Apps Script V8 supports ES2019. Raising this silently produces a bundle the
 * runtime rejects at parse time, i.e. a bot that stops answering entirely.
 */
export const BUILD_TARGET = 'es2019';

/** Apps Script resolves handlers by global function name, so each needs a shim. */
export const ENTRY_POINTS = ['doPost', 'test_post', 'test_send'];

export function entryPointFooter() {
  return [
    '',
    '// Apps Script entry points (resolved by global function name).',
    ...ENTRY_POINTS.map((name) => `function ${name}(e) { return ${GLOBAL_NAME}.${name}(e); }`),
    '',
  ].join('\n');
}

/**
 * `clasp push` uploads whatever lives in rootDir. If rootDir points at the
 * repository root, the raw `.ts` sources get pushed and the deployment breaks —
 * exactly the failure this build step exists to prevent.
 *
 * `undefined` means clasp is not configured here (fresh clone, CI): nothing to
 * check, and nothing to push either, since clasp itself refuses to run.
 */
export function assertClaspRootDir(rootDir) {
  if (rootDir === undefined) return;
  const normalized = String(rootDir).replace(/^\.\//, '').replace(/\/$/, '');
  if (normalized !== OUT_DIR) {
    throw new Error(
      `.clasp.json has rootDir="${rootDir}" but must be "${OUT_DIR}", ` +
        'otherwise `clasp push` uploads the untranspiled TypeScript sources.'
    );
  }
}
