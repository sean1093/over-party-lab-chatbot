import { describe, expect, it } from 'vitest';
import { OUT_DIR, assertClaspRootDir, entryPointFooter, ENTRY_POINTS } from '../scripts/buildConfig.mjs';

describe('clasp rootDir guard', () => {
  it.each(['dist', './dist', 'dist/', './dist/'])('accepts %s', (rootDir) => {
    expect(() => assertClaspRootDir(rootDir)).not.toThrow();
  });

  it.each(['', '.', './', 'build', 'src', 'DIST', 'foo/dist'])(
    'rejects %s, which would push the TypeScript sources',
    (rootDir) => {
      expect(() => assertClaspRootDir(rootDir)).toThrowError(new RegExp(`must be "${OUT_DIR}"`));
    }
  );

  it('is a no-op when clasp is not configured, e.g. on a fresh clone or in CI', () => {
    expect(() => assertClaspRootDir(undefined)).not.toThrow();
  });
});

describe('entry point footer', () => {
  it('declares one top-level function per entry point', () => {
    const footer = entryPointFooter();
    for (const entryPoint of ENTRY_POINTS) {
      expect(footer).toMatch(new RegExp(`^function ${entryPoint}\\(`, 'm'));
    }
  });
});
