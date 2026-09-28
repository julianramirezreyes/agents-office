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
  const c = { name: 'Agents Office', brain: office === 'codex' ? './brain-codex' : './brain', port: office === 'codex' ? 4521 : 4520, model: 'sonnet', ...base, ...local }; // V3.6: model = sonnet · opus · fable
  c.mcp = { allow: [], deny: [], departments: {}, ...(base.mcp || {}), ...(local.mcp || {}) };
  c.tools = { web: true, browser: true, ...(base.tools || {}), ...(local.tools || {}) }; // V3.2 (16 Sep): browser = Claude in Chrome
  c.teams = { enabled: true, max: 4, ...(base.teams || {}), ...(local.teams || {}) }; // V3.2 (16 Sep): Agent Teams
  if (env.AO_NAME) c.name = env.AO_NAME;
  const brainOverride = office === 'claude' ? (env.AO_CLAUDE_BRAIN || env.AO_BRAIN) : env.AO_CODEX_BRAIN;
  if (brainOverride) c.brain = brainOverride;
  const portOverride = env[office === 'codex' ? 'AO_CODEX_PORT' : 'AO_CLAUDE_PORT'] || (office === 'claude' && env.PORT);
  if (portOverride) c.port = paths?.port ?? Number(portOverride);
  if (env.AO_MODEL) c.model = env.AO_MODEL;
  c.port = +c.port || (office === 'codex' ? 4521 : 4520);
  c.brainPath = path.resolve(root, c.brain);
  if (paths) Object.assign(c, { configPath: paths.configPath, dataRoot: paths.dataRoot, brainPath: path.resolve(root, c.brain), codexHome: paths.codexHome });
  return c;
}
