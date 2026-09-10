import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as Vue from 'vue';
import { compile } from '@vue/compiler-dom';
import { renderToString } from '@vue/server-renderer';

const source=readFileSync(new URL('../resources/js/workspace.js',import.meta.url),'utf8');
const view=readFileSync(new URL('../resources/js/PostsPage.vue',import.meta.url),'utf8');
const composer=readFileSync(new URL('../resources/js/PostComposer.vue',import.meta.url),'utf8');
const template=view.slice(view.indexOf('<template>')+10,view.lastIndexOf('</template>')).replace('<PostComposer v-if="editor" />',composer.slice(composer.indexOf('<template>')+10,composer.lastIndexOf('</template>')));
const render=new Function('Vue',compile(template,{mode:'function',prefixIdentifiers:true}).code)(Vue);

async function renderDraft(publications,{title='My draft',editorOpen=false,query='',posts,selected=[],busy=false}={}) {
 const draft={id:'draft',title,content:{items:[{text:'Hello',media_ids:[]}],account_ids:[],overrides:{}}};
 const state=Vue.ref({drafts:posts||[draft],accounts:[],publications});
 const search=Vue.ref(query);
 const {publicationStatuses,drafts,draftSummary}=runInNewContext(source.slice(source.indexOf('const publicationStatuses ='),source.indexOf('const items ='))+';({publicationStatuses,drafts,draftSummary})',{computed:Vue.computed,state,search});
 const app=()=>Vue.createSSRApp({render,setup:()=>({
  state,publicationStatuses,drafts,draftSummary,search,editor:editorOpen?draft:null,
  date:()=>'',symbols:{},names:{},network:'shared',chosen:[],items:[],preview:[],
  busy,saving:false,pending:false,newDraft:()=>{},openDraft:()=>{},closeDraft:()=>{},changed:()=>{},
  resetOverride:()=>{},addPost:()=>{},deleteDraft:()=>{},
  selectedDraftIds:selected,allDraftsSelected:drafts.value.length>0&&drafts.value.every(d=>selected.includes(d.id)),selectAllDrafts:()=>{},deleteDrafts:()=>{},syncing:false,
 })});
 return {html:await renderToString(app()),renderHtml:()=>renderToString(app()),state,publicationStatuses,drafts,search};
}

test('draft cards and the composer show counted publication outcomes for their own draft', async () => {
 const {html,state,publicationStatuses}=await renderDraft([
  {draft_id:'draft',status:'published'},
  {draft_id:'draft',status:'published'},
  {draft_id:'draft',status:'scheduled'},
  {draft_id:'other',status:'failed'},
 ],{editorOpen:true});

 assert.equal((html.match(/Published · 2/g)||[]).length,2);
 assert.equal((html.match(/Scheduled · 1/g)||[]).length,2);
 assert.doesNotMatch(html,/>Draft<|Failed/);
 state.value.publications[2].status='published';
 assert.equal(publicationStatuses.value.draft.published,3);
 assert.equal(publicationStatuses.value.draft.scheduled,undefined);
});

test('draft cards summarize attachments and network versions before calling a post empty', async () => {
 const cases=[
  {items:[{text:'',media_ids:['photo']}],expected:'1 attachment'},
  {items:[{text:' \n ',media_ids:[]},{text:'',media_ids:['photo','video']}],expected:'2 attachments'},
  {items:[{text:'',media_ids:['photo']}],overrides:{x:[{text:'',media_ids:['photo','video']}]},expected:'2 attachments'},
  {items:[{text:'',media_ids:[]}],overrides:{x:[{text:'',media_ids:['video']}]},expected:'1 attachment'},
  {items:[{text:'Hello',media_ids:['photo']},{text:'World',media_ids:[]}],expected:'Hello World'},
  {items:[{text:'',media_ids:[]}],overrides:{x:[{text:'Network caption',media_ids:[]}]},expected:'Network caption'},
  {items:[{text:' \n ',media_ids:[]},{text:'',media_ids:[]}],expected:'Empty post'},
 ];

 for(const {items,overrides={},expected} of cases) {
  const {html}=await renderDraft([],{posts:[{id:'draft',title:'My draft',content:{items,overrides,account_ids:[]}}]});

  assert.ok(html.includes('<p>'+expected+'</p>'),expected+' is shown');
 }
});

test('unpublished drafts retain their label and conflict copies retain their warning', async () => {
 const plain=await renderDraft([{draft_id:'other',status:'published'}]);
 const conflict=await renderDraft([{draft_id:'draft',status:'scheduled'}],{title:'My draft (conflict copy)'});

 assert.match(plain.html,/>Draft</);
 assert.doesNotMatch(plain.html,/Published ·|Scheduled ·/);
 assert.match(conflict.html,/>\s*Conflict copy\s*</);
 assert.match(conflict.html,/Scheduled · 1/);
});

test('unfinished and cancelled publications are not labelled published or scheduled', async () => {
 const {html}=await renderDraft(['retry','publishing','failed','missed','uncertain','cancelled'].map(status=>({draft_id:'draft',status})));

 for(const label of ['Retry','Publishing','Failed','Missed','Uncertain','Cancelled']) {
  assert.ok(html.includes(label+' · 1'),label+' is visible');
 }
 assert.doesNotMatch(html,/Published ·|Scheduled ·|>Draft</);
});

test('posts show every status with search and no duplicate filter tabs', async () => {
 const statuses=['scheduled','retry','publishing','published','failed','missed','uncertain','cancelled'];
 const posts=['plain',...statuses].map(id=>({id,title:id==='published'?'Launch announcement':id,content:{items:[{text:'Release notes',media_ids:[]}],account_ids:[],overrides:{}}}));
 const result=await renderDraft(statuses.map(status=>({draft_id:status,status})),{posts});

 assert.equal(result.drafts.value.length,9);
 assert.match(result.html,/aria-label="Search posts"/);
 assert.doesNotMatch(result.html,/aria-label="Filter posts"|>All<|>Unpublished<|>Scheduled<|>Published</);
 result.search.value='ANNOUNCEMENT';
 assert.deepEqual(Array.from(result.drafts.value,d=>d.id),['published']);
 result.search.value='RELEASE';
 assert.equal(result.drafts.value.length,9);
 result.search.value='missing';
 assert.equal(result.drafts.value.length,0);
 assert.match(await result.renderHtml(),/>No matching posts</);
 assert.match(await result.renderHtml(),/aria-label="Search posts"/);
 result.search.value='';
 result.state.value.drafts=[];
 assert.match(await result.renderHtml(),/>No posts</);
 assert.doesNotMatch(await result.renderHtml(),/aria-label="Search posts"|class="list-toolbar"/);
});

test('a scheduled post keeps its card and updates its badge after synchronization confirms success', async () => {
 const result=await renderDraft([{draft_id:'draft',status:'scheduled'}]);
 assert.match(result.html,/Scheduled · 1/);

 result.state.value={...result.state.value,publications:[{draft_id:'draft',status:'published'}]};

 assert.deepEqual(Array.from(result.drafts.value,d=>d.id),['draft']);
 const html=await result.renderHtml();
 assert.match(html,/Published · 1/);
 assert.doesNotMatch(html,/Scheduled · 1/);
});

test('creating a post uses the current date and time as its title and clears search that would hide it', async () => {
 const context={
  authenticated:Vue.ref(true),busy:Vue.ref(false),editor:Vue.ref(null),network:Vue.ref('x'),
  page:Vue.ref('Published'),search:Vue.ref('old post'),
  act:fn=>fn(),flush:async()=>{},changed:()=>{},crypto:{randomUUID:()=> 'new-post'},
  Date:{now:()=>1788874200000},date:value=>{assert.equal(value,1788874200000);return '8 Sept, 14:30';},
 };
 await runInNewContext(source.slice(source.indexOf('async function newDraft()'),source.indexOf('const publicationStatuses ='))+';newDraft()',context);

 assert.equal(context.page.value,'Posts');
 assert.equal(context.search.value,'');
 assert.equal(context.editor.value.title,'8 Sept, 14:30');
});

test('posts render labelled selection checkboxes, selected counts and disabled deletion while busy', async () => {
 const empty=await renderDraft([]);
 assert.match(empty.html,/type="checkbox"[^>]*aria-label="Select post: My draft"/);
 assert.ok(empty.html.includes('>0 selected<'));
 assert.ok(empty.html.includes('<button class="outline" disabled>Delete selected</button>'));

 const selected=await renderDraft([],{selected:['draft']});
 assert.ok(selected.html.includes('>1 selected<'));
 assert.ok(selected.html.includes('<input type="checkbox" checked'));
 assert.ok(selected.html.includes('<button class="outline">Delete selected</button>'));
 assert.ok(selected.html.includes('class="draft-card selected"'));

 const busy=await renderDraft([],{selected:['draft'],busy:true});
 assert.ok(busy.html.includes('<button class="outline" disabled>Please wait…</button>'));
 assert.ok(busy.html.includes('aria-label="Select post: My draft" disabled'));
});
