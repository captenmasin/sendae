import test from 'node:test';
import assert from 'node:assert/strict';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { createWorkspace } from '../resources/js/workspace.js';

async function setup(t) {
    const originalDocument = globalThis.document;
    globalThis.document = { querySelector: () => ({ content: 'csrf-token' }) };
    t.after(() => { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
    let app;
    await renderToString(createSSRApp({ setup() { app = createWorkspace(); return () => null; } }));
    const draft = { id: 'draft', title: 'Launch', version: 1, content: { items: [{ text: 'Shared', media_ids: [] }], overrides: { x: [{ text: 'X version', media_ids: [] }] }, account_ids: ['x', 'threads'] } };
    const post = (id, draft_id = draft.id) => ({ id, draft_id, status: 'scheduled', snapshot: { title: 'Original snapshot' }, receipts: [] });
    app.authenticated.value = true;
    app.state.value = { drafts: [draft], accounts: [], media: [], publications: [post('x'), post('threads'), post('other', 'another-draft')], settings: { providers: {} } };
    await app.openDraft(draft);
    return app;
}

function fakeServer(t, app, failId = null) {
    const remote = JSON.parse(JSON.stringify(app.state.value));
    const calls = [];
    const payloads = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push(url);
        if (url === '/local/cancel') {
            payloads.push(JSON.parse(options.body));
            const { id } = JSON.parse(options.body);
            calls.push(id);
            const publication = remote.publications.find(post => post.id === id);
            publication.status = id === failId ? 'publishing' : 'cancelled';
            if (id === failId) return { ok: false, json: async () => ({ message: 'Publishing has already started.' }) };
        }
        return { ok: true, json: async () => url === '/local/state' ? structuredClone(remote) : {} };
    });
    return { remote, calls, payloads };
}

test('unscheduling a draft stops every remaining destination and keeps all saved content', async t => {
    const app = await setup(t);
    const original = JSON.parse(JSON.stringify(app.editor.value));
    const server = fakeServer(t, app);

    await app.unschedule();

    assert.deepEqual(server.calls, ['/local/cancel', 'x', '/local/cancel', 'threads', '/local/state']);
    assert.deepEqual(server.payloads, [{ id: 'x' }, { id: 'threads' }]);
    assert.deepEqual(JSON.parse(JSON.stringify(app.editor.value)), original);
    assert.equal(app.scheduledLocked.value, false);
    assert.equal(app.canUnscheduleDraft.value, false);
    assert.equal(app.publicationStatuses.value.draft, undefined, 'An unscheduled post displays as a draft');
    assert.deepEqual(app.queue.value.map(post => post.id), ['other']);
    assert.equal(app.history.value.length, 2, 'Cancellation history remains available');
    assert.equal(app.notice.value, 'Post unscheduled from 2 destinations.');
});

test('unscheduling from a calendar dialog affects only that publication and preserves thread receipts', async t => {
    const app = await setup(t);
    const publication = app.state.value.publications[0];
    publication.status = 'retry';
    publication.receipts = ['already-live'];
    app.openRecovery(publication);
    const server = fakeServer(t, app);

    await app.unschedule(publication);

    assert.deepEqual(server.calls, ['/local/cancel', 'x', '/local/state']);
    assert.deepEqual(server.payloads, [{ id: 'x', separate: true }]);
    assert.deepEqual(app.state.value.publications[0].receipts, ['already-live']);
    assert.equal(app.state.value.publications[0].snapshot.title, 'Original snapshot');
    assert.equal(app.recovery.value, null);
    assert.equal(app.scheduledLocked.value, true, 'Another destination remains scheduled');
    assert.equal(app.notice.value, 'Post unscheduled.');
});

test('a publishing race refreshes completed cancellations, keeps remaining schedules locked and reports failure', async t => {
    const app = await setup(t);
    const server = fakeServer(t, app, 'threads');

    await app.unschedule();

    assert.deepEqual(server.calls, ['/local/cancel', 'x', '/local/cancel', 'threads', '/local/state']);
    assert.deepEqual(app.queue.value.map(post => post.id), ['threads', 'other']);
    assert.equal(app.scheduledLocked.value, true);
    assert.equal(app.notice.value, '');
    assert.equal(app.error.value, 'Publishing has already started.');
    assert.equal(app.editor.value.id, 'draft');
    server.calls.length = 0;
    await app.unschedule(app.state.value.publications[1]);
    assert.deepEqual(server.calls, []);
    assert.match(app.error.value, /can no longer be unscheduled/);
});

test('unscheduling waits for pending edits and leaves schedules intact when saving fails', async t => {
    const app = await setup(t);
    const calls = [];
    t.mock.method(globalThis, 'fetch', async url => {
        calls.push(url);
        return { ok: false, json: async () => ({ message: 'Save failed.' }) };
    });
    for (const key of ['busy', 'syncing']) {
        app[key].value = true;
        await app.unschedule();
        app[key].value = false;
    }
    assert.deepEqual(calls, []);
    app.pending.value = true;
    await app.unschedule();
    assert.deepEqual(calls, ['/local/drafts']);
    assert.equal(app.pending.value, true);
    assert.equal(app.scheduledLocked.value, true);
    assert.equal(app.error.value, 'Save failed.');
});

for (const action of ['unschedule', 'reschedule']) {
    test(`${action} refreshes the original editor and exposes the independent post returned by the server`, async t => {
        const app = await setup(t);
        const original = JSON.parse(JSON.stringify(app.state.value));
        const separated = structuredClone(original);
        separated.drafts[0].content.account_ids = ['threads'];
        separated.drafts[0].version = 2;
        separated.drafts.push({ ...structuredClone(original.drafts[0]), id: 'separate-draft', content: { items: [{ text: 'X version', media_ids: [] }], overrides: {}, account_ids: ['x'] } });
        separated.publications[0].draft_id = 'separate-draft';
        separated.publications[0].status = action === 'unschedule' ? 'cancelled' : 'scheduled';
        const requests = [];
        t.mock.method(globalThis, 'fetch', async (url, options) => {
            requests.push({ url, body: options?.body && JSON.parse(options.body) });
            return { ok: true, json: async () => url === '/local/state' ? structuredClone(separated) : {} };
        });

        const publication = app.state.value.publications[0];
        if (action === 'unschedule') await app.unschedule(publication);
        else await app.reschedule(publication, app.localDateTime(new Date(Date.now() + 86400000)));

        assert.equal(app.error.value, '');
        assert.equal(requests[0].body.id, 'x');
        assert.deepEqual(app.editor.value.content.account_ids, ['threads']);
        assert.equal(app.editor.value.version, 2);
        assert.equal(app.state.value.publications[0].draft_id, 'separate-draft');
        await app.openDraft(app.state.value.drafts.find(draft => draft.id === 'separate-draft'));
        assert.deepEqual(app.editor.value.content.account_ids, ['x']);
        assert.equal(app.editor.value.content.items[0].text, 'X version');
    });
}
