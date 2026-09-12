import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as Vue from 'vue';

const source=readFileSync(new URL('../resources/js/workspace.js',import.meta.url),'utf8');

test('Command-A and Control-A select all posts without taking over text fields, dialogs or other pages',()=>{
 for(const options of [
  {metaKey:true}, {ctrlKey:true}, {metaKey:true,key:'A'},
  {metaKey:true,tagName:'INPUT',native:true}, {metaKey:true,tagName:'TEXTAREA',native:true},
  {metaKey:true,tagName:'SELECT',native:true}, {metaKey:true,editable:true,native:true},
  {metaKey:true,dialog:true,native:true}, {metaKey:true,menu:true,native:true}, {metaKey:true,page:'Calendar',native:true},
  {metaKey:true,signedOut:true,native:true}, {metaKey:true,altKey:true,native:true},
  {metaKey:true,shiftKey:true,native:true}, {metaKey:true,defaultPrevented:true,native:true},
  {native:true},
 ]) {
  const calls=[];
  const keyboard=runInNewContext(source.slice(source.indexOf('function keyboard('),source.indexOf('function beforeUnload('))+';keyboard',{
   authenticated:Vue.ref(!options.signedOut),page:Vue.ref(options.page||'Posts'),
   selectAllDrafts:event=>calls.push(event.target.checked),
  });
  let prevented=false;

  keyboard({key:'a',...options,target:{tagName:options.tagName||'BUTTON',isContentEditable:!!options.editable,closest:selector=>options.dialog || (options.menu && selector.includes('[role="menu"]'))?{}:null},preventDefault:()=>{prevented=true;}});

  assert.deepEqual(calls,options.native?[]:[true],JSON.stringify(options));
  assert.equal(prevented,!options.native,JSON.stringify(options));
 }
});

test('manual and automatic synchronization wait while deletion is in progress',async()=>{
 const sync=runInNewContext(source.slice(source.indexOf('async function sync('),source.indexOf('async function schedule('))+';sync',{busy:Vue.ref(true)});
 await sync();
 await sync(false);
});

function deletionContext({fail,confirmed=true,saveFails=false,editorId='first'}={}) {
 const calls=[],prompts=[];
 const context={
  savePromise:null,
  busy:Vue.ref(false),syncing:Vue.ref(false),notice:Vue.ref(''),error:Vue.ref(''),
  editor:Vue.ref({id:editorId}),pending:Vue.ref(true),workingItems:Vue.ref(null),
  state:Vue.ref({drafts:['first','second','third'].map(id=>({id})),publications:[{id:'queued',draft_id:'first',status:'scheduled'},{id:'live',draft_id:'first',status:'published'}]}),
  selectedDraftIds:Vue.ref(['first','second']),
  confirm:message=>{prompts.push(message);return confirmed;},
  flush:async()=>{calls.push('save');if(saveFails)throw new Error('Save failed');},
  api:async(path,{id})=>{assert.equal(path,'deleteDraft');calls.push(id);if(id===fail)throw new Error('Deletion failed');return {cancelled_publication_ids:id==='first'?['queued']:[]};},
 };
 context.act=async fn=>{context.busy.value=true;try{await fn();}catch(e){context.error.value=e.message;}finally{context.busy.value=false;}};
 const actions=runInNewContext(source.slice(source.indexOf('async function deleteDraft()'),source.indexOf('async function newDraft()'))+';({deleteDraft,deleteDrafts})',context);
 return {...context,...actions,calls,prompts};
}

test('Backspace confirms selected post deletion and leaves editing, dialogs and repeated keys alone',async()=>{
 for(const options of [
  {}, {single:true}, {confirmed:true}, {empty:true}, {busy:true}, {syncing:true},
  {tagName:'INPUT'}, {tagName:'TEXTAREA'}, {tagName:'SELECT'}, {editable:true}, {dialog:true}, {menu:true},
  {page:'Calendar'}, {signedOut:true}, {repeat:true}, {metaKey:true}, {ctrlKey:true},
  {altKey:true}, {shiftKey:true}, {defaultPrevented:true},
 ]) {
  const result=deletionContext({confirmed:!!options.confirmed});
  if(options.empty)result.selectedDraftIds.value=[];
  if(options.single)result.selectedDraftIds.value=['first'];
  result.busy.value=!!options.busy;result.syncing.value=!!options.syncing;
  const keyboard=runInNewContext(source.slice(source.indexOf('function keyboard('),source.indexOf('function beforeUnload('))+';keyboard',{
   ...result,authenticated:Vue.ref(!options.signedOut),page:Vue.ref(options.page||'Posts'),
  });

  await keyboard({key:'Backspace',...options,target:{tagName:options.tagName||'BUTTON',isContentEditable:!!options.editable,closest:selector=>options.dialog || (options.menu && selector.includes('[role="menu"]'))?{}:null},preventDefault:()=>{}});

  const shouldConfirm=!Object.keys(options).some(key=>!['single','confirmed'].includes(key));
  assert.equal(result.prompts.length,shouldConfirm?1:0,JSON.stringify(options));
  if(shouldConfirm)assert.match(result.prompts[0],options.single?/Delete this post\?/:/Delete 2 selected posts\?/);
  assert.deepEqual(result.calls,options.confirmed?['first','second']:[],JSON.stringify(options));
  assert.equal(result.state.value.drafts.length,options.confirmed?1:3);
 }
});

test('bulk deletion deletes only selected posts and closes a deleted composer without saving it',async()=>{
 const result=deletionContext();
 await result.deleteDrafts(result.selectedDraftIds.value);

 assert.deepEqual(result.calls,['first','second']);
 assert.equal(result.prompts.length,1);
 assert.match(result.prompts[0],/Delete 2 selected posts/);
 assert.match(result.prompts[0],/Scheduled posts will be unscheduled/);
 assert.deepEqual(result.state.value.drafts.map(d=>d.id),['third']);
 assert.equal(result.state.value.publications[0].status,'cancelled');
 assert.equal(result.state.value.publications[1].status,'published');
 assert.equal(result.editor.value,null);
 assert.equal(result.selectedDraftIds.value.length,0);
 assert.equal(result.notice.value,'2 posts deleted.');
});

test('bulk deletion of other posts saves the open editor first',async()=>{
 const result=deletionContext({editorId:'third'});
 await result.deleteDrafts(result.selectedDraftIds.value);

 assert.deepEqual(result.calls,['save','first','second']);
 assert.equal(result.editor.value.id,'third');
 assert.deepEqual(result.state.value.drafts.map(d=>d.id),['third']);
});

test('partial failure removes confirmed deletions and retains remaining selections for retry',async()=>{
 const result=deletionContext({fail:'second',editorId:'second'});
 result.selectedDraftIds.value.push('third');
 await result.deleteDrafts(result.selectedDraftIds.value);

 assert.deepEqual(result.calls,['first','second']);
 assert.deepEqual(result.state.value.drafts.map(d=>d.id),['second','third']);
 assert.deepEqual([...result.selectedDraftIds.value],['second','third']);
 assert.equal(result.editor.value.id,'second');
 assert.equal(result.notice.value,'');
 assert.equal(result.error.value,'Deletion failed');
});

test('cancellation, save failure of another post, empty selection and ongoing work never delete posts',async()=>{
 for(const options of [{confirmed:false},{saveFails:true,editorId:'third'},{busy:true},{syncing:true},{empty:true}]) {
  const result=deletionContext(options);
  result.busy.value=!!options.busy;result.syncing.value=!!options.syncing;
  await result.deleteDrafts(options.empty?[]:result.selectedDraftIds.value);

  assert.deepEqual(result.calls,options.saveFails?['save']:[],JSON.stringify(options));
  assert.equal(result.state.value.drafts.length,3);
  assert.equal(result.editor.value.id,options.editorId||'first');
  assert.equal(result.selectedDraftIds.value.length,2);
 }
});

test('deleting the open editor discards a failed save and still removes the posts',async()=>{
 const result=deletionContext({saveFails:true});
 await result.deleteDrafts(result.selectedDraftIds.value);

 assert.deepEqual(result.calls,['first','second']);
 assert.deepEqual(result.state.value.drafts.map(d=>d.id),['third']);
 assert.equal(result.editor.value,null);
 assert.equal(result.notice.value,'2 posts deleted.');
});

test('single deletion uses the same flow and preserves an unrelated selection',async()=>{
 const result=deletionContext();
 await result.deleteDraft();

 assert.deepEqual(result.calls,['first']);
 assert.deepEqual([...result.selectedDraftIds.value],['second']);
 assert.equal(result.notice.value,'Post deleted.');
 assert.match(result.prompts[0],/^Delete this post\?/);
});

test('select all follows visible posts and selections clear on workspace, page, or authentication changes',async()=>{
 const scope=Vue.effectScope();
 const context={ref:Vue.ref,computed:Vue.computed,watch:Vue.watch,busy:Vue.ref(false),syncing:Vue.ref(false),drafts:Vue.ref([{id:'first'},{id:'second'}]),page:Vue.ref('Posts'),authenticated:Vue.ref(true),state:Vue.ref({settings:{workspace_id:'one'}})};
 const selection=scope.run(()=>runInNewContext(source.slice(source.indexOf('const selectedDraftIds ='),source.indexOf('function customize('))+';({selectedDraftIds,allDraftsSelected,selectAllDrafts})',context));
 context.closeDraft=async()=>{selection.selectedDraftIds.value=[];};
 try {
  selection.selectAllDrafts({target:{checked:true}});
  assert.deepEqual([...selection.selectedDraftIds.value],['first','second']);
  assert.equal(selection.allDraftsSelected.value,true);
  context.drafts.value=[{id:'second'}];
  await Vue.nextTick();
  assert.deepEqual([...selection.selectedDraftIds.value],['second']);
  context.drafts.value=[{id:'first'},{id:'second'}];
  await Vue.nextTick();
  assert.equal(selection.allDraftsSelected.value,false);
  await selection.selectAllDrafts({target:{checked:false}});
  assert.equal(selection.selectedDraftIds.value.length,0);
  for(const change of [()=>context.state.value.settings.workspace_id='two',()=>context.page.value='Calendar',()=>context.authenticated.value=false,()=>context.drafts.value=[]]) {
   selection.selectAllDrafts({target:{checked:true}});
   change();
   await Vue.nextTick();
   assert.equal(selection.selectedDraftIds.value.length,0);
  }
  assert.equal(selection.allDraftsSelected.value,false);
 } finally {scope.stop();}
});
