import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Vue from 'vue';
import * as Icons from '@lucide/vue';
import * as LinkPreviews from '../resources/js/linkPreviews.js';
import { parse, compileScript } from 'vue/compiler-sfc';
import { renderToString } from '@vue/server-renderer';
import { createWorkspace } from '../resources/js/workspace.js';

const { descriptor } = parse(readFileSync(new URL('../resources/js/NetworkPostPreview.vue', import.meta.url), 'utf8'));
const compiled = compileScript(descriptor, { id: 'preview', inlineTemplate: true, genDefaultAs: 'component' });
const modules = [];
const previewCode = compiled.content.replace(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g, (_, bindings, source) => {
    modules.push(source === 'vue' ? Vue : source === './linkPreviews.js' ? LinkPreviews : Icons);
    return `const ${bindings.replace(/\bas\b/g, ':')} = modules[${modules.length - 1}];`;
});
const Preview = new Function('modules', previewCode + '\nreturn component;')(modules);

async function renderComposer(app) {
    const { descriptor } = parse(readFileSync(new URL('../resources/js/PostComposer.vue', import.meta.url), 'utf8'));
    const compiled = compileScript(descriptor, { id: 'composer', inlineTemplate: true, genDefaultAs: 'component' });
    const imports = [];
    const code = compiled.content.replace(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g, (_, bindings, source) => {
        imports.push(source === 'vue' ? Vue : source === './workspace.js' ? { useWorkspace: () => app } : { render: () => null });
        return `const ${bindings.startsWith('{') ? bindings.replace(/\bas\b/g, ':') : bindings} = imports[${imports.length - 1}];`;
    });
    return renderToString(Vue.createSSRApp(new Function('imports', code + '\nreturn component;')(imports)));
}

test('scheduled composer is editable with Change date & time and no manual Update action', async t => {
    const app = await workspace(t, { items: [{ text: 'Scheduled text', media_ids: [] }], overrides: {}, account_ids: ['x'] });
    app.state.value.publications = [{ id: 'publication', draft_id: 'draft', status: 'scheduled', scheduled_at: '2026-10-01T12:00:00Z' }];

    const html = await renderComposer(app);

    assert.doesNotMatch(html, />\s*Update\s*</);
    assert.match(html, /Change date &amp; time/);
    assert.doesNotMatch(html, /readonly|Edit draft anyway|already scheduled|Publications/);
    assert.match(html, /<textarea[^>]*>Scheduled text<\/textarea>/);
    app.openSchedule();
    assert.equal(app.scheduleOpen.value, true);
    assert.equal(new Date(app.scheduleAt.value).toISOString(), '2026-10-01T12:00:00.000Z');
});

test('autosave updates scheduled content quietly and preserves retry identity after failure', async t => {
    const app = await workspace(t, { items: [{ text: 'Original', media_ids: [] }], overrides: {}, account_ids: ['x'] });
    app.state.value.publications = [{ id: 'publication', draft_id: 'draft', status: 'scheduled', scheduled_at: '2026-10-01T12:00:00Z' }];
    const originalStorage = globalThis.localStorage;
    app.editor.value.restore_scheduled = true;
    const storage = new Map();
    globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
    t.after(() => { if (originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage; });
    const requests = [];
    let fail = true, savedDraft;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        const payload = options.body && JSON.parse(options.body);
        requests.push({ url, payload });
        if (url === '/local/schedule' && fail) return { ok: false, json: async () => ({ message: 'Connection lost' }) };
        if (url === '/local/drafts') savedDraft = { ...payload, version: 2 };
        return { ok: true, json: async () => url === '/local/drafts' ? { draft: savedDraft } : url === '/local/state' ? { ...JSON.parse(JSON.stringify(app.state.value)), drafts: [{ ...savedDraft, version: 10 }] } : {} };
    });
    app.items.value[0].text = 'Edited';
    app.changed();
    const page = app.page.value;

    await app.flush();
    assert.equal(app.scheduledUpdateError.value, 'Connection lost');
    assert.equal(app.pending.value, false);
    assert.equal(app.editor.value.version, 2);
    assert.match(await renderComposer(app), /Draft saved\. The scheduled post could not be updated: Connection lost/);
    fail = false;
    await app.schedule('preserve');
    assert.equal(app.pending.value, false);
    assert.equal(app.scheduledUpdateError.value, undefined);
    assert.equal(app.state.value.drafts[0].version, 10);

    assert.equal(requests[0].url, '/local/drafts');
    assert.equal(requests[0].payload.content.items[0].text, 'Edited');
    assert.equal(requests[0].payload.restore_scheduled, true);
    assert.equal(app.editor.value.restore_scheduled, undefined);
    const updates = requests.filter(request => request.url === '/local/schedule').map(request => request.payload);
    assert.equal(updates[0].version, 2);
    assert.equal(updates[0].update, true);
    assert.equal(updates[0].mode, 'preserve');
    assert.equal(updates[0].scheduled_at, undefined);
    assert.equal(updates[0].request_id, updates[1].request_id);
    assert.deepEqual(JSON.parse(updates[0].draft_snapshot), { title: '', content: requests[0].payload.content });
    assert.equal(storage.size, 0);
    assert.equal(app.notice.value, '');
    assert.equal(app.page.value, page);
});

test('scheduled autosave serializes edits made during an update and retains edits when publishing has started', async t => {
    const app = await workspace(t, { items: [{ text: 'Original', media_ids: [] }], overrides: {}, account_ids: ['x'] });
    app.state.value.publications = [{ id: 'publication', draft_id: 'draft', status: 'retry', scheduled_at: '2026-10-01T12:00:00Z' }];
    const originalStorage = globalThis.localStorage;
    const storage = new Map();
    globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
    t.after(() => { if (originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage; });
    const saves = [], updates = [];
    let release, started, savedDraft, publishing = false;
    const updating = new Promise(resolve => { started = resolve; });
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        const payload = options.body && JSON.parse(options.body);
        if (url === '/local/drafts') {
            saves.push(payload);
            savedDraft = { ...payload, version: payload.version + 1 };
            return { ok: true, json: async () => ({ draft: savedDraft }) };
        }
        if (url === '/local/schedule') {
            updates.push(payload);
            if (updates.length === 1) {
                started();
                await new Promise(resolve => { release = resolve; });
            }
            return { ok: !publishing, json: async () => publishing ? { message: 'Publishing has started' } : {} };
        }
        assert.equal(url, '/local/state');
        return { ok: true, json: async () => ({ ...JSON.parse(JSON.stringify(app.state.value)), drafts: [{ ...savedDraft, version: updates.length === 1 ? 10 : savedDraft.version }] }) };
    });

    app.items.value[0].text = 'First edit';
    app.changed();
    await updating;
    app.customize('x');
    app.items.value[0].text = 'Latest network edit';
    app.changed();
    release();
    await app.flush();

    assert.equal(updates.length, 2);
    assert.deepEqual(updates.map(update => [update.mode, update.update, update.version]), [['preserve', true, 2], ['preserve', true, 11]]);
    assert.equal(JSON.parse(updates[0].draft_snapshot).content.items[0].text, 'First edit');
    assert.equal(JSON.parse(updates[1].draft_snapshot).content.overrides.x[0].text, 'Latest network edit');
    assert.equal(saves[1].content.overrides.x[0].text, 'Latest network edit');
    assert.equal(app.editor.value.version, 11);
    assert.equal(app.pending.value, false);

    publishing = true;
    app.items.value[0].text = 'Keep this edit';
    app.changed();
    await app.flush();
    assert.equal(app.scheduledUpdateError.value, 'Publishing has started');
    assert.equal(app.pending.value, false);
    assert.equal(app.items.value[0].text, 'Keep this edit');
    assert.equal(app.state.value.drafts[0].content.overrides.x[0].text, 'Keep this edit');
    await app.closeDraft();
    assert.equal(app.editor.value, null);
});

test('an expired selected account stays removable and its update failure does not block editing or navigation', async t => {
    const app = await workspace(t, { items: [{ text: 'Original', media_ids: [] }], overrides: {}, account_ids: ['x', 'bluesky'] });
    const account = app.state.value.accounts.find(account => account.id === 'bluesky');
    account.status = 'expired';
    account.name = 'captenmasin.bsky.social';
    app.state.value.publications = [{ id: 'publication', draft_id: 'draft', status: 'scheduled' }];
    const originalStorage = globalThis.localStorage;
    const storage = new Map();
    globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
    t.after(() => { if (originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage; });
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        const payload = options.body && JSON.parse(options.body);
        requests.push(url);
        if (url === '/local/drafts') return { ok: true, json: async () => ({ draft: { ...payload, version: payload.version + 1 } }) };
        if (url === '/local/schedule') {
            const blocked = JSON.parse(payload.draft_snapshot).content.account_ids.includes('bluesky');
            return { ok: !blocked, json: async () => blocked ? { message: 'captenmasin.bsky.social needs reconnecting or approval.' } : {} };
        }
        assert.equal(url, '/local/state');
        return { ok: true, json: async () => JSON.parse(JSON.stringify(app.state.value)) };
    });

    app.items.value[0].text = 'Saved despite expired account';
    app.changed();
    await app.flush();
    assert.equal(app.pending.value, false);
    assert.equal(app.busy.value, false);
    assert.equal(app.state.value.drafts[0].content.items[0].text, 'Saved despite expired account');
    const html = await renderComposer(app);
    assert.match(html, /value="bluesky"[^>]*checked/);
    assert.match(html, /Reconnect required/);
    assert.match(html, /Draft saved\./);
    assert.match(html, /Manage accounts/);
    await app.closeDraft();
    assert.equal(app.editor.value, null);
    await app.openDraft(app.state.value.drafts[0]);
    assert.equal(requests.filter(url => url === '/local/schedule').length, 1);

    app.editor.value.content.account_ids = ['x'];
    app.changed();
    await app.flush();
    assert.equal(app.scheduledUpdateError.value, undefined);
    assert.deepEqual(app.state.value.drafts[0].content.account_ids, ['x']);
    assert.doesNotMatch(await renderComposer(app), /value="bluesky"/);
});

test('editing during background sync saves locally and waits before updating the schedule', async t => {
    const app = await workspace(t, { items: [{ text: 'Original', media_ids: [] }], overrides: {}, account_ids: ['x'] });
    app.state.value.publications = [{ id: 'publication', draft_id: 'draft', status: 'scheduled' }];
    const originalStorage = globalThis.localStorage;
    const storage = new Map();
    globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
    t.after(() => { if (originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage; });
    let finishSync, markStarted;
    const syncStarted = new Promise(resolve => { markStarted = resolve; });
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push(url);
        if (url === '/local/sync') {
            markStarted();
            await new Promise(resolve => { finishSync = resolve; });
        }
        return { ok: true, json: async () => url === '/local/drafts'
            ? { draft: { ...JSON.parse(options.body), version: 2 } }
            : url === '/local/state' ? JSON.parse(JSON.stringify(app.state.value)) : {} };
    });

    const syncing = app.sync();
    await syncStarted;
    app.items.value[0].text = 'Edit during sync';
    app.changed();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(requests, ['/local/sync', '/local/drafts']);
    assert.equal(app.state.value.drafts[0].content.items[0].text, 'Edit during sync');
    finishSync();
    await syncing;
    await app.flush();

    assert.deepEqual(requests, ['/local/sync', '/local/drafts', '/local/state', '/local/schedule', '/local/state']);
    assert.equal(app.scheduledUpdateError.value, undefined);
    assert.equal(app.items.value[0].text, 'Edit during sync');
    assert.equal(app.saving.value, false);
    assert.equal(app.syncing.value, false);
});

async function workspace(t, content) {
    const originalDocument = globalThis.document;
    globalThis.document = { querySelector: () => ({ content: 'token' }) };
    t.after(() => { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
    let result;
    await renderToString(Vue.createSSRApp({ setup() { result = createWorkspace(); return () => null; } }));
    result.authenticated.value = true;
    result.state.value = {
        drafts: [{ id: 'draft', title: '', version: 1, content }],
        accounts: ['x', 'threads', 'facebook', 'linkedin', 'linkedin_page', 'bluesky'].map(provider => ({ id: provider, provider, name: provider, status: 'connected' })),
        media: [], publications: [], settings: { providers: {}, paired: true },
    };
    await result.openDraft(result.state.value.drafts[0]);
    return result;
}

test('network edits survive reopening when PHP returns empty overrides as an array', async t => {
    const app = await workspace(t, { items: [{ text: 'Shared', media_ids: [] }], overrides: [], account_ids: ['linkedin'] });
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.equal(url, '/local/drafts');
        const draft = JSON.parse(options.body);
        return { ok: true, json: async () => ({ draft: { ...draft, version: draft.version + 1 } }) };
    });

    app.customize('linkedin');
    app.items.value[0].text = 'LinkedIn edit';
    app.changed();
    await app.closeDraft();
    await app.openDraft(app.state.value.drafts[0]);
    app.customize('linkedin');

    assert.equal(app.items.value[0].text, 'LinkedIn edit');
    assert.equal(app.editor.value.content.items[0].text, 'Shared');
});

test('each network previews its own saved content while another network is being edited', async t => {
    const shared = [{ text: 'Shared first', media_ids: ['shared-photo'] }, { text: 'Shared second', media_ids: [] }];
    const app = await workspace(t, { items: shared, overrides: { x: [{ text: 'X only', media_ids: ['x-photo'] }] }, account_ids: ['x', 'threads', 'facebook'] });
    app.customize('x');

    assert.deepEqual(app.previewItemsFor({ provider: 'threads' }), shared);
    assert.deepEqual(app.previewItemsFor({ provider: 'x' }), [{ text: 'X only', media_ids: ['x-photo'] }]);
    for (const provider of ['facebook', 'linkedin', 'linkedin_page']) {
        assert.deepEqual(app.previewItemsFor({ provider }), [{ text: 'Shared first\n\nShared second', media_ids: ['shared-photo'] }]);
    }
    app.customize('threads');
    assert.deepEqual(app.previewItemsFor({ provider: 'x' }), [{ text: 'X only', media_ids: ['x-photo'] }]);
    assert.deepEqual(app.editor.value.content.overrides.threads, undefined);
});

test('network text and attachments survive later shared edits, autosave and reopening until explicitly reset', async t => {
    const app = await workspace(t, { items: [{ text: 'Shared', media_ids: ['shared-photo'] }], overrides: {}, account_ids: ['x', 'threads'] });
    const saves = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.equal(url, '/local/drafts');
        const draft = JSON.parse(options.body);
        saves.push(draft);
        return { ok: true, json: async () => ({ draft: { ...draft, version: draft.version + 1 } }) };
    });

    app.customize('x');
    app.items.value[0].text = 'X only';
    app.removeMedia(app.items.value[0], 'shared-photo');
    await app.flush();
    app.customize('shared');
    app.items.value[0].text = 'Revised shared';
    app.addPost();
    app.items.value[1].text = 'Second shared';
    app.changed();
    await app.flush();
    await app.closeDraft();
    await app.openDraft(app.state.value.drafts[0]);

    assert.deepEqual(app.previewItemsFor({ provider: 'x' }), [{ text: 'X only', media_ids: [] }]);
    assert.deepEqual(app.previewItemsFor({ provider: 'threads' }), [
        { text: 'Revised shared', media_ids: ['shared-photo'] }, { text: 'Second shared', media_ids: [] },
    ]);
    assert.deepEqual(saves.at(-1).content.overrides.x, [{ text: 'X only', media_ids: [] }]);
    app.customize('x');
    app.resetOverride();
    await app.flush();
    assert.equal(saves.at(-1).content.overrides.x, undefined);
    assert.equal(app.previewItemsFor({ provider: 'x' })[0].text, 'Revised shared');
});

test('a delayed synchronization response cannot erase a network edit saved while it was loading', async t => {
    const app = await workspace(t, { items: [{ text: 'Shared', media_ids: [] }], overrides: {}, account_ids: ['x'] });
    const staleState = structuredClone(JSON.parse(JSON.stringify(app.state.value)));
    let finishRefresh;
    let refreshing;
    const refreshStarted = new Promise(resolve => { refreshing = resolve; });
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        if (url === '/local/state') {
            refreshing();
            await new Promise(resolve => { finishRefresh = resolve; });
            return { ok: true, json: async () => staleState };
        }
        return { ok: true, json: async () => url === '/local/drafts'
            ? { draft: { ...JSON.parse(options.body), version: 2 } } : {} };
    });
    const syncing = app.sync();
    await refreshStarted;
    app.customize('x');
    app.items.value[0].text = 'Keep my new X text';
    app.changed();
    await app.flush();
    finishRefresh();
    await syncing;

    assert.equal(app.items.value[0].text, 'Keep my new X text');
    app.customize('shared');
    assert.equal(app.previewItemsFor({ provider: 'x' })[0].text, 'Keep my new X text');
    await app.closeDraft();
    await app.openDraft(app.state.value.drafts[0]);
    assert.equal(app.previewItemsFor({ provider: 'x' })[0].text, 'Keep my new X text');
});

test('previews render network actions, verified identity, thread posts and full media', async () => {
    const actions = {
        x: ['Reply', 'Repost', 'Like', 'Views', 'Bookmark', 'Share'],
        bluesky: ['Reply', 'Repost', 'Like', 'More'], threads: ['Like', 'Reply', 'Repost', 'Share'],
        facebook: ['Like', 'Comment', 'Share'], linkedin: ['Like', 'Comment', 'Repost', 'Send'],
        linkedin_page: ['Like', 'Comment', 'Repost', 'Send'],
    };
    for (const [provider, expectedActions] of Object.entries(actions)) {
        const html = await renderToString(Vue.createSSRApp(Preview, {
            account: { provider, name: 'Sendae', username: 'sendae', verified: true, avatar_url: 'https://example.com/avatar.jpg' },
            items: [{ text: '<script>alert(1)</script>\nA launch #update', media_ids: ['photo'] }, { text: 'More details', media_ids: ['video'] }],
            media: [{ id: 'photo', mime: 'image/png', name: 'Launch image' }, { id: 'video', mime: 'video/mp4', name: 'Launch video' }],
        }));
        assert.equal((html.match(/aria-label="Post \d preview"/g) || []).length, 2);
        assert.match(html, /aria-label="Verified account"/);
        assert.match(html, /src="https:\/\/example.com\/avatar.jpg"/);
        assert.match(html, /src="\/local\/media\/photo" alt="Launch image"/);
        assert.match(html, /<video[^>]+src="\/local\/media\/video"[^>]+controls/);
        assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
        assert.doesNotMatch(html, /<script>/);
        assert.deepEqual([...html.matchAll(/<span title="([^"]+)"/g)].slice(0, expectedActions.length).map(match => match[1]), expectedActions);
    }
});

test('Threads keeps all carousel attachments and feed cards expose truncation and surplus photos', async () => {
    const items = [{ text: 'A long update. '.repeat(30), media_ids: ['a', 'b', 'c', 'd', 'e', 'f'] }];
    const threads = await renderToString(Vue.createSSRApp(Preview, { account: { provider: 'threads', name: 'Sendae' }, items }));
    assert.match(threads, /carousel/);
    assert.equal((threads.match(/src="\/local\/media\//g) || []).length, 6);
    const facebook = await renderToString(Vue.createSSRApp(Preview, { account: { provider: 'facebook', name: 'Sendae' }, items }));
    assert.match(facebook, /network-text collapsed/);
    assert.match(facebook, /See more/);
    assert.match(facebook, /network-media-more">\+2/);
    assert.equal((facebook.match(/src="\/local\/media\//g) || []).length, 4);
    assert.doesNotMatch(facebook, /Verified account/);
});

for (const saveFails of [false, true]) {
    test(`deletion waits for an active autosave ${saveFails ? 'failure' : 'success'} so the post cannot reappear`, async t => {
        const app = await workspace(t, { items: [{ text: 'Draft', media_ids: [] }], overrides: {}, account_ids: ['x'] });
        const originalConfirm = globalThis.confirm;
        globalThis.confirm = () => true;
        t.after(() => { if (originalConfirm === undefined) delete globalThis.confirm; else globalThis.confirm = originalConfirm; });
        const requests = [];
        let finishSave;
        t.mock.method(globalThis, 'fetch', async (url, options) => {
            requests.push(url);
            if (url === '/local/drafts') {
                await new Promise(resolve => { finishSave = resolve; });
                if (saveFails) throw new Error('Save failed');
                return { ok: true, json: async () => ({ draft: { ...JSON.parse(options.body), version: 2 } }) };
            }
            assert.equal(url, '/local/deleteDraft');
            return { ok: true, json: async () => ({}) };
        });
        app.items.value[0].text = 'Edited';
        app.changed();
        const deleting = app.deleteDraft();
        assert.equal(app.busy.value, true);
        assert.deepEqual(requests, ['/local/drafts']);
        finishSave();
        await deleting;

        assert.deepEqual(requests, ['/local/drafts', '/local/deleteDraft']);
        assert.deepEqual(app.state.value.drafts, []);
        assert.equal(app.editor.value, null);
        assert.equal(app.pending.value, false);
        assert.equal(app.busy.value, false);
    });
}

test('preview links use network display text while preserving surrounding punctuation and escaped text', async () => {
    const html = await renderToString(Vue.createSSRApp(Preview, {
        account: { provider: 'x', name: 'Sendae' },
        items: [{ text: 'Read (https://novogamer.com/). <script>bad</script> #news', media_ids: [] }],
    }));

    assert.match(html, /class="network-link" title="https:\/\/novogamer.com\/">novogamer.com<\/span><span[^>]*>\)\./);
    assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>/);
});

test('website cards render the fetched title, image and description as escaped content', async () => {
    const card = { title: '<script>News</script>', description: 'Latest & greatest', domain: 'novogamer.com', image: 'data:image/png;base64,example', large: true };
    const cardModules = modules.map(module => module === LinkPreviews ? { ...LinkPreviews, useLinkPreviews: () => ({ cardFor: item => item.media_ids?.length ? null : card }) } : module);
    const CardPreview = new Function('modules', previewCode + '\nreturn component;')(cardModules);
    const html = await renderToString(Vue.createSSRApp(CardPreview, {
        account: { provider: 'x', name: 'Sendae' }, items: [{ text: 'https://novogamer.com/', media_ids: [] }],
    }));

    assert.match(html, /aria-label="Website preview"/);
    assert.match(html, /src="data:image\/png;base64,example"/);
    assert.match(html, /&lt;script&gt;News&lt;\/script&gt;/);
    assert.match(html, /Latest &amp; greatest/);
    assert.match(html, /network-link-card large/);
    assert.doesNotMatch(html, /title="https:\/\/novogamer.com\/"/);

    const inline = await renderToString(Vue.createSSRApp(CardPreview, {
        account: { provider: 'x', name: 'Sendae' }, items: [{ text: 'Read https://novogamer.com/ today', media_ids: [] }],
    }));
    assert.match(inline, /title="https:\/\/novogamer.com\/"/);
});
