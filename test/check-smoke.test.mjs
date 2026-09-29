import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runSafeSmoke } from '../check.mjs';

function makeCheckout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-office-check-sentinel-'));
  const sentinels = new Map([
    ['office.config.local.json', '{"sentinel":"config"}'],
    ['office.config.codex.local.json', '{"sentinel":"codex-config"}'],
    ['office.agents.local.json', '{"sentinel":"roster"}'],
    ['brain/sentinel.md', 'sentinel brain'],
    ['data/tasks.json', '[{"sentinel":"task"}]'],
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

  const result = await runSafeSmoke({ projectRoot: root, dependencyRoot: path.dirname(new URL(import.meta.url).pathname) + '/..' });

  assert.equal(result.build.status, 'passed');
  assert.equal(result.http.status, 'passed');
  assert.ok(['passed', 'skipped'].includes(result.browser.status));
  assert.equal(result.providers.calls, 0);
  assert.equal(result.usage.calls, 0);
  assert.equal(result.mcp.calls, 0);
  for (const [relative, contents] of before) {
    assert.deepEqual(fs.readFileSync(path.join(root, relative)), contents, `${relative} remains byte-identical`);
  }
});
