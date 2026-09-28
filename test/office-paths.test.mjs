import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig, ROOT } from '../config.mjs';
import { resolveOfficePaths, validateOfficePair } from '../office-paths.mjs';

const temporary = fn => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-office-paths-'));
  try { return fn(directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
};

const isolatedEnv = values => ({ ...values });

test('loadConfig_withoutOffice_keepsClaudeDefaults', () => {
  const old = Object.fromEntries(['AO_NAME', 'AO_BRAIN', 'AO_CLAUDE_BRAIN', 'AO_CLAUDE_PORT', 'PORT', 'AO_MODEL'].map(key => [key, process.env[key]]));
  for (const key of Object.keys(old)) delete process.env[key];
  try {
    const config = loadConfig();
    assert.equal(config.port, 4520);
    assert.equal(config.brain, './brain');
    assert.equal(config.brainPath, path.join(ROOT, 'brain'));
  } finally {
    for (const [key, value] of Object.entries(old)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test('loadConfig_withoutOptionsStillAcceptsLegacyAndClaudePortEnvironment', () => {
  const old = { PORT: process.env.PORT, AO_CLAUDE_PORT: process.env.AO_CLAUDE_PORT };
  delete process.env.PORT;
  process.env.AO_CLAUDE_PORT = '4610';
  try { assert.equal(loadConfig().port, 4610); }
  finally {
    for (const [key, value] of Object.entries(old)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test('resolveOfficePaths_usesSeparateCodexWritableRoots', () => temporary(root => {
  const claude = resolveOfficePaths({ office: 'claude', env: isolatedEnv({}), root });
  const codex = resolveOfficePaths({ office: 'codex', env: isolatedEnv({}), root });
  assert.deepEqual(claude, {
    office: 'claude', port: 4520,
    configPath: path.join(root, 'office.config.local.json'),
    dataRoot: path.join(root, 'data'), brainPath: path.join(root, 'brain'), codexHome: undefined,
  });
  assert.deepEqual(codex, {
    office: 'codex', port: 4521,
    configPath: path.join(root, 'office.config.codex.local.json'),
    dataRoot: path.join(root, 'data-codex'), brainPath: path.join(root, 'brain-codex'), codexHome: undefined,
  });
  assert.equal(validateOfficePair(claude, codex, 4519).ok, true);
}));

test('resolveOfficePaths_honorsPerOfficeConfigDataAndBrainOverrides', () => temporary(root => {
  const paths = resolveOfficePaths({ office: 'codex', root, env: isolatedEnv({
    AO_CODEX_CONFIG: './custom/codex.json', AO_CODEX_DATA: './state/codex', AO_CODEX_BRAIN: './notes/codex', AO_CODEX_PORT: '4801',
  }) });
  assert.equal(paths.configPath, path.join(root, 'custom/codex.json'));
  assert.equal(paths.dataRoot, path.join(root, 'state/codex'));
  assert.equal(paths.brainPath, path.join(root, 'notes/codex'));
  assert.equal(paths.port, 4801);
}));

test('validateOfficePair_rejectsCanonicalPathAliases', () => temporary(root => {
  const shared = path.join(root, 'shared');
  const alias = path.join(root, 'alias');
  fs.mkdirSync(shared);
  fs.symlinkSync(shared, alias, 'dir');
  const claude = resolveOfficePaths({ office: 'claude', root, env: isolatedEnv({ AO_CLAUDE_DATA: './alias' }) });
  const codex = resolveOfficePaths({ office: 'codex', root, env: isolatedEnv({ AO_CODEX_DATA: './shared' }) });
  const result = validateOfficePair(claude, codex, 4519);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /data/i);
}));

test('validateOfficePair_rejectsDuplicatePorts', () => temporary(root => {
  const claude = resolveOfficePaths({ office: 'claude', root, env: isolatedEnv({ AO_CLAUDE_PORT: '4600' }) });
  const codex = resolveOfficePaths({ office: 'codex', root, env: isolatedEnv({ AO_CODEX_PORT: '4600' }) });
  const result = validateOfficePair(claude, codex, 4601);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /port/i);
}));

test('validateOfficePair_doesNotTouchExistingClaudeFiles', () => temporary(root => {
  const configPath = path.join(root, 'office.config.local.json');
  const dataFile = path.join(root, 'data', 'tasks.json');
  const brainNote = path.join(root, 'brain', 'sentinel.md');
  for (const [file, content] of [[configPath, '{"sentinel":"config"}'], [dataFile, '[{"sentinel":"data"}]'], [brainNote, 'existing brain']]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  const before = [configPath, dataFile, brainNote].map(file => ({ file, content: fs.readFileSync(file), stat: fs.statSync(file) }));
  const claude = resolveOfficePaths({ office: 'claude', root, env: isolatedEnv({}) });
  const codex = resolveOfficePaths({ office: 'codex', root, env: isolatedEnv({}) });
  assert.equal(validateOfficePair(claude, codex, 4519).ok, true);
  for (const { file, content, stat } of before) {
    assert.deepEqual(fs.readFileSync(file), content);
    const after = fs.statSync(file);
    assert.equal(after.ino, stat.ino);
    assert.equal(after.size, stat.size);
    assert.equal(after.mtimeMs, stat.mtimeMs);
  }
  assert.equal(fs.existsSync(path.join(root, 'office.config.codex.local.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'data-codex')), false);
  assert.equal(fs.existsSync(path.join(root, 'brain-codex')), false);
}));

test('resolveOfficePaths_inheritsExplicitCodexHomeOnlyForCodex', () => temporary(root => {
  const env = isolatedEnv({ CODEX_HOME: './codex-home' });
  assert.equal(resolveOfficePaths({ office: 'codex', root, env }).codexHome, path.join(root, 'codex-home'));
  assert.equal(resolveOfficePaths({ office: 'claude', root, env }).codexHome, undefined);
}));
