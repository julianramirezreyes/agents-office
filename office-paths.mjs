import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';

const DEFAULTS = {
  claude: { port: 4520, configPath: 'office.config.local.json', dataRoot: 'data', brainPath: './brain' },
  codex: { port: 4521, configPath: 'office.config.codex.local.json', dataRoot: 'data-codex', brainPath: './brain-codex' },
};

function canonicalPath(value) {
  const absolute = path.resolve(value);
  let cursor = absolute;
  const tail = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return absolute;
    tail.unshift(path.basename(cursor));
    cursor = parent;
  }
  try { return path.resolve(fs.realpathSync(cursor), ...tail); }
  catch { return absolute; }
}

function isSameOrNested(left, right) {
  const relative = path.relative(left, right);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function pathSetting(office, key, env, root) {
  const prefix = office === 'claude' ? 'AO_CLAUDE' : 'AO_CODEX';
  const legacy = office === 'claude' && key === 'brainPath' ? env.AO_BRAIN : undefined;
  const suffix = key === 'configPath' ? 'CONFIG' : key === 'dataRoot' ? 'DATA' : 'BRAIN';
  const configured = env[`${prefix}_${suffix}`] || legacy || DEFAULTS[office][key];
  return path.resolve(root, configured);
}

export function resolveOfficePaths({ office, env = process.env, root = ROOT } = {}) {
  if (!Object.hasOwn(DEFAULTS, office)) throw new TypeError(`Unknown office: ${office}`);
  const base = path.resolve(root);
  const prefix = office === 'claude' ? 'AO_CLAUDE' : 'AO_CODEX';
  const legacyPort = office === 'claude' ? env.PORT : undefined;
  const port = Number(env[`${prefix}_PORT`] || legacyPort || DEFAULTS[office].port);
  return {
    office,
    port,
    configPath: pathSetting(office, 'configPath', env, base),
    dataRoot: pathSetting(office, 'dataRoot', env, base),
    brainPath: pathSetting(office, 'brainPath', env, base),
    codexHome: office === 'codex' && env.CODEX_HOME ? path.resolve(base, env.CODEX_HOME) : undefined,
  };
}

export function validateOfficePair(claude, codex, launcherPort) {
  const errors = [];
  const ports = [
    ['launcher', Number(launcherPort)], ['claude', Number(claude.port)], ['codex', Number(codex.port)],
  ];
  for (const [name, port] of ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push(`${name} port must be an integer from 1 to 65535`);
  }
  const seenPorts = new Set();
  for (const [name, port] of ports) {
    if (seenPorts.has(port)) errors.push(`${name} port ${port} is duplicated`);
    seenPorts.add(port);
  }

  const writes = [
    ['Claude config', claude.configPath], ['Claude data', claude.dataRoot], ['Claude brain', claude.brainPath],
    ['Codex config', codex.configPath], ['Codex data', codex.dataRoot], ['Codex brain', codex.brainPath],
  ].map(([label, target]) => ({ label, target: canonicalPath(target) }));
  for (let i = 0; i < writes.length; i++) {
    for (let j = i + 1; j < writes.length; j++) {
      const left = writes[i];
      const right = writes[j];
      if (isSameOrNested(left.target, right.target) || isSameOrNested(right.target, left.target)) {
        errors.push(`${left.label} and ${right.label} paths overlap`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
