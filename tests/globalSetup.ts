import { execFileSync } from 'node:child_process';

/**
 * The suite asserts against the real build output, so build before running it.
 * That also makes `npm test` fail if the bundler itself breaks.
 */
export default function setup(): void {
  execFileSync('node', ['scripts/build.mjs'], { stdio: 'inherit' });
}
