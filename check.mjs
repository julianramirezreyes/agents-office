// Local checks use synthetic roots only. Never load this checkout's office config, roster,
// brain, or data; never spawn a real office process or invoke a provider/auth command.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { createOfficeRuntime } from './serve.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

function isolatedEnv(home) {
  const npmrc = path.join(home, '.npmrc');
  const globalNpmrc = path.join(home, '.npm-globalrc');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(npmrc, '');
  fs.writeFileSync(globalNpmrc, '');
  return {
    PATH: process.env.PATH || '', HOME: home, USERPROFILE: home, TMPDIR: home, TEMP: home, TMP: home,
    NPM_CONFIG_USERCONFIG: npmrc, NPM_CONFIG_GLOBALCONFIG: globalNpmrc, NPM_CONFIG_OFFLINE: 'true',
  };
}

function makeTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function buildSmoke(dependencyRoot, scratch) {
  const project = path.join(scratch, 'build-project');
  fs.mkdirSync(project, { recursive: true });
  for (const entry of ['src', 'assets']) {
    const source = path.join(dependencyRoot, entry);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(project, entry), { recursive: true });
  }
  for (const file of ['build.mjs', 'graph-build.mjs', 'config.mjs', 'office-paths.mjs', 'package.json']) {
    fs.copyFileSync(path.join(dependencyRoot, file), path.join(project, file));
  }
  const home = path.join(scratch, 'build-home');
  fs.mkdirSync(home, { recursive: true });
  fs.symlinkSync(path.join(dependencyRoot, 'node_modules'), path.join(project, 'node_modules'), 'dir');
  const brain = path.join(project, 'brain');
  fs.mkdirSync(brain, { recursive: true });
  fs.writeFileSync(path.join(brain, 'Smoke A.md'), 'Links to [[Smoke B]].\n');
  fs.writeFileSync(path.join(brain, 'Smoke B.md'), 'Synthetic build fixture.\n');
  fs.writeFileSync(path.join(project, 'office.config.json'), JSON.stringify({ brain: './brain' }));

  const build = spawnSync('npm', ['run', 'build'], {
    cwd: project, encoding: 'utf8', env: isolatedEnv(home), timeout: 120_000,
  });
  if (build.error) throw build.error;
  assert.equal(build.status, 0, `isolated build failed: ${build.stderr || build.stdout}`);
  for (const file of ['dist/command-centre-v2.html', 'dist/app.js', 'dist/dev.html', 'src/braingraph.js']) {
    assert.ok(fs.statSync(path.join(project, file)).size > 0, `${file} is generated in the temporary build root`);
  }
  return { project, html: path.join(project, 'dist/command-centre-v2.html'), output: build.stdout.trim() };
}

async function browserSmoke(html, dependencyRoot, scratch) {
  let chromium;
  try {
    ({ chromium } = await import(pathToFileURL(path.join(dependencyRoot, 'node_modules/playwright-core/index.mjs')).href));
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return { status: 'skipped', reason: 'playwright-core is unavailable; no installation attempted' };
    throw error;
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], env: isolatedEnv(path.join(scratch, 'browser-home')) });
  } catch (error) {
    if (/executable|browser.*not found|ENOENT/i.test(error.message)) return { status: 'skipped', reason: 'no local Playwright browser executable; no download attempted' };
    throw error;
  }
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
    assert.match(await page.title(), /Agents Office/);
    assert.equal(await page.locator('#scene').count(), 1);
    assert.deepEqual(errors, [], 'offline UI should load without uncaught browser errors');
    return { status: 'passed' };
  } finally {
    await browser.close();
  }
}

async function httpSmoke(scratch, calls) {
  const project = path.join(scratch, 'http-project');
  const home = path.join(scratch, 'http-home');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  const envKeys = ['HOME', 'USERPROFILE', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'TMPDIR', 'TEMP', 'TMP'];
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex'),
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'), TMPDIR: home, TEMP: home, TMP: home,
  });
  let runtime;
  try {
    fs.mkdirSync(path.join(project, 'brain-codex', 'Agents Office'), { recursive: true });
    fs.mkdirSync(path.join(project, 'data-codex'), { recursive: true });
    fs.writeFileSync(path.join(project, 'office.config.codex.local.json'), JSON.stringify({ brain: './brain-codex' }));
    fs.writeFileSync(path.join(project, 'brain-codex', 'Agents Office', 'agents.json'), JSON.stringify({ agents: [{ id: 'elead', name: 'SMOKE FIXTURE AGENT' }] }));
    fs.writeFileSync(path.join(project, 'data-codex', 'tasks.json'), JSON.stringify([{ id: 'fixture-task', title: 'Synthetic task' }]));
    const officeConfig = {
      ...loadConfig({ office: 'codex', root: project, env: { AO_CODEX_PORT: '0' } }),
      office: 'codex', provider: 'codex',
    };
    const provider = {
      id: 'codex',
      capabilities: () => ({ available: 'unknown', models: null, tools: null }),
      async runTask() { calls.providers++; throw new Error('provider double must not be invoked by read-only smoke'); },
    };
    runtime = await createOfficeRuntime({
      officeConfig, provider, dataRoot: officeConfig.dataRoot, brainPath: officeConfig.brainPath,
      usageFetch: async () => { calls.usage++; return { ok: false, reason: 'fixture' }; },
      discoverMcp: async () => { calls.mcp++; return []; },
    });
    await runtime.start();
    const base = `http://127.0.0.1:${runtime.server.address().port}`;
    const [health, tasks, usage, mcp, roster] = await Promise.all([
      fetch(`${base}/api/health`).then(response => response.json()),
      fetch(`${base}/api/tasks`).then(response => response.json()),
      fetch(`${base}/api/usage`).then(response => response.json()),
      fetch(`${base}/api/mcp`).then(response => response.json()),
      fetch(`${base}/api/agents`).then(response => response.json()),
    ]);
    assert.equal(health.office, 'codex');
    assert.equal(health.provider, 'codex');
    assert.equal(health.roster.customised, 1);
    assert.deepEqual(tasks.map(task => task.id), ['fixture-task']);
    assert.equal(roster.agents.find(agent => agent.id === 'elead').name, 'SMOKE FIXTURE AGENT');
    assert.equal(usage.source, 'codex');
    assert.equal(mcp.provider, 'codex');
  } finally {
    try {
      if (runtime) await runtime.close({ graceMs: 0 });
    } finally {
      for (const key of envKeys) {
        if (previousEnv[key] === undefined) delete process.env[key];
        else process.env[key] = previousEnv[key];
      }
    }
  }
}

/** Runs the former build, browser and HTTP smoke categories only on generated fixtures. */
export async function runSafeSmoke({ projectRoot: _projectRoot, dependencyRoot = root } = {}) {
  const scratch = makeTempRoot('agents-office-safe-check-');
  const calls = { providers: 0, usage: 0, mcp: 0 };
  try {
    const built = await buildSmoke(dependencyRoot, scratch);
    const browser = await browserSmoke(built.html, dependencyRoot, scratch);
    await httpSmoke(scratch, calls);
    assert.deepEqual(calls, { providers: 0, usage: 0, mcp: 0 });
    return { build: { status: 'passed', output: built.output }, browser, http: { status: 'passed' }, ...Object.fromEntries(Object.entries(calls).map(([key, value]) => [key, { calls: value }])) };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

async function main() {
  if (process.env.CHECK_LIVE === '1') {
    console.error('CHECK_LIVE=1 is not supported by the fixture-only check runner; no live checks were attempted.');
    process.exitCode = 2;
    return;
  }
  const testDir = path.join(root, 'test');
  const testFiles = fs.readdirSync(testDir).filter(file => file.endsWith('.test.mjs')).sort().map(file => path.join(testDir, file));
  if (testFiles.length === 0) throw new Error('No fixture test files found.');
  console.log('Running isolated build/browser/HTTP smoke checks against synthetic data.');
  const smoke = await runSafeSmoke({ projectRoot: root, dependencyRoot: root });
  console.log(`Build: ${smoke.build.status}; browser: ${smoke.browser.status}${smoke.browser.reason ? ` (${smoke.browser.reason})` : ''}; HTTP: ${smoke.http.status}; provider/usage/MCP calls: 0/0/0.`);
  const testHome = makeTempRoot('agents-office-test-home-');
  let result;
  try {
    result = spawnSync(process.execPath, ['--test', ...testFiles], { cwd: root, stdio: 'inherit', env: isolatedEnv(testHome) });
  } finally {
    fs.rmSync(testHome, { recursive: true, force: true });
  }
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
