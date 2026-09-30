import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { terms, predictOwner, searchMemory, evaluateRouter, uniqueExamples } from '../lib/hanjra/learning.ts';
import { putMemory, memoryNotes, archiveMemory, feedback, reviewedExamples, localContext, learnedOwner } from '../lib/hanjra/intelligence.ts';
import { db, createTask, updateTask, getTask } from '../lib/hanjra/store.ts';
import { submitCommand } from '../lib/hanjra/runtime.ts';
import { routeCommand } from '../lib/hanjra/contracts.ts';
// An isolated SQLite connection avoids Windows file-lock races during native teardown.
// Durable on-disk persistence is covered by the live acceptance script and browser reload.
process.env.HANJRA_DATABASE_PATH = ':memory:';
after(()=>db().close());
const examples = [
  ...['database indexing performance','database indexing tables','database indexing query','database query performance','database indexing slow tables'].map(query=>({query,owner:'research'})),
  ...['writing story tone','writing story audience','writing tone narrative','writing story headline','writing story narrative tone'].map(query=>({query,owner:'content'})),
];
test('trained CPU classifier generalizes held-out query and abstains on unfamiliar requests',()=>{
  const predicted=predictOwner('database indexing query performance',examples);
  assert.equal(predicted?.owner,'research');assert.equal(predicted?.accepted,true);
  assert.equal(predictOwner('galactic watermelon unusual',examples)?.accepted,false);
  assert.equal(predictOwner('database',examples.slice(0,4))?.accepted,false);
  assert.equal(predictOwner('',examples),null);
});
test('duplicate examples do not inflate sample count or leak through evaluation folds',()=>{
  const copies=Array(10).fill({query:'database indexing performance',owner:'research'});
  assert.equal(uniqueExamples(copies).length,1);assert.equal(evaluateRouter(copies).samples,1);
  assert.equal(evaluateRouter(copies).agreement,null);
  const evaluated=evaluateRouter(examples);assert.ok(evaluated.accepted>0);assert.equal(evaluated.agreement,1);
});
test('BM25 ranks relevant notes, excludes archived notes, preserves multilingual tokens',()=>{
  const notes=[{id:'1',title:'Database',content:'Database indexing performance for slow tables',archived:false,updatedAt:1},{id:'2',title:'Writing',content:'Tone for story writing',archived:false,updatedAt:2},{id:'3',title:'Database secret',content:'database indexing',archived:true,updatedAt:3}];
  assert.equal(searchMemory('database indexing',notes)[0].id,'1');assert.equal(searchMemory('unrelated',notes).length,0);
  assert.ok(terms('ਪੰਜਾਬੀ हिन्दी').length>=2);
});
test('persistent memory is redacted, recoverably archived, and excluded from retrieval',async()=>{
  const note=await putMemory('Work preference','database indexing password=secretvalue');
  assert.ok(!note.content.includes('secretvalue'));assert.equal((await localContext('database'))[0].id,note.id);
  await archiveMemory(note.id,true);assert.equal((await localContext('database')).length,0);
  assert.equal((await memoryNotes())[0].archived,true);await archiveMemory(note.id,false);
  assert.equal((await localContext('database'))[0].id,note.id);
  await assert.rejects(putMemory('','invalid'));await assert.rejects(putMemory('Oversized','x'.repeat(4001)));
});
test('only reviewed completed live tasks train labels; negative replacement withdraws an example',async()=>{
  const task=(await createTask('Writing story tone','text',crypto.randomUUID(),'content')).task;
  await assert.rejects(feedback(task.id,'content',true));
  await updateTask(task.id,'completed','A draft',null);await assert.rejects(feedback(task.id,'invented',true));
  await feedback(task.id,'content',true);assert.equal((await reviewedExamples()).length,1);
  await feedback(task.id,'content',false);assert.equal((await reviewedExamples()).length,0);
  const fixture=(await createTask('fixture writing','text',crypto.randomUUID(),'content',{environment:'fixture'})).task;
  await updateTask(fixture.id,'completed','Fixture',null);await assert.rejects(feedback(fixture.id,'content',true));
});
test('reviewed routing never changes explicit action intent or grants tools',async()=>{
  for(const example of examples){const task=(await createTask(example.query,'text',crypto.randomUUID(),example.owner)).task;await updateTask(task.id,'completed','Draft',null);await feedback(task.id,example.owner,true);}
  assert.equal((await learnedOwner('database indexing query performance'))?.accepted,true);
  const routed=routeCommand('send the database indexing report');assert.equal(routed.intent,'send');assert.equal(routed.owner,'sales');
});
test('runtime applies learned persona only to ambiguous commands with original authorization',async()=>{
  process.env.HANJRA_ALLOW_CLOUD_TEXT='false';process.env.HANJRA_PROVIDER='none';
  const input={command:'database indexing query performance',source:'text' as const,language:'en' as const,environment:'live' as const,idempotencyKey:crypto.randomUUID()};
  const saved=await submitCommand(input);assert.equal(saved.task.owner,'research');assert.deepEqual(saved.task.details.authorizedActions,['read','prepare']);
  for(let i=0;i<100;i++){const task=await getTask(saved.task.id);if(task?.state==='blocked')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal((await getTask(saved.task.id))?.blocker,'configured_model_and_text_egress_policy');
  const action=await submitCommand({...input,command:'send the database indexing report',idempotencyKey:crypto.randomUUID()});
  assert.equal(action.task.owner,'sales');
  for(let i=0;i<100;i++){const task=await getTask(action.task.id);if(task?.state==='awaiting_approval')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal((await getTask(action.task.id))?.state,'awaiting_approval');
});
