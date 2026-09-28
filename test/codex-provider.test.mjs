import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCodexProvider } from '../codex-provider.mjs';
import { createOfficeRuntime } from '../serve.mjs';
import { loadConfig } from '../config.mjs';
import { loadRoster } from '../roster.mjs';

function deferredRun({ threadId = 'thread-1', events = [], completed = {} } = {}) {
  const calls = { constructor: [], thread: [], run: [] };
  class FakeCodex {
    constructor(options) { calls.constructor.push(options); }
    startThread(options) {
      calls.thread.push(options);
      return {
        id: threadId,
        async runStreamed(prompt) {
          calls.run.push(prompt);
          return { events: (async function* () { yield* events; })(), completed: Promise.resolve(completed) };
        },
      };
    }
  }
  return { sdk: { Codex: FakeCodex }, calls };
}

test('codexProvider_reusesSdkLocalLoginWithoutReadingCredentials', async () => {
  const fake = deferredRun({ events: [{ type: 'thread.started', thread_id: 'thread-local' }, { type: 'item.completed', item: { type: 'agent_message', text: 'Done' } }] });
  const provider = createCodexProvider({ sdk: fake.sdk, workspaceRoot: process.cwd(), codexHome: '/home/codex' });
  const result = await provider.runTask({ taskId: 'task-1', prompt: 'Do work' });
  assert.equal(result.threadId, 'thread-local');
  assert.equal(result.text, 'Done');
  assert.equal(fake.calls.constructor.length, 1);
  assert.equal(fake.calls.constructor[0], undefined, 'SDK must inherit its normal process environment');
});

test('codexProvider_pinsWorkspaceModelSandboxAndApprovalPolicy', async () => {
  const fake = deferredRun({ events: [{ type: 'thread.started', thread_id: 't' }, { type: 'item.completed', item: { type: 'agent_message', text: 'ok' } }] });
  const provider = createCodexProvider({ sdk: fake.sdk, workspaceRoot: process.cwd(), policy: { sandboxMode: 'workspace-write', approvalPolicy: 'on-request' } });
  await provider.runTask({ taskId: 'task', prompt: 'run', cwd: process.cwd(), model: 'codex-custom', approvalPolicy: 'on-request' });
  assert.deepEqual(fake.calls.thread[0], { workingDirectory: process.cwd(), model: 'codex-custom', sandboxMode: 'workspace-write', approvalPolicy: 'on-request' });
});

test('codexProvider_exposesOnlyRuntimeReportedModelsAndTools', () => {
  const provider = createCodexProvider({ sdk: deferredRun().sdk, workspaceRoot: '/workspace' });
  assert.deepEqual(provider.capabilities(), { available: 'unknown', models: null, tools: null, controls: { sandbox: 'workspace-write', approval: 'on-request' } });
});

test('codexProvider_marksUnsupportedApprovalAsPendingWithoutBroadeningPolicy', async () => {
  const fake = deferredRun();
  const provider = createCodexProvider({ sdk: fake.sdk, workspaceRoot: '/workspace', policy: { approvalPolicy: 'on-request' } });
  const result = await provider.runTask({ taskId: 'task', prompt: 'send', approvalPolicy: 'never' });
  assert.equal(result.status, 'blocked');
  assert.equal(result.threadId, undefined);
  assert.equal(fake.calls.thread.length, 0);
});

test('codexProvider_blocksInvalidConfiguredPolicyWithoutReplacingItWithBroaderDefaults', async () => {
  const fake = deferredRun();
  const provider = createCodexProvider({ sdk: fake.sdk, workspaceRoot: process.cwd(), policy: { sandboxMode: 'invalid', approvalPolicy: 'invalid' } });
  const result = await provider.runTask({ taskId: 'task', prompt: 'work' });
  assert.equal(result.status, 'blocked');
  assert.match(result.error, /configured Codex policy/i);
  assert.equal(fake.calls.thread.length, 0);
});

test('codexProvider_doesNotInventIntermediateProgressWhenSdkReturnsOnlyFinal', async () => {
  const fake = deferredRun({ events: [{ type: 'thread.started', thread_id: 'thread-final' }, { type: 'item.completed', item: { type: 'agent_message', text: 'Only final' } }] });
  const events = [];
  const provider = createCodexProvider({ sdk: fake.sdk, workspaceRoot: process.cwd() });
  const result = await provider.runTask({ taskId: 'task', prompt: 'work', onEvent: event => events.push(event) });
  assert.equal(result.text, 'Only final');
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.type), ['thread.started', 'item.completed']);
});

test('codexProvider_preservesTaskOnMissingLoginRateLimitAndProviderError', async () => {
  for (const message of ['Codex unavailable', 'rate limit reached', 'provider error']) {
    const fake = deferredRun();
    fake.sdk.Codex.prototype.startThread = () => ({ id: 't', async runStreamed() { throw new Error(message); } });
    const provider = createCodexProvider({ sdk: fake.sdk, workspaceRoot: process.cwd() });
    const result = await provider.runTask({ taskId: 'task-preserved', prompt: 'work' });
    assert.equal(result.status, 'failed');
    assert.equal(result.threadId, 't');
    assert.equal(result.error, message);
    assert.equal(result.text, '');
  }
});

test('codexProvider_neverFallsBackToClaude', async () => {
  const provider = createCodexProvider({ sdk: { Codex: class { startThread() { throw new Error('Codex failed'); } } }, workspaceRoot: process.cwd() });
  const result = await provider.runTask({ taskId: 'task', prompt: 'work' });
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'Codex failed');
  assert.equal(result.provider, 'codex');
});

test('codexProvider_rejectsCwdSymlinkEscapingWorkspaceBeforeStartingSdk', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-workspace-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-outside-'));
  const link = path.join(root, 'linked-project');
  fs.symlinkSync(outside, link, 'dir');
  const fake = deferredRun();
  const provider = createCodexProvider({ sdk: fake.sdk, workspaceRoot: root });
  try {
    const result = await provider.runTask({ taskId: 'symlink-escape', prompt: 'work', cwd: link });
    assert.equal(result.status, 'blocked');
    assert.equal(fake.calls.constructor.length, 0);
    assert.equal(fake.calls.thread.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('codexRuntime_runsPersistedTasksThroughCodexWithoutClaudeCapabilities', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'office-codex-provider-'));
  const dataRoot = path.join(root, 'data');
  const brainPath = path.join(root, 'brain');
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(brainPath, { recursive: true });
  const lead = loadRoster(brainPath, { office: 'codex' }).agents.find(agent => agent.department === 'emails' && agent.lead);
  fs.writeFileSync(path.join(dataRoot, 'tasks.json'), JSON.stringify([{ id: 'persisted-task', dept: 'emails', agent: lead.id, title: 'Prepare report', text: 'Summarize the week', state: 'next', addedAt: Date.now(), plan: [] }]));
  const fake = deferredRun({ events: [{ type: 'thread.started', thread_id: 'real-sdk-thread' }, { type: 'item.completed', item: { type: 'agent_message', text: 'Report ready' } }, { type: 'turn.completed', usage: { input_tokens: 9, output_tokens: 3 } }] });
  const runtime = await createOfficeRuntime({
    officeConfig: { ...loadConfig(), office: 'codex', provider: 'codex', port: 0, dataRoot, brainPath },
    provider: { id: 'codex', sdk: fake.sdk, policy: { sandboxMode: 'workspace-write', approvalPolicy: 'on-request' } },
  });
  try {
    await runtime.start();
    const base = `http://127.0.0.1:${runtime.server.address().port}`;
    const response = await fetch(`${base}/api/tasks/persisted-task/run`, { method: 'POST' });
    const task = await response.json();
    assert.equal(response.status, 200);
    assert.equal(task.providerStatus, 'completed');
    assert.equal(task.threadId, 'real-sdk-thread');
    assert.equal(task.result, 'Report ready');
    assert.equal(task.error, false);
    assert.deepEqual(task.usage, { input_tokens: 9, output_tokens: 3 });
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.provider, 'codex');
    assert.deepEqual(health.capabilities.models, null);
    assert.deepEqual(health.capabilities.tools, null);
    assert.equal(health.tools, false);
    assert.equal(health.agents.every(agent => agent.model === '' && agent.tools.length === 0), true);
    assert.equal(fake.calls.thread[0].workingDirectory, path.resolve(process.cwd()));
  } finally {
    await runtime.close({ graceMs: 100 });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('codexRuntime_doesNotMarkFailedCodexApprovalAsApproved', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'office-codex-approval-'));
  const dataRoot = path.join(root, 'data');
  const brainPath = path.join(root, 'brain');
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(brainPath, { recursive: true });
  const lead = loadRoster(brainPath, { office: 'codex' }).agents.find(agent => agent.department === 'emails' && agent.lead);
  fs.writeFileSync(path.join(dataRoot, 'tasks.json'), JSON.stringify([{ id: 'approval-task', dept: 'emails', agent: lead.id, title: 'Send report', text: 'Send the report', state: 'waiting', needsOk: true, draft: 'Draft report', addedAt: Date.now(), plan: [] }]));
  const calls = [];
  const runtime = await createOfficeRuntime({
    officeConfig: { ...loadConfig(), office: 'codex', provider: 'codex', port: 0, dataRoot, brainPath },
    provider: { id: 'codex', async runTask(input) { calls.push(input); return { status: 'blocked', error: 'Approval cannot be resumed safely', text: '', provider: 'codex' }; } },
  });
  try {
    await runtime.start();
    const base = `http://127.0.0.1:${runtime.server.address().port}`;
    const response = await fetch(`${base}/api/tasks/approval-task/approve`, { method: 'POST' });
    assert.equal(response.status, 200);
    for (let i = 0; i < 100; i++) {
      const task = JSON.parse(fs.readFileSync(path.join(dataRoot, 'tasks.json'), 'utf8'))[0];
      if (task.state === 'done') {
        assert.equal(task.error, true);
        assert.equal(task.providerStatus, 'blocked');
        assert.equal(task.approved, false);
        assert.equal(task.approvedAt, undefined);
        assert.match(task.result, /Approval cannot be resumed safely/);
        assert.equal(calls.length, 1);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('Codex approval attempt did not settle the task');
  } finally {
    await runtime.close({ graceMs: 100 });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
