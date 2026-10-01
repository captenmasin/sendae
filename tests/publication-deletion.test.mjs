import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as Vue from 'vue';
import { compile } from '@vue/compiler-dom';
import { renderToString } from '@vue/server-renderer';

const source=readFileSync(new URL('../resources/js/workspace.js',import.meta.url),'utf8');
const view=readFileSync(new URL('../resources/js/PublicationsPage.vue',import.meta.url),'utf8');
const template=view.slice(view.indexOf('<template>')+10,view.lastIndexOf('</template>'));
const render=new Function('Vue',compile(template,{mode:'function',prefixIdentifiers:true}).code)(Vue);

function context(status,busy=false) {
 const post={id:'publication',status,snapshot:{title:'Post'},receipts:[]};
 return {publicationGroups:[{key:post.id,post,publications:[{id:'publication',status,snapshot:{title:'Post'},receipts:[]}]}],view:'history',needsAttention:[],syncing:false,page:'Calendar',queue:[],publications:[{id:'publication',status,snapshot:{title:'Post'},receipts:[]}],busy,
  symbols:{},accountFor:()=>null,date:()=>'',postTitle:p=>p.snapshot.title,publicationStatus:p=>p.status,canReschedule:()=>false,openRecovery:()=>{},deletePublication:()=>{},cancel:()=>{},postUrl:()=>null};
}

test('cancelled publications show Recover and Delete, with Delete disabled while busy', async () => {
 const html=await renderToString(Vue.createSSRApp({render,setup:()=>context('cancelled')}));
 assert.match(html,/>\s*Recover\s*<\/button>/);
 assert.match(html,/>\s*Delete\s*<\/button>/);
 const busy=await renderToString(Vue.createSSRApp({render,setup:()=>context('cancelled',true)}));
 assert.match(busy,/<button[^>]*disabled[^>]*>\s*Delete\s*<\/button>/);
 for(const status of ['scheduled','retry','publishing','published','failed','missed','uncertain']) {
  const other=await renderToString(Vue.createSSRApp({render,setup:()=>context(status)}));
  assert.doesNotMatch(other,/>\s*Delete\s*<\/button>/);
 }
});

test('Delete hides a publication immediately, confirms remotely, and restores it on failure', async () => {
 const calls=[];
 const notice=Vue.ref('');
 const state=Vue.ref({publications:[{id:'publication',status:'cancelled'}]});
 let confirmed=false,resolveRequest,rejectRequest;
 const {deletePublication}=runInNewContext(source.slice(source.indexOf('async function deletePublication('),source.indexOf('function editWorkspace('))+';({deletePublication})',{
  confirm:()=>confirmed,act:fn=>fn(),notice,state,
  api:(path,data)=>{calls.push({path,...data});return new Promise((resolve,reject)=>{resolveRequest=resolve;rejectRequest=reject;});},
  refresh:async()=>calls.push('refresh'),
 });
 const ctx={...context('cancelled'),deletePublication};
 const nodes=[render(ctx,[])];
 let button;
 while(nodes.length) {
  const node=nodes.shift();
  if(node?.type==='button'&&typeof node.children==='string'&&node.children.trim()==='Delete'){button=node;break;}
  if(Array.isArray(node?.children))nodes.push(...node.children);
 }
 assert.ok(button);
 await button.props.onClick();
 assert.deepEqual(calls,[]);
 confirmed=true;
 const deletion=button.props.onClick();
 assert.deepEqual(state.value.publications,[]);
 assert.deepEqual(calls,[{path:'deletePublication',id:'publication'}]);
 resolveRequest();
 await deletion;
 assert.deepEqual(calls,[{path:'deletePublication',id:'publication'},'refresh']);
 assert.equal(notice.value,'Publication deleted.');
 await button.props.onClick();
 assert.equal(calls.length,2);
 calls.length=0;
 notice.value='';
 state.value.publications=[{id:'publication',status:'cancelled'}];
 const failedDeletion=button.props.onClick();
 assert.deepEqual(state.value.publications,[]);
 rejectRequest(new Error('Deletion failed'));
 await assert.rejects(failedDeletion,/Deletion failed/);
 assert.deepEqual(calls,[{path:'deletePublication',id:'publication'}]);
 assert.equal(state.value.publications[0].id,'publication');
 assert.equal(notice.value,'');
});
