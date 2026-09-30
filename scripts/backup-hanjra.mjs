import nextEnv from '@next/env';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { db, schema } from '../lib/hanjra/store.ts';
nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const dir = resolve('data', 'hanjra-backups'); await mkdir(dir, { recursive: true });
const path = resolve(dir, `hanjra_${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
try { await schema(); await db().execute({ sql: 'VACUUM INTO ?', args: [path] }); console.log(`Consistent SQLite backup: ${path}`); }
finally { db().close(); }
