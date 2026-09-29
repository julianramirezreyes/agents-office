import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runSafeSmoke } from '../check.mjs';

function makeCheckout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-office-check-sentinel-'));
  const sentinels = new Map([
    ['office.config.local.json', '{"sentinel":"claude-config"}'],
    ['office.config.codex.local.json', JSON.stringify({ name: 'SENTINEL CODEX OFFICE', brain: './brain-codex' })],
    ['office.agents.local.json', '{"sentinel":"roster"}'],
    ['brain/sentinel.md', 'sentinel brain'],
    ['data/tasks.json', '[{"sentinel":"task"}]'],
    ['brain-codex/Agents Office/agents.json', JSON.stringify({ agents: [{ id: 'elead', name: 'SENTINEL ROSTER AGENT' }] })],
    ['brain-codex/Agents Office/skills/fixture/SKILL.md', '---\nname: fixture-workflow\ndescription: Fixture-only workflow\nagents: [elead]\n---\nFollow the synthetic workflow.\n'],
    ['brain-codex/smoke.md', 'Synthetic brain note.\n'],
    ['data-codex/tasks.json', JSON.stringify([{ id: 'fixture-task', title: 'Synthetic task' }])],
  ]);
  for (const [relative, contents] of sentinels) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return { root, sentinels };
}

test('defaultSafeSmokeUsesSyntheticBuildAndHttpFixturesWithoutMutatingCheckoutSentinels', async t => {
  const { root, sentinels } = makeCheckout();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = new Map([...sentinels].map(([relative]) => [relative, fs.readFileSync(path.join(root, relative))]));

  const dependencyRoot = path.dirname(new URL(import.meta.url).pathname) + '/..';
  const browserExecutablePath = ['/usr/bin/google-chrome', '/usr/bin/brave-browser'].find(file => fs.existsSync(file)) || '';
  const result = await runSafeSmoke({ projectRoot: root, dependencyRoot, browserExecutablePath });
  await assert.rejects(runSafeSmoke({ projectRoot: dependencyRoot, dependencyRoot }), /temporary synthetic fixture root/);

  assert.equal(result.build.status, 'passed');
  assert.equal(result.http.status, 'passed');
  assert.equal(result.http.name, 'SENTINEL CODEX OFFICE', 'HTTP smoke consumes config from the supplied synthetic root');
  assert.equal(result.http.agentName, 'SENTINEL ROSTER AGENT', 'HTTP smoke consumes Claude/Codex roster fixture data from the supplied synthetic root');
  assert.deepEqual(result.http.taskIds, ['fixture-task'], 'HTTP smoke consumes task data from the supplied synthetic root');
  for (const category of ['roster-contract', 'skills-fixture', 'interview-unconfigured', 'routines-api', 'models', 'usage', 'team-parser']) {
    assert.ok(result.http.assertions.includes(category), `HTTP smoke covers ${category}`);
  }
  assert.equal(result.browser.status, browserExecutablePath ? 'passed' : 'skipped');
  if (browserExecutablePath) {
    assert.ok(result.browser.blockedExternalRequests >= 0);
    for (const category of ['department-cards', 'task-panel', 'command-bar', 'team', 'routine', 'calendar-grid', 'calendar-scheduling', 'department-focus', 'board', 'brain-graph', 'keyboard', 'approval']) {
      assert.ok(result.browser.assertions.includes(category), `browser smoke covers ${category}`);
    }
  }
  assert.equal(result.providers.calls, 0);
  assert.equal(result.usage.calls, 0);
  assert.equal(result.mcp.calls, 0);
  for (const [relative, contents] of before) {
    if (relative === 'data-codex/tasks.json') continue; // Runtime persistence may normalize its owned task file.
    assert.deepEqual(fs.readFileSync(path.join(root, relative)), contents, `${relative} remains byte-identical`);
  }
});

test('providerBackedLegacySmokeRemainsBehindAnExplicitOptInScript', () => {
  const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts['check:live'], /check\.live\.mjs/);
  assert.ok(fs.statSync(path.join(root, 'check.live.mjs')).isFile(), 'legacy provider-dependent smoke remains available only by opt-in');
});

test('browserRequestPolicyAllowsOnlyTheExactLocalOrigin', async () => {
  const { isBrowserRequestAllowed } = await import('../check.mjs');
  const origin = 'http://127.0.0.1:43127';
  assert.equal(isBrowserRequestAllowed(`${origin}/dist/index.html`, origin), true);
  assert.equal(isBrowserRequestAllowed('http://localhost:43127/api/health', origin), false);
  assert.equal(isBrowserRequestAllowed('http://127.0.0.1:43128/api/health', origin), false);
  assert.equal(isBrowserRequestAllowed('http://[::1]:43127/api/health', origin), false);
  assert.equal(isBrowserRequestAllowed('file:///tmp/index.html', origin), false);
  assert.equal(isBrowserRequestAllowed('https://example.invalid/', origin), false);
});

test('fixtureRootRejectsSymlinkEscapingTempBeforeTouchingItsTarget', async t => {
  const target = fs.mkdtempSync(path.join(os.homedir(), '.agents-office-synthetic-target-'));
  const linkParent = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-office-root-link-'));
  const link = path.join(linkParent, 'fixture');
  const sentinel = path.join(target, 'sentinel.txt');
  fs.writeFileSync(sentinel, 'untouched');
  fs.symlinkSync(target, link, 'dir');
  t.after(() => {
    fs.rmSync(linkParent, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  });

  const { canonicalFixtureRoot } = await import('../check.mjs');
  assert.throws(() => canonicalFixtureRoot(link), /canonical temporary synthetic fixture root/);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'untouched');
  assert.deepEqual(fs.readdirSync(target), ['sentinel.txt']);
});
