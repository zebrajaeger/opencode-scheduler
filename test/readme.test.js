import { expect, test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const readme = readFileSync('README.md', 'utf8');
const german = readFileSync('README.de.md', 'utf8');
const english = readme;
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

test('language navigation and unique section anchors resolve with user guidance before development', () => {
  for (const text of [german, english]) {
    const ids = [...text.matchAll(/<a id="([^"]+)"><\/a>/g)].map(m => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const match of text.matchAll(/\]\(#([^)]+)\)/g)) expect(ids).toContain(match[1]);
    expect(text).toContain('[Deutsch](README.de.md) | [English](README.md)');
  }
  expect(english).not.toContain('## Deutsch');
  expect(german).not.toContain('## English');
  for (const [text, sections] of [[german, ['de-installation', 'de-konfiguration', 'de-tools', 'de-kompatibilitaet', 'de-grenzen', 'de-entwicklung']],
    [english, ['en-installation', 'en-configuration', 'en-tools', 'en-compatibility', 'en-limits', 'en-development']]]) {
    const positions = sections.map(id => text.indexOf(`<a id="${id}">`));
    expect(positions.every(n => n >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(text.indexOf('npm ci')).toBeGreaterThan(positions.at(-1));
    expect(text.indexOf('C:/ws.inc/opencode-scheduler')).toBeGreaterThan(positions.at(-1));
  }
});

test('languages have identical valid JSON configurations and executable developer commands', () => {
  const json = text => [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map(m => JSON.parse(m[1]));
  expect(json(german)).toEqual(json(english));
  expect(json(german)).toHaveLength(4);
  expect(json(german)[0].plugins).toEqual([pkg.name]);
  expect(json(german)[1].plugins).toEqual([`${pkg.name}@${pkg.version}`]);
  const commands = text => [...text.matchAll(/```sh\n([\s\S]*?)\n```/g)].map(m => m[1]);
  expect(commands(german)).toEqual(commands(english));
  for (const line of commands(german)[0].split('\n')) {
    const name = line.match(/^npm run ([\w:-]+)$/)?.[1];
    if (name) expect(pkg.scripts).toHaveProperty(name);
  }
});

test('both user sections preserve tool identifiers timing ownership and critical lifecycle limits', () => {
  for (const text of [german, english]) {
    const user = text.split(/<a id="(?:de-entwicklung|en-development)"><\/a>/)[0];
    for (const name of ['timer_start', 'timer_stop', 'timer_list', 'timer_update', 'timer_stop_all',
      'delaySeconds', 'intervalSeconds', 'maxLifetimeSeconds', 'timerId', 'session.execution.interrupted',
      '3600', '30', '2.3.2', '2.4.1', '2.8.0', 'Windows x64', 'Node.js >=22']) expect(user).toContain(name);
    expect(user).toContain('delivery: "queue"');
    expect(user).toMatch(/Forks/);
    expect(user).toMatch(/AGENTS\.md/);
  }
  for (const phrase of ['ursprünglichen Erstellung', 'verlängert', 'bereits eingereichter Prompt', 'keine automatische Genehmigung', 'Arbeitsspeicher']) expect(german).toContain(phrase);
  for (const phrase of ['original creation', 'does **not** extend expiry', 'submitted prompt can still run', 'never auto-approves', 'In-memory only']) expect(english).toContain(phrase);
});

test('local links exist and German advanced documentation is labelled English', () => {
  for (const match of (english + german).matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (!target.startsWith('#') && !target.startsWith('https://')) expect(existsSync(resolve(target))).toBe(true);
  }
  for (const m of german.matchAll(/\[([^\]]+)\]\((docs\/[^)]+\.md)\)/g)) expect(m[1]).toContain('Englisch');
});

test('four truthful badges link to npm master CI license and engine metadata', () => {
  for (const text of [german, english]) {
  const badges = [...text.matchAll(/\[!\[([^\]]+)\]\(([^)]+)\)\]\(([^)]+)\)/g)];
  expect(badges).toHaveLength(4);
  expect(badges.map(m => m[3])).toEqual([
    `https://www.npmjs.com/package/${pkg.name}`,
    'https://github.com/zebrajaeger/opencode-scheduler/actions/workflows/ci.yml', 'LICENSE', 'package.json',
  ]);
  expect(badges[1][2]).toContain('ci.yml/badge.svg?branch=master');
  expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain('branches: [master]');
  expect(pkg.license).toBe('MIT'); expect(pkg.engines.node).toBe('>=22');
  for (const m of badges.filter((_, i) => i !== 1)) expect(m[2]).toContain(encodeURIComponent(pkg.name));
  for (const m of badges) expect(m[1].length).toBeGreaterThan(3);
  }
});

test('banner uses one project-relative image and preserves supplied bytes and dimensions', () => {
  for (const text of [german, english]) {
    expect(text.match(/\]\(docs\/banner\.png\)/g)).toHaveLength(1);
    expect(text).not.toMatch(/Downloads|57ac8eac|file:\/\//);
  }
  const banner = readFileSync('docs/banner.png');
  expect(banner.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect([banner.readUInt32BE(16), banner.readUInt32BE(20)]).toEqual([2172, 724]);
  expect(createHash('sha256').update(banner).digest('hex')).toBe('5ce7b9d459c165a3b67b61c9273f41995a0ec196e135601f51e44b13bd57efae');
});
