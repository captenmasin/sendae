import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Vue from 'vue';
import { parse, compileScript } from 'vue/compiler-sfc';
import { renderToString } from '@vue/server-renderer';
import * as Workspace from '../resources/js/workspace.js';

process.env.TZ = 'Europe/London';

function component(name) {
    const { descriptor } = parse(readFileSync(new URL('../resources/js/' + name, import.meta.url), 'utf8'));
    const compiled = compileScript(descriptor, { id: name, inlineTemplate: true, genDefaultAs: 'component' });
    const modules = [];
    const lucide = new Proxy({}, { get: (_target, exportName) => exportName === '__esModule' ? true : { name: exportName, setup: () => () => Vue.h('svg', { 'aria-hidden': 'true' }) } });
    const code = compiled.content.replace(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g, (_, bindings, source) => {
        modules.push(source === 'vue' ? Vue : source === '@lucide/vue' ? lucide : source === './workspace.js' ? Workspace : component(source.slice(2)));
        return `const ${bindings.replace(/\bas\b/g, ':')} = modules[${modules.length - 1}];`;
    });
    return new Function('modules', code + '\nreturn component;')(modules);
}

function nodes(tree) {
    return [tree, ...(Array.isArray(tree?.children) ? tree.children.flatMap(nodes) : [])];
}

async function calendar(publications = []) {
    const Page = component('PublicationsPage.vue');
    const Dialogs = component('AppDialogs.vue');
    let workspace, render, renderDialogs, dialogTree;
    await renderToString(Vue.createSSRApp({
        setup() {
            workspace = Workspace.createWorkspace();
            workspace.authenticated.value = true;
            workspace.state.value.publications = publications;
            workspace.state.value.accounts = [{ id: 'account', provider: 'threads', name: 'Sendae' }];
            workspace.page.value = 'Calendar';
            Vue.provide(Workspace.workspaceKey, workspace);
            return () => [
                Vue.h({ setup() { render = Page.setup({}, { expose() {} }); return render; } }),
                Vue.h({ setup() { renderDialogs = Dialogs.setup({}, { expose() {} }); return renderDialogs; } }),
            ];
        },
    }));
    const tree = () => render({}, []);
    const html = () => renderToString(Vue.createSSRApp({ render: () => [tree(), dialogTree = renderDialogs({}, [])] }));
    return {
        workspace,
        nodes: () => nodes(tree()),
        dialogNodes: async () => { await html(); return nodes(dialogTree); },
        button: label => nodes(tree()).find(node => node?.type === 'button' && (node.props?.['aria-label'] === label || (typeof node.children === 'string' && node.children.trim() === label))),
        days: () => nodes(tree()).filter(node => node?.type === 'div' && node.props?.class?.split(' ').includes('calendar-day')),
        html,
    };
}

const post = (id, scheduled_at, status = 'scheduled') => ({ id, account_id: 'account', scheduled_at, status, snapshot: { title: id } });

test('calendar shows every queued post in its local day and selects all posts for a day', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-31T12:00:00Z') });
    const app = await calendar([
        post('Later post', '2026-08-31T14:00:00Z'),
        post('Across UTC midnight', '2026-08-30T23:30:00Z'),
        post('Retry post', '2026-08-31T10:00:00Z', 'retry'),
        post('Publishing post', '2026-08-31T11:00:00Z', 'publishing'),
        post('Other day', '2026-08-30T12:00:00Z'),
        post('Published post', '2026-08-31T12:00:00Z', 'published'),
        post('Cancelled post', '2026-08-31T12:00:00Z', 'cancelled'),
        post('Invalid date', 'invalid'),
        post('Missing date', null),
    ]);

    assert.equal(app.days().length, 42);
    assert.match(app.days()[0].props['aria-label'], /27.*July|July 27/);
    assert.match(app.days().at(-1).props['aria-label'], /6.*September|September 6/);
    const today = app.days().find(day => day.props['aria-current'] === 'date');
    assert.match(today.props['aria-label'], /4 queued posts/);
    const dayHtml = await renderToString(Vue.createSSRApp({ render: () => today }));
    assert.match(dayHtml, /Across UTC midnight/);
    assert.match(dayHtml, /Retry post/);
    assert.match(dayHtml, /Publishing post/);
    assert.match(dayHtml, /Later post/);
    assert.doesNotMatch(dayHtml, /Published post|Cancelled post|Other day|Invalid date|Missing date/);
    const dayPosts = nodes(today).filter(node => node?.props?.class === 'calendar-post');
    assert.equal(dayPosts.length, 4);
    dayPosts.at(-1).props.onClick({ stopPropagation() {} });
    assert.equal(app.workspace.recovery.value.id, 'Later post');
    app.workspace.recovery.value = null;
    assert.match(await app.html(), /Times in Europe\/London/);

    today.props.onClick();
    let html = await app.html();
    assert.match(html, /<h3>Later post<\/h3>/);
    assert.match(html, /<h3>Publishing post<\/h3>/);
    assert.doesNotMatch(html, /<h3>Other day<\/h3>|<h3>Invalid date<\/h3>|<h3>Missing date<\/h3>/);
    assert.equal(nodes(app.days().find(day => day.props['aria-current'] === 'date')).find(node => node?.props?.class === 'calendar-day-number').props['aria-pressed'], true);

    const cancelled = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        cancelled.push({ url, body: options?.body });
        return { ok: true, json: async () => ({ ...app.workspace.state.value, publications: [] }) };
    });
    const originalDocument = globalThis.document;
    globalThis.document = { querySelector: () => ({ content: 'csrf' }) };
    t.after(() => { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
    await app.button('Unschedule').props.onClick();
    assert.equal(cancelled[0].url, '/local/cancel');
    assert.deepEqual(JSON.parse(cancelled[0].body), { id: 'Across UTC midnight', separate: true });
    html = await app.html();
    assert.match(html, /No queued posts for this day/);
    assert.equal(app.days().find(day => day.props['aria-current'] === 'date').props['aria-label'].endsWith('0 queued posts'), true);
});

test('calendar combines accounts for the same draft and time while keeping separate schedules distinct', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-21T08:00:00Z') });
    const shared = Array.from({ length: 5 }, (_, index) => ({
        ...post('publication-' + index, '2026-09-21T10:14:00Z'),
        draft_id: 'shared-draft', account_id: 'account-' + index, snapshot: { title: 'Shared post' },
    }));
    const app = await calendar([
        ...shared,
        { ...shared[0], id: 'later', scheduled_at: '2026-09-21T14:00:00Z' },
        { ...shared[0], id: 'separate', draft_id: 'another-draft' },
        { ...shared[0], id: 'legacy-one', draft_id: null },
        { ...shared[0], id: 'legacy-two', draft_id: null },
    ]);
    app.workspace.state.value.accounts = shared.map((p, index) => ({ id: p.account_id, name: 'Account ' + index, provider: 'threads', avatar_url: 'https://example.com/avatar.png' }));
    const today = app.days().find(day => day.props['aria-current'] === 'date');
    assert.match(today.props['aria-label'], /5 queued posts/);
    const dayHtml = await renderToString(Vue.createSSRApp({ render: () => today }));
    assert.equal((dayHtml.match(/<strong>Shared post<\/strong>/g) || []).length, 5);
    const group = nodes(today).find(node => node?.props?.class === 'calendar-post calendar-post-group');
    const accounts = nodes(group).filter(node => node?.props?.class === 'calendar-post-account');
    assert.equal(accounts.length, 5);
    assert.deepEqual(accounts.map(node => node.props.title), ['Account 0', 'Account 1', 'Account 2', 'Account 3', 'Account 4']);
    const groupHtml = await renderToString(Vue.createSSRApp({ render: () => group }));
    assert.equal((groupHtml.match(/role="img"/g) || []).length, 5);
    assert.equal((groupHtml.match(/aria-label="Threads"/g) || []).length, 5);
    assert.doesNotMatch(groupHtml, /<img/);

    accounts[4].props.onClick({ stopPropagation() {} });
    assert.equal(app.workspace.recovery.value.id, 'publication-4');
    app.workspace.state.value.publications[4].status = 'publishing';
    const locked = app.nodes().find(node => node?.props?.title === 'Account 4');
    assert.equal(locked.props.disabled, true);
    assert.equal(locked.props.draggable, false);
});

test('calendar agenda and list show one heading per scheduled post with network logos and account controls', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-21T08:00:00Z') });
    const app = await calendar([
        { ...post('threads-post', '2026-09-21T10:00:00Z'), draft_id: 'draft', snapshot: { title: 'Shared post' } },
        { ...post('bluesky-post', '2026-09-21T10:00:00Z'), draft_id: 'draft', account_id: 'bluesky', snapshot: { title: 'Shared post' } },
        { ...post('later-post', '2026-09-22T10:00:00Z'), draft_id: 'draft', snapshot: { title: 'Later schedule' } },
    ]);
    app.workspace.state.value.accounts = [
        { id: 'account', name: 'Threads account', provider: 'threads', avatar_url: 'https://example.com/avatar.png' },
        { id: 'bluesky', name: 'Bluesky account', provider: 'bluesky', avatar_url: 'https://example.com/avatar.png' },
    ];

    assert.equal(((await app.html()).match(/<h3>Shared post<\/h3>/g) || []).length, 1);
    app.days().find(day => day.props['aria-current'] === 'date').props.onClick();
    assert.doesNotMatch(await app.html(), /<h3>Later schedule<\/h3>/);
    app.button('List').props.onClick();
    const html = await app.html();
    assert.equal((html.match(/<h3>Shared post<\/h3>/g) || []).length, 1);
    assert.match(html, /<h3>Later schedule<\/h3>/);
    assert.match(html, /<details[^>]*><summary>Manage 2 accounts<\/summary>/);
    assert.match(html, /aria-label="Threads"/);
    assert.match(html, /aria-label="Bluesky"/);
    assert.doesNotMatch(html, /<img/);
    const row = app.nodes().find(node => node?.props?.class === 'publication-row' && nodes(node).some(child => child?.children === 'Bluesky account'));
    nodes(row).find(node => node?.type === 'button' && node.children?.trim?.() === 'Change date & time').props.onClick();
    assert.equal(app.workspace.recovery.value.id, 'bluesky-post');
});

test('dragging a grouped account changes only its publication day and preserves local time across daylight saving', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T12:00:00Z') });
    const app = await calendar([
        { ...post('Move me', '2026-10-23T08:30:00Z'), draft_id: 'shared-draft' },
        { ...post('Keep me', '2026-10-23T08:30:00Z'), draft_id: 'shared-draft', account_id: 'another-account' },
    ]);
    const originalDocument = globalThis.document;
    globalThis.document = { querySelector: () => ({ content: 'csrf' }) };
    t.after(() => { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
    const requests = [];
    let updated;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        if (url === '/local/recover') {
            const payload = JSON.parse(options.body);
            requests.push(payload);
            assert.equal(app.workspace.state.value.publications[0].scheduled_at, '2026-10-23T08:30:00Z');
            updated = { ...app.workspace.state.value, publications: app.workspace.state.value.publications.map(p => p.id === payload.id ? { ...p, scheduled_at: payload.scheduled_at } : p) };
        }
        return { ok: true, json: async () => url === '/local/state' ? updated : {} };
    });
    const item = app.nodes().find(node => node?.props?.['aria-label']?.startsWith('Change date and time for Move me'));
    const transfer = { setData() {} };
    item.props.onDragstart({ dataTransfer: transfer });
    assert.equal(transfer.effectAllowed, 'move');
    const target = app.days().find(day => day.props['aria-label'].startsWith('Sunday') && day.props['aria-label'].includes('25'));
    await target.props.onDrop({ preventDefault() {} });

    assert.deepEqual(requests, [{ id: 'Move me', action: 'reschedule', scheduled_at: '2026-10-25T09:30:00.000Z' }]);
    assert.equal(app.workspace.state.value.publications[1].scheduled_at, '2026-10-23T08:30:00Z');
    assert.match(app.days().find(day => day.props['aria-label'].startsWith('Sunday') && day.props['aria-label'].includes('25')).props['aria-label'], /1 queued posts/);
    assert.equal(app.workspace.notice.value, 'Post rescheduled.');
    await target.props.onDrop({ preventDefault() {} });
    assert.equal(requests.length, 1, 'Unrelated external drops do nothing');
});

test('clicking edits date and time, keeps failed edits open, and blocks invalid or in-flight changes', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-03-20T12:00:00Z') });
    const app = await calendar([post('Edit me', '2026-03-27T09:30:00Z'), post('Locked', '2026-03-27T10:00:00Z', 'publishing')]);
    const originalDocument = globalThis.document;
    globalThis.document = { querySelector: () => ({ content: 'csrf' }) };
    t.after(() => { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
    const requests = [];
    let fail = true;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        if (url === '/local/recover') requests.push(JSON.parse(options.body));
        return {
            ok: !fail, status: fail ? 422 : 200,
            json: async () => fail ? { message: 'Publishing has already started.' } : { ...app.workspace.state.value, publications: [post('Edit me', '2026-03-30T13:45:00Z')] },
        };
    });
    const item = app.nodes().find(node => node?.props?.['aria-label']?.startsWith('Change date and time for Edit me'));
    item.props.onClick({ stopPropagation() {} });
    assert.equal(app.workspace.recoveryAt.value, '2026-03-27T09:30');
    assert.match(await app.html(), /Change date &amp; time/);
    const input = (await app.dialogNodes()).find(node => node?.props?.type === 'datetime-local');
    const submit = async () => (await app.dialogNodes()).find(node => node?.type === 'form').props.onSubmit({ preventDefault() {} });

    for (const value of ['', '2026-03-19T09:00', 'invalid', '2026-03-29T01:30']) {
        input.props['onUpdate:modelValue'](value);
        await submit();
        assert.equal(requests.length, 0);
        assert.ok(app.workspace.error.value);
        assert.ok(app.workspace.recovery.value);
    }
    input.props['onUpdate:modelValue']('2026-03-30T14:45');
    await submit();
    assert.match(await app.html(), /role="alert">Publishing has already started/);
    assert.equal(app.workspace.state.value.publications[0].scheduled_at, '2026-03-27T09:30:00Z');
    assert.equal(app.workspace.recoveryAt.value, '2026-03-30T14:45');

    const locked = app.nodes().find(node => node?.props?.['aria-label']?.startsWith('Change date and time for Locked'));
    assert.equal(locked.props.disabled, true);
    assert.equal(locked.props.draggable, false);
    app.workspace.busy.value = true;
    await submit();
    assert.equal(requests.length, 1);
    app.workspace.busy.value = false;
    fail = false;
    await submit();
    assert.deepEqual(requests[1], { id: 'Edit me', action: 'reschedule', scheduled_at: '2026-03-30T13:45:00.000Z' });
    assert.equal(app.workspace.recovery.value, null);
    assert.equal(app.workspace.state.value.publications[0].scheduled_at, '2026-03-30T13:45:00Z');
});

test('failed drops retain the original date and drags cannot cross workspace boundaries', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-10T12:00:00Z') });
    const app = await calendar([post('Move me', '2026-09-18T09:30:00Z')]);
    const originalDocument = globalThis.document;
    globalThis.document = { querySelector: () => ({ content: 'csrf' }) };
    t.after(() => { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push({ url, body: options?.body });
        return { ok: false, status: 422, json: async () => ({ message: 'This post is already publishing.' }) };
    });
    const item = () => app.nodes().find(node => node?.props?.['aria-label']?.startsWith('Change date and time for Move me'));
    const start = () => item().props.onDragstart({ dataTransfer: { setData() {} } });
    const day = number => app.days().find(day => day.props['aria-label'].includes('September ' + number + ','));
    const drop = number => day(number).props.onDrop({ preventDefault() {} });

    start();
    await drop(18);
    assert.equal(requests.length, 0, 'Dropping on the same day does nothing');
    start();
    await drop(19);
    assert.equal(requests.length, 1);
    assert.equal(app.workspace.error.value, 'This post is already publishing.');
    assert.equal(app.workspace.state.value.publications[0].scheduled_at, '2026-09-18T09:30:00Z');
    assert.match(day(18).props['aria-label'], /1 queued posts/);
    assert.match(day(19).props['aria-label'], /0 queued posts/);

    start();
    app.workspace.state.value.settings.workspace_id = 'another-workspace';
    await Vue.nextTick();
    await drop(19);
    assert.equal(requests.length, 1);
    app.workspace.state.value.publications[0].status = 'publishing';
    assert.equal(item().props.draggable, false);
    let prevented = false;
    item().props.onDragstart({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    await drop(19);
    assert.equal(requests.length, 1);
});

test('month navigation handles leap days, year boundaries, empty days, Today and the list toggle', async t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2028-02-29T12:00:00Z') });
    const app = await calendar([post('Future post', '2028-06-01T10:00:00Z')]);

    assert.match(await app.html(), /February 2028/);
    assert.equal(app.days().filter(day => day.props['aria-current'] === 'date').length, 1);
    app.button('Previous month').props.onClick();
    app.button('Previous month').props.onClick();
    assert.match(await app.html(), /December 2027/);
    app.button('Next month').props.onClick();
    assert.match(await app.html(), /January 2028/);
    app.button('Today').props.onClick();
    assert.match(await app.html(), /February 2028/);
    assert.match(await app.html(), /No queued posts for this day/);

    app.button('List').props.onClick();
    assert.match(await app.html(), /<h3>Future post<\/h3>/);
    assert.doesNotMatch(await app.html(), /schedule-calendar/);
    app.button('Calendar').props.onClick();
    app.button('Show all queued posts').props.onClick();
    assert.match(await app.html(), /<h3>Future post<\/h3>/);

    app.workspace.state.value.publications = [];
    assert.match(await app.html(), /No queued posts<\/h2>/);
    app.workspace.page.value = 'Published';
    assert.doesNotMatch(await app.html(), /schedule-calendar|Schedule view/);
    assert.match(await app.html(), /No publications/);
});

test('the date and time dialog can unschedule without submitting a new date', async t => {
    const app = await calendar([post('Remove schedule', '2026-10-23T08:30:00Z')]);
    const originalDocument = globalThis.document;
    globalThis.document = { querySelector: () => ({ content: 'csrf' }) };
    t.after(() => { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push(url);
        if (url === '/local/cancel') assert.deepEqual(JSON.parse(options.body), { id: 'Remove schedule', separate: true });
        return { ok: true, json: async () => ({ ...app.workspace.state.value, publications: [post('Remove schedule', '2026-10-23T08:30:00Z', 'cancelled')] }) };
    });
    app.workspace.openRecovery(app.workspace.state.value.publications[0]);
    app.workspace.recoveryAt.value = '';
    const button = (await app.dialogNodes()).find(node => node?.type === 'button' && node.children?.trim?.() === 'Unschedule');
    assert.equal(button.props.type, 'button');

    await button.props.onClick();

    assert.deepEqual(requests, ['/local/cancel', '/local/state']);
    assert.equal(app.workspace.recovery.value, null);
    assert.equal(app.workspace.queue.value.length, 0);
});
