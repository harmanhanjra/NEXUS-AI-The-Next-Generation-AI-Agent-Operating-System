import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const base = process.argv[2] || 'http://localhost:3001';
const workspaceId = randomUUID();
const ids = [];
const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, status: 'passed' }); console.log('PASS', name); }
  catch (error) { results.push({ name, status: 'failed', error: error.message }); console.error('FAIL', name, error.message); }
}
async function upload(name, text) {
  const form = new FormData(); form.set('workspaceId', workspaceId);
  form.set('file', new File([text], name));
  const response = await fetch(base + '/api/documents', { method: 'POST', body: form });
  const data = await response.json(); assert.ok(response.ok, JSON.stringify(data));
  ids.push(data.document.id); return data.document.id;
}
async function question(message, documentIds, history = []) {
  const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: 'research', conversationId: 'rag-' + randomUUID(), workspaceId, documentIds, message, history, providerId: 'nvidia' }), signal: AbortSignal.timeout(150000) });
  assert.equal(response.status, 200);
  const raw = await response.text();
  const done = raw.split(/\r?\n\r?\n/).filter((item) => item.startsWith('event: done')).at(-1);
  assert.ok(done, raw.slice(-2000)); return JSON.parse(done.split('\ndata: ')[1]).text;
}
try {
  for (const extension of ['pdf', 'docx', 'xlsx']) await check(`${extension.toUpperCase()} upload and grounded numeric answer`, async () => {
    const bytes = await readFile(`artifacts/verification.${extension}`);
    const id = await upload(`verification.${extension}`, bytes);
    assert.match(await question('What is the verification allocation? Cite its source.', [id]), /8,?400/);
  });
  const nimbus = await upload('nimbus-rag.txt', 'The Nimbus initiative budget is 4200 credits. Its owner is Mira. The Nimbus launch code is ORCHID-731.');
  await check('Room synthesis remains grounded and excludes unrelated skills', async () => {
    const response = await fetch(base + '/api/rooms/engineering-room/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Report only the Nimbus budget, owner, and launch code, with citations.', agentIds: ['research'], workspaceId, documentIds: [nimbus], providerId: 'nvidia' }), signal: AbortSignal.timeout(120000) });
    const run = await response.json(); assert.equal(response.status, 200, JSON.stringify(run));
    assert.equal(run.status, 'completed'); assert.match(run.synthesis, /4,?200/); assert.match(run.synthesis, /Mira/); assert.match(run.synthesis, /ORCHID-731/);
    assert.ok(run.steps.every((step) => !step.skills?.length)); assert.ok(!/next three actions|rotate the|enterprise financial/i.test(run.synthesis), run.synthesis);
  });
  let maple;
  await check('CSV table extraction and grounded number', async () => {
    maple = await upload('maple-budget.csv', 'Project,Allocation,Owner\nMaple,7300,Dev\n');
    assert.match(await question('What allocation is shown for Maple?', [maple]), /7,?300/);
  });
  if (maple) await check('Answer combines two selected files with citations', async () => {
    const answer = await question('Report the Nimbus budget and Maple allocation separately. Cite each source.', [nimbus, maple]);
    assert.match(answer, /4,?200/); assert.match(answer, /7,?300/); assert.match(answer, /Source/);
  });
  await check('Follow-up pronoun resolves the previous file topic', async () => {
    const answer = await question('Who is its owner?', [nimbus], [{ role: 'user', content: 'What is the Nimbus initiative budget?' }, { role: 'assistant', content: 'The Nimbus budget is 4200 credits.' }]);
    assert.match(answer, /Mira/);
  });
  await check('Retrieval includes the end of a long uploaded file', async () => {
    const body = Array.from({ length: 250 }, (_, i) => `Section ${i}: This synthetic archive contains general notes about the verification process and does not state a launch date.`).join('\n\n');
    const long = await upload('long-archive.txt', body + '\n\nENDNOTE_ZULU: The final shipping date is 2031-11-14.');
    const answer = await question('What final shipping date is stated in ENDNOTE_ZULU?', [long]);
    assert.match(answer, /2031-11-14|November 14,? 2031|14 November 2031/);
  });
  await check('An unselected file cannot supply the answer', async () => {
    const answer = await question('What is the Nimbus launch code?', maple ? [maple] : []);
    assert.ok(!answer.includes('ORCHID-731'), answer);
  });
} finally {
  for (const documentId of ids) await fetch(base + '/api/documents', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, documentId }) });
}
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/rag-acceptance.json', JSON.stringify({ base, testedAt: new Date().toISOString(), results }, null, 2));
console.log(`${results.filter((item) => item.status === 'passed').length}/${results.length} RAG checks passed`);
process.exitCode = results.some((item) => item.status === 'failed') ? 1 : 0;
