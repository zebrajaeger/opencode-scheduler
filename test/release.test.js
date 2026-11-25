import { expect, test } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import { validateMetadata, validateTag, validateGit, archiveFiles, validateFiles,
  integrity, verifyImport, versionAvailable, verifyRegistryMetadata } from '../scripts/release.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const required = ['dist/index.js', 'dist/index.d.ts', 'dist/scheduler.js', 'dist/scheduler.d.ts',
  'dist/tools.js', 'dist/tools.d.ts', 'dist/opencode-adapter.js', 'dist/opencode-adapter.d.ts'];
function files() {
  return new Map([['package.json', Buffer.from(JSON.stringify(pkg))], ['README.md', Buffer.from('Readme')],
    ['LICENSE', readFileSync('LICENSE')], ...required.map(name => [name, Buffer.from('export default {};')])]);
}
function tar(entries) {
  const blocks = [];
  for (const [name, data, type = '0'] of entries) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136); h.fill(32, 148, 156); h.write(type, 156);
    h.write('ustar\0', 257); h.write('00', 263);
    h.write(h.reduce((s, n) => s + n, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

test('release identity requires canonical matching stable package and lockfile metadata', () => {
  expect(validateTag(`v${pkg.version}`, pkg, lock)).toBe(pkg.version);
  for (const tag of ['1.0.0', 'v01.0.0', 'v0.1.0-beta.1', 'v0.1.0+build', 'v9.0.0', 'v0.1.0; echo unsafe']) {
    expect(() => validateTag(tag, pkg, lock)).toThrow();
  }
  for (const changed of [{ ...pkg, name: 'other' }, { ...pkg, private: true }, { ...pkg, license: 'other' },
    { ...pkg, publishConfig: { access: 'restricted' } }, { ...pkg, exports: {} }]) {
    expect(() => validateMetadata(changed, lock)).toThrow();
  }
  expect(() => validateMetadata(pkg, { ...lock, version: '9.0.0' })).toThrow('Lockfile');
  expect(() => validateMetadata(pkg, { ...lock, packages: { '': { ...lock.packages[''], name: 'other' } } })).toThrow('Lockfile');
});

test('release ancestry validates annotated tags and refuses unrelated commits or unsafe input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scheduler-git-test-'));
  const git = args => execFileSync('git', args, { cwd: dir, stdio: 'pipe', encoding: 'utf8' }).trim();
  git(['init', '--quiet']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
  git(['commit', '--allow-empty', '-m', 'base']);
  git(['update-ref', 'refs/remotes/origin/master', 'HEAD']);
  git(['tag', '-a', 'v0.1.0', '-m', 'release']);
  expect(validateGit('v0.1.0', dir)).toBe(git(['rev-parse', 'HEAD']));
  git(['commit', '--allow-empty', '-m', 'unmerged']); git(['tag', 'v0.2.0']);
  expect(() => validateGit('v0.2.0', dir)).toThrow();
  expect(() => validateGit('v0.1.0', dir)).toThrow('Checkout');
  expect(() => validateGit('--help; echo unsafe', dir)).toThrow('Unsafe');
});

test('archive reader checks checksum paths duplicate entries and link types before extraction', () => {
  const valid = tar([['package/README.md', Buffer.from('hello')]]);
  expect(archiveFiles(valid).get('README.md').toString()).toBe('hello');
  for (const name of ['package/../secret', '/absolute', 'package/a\\b', 'package/C:secret']) {
    expect(() => archiveFiles(tar([[name, Buffer.from('x')]]))).toThrow();
  }
  expect(() => archiveFiles(tar([['package/a', Buffer.from('x'), '2']]))).toThrow('regular');
  expect(() => archiveFiles(tar([['package/a', Buffer.from('x')], ['package/a', Buffer.from('y')]]))).toThrow('Duplicate');
  expect(() => archiveFiles(Buffer.from('not gzip'))).toThrow();
  const corrupted = gunzipSync(valid); corrupted[0] ^= 1;
  expect(() => archiveFiles(gzipSync(corrupted))).toThrow('checksum');
  const truncated = tar([['package/a', Buffer.from('x')]]).subarray(0, 20);
  expect(() => archiveFiles(truncated)).toThrow();
});

test('package inspection requires compiled artifacts and MIT and refuses private/development files or secrets', () => {
  expect(validateFiles(files(), pkg.version).name).toBe(pkg.name);
  const missing = files(); missing.delete('dist/index.d.ts');
  expect(() => validateFiles(missing, pkg.version)).toThrow('Missing');
  for (const name of ['.npmrc', '.env', '.opencode/config.json', 'test/a.ts', 'src/a.ts', 'node_modules/a.js']) {
    const bad = files(); bad.set(name, Buffer.from('x')); expect(() => validateFiles(bad, pkg.version)).toThrow('Forbidden');
  }
  const bad = files(); bad.set('docs/leak.md', Buffer.from('-----BEGIN PRIVATE KEY-----'));
  expect(() => validateFiles(bad, pkg.version)).toThrow('secret');
  const literal = files(); literal.set('docs/leak.md', Buffer.from('apiKey: "not-a-real-key-fixture"'));
  expect(() => validateFiles(literal, pkg.version)).toThrow('secret');
  const license = files(); license.set('LICENSE', Buffer.from('wrong'));
  expect(() => validateFiles(license, pkg.version)).toThrow('MIT');
  expect(() => validateFiles(files(), '9.0.0')).toThrow('version');
  const wrongIdentity = files(); wrongIdentity.set('package.json', Buffer.from(JSON.stringify({ ...pkg, name: 'other' })));
  expect(() => validateFiles(wrongIdentity, pkg.version)).toThrow('name');
});

test('clean fixture import rejects missing package dependencies and invalid exports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scheduler-import-test-'));
  expect(() => verifyImport(dir)).toThrow();
  const module = join(dir, 'node_modules/@zebrajaeger/opencode-scheduler'); mkdirSync(module, { recursive: true });
  writeFileSync(join(module, 'package.json'), JSON.stringify({ type: 'module', main: 'index.js' }));
  writeFileSync(join(module, 'index.js'), 'export default {};'); expect(() => verifyImport(dir)).not.toThrow();
  writeFileSync(join(module, 'index.js'), 'import "missing-runtime-dependency"; export default {};');
  expect(() => verifyImport(dir)).toThrow();
  writeFileSync(join(module, 'index.js'), 'export default null;'); expect(() => verifyImport(dir)).toThrow();
});

test('registry preflight fails closed on duplicates authorization errors outages and transport errors', async () => {
  await expect(versionAvailable(pkg.version, async () => ({ status: 404, ok: false }))).resolves.toBe(true);
  for (const status of [200, 401, 403, 429, 500]) {
    await expect(versionAvailable(pkg.version, async () => ({ status, ok: status === 200 }))).rejects.toThrow();
  }
  await expect(versionAvailable(pkg.version, async () => { throw Error('network'); })).rejects.toThrow('network');
});

test('postpublication evidence matches identity integrity license and provenance', () => {
  const metadata = { version: pkg.version, integrity: integrity(Buffer.from('archive')) };
  const data = { name: pkg.name, version: pkg.version, license: 'MIT', dist: {
    integrity: metadata.integrity, attestations: { provenance: { predicateType: 'https://slsa.dev/provenance/v1' } } } };
  expect(() => verifyRegistryMetadata(data, metadata)).not.toThrow();
  for (const changed of [{ ...data, name: 'other' }, { ...data, version: '9.0.0' }, { ...data, license: 'other' },
    { ...data, dist: { integrity: metadata.integrity } }, { ...data, dist: { ...data.dist, integrity: 'wrong' } }]) {
    expect(() => verifyRegistryMetadata(changed, metadata)).toThrow();
  }
});
