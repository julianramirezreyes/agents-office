// Agents Office — configuration (Beta).
// office.config.json is the shipped default; office.config.local.json (gitignored) overrides it;
// environment variables override both: AO_NAME, AO_BRAIN, PORT, AO_MODEL.
// V3.1 keys: mcp { allow, deny, departments } · tools { web } · timeout (seconds per agent run) — see mcp.mjs.
// V3.2 (16 Sep) keys: tools { browser } (Claude in Chrome for the agents, default on) · teams { enabled, max } (Agent Teams, default on, up to 4 desks) — see teams.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOfficePaths } from './office-paths.mjs';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

export function loadConfig(options) {
  const managed = options !== undefined;
  const root = path.resolve(options?.root || ROOT);
  const env = options?.env || process.env;
  const office = options?.office || 'claude';
  const paths = managed ? resolveOfficePaths({ office, env, root }) : undefined;
  const base = readJSON(path.join(root, 'office.config.json'));
  const local = readJSON(paths?.configPath || path.join(root, 'office.config.local.json'));
  const defaults = office === 'codex'
    ? { name: 'Agents Office', brain: './brain-codex', port: 4521, model: '' }
    : { name: 'Agents Office', brain: './brain', port: 4520, model: 'sonnet' };
  const shared = { ...base };
  const officeLocal = { ...local };
  if (office === 'codex') {
    // Shared app config carries Claude-specific defaults and capabilities.
    for (const key of ['brain', 'port', 'model', 'mcp', 'tools', 'teams']) delete shared[key];
    // These capabilities are only valid when the Codex runtime reports them.
    for (const key of ['mcp', 'tools', 'teams']) delete officeLocal[key];
  }
  const c = {
    ...defaults, ...shared, ...officeLocal,
    mcp: office === 'codex' ? { allow: [], deny: [], departments: {} } : { allow: [], deny: [], departments: {}, ...(base.mcp || {}), ...(local.mcp || {}) },
    tools: office === 'codex' ? { web: false, browser: false } : { web: true, browser: true, ...(base.tools || {}), ...(local.tools || {}) },
    teams: office === 'codex' ? { enabled: false, max: 0 } : { enabled: true, max: 4, ...(base.teams || {}), ...(local.teams || {}) },
  }; // Claude capabilities are not assumed to be available in the Codex runtime.
  if (env.AO_NAME) c.name = env.AO_NAME;
  const brainOverride = office === 'claude' ? (env.AO_CLAUDE_BRAIN || env.AO_BRAIN) : env.AO_CODEX_BRAIN;
  if (brainOverride) c.brain = brainOverride;
  const portOverride = env[office === 'codex' ? 'AO_CODEX_PORT' : 'AO_CLAUDE_PORT'] || (office === 'claude' && env.PORT);
  if (portOverride) c.port = paths?.port ?? Number(portOverride);
  if (office === 'claude' && env.AO_MODEL) c.model = env.AO_MODEL;
  if (office === 'codex' && env.AO_CODEX_MODEL) c.model = env.AO_CODEX_MODEL;
  c.port = office === 'codex' ? Number(c.port) : (+c.port || 4520);
  c.brainPath = path.resolve(root, c.brain);
  if (paths) Object.assign(c, { configPath: paths.configPath, dataRoot: paths.dataRoot, brainPath: path.resolve(root, c.brain), codexHome: paths.codexHome });
  return c;
}
