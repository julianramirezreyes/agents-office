import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeUp } from '../onboard.mjs';

const lead = { id: 'email-lead', department: 'emails', lead: true, name: 'Emails Lead', role: 'Writer', does: 'writes email copy' };

async function writeGeneratedSkill(brainPath, name) {
  const generated = { briefs: [], skill: { name, agents: [lead.id], body: '# Skill\nSafe content.', description: '', template: '' }, try: '' };
  return writeUp([], {
    dept: 'emails', deptName: 'Emails', lead, agents: [lead], brainPath,
    ask: async () => JSON.stringify(generated),
  });
}

test('onboardSkillNamesKeepDotSegmentsInsideSkillsRootAndPreserveNormalNames', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'office-onboard-skill-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const skillsRoot = path.join(root, 'Agents Office', 'skills');
  const cases = [
    { input: '..', expected: 'emails-job' },
    { input: '.', expected: 'emails-job' },
    { input: '...', expected: '...' },
    { input: '..-draft', expected: '..-draft' },
    { input: 'draft..', expected: 'draft..' },
    { input: 'launch-email', expected: 'launch-email' },
    { input: 'nested/launch-email', expected: 'nested-launch-email' },
  ];

  for (const { input, expected } of cases) {
    const result = await writeGeneratedSkill(root, input);
    const directory = path.resolve(process.cwd(), result.skill.dir);
    const relative = path.relative(skillsRoot, directory);

    assert.equal(result.skill.name, expected, `normalized name for ${input}`);
    assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `directory for ${input} stays below the skills root`);
    assert.equal(fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf8').includes(`name: ${expected}`), true);
  }
  assert.equal(fs.existsSync(path.join(root, 'Agents Office', 'SKILL.md')), false);
});

test('onboardSkillUpdateStillBacksUpAnExistingValidSkill', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'office-onboard-backup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const skillDir = path.join(root, 'Agents Office', 'skills', 'launch-email');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'previous instructions\n');

  const result = await writeGeneratedSkill(root, 'launch-email');

  assert.equal(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8').includes('Safe content.'), true);
  const backup = fs.readdirSync(skillDir).find(name => /^SKILL\.md\.backup-\d+$/.test(name));
  assert.ok(backup);
  assert.equal(fs.readFileSync(path.join(skillDir, backup), 'utf8'), 'previous instructions\n');
  assert.match(result.problems.join('\n'), /old SKILL\.md is kept beside it/);
});
