import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Vue from 'vue';
import * as Sonner from 'vue-sonner';
import { parse, compileScript } from 'vue/compiler-sfc';
import { renderToString } from '@vue/server-renderer';
import * as Workspace from '../resources/js/workspace.js';

// Compile the real component tree with Vue's installed compiler, without a browser or test dependency.
function application(initial = {}) {
    let workspace;
    const nodes = new Map();
    const components = new Map();
    const workspaceModule = {
        ...Workspace,
        createWorkspace() {
            if (!workspace) {
                workspace = Workspace.createWorkspace();
                for (const [key, value] of Object.entries(initial)) workspace[key].value = value;
            }
            return workspace;
        },
    };
    function component(name) {
        if (components.has(name)) return components.get(name);
        const filename = new URL('../resources/js/' + name, import.meta.url);
        const { descriptor } = parse(readFileSync(filename, 'utf8'));
        const compiled = compileScript(descriptor, { id: name, inlineTemplate: true, genDefaultAs: 'component' });
        const modules = [];
        const code = compiled.content.replace(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g, (_, bindings, source) => {
            const value = source === 'vue' ? Vue : source === 'vue-sonner' ? Sonner : source === './workspace.js' ? workspaceModule : component(source.slice(2));
            modules.push(value);
            return `const ${bindings.replace(/\bas\b/g, ':')} = modules[${modules.length - 1}];`;
        });
        const result = new Function('modules', code + '\nreturn component;')(modules);
        const setup = result.setup;
        result.setup = (...args) => {
            const render = setup(...args);
            return (...args) => {
                const tree = render(...args);
                nodes.set(name, tree);
                return tree;
            };
        };
        components.set(name, result);
        return result;
    }
    const App = component('App.vue');
    return {
        get workspace() { return workspace; },
        nodes,
        mountNotifications() {
            const app = Vue.createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} }).createApp({
                setup(props, context) {
                    const render = App.setup(props, context);
                    return (...args) => { render(...args); return null; };
                },
            });
            app.mount({});
            return () => app.unmount();
        },
        async render() {
            const app = Vue.createSSRApp(App);
            app.config.warnHandler = message => assert.fail(message);
            return renderToString(app);
        },
    };
}

function findNode(tree, predicate) {
    if (predicate(tree)) return tree;
    for (const child of Array.isArray(tree?.children) ? tree.children : []) {
        const found = findNode(child, predicate);
        if (found) return found;
    }
}

function textContent(node) {
    return typeof node?.children === 'string' ? node.children : (node?.children || []).map(textContent).join('');
}

test('workspace notifications use timed toasts, repeat successes, and preserve inline errors', async t => {
    const success = t.mock.method(Sonner.toast, 'success', () => {});
    const error = t.mock.method(Sonner.toast, 'error', () => {});
    const app = application({ authenticated: true, loaded: true });
    assert.doesNotMatch(await app.render(), /class="banner/);
    t.after(app.mountNotifications());
    const toaster = findNode(app.nodes.get('App.vue'), node => node?.type === Sonner.Toaster);
    assert.equal(toaster.props.duration, 5000);

    for (let i = 0; i < 2; i++) {
        app.workspace.notice.value = 'Posting slots saved.';
        await Vue.nextTick();
        assert.equal(app.workspace.notice.value, '');
    }
    assert.deepEqual(success.mock.calls.map(call => call.arguments), [['Posting slots saved.'], ['Posting slots saved.']]);

    app.workspace.error.value = 'Save failed';
    await Vue.nextTick();
    assert.deepEqual(error.mock.calls.map(call => call.arguments), [['Save failed']]);
    assert.equal(app.workspace.error.value, 'Save failed');

    app.workspace.authenticated.value = false;
    app.workspace.error.value = 'Invalid password';
    await Vue.nextTick();
    assert.equal(error.mock.callCount(), 1);
    assert.match(await app.render(), /Invalid password/);
    assert.equal(findNode(app.nodes.get('App.vue'), node => node?.type === Sonner.Toaster), undefined);
});

test('sidebar navigation renders each screen and keeps the open composer and workspace counts', async () => {
    const draft = { id: 'draft', title: 'Unfinished post', content: { items: [{ text: 'Still editing', media_ids: [] }], overrides: {}, account_ids: [] } };
    const app = application({
        authenticated: true, loaded: true, editor: structuredClone(draft),
        state: {
            drafts: [draft], accounts: [], media: [],
            publications: [
                { id: 'queued', draft_id: 'draft', status: 'scheduled', snapshot: { title: 'Queued post' } },
                { id: 'published', draft_id: 'draft', status: 'published', snapshot: { title: 'Published post' }, metrics_status: 'available' },
            ],
            settings: { providers: {}, workspace_id: 'personal', workspaces: [{ id: 'personal', name: 'Personal', icon: '◻' }], email: 'person@example.com' },
        },
    });
    assert.match(await app.render(), /Still editing/);
    const originalEditor = app.workspace.editor.value;

    for (const page of ['Queue', 'Published', 'Analytics', 'Accounts', 'Settings', 'Posts']) {
        const button = findNode(app.nodes.get('AppSidebar.vue'), node => node?.type === 'button' && textContent(node).includes(page));
        assert.ok(button, page + ' navigation exists');
        button.props.onClick();
        await Vue.nextTick();
        const html = await app.render();

        assert.equal(app.workspace.page.value, page);
        assert.match(html, new RegExp('<h1>' + page + '</h1>'));
        assert.equal(app.workspace.editor.value, originalEditor);
        const active = findNode(app.nodes.get('AppSidebar.vue'), node => node?.props?.['aria-current'] === 'page');
        assert.ok(textContent(active).includes(page));
        if (page === 'Queue') { assert.match(html, /Queued post/); assert.doesNotMatch(html, /Published post/); }
        if (page === 'Published') { assert.match(html, /Published post/); assert.doesNotMatch(html, /Queued post/); }
        if (page === 'Settings') assert.match(html, /person@example.com/);
        if (page === 'Posts') assert.match(html, /Still editing/);
    }
    const counts = [];
    for (const label of ['Posts', 'Queue']) {
        const button = findNode(app.nodes.get('AppSidebar.vue'), node => node?.type === 'button' && textContent(node).includes(label));
        counts.push(textContent(findNode(button, node => node?.props?.class === 'count')));
    }
    assert.deepEqual(counts, ['1', '1']);
});

test('authentication screens hide the workspace while password reset remains accessible', async () => {
    const app = application({ loaded: true, workspaceForm: { name: 'Private workspace', icon: '◻' } });
    const html = await app.render();

    assert.match(html, /Sign in/);
    assert.doesNotMatch(html, /Main navigation|Private workspace/);
    const register = findNode(app.nodes.get('AuthScreen.vue'), node => node?.type === 'button' && textContent(node).trim() === 'Create an account');
    register.props.onClick();
    assert.match(await app.render(), /Create account/);

    app.workspace.resetForm.value = { email: 'person@example.com', token: 'ticket', password: '', password_confirmation: '' };
    assert.match(await app.render(), /Choose a new password/);
});

test('composer edits use shared autosave and failed saves keep the composer open for retry', async t => {
    const originalDocument = globalThis.document;
    globalThis.document = { querySelector: () => ({ content: 'csrf-token' }) };
    t.after(() => { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
    let fail = true;
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push({ url, payload: JSON.parse(options.body) });
        return { ok: !fail, status: fail ? 500 : 200, json: async () => fail ? { message: 'Save failed' } : { draft: { ...JSON.parse(options.body), version: 2 } } };
    });
    const app = application({ authenticated: true, loaded: true, editor: { id: 'draft', title: 'Before', version: 1, content: { items: [{ text: '', media_ids: [] }], overrides: {}, account_ids: [] } } });
    await app.render();
    const title = findNode(app.nodes.get('PostComposer.vue'), node => node?.props?.['aria-label'] === 'Post title');
    title.props['onUpdate:modelValue']('Edited title');
    title.props.onInput();
    await assert.rejects(app.workspace.flush(), /Save failed/);
    await Vue.nextTick();

    assert.equal(app.workspace.editor.value.title, 'Edited title');
    assert.equal(app.workspace.pending.value, true);
    assert.match(await app.render(), /Unsaved changes/);
    const close = findNode(app.nodes.get('PostComposer.vue'), node => node?.props?.['aria-label'] === 'Close composer');
    await close.props.onClick();
    assert.equal(app.workspace.editor.value.title, 'Edited title');
    assert.equal(app.workspace.error.value, 'Save failed');

    fail = false;
    await close.props.onClick();
    assert.equal(app.workspace.editor.value, null);
    assert.equal(app.workspace.pending.value, false);
    assert.equal(app.workspace.state.value.drafts[0].title, 'Edited title');
    assert.ok(requests.every(request => request.url === '/local/drafts' && request.payload.title === 'Edited title'));
});

test('connecting accounts refreshes the Accounts page immediately and reports connection or sync failures', async t => {
    const originalDocument = globalThis.document;
    globalThis.document = { querySelector: () => ({ content: 'csrf-token' }) };
    t.after(() => { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
    const connectedAccount = { id: 'threads', provider: 'threads', name: 'new_account', status: 'connected', slots: [] };
    const state = { drafts: [], accounts: [], media: [], publications: [], settings: { providers: {}, paired: true } };
    let failureAt, app, requests;
    t.mock.method(globalThis, 'fetch', async url => {
        requests.push(url);
        if (url === '/local/sync') assert.equal(app.workspace.busy.value, false);
        return {
            ok: url !== failureAt, status: url === failureAt ? 500 : 200,
            json: async () => url === failureAt ? { message: 'Request failed' }
                : url === '/local/state' ? { ...state, accounts: [connectedAccount] } : {},
        };
    });

    for (failureAt of [null, '/local/selectConnection', '/local/sync']) {
        requests = [];
        const form = { ticket: 'ticket', selected: [0], accounts: [connectedAccount], timezone: 'UTC' };
        app = application({ authenticated: true, loaded: true, page: 'Accounts', state: structuredClone(state), connectionForm: form });
        assert.doesNotMatch(await app.render(), /@new_account/);

        await app.workspace.selectConnection();
        const html = await app.render();

        assert.equal(app.workspace.busy.value, false);
        assert.equal(app.workspace.syncing.value, false);
        if (failureAt === '/local/selectConnection') {
            assert.deepEqual(requests, ['/local/selectConnection']);
            assert.ok(app.workspace.connectionForm.value);
            assert.notEqual(app.workspace.notice.value, 'Accounts connected.');
        } else {
            assert.equal(app.workspace.connectionForm.value, null);
            assert.deepEqual(requests, failureAt ? ['/local/selectConnection', '/local/sync']
                : ['/local/selectConnection', '/local/sync', '/local/state']);
        }
        if (failureAt) {
            assert.equal(app.workspace.error.value, 'Request failed');
            assert.doesNotMatch(html, /@new_account/);
        } else {
            assert.match(html, /@new_account/);
            assert.equal(app.workspace.error.value, '');
        }
    }
});
