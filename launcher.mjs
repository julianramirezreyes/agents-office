import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './config.mjs';
import { resolveOfficePaths, validateOfficePair } from './office-paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = fs.readFileSync(path.join(HERE, 'home.html'), 'utf8');
const OFFICES = ['claude', 'codex'];

function response(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function processEnvironment(office, paths) {
  const env = { ...process.env };
  const prefix = office === 'claude' ? 'AO_CLAUDE' : 'AO_CODEX';
  Object.assign(env, {
    AO_OFFICE: office,
    AO_PROVIDER: office,
    [`${prefix}_CONFIG`]: paths.configPath,
    [`${prefix}_DATA`]: paths.dataRoot,
    [`${prefix}_BRAIN`]: paths.brainPath,
    [`${prefix}_PORT`]: String(paths.port),
    PORT: String(paths.port),
    AO_BRAIN: paths.brainPath,
  });
  if (office === 'codex' && paths.codexHome) env.CODEX_HOME = paths.codexHome;
  return env;
}

/** Owns only the child handles returned by its own spawnProcess calls. */
export function createLauncher({
  config = {},
  spawnProcess = spawn,
  fetchHealth = async url => {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error(`Office health returned HTTP ${response.status}`);
    return response.json();
  },
  graceMs = 5000,
} = {}) {
  const root = path.resolve(config.root || ROOT);
  const env = config.env || process.env;
  const launcherPort = Number(config.port ?? config.launcherPort ?? 4519);
  const host = config.host || '127.0.0.1';
  const officeEnv = (office, port) => {
    const prefix = office === 'claude' ? 'AO_CLAUDE' : 'AO_CODEX';
    return { ...env, ...(port === undefined ? {} : { [`${prefix}_PORT`]: String(port) }) };
  };
  const paths = {
    claude: config.claude || resolveOfficePaths({ office: 'claude', env: officeEnv('claude', config.claudePort), root }),
    codex: config.codex || resolveOfficePaths({ office: 'codex', env: officeEnv('codex', config.codexPort), root }),
  };
  const officeState = Object.fromEntries(OFFICES.map(office => [office, {
    office,
    provider: office,
    status: 'starting',
    url: `http://${host}:${paths[office].port}`,
    error: null,
    health: null,
    pendingWork: null,
  }]));
  const children = new Map();
  let startPromise = null;
  let closePromise = null;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/home.html')) {
      return response(res, 200, HOME, 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      await Promise.all(OFFICES.map(async office => {
        const state = officeState[office];
        const owned = children.get(office);
        if (!owned || owned.exit) return;
        try {
          const health = await fetchHealth(state.url, office);
          state.health = health;
          state.pendingWork = Number(health?.pendingWork ?? health?.pendingTasks ?? 0) || 0;
          state.url = health?.url || health?.baseUrl || state.url;
          state.status = health?.ok === false ? 'failed' : 'ready';
          state.error = health?.ok === false ? (health.error || 'Office health reported not ready') : null;
        } catch (error) {
          state.status = 'failed';
          state.error = String(error?.message || error);
        }
      }));
      return response(res, 200, { ok: true, offices: Object.fromEntries(OFFICES.map(office => [office, { ...officeState[office] }])) });
    }
    return response(res, 404, { error: 'not found' });
  });

  async function start() {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      const validation = validateOfficePair(paths.claude, paths.codex, launcherPort);
      if (!validation.ok) throw new Error(`Invalid launcher configuration: ${validation.errors.join('; ')}`);
      if (!OFFICES.includes('claude') || !OFFICES.includes('codex')) throw new Error('Both offices are required');

      await new Promise((resolve, reject) => {
        const onError = error => { server.off('listening', onListening); reject(error); };
        const onListening = () => { server.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(launcherPort, host);
      });

      for (const office of OFFICES) {
        try {
          const child = spawnProcess(process.execPath, [path.join(root, 'serve.mjs')], {
            cwd: root,
            env: processEnvironment(office, paths[office]),
            stdio: 'ignore',
          });
          const owned = { child, exit: null, stopping: false };
          children.set(office, owned);
          child.once?.('error', error => {
            if (!owned.stopping) {
              officeState[office].status = 'failed';
              officeState[office].error = String(error?.message || error);
            }
          });
          child.once?.('exit', (code, signal) => {
            owned.exit = { code, signal };
            if (!owned.stopping) {
              officeState[office].status = 'failed';
              officeState[office].error = `Office process exited unexpectedly (${signal || code})`;
            }
          });
        } catch (error) {
          officeState[office].status = 'failed';
          officeState[office].error = String(error?.message || error);
        }
      }
      return server.address();
    })();
    return startPromise;
  }

  async function close({ graceMs: requestedGrace = graceMs } = {}) {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      const deadlineMs = Math.max(0, Number(requestedGrace) || 0);
      const stopServer = server.listening
        ? new Promise(resolve => server.close(resolve))
        : Promise.resolve();
      const ownedChildren = [...children.entries()].map(([office, owned]) => ({ office, owned }));
      for (const { owned } of ownedChildren) {
        if (!owned.exit && !owned.stopping) {
          owned.stopping = true;
          try { owned.child.kill('SIGTERM'); } catch { /* only this owned handle is signalled */ }
        }
      }
      const exits = Promise.all(ownedChildren.map(({ owned }) => owned.exit
        ? Promise.resolve()
        : new Promise(resolve => owned.child.once?.('exit', resolve))));
      let timer;
      const drained = await Promise.race([
        Promise.all([stopServer, exits]).then(() => true),
        new Promise(resolve => { timer = setTimeout(() => resolve(false), deadlineMs); }),
      ]);
      clearTimeout(timer);
      if (!drained && server.listening) server.closeAllConnections?.();
      const pending = ownedChildren.filter(({ owned }) => !owned.exit).map(({ office }) => ({
        office,
        pendingWork: officeState[office].pendingWork,
        message: 'Office process did not exit within the grace period; unfinished work remains in its own office state.',
      }));
      for (const { office, owned } of ownedChildren) {
        if (owned.exit) officeState[office].status = 'stopped';
        else officeState[office].status = 'pending-shutdown';
      }
      return { drained: drained && pending.length === 0, pending, offices: Object.fromEntries(OFFICES.map(office => [office, { ...officeState[office] }])) };
    })();
    return closePromise;
  }

  return { server, start, close };
}
