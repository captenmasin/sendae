import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import * as Vue from 'vue';
import { compile } from '@vue/compiler-dom';
import { renderToString } from '@vue/server-renderer';

test('scheduled badges count down to the posting time without changing other statuses', async () => {
 const source=readFileSync(new URL('../resources/js/workspace.js',import.meta.url),'utf8');
 const now=Vue.ref(Date.parse('2026-09-08T12:00:00Z'));
 const publicationStatus=runInNewContext(source.slice(source.indexOf('function publicationStatus('),source.indexOf('const pending ='))+';publicationStatus',{now});
 const label=scheduled_at=>publicationStatus({status:'scheduled',scheduled_at});

 assert.equal(label('2026-09-10T14:15:00Z'),'Scheduled · in 2d 2h 15m');
 assert.equal(label('2026-09-08T15:15:00+01:00'),'Scheduled · in 2h 15m');
 assert.equal(label('2026-09-08T13:00:00Z'),'Scheduled · in 1h');
 assert.equal(label('2026-09-08T12:01:01Z'),'Scheduled · in 2m');
 assert.equal(label('2026-09-08T12:01:00Z'),'Scheduled · in 1m');
 assert.equal(label('2026-09-08T12:00:59Z'),'Scheduled · in less than a minute');
 assert.equal(label('2026-09-08T12:00:00Z'),'Scheduled · due now');
 assert.equal(label('2026-09-07T12:00:00Z'),'Scheduled · due now');
 assert.equal(label(null),'scheduled');
 assert.equal(label('invalid'),'scheduled');
 for(const status of ['retry','publishing','published','failed','missed','uncertain','cancelled']) {
  assert.equal(publicationStatus({status,scheduled_at:'2026-09-10T14:15:00Z'}),status);
 }

 const view=readFileSync(new URL('../resources/js/PublicationsPage.vue',import.meta.url),'utf8');
 const template=view.match(/<span class="tag" :class="p.status">[\s\S]*?<\/span>/)[0];
 const render=new Function('Vue',compile(template,{mode:'function',prefixIdentifiers:true}).code)(Vue);
 const app=()=>Vue.createSSRApp({render,setup:()=>({publicationStatus,p:{status:'scheduled',scheduled_at:'2026-09-08T12:02:00Z'}})});
 assert.match(await renderToString(app()),/>Scheduled · in 2m<\/span>/);
 now.value+=60000;
 assert.match(await renderToString(app()),/>Scheduled · in 1m<\/span>/);
});

test('scheduling retries keep their request ID and a new confirmed action gets a new ID', async () => {
 const source=readFileSync(new URL('../resources/js/workspace.js',import.meta.url),'utf8');
 const schedule=source.slice(source.indexOf('async function schedule('),source.indexOf('async function cancel('));
 const stored=new Map(), requests=[];
 let fail=true;
 const context=()=>({
  busy:{value:false}, syncing:{value:false}, syncRequest:null, scheduledLocked:{value:false}, scheduledUpdateErrors:{value:{}},
  act:fn=>fn(), flush:async()=>{}, refresh:async()=>{},
  editor:{value:{id:'draft',version:2}}, scheduleMode:{value:'now'},
  state:{value:{settings:{workspace_id:'workspace'}}},
  scheduleOpen:{value:true}, notice:{value:''}, page:{value:'Drafts'},
  crypto:{randomUUID},
  localStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)},
  api:async(path,payload)=>{requests.push({...payload});if(fail)throw new Error('Response lost');},
 });
 await assert.rejects(runInNewContext(schedule+';schedule()',context()),/Response lost/);
 fail=false;
 await runInNewContext(schedule+';schedule()',context());
 await runInNewContext(schedule+';schedule()',context());
 assert.equal(requests[0].request_id,requests[1].request_id);
 assert.notEqual(requests[1].request_id,requests[2].request_id);
 assert.equal(stored.size,0);
});
