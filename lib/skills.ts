import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

export type InstalledSkill = { id: string; name: string; description: string; path: string; source: string };
type Catalog = { skills: InstalledSkill[]; roots: string[]; scannedAt: number; warnings: string[] };
let cached: Promise<Catalog> | undefined;
let cachedAt = 0;

export function skillRoots(): string[] {
  const home = homedir();
  const extra = (process.env.NEXUS_SKILL_PATHS || '').split(';').filter(Boolean);
  return [...new Set([join(home, '.agents', 'skills'), join(home, '.codex', 'skills'),
    join(home, '.codex', 'plugins', 'cache'), ...extra])];
}

/** Only local deployments discover host skills; operators can explicitly opt out. */
export async function discoverSkills(refresh = false): Promise<Catalog> {
  if (process.env.NEXUS_DISABLE_LOCAL_SKILLS === 'true' || process.env.VERCEL) {
    return { skills: [], roots: [], scannedAt: Date.now(), warnings: ['Local PC skills are available when Nexus runs on your computer.'] };
  }
  if (!refresh && cached && Date.now() - cachedAt < 60_000) return cached;
  cachedAt = Date.now();
  cached = scanSkills();
  try { return await cached; } catch (error) { cached = undefined; throw error; }
}

async function scanSkills(): Promise<Catalog> {
  const roots = skillRoots();
  const warnings: string[] = [];
  const skills: InstalledSkill[] = [];
  const seen = new Set<string>();
  let directories = 0;
  const walk = async (root: string, directory: string, depth: number): Promise<void> => {
    if (depth > 8 || directories++ > 8000 || skills.length >= 1500) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { if (directory === root) warnings.push(`Skill folder not available: ${root}`); return; }
    if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
      const path = join(directory, 'SKILL.md');
      try {
        if ((await stat(path)).size > 256_000) return;
        const text = await readFile(path, 'utf8');
        const metadata = skillMetadata(text, directory.split(/[\\/]/).at(-1) || 'skill');
        const duplicate = metadata.name.toLowerCase();
        if (!seen.has(duplicate)) {
          seen.add(duplicate);
          skills.push({ id: createHash('sha256').update(path).digest('hex').slice(0, 16),
            ...metadata, path, source: relative(root, directory) || 'local' });
        }
      } catch { warnings.push(`Could not read ${path}`); }
      // Instructions, not a repository crawl: do not scan a skill's assets.
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && !['node_modules', '.git', 'dist', 'docs', 'references', 'assets', 'scripts'].includes(entry.name)) {
        await walk(root, join(directory, entry.name), depth + 1);
      }
    }
  };
  for (const root of roots) await walk(root, root, 0);
  return { skills: skills.sort((a, b) => a.name.localeCompare(b.name)), roots, warnings, scannedAt: Date.now() };
}

export function skillMetadata(text: string, fallback: string): Pick<InstalledSkill, 'name' | 'description'> {
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] || '';
  const clean = (value: string) => value.trim().replace(/^['"]|['"]$/g, '').trim();
  const name = clean(/^name:\s*(.+)$/m.exec(header)?.[1] || fallback).slice(0, 120);
  let description = /^description:\s*(.*)$/m.exec(header)?.[1] || '';
  if (['|', '>', '|-', '>-'].includes(description.trim())) {
    description = /description:\s*[|>]-?\r?\n((?:[ \t]+.+\r?\n?)+)/.exec(header)?.[1]?.replace(/\s+/g, ' ') || '';
  }
  if (!description) description = text.replace(/^---[\s\S]*?---/, '').replace(/^#+.+$/gm, '').trim().split(/\r?\n/).find(Boolean) || name;
  return { name, description: clean(description).slice(0, 1500) };
}

const STOP = new Set('a an the and or for to of in on with use using skill skills please help me my our make want task do it this that how tool tools result reply exactly only compute calculate need needs built build work working write analysis long detailed fictional file files best new version fast powerful efficient accordingly installed computer pc'.split(' '));
function terms(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z][a-z0-9+#.-]{1,}/g) || [])
    .filter((word) => !STOP.has(word)).map((word) => word.replace(/(?:ing|ies|s)$/, '')).filter((word) => word.length > 2 && !STOP.has(word)))];
}

/** Rank names and descriptions; irrelevant skills are never injected. */
export function matchSkills(skills: InstalledSkill[], task: string, limit = 3): InstalledSkill[] {
  const query = terms(task);
  if (!query.length) return [];
  const frequency = new Map<string, number>();
  const indexed = skills.map((skill) => {
    const name = new Set(terms(skill.name.replace(/-/g, ' ')));
    const description = new Set(terms(skill.description));
    for (const term of new Set([...name, ...description])) frequency.set(term, (frequency.get(term) || 0) + 1);
    return { skill, name, description };
  });
  return indexed.map(({ skill, name, description }) => {
    const score = query.reduce((total, term) => total + (name.has(term) ? 3 : description.has(term) ? 1 : 0)
      * Math.log(1 + skills.length / (frequency.get(term) || 1)), 0);
    const explicit = task.toLowerCase().includes(skill.name.toLowerCase()) ? 12 : 0;
    const nameMatch = query.some((term) => name.has(term));
    const meaningfulMatches = query.filter((term) => description.has(term) && (frequency.get(term) || 0) < Math.max(3, skills.length * 0.15)).length;
    return { skill, score: score + explicit, relevant: Boolean(explicit || nameMatch || meaningfulMatches >= 2) };
  }).filter(({ score, relevant }) => relevant && score >= 4).sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, limit).map(({ skill }) => skill);
}

export async function readInstalledSkill(id: string): Promise<{ skill: InstalledSkill; instructions: string } | null> {
  const { skills } = await discoverSkills();
  const skill = skills.find((item) => item.id === id);
  if (!skill) return null;
  const instructions = (await readFile(skill.path, 'utf8')).slice(0, 10_000);
  return { skill, instructions };
}

export async function skillContext(task: string): Promise<{ text: string; skills: InstalledSkill[] }> {
  const catalog = await discoverSkills();
  const selected = matchSkills(catalog.skills, task, 2);
  const loaded = await Promise.all(selected.map((skill) => readInstalledSkill(skill.id).catch(() => null)));
  return { skills: loaded.filter((item) => item !== null).map((item) => item.skill),
    text: loaded.filter((item) => item !== null).map((item) =>
      `<installed_skill name=${JSON.stringify(item.skill.name)}>\n${item.instructions}\n</installed_skill>`).join('\n\n').slice(0, 16000) };
}
