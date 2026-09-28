import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { createOfficeRuntime } from '../serve.mjs';
import { loadConfig } from '../config.mjs';
import { loadRoster } from '../roster.mjs';

const runtimes = [];
const tempRoots = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.close({ graceMs: 0 })));
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-office-runtime-'));
  tempRoots.push(root);
  const dataRoot = path.join(root, 'data');
  const brainPath = path.join(root, 'brain');
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(brainPath, { recursive: true });
  return { root, dataRoot, brainPath };
}

async function startRuntime({ office, provider, port, ...paths }) {
  const runtime = await createOfficeRuntime({
    officeConfig: { ...loadConfig(), office, port, dataRoot: paths.dataRoot, brainPath: paths.brainPath },
    provider,
    ...paths,
  });
  runtimes.push(runtime);
  await runtime.start();
  const address = runtime.server.address();
  return { runtime, base: `http://127.0.0.1:${address.port}` };
}

test('createOfficeRuntime_bindsProviderAndOfficeIdentityAtStart', async () => {
  const a = fixture(), b = fixture();
  const first = await startRuntime({ ...a, office: 'claude', port: 0, provider: { id: 'claude' } });
  const second = await startRuntime({ ...b, office: 'codex', port: 0, provider: { id: 'codex' } });

  const [healthA, healthB] = await Promise.all([first.base, second.base].map(url => fetch(`${url}/api/health`).then(r => r.json())));
  assert.equal(healthA.office, 'claude');
  assert.equal(healthA.provider, 'claude');
  assert.equal(healthB.office, 'codex');
  assert.equal(healthB.provider, 'codex');
});

test('server_routesReadOnlyIntoItsOwnDataRoot', async () => {
  const a = fixture(), b = fixture();
  fs.writeFileSync(path.join(a.dataRoot, 'tasks.json'), JSON.stringify([{ id: 'a-task', title: 'A only' }]));
  fs.writeFileSync(path.join(b.dataRoot, 'tasks.json'), JSON.stringify([{ id: 'b-task', title: 'B only' }]));
  const first = await startRuntime({ ...a, office: 'claude', port: 0, provider: { id: 'claude' } });
  const second = await startRuntime({ ...b, office: 'codex', port: 0, provider: { id: 'codex' } });

  assert.deepEqual(await fetch(`${first.base}/api/tasks`).then(r => r.json()), [{ id: 'a-task', title: 'A only' }]);
  assert.deepEqual(await fetch(`${second.base}/api/tasks`).then(r => r.json()), [{ id: 'b-task', title: 'B only' }]);
  assert.equal((await fetch(`${first.base}/api/tasks/a-task`, { method: 'DELETE' })).status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(a.dataRoot, 'tasks.json'), 'utf8')), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(b.dataRoot, 'tasks.json'), 'utf8')), [{ id: 'b-task', title: 'B only' }]);
});

test('server_rejectsCallerSuppliedOfficeAsRoutingOverride', async () => {
  const paths = fixture();
  const { base } = await startRuntime({ ...paths, office: 'claude', port: 0, provider: { id: 'claude' } });

  const response = await fetch(`${base}/api/tasks`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ office: 'codex', dept: 'emails', text: 'must not route' }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /office/i);
  assert.equal(fs.existsSync(path.join(paths.dataRoot, 'tasks.json')), false);
  assert.equal((await fetch(`${base}/api/tasks?office=codex`)).status, 400);
});

test('server_reportsOfficeProviderInHealth', async () => {
  const paths = fixture();
  const { base } = await startRuntime({ ...paths, office: 'codex', port: 0, provider: { id: 'codex' } });
  const response = await fetch(`${base}/api/health`);
  const health = await response.json();

  assert.equal(response.status, 200);
  assert.equal(health.office, 'codex');
  assert.equal(health.provider, 'codex');
});

test('server_shutdownStopsAcceptingWorkAndPersistsTaskState', async () => {
  const paths = fixture();
  fs.writeFileSync(path.join(paths.dataRoot, 'tasks.json'), JSON.stringify([{ id: 'keep', title: 'persist me' }]));
  const runtime = await createOfficeRuntime({
    officeConfig: { ...loadConfig(), office: 'claude', port: 0, dataRoot: paths.dataRoot, brainPath: paths.brainPath },
    provider: { id: 'claude' },
    ...paths,
  });
  runtimes.push(runtime);
  await runtime.start();
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  await runtime.close({ graceMs: 0 });
  runtimes.splice(runtimes.indexOf(runtime), 1);

  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(paths.dataRoot, 'tasks.json'), 'utf8')), [{ id: 'keep', title: 'persist me' }]);
  await assert.rejects(fetch(`${base}/api/tasks`));
});

test('claudeDefaultStartup_preservesExistingConfigAndDataPaths', async () => {
  const config = loadConfig();
  assert.equal(config.port, 4520);
  assert.equal(config.configPath, undefined);
  assert.equal(config.dataRoot, undefined);
  assert.equal(config.brainPath, path.resolve(process.cwd(), config.brain));
});

test('codexRoster_usesOnlyItsIsolatedBrainCustomization', () => {
  const paths = fixture();
  const officeDir = path.join(paths.brainPath, 'Agents Office');
  fs.mkdirSync(officeDir, { recursive: true });
  fs.writeFileSync(path.join(officeDir, 'agents.json'), JSON.stringify({ agents: [{ id: 'elead', name: 'CODEX EMAIL LEAD' }] }));

  const roster = loadRoster(paths.brainPath, { office: 'codex' });
  assert.equal(roster.agents.find(agent => agent.id === 'elead').name, 'CODEX EMAIL LEAD');
  assert.deepEqual(roster.files, ['brain/Agents Office/agents.json']);
});
