import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export function assertRelease(name: string, version: string, paths: string[], tag?: string) {
  if (!['@promptaudit/mcp', '@promptaudit/shield'].includes(name)) throw new Error('Unexpected package');
  if (tag !== undefined && tag !== `v${version}`) throw new Error('Release tag does not match package version');
  const documents = new Set(['package.json', 'README.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'SUPPORT.md', 'CODE_OF_CONDUCT.md']);
  for (const path of paths) {
    const output = name === '@promptaudit/mcp' ? path === 'dist/cli.js' : /^dist\/[A-Za-z0-9_/-]+\.(?:js|cjs|d\.ts)$/.test(path);
    if (!documents.has(path) && !output) throw new Error(`Unexpected artifact file: ${path}`);
  }
  const entryPoints = name === '@promptaudit/mcp' ? ['dist/cli.js'] : ['dist/index.js', 'dist/index.cjs', 'dist/index.d.ts'];
  for (const required of ['package.json', 'LICENSE', 'README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'SUPPORT.md', 'CODE_OF_CONDUCT.md', ...entryPoints]) {
    if (!paths.includes(required)) throw new Error(`Missing artifact file: ${required}`);
  }
}

if (process.argv[1]?.endsWith('/release-policy.ts')) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { name: string; version: string; dependencies?: Record<string, unknown> };
  if (Object.keys(pkg.dependencies ?? {}).length > 0) throw new Error('Runtime dependencies are forbidden');
  if (pkg.name === '@promptaudit/mcp') {
    const runtime = spawnSync('node', ['dist/cli.js', '--version'], { encoding: 'utf8' });
    if (runtime.status !== 0 || runtime.stdout.trim() !== pkg.version) throw new Error('Executable version does not match package version');
  }
  const pack = spawnSync('npm', ['pack', '--json'], { encoding: 'utf8' });
  if (pack.status !== 0) throw new Error('npm pack failed');
  const results = JSON.parse(pack.stdout) as Array<{ filename: string; files: Array<{ path: string }> }>;
  const result = results[0];
  if (!result) throw new Error('No artifact produced');
  const tar = spawnSync('tar', ['-tzf', result.filename], { encoding: 'utf8' });
  if (tar.status !== 0) throw new Error('Cannot inspect actual artifact');
  const paths = tar.stdout.trim().split('\n').map(path => path.replace(/^package\//, '')).sort();
  const declared = result.files.map(file => file.path).sort();
  if (JSON.stringify(paths) !== JSON.stringify(declared)) throw new Error('Tarball differs from npm manifest');
  assertRelease(pkg.name, pkg.version, paths, process.env['RELEASE_TAG']);
  console.log(`Verified actual artifact: ${pkg.name}@${pkg.version}, ${paths.length} files`);
}
