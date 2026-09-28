// V3.7: top-bar connector strip fit. With 37 MCP servers connected, the needs-auth/failed
// tiles (26 of them on the owner's machine) overflowed #topconn and pushed the brand and the
// right-hand controls off-screen. Pure partition, no DOM: which server tiles render individually
// (`shown`) vs. collapse into one grey "+N" chip (`collapsed`) — used by src/mcp.js.
export function splitConnectors(servers) {
  const shown = [];
  const collapsed = [];
  for (const s of servers || []) {
    const usable = s.status == null || s.status === 'connected';
    if (usable || s.key === 'chrome') shown.push(s); // Chrome renders as today even while pending pairing
    else collapsed.push(s);
  }
  return { shown, collapsed };
}
