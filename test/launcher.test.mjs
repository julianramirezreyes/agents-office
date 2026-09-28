import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { createLauncher } from '../launcher.mjs';

const launchers = [];
const roots = [];

afterEach(async () => {
  await Promise.all(launchers.splice(0).map(launcher => launcher.close({ graceMs: 0 })));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-office-launcher-'));
  roots.push(root);
  const reservation = net.createServer();
  await new Promise((resolve, reject) => reservation.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  return {
    root,
    port,
    host: '127.0.0.1',
    env: {},
    claudePort: 4520,
    codexPort: 4521,
    ...overrides,
  };
}

class Child extends EventEmitter {
  signals = [];
  kill(signal) {
    this.signals.push(signal);
    return true;
  }
}

async function startLauncher(config, options = {}) {
  const launcher = createLauncher({ config, ...options });
  launchers.push(launcher);
  await launcher.start();
  return { launcher, base: `http://${config.host}:${launcher.server.address().port}` };
}

test('launcher_startsBothOfficesWithProviderSpecificEnvironment', async () => {
  const config = await fixture();
  const spawned = [];
  const children = [];
  const { base } = await startLauncher(config, {
    spawnProcess: (...args) => { spawned.push(args); const child = new Child(); children.push(child); return child; },
    fetchHealth: async url => ({ ok: true, office: url.includes('4520') ? 'claude' : 'codex', url: `${url}/effective` }),
  });

  assert.equal(spawned.length, 2);
  assert.equal(spawned[0][2].env.AO_OFFICE, 'claude');
  assert.equal(spawned[0][2].env.AO_PROVIDER, 'claude');
  assert.equal(spawned[0][2].env.PORT, '4520');
  assert.equal(spawned[0][2].env.AO_CLAUDE_CONFIG, path.join(config.root, 'office.config.local.json'));
  assert.equal(spawned[0][2].env.AO_CLAUDE_DATA, path.join(config.root, 'data'));
  assert.equal(spawned[1][2].env.AO_OFFICE, 'codex');
  assert.equal(spawned[1][2].env.AO_PROVIDER, 'codex');
  assert.equal(spawned[1][2].env.PORT, '4521');
  assert.equal(spawned[1][2].env.AO_CODEX_CONFIG, path.join(config.root, 'office.config.codex.local.json'));
  assert.equal(spawned[1][2].env.AO_CODEX_DATA, path.join(config.root, 'data-codex'));
  const health = await fetch(`${base}/api/health`).then(response => response.json());
  assert.equal(health.offices.claude.url, 'http://127.0.0.1:4520/effective');
  assert.equal(health.offices.codex.url, 'http://127.0.0.1:4521/effective');
  assert.equal(children.length, 2);
});

test('launcher_healthIsIndependentWhenOneChildFails', async () => {
  const config = await fixture();
  const { base } = await startLauncher(config, {
    spawnProcess: () => new Child(),
    fetchHealth: async url => {
      if (url.includes('4521')) throw new Error('Codex did not answer health');
      return { ok: true, office: 'claude' };
    },
  });

  const health = await fetch(`${base}/api/health`).then(response => response.json());
  assert.equal(health.offices.claude.status, 'ready');
  assert.equal(health.offices.codex.status, 'failed');
  assert.match(health.offices.codex.error, /did not answer/);
});

test('launcher_reportsPortCollisionWithoutReassigningState', async () => {
  const config = await fixture({ codexPort: 4520 });
  let spawns = 0;
  const launcher = createLauncher({ config, spawnProcess: () => { spawns++; return new Child(); } });
  launchers.push(launcher);

  await assert.rejects(launcher.start(), /duplicated/);
  assert.equal(spawns, 0);
  assert.equal(launcher.server.listening, false);
  assert.equal(fs.readdirSync(config.root).length, 0);
});

test('launcher_doesNotKillUnownedProcess', async () => {
  const config = await fixture();
  const owned = [];
  const { launcher } = await startLauncher(config, {
    spawnProcess: () => { const child = new Child(); owned.push(child); return child; },
    fetchHealth: async () => ({ ok: true }),
  });

  await launcher.close({ graceMs: 0 });
  assert.deepEqual(owned.map(child => child.signals), [['SIGTERM'], ['SIGTERM']]);
});

test('launcher_gracefullyStopsOwnedChildrenAndPreservesUnfinishedTask', async () => {
  const config = await fixture();
  const children = [];
  const { launcher } = await startLauncher(config, {
    spawnProcess: () => { const child = new Child(); children.push(child); return child; },
    fetchHealth: async () => ({ ok: true, pendingWork: 1 }),
  });
  await fetch(`http://${config.host}:${launcher.server.address().port}/api/health`);

  const result = await launcher.close({ graceMs: 2 });
  assert.equal(children[0].signals[0], 'SIGTERM');
  assert.equal(result.offices.claude.pendingWork, 1);
  assert.equal(result.pending.length, 2);
  assert.equal(launcher.server.listening, false);
});

test('launcher_exposesNoTaskOrChatProxyRoutes', async () => {
  const config = await fixture();
  const { base } = await startLauncher(config, {
    spawnProcess: () => new Child(),
    fetchHealth: async () => ({ ok: true }),
  });

  assert.equal((await fetch(`${base}/api/tasks`)).status, 404);
  assert.equal((await fetch(`${base}/api/chat`, { method: 'POST' })).status, 404);
});
