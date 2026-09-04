/**
 * Bundles the TypeScript sources into a single Apps Script file.
 *
 * clasp 3.x no longer transpiles TypeScript, so `clasp push` would upload the
 * raw `.ts` files (with `import`/`export`, which Apps Script cannot execute).
 * This script bundles everything into `dist/Code.js` as an IIFE and re-exports
 * the Apps Script entry points as real top-level functions.
 *
 * Usage: node scripts/build.mjs [--watch]
 */
import { build, context } from 'esbuild';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const OUT_DIR = 'dist';
const OUT_FILE = `${OUT_DIR}/Code.js`;
const GLOBAL_NAME = 'OverPartyLab';

/** Apps Script resolves entry points by global function name, so shim each one. */
const ENTRY_POINTS = ['doPost', 'test_post', 'test_send'];

const footer = [
  '',
  '// Apps Script entry points (resolved by global function name).',
  ...ENTRY_POINTS.map((name) => `function ${name}(e) { return ${GLOBAL_NAME}.${name}(e); }`),
  '',
].join('\n');

/**
 * `clasp push` uploads whatever lives in rootDir. If rootDir still points at the
 * repository root, the raw `.ts` sources get pushed and the deployment breaks,
 * which is exactly the failure this build step exists to prevent.
 */
async function assertClaspRootDir() {
  if (!existsSync('.clasp.json')) return; // not configured yet (e.g. CI) — nothing to check
  const claspConfig = JSON.parse(await readFile('.clasp.json', 'utf8'));
  const rootDir = claspConfig.rootDir ?? '';
  if (rootDir.replace(/^\.\//, '').replace(/\/$/, '') !== OUT_DIR) {
    throw new Error(
      `.clasp.json has rootDir="${rootDir}" but must be "${OUT_DIR}", ` +
        'otherwise `clasp push` uploads the untranspiled TypeScript sources.'
    );
  }
}

const options = {
  entryPoints: ['main.ts'],
  outfile: OUT_FILE,
  bundle: true,
  format: 'iife',
  globalName: GLOBAL_NAME,
  target: 'es2019', // Apps Script V8
  platform: 'neutral',
  charset: 'utf8', // keep the Chinese wording readable in the Apps Script editor
  legalComments: 'none',
  footer: { js: footer },
  logLevel: 'info',
};

await assertClaspRootDir();
await mkdir(OUT_DIR, { recursive: true });
await copyFile('appsscript.json', `${OUT_DIR}/appsscript.json`);

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log(`watching for changes — run \`clasp push --watch\` to upload ${OUT_DIR}/`);
} else {
  await build(options);
}
