import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

// Structural assertions deliberately use the actual workflow text without adding
// a YAML runtime dependency. actionlint is the independent syntax/semantics gate.
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const release = readFileSync('.github/workflows/release.yml', 'utf8');

test('only the stable tag workflow has publishing privileges or commands', () => {
  expect(ci).toContain('pull_request:'); expect(ci).toContain('branches: [master]');
  expect(ci).not.toMatch(/id-token:|npm publish|pull_request_target/);
  expect(release).toContain("tags: ['v*']");
  expect(release).not.toMatch(/pull_request|workflow_dispatch|branches:/);
  expect(release.match(/id-token: write/g)).toHaveLength(1);
  const [unprivileged, privileged] = release.split('  publish:\n');
  expect(unprivileged).not.toContain('id-token:');
  expect(privileged).toContain('needs: validate');
  expect(privileged).not.toMatch(/npm ci|npm install|npm test|npm pack|release:check/);
});

test('release validates tag before install and passes only the same tested archive to publication', () => {
  expect(release.indexOf('scripts/release.mjs identity')).toBeLessThan(release.indexOf('npm ci'));
  expect(release).toContain('RELEASE_TAG: ${{ github.ref_name }}');
  expect(release).not.toMatch(/run:.*\$\{\{\s*github\./);
  expect(release).toContain('refs/heads/master:refs/remotes/origin/master');
  expect(release).toContain('cancel-in-progress: false');
  expect(release).toContain('group: npm-release-${{ github.ref }}');
  expect(release).toContain('include-hidden-files: true');
  expect(release).toContain('npm publish .release-artifacts/package.tgz --access public --provenance --ignore-scripts');
  expect(release.indexOf('scripts/release.mjs preflight')).toBeLessThan(release.indexOf('npm publish'));
  expect(release.indexOf('scripts/release.mjs registry')).toBeGreaterThan(release.indexOf('npm publish'));
  expect(release).not.toContain('cache:');
});

test('actions are immutable and credentials are not persisted or supplied by secrets', () => {
  const node24Pins = {
    checkout: 'd23441a48e516b6c34aea4fa41551a30e30af803',
    'setup-node': '48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
    'upload-artifact': 'b7c566a772e6b6bfb58ed0dc250532a479d7789f',
    'download-artifact': '37930b1c2abaa49bbe596cd826c3c89aef350131',
  };
  for (const text of [ci, release]) {
    for (const match of text.matchAll(/uses: (\S+)/g)) expect(match[1]).toMatch(/^actions\/[a-z-]+@[a-f0-9]{40}$/);
    for (const match of text.matchAll(/uses: actions\/([a-z-]+)@([a-f0-9]{40})/g)) {
      expect(match[2]).toBe(node24Pins[match[1]]);
    }
    expect(text).not.toMatch(/secrets\.|NPM_TOKEN|NODE_AUTH_TOKEN|_authToken|password:/i);
    expect(text.match(/persist-credentials: false/g)?.length).toBe(text.match(/uses: actions\/checkout/g)?.length);
    expect(text).toContain("node-version: '24.20.0'");
  }
});

test('nonpublishing CI preserves both isolated Windows host targets and bounded execution', () => {
  expect(ci).toContain("opencode: ['2.3.2', '2.4.1']");
  expect(ci).toContain('runs-on: windows-latest');
  expect(ci).toContain("SCHEDULER_REAL_HOST: '1'");
  expect(ci).toContain('SCHEDULER_TEST_TMP: ${{ runner.temp }}');
  expect(ci).toContain('SCHEDULER_OPENCODE_BIN=');
  expect(ci).toContain('if ($LASTEXITCODE -ne 0)');
  expect(ci).toContain('timeout-minutes: 15');
});
