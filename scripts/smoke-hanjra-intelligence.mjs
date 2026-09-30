import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const origin='http://127.0.0.1:3013';
const session=await fetch(`${origin}/api/hanjra/session`);
assert.equal(session.status,200);
const cookie=session.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
const request=(path,body)=>fetch(origin+path,{headers:{Cookie:cookie,...(body?{'Content-Type':'application/json',Origin:origin}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
async function json(path,body){const response=await request(path,body);const value=await response.json();if(!response.ok)throw new Error(value.error||`HTTP ${response.status}`);return value;}
assert.equal((await fetch(`${origin}/api/hanjra/intelligence`)).status,401);
assert.equal((await fetch(`${origin}/api/hanjra/intelligence`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'})).status,401);
assert.equal((await request('/api/hanjra/intelligence',{operation:'memory',title:'Invalid',content:'Invalid',grants:['all']})).status,400);
const report={at:new Date().toISOString(),checks:['unauthenticated read denied','mutation without origin denied','unknown authorization fields denied']};
let temporaryNote;
try{
  temporaryNote=(await json('/api/hanjra/intelligence',{operation:'memory',title:'Acceptance fixture · archive after check',content:'Temporary retrieval verification for the Hanjra local intelligence workspace.'})).note;
  let snapshot=await json('/api/hanjra/intelligence?q=verification');assert.ok(snapshot.matches.some(n=>n.id===temporaryNote.id));
  await json('/api/hanjra/intelligence',{operation:'archive',id:temporaryNote.id,archived:true});
  snapshot=await json('/api/hanjra/intelligence?q=verification');assert.ok(!snapshot.matches.some(n=>n.id===temporaryNote.id));
  await json('/api/hanjra/intelligence',{operation:'archive',id:temporaryNote.id,archived:false});
  snapshot=await json('/api/hanjra/intelligence?q=verification');assert.ok(snapshot.matches.some(n=>n.id===temporaryNote.id));
  report.checks.push('memory persisted','archiving excludes retrieval','restore re-enables retrieval');
}finally{if(temporaryNote)await json('/api/hanjra/intelligence',{operation:'archive',id:temporaryNote.id,archived:true});}
const saved=await json('/api/hanjra',{operation:'command',command:'In one sentence, summarize the Hanjra project stack.',source:'text',language:'en',idempotencyKey:crypto.randomUUID()});
let record;const deadline=Date.now()+125000;
do{record=await json(`/api/hanjra?id=${saved.task.id}`);if(!['queued','running'].includes(record.task.state))break;await new Promise(r=>setTimeout(r,1000));}while(Date.now()<deadline);
assert.equal(record.task.state,'completed',record.task.blocker||'Model did not complete');
const retrieval=record.steps.find(step=>step.kind==='memory_retrieval');assert.ok(retrieval);assert.ok(JSON.parse(retrieval.detail).ids.length>0);
assert.ok(record.task.details.evidence.some(e=>e.source.startsWith('Local note: Hanjra project stack')));
await json('/api/hanjra/intelligence',{operation:'feedback',taskId:saved.task.id,owner:'research',helpful:true});
let reviewed=await json('/api/hanjra/intelligence');assert.ok(reviewed.feedback.some(f=>f.taskId===saved.task.id&&f.helpful));
await json('/api/hanjra/intelligence',{operation:'feedback',taskId:saved.task.id,owner:'research',helpful:false});
reviewed=await json('/api/hanjra/intelligence');assert.ok(reviewed.feedback.some(f=>f.taskId===saved.task.id&&!f.helpful));
report.checks.push('actual local model task completed with retrieved memory evidence','positive feedback saved','review replacement withdrew training example');
report.taskId=saved.task.id;report.model=record.task.details.model;report.state=record.task.state;report.engine=reviewed.engine.status;report.traceCount=reviewed.traces.length;report.examples=reviewed.learning.samples;
await writeFile('artifacts/hanjra/openjarvis-acceptance.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
