import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { fromSummary, loadConnectors } from '../src/connectors.js';
import { emptyConnectorMessage, escapeHtml, modelBrandsForProvider, officeControls, providerDisplayName, providerUsageStatus, updateOfficeSwitch } from '../src/office-ui.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shell = fs.readFileSync(path.join(root, 'src/shell.html'), 'utf8');
const home = fs.readFileSync(path.join(root, 'home.html'), 'utf8');
const tasks = fs.readFileSync(path.join(root, 'src/tasks.js'), 'utf8');
const calendar = fs.readFileSync(path.join(root, 'src/calendar.js'), 'utf8');

function fakeLink() {
  return {
    hidden: true,
    href: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
  };
}

test('home_showsSeparateReadinessAndEntriesForBothOffices', () => {
  for (const office of ['claude', 'codex']) {
    const article = home.match(new RegExp(`<article[^>]*data-office="${office}"[\\s\\S]*?<\\/article>`))?.[0];
    assert.ok(article, `home has a separate ${office} card`);
    assert.match(article, /data-status/);
    assert.match(article, /data-enter/);
  }
});

test('office_switchLinkUsesRuntimeTargetRatherThanHardcodedURL', async () => {
  const link = fakeLink();
  const status = { textContent: '' };
  await updateOfficeSwitch({
    office: 'claude', launcherUrl: 'http://127.0.0.1:4519', link, status,
    fetcher: async () => ({ ok: true, json: async () => ({ offices: {
      codex: { office: 'codex', provider: 'codex', status: 'ready', url: 'http://127.0.0.1:49872/' },
    } }) }),
  });
  assert.equal(link.href, 'http://127.0.0.1:49872/');
  assert.equal(link.hidden, false);
  assert.doesNotMatch(shell, /(?:https?:)?\/\/127\.0\.0\.1:45(?:20|21)/);
});

test('office_switchShowsDestinationReasonWithoutChangingSourceReadiness', async () => {
  const link = fakeLink();
  const status = { textContent: '' };
  await updateOfficeSwitch({
    office: 'claude', launcherUrl: 'http://127.0.0.1:4519', link, status,
    fetcher: async () => ({ ok: true, json: async () => ({ offices: {
      codex: { office: 'codex', provider: 'codex', status: 'failed', error: 'Codex SDK is unavailable' },
    } }) }),
  });
  assert.equal(link.hidden, true);
  assert.equal(link.href, '');
  assert.match(status.textContent, /Codex SDK is unavailable/);
  assert.match(status.title, /Codex SDK is unavailable/);
});

test('office_switchLinkHasAccessibleName', () => {
  assert.match(shell, /<a\b[^>]*aria-label="Switch office"/);
});

test('office_switchAcceptsTheConfiguredIPv6LoopbackRuntime', async () => {
  const link = fakeLink();
  const status = { textContent: '' };
  await updateOfficeSwitch({
    office: 'codex', launcherUrl: 'http://[::1]:4519', link, status,
    fetcher: async () => ({ ok: true, json: async () => ({ offices: {
      claude: { office: 'claude', provider: 'claude', status: 'ready', url: 'http://[::1]:4520/' },
    } }) }),
  });
  assert.equal(link.hidden, false);
  assert.equal(link.href, 'http://[::1]:4520/');
});

test('navigationDoesNotCallTaskCancellation', async () => {
  const requested = [];
  const link = fakeLink();
  await updateOfficeSwitch({
    office: 'codex', launcherUrl: 'http://127.0.0.1:4519', link, status: { textContent: '' },
    fetcher: async url => { requested.push(url); return { ok: true, json: async () => ({ offices: { claude: { office: 'claude', provider: 'claude', status: 'ready', url: 'http://127.0.0.1:4520/' } } }) }; },
  });
  assert.deepEqual(requested, ['http://127.0.0.1:4519/api/health']);
});

test('codexControlsExcludeClaudeAliasesAndUnsupportedTools', () => {
  const controls = officeControls({
    office: 'codex', provider: 'codex', models: ['sonnet', 'claude-sonnet-5', 'gpt-5.6-codex'], teams: { enabled: true },
    capabilities: { teams: false, tools: null },
  });
  assert.deepEqual(controls.models, ['gpt-5.6-codex']);
  assert.equal(controls.showEffort, false);
  assert.equal(controls.showTeams, false);
  assert.deepEqual(controls.tools, []);
});

test('claudeControlsRetainTheExistingModelAndEffortOptions', () => {
  const controls = officeControls({ provider: 'claude', models: ['sonnet', 'opus', 'fable'], efforts: ['low', 'high'], teams: { enabled: true }, mcp: { servers: [{ name: 'Drive', status: 'connected' }] } });
  assert.deepEqual(controls.models, ['sonnet', 'opus', 'fable']);
  assert.equal(controls.showEffort, true);
  assert.equal(controls.showTeams, true);
  assert.deepEqual(controls.tools, ['Drive']);
});

test('unidentifiedProviderDoesNotInheritClaudeControls', () => {
  const controls = officeControls({ models: ['sonnet', 'opus'], efforts: ['high'], teams: { enabled: true }, capabilities: { tools: ['unverified-tool'] } });
  assert.deepEqual(controls.models, []);
  assert.equal(controls.showEffort, false);
  assert.equal(controls.showTeams, false);
  assert.deepEqual(controls.tools, []);
});

test('usageLabelsIdentifyProviderSource', () => {
  assert.equal(providerUsageStatus('codex', { ok: false, source: 'codex', reason: 'Usage is not reported by this runtime' }), 'CODEX · USAGE UNAVAILABLE · Usage is not reported by this runtime');
  assert.equal(providerUsageStatus('claude', { ok: true, source: 'claude' }), 'CLAUDE · USAGE AVAILABLE');
});

test('codexRuntimeModelMarkupEscapesUntrustedHtmlPayloads', () => {
  const payload = '<img src=x onerror="alert(1)">';
  const escaped = escapeHtml(payload);
  assert.equal(escaped, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(escaped.includes('<img'), false);
});

test('providerCopyDoesNotAttributeCodexWorkToClaude', () => {
  assert.equal(providerDisplayName('codex'), 'Codex');
  assert.equal(providerDisplayName('claude'), 'Claude');
  assert.equal(providerDisplayName('unknown'), 'office runtime');
});

test('codexModelLayerDoesNotDisplayClaudeOrChatGPTBranding', () => {
  assert.deepEqual(modelBrandsForProvider('codex'), []);
  assert.deepEqual(modelBrandsForProvider('claude'), ['claude', 'chatgpt']);
  assert.deepEqual(modelBrandsForProvider('unknown'), []);
  assert.equal(fromSummary({ provider: 'codex', servers: [] }, []).provider, 'codex');
});

test('connectorLoadRetainsProviderIdentityWhenMcpSummaryIsUnavailable', async () => {
  const previousLocation = globalThis.location;
  globalThis.location = { protocol: 'http:' };
  try {
    const connectors = await loadConnectors({ fetcher: async url => {
      if (url === '/api/mcp') return { ok: false };
      if (url === '/api/agents') return { ok: true, json: async () => ({ agents: [] }) };
      return { ok: true, json: async () => ({ ok: true, office: 'codex', provider: 'codex' }) };
    } });
    assert.equal(connectors.provider, 'codex');
    assert.deepEqual(modelBrandsForProvider(connectors.provider), []);
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
  }
});

test('failedLiveTaskSubmissionDoesNotCreateADemoTask', () => {
  const submission = tasks.match(/async function submit\(\)[\s\S]*?function addTask\(/)?.[0] || '';
  assert.match(submission, /catch \(e\) \{[\s\S]*?P_\.input\.value\s*=\s*text/);
  assert.doesNotMatch(submission, /catch \(e\) \{[^}]*addTask\(/);
  assert.match(tasks, /No task was added; your text is still here to retry/);
});

test('runtimeModelIdsAreEscapedAtEveryModelLabelTemplate', () => {
  assert.doesNotMatch(tasks, /<[^`]*\$\{displayModel\(/s);
  assert.match(tasks, /escapeHtml\(displayModel\(r\.model \|\| officeModel\)\)/);
});

test('codexProgressAndCalendarCopyUseTheActiveProviderName', () => {
  assert.match(tasks, /Routing through \$\{runtimeName\(\)\}/);
  assert.match(tasks, /sending with \$\{runtimeName\(\)\}/);
  assert.match(calendar, /\$\{runtimeName\(\)\} is naming the agent/);
  assert.doesNotMatch(calendar, /Claude names the agent|Claude is naming the agent/);
});

test('codexEmptyConnectorStateDoesNotSuggestClaudeSetupCommands', () => {
  assert.equal(emptyConnectorMessage('codex'), 'No connectors are available in this office.');
  assert.equal(emptyConnectorMessage('unknown'), 'No connectors are available in this office.');
  assert.equal(emptyConnectorMessage('claude'), 'nothing yet — connect in claude.ai or run: claude mcp add');
});
