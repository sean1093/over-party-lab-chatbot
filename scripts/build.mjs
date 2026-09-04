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
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  BUILD_TARGET,
  GLOBAL_NAME,
  OUT_DIR,
  OUT_FILE,
  assertClaspRootDir,
  entryPointFooter,
} from './buildConfig.mjs';

const options = {
  entryPoints: ['main.ts'],
  outfile: OUT_FILE,
  bundle: true,
  format: 'iife',
  globalName: GLOBAL_NAME,
  target: BUILD_TARGET,
  platform: 'neutral',
  charset: 'utf8', // keep the Chinese wording readable in the Apps Script editor
  legalComments: 'none',
  footer: { js: entryPointFooter() },
  logLevel: 'info',
};

const claspRootDir = existsSync('.clasp.json')
  ? JSON.parse(await readFile('.clasp.json', 'utf8')).rootDir
  : undefined;
assertClaspRootDir(claspRootDir);

// Start from an empty directory: a stale artifact left behind by an earlier
// build would otherwise be pushed, or hide a step that stopped running.
await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });
await copyFile('appsscript.json', `${OUT_DIR}/appsscript.json`);

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log(`watching for changes — run \`clasp push --watch\` to upload ${OUT_DIR}/`);
} else {
  await build(options);
}
