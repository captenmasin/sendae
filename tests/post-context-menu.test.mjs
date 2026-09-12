import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ref, nextTick } from 'vue';

const source = readFileSync(new URL('../resources/js/PostsPage.vue', import.meta.url), 'utf8');

function menuContext(selected = []) {
    const calls = [];
    const context = { ref, nextTick, busy: ref(false), syncing: ref(false), selectedDraftIds: ref(selected), window: { innerWidth: 800, innerHeight: 600 }, deleteDrafts: async ids => calls.push([...ids]) };
    const menu = runInNewContext(source.slice(source.indexOf('const contextMenu ='), source.indexOf('</script>')) + ';({ contextMenu, showContextMenu, closeContextMenu, deleteFromContextMenu })', context);
    const target = { getBoundingClientRect: () => ({ left: 100, bottom: 220 }), focus() {} };
    const event = { currentTarget: target, clientX: 790, clientY: 590, preventDefault() {} };
    return { ...context, ...menu, calls, event };
}

test('right-click deletion targets the clicked post or its existing multi-selection and fits the viewport', async () => {
    for (const selected of [[], ['other'], ['first', 'second']]) {
        const menu = menuContext(selected);
        await menu.showContextMenu(menu.event, { id: 'first' });
        assert.equal(menu.contextMenu.value.left, 592);
        assert.equal(menu.contextMenu.value.top, 540);
        await menu.deleteFromContextMenu();
        assert.deepEqual(menu.calls, [selected.includes('first') ? selected : ['first']]);
        assert.equal(menu.contextMenu.value, null);
        assert.deepEqual(menu.selectedDraftIds.value, selected);
    }
});

test('keyboard context menu anchors to the row and dismissing it never deletes', async () => {
    const menu = menuContext();
    await menu.showContextMenu({ ...menu.event, clientX: 0, clientY: 0 }, { id: 'first' });
    assert.equal(menu.contextMenu.value.left, 100);
    assert.equal(menu.contextMenu.value.top, 220);
    menu.closeContextMenu();
    assert.equal(menu.contextMenu.value, null);
    assert.deepEqual(menu.calls, []);
    for (const state of ['busy', 'syncing']) {
        menu[state].value = true;
        await menu.showContextMenu(menu.event, { id: 'first' });
        assert.equal(menu.contextMenu.value, null);
        menu[state].value = false;
    }
});
