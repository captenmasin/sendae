import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Vue from 'vue';
import { compile } from '@vue/compiler-dom';
import { parse, compileScript } from 'vue/compiler-sfc';
import { renderToString } from '@vue/server-renderer';

const { descriptor } = parse(readFileSync(new URL('../resources/js/AccountLogo.vue', import.meta.url), 'utf8'));
const compiled = compileScript(descriptor, { id: 'AccountLogo', inlineTemplate: true, genDefaultAs: 'component' });
const AccountLogo = new Function('Vue', compiled.content.replace(/import\s+([\s\S]*?)\s+from\s+['"]vue['"];?/g, (_, bindings) => `const ${bindings.replace(/\bas\b/g, ':')} = Vue;`) + '\nreturn component;')(Vue);

test('platform cards identify each account and remove disconnected accounts from the list', async () => {
 const source=readFileSync(new URL('../resources/js/AccountsPage.vue',import.meta.url),'utf8');
 const template=source.slice(source.indexOf('<template>')+10,source.lastIndexOf('</template>'));
 const render=new Function('Vue',compile(template,{mode:'function',prefixIdentifiers:true}).code)(Vue);
 const html=await renderToString(Vue.createSSRApp({render,components:{AccountLogo},data:()=>({
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
 assert.match(html, /aria-label="Novogamer"><svg/);
 assert.doesNotMatch(html,/Removed Page/);
 assert.match(html,/Not connected/);
});

test('logos use profile images, recover from image failure and retry updated URLs without mutating accounts', async () => {
    const account = Vue.reactive({ provider: 'threads', name: 'My profile', avatar_url: 'https://images.example/profile.jpg' });
    const props = Vue.reactive({ account, size: 28 });
    const render = AccountLogo.setup(props, { expose() {} });
    const html = () => renderToString(Vue.createSSRApp({ render: () => render({}, []) }));

    assert.match(await html(), /src="https:\/\/images.example\/profile.jpg"/);
    render({}, []).children[0].props.onError();
    assert.doesNotMatch(await html(), /<img/);
    assert.match(await html(), /<svg/);
    assert.equal(account.avatar_url, 'https://images.example/profile.jpg');
    account.avatar_url = 'https://images.example/refreshed.jpg';
    assert.match(await html(), /src="https:\/\/images.example\/refreshed.jpg"/);
});

test('every supported platform has an accessible SVG fallback, including LinkedIn Pages and missing accounts', async () => {
    for (const [provider, label] of Object.entries({ bluesky: 'Bluesky', x: 'X', threads: 'Threads', facebook: 'Facebook', linkedin: 'LinkedIn', linkedin_page: 'LinkedIn Page' })) {
        const html = await renderToString(Vue.createSSRApp(AccountLogo, { provider }));
        assert.ok(html.includes('aria-label="' + label + '"'));
        assert.match(html, /<svg[^>]*viewBox="0 0 24 24"[^>]*><path d="M/);
        assert.doesNotMatch(html, /<img/);
    }
    const html = await renderToString(Vue.createSSRApp(AccountLogo));
    assert.match(html, /aria-label="Disconnected account"/);
    assert.doesNotMatch(html, /<img|<svg/);
});
