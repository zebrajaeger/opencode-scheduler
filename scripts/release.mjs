import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const packageName = '@zebrajaeger/opencode-scheduler';
export const registry = 'https://registry.npmjs.org';
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const required = ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts',
  'dist/scheduler.js', 'dist/scheduler.d.ts', 'dist/tools.js', 'dist/tools.d.ts',
  'dist/opencode-adapter.js', 'dist/opencode-adapter.d.ts'];

function assert(condition, message) { if (!condition) throw new Error(message); }
export function validateMetadata(pkg, lock) {
  assert(pkg.name === packageName, 'Unexpected package name');
  assert(typeof pkg.version === 'string' && stable.test(pkg.version), 'Version must be canonical stable SemVer');
  assert(pkg.private !== true && pkg.publishConfig?.access === 'public', 'Package must have public access');
  assert(!pkg.publishConfig?.registry || pkg.publishConfig.registry === registry, 'Unexpected publishing registry');
  assert(pkg.license === 'MIT', 'MIT license metadata required');
  assert(pkg.type === 'module' && pkg.main === './dist/index.js' && pkg.types === './dist/index.d.ts', 'Invalid ESM entry points');
  assert(pkg.exports?.['.']?.import === pkg.main && pkg.exports?.['.']?.types === pkg.types, 'Invalid package exports');
  if (lock) {
    assert(lock.name === pkg.name && lock.version === pkg.version && lock.packages?.['']?.name === pkg.name
      && lock.packages[''].version === pkg.version && lock.packages[''].license === pkg.license, 'Lockfile metadata mismatch');
  }
  return pkg.version;
}

export function validateTag(tag, pkg, lock) {
  const version = validateMetadata(pkg, lock);
  assert(tag === `v${version}`, 'Tag must be canonical vX.Y.Z and match package/lockfile versions');
  return version;
}

export function validateGit(tag, cwd = process.cwd()) {
  assert(typeof tag === 'string' && /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag), 'Unsafe or non-stable tag');
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
  assert(commit === git(['rev-parse', 'HEAD']), 'Checkout does not match tagged commit');
  git(['merge-base', '--is-ancestor', commit, 'refs/remotes/origin/master']);
  return commit;
}

// Decode tar ourselves: never extract untrusted paths with an external tar utility.
export function archiveFiles(archive) {
  const tar = gunzipSync(archive, { maxOutputLength: 25 * 1024 * 1024 });
  const files = new Map();
  let ended = false;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) { ended = true; break; }
    const str = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const octal = text => { assert(/^[0-7]+$/.test(text.trim()), 'Invalid tar numeric field'); return parseInt(text.trim(), 8); };
    const checksum = octal(str(148, 8).trim());
    const sum = header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0);
    assert(checksum === sum, 'Invalid tar header checksum');
    const prefix = str(345, 155);
    const name = `${prefix ? `${prefix}/` : ''}${str(0, 100)}`;
    const size = octal(str(124, 12));
    const type = str(156, 1);
    assert((type === '0' || type === '') && !str(157, 100), 'Only regular archive files are allowed');
    assert(name.startsWith('package/') && !name.includes('\\') && !name.includes(':')
      && !name.split('/').some(part => !part || part === '.' || part === '..'), 'Unsafe archive path');
    assert(!files.has(name.slice(8)), 'Duplicate archive entry');
    assert(Number.isSafeInteger(size) && offset + 512 + size <= tar.length, 'Truncated archive entry');
    files.set(name.slice(8), tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert(ended && files.size > 0, 'Missing tar end marker or empty archive');
  return files;
}

export function validateFiles(files, version) {
  for (const name of required) assert(files.has(name), `Missing required artifact: ${name}`);
  const patterns = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,})\b/,
    /(?:_authToken|npm_token|node_auth_token)\s*[=:]\s*["']?[^\s"'$<{]{8,}/i,
    /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[=:]\s*["'][^"'\r\n]{8,}["']/i,
    /https?:\/\/[^\s/@:]+:[^\s/@]+@/];
  for (const [name, data] of files) {
    const permitted = ['package.json', 'README.md', 'LICENSE'].includes(name)
      || /^dist\/[a-z-]+\.(?:js|d\.ts)$/.test(name) || /^docs\/[a-z-]+\.md$/.test(name);
    assert(permitted, `Forbidden package artifact: ${name}`);
    assert(!patterns.some(pattern => pattern.test(data.toString('utf8'))), `Possible secret in archive file: ${name}`);
  }
  const pkg = JSON.parse(files.get('package.json').toString('utf8'));
  assert(validateMetadata(pkg) === version, 'Archive version mismatch');
  const license = files.get('LICENSE').toString('utf8');
  assert(license.includes('MIT License') && license.includes('Permission is hereby granted, free of charge')
    && license.includes('THE SOFTWARE IS PROVIDED "AS IS"'), 'Invalid MIT license artifact');
  return pkg;
}

export function integrity(archive) { return `sha512-${createHash('sha512').update(archive).digest('base64')}`; }

function npm(args, cwd = process.cwd()) {
  const cli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  assert(existsSync(cli), 'Run this command through npm (npm CLI path unavailable)');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^npm_config_/i.test(key) && !/^(NODE_AUTH_TOKEN|NPM_TOKEN)$/i.test(key)));
  // npm run can export project-scoped configuration that is invalid in a fresh fixture.
  env.npm_config_userconfig = process.platform === 'win32' ? 'NUL' : '/dev/null';
  return execFileSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 });
}

export function verifyImport(directory) {
  execFileSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(packageName)}); if (!m.default || typeof m.default !== 'object') throw new Error('Invalid plugin export');`],
  { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
}

export function checkArchive(archivePath, version, install = true) {
  const archive = readFileSync(archivePath);
  validateFiles(archiveFiles(archive), version);
  if (install) {
    const base = process.env.RUNNER_TEMP ?? process.env.SCHEDULER_TEST_TMP
      ?? (process.platform === 'win32' ? join(homedir(), 'AppData/Local/Temp/opencode') : tmpdir());
    const fixture = mkdtempSync(join(base, 'scheduler-release-'));
    writeFileSync(join(fixture, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', resolve(archivePath)], fixture);
    verifyImport(fixture);
  }
  return { name: packageName, version, integrity: integrity(archive), archive: 'package.tgz' };
}

export async function versionAvailable(version, request = fetch) {
  assert(stable.test(version), 'Invalid registry version');
  const response = await request(`${registry}/${encodeURIComponent(packageName)}/${version}`, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return true;
  if (response.ok) throw new Error('Version already exists on npm; inspect it and use a new version, do not republish');
  throw new Error(`Registry preflight failed (${response.status}); publication blocked`);
}

export function verifyRegistryMetadata(data, metadata) {
  assert(data.name === packageName && data.version === metadata.version, 'Registry package identity mismatch');
  assert(data.dist?.integrity === metadata.integrity, 'Registry archive integrity mismatch');
  assert(data.dist?.attestations?.provenance?.predicateType === 'https://slsa.dev/provenance/v1', 'Registry provenance missing or unsupported');
  assert(data.license === 'MIT', 'Registry license mismatch');
}

export async function publishedMetadata(version, request = fetch,
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), attempts = 12) {
  assert(stable.test(version), 'Invalid registry version');
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await request(`${registry}/${encodeURIComponent(packageName)}/${version}?verify=${Date.now()}`, {
      signal: AbortSignal.timeout(30_000), headers: { 'cache-control': 'no-cache' },
    });
    if (response.ok) return response.json();
    const transient = response.status === 404 || response.status === 429 || response.status >= 500;
    assert(transient && attempt + 1 < attempts,
      `Postpublication registry check failed (${response.status}); inspect exact version before any retry`);
    await wait(10_000);
  }
  throw new Error('Postpublication verification exhausted');
}

export async function main(command) {
  const out = resolve('.release-artifacts');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const version = validateMetadata(pkg, lock);
  if (command === 'identity') {
    validateTag(process.env.RELEASE_TAG, pkg, lock);
    console.log(`Validated release ${version} at ${validateGit(process.env.RELEASE_TAG)}`);
  } else if (command === 'pack') {
    mkdirSync(out, { recursive: true });
    const packed = JSON.parse(npm(['pack', '--json', '--pack-destination', out]));
    assert(packed.length === 1 && /^[a-zA-Z0-9_.-]+\.tgz$/.test(packed[0].filename), 'Unexpected npm pack result');
    const archive = join(out, packed[0].filename);
    const metadata = checkArchive(archive, version);
    writeFileSync(join(out, 'package.tgz'), readFileSync(archive));
    writeFileSync(join(out, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
    console.log(`Verified ${packageName}@${version}, ${metadata.integrity}`);
  } else if (command === 'preflight' || command === 'registry') {
    const metadata = JSON.parse(readFileSync(join(out, 'metadata.json'), 'utf8'));
    assert(metadata.name === packageName && metadata.version === version && metadata.archive === 'package.tgz', 'Unexpected release metadata');
    assert(checkArchive(join(out, 'package.tgz'), version, false).integrity === metadata.integrity, 'Artifact handoff integrity mismatch');
    if (command === 'preflight') await versionAvailable(version);
    else {
      const data = await publishedMetadata(version);
      verifyRegistryMetadata(data, metadata);
      const tarball = new URL(data.dist.tarball);
      assert(tarball.origin === registry, 'Unexpected registry tarball origin');
      const downloaded = await fetch(tarball, { signal: AbortSignal.timeout(30_000) });
      assert(downloaded.ok && integrity(Buffer.from(await downloaded.arrayBuffer())) === metadata.integrity, 'Public tarball access/integrity check failed');
    }
    console.log(`Registry ${command} passed for ${version}`);
  } else throw new Error('Expected identity, pack, preflight or registry');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
