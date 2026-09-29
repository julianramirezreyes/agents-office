const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);
const CLAUDE_MODEL_ALIASES = new Set(['sonnet', 'opus', 'fable']);
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export function providerDisplayName(provider) {
  return provider === 'claude' ? 'Claude' : provider === 'codex' ? 'Codex' : 'office runtime';
}

export function chatHistoryForRequest(history) {
  return (Array.isArray(history) ? history : [])
    .filter(message => message && ['user', 'agent'].includes(message.who) && typeof message.text === 'string')
    .map(({ who, text }) => ({ who, text: text.slice(-4000) }))
    .slice(-8);
}

export function chatFailureMessage(provider, reason) {
  return `${providerDisplayName(provider)} chat failed: ${String(reason || 'request unavailable').slice(0, 240)}`;
}

export function modelBrandsForProvider(provider) {
  return provider === 'claude' ? ['claude', 'chatgpt'] : [];
}

export function emptyConnectorMessage(provider) {
  return provider === 'claude'
    ? 'nothing yet — connect in claude.ai or run: claude mcp add'
    : 'No connectors are available in this office.';
}

const isClaudeAlias = model => {
  const value = String(model).trim().toLowerCase();
  return CLAUDE_MODEL_ALIASES.has(value) || /^claude[-_. ]*(sonnet|opus|fable)(?:[-_. ]|$)/.test(value);
};

function localHttpUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !LOOPBACK.has(hostname)) return null;
    return url;
  } catch { return null; }
}

export function officeControls(health = {}) {
  const provider = ['claude', 'codex'].includes(health.provider) ? health.provider : 'unknown';
  const reportedModels = Array.isArray(health.models) ? health.models : [];
  const models = provider === 'codex'
    ? reportedModels.filter(model => typeof model === 'string' && model.trim() && !isClaudeAlias(model))
    : provider === 'claude' ? reportedModels.filter(model => typeof model === 'string') : [];
  const capabilities = health.capabilities || {};
  return {
    provider,
    models,
    showModel: models.length > 0,
    showEffort: provider === 'claude' && Array.isArray(health.efforts) && health.efforts.length > 0,
    showTeams: health.teams?.enabled === true && (provider === 'claude' || capabilities.teams === true),
    tools: provider === 'claude'
      ? (health.mcp?.servers || []).filter(server => server?.status === 'connected').map(server => server.name).filter(Boolean)
      : provider === 'codex' && Array.isArray(capabilities.tools) ? capabilities.tools.filter(tool => typeof tool === 'string') : [],
  };
}

export function providerUsageStatus(provider, usage) {
  const name = String(provider || usage?.provider || 'office').toUpperCase();
  if (usage?.ok) return `${name} · USAGE AVAILABLE`;
  const reason = String(usage?.reason || 'No usage data reported').trim();
  return `${name} · USAGE UNAVAILABLE · ${reason}`;
}

export async function updateOfficeSwitch({ office, launcherUrl, link, status, fetcher = fetch }) {
  const showStatus = message => { status.textContent = message; status.title = message; };
  link.hidden = true;
  link.removeAttribute('href');
  showStatus('');
  const peer = office === 'claude' ? 'codex' : office === 'codex' ? 'claude' : null;
  const base = localHttpUrl(launcherUrl);
  if (!peer || !base) {
    showStatus('Office switch target is not available / El destino de la otra oficina no está disponible.');
    return;
  }
  try {
    const response = await fetcher(new URL('/api/health', base).href, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Launcher health returned HTTP ${response.status}`);
    const data = await response.json();
    const target = data?.offices?.[peer];
    const targetUrl = target?.status === 'ready' && target?.office === peer && target?.provider === peer
      ? localHttpUrl(target.url)
      : null;
    if (!targetUrl) {
      const reason = target?.error || 'destination office is not ready';
      showStatus(`${peer === 'codex' ? 'Codex' : 'Claude'} office unavailable: ${reason} / ${peer === 'codex' ? 'La oficina Codex' : 'La oficina Claude'} no está disponible.`);
      return;
    }
    link.href = targetUrl.href;
    link.hidden = false;
  } catch (error) {
    showStatus(`Office switch unavailable: ${error?.message || error} / La navegación entre oficinas no está disponible.`);
  }
}
