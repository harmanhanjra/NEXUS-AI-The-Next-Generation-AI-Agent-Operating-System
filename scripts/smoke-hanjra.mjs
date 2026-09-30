import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sapiAdapter, pythonAdapter } from '../lib/hanjra/local-process.ts';
import { routeCommand } from '../lib/hanjra/contracts.ts';
const base = process.argv[2] || 'http://127.0.0.1:3013';
const root = resolve('artifacts', 'hanjra'); await mkdir(root, { recursive: true });
const session = await fetch(base+'/api/hanjra/session');
const cookie = session.headers.get('set-cookie')?.split(';')[0]; if (!cookie) throw new Error('Local session unavailable');
const headers = { cookie, origin: base, 'Content-Type': 'application/json' };
const report = { startedAt: new Date().toISOString(), scope: 'local acceptance plus explicitly labelled synthetic audio', checks: [], languages: {} };
const check = (name, passed, detail) => { report.checks.push({ name, passed, detail }); console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`); };
const json = async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`); return result; };
const post = (body) => fetch(base+'/api/hanjra', { method: 'POST', headers, body: JSON.stringify(body) }).then(json);
const poll = async (id) => {
  const deadline = Date.now()+130000;
  while (Date.now()<deadline) { const record = await fetch(base+`/api/hanjra?id=${id}`, { headers }).then(json); if (!['running','queued'].includes(record.task.state)) return record; await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('Task polling deadline');
};
check('unauthenticated command denied', (await fetch(base+'/api/hanjra', { method:'POST',headers:{'Content-Type':'application/json'},body:'{}' })).status===401);
const taskInput = { operation:'command', command:'Show completed tasks, costs, and blockers', source:'text', language:'en', idempotencyKey:crypto.randomUUID(), environment:'fixture' };
const first = await post(taskInput); const replay = await post(taskInput);
check('replay uses one durable task', replay.task.id===first.task.id && replay.replay);
const status = await poll(first.task.id); check('status verified from SQLite', status.task.state==='completed' && status.task.details.evidence.length>0);
const send = await post({ ...taskInput, command:'Send this draft', idempotencyKey:crypto.randomUUID(), environment:'live' });
const held = await poll(send.task.id); check('send without reviewed grant is held', held.task.state==='awaiting_approval');
const fixture = await post({ ...taskInput, command:'Find five jobs', idempotencyKey:crypto.randomUUID() });
check('fixture cannot call live job adapter', (await poll(fixture.task.id)).task.blocker==='fixture_live_boundary');
const utterances = JSON.parse(await readFile(resolve(root,'utterances.json'),'utf8'));
for (const lang of ['en','hi','pa','mixed']) {
  const passed=utterances[lang].filter(([text,intent])=>routeCommand(text).intent===intent).length;
  report.languages[lang]={textRouting:{passed,total:utterances[lang].length},microphoneTested:false,humanListeningVerified:false};
  check(`${lang} text routing fixtures`, passed===utterances[lang].length, {passed,total:utterances[lang].length});
}
const speechHealth = await fetch(base+'/api/hanjra/speech?backend=windows-local',{headers}).then(json);
check('existing local speech adapter available',speechHealth.available,speechHealth);
if (speechHealth.available) {
  const fixtureRoot=resolve(root,`voice-fixtures_${new Date().toISOString().replace(/[:.]/g,'-')}`); await mkdir(fixtureRoot,{recursive:true});
  const items=[]; const synthesisTimes=[];
  for (const [i,[expected]] of utterances.en.entries()) {
    const output=resolve(fixtureRoot,`english-${i+1}.wav`); const started=Date.now();
    await sapiAdapter({mode:'synthesize',root:fixtureRoot,output,text:expected,voice:'Microsoft David Desktop',language:'en'},AbortSignal.timeout(20000));
    synthesisTimes.push(Date.now()-started); items.push({audio:output,expected});
  }
  const evaluation = await pythonAdapter({mode:'speech-evaluate',root:fixtureRoot,items},AbortSignal.timeout(240000));
  const normalize=(text)=>text.toLowerCase().replace(/[^a-z0-9 ]/g,'').split(/\s+/).filter(Boolean);
  const wordDistance=(a,b)=> { let row=Array.from({length:b.length+1},(_,i)=>i); for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}return row[b.length]; };
  const percentile=(items,p)=>[...items].sort((a,b)=>a-b)[Math.ceil(items.length*p)-1];
  let errors=0,total=0,routed=0;
  evaluation.results.forEach((r,i)=>{const expected=normalize(r.expected);errors+=wordDistance(expected,normalize(r.transcript));total+=expected.length;if(routeCommand(r.transcript).intent===utterances.en[i][1])routed++;});
  report.languages.en.audio={...evaluation,wordErrorRate:errors/total,routingPassed:routed,routingTotal:10,
    warmSttP50Ms:percentile(evaluation.results.slice(1).map((r)=>r.sttMs),.5),warmSttP95Ms:percentile(evaluation.results.slice(1).map((r)=>r.sttMs),.95),
    coldSttMs:evaluation.modelLoadMs+evaluation.results[0].sttMs,ttsBatchP50Ms:percentile(synthesisTimes,.5),ttsBatchP95Ms:percentile(synthesisTimes,.95),ttsFirstAudioMs:null};
  check('English synthetic speech routing',routed===10,{routed,total:10,wordErrorRate:errors/total});
  const final=evaluation.results[0]; const audioSessionId=crypto.randomUUID();
  const demo=await post({operation:'command',command:final.transcript,originalTranscript:final.transcript,source:'voice',audioSessionId,language:'en',idempotencyKey:audioSessionId+':final',environment:'fixture'});
  const finished=await poll(demo.task.id); const ttsStarted=Date.now();
  const audio=await fetch(base+'/api/hanjra/speech',{method:'POST',headers,body:JSON.stringify({taskId:demo.task.id,backend:'windows-local'})});
  if(!audio.ok)throw new Error((await audio.json()).error);
  const output=resolve(fixtureRoot,'hanjra-demo-response.wav'); await writeFile(output,Buffer.from(await audio.arrayBuffer()));
  report.spokenDemo={taskId:demo.task.id,inputFixture:items[0].audio,transcript:final.transcript,result:finished.task.result,outputAudio:output,
    ttsMs:Date.now()-ttsStarted,playback:'awaiting browser playback',humanListeningVerified:false};
  report.languages.hi.audio={tested:0,blocker:'Hindi TTS voice/user recordings unavailable'};
  report.languages.pa.audio={tested:0,blocker:'Punjabi TTS voice/user recordings unavailable'};
}
report.finishedAt=new Date().toISOString();
const path=resolve(root,`acceptance_${new Date().toISOString().replace(/[:.]/g,'-')}.json`);await writeFile(path,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({report:path,spokenDemo:report.spokenDemo,checks:report.checks.map(({name,passed})=>({name,passed}))},null,2));
if(report.checks.some((c)=>!c.passed))process.exitCode=1;
