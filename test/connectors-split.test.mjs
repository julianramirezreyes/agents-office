// Pure partition logic for the top-bar connector strip: which MCP server tiles render
// individually vs. collapse into one grey "+N" chip. No DOM — shared by src/mcp.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitConnectors } from '../src/connectors-split.js';

test('splitConnectors: connected servers are shown', () => {
  const servers = [
    { key: 'gmail', name: 'Gmail', status: 'connected' },
    { key: 'notion', name: 'Notion', status: 'connected' },
  ];
  const { shown, collapsed } = splitConnectors(servers);
  assert.deepEqual(shown.map(s => s.key), ['gmail', 'notion']);
  assert.deepEqual(collapsed, []);
});

test('splitConnectors: a server with no status (demo mode) is shown', () => {
  const servers = [{ key: 'gmail', name: 'Gmail' }];
  const { shown, collapsed } = splitConnectors(servers);
  assert.deepEqual(shown.map(s => s.key), ['gmail']);
  assert.deepEqual(collapsed, []);
});

test('splitConnectors: needs-auth and failed servers collapse', () => {
  const servers = [
    { key: 'gmail', name: 'Gmail', status: 'connected' },
    { key: 'slack', name: 'Slack', status: 'needs-auth' },
    { key: 'monday', name: 'Monday', status: 'failed' },
    { key: 'ms365', name: 'Microsoft 365', status: 'denied' },
  ];
  const { shown, collapsed } = splitConnectors(servers);
  assert.deepEqual(shown.map(s => s.key), ['gmail']);
  assert.deepEqual(collapsed.map(s => s.key), ['slack', 'monday', 'ms365']);
});

test('splitConnectors: chrome is always shown even when pending', () => {
  const servers = [
    { key: 'chrome', name: 'Chrome', status: 'pending' },
    { key: 'slack', name: 'Slack', status: 'needs-auth' },
  ];
  const { shown, collapsed } = splitConnectors(servers);
  assert.deepEqual(shown.map(s => s.key), ['chrome']);
  assert.deepEqual(collapsed.map(s => s.key), ['slack']);
});

test('splitConnectors: no unusable servers -> collapsed is empty (no chip)', () => {
  const servers = [{ key: 'gmail', name: 'Gmail', status: 'connected' }];
  const { collapsed } = splitConnectors(servers);
  assert.equal(collapsed.length, 0);
});

test('splitConnectors: preserves original order within each group', () => {
  const servers = [
    { key: 'a', name: 'A', status: 'failed' },
    { key: 'b', name: 'B', status: 'connected' },
    { key: 'c', name: 'C', status: 'needs-auth' },
    { key: 'd', name: 'D', status: 'connected' },
  ];
  const { shown, collapsed } = splitConnectors(servers);
  assert.deepEqual(shown.map(s => s.key), ['b', 'd']);
  assert.deepEqual(collapsed.map(s => s.key), ['a', 'c']);
});

test('splitConnectors: empty input yields empty groups', () => {
  const { shown, collapsed } = splitConnectors([]);
  assert.deepEqual(shown, []);
  assert.deepEqual(collapsed, []);
});
