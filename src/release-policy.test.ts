import { expect, test } from 'bun:test';
import { assertRelease } from '../scripts/release-policy';

const paths = ['package.json', 'README.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'SUPPORT.md', 'CODE_OF_CONDUCT.md', 'dist/index.js', 'dist/index.cjs', 'dist/index.d.ts'];
test('release tag must match the Shield package version', () => {
  expect(() => assertRelease('@promptaudit/shield', '0.1.2', paths, 'v0.1.3')).toThrow();
});
test('all exported entry points must be present', () => {
  for (const missing of ['dist/index.js', 'dist/index.cjs', 'dist/index.d.ts']) expect(() => assertRelease('@promptaudit/shield', '0.1.2', paths.filter(path => path !== missing))).toThrow();
  expect(() => assertRelease('@promptaudit/shield', '0.1.2', paths)).not.toThrow();
});
test('source and unrelated artwork cannot enter the runtime package', () => {
  for (const path of ['src/index.ts', '.env', '.git/config', 'assets/banner.png']) expect(() => assertRelease('@promptaudit/shield', '0.1.2', [...paths, path])).toThrow();
});
