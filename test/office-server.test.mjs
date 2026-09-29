import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { attachShutdownHandlers, createOfficeRuntime } from '../serve.mjs';
import { loadConfig } from '../config.mjs';
import { loadRoster } from '../roster.mjs';
import { defaults as defaultRoster } from '../roster.mjs';
import { createLauncher } from '../launcher.mjs';

const runtimes = [];
const tempRoots = [];
const launchers = [];

afterEach(async () => {
  await Promise.all(launchers.splice(0).map(launcher => launcher.close({ graceMs: 0 })));
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

async function startRuntime({ office, provider, port, runtimeOptions = {}, ...paths }) {
  const officeConfig = loadConfig({ office, env: {}, root: paths.root });
  const rosterLoader = runtimeOptions.rosterLoader || ((brainPath, options) => options.office === 'codex'
    ? loadRoster(brainPath, options)
    : { agents: defaultRoster(), problems: [], customised: 0, briefed: 0, files: [] });
  const runtime = await createOfficeRuntime({
    officeConfig: { ...officeConfig, office, port, dataRoot: paths.dataRoot, brainPath: paths.brainPath },
    provider,
    rosterLoader,
    ...runtimeOptions,
    ...paths,
  });
  runtimes.push(runtime);
  await runtime.start();
  const address = runtime.server.address();
  return { runtime, officeConfig, base: `http://127.0.0.1:${address.port}` };
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

test('codexChat_usesAgentContextAndBoundedHistoryWithoutDuplicatingCurrentMessage', async () => {
  const paths = fixture();
  const agent = { id: 'fixture-email', department: 'emails', lead: true, name: 'EMAILS ASSISTANT', role: 'Writer', does: 'writes email copy', brief: 'Use the owner voice.', tools: [] };
  fs.writeFileSync(path.join(paths.dataRoot, 'tasks.json'), JSON.stringify([
    { id: 'recent-task', agent: agent.id, state: 'done', title: 'Prepared launch brief' },
  ]));
  fs.writeFileSync(path.join(paths.brainPath, 'voice-notes.md'), 'The company voice is warm and concise.');
  const calls = [];
  const provider = {
    id: 'codex',
    async runTask() { throw new Error('chat must not use runTask'); },
    async runChat(input) {
      calls.push(input);
      return { status: 'completed', provider: 'codex', text: 'Codex reply', threadId: 'chat-thread', usage: { input_tokens: 30, output_tokens: 4 } };
    },
  };
  const { base } = await startRuntime({ ...paths, office: 'codex', port: 0, provider, runtimeOptions: {
    rosterLoader: () => ({ agents: [agent], problems: [], customised: 1, briefed: 0, files: [] }),
  } });
  const history = Array.from({ length: 10 }, (_, index) => ({ who: index % 2 ? 'agent' : 'user', text: `prior-message-${index + 1}` }));
  history.push({ who: 'user', text: 'Current voice request' });

  const response = await fetch(`${base}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent: agent.id, text: 'Current voice request', history }),
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.provider, 'codex');
  assert.equal(result.providerStatus, 'completed');
  assert.equal(result.reply, 'Codex reply');
  assert.deepEqual(result.read, ['voice-notes']);
  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /You are EMAILS ASSISTANT/);
  assert.match(calls[0].prompt, /Use the owner voice/);
  assert.match(calls[0].prompt, /warm and concise/);
  assert.match(calls[0].prompt, /Prepared launch brief/);
  assert.match(calls[0].prompt, /Owner: prior-message-3/);
  assert.match(calls[0].prompt, /EMAILS ASSISTANT: prior-message-10/);
  assert.doesNotMatch(calls[0].prompt, /prior-message-1\n/);
  assert.equal(calls[0].prompt.split('Owner: Current voice request').length - 1, 1);
});

test('codexChat_rejectsInvalidAgentOrMessageBeforeCallingProvider', async () => {
  const paths = fixture();
  let calls = 0;
  const provider = { id: 'codex', async runTask() {}, async runChat() { calls++; return { status: 'completed', text: 'unexpected' }; } };
  const { base } = await startRuntime({ ...paths, office: 'codex', port: 0, provider });
  const send = body => fetch(`${base}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  const unknownAgent = await send({ agent: 'not-an-agent', text: 'Hello' });
  const emptyMessage = await send({ agent: 'elead', text: '   ' });
  const nonStringMessage = await send({ agent: 'elead', text: { secret: 'not text' } });

  assert.equal(unknownAgent.status, 400);
  assert.equal(emptyMessage.status, 400);
  assert.equal(nonStringMessage.status, 400);
  assert.equal(calls, 0);
});

test('codexChat_returnsSafeProviderFailureWithoutLoggingMessagesOrSecrets', async () => {
  const paths = fixture();
  const message = 'private owner message never log this';
  const secret = 'token=not-for-logs';
  const provider = {
    id: 'codex', async runTask() {},
    async runChat() { return { status: 'failed', provider: 'codex', error: `SDK exploded ${secret}` }; },
  };
  const { base } = await startRuntime({ ...paths, office: 'codex', port: 0, provider });
  const logs = [];
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (...values) => logs.push(values.join(' '));
  console.error = (...values) => logs.push(values.join(' '));
  try {
    const response = await fetch(`${base}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'elead', text: message }),
    });
    const result = await response.json();
    assert.equal(response.status, 502);
    assert.equal(result.provider, 'codex');
    assert.equal(result.providerStatus, 'failed');
    assert.doesNotMatch(result.error, /SDK exploded|token=/i);
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs.join('\n'), /SDK exploded|token=|private owner message/i);
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
});

test('serverUsesInjectedFixtureRosterInsteadOfCheckoutLocalRoster', async () => {
  const paths = fixture();
  const fixtureRoster = { agents: [{ id: 'fixture-agent', department: 'emails', lead: true, name: 'FIXTURE AGENT', tools: [] }], problems: [], customised: 1, briefed: 0, files: ['fixture-roster.json'] };
  const { base } = await startRuntime({ ...paths, office: 'claude', port: 0, provider: { id: 'claude' }, runtimeOptions: {
    rosterLoader: () => fixtureRoster,
  } });
  const health = await fetch(`${base}/api/health`).then(response => response.json());
  assert.deepEqual(health.roster, { customised: 1, briefed: 0, files: ['fixture-roster.json'], problems: [] });
  assert.equal(health.agents[0].name, 'FIXTURE AGENT');
});

test('serverReloadsRosterThroughTheInjectedFixtureLoader', async () => {
  const paths = fixture();
  let loads = 0;
  const { base } = await startRuntime({ ...paths, office: 'claude', port: 0, provider: { id: 'claude' }, runtimeOptions: {
    rosterLoader: () => {
      loads++;
      const agents = defaultRoster();
      agents.find(agent => agent.id === 'elead').name = loads === 1 ? 'INITIAL FIXTURE LEAD' : 'RELOADED FIXTURE LEAD';
      return { agents, problems: [], customised: 0, briefed: 0, files: [] };
    },
  } });

  // GET /api/skills exercises reloadRoster; it never enters routing or provider execution.
  const response = await fetch(`${base}/api/skills`);
  assert.equal(response.status, 200);
  assert.ok(loads >= 2, 'the read-only skills route reloads through the injected roster seam');
  const health = await fetch(`${base}/api/health`).then(result => result.json());
  assert.equal(health.agents.find(agent => agent.id === 'elead').name, 'RELOADED FIXTURE LEAD');
});

test('storageFailureIsVisibleAndIsolatedToItsOffice', async () => {
  const claudePaths = fixture(), codexPaths = fixture();
  fs.writeFileSync(path.join(claudePaths.dataRoot, 'tasks.json'), JSON.stringify([{ id: 'claude-task', title: 'Fixture task' }]));
  fs.writeFileSync(path.join(codexPaths.dataRoot, 'tasks.json'), JSON.stringify([{ id: 'codex-task', title: 'Fixture task' }]));
  const claude = await startRuntime({ ...claudePaths, office: 'claude', port: 0, provider: { id: 'claude' } });
  const codex = await startRuntime({ ...codexPaths, office: 'codex', port: 0, provider: { id: 'codex' } });
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = function (file, ...args) {
    if (path.resolve(String(file)) === path.join(claudePaths.dataRoot, 'tasks.json')) {
      const error = new Error('fixture disk is full');
      error.code = 'ENOSPC';
      throw error;
    }
    return originalWrite.call(this, file, ...args);
  };

  try {
    const [failed, succeeded] = await Promise.all([
      // DELETE is the direct storage branch; unlike POST/run it does not call route()/askX().
      fetch(`${claude.base}/api/tasks/claude-task`, { method: 'DELETE' }),
      fetch(`${codex.base}/api/tasks/codex-task`, { method: 'DELETE' }),
    ]);
    const failure = await failed.json();
    assert.equal(failed.status, 500);
    assert.match(failure.error, /fixture disk is full/);
    assert.deepEqual(await succeeded.json(), { ok: true });
    assert.equal(succeeded.status, 200, 'the other office keeps accepting storage changes');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(claudePaths.dataRoot, 'tasks.json'), 'utf8')), [{ id: 'claude-task', title: 'Fixture task' }]);
    const codexTasks = await fetch(`${codex.base}/api/tasks`).then(result => result.json());
    assert.deepEqual(codexTasks, []);
    assert.equal((await fetch(`${codex.base}/api/health`).then(result => result.json())).provider, 'codex');
  } finally {
    fs.writeFileSync = originalWrite;
  }
});

test('server_shutdownStopsAcceptingWorkAndPersistsTaskState', async () => {
  const paths = fixture();
  fs.writeFileSync(path.join(paths.dataRoot, 'tasks.json'), JSON.stringify([{ id: 'keep', title: 'persist me' }]));
  const runtime = await createOfficeRuntime({
    officeConfig: { ...loadConfig({ office: 'claude', env: {}, root: paths.root }), office: 'claude', port: 0, dataRoot: paths.dataRoot, brainPath: paths.brainPath },
    provider: { id: 'claude' },
    rosterLoader: () => ({ agents: defaultRoster(), problems: [], customised: 0, briefed: 0, files: [] }),
    ...paths,
  });
  runtimes.push(runtime);
  await runtime.start();
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  const stopped = await runtime.close({ graceMs: 0 });
  runtimes.splice(runtimes.indexOf(runtime), 1);

  assert.deepEqual(stopped, { drained: true, pendingWork: 0 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(paths.dataRoot, 'tasks.json'), 'utf8')), [{ id: 'keep', title: 'persist me' }]);
  await assert.rejects(fetch(`${base}/api/tasks`));
});

test('claudeDefaultStartup_preservesExistingConfigAndDataPaths', async () => {
  const paths = fixture();
  fs.writeFileSync(path.join(paths.root, 'office.config.json'), JSON.stringify({ model: 'fixture-model', brain: './brain' }));
  const config = loadConfig({ office: 'claude', env: {}, root: paths.root });
  assert.equal(config.port, 4520);
  assert.equal(config.configPath, path.join(paths.root, 'office.config.local.json'));
  assert.equal(config.dataRoot, path.join(paths.root, 'data'));
  assert.equal(config.brainPath, path.join(paths.root, 'brain'));
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

test('codexRuntime_neverCallsClaudeUsageOrMcpAndDoesNotAdvertiseClaude', async () => {
  const paths = fixture();
  let usageCalls = 0, mcpCalls = 0, credentialReads = 0;
  const originalReadFileSync = fs.readFileSync;
  const originalPath = process.env.PATH;
  fs.readFileSync = function (file, ...args) {
    if (String(file).endsWith('.claude/.credentials.json')) {
      credentialReads++;
      throw new Error('credential access blocked by test');
    }
    return originalReadFileSync.call(this, file, ...args);
  };
  process.env.PATH = paths.root;
  try {
    const { base } = await startRuntime({ ...paths, office: 'codex', port: 0, runtimeOptions: {
      usageFetch: async () => { usageCalls++; return { ok: true, source: 'claude' }; },
      discoverMcp: async () => { mcpCalls++; return []; },
    } });
    const health = await fetch(`${base}/api/health`).then(r => r.json());
    await fetch(`${base}/api/usage?refresh=1`).then(r => r.json());
    await fetch(`${base}/api/mcp?refresh=1`).then(r => r.json());

    assert.equal(usageCalls, 0);
    assert.equal(mcpCalls, 0);
    assert.equal(credentialReads, 0);
    assert.equal(health.provider, 'codex');
    assert.notEqual(health.backend, 'claude-cli');
    assert.equal(health.model, null);
    assert.deepEqual(health.models, []);
    assert.equal(health.tools, false);
    assert.equal(health.teams.enabled, false);
    assert.equal(health.browser.on, false);
    assert.deepEqual(health.mcp.servers, []);
  } finally {
    fs.readFileSync = originalReadFileSync;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
});

test('officeRuntime_closeReportsPendingDetachedTaskAndLetsItPersistAfterGrace', async () => {
  const paths = fixture();
  fs.writeFileSync(path.join(paths.dataRoot, 'tasks.json'), JSON.stringify([{
    id: 'slow-task', dept: 'emails', agent: 'elead', title: 'Slow task', text: 'Wait for release', state: 'next',
  }]));
  let releaseTask;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const runner = new Promise(resolve => { releaseTask = resolve; });
  const { runtime, base } = await startRuntime({ ...paths, office: 'codex', port: 0, provider: { id: 'codex' }, runtimeOptions: {
    taskRunner: async () => { markStarted(); return runner; },
  } });

  const request = fetch(`${base}/api/tasks/slow-task/run`, { method: 'POST' }).catch(error => error);
  await started;
  const stopped = await runtime.close({ graceMs: 10 });
  runtimes.splice(runtimes.indexOf(runtime), 1);

  assert.equal(stopped.drained, false);
  assert.equal(stopped.pendingWork, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(paths.dataRoot, 'tasks.json'), 'utf8'))[0].state, 'doing');
  releaseTask({ result: 'Persisted after shutdown began', read: [], tools: [], used: [], skills: [] });
  await request;
  await new Promise(resolve => setTimeout(resolve, 20));
  const task = JSON.parse(fs.readFileSync(path.join(paths.dataRoot, 'tasks.json'), 'utf8'))[0];
  assert.equal(task.state, 'done');
  assert.equal(task.result, 'Persisted after shutdown began');
});

test('shutdownEntrypoint_doesNotForceExitWhileWorkRemainsPending', async () => {
  const handlers = new (await import('node:events')).EventEmitter();
  let exits = 0;
  const warnings = [];
  handlers.exit = () => { exits++; };
  const detach = attachShutdownHandlers({ close: async () => ({ drained: false, pendingWork: 1 }) }, {
    processRef: handlers, warn: message => warnings.push(message),
  });
  handlers.emit('SIGTERM');
  await new Promise(resolve => setImmediate(resolve));
  detach();

  assert.equal(exits, 0);
  assert.match(warnings.join('\n'), /1.*pending/i);
});

test('officeRuntime_closeDeadlineAlsoCoversAnIncompleteHttpRequest', async () => {
  const paths = fixture();
  const { runtime } = await startRuntime({ ...paths, office: 'codex', port: 0 });
  const socket = net.createConnection(runtime.server.address().port, '127.0.0.1');
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  socket.write('POST /api/chat HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"text":"partial');

  const closing = runtime.close({ graceMs: 20 });
  const withinDeadline = await Promise.race([closing.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 150))]);
  socket.destroy(); // Release the pre-fix close(), which waited forever for this request body.
  const result = await closing;
  runtimes.splice(runtimes.indexOf(runtime), 1);

  assert.equal(withinDeadline, true, 'close() should enforce graceMs for sockets even when no task has started');
  assert.equal(result.drained, false);
  assert.equal(result.pendingWork, 0);
});

test('launcher_twoOfficesRunIndependentTasksAtOnce', async () => {
  const claudePaths = fixture(), codexPaths = fixture();
  const task = (id, title) => ({ id, dept: 'emails', agent: 'elead', title, text: title, state: 'next', addedAt: Date.now(), plan: [] });
  fs.writeFileSync(path.join(claudePaths.dataRoot, 'tasks.json'), JSON.stringify([task('claude-task', 'Claude task')]));
  fs.writeFileSync(path.join(codexPaths.dataRoot, 'tasks.json'), JSON.stringify([task('codex-task', 'Codex task')]));
  let release;
  let started;
  const gate = new Promise(resolve => { release = resolve; });
  const bothStarted = new Promise(resolve => { started = resolve; });
  const calls = [];
  const runner = office => async () => {
    calls.push(office);
    if (calls.length === 2) started();
    await gate;
    return { result: `${office} completed`, read: [], tools: [], used: [], skills: [] };
  };
  const claude = await startRuntime({ ...claudePaths, office: 'claude', port: 0, runtimeOptions: { taskRunner: runner('claude') }, provider: { id: 'claude' } });
  const codex = await startRuntime({ ...codexPaths, office: 'codex', port: 0, runtimeOptions: { taskRunner: runner('codex') }, provider: { id: 'codex' } });
  const childHandles = [];
  const officeUrls = { claude: claude.base, codex: codex.base };
  const home = fixture();
  const launcher = createLauncher({
    config: {
      root: home.root, host: '127.0.0.1', port: home.port, env: {},
      claudePort: claude.runtime.server.address().port, codexPort: codex.runtime.server.address().port,
    },
    spawnProcess: () => { const child = new EventEmitter(); child.signals = []; child.kill = signal => child.signals.push(signal); childHandles.push(child); return child; },
    fetchHealth: async (_url, office) => ({ ...await fetch(`${officeUrls[office]}/api/health`).then(response => response.json()), url: officeUrls[office] }),
  });
  launchers.push(launcher);
  await launcher.start();
  const launcherBase = `http://127.0.0.1:${launcher.server.address().port}`;
  const requests = [
    fetch(`${claude.base}/api/tasks/claude-task/run`, { method: 'POST' }),
    fetch(`${codex.base}/api/tasks/codex-task/run`, { method: 'POST' }),
  ];
  try {
    let timeout;
    await Promise.race([bothStarted, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('both office tasks did not start concurrently')), 1000); })]);
    clearTimeout(timeout);
    assert.deepEqual(calls.sort(), ['claude', 'codex']);
    const readiness = await fetch(`${launcherBase}/api/health`).then(response => response.json());
    assert.equal(readiness.offices.claude.status, 'ready');
    assert.equal(readiness.offices.codex.status, 'ready');
    assert.deepEqual(childHandles.map(child => child.signals), [[], []], 'launcher-owned child handles stay alive while tasks run');
  } finally { release(); }
  const responses = await Promise.all(requests);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(claudePaths.dataRoot, 'tasks.json'), 'utf8'))[0].result, 'claude completed');
  assert.equal(JSON.parse(fs.readFileSync(path.join(codexPaths.dataRoot, 'tasks.json'), 'utf8'))[0].result, 'codex completed');
});

test('claudeSnapshotIsByteIdenticalAfterCodexStartup', async () => {
  const claudePaths = fixture(), codexPaths = fixture();
  const sentinel = path.join(claudePaths.root, 'office.config.local.json');
  fs.writeFileSync(sentinel, Buffer.from('{"model":"sonnet","preserve":"\u00e9"}\n'));
  fs.writeFileSync(path.join(claudePaths.dataRoot, 'tasks.json'), Buffer.from('[{"id":"claude-history"}]\n'));
  fs.writeFileSync(path.join(claudePaths.brainPath, 'claude-note.md'), Buffer.from('Claude-only fixture\n'));
  const rosterFile = path.join(claudePaths.root, 'office.agents.json');
  fs.writeFileSync(rosterFile, JSON.stringify({ agents: [{ id: 'elead', name: 'CLAUDE SNAPSHOT FIXTURE' }] }));
  const snapshotFiles = [sentinel, path.join(claudePaths.dataRoot, 'tasks.json'), path.join(claudePaths.brainPath, 'claude-note.md'), rosterFile];
  const snapshot = () => snapshotFiles.map(file => fs.readFileSync(file));
  const before = snapshot();
  const claude = await startRuntime({ ...claudePaths, office: 'claude', port: 0, provider: { id: 'claude' }, runtimeOptions: {
    rosterLoader: (brainPath, options) => loadRoster(brainPath, { ...options, root: claudePaths.root }),
  } });
  const codex = await startRuntime({ ...codexPaths, office: 'codex', port: 0, provider: { id: 'codex' } });
  assert.equal(claude.officeConfig.model, 'sonnet');
  assert.equal(codex.officeConfig.model, '');
  assert.equal(claude.officeConfig.configPath, sentinel);
  const claudeHealth = await fetch(`${claude.base}/api/health`).then(response => response.json());
  assert.equal(claudeHealth.roster.customised, 1);
  assert.equal(claudeHealth.agents.find(agent => agent.id === 'elead').name, 'CLAUDE SNAPSHOT FIXTURE');
  assert.ok(claudeHealth.roster.files.includes('office.agents.json'), 'Claude mode reads its explicit fixture root, not Codex roster semantics');
  const after = snapshot();
  assert.deepEqual(after, before);
  assert.equal(fs.existsSync(path.join(codexPaths.root, 'office.config.local.json')), false);
});

test('healthAndStorageDoNotCrossOfficeBoundaries', async () => {
  const claudePaths = fixture(), codexPaths = fixture();
  const claudeTasks = [{ id: 'claude-only', title: 'Claude fixture' }];
  const codexTasks = [{ id: 'codex-only', title: 'Codex fixture' }];
  fs.writeFileSync(path.join(claudePaths.dataRoot, 'tasks.json'), JSON.stringify(claudeTasks));
  fs.writeFileSync(path.join(codexPaths.dataRoot, 'tasks.json'), JSON.stringify(codexTasks));
  const claude = await startRuntime({ ...claudePaths, office: 'claude', port: 0, provider: { id: 'claude' } });
  const codex = await startRuntime({ ...codexPaths, office: 'codex', port: 0, provider: { id: 'codex' } });
  const [healthClaude, healthCodex, tasksClaude, tasksCodex] = await Promise.all([
    fetch(`${claude.base}/api/health`).then(response => response.json()),
    fetch(`${codex.base}/api/health`).then(response => response.json()),
    fetch(`${claude.base}/api/tasks`).then(response => response.json()),
    fetch(`${codex.base}/api/tasks`).then(response => response.json()),
  ]);
  assert.equal(healthClaude.office, 'claude');
  assert.equal(healthCodex.office, 'codex');
  assert.deepEqual(tasksClaude, claudeTasks);
  assert.deepEqual(tasksCodex, codexTasks);
  assert.notEqual(claudePaths.dataRoot, codexPaths.dataRoot);
  assert.notEqual(claudePaths.brainPath, codexPaths.brainPath);
});

test('restartingOneOfficePreservesOtherOfficeAndOwnTaskHistory', async () => {
  const claudePaths = fixture(), codexPaths = fixture();
  const claudeTasks = [{ id: 'claude-history', title: 'Claude history' }];
  const codexTasks = [{ id: 'codex-history', title: 'Codex history' }];
  fs.writeFileSync(path.join(claudePaths.dataRoot, 'tasks.json'), JSON.stringify(claudeTasks));
  fs.writeFileSync(path.join(codexPaths.dataRoot, 'tasks.json'), JSON.stringify(codexTasks));
  const claude = await startRuntime({ ...claudePaths, office: 'claude', port: 0, provider: { id: 'claude' } });
  const codex = await startRuntime({ ...codexPaths, office: 'codex', port: 0, provider: { id: 'codex' } });
  await claude.runtime.close({ graceMs: 0 });
  runtimes.splice(runtimes.indexOf(claude.runtime), 1);
  const codexHealth = await fetch(`${codex.base}/api/health`).then(response => response.json());
  const restartedClaude = await startRuntime({ ...claudePaths, office: 'claude', port: 0, provider: { id: 'claude' } });
  assert.equal(codexHealth.office, 'codex');
  assert.equal((await fetch(`${codex.base}/api/tasks`).then(response => response.json()))[0].id, 'codex-history');
  assert.equal((await fetch(`${restartedClaude.base}/api/tasks`).then(response => response.json()))[0].id, 'claude-history');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(codexPaths.dataRoot, 'tasks.json'), 'utf8')), codexTasks);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(claudePaths.dataRoot, 'tasks.json'), 'utf8')), claudeTasks);
});
