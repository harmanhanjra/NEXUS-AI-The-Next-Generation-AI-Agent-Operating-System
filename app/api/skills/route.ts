import { NextRequest } from 'next/server';
import { discoverSkills, matchSkills, readInstalledSkill } from '@/lib/skills';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (id) {
      const skill = await readInstalledSkill(id);
      return skill ? Response.json(skill) : Response.json({ error: 'Installed skill not found' }, { status: 404 });
    }
    const catalog = await discoverSkills(req.nextUrl.searchParams.get('refresh') === 'true');
    const task = req.nextUrl.searchParams.get('task');
    return Response.json({ ...catalog, matched: task ? matchSkills(catalog.skills, task.slice(0, 12000)) : [] });
  } catch {
    return Response.json({ error: 'Could not discover local skills. Check folder access.' }, { status: 503 });
  }
}
