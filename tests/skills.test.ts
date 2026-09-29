import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSkills, skillMetadata, type InstalledSkill } from '../lib/skills.ts';

const skills: InstalledSkill[] = [
  { id: 'a', name: 'pdf', description: 'Extract PDF documents, tables, and pages.', path: '/a', source: 'local' },
  { id: 'b', name: 'frontend-ui-engineering', description: 'Design and build React interfaces with accessible components.', path: '/b', source: 'local' },
  { id: 'c', name: 'matplotlib', description: 'Generate scientific plots and publication charts from data.', path: '/c', source: 'local' },
];
test('skills parse simple and multiline frontmatter', () => {
  assert.deepEqual(skillMetadata('---\nname: "pdf"\ndescription: Extract PDF documents\n---\n# PDF', 'fallback'), { name: 'pdf', description: 'Extract PDF documents' });
  assert.equal(skillMetadata('---\nname: chart\ndescription: >\n  Create plots\n  and charts\n---\nBody', 'fallback').description, 'Create plots and charts');
});
test('skill matching finds relevant capabilities and excludes unrelated tasks', () => {
  assert.equal(matchSkills(skills, 'Extract tables from this PDF document')[0]?.name, 'pdf');
  assert.equal(matchSkills(skills, 'Build accessible React interfaces')[0]?.name, 'frontend-ui-engineering');
  assert.deepEqual(matchSkills(skills, 'hello'), []);
  assert.equal(matchSkills(skills, 'Use matplotlib for this scientific plot')[0]?.name, 'matplotlib');
  assert.deepEqual(matchSkills([
    { id: 'd', name: 'write-swift', description: 'Write Swift apps and fix concurrency.', path: '/d', source: 'local' },
    { id: 'e', name: 'exploratory-data-analysis', description: 'Detailed analysis of scientific data files.', path: '/e', source: 'local' },
  ], 'Write a long detailed analysis of a fictional notes app with SQLite.'), []);
});
