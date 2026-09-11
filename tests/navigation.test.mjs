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
        const lucide = new Proxy({}, { get: (_target, exportName) => exportName === '__esModule' ? true : { name: exportName, setup: () => () => Vue.h('svg', { 'aria-hidden': 'true' }) } });
        const code = compiled.content.replace(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g, (_, bindings, source) => {
            const value = source === 'vue' ? Vue : source === 'vue-sonner' ? Sonner : source === '@lucide/vue' ? lucide : source === './workspace.js' ? workspaceModule : component(source.slice(2));
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

    for (const page of ['Queue', 'Published', 'Activity', 'Analytics', 'Accounts', 'Settings', 'Posts']) {
        const button = findNode(app.nodes.get('AppSidebar.vue'), node => node?.type === 'button' && textContent(node).includes(page));
        assert.ok(button, page + ' navigation exists');
        button.props.onClick();
        await Vue.nextTick();
        const html = await app.render();

        assert.equal(app.workspace.page.value, page);
        assert.match(html, new RegExp('<h1>' + page + '</h1>'));
        assert.equal(app.workspace.editor.value, originalEditor);
        assert.ok(findNode(app.nodes.get('AppSidebar.vue'), node => node?.type === 'button' && textContent(node).includes('New post')), 'New post remains visible on ' + page);
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

test('refresh restores every selected sidebar page', async t => {
    const originalWindow = globalThis.window;
    const storage = new Map();
    globalThis.window = { sessionStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
    } };
    t.after(() => { if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; });

    for (const page of ['Queue', 'Published', 'Activity', 'Analytics', 'Accounts', 'Settings', 'Posts']) {
        const app = application({ authenticated: true, loaded: true });
        await app.render();
        const unmount = app.mountNotifications();
        const button = findNode(app.nodes.get('AppSidebar.vue'), node => node?.type === 'button' && textContent(node).includes(page));
        button.props.onClick();
        unmount();

        const refreshed = application({ authenticated: true, loaded: true });
        assert.match(await refreshed.render(), new RegExp('<h1>' + page + '</h1>'));
        const active = findNode(refreshed.nodes.get('AppSidebar.vue'), node => node?.props?.['aria-current'] === 'page');
        assert.ok(textContent(active).includes(page));
    }
});

test('missing, invalid, or inaccessible saved pages keep navigation usable', async t => {
    const originalWindow = globalThis.window;
    t.after(() => { if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; });

    for (const savedPage of [null, 'Removed page', 'constructor', 'unavailable']) {
        globalThis.window = { sessionStorage: {
            getItem() {
                if (savedPage === 'unavailable') throw new Error('Storage unavailable');
                return savedPage;
            },
            setItem() { throw new Error('Storage unavailable'); },
        } };
        const app = application({ authenticated: true, loaded: true });
        assert.match(await app.render(), /<h1>Posts<\/h1>/);
        const unmount = app.mountNotifications();
        const settings = findNode(app.nodes.get('AppSidebar.vue'), node => node?.type === 'button' && textContent(node).includes('Settings'));

        assert.doesNotThrow(() => settings.props.onClick());
        assert.match(await app.render(), /<h1>Settings<\/h1>/);
        unmount();
    }
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

test('composer header stays quiet throughout successful autosave', async () => {
    const app = application({ authenticated: true, loaded: true, editor: { id: 'draft', title: 'Post', content: { items: [{ text: 'Typing', media_ids: [] }], overrides: {}, account_ids: [] } } });
    await app.render();

    for (const [saving, pending] of [[false, false], [true, false], [true, true], [false, false]]) {
        app.workspace.saving.value = saving;
        app.workspace.pending.value = pending;
        await app.render();
        const header = findNode(app.nodes.get('PostComposer.vue'), node => node?.props?.class === 'composer-top');
        assert.doesNotMatch(textContent(header), /Unsaved changes|Saving|Saved/);
        assert.ok(findNode(header, node => node?.props?.['aria-label'] === 'Close composer'));
    }
});

test('Post now saves the current draft and publishes immediately without opening scheduling', async t => {
    const originals = { document: globalThis.document, localStorage: globalThis.localStorage };
    const stored = new Map(), requests = [];
    globalThis.document = { querySelector: () => ({ content: 'csrf-token' }) };
    globalThis.localStorage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) };
    t.after(() => {
        for (const [key, value] of Object.entries(originals)) {
            if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
        }
    });
    const draft = { id: 'draft', title: 'Post', version: 1, content: { items: [{ text: 'Latest edit', media_ids: [] }], overrides: {}, account_ids: ['account'] } };
    const state = { drafts: [draft], accounts: [{ id: 'account', provider: 'threads', name: 'Account', status: 'connected' }], media: [], publications: [], settings: { workspace_id: 'workspace', providers: {} } };
    const app = application({ authenticated: true, loaded: true, editor: structuredClone(draft), state, pending: true });
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        const payload = options.body ? JSON.parse(options.body) : undefined;
        requests.push({ url, payload });
        return { ok: true, json: async () => url === '/local/drafts' ? { draft: { ...payload, version: 2 } } : url === '/local/state' ? state : {} };
    });
    await app.render();
    const button = () => findNode(app.nodes.get('PostComposer.vue'), node => node?.type === 'button' && textContent(node).trim() === 'Post now');
    const actions = findNode(app.nodes.get('PostComposer.vue'), node => node?.props?.class === 'composer-actions');
    assert.match(textContent(actions), /Post now\s*Schedule/);

    for (const [busy, saving, accounts] of [[true, false, ['account']], [false, true, ['account']], [false, false, []], [false, false, ['account']]]) {
        app.workspace.busy.value = busy;
        app.workspace.saving.value = saving;
        app.workspace.editor.value.content.account_ids = accounts;
        await app.render();
        assert.equal(button().props.disabled, busy || saving || !accounts.length);
    }
    await button().props.onClick();

    assert.deepEqual(requests.map(request => request.url), ['/local/drafts', '/local/schedule', '/local/state']);
    assert.equal(requests[0].payload.content.items[0].text, 'Latest edit');
    assert.deepEqual(requests[1].payload, { draft_id: 'draft', version: 2, mode: 'now', request_id: requests[1].payload.request_id });
    assert.ok(requests[1].payload.request_id);
    assert.equal(stored.size, 0);
    assert.equal(app.workspace.scheduleOpen.value, false);
    assert.equal(app.workspace.scheduleMode.value, 'exact');
    assert.equal(app.workspace.notice.value, 'Post sent for publishing.');
    assert.equal(app.workspace.page.value, 'Queue');
});

test('Post now keeps the composer open and reports a failed save before publishing', async t => {
    const originalDocument = globalThis.document;
    globalThis.document = { querySelector: () => ({ content: 'csrf-token' }) };
    t.after(() => { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
    const requests = [];
    t.mock.method(globalThis, 'fetch', async url => {
        requests.push(url);
        return { ok: false, status: 500, json: async () => ({ message: 'Save failed' }) };
    });
    const app = application({ authenticated: true, loaded: true, pending: true, editor: { id: 'draft', title: 'Post', version: 1, content: { items: [{ text: 'Unsaved edit', media_ids: [] }], overrides: {}, account_ids: [] } } });
    await app.render();

    await app.workspace.schedule('now');

    assert.deepEqual(requests, ['/local/drafts']);
    assert.equal(app.workspace.error.value, 'Save failed');
    assert.equal(app.workspace.pending.value, true);
    assert.equal(app.workspace.editor.value.id, 'draft');
    assert.equal(app.workspace.page.value, 'Posts');
    assert.equal(app.workspace.busy.value, false);
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

test('inbox rows support Command toggles, Shift ranges, additive ranges and returning to one editor', async () => {
    const drafts = ['a', 'b', 'c', 'd'].map(id => ({ id, title: 'Post ' + id, content: { items: [{ text: id, media_ids: [] }], overrides: {}, account_ids: [] } }));
    const app = application({ authenticated: true, loaded: true, state: { drafts, accounts: [], publications: [], media: [], settings: {} } });
    async function click(id, event = {}) {
        await app.render();
        const row = findNode(app.nodes.get('PostsPage.vue'), node => node?.type === 'button' && node.props?.['aria-describedby'] === 'post-selection-help' && textContent(node).includes('Post ' + id));
        await row.props.onClick(event);
    }
    await click('a');
    await click('c', { metaKey: true });
    assert.deepEqual(app.workspace.selectedDraftIds.value, ['a', 'c']);
    assert.match(await app.render(), /2 posts selected/);
    assert.doesNotMatch(await app.render(), /aria-label="Post title"/);

    await click('d', { shiftKey: true });
    assert.deepEqual(app.workspace.selectedDraftIds.value, ['c', 'd']);
    await click('a', { shiftKey: true });
    assert.deepEqual(app.workspace.selectedDraftIds.value, ['a', 'b', 'c']);
    await click('d', { metaKey: true, shiftKey: true });
    assert.deepEqual([...app.workspace.selectedDraftIds.value].sort(), ['a', 'b', 'c', 'd']);
    await click('b', { ctrlKey: true });
    assert.deepEqual(app.workspace.selectedDraftIds.value, ['a', 'c', 'd']);

    await click('b');
    assert.deepEqual(app.workspace.selectedDraftIds.value, ['b']);
    assert.equal(app.workspace.editor.value.id, 'b');
    assert.match(await app.render(), /aria-label="Post title"/);
    await click('b', { metaKey: true });
    assert.deepEqual(app.workspace.selectedDraftIds.value, []);
    assert.equal(app.workspace.editor.value, null);
    assert.match(await app.render(), />Select a post</);
});

test('inbox range selection follows filtered rows, recovers missing anchors and supports select all', async () => {
    const drafts = ['Keep A', 'Hidden B', 'Keep C', 'Hidden D'].map((title, id) => ({ id, title, content: { items: [{ text: '', media_ids: [] }], overrides: {}, account_ids: [] } }));
    const app = application({ authenticated: true, loaded: true, state: { drafts, accounts: [], publications: [], media: [], settings: {} } });
    await app.render();
    const workspace = app.workspace;
    await workspace.selectDraft(drafts[1]);
    workspace.search.value = 'Keep';
    await Vue.nextTick();
    await workspace.selectDraft(drafts[2], { shiftKey: true });
    assert.deepEqual(workspace.selectedDraftIds.value, [2]);

    await workspace.selectDraft(drafts[0]);
    await workspace.selectDraft(drafts[2], { shiftKey: true });
    assert.deepEqual(workspace.selectedDraftIds.value, [0, 2]);
    await workspace.selectAllDrafts({ target: { checked: false } });
    assert.equal(workspace.editor.value, null);
    assert.deepEqual(workspace.selectedDraftIds.value, []);
    await workspace.selectAllDrafts({ target: { checked: true } });
    assert.deepEqual(workspace.selectedDraftIds.value, [0, 2]);
    assert.equal(workspace.allDraftsSelected.value, true);

    workspace.search.value = 'Keep C';
    await Vue.nextTick();
    await workspace.selectAllDrafts({ target: { checked: true } });
    assert.equal(workspace.editor.value.id, 2);
    assert.deepEqual(workspace.selectedDraftIds.value, [2]);
    workspace.page.value = 'Queue';
    workspace.page.value = 'Posts';
    workspace.search.value = '';
    await Vue.nextTick();
    await workspace.selectDraft(drafts[3], { metaKey: true });
    assert.deepEqual(workspace.selectedDraftIds.value, [2, 3]);
});

test('failed saves keep the current draft and selection; reopening the same draft preserves pending content', async t => {
    const originalDocument = globalThis.document;
    globalThis.document = { querySelector: () => ({ content: 'csrf-token' }) };
    t.after(() => { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
    let fail = true;
    t.mock.method(globalThis, 'fetch', async (url, options) => ({
        ok: !fail, status: fail ? 500 : 200,
        json: async () => fail ? { message: 'Save failed' } : { draft: { ...JSON.parse(options.body), version: 2 } },
    }));
    const drafts = ['a', 'b'].map(id => ({ id, title: id, version: 1, content: { items: [{ text: '', media_ids: [] }], overrides: {}, account_ids: [] } }));
    const app = application({ authenticated: true, loaded: true, state: { drafts, accounts: [], publications: [], media: [], settings: {} } });
    await app.render();
    const workspace = app.workspace;
    await workspace.selectDraft(drafts[0]);
    workspace.editor.value.title = 'Unsaved title';
    workspace.pending.value = true;

    await workspace.selectDraft(drafts[1]);
    assert.deepEqual(workspace.selectedDraftIds.value, ['a']);
    assert.equal(workspace.editor.value.title, 'Unsaved title');
    assert.equal(workspace.pending.value, true);
    await workspace.selectDraft(drafts[0], { metaKey: true });
    assert.deepEqual(workspace.selectedDraftIds.value, ['a']);
    assert.equal(workspace.editor.value.title, 'Unsaved title');
    assert.equal(workspace.error.value, 'Save failed');

    fail = false;
    await workspace.selectDraft(drafts[0]);
    assert.equal(workspace.editor.value.title, 'Unsaved title');
    assert.equal(workspace.editor.value.version, 2);
    assert.equal(workspace.state.value.drafts[0].title, 'Unsaved title');
    assert.equal(workspace.pending.value, false);
    await workspace.selectDraft(drafts[1]);
    assert.equal(workspace.editor.value.id, 'b');
});

test('selection cannot change during ongoing work or target a hidden post', async () => {
    const drafts = ['a', 'b'].map(id => ({ id, title: id, content: { items: [{ text: '', media_ids: [] }], overrides: {}, account_ids: [] } }));
    const app = application({ authenticated: true, loaded: true, state: { drafts, accounts: [], publications: [], media: [], settings: {} } });
    await app.render();
    const workspace = app.workspace;
    await workspace.selectDraft(drafts[0]);
    for (const flag of ['busy', 'syncing']) {
        workspace[flag].value = true;
        await workspace.selectDraft(drafts[1], { metaKey: true });
        await workspace.selectAllDrafts({ target: { checked: true } });
        await workspace.closeDraft();
        assert.deepEqual(workspace.selectedDraftIds.value, ['a']);
        assert.equal(workspace.editor.value.id, 'a');
        workspace[flag].value = false;
    }
    workspace.search.value = 'a';
    await Vue.nextTick();
    await workspace.selectDraft(drafts[1], { shiftKey: true });
    assert.deepEqual(workspace.selectedDraftIds.value, ['a']);
});

test('connected account images appear across posts, publications, analytics and account selection', async () => {
    const account = { id: 'account', provider: 'threads', name: 'My profile', status: 'connected', avatar_url: 'https://images.example/account.jpg' };
    const draft = { id: 'draft', title: 'Post', content: { items: [{ text: 'Hello', media_ids: [] }], overrides: {}, account_ids: [account.id] } };
    const app = application({ authenticated: true, loaded: true, editor: structuredClone(draft), state: {
        drafts: [draft], accounts: [account], media: [], settings: { providers: {} },
        publications: ['scheduled', 'published'].map(status => ({ id: status, account_id: account.id, draft_id: draft.id, status, snapshot: { title: 'Post' }, metrics_status: 'available' })),
    } });
    for (const page of ['Posts', 'Queue', 'Published', 'Analytics', 'Accounts']) {
        await app.render();
        app.workspace.page.value = page;
        const html = await app.render();
        assert.equal((html.match(/src="https:\/\/images.example\/account.jpg"/g) || []).length, 1, page);
        if (page === 'Posts') {
            const destination = html.match(/<label class="destination[^]*?<\/label>/)?.[0];
            assert.ok(destination);
            assert.match(destination, /aria-label="Threads"><svg/);
            assert.doesNotMatch(destination, /<img/);
        }
    }
    app.workspace.page.value = 'Settings';
    app.workspace.connectionForm.value = { accounts: [account], selected: [0], timezone: 'Europe/London' };
    assert.match(await app.render(), /src="https:\/\/images.example\/account.jpg"/);
});

test('legacy timestamp titles become previews across drafts, calendars, publication dialogs and analytics', async () => {
    const draft = { id: 'draft', title: '10 Sept, 11:20', updated_at: '2026-09-11T09:00:00Z', content: { items: [{ text: 'Our next launch is coming\nMore details soon.', media_ids: [] }], overrides: {}, account_ids: [] } };
    const queued = { id: 'queued', draft_id: draft.id, status: 'scheduled', metrics_status: 'not_refreshed', scheduled_at: '2026-09-18T10:33:00Z', snapshot: { title: draft.title, items: [{ text: 'The original scheduled announcement', media_ids: [] }] } };
    const app = application({ authenticated: true, loaded: true, editor: structuredClone(draft), state: {
        drafts: [draft], accounts: [], media: [], settings: { providers: {} },
        publications: [queued, { ...queued, id: 'published', status: 'published', published_at: '2026-09-10T10:33:00Z', snapshot: { title: draft.title, items: [{ text: 'The original published announcement', media_ids: [] }] } }],
    } });

    let html = await app.render();
    assert.match(html, /<h3>Our next launch is coming<\/h3>/);
    assert.doesNotMatch(html, /10 Sept, 11:20/);
    assert.match(html, /<label[^>]*for="post-name"[^>]*>Title<\/label>/);
    assert.match(html, /placeholder="Our next launch is coming"/);
    assert.equal(app.workspace.state.value.drafts[0].title, draft.title, 'Displaying a preview does not rewrite stored names');
    app.workspace.search.value = 'launch';
    assert.equal(app.workspace.drafts.value.length, 1);

    for (const page of ['Queue', 'Published', 'Analytics']) {
        app.workspace.page.value = page;
        html = await app.render();
        assert.match(html, page === 'Queue' ? /The original scheduled announcement/ : /The original published announcement/);
        assert.doesNotMatch(html, /Our next launch|10 Sept, 11:20/);
        assert.match(html, page === 'Analytics' ? /Published:/ : /Scheduled:/);
    }
    app.workspace.page.value = 'Queue';
    app.workspace.openRecovery(queued);
    html = await app.render();
    assert.match(html, /<p>The original scheduled announcement<\/p>/);
    assert.doesNotMatch(html, /10 Sept, 11:20/);

    app.workspace.recovery.value = null;
    app.workspace.page.value = 'Posts';
    await app.render();
    let name = findNode(app.nodes.get('PostComposer.vue'), node => node?.props?.['aria-label'] === 'Post title');
    name.props['onUpdate:modelValue']('September launch');
    assert.match(await app.render(), /value="September launch"/);
    assert.equal(app.workspace.editor.value.title, 'September launch');
    name = findNode(app.nodes.get('PostComposer.vue'), node => node?.props?.['aria-label'] === 'Post title');
    name.props['onUpdate:modelValue']('');
    app.workspace.editor.value.content.items[0].text = 'A revised opening line';
    assert.match(await app.render(), /placeholder="A revised opening line"/);
    assert.equal(app.workspace.editor.value.title, '');
});

test('automatic names cover empty, media and network-specific posts while preserving custom names and conflicts', async () => {
    const app = application({ authenticated: true, loaded: true, state: {
        drafts: [], publications: [], accounts: [], settings: { providers: {} },
        media: [{ id: 'photo', mime: 'image/jpeg' }, { id: 'video', mime: 'video/mp4' }],
    } });
    await app.render();
    const { postTitle } = app.workspace;
    const draft = (title = '', text = '', media_ids = []) => ({ title, content: { items: [{ text, media_ids }], overrides: {} } });

    for (const title of ['', 'Untitled draft', '10 Sept, 11:20', 'Sep 10, 11:20 AM', '10 Sept, 11:20\u202fpm']) {
        assert.equal(postTitle(draft(title, '  Opening words\nSecond line')), 'Opening words');
    }
    assert.equal(postTitle(draft()), 'New post');
    assert.equal(postTitle(draft('', '', ['photo'])), 'Photo post');
    assert.equal(postTitle(draft('', '', ['video'])), 'Video post');
    assert.equal(postTitle(draft('', '', ['photo', 'video'])), 'Video post');
    assert.equal(postTitle(draft('', '', ['missing'])), 'Media post');
    assert.equal(postTitle(draft('September launch', 'Different opening')), 'September launch');
    assert.equal(postTitle(draft('Meet at 11:20', 'Different opening')), 'Meet at 11:20');
    assert.equal(postTitle(draft('10 Sept, 11:20 (conflict copy)', 'Preserved text')), 'Preserved text (conflict copy)');
    assert.equal(postTitle(draft('Custom (conflict copy)', 'Different text')), 'Custom (conflict copy)');
    assert.equal(postTitle({ title: '', content: { items: [{ text: '' }], overrides: { threads: [{ text: 'Network-only announcement' }] } } }), 'Network-only announcement');
    assert.equal(postTitle(draft('', '😀'.repeat(61))), '😀'.repeat(60) + '…');
});


test('Bluesky connection uses its app password dialog and clears credentials after submission', async t => {
    const originalDocument = globalThis.document;
    globalThis.document = { querySelector: () => ({ content: 'csrf-token' }) };
    t.after(() => { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
    const state = { drafts: [], accounts: [], media: [], publications: [], settings: { paired: true, connections_url: 'https://sendae.example', workspace_id: 'personal', providers: { bluesky: { configured: true } } } };
    const requests = [];
    let failed = true;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push({ url, data: options.body && JSON.parse(options.body) });
        return { ok: !(failed && url === '/local/connectBluesky'), status: failed && url === '/local/connectBluesky' ? 422 : 200,
            json: async () => url === '/local/state' ? { ...state, accounts: [{ id: 'bluesky', provider: 'bluesky', name: 'sendae.bsky.social', status: 'connected' }] } : { message: 'Check your app password.' } };
    });
    const app = application({ authenticated: true, loaded: true, page: 'Accounts', state });
    assert.match(await app.render(), /aria-label="Connect Bluesky"/);
    await app.workspace.connect('bluesky');
    const html = await app.render();
    assert.match(html, /id="bluesky-title">Connect Bluesky/);
    assert.match(html, /type="password" autocomplete="off"/);
    assert.deepEqual(requests, []);
    app.workspace.blueskyForm.value = { identifier: 'sendae.bsky.social', password: 'app-secret' };
    await app.workspace.connectBluesky();
    assert.equal(app.workspace.blueskyForm.value.password, '');
    assert.equal(app.workspace.error.value, 'Check your app password.');
    assert.deepEqual(requests.map(request => request.url), ['/local/connectBluesky']);
    failed = false;
    requests.length = 0;
    app.workspace.blueskyForm.value.password = 'replacement-secret';
    await app.workspace.connectBluesky();
    assert.equal(app.workspace.blueskyForm.value, null);
    assert.deepEqual(requests.map(request => request.url), ['/local/connectBluesky', '/local/sync', '/local/state']);
    assert.equal(requests[0].data.password, 'replacement-secret');
    assert.match(await app.render(), /sendae.bsky.social/);
});

test('shared draft warns when network versions exist and viewing a network does not fork until edit', async t => {
    const originalDocument = globalThis.document;
    globalThis.document = { querySelector: () => ({ content: 'csrf-token' }) };
    t.after(() => { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
    t.mock.method(globalThis, 'fetch', async (url, options) => ({
        ok: true, json: async () => url === '/local/drafts' ? { draft: { ...JSON.parse(options.body), version: 2 } } : {},
    }));
    const draft = { id: 'draft', title: 'Post', version: 1, content: { items: [{ text: 'Shared text', media_ids: [] }], overrides: {}, account_ids: ['x-account', 'threads-account'] } };
    const app = application({
        authenticated: true, loaded: true, editor: structuredClone(draft),
        state: {
            drafts: [draft], media: [], publications: [], settings: { providers: {} },
            accounts: [
                { id: 'x-account', provider: 'x', name: 'X', status: 'connected' },
                { id: 'threads-account', provider: 'threads', name: 'Threads', status: 'connected' },
            ],
        },
    });
    await app.render();
    app.workspace.customize('x');
    assert.equal(app.workspace.editor.value.content.overrides.x, undefined);
    app.workspace.items.value[0].text = 'X only';
    assert.equal(app.workspace.editor.value.content.items[0].text, 'Shared text');
    app.workspace.changed();
    await Vue.nextTick();
    assert.equal(app.workspace.editor.value.content.overrides.x[0].text, 'X only');
    app.workspace.customize('shared');
    assert.ok(app.workspace.editor.value.content.overrides.x);
    assert.match(await app.render(), /Network-specific versions will not change when you edit the shared draft/);
});

test('scheduled posts stay locked until the editor is unlocked', async () => {
    const draft = { id: 'draft', title: 'Post', content: { items: [{ text: 'Hello', media_ids: [] }], overrides: {}, account_ids: [] } };
    const app = application({
        authenticated: true, loaded: true, editor: structuredClone(draft),
        state: {
            drafts: [draft], accounts: [], media: [], settings: { providers: {} },
            publications: [{ id: 'queued', draft_id: 'draft', status: 'scheduled', snapshot: { title: 'Post' } }],
        },
    });
    let html = await app.render();
    assert.match(html, /already scheduled/);
    const title = () => findNode(app.nodes.get('PostComposer.vue'), node => node?.props?.['aria-label'] === 'Post title');
    assert.equal(title().props.readonly, true);
    findNode(app.nodes.get('PostComposer.vue'), node => node?.type === 'button' && textContent(node).includes('Edit draft anyway')).props.onClick();
    html = await app.render();
    assert.equal(title().props.readonly, false);
    assert.match(html, /already scheduled/);
});

test('activity lists draft and publication events in order', async () => {
    const draft = { id: 'draft', title: 'Launch', created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-02T10:00:00Z', content: { items: [{ text: 'Launch', media_ids: [] }], overrides: {}, account_ids: [] } };
    const app = application({
        authenticated: true, loaded: true, page: 'Activity',
        state: {
            drafts: [draft], accounts: [{ id: 'account', provider: 'threads', name: 'Sendae', status: 'connected' }], media: [], settings: { providers: {} },
            publications: [{ id: 'live', draft_id: 'draft', account_id: 'account', status: 'published', published_at: '2026-09-03T10:00:00Z', snapshot: { title: 'Launch' } }],
        },
    });
    const html = await app.render();
    assert.match(html, /<h1>Activity<\/h1>/);
    assert.match(html, /Draft created/);
    assert.match(html, /Published/);
    assert.deepEqual(app.workspace.activity.value.map(event => event.type), ['published', 'updated', 'created']);
});

