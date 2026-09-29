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
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function safeOfficeUrl(candidate, configuredUrl) {
  if (candidate == null || candidate === '') return { url: configuredUrl };
  let target, configured;
  try {
    target = new URL(candidate);
    configured = new URL(configuredUrl);
  } catch { return { error: 'Office health returned an invalid URL' }; }
  if (!['http:', 'https:'].includes(target.protocol)
    || target.username || target.password
    || !LOCAL_HOSTS.has(target.hostname)
    || target.origin !== configured.origin
    || target.port !== configured.port) {
    return { error: 'Office health returned an unsafe or inconsistent URL' };
  }
  return { url: target.href };
}

export function officeOriginAllowed(origin, officeOrigins) {
  if (typeof origin !== 'string' || !origin || origin === 'null') return false;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !Array.isArray(officeOrigins)) return false;
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    if (!LOCAL_HOSTS.has(hostname)) return false;
    return officeOrigins.some(configuredOrigin => {
      try {
        const configured = new URL(configuredOrigin);
        return configured.protocol === parsed.protocol && configured.port === parsed.port;
      } catch { return false; }
    });
  } catch { return false; }
}

function response(res, status, body, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function processEnvironment(office, paths, launcherUrl) {
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
    AO_LAUNCHER_URL: launcherUrl,
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
  const configuredUrls = Object.fromEntries(OFFICES.map(office => {
    return [office, `http://127.0.0.1:${paths[office].port}`];
  }));
  const officeOrigins = OFFICES.map(office => new URL(configuredUrls[office]).origin);
  const officeState = Object.fromEntries(OFFICES.map(office => [office, {
    office,
    provider: office,
    status: 'starting',
    url: configuredUrls[office],
    error: null,
    pendingWork: null,
  }]));
  const children = new Map();
  let startPromise = null;
  let closePromise = null;
  let isClosing = false;

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
          const health = await fetchHealth(configuredUrls[office], office);
          if (children.get(office) !== owned || owned.exit || owned.failure) return;
          if (health?.office !== office || health?.provider !== office) {
            state.status = 'failed';
            state.error = 'Office health identity does not match the launched office';
            return;
          }
          const effective = safeOfficeUrl(health.url || health.baseUrl, configuredUrls[office]);
          if (effective.error) {
            state.status = 'failed';
            state.error = effective.error;
            return;
          }
          state.url = effective.url;
          const pendingWork = Number(health.pendingWork ?? health.pendingTasks);
          state.pendingWork = Number.isSafeInteger(pendingWork) && pendingWork >= 0 ? pendingWork : null;
          state.status = health.ok === true ? 'ready' : 'failed';
          state.error = health.ok === true ? null : (health.error || 'Office health did not report ready');
        } catch (error) {
          if (children.get(office) !== owned || owned.exit || owned.failure) return;
          state.status = 'failed';
          state.error = String(error?.message || error);
        }
      }));
      const origin = req.headers.origin;
      const corsHeaders = { vary: 'Origin' };
      if (officeOriginAllowed(origin, officeOrigins)) corsHeaders['access-control-allow-origin'] = origin;
      return response(res, 200, { ok: true, offices: Object.fromEntries(OFFICES.map(office => [office, { ...officeState[office] }])) }, 'application/json; charset=utf-8', corsHeaders);
    }
    return response(res, 404, { error: 'not found' });
  });

  async function start() {
    if (isClosing || closePromise) throw new Error('Launcher is closing or already closed');
    if (startPromise) return startPromise;
    startPromise = (async () => {
      if (!LOCAL_HOSTS.has(host)) throw new Error('Launcher host must be a loopback address');
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

      const address = server.address();
      const launcherHost = address.family === 'IPv6' ? `[${address.address}]` : address.address;
      const launcherUrl = `http://${launcherHost}:${address.port}`;

      for (const office of OFFICES) {
        try {
          const child = spawnProcess(process.execPath, [path.join(root, 'serve.mjs')], {
            cwd: root,
            env: processEnvironment(office, paths[office], launcherUrl),
            stdio: 'ignore',
          });
          const owned = { child, exit: null, failure: null, stopping: false };
          children.set(office, owned);
          child.once?.('error', error => {
            if (!owned.stopping) {
              owned.failure = String(error?.message || error);
              officeState[office].status = 'failed';
              officeState[office].error = owned.failure;
            }
          });
          child.once?.('exit', (code, signal) => {
            owned.exit = { code, signal };
            if (!owned.stopping) {
              officeState[office].status = 'failed';
              owned.failure ||= `Office process exited unexpectedly (${signal || code})`;
              officeState[office].error = owned.failure;
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
    isClosing = true;
    closePromise = (async () => {
      if (startPromise) {
        try { await startPromise; } catch { /* a failed start may still have an owned listener/child to close */ }
      }
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
