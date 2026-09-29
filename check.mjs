// Default project check is deliberately fixture-only. The former mixed UI/server smoke runner
// started serve.mjs against the checkout's default Claude configuration and queried usage/MCP,
// so it could reach local account/provider state even when CHECK_LIVE was unset.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
if (process.env.CHECK_LIVE === '1') {
  console.error('CHECK_LIVE=1 is not supported by the fixture-only check runner; no live checks were attempted.');
  process.exit(2);
}
const testDir = path.join(root, 'test');
const testFiles = fs.readdirSync(testDir)
  .filter(file => file.endsWith('.test.mjs'))
  .sort()
  .map(file => path.join(testDir, file));

if (testFiles.length === 0) {
  console.error('No fixture test files found.');
  process.exit(1);
}

console.log(`Running ${testFiles.length} local fixture test files; provider/auth and real office startup are not used.`);
const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
