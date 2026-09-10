import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Vue from 'vue';
import { compile } from '@vue/compiler-dom';
import { renderToString } from '@vue/server-renderer';

test('platform cards identify each account and remove disconnected accounts from the list', async () => {
 const source=readFileSync(new URL('../resources/js/AccountsPage.vue',import.meta.url),'utf8');
 const template=source.slice(source.indexOf('<template>')+10,source.lastIndexOf('</template>'));
 const render=new Function('Vue',compile(template,{mode:'function',prefixIdentifiers:true}).code)(Vue);
 const html=await renderToString(Vue.createSSRApp({render,data:()=>({
  sync:()=>{}, connect:()=>{}, editSlots:()=>{}, disconnect:()=>{}, providerStatus:()=>'',
  names:{threads:'Threads',facebook:'Facebook',x:'X'}, symbols:{threads:'@',facebook:'f',x:'X'}, busy:false,syncing:false,
  state:{accounts:[
   {id:'threads',provider:'threads',name:'capten_masin',avatar_url:'https://images.example/profile.jpg',status:'connected',timezone:'Europe/London',slots:[]},
   {id:'facebook',provider:'facebook',name:'Novogamer',status:'connected',timezone:'Europe/London',slots:[{day:1,time:'09:00'}]},
   {id:'removed',provider:'facebook',name:'Removed Page',status:'disconnected',timezone:'Europe/London',slots:[]},
  ]},canConnect:()=>true,
 })}));
 assert.match(html,/>@capten_masin<\/h3>/);
 assert.match(html,/>Novogamer<\/h3>/);
 assert.match(html,/aria-label="Disconnect capten_masin"/);
 assert.match(html,/aria-label="Disconnect Novogamer"/);
 assert.match(html,/title="Disconnect Novogamer"><svg/);
 assert.doesNotMatch(html,/>Disconnect<|Europe\/London|>connected/);
 assert.match(html,/>Manage posting slots<\/button>/);
 assert.match(html,/>1 posting slot<\/button>/);
 assert.ok(html.includes('src="https://images.example/profile.jpg"'));
 assert.ok(html.includes('referrerpolicy="no-referrer"'));
 assert.ok(html.includes('<span>N</span>'));
 assert.doesNotMatch(html,/Removed Page/);
 assert.match(html,/Not connected/);
});
