// Local checks use synthetic roots only. Never load this checkout's office config, roster,
// brain, or data; never spawn a real office process or invoke a provider/auth command.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { loadRoster } from './roster.mjs';
import { loadSkills } from './skills.mjs';
import * as onboarding from './onboard.mjs';
import * as routines from './routines.mjs';
import * as teams from './teams.mjs';
import { modelFor, effortFor } from './src/models.js';
import { parseWhen } from './src/when.js';
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

export function canonicalFixtureRoot(projectRoot) {
  if (!projectRoot) throw new Error('A synthetic projectRoot is required for safe smoke checks.');
  const requested = path.resolve(projectRoot);
  const canonical = fs.realpathSync(requested);
  const tempRoot = fs.realpathSync(os.tmpdir());
  const relativeToTemp = path.relative(tempRoot, canonical);
  if (canonical !== requested || !relativeToTemp || relativeToTemp.startsWith('..') || path.isAbsolute(relativeToTemp)) {
    throw new Error('projectRoot must be a canonical temporary synthetic fixture root, never a symlink or checkout.');
  }
  return canonical;
}

export function isBrowserRequestAllowed(requestUrl, localOrigin) {
  try { return new URL(requestUrl).origin === localOrigin; } catch { return false; }
}

function localChromiumExecutable() {
  const configured = process.env.CHECK_BROWSER_EXECUTABLE;
  if (configured && path.isAbsolute(configured) && fs.existsSync(configured)) return configured;
  return ['/usr/bin/google-chrome', '/usr/bin/brave-browser'].find(file => fs.existsSync(file)) || '';
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

async function browserSmoke(project, html, dependencyRoot, scratch, executablePath = '') {
  let chromium;
  try {
    ({ chromium } = await import(pathToFileURL(path.join(dependencyRoot, 'node_modules/playwright-core/index.mjs')).href));
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return { status: 'skipped', reason: 'playwright-core is unavailable; no installation attempted' };
    throw error;
  }
  let context;
  const browserProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'aob-'));
  const browserHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aoh-'));
  try {
    context = await chromium.launchPersistentContext(path.join(browserProfile, 'p'), {
      ...(executablePath ? { executablePath } : {}),
      headless: true,
      viewport: { width: 1512, height: 900 },
      args: [
        '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-background-networking', '--disable-background-timer-throttling',
        '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--disable-sync',
        '--disable-translate', '--metrics-recording-only', '--no-first-run',
        '--disable-features=MediaRouter,OptimizationHints,AutofillServerCommunication,Translate',
      ],
      env: isolatedEnv(browserHome),
    });
  } catch (error) {
    if (/executable|browser.*not found|ENOENT/i.test(error.message)) return { status: 'skipped', reason: 'no local Playwright browser executable; no download attempted' };
    throw error;
  }
  const staticRoot = path.resolve(project);
  const server = http.createServer((req, res) => {
    const requested = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (requested.startsWith('/api/')) {
      const fixtures = {
        '/api/health': { ok: false, office: 'fixture', provider: 'none' },
        '/api/tasks': [], '/api/routines': { routines: [] }, '/api/usage': { ok: false, source: 'fixture' },
        '/api/brain': { notes: 0, nodes: [], links: [], floor: [] }, '/api/mcp': { servers: [], provider: 'none' },
        '/api/skills': { count: 0 }, '/api/lessons': { agents: [] }, '/api/agents': { agents: [] },
      };
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(fixtures[requested] ?? {}));
    }
    const file = path.resolve(staticRoot, `.${requested}`);
    if (!file.startsWith(`${staticRoot}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); return res.end();
    }
    const contentType = file.endsWith('.html') ? 'text/html; charset=utf-8'
      : file.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  let blockedExternalRequests = 0;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const localUrl = `http://127.0.0.1:${server.address().port}/${path.relative(staticRoot, html).split(path.sep).join('/')}?s=check`;
    const localOrigin = new URL(localUrl).origin;
    await context.route('**/*', route => {
      if (isBrowserRequestAllowed(route.request().url(), localOrigin)) return route.continue();
      blockedExternalRequests++;
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.setDefaultTimeout(2500);
    page.setDefaultNavigationTimeout(5000);
    const errors = [];
    const assertions = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !/ERR_BLOCKED_BY_CLIENT/.test(message.text())) errors.push(`${message.text().slice(0, 160)} (${message.location().url})`); });
    await page.goto(localUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
    assert.match(await page.title(), /Agents Office/);
    assert.equal(await page.locator('#scene').count(), 1);
    const departmentCards = await page.locator('.badge .b-name').allTextContents();
    for (const name of ['EMAILS', 'SALES', 'MARKETING', 'OPERATIONS', 'FINANCE', 'DELIVERY', 'THE BRAIN']) {
      assert.ok(departmentCards.some(card => card.trim().startsWith(name)), `department card ${name} is visible`);
    }
    assertions.push('department-cards');
    assert.ok(await page.locator('.tp-row').count() >= 10, 'demo task panel has seeded rows');
    assert.equal(await page.locator('.tp-chip').count(), 6, 'task panel exposes all department chips');
    assertions.push('task-panel');
    const clickUI = selector => page.locator(selector).evaluate(element => element.click());
    const fillUI = (selector, value) => page.locator(selector).evaluate((element, text) => {
      element.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.focus();
    }, value);
    assert.equal(await page.evaluate(() => Object.keys(window.CC.R).length), 35, 'synthetic UI retains the fixed roster');
    assertions.push('roster');
    await clickUI('.tp-dd');
    await clickUI('.tp-menu button[data-k="marketing"]');
    await fillUI('.tp-in', 'cut a synthetic teaser from the demo reel');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Added/.test(document.querySelector('.tp-hint').textContent), null, { timeout: 3000 });
    assert.ok(await page.evaluate(() => window.CC.tasks.tasks.some(task => /synthetic teaser/i.test(task.title))));
    assertions.push('command-bar');
    await clickUI('.tp-dd');
    await clickUI('.tp-menu button[data-k="sales"]');
    await fillUI('.tp-in', 'as a team, plan a synthetic outreach push');
    assert.match(await page.locator('.tp-hint:not(.tb-hint)').textContent(), /Team · SALES LEAD/, 'team parser identifies the lead before adding a task');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Added/.test(document.querySelector('.tp-hint').textContent), null, { timeout: 3000 });
    assert.ok(await page.evaluate(() => window.CC.tasks.tasks.some(task => /synthetic outreach push/i.test(task.title))));
    await page.waitForFunction(() => [...document.querySelectorAll('.tp-row .tp-t')].some(element => /synthetic outreach push/i.test(element.textContent)), null, { timeout: 3000 });
    const teamCards = await page.evaluate(() => {
      const task = window.CC.tasks.tasks.find(candidate => /synthetic outreach push/i.test(candidate.title));
      if (!task) return null;
      return {
        id: task.id,
        lead: task.agent,
        members: task.team?.members || [],
        pieces: window.CC.tasks.tasks.filter(candidate => candidate.piece && candidate.parent === task.id),
        leadRow: document.querySelector(`.tp-row[data-id="${task.id}"] .tp-t`)?.textContent || '',
        chips: [...document.querySelectorAll(`.tp-row[data-id="${task.id}"] .tp-team-chip, .tp-row.piece .tp-team-chip`)].map(element => element.textContent.trim()),
      };
    });
    assert.ok(teamCards);
    assert.match(teamCards.leadRow, /synthetic outreach push/i);
    assert.ok(teamCards.members.length >= 2 && teamCards.pieces.length >= 2, 'TEAM task expands into teammate pieces');
    assert.ok(teamCards.chips.some(chip => /^TEAM [34]$/.test(chip)) && teamCards.chips.includes('PIECE'));
    assertions.push('team');
    await clickUI('.tp-dd');
    await clickUI('.tp-menu button[data-k="emails"]');
    await fillUI('.tp-in', 'every weekday at 8am, triage the synthetic inbox');
    await page.waitForFunction(() => /Routine/.test(document.querySelector('.tp-hint').textContent), null, { timeout: 3000 }).catch(() => {});
    assert.match(await page.locator('.tp-hint:not(.tb-hint)').textContent(), /Routine/);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Routine set/.test(document.querySelector('.tp-hint').textContent), null, { timeout: 3000 }).catch(() => {});
    assert.match(await page.locator('.tp-hint:not(.tb-hint)').textContent(), /Routine set/);
    assert.equal(await page.evaluate(() => window.CC.routines().length), 1);
    assert.ok(await page.locator('.tp-row.sched .tp-t').filter({ hasText: 'triage the synthetic inbox' }).count() > 0, 'routine appears in the SCHEDULED feed');
    assert.match(await page.locator('.tp-next').textContent(), /NEXT/i);
    assertions.push('routine');
    await clickUI('#topCal');
    assert.equal(await page.locator('#calOv.on').count(), 1);
    const calendarCells = await page.locator('.cv-day').count();
    assert.ok(calendarCells === 35 || calendarCells === 42, `calendar has a month grid (${calendarCells} cells)`);
    assert.equal(await page.locator('.cv-day.today').count(), 1, 'calendar identifies today');
    assert.ok(await page.locator('.cv-ev.routine').count() > 0, 'calendar places the synthetic routine on its days');
    assert.ok(Number(await page.locator('#cvRtN').textContent()) >= 1, 'calendar routine rail is populated');
    const calendarDays = await page.locator('.cv-day').evaluateAll(elements => elements.map(element => element.dataset.day));
    const todayIndex = calendarDays.indexOf(await page.locator('.cv-day.today').getAttribute('data-day'));
    const targetDay = calendarDays[Math.min(calendarDays.length - 1, todayIndex + 2)];
    await clickUI(`.cv-day[data-day="${targetDay}"] .cv-add`);
    await page.locator('.cv-dept').selectOption('sales');
    await page.locator('.cv-text').fill('Synthetic calendar scheduled task');
    await clickUI('.cv-go');
    await page.waitForFunction(day => [...document.querySelectorAll('.cv-ev.sched')].some(event => event.closest('.cv-day').dataset.day === day), targetDay);
    assert.deepEqual(await page.locator('.cv-ev.sched').evaluateAll(elements => elements.map(event => event.closest('.cv-day').dataset.day)), [targetDay]);
    assert.equal(await page.evaluate(() => window.CC.tasks.tasks.filter(task => task.state === 'scheduled').length), 1);
    await clickUI(`.cv-day[data-day="${targetDay}"] .cv-add`);
    await page.locator('.cv-dept').selectOption('emails');
    await page.locator('.cv-text').fill('Synthetic date-start routine');
    await clickUI('.cv-rep');
    assert.match(await page.locator('.cv-hint').textContent(), /Routine ·.*first run/i);
    await clickUI('.cv-go');
    const dateRoutine = await page.evaluate(() => window.CC.tasks.routines.find(routine => /Synthetic date-start routine/i.test(routine.title)));
    assert.equal(dateRoutine.when.start, targetDay);
    assert.equal(await page.locator(`.cv-day[data-day="${targetDay}"] .cv-ev.routine`).filter({ hasText: 'Synthetic date-start routine' }).count(), 1, 'a date-start routine appears on its start date');
    const beforeStartOccurrences = await page.locator('.cv-day').evaluateAll((days, target) => days
      .filter(day => day.dataset.day < target)
      .flatMap(day => [...day.querySelectorAll('.cv-ev.routine')].map(event => event.textContent.trim()))
      .filter(text => /Synthetic date-start routine/i.test(text)), targetDay);
    assert.deepEqual(beforeStartOccurrences, [], 'a date-start routine is not rendered before its start date');
    await clickUI(`.cv-day[data-day="${targetDay}"] .cv-add`);
    await page.locator('.cv-dept').selectOption('marketing');
    await clickUI('.cv-rep');
    assert.match(await page.locator('.cv-hint').textContent(), /later release/i, 'marketing routine is refused');
    assert.equal(await page.locator('.cv-go').isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#cvPop').isHidden(), true, 'Escape closes the calendar popover');
    await clickUI('.cv-seg button[data-v="week"]');
    assert.equal(await page.locator('.cv-day').count(), 7, 'calendar week view has seven days');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#calOv').classList.contains('on'), null, { timeout: 3000 });
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('p');
    await page.waitForFunction(() => document.querySelector('#calOv').classList.contains('on'), null, { timeout: 3000 });
    assert.equal(await page.locator('#calOv.on').count(), 1, 'P opens calendar after navigating the calendar controls');
    assertions.push('calendar-grid', 'calendar-scheduling');
    await page.keyboard.press('Escape');
    await page.keyboard.press('b');
    await page.waitForFunction(() => window.CC.tasks.isOpen(), null, { timeout: 3000 });
    const board = await page.evaluate(() => ({
      columns: [...document.querySelectorAll('#board .lh')].map(element => element.textContent.trim()),
      scheduledCards: document.querySelectorAll('#board .tk.sched').length,
    }));
    assert.ok(board.columns.includes('SCHEDULED'), `board has a SCHEDULED column: ${board.columns.join(', ')}`);
    assert.ok(board.scheduledCards > 0, 'board displays the calendar scheduled task');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.CC.tasks.isOpen(), null, { timeout: 3000 });
    assert.equal(await page.evaluate(() => window.CC.tasks.isOpen()), false, 'Escape closes the board');
    assertions.push('board');
    await page.keyboard.press('1');
    await page.waitForFunction(() => /agentOpen/.test(document.getElementById('rail').className), null, { timeout: 3000 });
    assert.match(await page.locator('#rail').getAttribute('class'), /agentOpen/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !/agentOpen/.test(document.getElementById('rail').className), null, { timeout: 3000 });
    assertions.push('department-focus');
    await page.keyboard.press('g');
    await page.waitForFunction(() => window.CC.brain.isOpen(), null, { timeout: 3000 });
    assert.ok(await page.evaluate(() => window.CC.brain.nodes.length > 0));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.CC.brain.isOpen(), null, { timeout: 3000 });
    assert.equal(await page.evaluate(() => window.CC.brain.isOpen()), false, 'Escape closes the brain graph');
    assertions.push('brain-graph');
    assertions.push('keyboard');
    await page.evaluate(() => { window.CC.R.ada.state = 'working'; window.CC.requestApproval('ada'); });
    const approvalState = await page.evaluate(() => ({ waiting: window.CC.tasks.tasks.filter(task => task.state === 'waiting').length, ada: window.CC.R.ada.state }));
    assert.equal(approvalState.waiting, 1, 'approval request is represented as a waiting task');
    assert.notEqual(await page.locator('#topAppr').evaluate(element => getComputedStyle(element).display), 'none', 'approval indicator is shown in the panel chrome');
    assertions.push('approval');
    await page.evaluate(async () => { try { await fetch('https://example.invalid/blocked'); } catch {} });
    assert.ok(blockedExternalRequests > 0, 'browser routing blocks an external URL before network access');
    assert.deepEqual(errors, [], 'offline UI should load without uncaught browser errors');
    return { status: 'passed', blockedExternalRequests, assertions };
  } finally {
    try { if (context) await context.close(); } finally {
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(browserProfile, { recursive: true, force: true });
      fs.rmSync(browserHome, { recursive: true, force: true });
    }
  }
}

async function domainSmoke({ project, brainPath, agents, health, skillsResponse, routinesResponse, base, scratch }) {
  const assertions = [];
  assert.equal(agents.length, 35, 'roster keeps all 35 fixed seats');
  assert.ok(agents.every(agent => typeof agent.does === 'string' && agent.does.length > 0), 'each roster seat has its job description');
  assert.equal(health.setup.sales, false, 'unconfigured Sales remains eligible for the interview');
  const salesLead = agents.find(agent => agent.department === 'sales' && agent.lead);
  assert.equal(health.agents.find(agent => agent.id === salesLead.id).interviewer, true, 'Sales lead offers the setup interview');
  assertions.push('roster-contract', 'interview-unconfigured');

  assert.ok(health.skills.count > 0, 'shipped skills are reported');
  assert.equal(health.skills.brain, 1, 'one fixture skill is reported from the fixture brain');
  const fixtureSkill = skillsResponse.skills.find(skill => skill.name === 'fixture-workflow');
  assert.equal(fixtureSkill.source, 'brain');
  assert.deepEqual(fixtureSkill.agents, ['elead']);
  assert.ok(health.agents.find(agent => agent.id === 'elead').skills.includes('fixture-workflow'));
  assertions.push('skills-fixture');

  const interviewData = path.join(scratch, 'interview-data');
  const interview = await onboarding.handle('set up', {
    dept: 'sales', deptName: 'Sales', lead: salesLead, agents: agents.filter(agent => agent.department === 'sales'),
    connected: [], brainPath, dataDir: interviewData,
  });
  assert.match(interview.reply, /Five questions/i);
  assert.equal(onboarding.active(interviewData, 'sales'), true);
  const canceled = await onboarding.handle('cancel', { dept: 'sales', deptName: 'Sales', dataDir: interviewData });
  assert.match(canceled.reply, /Cancelled/i);
  assert.equal(onboarding.active(interviewData, 'sales'), false);

  const routineWhen = parseWhen('every weekday at 8am, triage the synthetic inbox').when;
  const validRoutine = routines.validate({ id: 'fixture-routine', dept: 'emails', agent: 'elead', title: 'Triage inbox', text: 'Triage the inbox', when: routineWhen }, agents);
  assert.deepEqual(validRoutine.problems, []);
  assert.deepEqual(routinesResponse.depts, ['emails', 'fin', 'sales']);
  assert.deepEqual(routinesResponse.routines, []);
  const marketingRoutine = await fetch(`${base}/api/routines`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'marketing', text: 'every day at 9am post the reel' }) });
  const refused = await marketingRoutine.json();
  assert.equal(marketingRoutine.status, 400);
  assert.match(refused.error, /later release/i);
  const needsTime = await fetch(`${base}/api/routines`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'emails', text: 'every weekday, triage the inbox' }) });
  assert.equal(needsTime.status, 400);
  assert.equal((await needsTime.json()).needsTime, true);
  const noSchedule = await fetch(`${base}/api/routines`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'sales', text: 'chase the quiet deals' }) });
  assert.equal(noSchedule.status, 400);
  assert.equal((await noSchedule.json()).noSchedule, true);
  assertions.push('routines-api');

  assert.deepEqual(modelFor({ task: 'opus', routine: 'fable', agent: 'sonnet', office: 'sonnet' }), { model: 'opus', from: 'task' });
  assert.deepEqual(modelFor({ routine: 'fable', agent: 'opus', office: 'sonnet' }), { model: 'fable', from: 'routine' });
  assert.deepEqual(effortFor({ office: 'max', model: 'opus' }), { effort: 'max', from: 'office' });
  assert.deepEqual(effortFor({ model: 'opus' }), { effort: 'high', from: 'model' });
  assertions.push('models');

  const usage = await fetch(`${base}/api/usage`);
  assert.equal(usage.status, 200, 'usage endpoint answers without a provider');
  const usageValue = await usage.json();
  assert.equal(usageValue.source, 'codex');
  assert.equal(usageValue.ok, false, 'unavailable usage is reported rather than fabricated as live');
  assertions.push('usage');

  const marketingSeats = agents.filter(agent => agent.department === 'marketing');
  const lead = marketingSeats.find(agent => agent.lead);
  assert.equal(teams.intent('as a team, plan a synthetic launch'), true);
  assert.equal(teams.intent('draft a plain email'), false);
  const plan = teams.parsePlan(JSON.stringify({ pieces: [
    { agent: marketingSeats.find(agent => !agent.lead).id, title: 'Audience', text: 'Map the audience.' },
    { agent: lead.id, title: 'Brief', text: 'Prepare the creative brief.' },
    { agent: 'not-a-seat', title: 'Ignored', text: 'Do not accept.' },
  ] }), { seats: marketingSeats, lead, max: 4 });
  assert.equal(plan.pieces.length, 2);
  assert.equal(plan.solo, false);
  assertions.push('team-parser');
  return assertions;
}

async function httpSmoke(project, scratch, calls) {
  const home = path.join(scratch, 'http-home');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  const envKeys = ['HOME', 'USERPROFILE', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'TMPDIR', 'TEMP', 'TMP', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDECODE'];
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex'),
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'), TMPDIR: home, TEMP: home, TMP: home,
  });
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDECODE']) delete process.env[key];
  let runtime;
  try {
    fs.mkdirSync(path.join(project, 'brain-codex', 'Agents Office'), { recursive: true });
    fs.mkdirSync(path.join(project, 'data-codex'), { recursive: true });
    if (!fs.existsSync(path.join(project, 'brain-codex', 'smoke.md'))) {
      fs.writeFileSync(path.join(project, 'brain-codex', 'smoke.md'), 'Synthetic brain note.\n');
    }
    if (!fs.existsSync(path.join(project, 'office.config.codex.local.json'))) {
      fs.writeFileSync(path.join(project, 'office.config.codex.local.json'), JSON.stringify({ name: 'Synthetic Codex Office', brain: './brain-codex' }));
    }
    if (!fs.existsSync(path.join(project, 'brain-codex', 'Agents Office', 'agents.json'))) {
      fs.writeFileSync(path.join(project, 'brain-codex', 'Agents Office', 'agents.json'), JSON.stringify({ agents: [{ id: 'elead', name: 'SMOKE FIXTURE AGENT' }] }));
    }
    const skillFile = path.join(project, 'brain-codex', 'Agents Office', 'skills', 'fixture', 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      fs.mkdirSync(path.dirname(skillFile), { recursive: true });
      fs.writeFileSync(skillFile, '---\nname: fixture-workflow\ndescription: Fixture-only workflow\nagents: [elead]\n---\nFollow the synthetic workflow.\n');
    }
    if (!fs.existsSync(path.join(project, 'data-codex', 'tasks.json'))) {
      fs.writeFileSync(path.join(project, 'data-codex', 'tasks.json'), JSON.stringify([{ id: 'fixture-task', title: 'Synthetic task' }]));
    }
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
      rosterLoader: (brain, options) => loadRoster(brain, { ...options, root: project }),
      usageFetch: async () => { calls.usage++; return { ok: false, reason: 'fixture' }; },
      discoverMcp: async () => { calls.mcp++; return []; },
    });
    await runtime.start();
    const base = `http://127.0.0.1:${runtime.server.address().port}`;
    const [health, tasks, usage, mcp, roster, brain, skills, lessons, routines] = await Promise.all([
      fetch(`${base}/api/health`).then(response => response.json()),
      fetch(`${base}/api/tasks`).then(response => response.json()),
      fetch(`${base}/api/usage`).then(response => response.json()),
      fetch(`${base}/api/mcp`).then(response => response.json()),
      fetch(`${base}/api/agents`).then(response => response.json()),
      fetch(`${base}/api/brain`).then(response => response.json()),
      fetch(`${base}/api/skills`).then(response => response.json()),
      fetch(`${base}/api/lessons`).then(response => response.json()),
      fetch(`${base}/api/routines`).then(response => response.json()),
    ]);
    const fixtureRoster = JSON.parse(fs.readFileSync(path.join(project, 'brain-codex', 'Agents Office', 'agents.json'), 'utf8'));
    const expectedAgentName = fixtureRoster.agents.find(agent => agent.id === 'elead').name;
    assert.equal(health.office, 'codex');
    assert.equal(health.provider, 'codex');
    assert.equal(health.roster.customised, 1);
    assert.deepEqual(tasks.map(task => task.id), ['fixture-task']);
    assert.equal(roster.agents.find(agent => agent.id === 'elead').name, expectedAgentName);
    assert.equal(brain.notes, 1, 'brain endpoint reads the supplied fixture root');
    assert.ok(Number.isInteger(skills.count));
    assert.deepEqual(lessons.agents, []);
    assert.deepEqual(routines.routines, []);
    assert.equal(usage.source, 'codex');
    assert.equal(mcp.provider, 'codex');
    const domainAssertions = await domainSmoke({ project, brainPath: officeConfig.brainPath, agents: roster.agents, health, skillsResponse: skills, routinesResponse: routines, base, scratch });
    const missing = await fetch(`${base}/api/not-a-route`);
    assert.equal(missing.status, 404);
    const crossOfficeQuery = await fetch(`${base}/api/health?office=claude`);
    assert.equal(crossOfficeQuery.status, 400);
    assert.equal(health.name, officeConfig.name, 'health endpoint uses the fixture config supplied to loadConfig');
    return { name: health.name, agentName: expectedAgentName, taskIds: tasks.map(task => task.id), assertions: domainAssertions };
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
export async function runSafeSmoke({ projectRoot, dependencyRoot = root, browserExecutablePath = '' } = {}) {
  const fixtureRoot = canonicalFixtureRoot(projectRoot);
  const scratch = makeTempRoot('agents-office-safe-check-');
  const calls = { providers: 0, usage: 0, mcp: 0 };
  try {
    const built = await buildSmoke(dependencyRoot, scratch);
    const http = await httpSmoke(fixtureRoot, scratch, calls);
    const browser = await browserSmoke(built.project, built.html, dependencyRoot, scratch, browserExecutablePath);
    assert.deepEqual(calls, { providers: 0, usage: 0, mcp: 0 });
    return { build: { status: 'passed', output: built.output }, browser, http: { status: 'passed', ...http }, ...Object.fromEntries(Object.entries(calls).map(([key, value]) => [key, { calls: value }])) };
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
  const fixtureRoot = makeTempRoot('agents-office-check-fixture-');
  const smoke = await runSafeSmoke({ projectRoot: fixtureRoot, dependencyRoot: root, browserExecutablePath: localChromiumExecutable() }).finally(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  console.log(`Build: ${smoke.build.status}; browser: ${smoke.browser.status}${smoke.browser.reason ? ` (${smoke.browser.reason})` : ` [${smoke.browser.assertions.join(', ')}; ${smoke.browser.blockedExternalRequests} external requests blocked]`}; HTTP: ${smoke.http.status}; provider/usage/MCP calls: 0/0/0.`);
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
