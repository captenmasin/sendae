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
 return {page:'Published',queue:[],history:[{id:'publication',status,snapshot:{title:'Post'},receipts:[]}],busy,
  symbols:{},accountFor:()=>null,date:()=>'',publicationStatus:p=>p.status,openRecovery:()=>{},deletePublication:()=>{},cancel:()=>{},postUrl:()=>null};
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

test('Delete confirms, calls the publication endpoint, and refreshes only after success', async () => {
 const calls=[];
 const notice=Vue.ref('');
 let confirmed=false,failed=false;
 const {deletePublication}=runInNewContext(source.slice(source.indexOf('async function deletePublication('),source.indexOf('function editWorkspace('))+';({deletePublication})',{
  confirm:()=>confirmed,act:fn=>fn(),notice,
  api:async(path,data)=>{calls.push({path,...data});if(failed)throw new Error('Deletion failed');},
  refresh:async()=>calls.push('refresh'),
 });
 const ctx={...context('cancelled'),deletePublication};
 const nodes=[render(ctx,[])];
 let button;
 while(nodes.length) {
  const node=nodes.shift();
  if(node?.type==='button'&&node.children?.trim()==='Delete'){button=node;break;}
  if(Array.isArray(node?.children))nodes.push(...node.children);
 }
 assert.ok(button);
 await button.props.onClick();
 assert.deepEqual(calls,[]);
 confirmed=true;
 await button.props.onClick();
 assert.deepEqual(calls,[{path:'deletePublication',id:'publication'},'refresh']);
 assert.equal(notice.value,'Publication deleted.');
 calls.length=0;
 notice.value='';
 failed=true;
 await assert.rejects(button.props.onClick(),/Deletion failed/);
 assert.deepEqual(calls,[{path:'deletePublication',id:'publication'}]);
 assert.equal(notice.value,'');
});
