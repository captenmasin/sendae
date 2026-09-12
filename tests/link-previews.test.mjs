import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, reactive, nextTick } from 'vue';
import { previewTextParts, useLinkPreviews } from '../resources/js/linkPreviews.js';

function mount(props) {
    let preview;
    const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
    const app = renderer.createApp({ setup() { preview = useLinkPreviews(props); return () => null; } });
    app.mount({});
    return { preview, app };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('link text keeps balanced parentheses, fragments and Unicode while shortening X URLs only', () => {
    assert.deepEqual(previewTextParts('(https://example.com/a_(b)#section).', 'x'), [
        { value: '(' }, { value: 'example.com/a_(b)#section', link: true, url: 'https://example.com/a_(b)#section' }, { value: ').' },
    ]);
    assert.equal(previewTextParts('https://example.com/', 'linkedin')[0].value, 'https://example.com/');
    assert.equal(previewTextParts('www.example.com', 'x')[0].url, 'https://www.example.com');
    assert.equal(previewTextParts('https://example.com/' + 'a'.repeat(80), 'x')[0].value.length, 40);
    assert.deepEqual(previewTextParts('https:// javascript:alert(1)', 'x'), [{ value: 'https:// javascript:alert(1)' }]);
    assert.equal(previewTextParts('https://user:password@example.com', 'x')[0].link, undefined);
    assert.equal(previewTextParts('#日本語', 'x')[0].link, true);
});

test('card requests debounce, ignore stale responses and disappear when media replaces the card', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => calls.push({ url, options, resolve })));
    const props = reactive({ account: { provider: 'x' }, items: [{ text: 'https://one.example/', media_ids: [] }] });
    const { preview, app } = mount(props);
    t.after(() => app.unmount());
    t.mock.timers.tick(500);
    assert.equal(calls.length, 1);
    props.items[0].text = 'https://two.example/';
    await nextTick();
    t.mock.timers.tick(500);
    calls[0].resolve({ ok: true, json: async () => ({ card: { title: 'Stale' } }) });
    calls[1].resolve({ ok: true, json: async () => ({ card: { title: 'Current' } }) });
    await settle();
    assert.equal(calls[0].options.signal.aborted, true);
    assert.equal(preview.cardFor(props.items[0]).title, 'Current');

    props.items[0].text = 'Changed text https://two.example/';
    await nextTick();
    t.mock.timers.tick(500);
    assert.equal(calls.length, 2);
    assert.equal(preview.cardFor(props.items[0]).title, 'Current');
    props.items[0].media_ids = ['photo'];
    await nextTick();
    assert.equal(preview.cardFor(props.items[0]), null);
    props.items[0].media_ids = [];
    props.account.provider = 'unsupported';
    await nextTick();
    t.mock.timers.tick(500);
    assert.equal(calls.length, 2);
});

test('failed metadata lookups leave text intact and identical thread links share a lookup', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Offline'); });
    const props = reactive({ account: { provider: 'threads' }, items: [{ text: 'https://example.com' }, { text: 'https://example.com' }] });
    const { preview, app } = mount(props);
    t.after(() => app.unmount());

    t.mock.timers.tick(500);
    await settle();

    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(preview.cardFor(props.items[0]), null);
    assert.equal(props.items[0].text, 'https://example.com');
});

test('bare domains render as links without linking email addresses or version numbers', () => {
    assert.deepEqual(previewTextParts('test novogamer.com', 'x'), [
        { value: 'test ' }, { value: 'novogamer.com', link: true, url: 'https://novogamer.com' },
    ]);
    assert.deepEqual(previewTextParts('(news.example.co.uk/story?lang=en#latest).', 'x').map(part => part.url).filter(Boolean), ['https://news.example.co.uk/story?lang=en#latest']);
    for (const text of ['hello@novogamer.com', 'version 1.2.3', 'file:///novogamer.com', '@novogamer.com']) {
        assert.equal(previewTextParts(text, 'x').some(part => part.url), false, text);
    }
});

test('the screenshot’s bare domain requests a website card without changing the draft', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fetch = t.mock.method(globalThis, 'fetch', async url => {
        assert.equal(new URL(url, 'http://localhost').searchParams.get('url'), 'https://novogamer.com');
        return { ok: true, json: async () => ({ card: { title: 'Novogamer' } }) };
    });
    const props = reactive({ account: { provider: 'x' }, items: [{ text: 'test novogamer.com', media_ids: [] }] });
    const { preview, app } = mount(props);
    t.after(() => app.unmount());

    t.mock.timers.tick(500);
    await settle();

    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(preview.cardFor(props.items[0]).title, 'Novogamer');
    assert.equal(props.items[0].text, 'test novogamer.com');
});

for (const provider of ['x', 'threads', 'facebook', 'linkedin', 'linkedin_page', 'bluesky']) {
    test(`${provider} loads website cards for its own post text`, async t => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const fetch = t.mock.method(globalThis, 'fetch', async url => {
            const query = new URL(url, 'http://localhost').searchParams;
            assert.equal(query.get('provider'), provider);
            assert.equal(query.get('url'), 'https://novogamer.com');
            return { ok: true, json: async () => ({ card: { title: 'Gaming news', image: 'data:image/png;base64,example', large: true } }) };
        });
        const props = reactive({ account: { provider }, items: [{ text: 'test https://novogamer.com' }] });
        const { preview, app } = mount(props);
        t.after(() => app.unmount());

        t.mock.timers.tick(500);
        await settle();

        assert.equal(fetch.mock.callCount(), 1);
        assert.equal(preview.cardFor(props.items[0]).title, 'Gaming news');
        assert.equal(preview.cardFor(props.items[0]).image, 'data:image/png;base64,example');
    });
}
