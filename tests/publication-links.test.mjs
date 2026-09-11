import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as Vue from 'vue';
import { compile } from '@vue/compiler-dom';
import { renderToString } from '@vue/server-renderer';

const source=readFileSync(new URL('../resources/js/workspace.js',import.meta.url),'utf8');
const view=readFileSync(new URL('../resources/js/PublicationsPage.vue',import.meta.url),'utf8');
const template=view.match(/<div v-if="p.receipts\?\.length"[\s\S]*?<\/template>\s*<\/div>/)[0];
const render=new Function('Vue',compile(template,{mode:'function',prefixIdentifiers:true}).code)(Vue);

async function links(provider,receipts,post_urls={}) {
 const p={account_id:'account',receipts,snapshot:{post_urls}};
 const {postUrl}=runInNewContext(source.slice(source.indexOf('function postUrl('),source.indexOf('function connectionUrl('))+';({postUrl})',{state:{value:{accounts:provider?[{id:'account',provider}]:[]}}});
 return renderToString(Vue.createSSRApp({render,setup:()=>({p,postUrl})}));
}

test('published Threads posts link to each confirmed permalink, including after disconnection', async () => {
 const urls={'123':'https://www.threads.com/@sendae/post/ABC','456':'https://www.threads.net/@sendae/post/DEF'};
 for(const provider of ['threads',null]) {
  const html=await links(provider,['123','456'],urls);
  for(const url of Object.values(urls))assert.ok(html.includes('href="'+url+'" class="outline" target="_blank" rel="noopener"'));
  assert.match(html,/>\s*View post 1 ↗\s*<\/a>/);
  assert.match(html,/>\s*View post 2 ↗\s*<\/a>/);
  assert.doesNotMatch(html,/<code>/);
 }
});

test('single publications have a clearly labelled View post action', async () => {
 assert.match(await links('facebook',['123']),/class="outline" target="_blank" rel="noopener">\s*View post ↗\s*<\/a>/);
});

test('clicking View post prevents in-app navigation and asks the native handler to open its URL', async () => {
 const requests=[];
 const p={account_id:'account',receipts:['123'],snapshot:{}};
 const context={state:{value:{accounts:[{id:'account',provider:'x'}]}},act:fn=>fn(),api:async(path,data)=>requests.push({path,...data})};
 const {postUrl,openPost}=runInNewContext(source.slice(source.indexOf('function postUrl('),source.indexOf('function connectionUrl('))+';({postUrl,openPost})',context);
 const nodes=[render({p,postUrl,openPost},[])];
 let link;
 while(nodes.length) {
  const node=nodes.shift();
  if(node?.type==='a'){link=node;break;}
  if(Array.isArray(node?.children))nodes.push(...node.children);
 }
 assert.ok(link);
 let prevented=0;
 const preventDefault=()=>{prevented++;};
 await link.props.onClick({button:0,preventDefault});
 await link.props.onAuxclick({button:1,preventDefault});
 await link.props.onAuxclick({button:2,preventDefault});

 assert.equal(prevented,2);
 assert.deepEqual(requests,[
  {path:'openPost',url:'https://x.com/i/web/status/123'},
  {path:'openPost',url:'https://x.com/i/web/status/123'},
 ]);
});

test('existing networks retain their links and unavailable or unsafe URLs retain receipt IDs', async () => {
 for(const [provider,id,url] of [
  ['x','123','https://x.com/i/web/status/123'],
  ['facebook','123_456','https://www.facebook.com/123_456'],
  ['linkedin','urn:li:share:123','https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A123'],
  ['linkedin_page','urn:li:ugcPost:456','https://www.linkedin.com/feed/update/urn%3Ali%3AugcPost%3A456'],
 ])assert.ok((await links(provider,[id])).includes('href="'+url+'"'));
 for(const url of [null,'javascript:alert(1)','https://www.threads.com.evil.example/post/ABC','https://www.threads.com@evil.example/post/ABC']) {
  const html=await links('threads',['123'],{'123':url});
  assert.match(html,/<code>123<\/code>/);
  assert.doesNotMatch(html,/<a /);
 }
 assert.doesNotMatch(await links('threads',[]),/<a |<code>/);
});


test('Bluesky AT receipts provide post links even after the account is removed', async () => {
 for (const provider of ['bluesky', null]) {
  const html = await links(provider, ['at://did:plc:abc123/app.bsky.feed.post/first']);
  assert.match(html, /href="https:\/\/bsky.app\/profile\/did%3Aplc%3Aabc123\/post\/first"/);
 }
 for (const uri of ['at://evil.example/app.bsky.feed.post/first', 'at://did:plc:abc123/app.bsky.feed.like/first', 'at://did:plc:abc123/app.bsky.feed.post/first?bad']) {
  assert.doesNotMatch(await links('bluesky', [uri]), /<a /);
 }
});
