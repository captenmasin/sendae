import { ref, computed, watch, onMounted, onBeforeUnmount, inject } from 'vue';

export const workspaceKey = Symbol('workspace');

export function useWorkspace() {
    return inject(workspaceKey);
}

export function createWorkspace() {
    const state = ref({ drafts: [], accounts: [], media: [], publications: [], settings: { providers: {} } });
    const authenticated = ref(false),
        authMode = ref('signIn'),
        fullName = ref(''),
        confirmPassword = ref(''),
        authNotice = ref('');
    const page = ref('Posts'),
        editor = ref(null),
        network = ref('shared'),
        search = ref(''),
        notice = ref(''),
        error = ref(''),
        saving = ref(false),
        syncing = ref(false),
        busy = ref(false),
        loaded = ref(false);
    const workspaceForm = ref(null);
    const workspaceImageObjectUrl = ref('');
    const currentWorkspace = computed(() => {
        const workspace =
            state.value.settings.workspaces?.find((w) => w.id === state.value.settings.workspace_id) || {
                id: state.value.settings.workspace_id,
                name: 'Personal',
            };
        const name = (workspace.name || 'Personal').trim();
        return { ...workspace, icon: workspace.icon || (name && Array.from(name)[0].toUpperCase()) || 'P' };
    });
    const theme = ref('system');
    const systemDark = ref(false);
    try {
        const stored = globalThis.localStorage?.getItem('sendae.theme');
        if (stored === 'light' || stored === 'dark' || stored === 'system') theme.value = stored;
        systemDark.value = !!globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches;
    } catch {
        // Theme stays on system when storage or media queries are unavailable.
    }
    const colorScheme = computed(() => (theme.value === 'system' ? (systemDark.value ? 'dark' : 'light') : theme.value));
    function applyTheme(scheme) {
        try {
            if (globalThis.document?.documentElement) document.documentElement.dataset.theme = scheme;
        } catch {
            // Rendering can proceed without a document root.
        }
    }
    function setTheme(value) {
        theme.value = value;
        try {
            globalThis.localStorage?.setItem('sendae.theme', value);
        } catch {
            // A storage failure must not block the visible theme.
        }
        applyTheme(colorScheme.value);
    }
    watch(colorScheme, applyTheme, { immediate: true });
    const gravatarUrl = ref('');
    const profileForm = ref({
        name: '',
        email: '',
        current_password: '',
        password: '',
        password_confirmation: '',
    });
    const savingProfile = ref(false);
    const previewOpen = ref(false);
    const allowScheduledEdit = ref(false);
    const workingItems = ref(null);
    const recovery = ref(null),
        recoveryAction = ref('reschedule'),
        recoveryAt = ref(''),
        recoveryId = ref('');
    const scheduleOpen = ref(false),
        scheduleMode = ref('exact'),
        scheduleAt = ref(''),
        email = ref(''),
        password = ref('');
    const slotsAccount = ref(null),
        timezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone),
        slots = ref([]);
    let connectTimer,
        linkTimer,
        readingLink = false;
    const pendingLink = ref(null),
        connectionForm = ref(null),
        authorizationForm = ref(null),
        resetForm = ref(null);
    const blueskyForm = ref(null);
    const names = {
        x: 'X',
        bluesky: 'Bluesky',
        threads: 'Threads',
        facebook: 'Facebook',
        linkedin: 'LinkedIn',
        linkedin_page: 'LinkedIn Page',
    };
    const clone = (v) => JSON.parse(JSON.stringify(v));
    const date = (v) =>
        new Date(v).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    const now = ref(Date.now());
    function publicationStatus(p) {
        if (p.status !== 'scheduled' || !p.scheduled_at) return p.status;
        const remaining = new Date(p.scheduled_at).getTime() - now.value;
        if (!Number.isFinite(remaining)) return p.status;
        if (remaining <= 0) return 'Scheduled · due now';
        if (remaining < 60000) return 'Scheduled · in less than a minute';
        const minutes = Math.ceil(remaining / 60000);
        const duration = [
            [Math.floor(minutes / 1440), 'd'],
            [Math.floor((minutes % 1440) / 60), 'h'],
            [minutes % 60, 'm'],
        ]
            .filter(([value]) => value)
            .map(([value, unit]) => value + unit)
            .join(' ');
        return 'Scheduled · in ' + duration;
    }
    const pending = ref(false);
    let savePromise = null,
        interval,
        countdownTimer;
    async function api(path, data, retried = false) {
        const response = await fetch('/local/' + path, {
            method: data === undefined ? 'GET' : 'POST',
            headers: {
                Accept: 'application/json',
                ...(state.value.settings.workspace_id
                    ? { 'X-Workspace-Id': state.value.settings.workspace_id }
                    : {}),
                'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content,
                ...(data instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
            },
            body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data),
        });
        if (response.status === 419 && !retried) {
            const fresh = await fetch('/local/csrf', { headers: { Accept: 'application/json' } });
            if (fresh.ok) {
                document.querySelector('meta[name="csrf-token"]').content = (await fresh.json()).token;
                return api(path, data, true);
            }
        }
        if (response.status === 401 && path !== 'signIn') {
            authenticated.value = false;
        }
        const result = await response.json();
        if (!response.ok)
            throw new Error(
                Object.values(result.errors || {})
                    .flat()
                    .join(' ') ||
                    result.message ||
                    'The request failed.',
            );
        return result;
    }
    async function refresh() {
        try {
            state.value = await api('state');
            authenticated.value = true;
        } finally {
            loaded.value = true;
        }
    }
    function report(e) {
        error.value = e.message;
    }
    async function act(fn) {
        error.value = '';
        busy.value = true;
        try {
            return await fn();
        } catch (e) {
            report(e);
        } finally {
            busy.value = false;
        }
    }
    function changed() {
        if (editor.value && network.value !== 'shared' && !editor.value.content.overrides[network.value] && workingItems.value) {
            editor.value.content.overrides[network.value] = workingItems.value;
            workingItems.value = null;
        }
        pending.value = true;
        flush().catch(report);
    }
    async function flush() {
        if (!authenticated.value) return;
        if (savePromise) return savePromise;
        if (!pending.value || !editor.value) return;
        savePromise = (async () => {
            saving.value = true;
            try {
                while (pending.value && editor.value) {
                    pending.value = false;
                    const payload = clone(editor.value);
                    const result = await api('drafts', payload);
                    if (editor.value?.id === payload.id) editor.value.version = result.draft.version;
                    const index = state.value.drafts.findIndex((d) => d.id === result.draft.id);
                    if (index < 0) state.value.drafts.unshift(result.draft);
                    else state.value.drafts[index] = result.draft;
                }
            } catch (e) {
                pending.value = true;
                throw e;
            } finally {
                saving.value = false;
                savePromise = null;
            }
        })();
        return savePromise;
    }
    async function openDraft(draft) {
        if (busy.value || syncing.value) return;
        return act(async () => {
            await flush();
            if (editor.value?.id !== draft.id) {
                editor.value = clone(state.value.drafts.find((post) => post.id === draft.id) || draft);
                network.value = 'shared';
                workingItems.value = null;
                allowScheduledEdit.value = false;
                previewOpen.value = false;
            }
            page.value = 'Posts';
            selectedDraftIds.value = [editor.value.id];
            selectionAnchor = editor.value.id;
            return true;
        });
    }
    async function closeDraft() {
        if (busy.value || syncing.value) return;
        return act(async () => {
            await flush();
            editor.value = null;
            selectedDraftIds.value = [];
            selectionAnchor = null;
            workingItems.value = null;
            return true;
        });
    }
    async function deleteDraft() {
        await deleteDrafts([editor.value.id]);
    }
    async function deleteDrafts(ids) {
        if (busy.value || syncing.value || !ids.length) return;
        ids = [...ids];
        if (
            !confirm(
                (ids.length === 1 ? 'Delete this post?' : 'Delete ' + ids.length + ' selected posts?') +
                    ' Queued and published posts will stay unchanged.',
            )
        )
            return;
        await act(async () => {
            notice.value = '';
            if (editor.value && !ids.includes(editor.value.id)) await flush();
            else pending.value = false;
            for (const id of ids) {
                await api('deleteDraft', { id });
                state.value.drafts = state.value.drafts.filter((d) => d.id !== id);
                selectedDraftIds.value = selectedDraftIds.value.filter((selected) => selected !== id);
                if (editor.value?.id === id) {
                    editor.value = null;
                    pending.value = false;
                    workingItems.value = null;
                }
            }
            notice.value = ids.length === 1 ? 'Post deleted.' : ids.length + ' posts deleted.';
        });
    }
    async function newDraft() {
        if (!authenticated.value || busy.value) return;
        await act(async () => {
            await flush();
            editor.value = {
                id: crypto.randomUUID(),
                title: '',
                version: 0,
                content: { items: [{ text: '', media_ids: [] }], overrides: {}, account_ids: [] },
            };
            network.value = 'shared';
            workingItems.value = null;
            allowScheduledEdit.value = false;
            previewOpen.value = false;
            page.value = 'Posts';
            search.value = '';
            selectedDraftIds.value = [editor.value.id];
            selectionAnchor = editor.value.id;
            changed();
        });
    }
    const publicationStatuses = computed(() => {
        const statuses = {};
        for (const publication of state.value.publications) {
            const counts = (statuses[publication.draft_id] ??= {});
            counts[publication.status] = (counts[publication.status] || 0) + 1;
        }
        return statuses;
    });
    function draftSummary(content) {
        const versions = [content.items, ...Object.values(content.overrides)];
        const text = versions
            .map((items) =>
                items
                    .map((item) => item.text)
                    .join(' ')
                    .trim(),
            )
            .find(Boolean);
        if (text) return text;
        const count = new Set(versions.flat().flatMap((item) => item.media_ids)).size;
        return count ? count + ' attachment' + (count === 1 ? '' : 's') : 'Empty post';
    }
    function customTitle(post) {
        const title = (post?.snapshot?.title ?? post?.title ?? '').trim();
        const base = title.replace(/(?: \(conflict copy\))+$/, '').replace(/\s+/g, ' ');
        // ponytail: legacy titles have no provenance; recognize the old English date formats without rewriting stored names.
        const timestamp = /^(?=.*\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b)(?:\d{1,2} [A-Za-z]+|[A-Za-z]+ \d{1,2}),? (?:at )?\d{1,2}:\d{2}(?: ?[ap]m)?$/i;
        return !base || ['Untitled draft', 'Untitled post', 'New post'].includes(base) || timestamp.test(base) ? '' : title;
    }
    function postTitle(post) {
        const name = customTitle(post);
        if (name) return name;
        const content = post?.snapshot ?? post?.content ?? {};
        const items = [...(content.items || []), ...Object.values(content.overrides || {}).flat()];
        const text = items.map((item) => (item.text || '').trim()).find(Boolean)?.split(/\r?\n/)[0].replace(/\s+/g, ' ') || '';
        const characters = Array.from(text);
        const mediaIds = items.flatMap((item) => item.media_ids || []);
        const media = mediaIds.map((id) => state.value.media?.find((item) => item.id === id));
        const preview = text ? characters.slice(0, 60).join('') + (characters.length > 60 ? '…' : '')
            : media.some((item) => item?.mime?.startsWith('video/')) ? 'Video post'
            : media.length && media.every((item) => item?.mime?.startsWith('image/')) ? 'Photo post'
            : media.length ? 'Media post' : 'New post';
        return preview + ((post?.snapshot?.title ?? post?.title ?? '').match(/(?: \(conflict copy\))+$/)?.[0] || '');
    }
    const drafts = computed(() =>
        state.value.drafts.filter((d) =>
            (postTitle(d) + ' ' + draftSummary(d.content))
                .toLowerCase()
                .includes(search.value.toLowerCase()),
        ),
    );
    const items = computed(() => {
        if (!editor.value) return [];
        if (network.value === 'shared') return editor.value.content.items;
        if (editor.value.content.overrides[network.value]) return editor.value.content.overrides[network.value];
        return workingItems.value || [];
    });
    const chosen = computed(() =>
        state.value.accounts.filter((a) => editor.value?.content.account_ids.includes(a.id)),
    );
    function previewItemsFor(account) {
        const key = account?.provider;
        let list = editor.value?.content.items || [];
        if (key && editor.value?.content.overrides[key]) list = editor.value.content.overrides[key];
        else if (network.value !== 'shared') list = items.value;
        if (key && ['facebook', 'linkedin', 'linkedin_page'].includes(key))
            list = [{ text: list.map((i) => i.text).join('\n\n'), media_ids: list.flatMap((i) => i.media_ids) }];
        return list;
    }
    const preview = computed(() => previewItemsFor(chosen.value[0]));
    const sharedOverrideWarning = computed(() => {
        if (!editor.value || network.value !== 'shared') return '';
        const custom = Object.keys(editor.value.content.overrides || {});
        if (!custom.some((key) => chosen.value.some((account) => account.provider === key))) return '';
        return 'Network-specific versions will not change when you edit the shared draft.';
    });
    const scheduledLocked = computed(() => {
        if (!editor.value) return false;
        const statuses = publicationStatuses.value[editor.value.id] || {};
        return ['scheduled', 'retry', 'publishing'].some((status) => statuses[status]);
    });
    function unlockScheduledEdit() {
        allowScheduledEdit.value = true;
    }
    const queue = computed(() =>
        state.value.publications
            .filter((p) => ['scheduled', 'retry', 'publishing'].includes(p.status))
            .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)),
    );
    const history = computed(() =>
        state.value.publications.filter((p) => !['scheduled', 'retry', 'publishing'].includes(p.status)),
    );
    const selectedDraftIds = ref([]);
    let selectionAnchor = null;
    const allDraftsSelected = computed(
        () => drafts.value.length > 0 && drafts.value.every((d) => selectedDraftIds.value.includes(d.id)),
    );
    async function selectAllDrafts(event) {
        if (busy.value || syncing.value) return;
        if (!event.target.checked) return closeDraft();
        if (drafts.value.length === 1) return selectDraft(drafts.value[0]);
        selectedDraftIds.value = drafts.value.map((d) => d.id);
        selectionAnchor = selectedDraftIds.value[0] || null;
    }
    async function selectDraft(draft, event = {}) {
        if (busy.value || syncing.value) return;
        const visibleIds = drafts.value.map((post) => post.id);
        if (!visibleIds.includes(draft.id)) return;
        const additive = event.metaKey || event.ctrlKey;
        const currentSelection = selectedDraftIds.value.length ? selectedDraftIds.value
            : visibleIds.includes(editor.value?.id) ? [editor.value.id] : [];
        const previousAnchor = selectionAnchor || editor.value?.id;
        const anchor = visibleIds.includes(previousAnchor) ? previousAnchor : draft.id;
        let selected = [draft.id];
        if (event.shiftKey) {
            const start = visibleIds.indexOf(anchor), end = visibleIds.indexOf(draft.id);
            const range = visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1);
            selected = additive ? [...new Set([...currentSelection, ...range])] : range;
        } else if (additive) {
            selected = currentSelection.includes(draft.id)
                ? currentSelection.filter((id) => id !== draft.id)
                : [...currentSelection, draft.id];
        }
        if (selected.length === 1 && !await openDraft(drafts.value.find((post) => post.id === selected[0]))) return;
        if (!selected.length && !await closeDraft()) return;
        selectedDraftIds.value = selected;
        selectionAnchor = event.shiftKey ? anchor : draft.id;
    }
    watch(drafts, (visible) => {
        selectedDraftIds.value = selectedDraftIds.value.filter((id) => visible.some((d) => d.id === id));
        if (!visible.some((draft) => draft.id === selectionAnchor)) selectionAnchor = null;
    });
    watch([page, authenticated, () => state.value.settings.workspace_id], () => {
        selectedDraftIds.value = [];
        selectionAnchor = null;
    }, { flush: 'sync' });
    function customize(key) {
        network.value = key;
        if (!editor.value || key === 'shared') {
            workingItems.value = null;
            return;
        }
        if (editor.value.content.overrides[key]) {
            workingItems.value = null;
            return;
        }
        let base = clone(editor.value.content.items);
        if (['facebook', 'linkedin', 'linkedin_page'].includes(key))
            base = [
                {
                    text: base.map((i) => i.text).join('\n\n'),
                    media_ids: base.flatMap((i) => i.media_ids),
                },
            ];
        workingItems.value = base;
    }
    function resetOverride() {
        delete editor.value.content.overrides[network.value];
        network.value = 'shared';
        workingItems.value = null;
        changed();
    }
    function addPost() {
        items.value.push({ text: '', media_ids: [] });
        changed();
    }
    function removePost(i) {
        items.value.splice(i, 1);
        changed();
    }
    function attachment(id) {
        return state.value.media.find((m) => m.id === id);
    }
    async function upload(event, index) {
        const files = Array.from(event.target.files);
        const target = items.value[index];
        await act(async () => {
            for (const file of files) {
                const data = new FormData();
                data.append('file', file);
                const media = await api('media', data);
                state.value.media.unshift(media);
                target.media_ids.push(media.id);
                changed();
            }
            await flush();
        });
        event.target.value = '';
    }
    function removeMedia(item, id) {
        item.media_ids = item.media_ids.filter((m) => m !== id);
        changed();
    }
    async function sync(manual = true) {
        if (busy.value) return;
        if (!authenticated.value || syncing.value || !state.value.settings.paired) return;
        syncing.value = true;
        try {
            await flush();
            await api('sync', {});
            await refresh();
            if (editor.value && !pending.value && !saving.value)
                editor.value = clone(state.value.drafts.find((d) => d.id === editor.value.id) || null);
        } catch (e) {
            if (manual) report(e);
        } finally {
            syncing.value = false;
        }
    }
    async function schedule(mode = scheduleMode.value) {
        await act(async () => {
            notice.value = '';
            await flush();
            const payload = {
                draft_id: editor.value.id,
                version: editor.value.version,
                mode,
            };
            if (payload.mode === 'exact') {
                if (!scheduleAt.value) throw new Error('Choose a date and time.');
                payload.scheduled_at = new Date(scheduleAt.value).toISOString();
            }
            const key = 'schedule:' + state.value.settings.workspace_id + ':' + JSON.stringify(payload);
            payload.request_id = localStorage.getItem(key) || crypto.randomUUID();
            localStorage.setItem(key, payload.request_id);
            await api('schedule', payload);
            localStorage.removeItem(key);
            scheduleOpen.value = false;
            await refresh();
            notice.value = payload.mode === 'now' ? 'Post sent for publishing.' : 'Post scheduled.';
            page.value = 'Queue';
        });
    }
    async function cancel(p) {
        await act(async () => {
            await api('cancel', { id: p.id });
            await refresh();
            notice.value = 'Publication cancelled.';
        });
    }
    async function deletePublication(p) {
        if (
            !confirm(
                'Delete this cancelled publication? It will no longer be recoverable. Any live social posts will stay unchanged.',
            )
        )
            return;
        await act(async () => {
            await api('deletePublication', { id: p.id });
            await refresh();
            notice.value = 'Publication deleted.';
        });
    }
    function editWorkspace(create = false) {
        workspaceForm.value = create
            ? { name: '', imageFile: null, removeImage: false, has_image: false }
            : { ...clone(currentWorkspace.value), imageFile: null, removeImage: false };
    }
    const workspaceImagePreview = computed(() => {
        const form = workspaceForm.value;
        if (!form) return '';
        if (workspaceImageObjectUrl.value) return workspaceImageObjectUrl.value;
        if (form.has_image && form.id && !form.removeImage) return '/local/workspaceImage/' + form.id;
        return '';
    });
    watch(
        () => workspaceForm.value?.imageFile,
        (file) => {
            if (workspaceImageObjectUrl.value) {
                try {
                    URL.revokeObjectURL(workspaceImageObjectUrl.value);
                } catch {
                    // Object URLs are unavailable in some test renderers.
                }
                workspaceImageObjectUrl.value = '';
            }
            if (file && typeof URL !== 'undefined' && URL.createObjectURL) {
                workspaceImageObjectUrl.value = URL.createObjectURL(file);
            }
        },
    );
    async function activateWorkspace(id) {
        await flush();
        await api('switchWorkspace', { id });
        blueskyForm.value = null;
        editor.value = null;
        pending.value = false;
        workingItems.value = null;
        network.value = 'shared';
        search.value = '';
        page.value = 'Posts';
        scheduleOpen.value = false;
        slotsAccount.value = null;
        recovery.value = null;
        notice.value = '';
        state.value = { drafts: [], accounts: [], media: [], publications: [], settings: { providers: {} } };
        await refresh();
        await sync(false);
    }
    async function switchWorkspace(event) {
        const id = event.target.value;
        event.target.value = currentWorkspace.value.id;
        if (syncing.value || busy.value) return;
        await act(() => activateWorkspace(id));
        await sync();
    }
    async function saveWorkspace() {
        await act(async () => {
            const form = workspaceForm.value;
            const isNew = !form.id;
            const workspace = await api('saveWorkspace', {
                ...(form.id ? { id: form.id } : {}),
                name: form.name,
            });
            if (form.imageFile) {
                const data = new FormData();
                data.append('id', workspace.id);
                data.append('file', form.imageFile);
                await api('saveWorkspaceImage', data);
            } else if (form.removeImage && workspace.id) {
                await api('deleteWorkspaceImage', { id: workspace.id });
            }
            workspaceForm.value = null;
            if (isNew) await activateWorkspace(workspace.id);
            else await refresh();
        });
        await sync();
    }
    async function updateProfile() {
        await act(async () => {
            savingProfile.value = true;
            try {
                const data = { name: profileForm.value.name, email: profileForm.value.email };
                if (profileForm.value.current_password) data.current_password = profileForm.value.current_password;
                if (profileForm.value.password) {
                    data.password = profileForm.value.password;
                    data.password_confirmation = profileForm.value.password_confirmation;
                }
                const profile = await api('profile', data);
                state.value.settings.name = profile.name;
                state.value.settings.email = profile.email;
                profileForm.value.current_password = '';
                profileForm.value.password = '';
                profileForm.value.password_confirmation = '';
                notice.value = 'Account saved.';
            } finally {
                savingProfile.value = false;
            }
        });
    }
    async function signIn() {
        await act(async () => {
            if (authenticated.value) await flush();
            const result = await api('signIn', { email: email.value, password: password.value });
            password.value = '';
            if (result.workspace_changed) {
                editor.value = null;
                pending.value = false;
                network.value = 'shared';
                page.value = 'Posts';
            }
            await refresh();
            await flush();
            await sync();
        });
    }
    function chooseAuth(mode) {
        authMode.value = mode;
        error.value = '';
        authNotice.value = '';
        password.value = '';
        confirmPassword.value = '';
    }
    async function submitAuth() {
        if (authMode.value === 'signIn') return signIn();
        await act(async () => {
            const action = authMode.value === 'register' ? 'registration' : authMode.value;
            const data = { email: email.value };
            if (action === 'registration')
                Object.assign(data, {
                    name: fullName.value,
                    password: password.value,
                    password_confirmation: confirmPassword.value,
                });
            const result = await api(action, data);
            authNotice.value = result.message;
            password.value = '';
            confirmPassword.value = '';
            authMode.value = 'signIn';
        });
    }
    async function signOut() {
        await act(async () => {
            await flush();
            await api('signOut', {});
            authenticated.value = false;
            connectionForm.value = null;
            blueskyForm.value = null;
            authorizationForm.value = null;
            authMode.value = 'signIn';
            authNotice.value = '';
            editor.value = null;
            state.value = {
                drafts: [],
                accounts: [],
                media: [],
                publications: [],
                settings: { providers: {} },
            };
            page.value = 'Posts';
            scheduleOpen.value = false;
            slotsAccount.value = null;
            recovery.value = null;
            notice.value = '';
        });
    }
    function openRecovery(p) {
        if (busy.value || syncing.value) return;
        error.value = '';
        recovery.value = p;
        recoveryAction.value = p.status === 'uncertain' ? 'confirmed' : 'reschedule';
        recoveryAt.value = canReschedule(p) ? localDateTime(new Date(p.scheduled_at)) : '';
        recoveryId.value = '';
    }
    const canReschedule = (p) => ['scheduled', 'retry'].includes(p?.status);
    const localDateTime = (at) =>
        Number.isFinite(at.getTime())
            ? new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
            : '';
    async function reschedule(p, value) {
        if (busy.value || syncing.value) return false;
        return act(async () => {
            const publication = state.value.publications.find((item) => item.id === p.id);
            if (!canReschedule(publication)) throw new Error('This post can no longer be rescheduled.');
            const at = new Date(value);
            if (!value || !Number.isFinite(at.getTime()) || at.getTime() <= Date.now()) {
                throw new Error('Choose a future date and time.');
            }
            if (localDateTime(at) !== value) {
                throw new Error('This time does not exist in your timezone. Choose another time.');
            }
            await api('recover', { id: publication.id, action: 'reschedule', scheduled_at: at.toISOString() });
            await refresh();
            notice.value = 'Post rescheduled.';
            return true;
        });
    }
    async function recover() {
        if (!recovery.value || busy.value || syncing.value) return;
        if (canReschedule(recovery.value)) {
            if (await reschedule(recovery.value, recoveryAt.value)) recovery.value = null;
            return;
        }
        await act(async () => {
            const payload = { id: recovery.value.id, action: recoveryAction.value };
            if (payload.action === 'confirmed') payload.post_id = recoveryId.value;
            else payload.scheduled_at = new Date(recoveryAt.value).toISOString();
            await api('recover', payload);
            recovery.value = null;
            await refresh();
            notice.value = 'Publication recovery saved.';
        });
    }
    function postUrl(p, id) {
        const url = p.snapshot.post_urls?.[id];
        if (typeof url === 'string' && /^https:\/\/(www\.)?threads\.(net|com)\//.test(url)) return url;
        const blueskyPost = typeof id === 'string' && id.match(/^at:\/\/(did:[a-z]+:[A-Za-z0-9._:%-]+)\/app\.bsky\.feed\.post\/([A-Za-z0-9._:-]+)$/);
        if (blueskyPost) return 'https://bsky.app/profile/' + encodeURIComponent(blueskyPost[1]) + '/post/' + encodeURIComponent(blueskyPost[2]);
        const provider = accountFor(p)?.provider;
        return provider === 'x'
            ? 'https://x.com/i/web/status/' + encodeURIComponent(id)
            : provider === 'facebook'
              ? 'https://www.facebook.com/' + encodeURIComponent(id)
              : provider?.startsWith('linkedin')
                ? 'https://www.linkedin.com/feed/update/' + encodeURIComponent(id)
                : null;
    }
    function accountFor(p) {
        return state.value.accounts.find((a) => a.id === p.account_id);
    }
    async function openPost(p, id) {
        await act(() => api('openPost', { url: postUrl(p, id) }));
    }
    function connectionUrl(provider) {
        return state.value.settings.mode === 'server'
            ? '/connect/' + provider
            : state.value.settings.paired
              ? state.value.settings.connections_url +
                '/connect/' +
                provider +
                '?workspace_id=' +
                encodeURIComponent(state.value.settings.workspace_id)
              : null;
    }
    function canConnect(key) {
        return (
            !!connectionUrl(key) &&
            state.value.settings.providers[key]?.configured &&
            state.value.settings.providers[key]?.approved !== false
        );
    }
    function providerStatus(key) {
        return state.value.settings.providers[key]?.configured &&
            state.value.settings.providers[key]?.approved === false
            ? 'Awaiting approval'
            : 'Coming soon';
    }
    async function connectBluesky() {
        await act(async () => {
            const data = { ...blueskyForm.value, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
            try {
                await api('connectBluesky', data);
            } finally {
                if (blueskyForm.value) blueskyForm.value.password = '';
            }
            blueskyForm.value = null;
            await api('sync', {});
            await refresh();
            notice.value = 'Bluesky account connected.';
        });
    }
    async function connect(provider) {
        if (provider === 'bluesky') {
            error.value = '';
            blueskyForm.value = { identifier: '', password: '' };
            return;
        }
        await act(async () => {
            await api('connect', { provider });
            notice.value =
                'Sign in with your provider in the browser, then return to Sendae to choose accounts.';
        });
        clearTimeout(connectTimer);
        const until = Date.now() + 120000;
        const poll = async () => {
            if (Date.now() > until || page.value !== 'Accounts' || !authenticated.value) return;
            try {
                await sync(false);
            } catch (e) {}
            connectTimer = setTimeout(poll, 5000);
        };
        connectTimer = setTimeout(poll, 4000);
    }
    async function handleLink(link) {
        if (link.action === 'reset-password') {
            resetForm.value = {
                email: link.email,
                token: link.token,
                password: '',
                password_confirmation: '',
            };
            return;
        }
        if (!authenticated.value) {
            pendingLink.value = link;
            authNotice.value = 'Sign in to continue this request.';
            return;
        }
        pendingLink.value = null;
        if (link.action === 'connection') {
            const result = await api('connectionChoices', { ticket: link.ticket });
            connectionForm.value = {
                ...result,
                ticket: link.ticket,
                selected: result.accounts.map((_, i) => i),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            };
        }
        if (link.action === 'authorize') {
            authorizationForm.value = {
                ...(await api('authorization', { ticket: link.ticket })),
                ticket: link.ticket,
            };
        }
    }
    async function readLink() {
        if (readingLink || busy.value) return;
        readingLink = true;
        try {
            const link = await api('link');
            if (link.action) await handleLink(link);
        } catch (e) {
            report(e);
        } finally {
            readingLink = false;
        }
    }
    async function selectConnection() {
        const connected = await act(async () => {
            const form = connectionForm.value;
            await api('selectConnection', {
                ticket: form.ticket,
                accounts: form.selected,
                timezone: form.timezone,
            });
            connectionForm.value = null;
            notice.value = 'Accounts connected.';
            return true;
        });
        if (connected) await sync();
    }
    async function decideAuthorization(approved) {
        await act(async () => {
            await api('decideAuthorization', { ticket: authorizationForm.value.ticket, approved });
            authorizationForm.value = null;
            notice.value = approved ? 'Client authorized.' : 'Authorization declined.';
        });
    }
    async function resetPassword() {
        await act(async () => {
            await flush();
            const result = await api('resetPassword', resetForm.value);
            resetForm.value = null;
            await api('signOut', {});
            authenticated.value = false;
            editor.value = null;
            pending.value = false;
            workingItems.value = null;
            authMode.value = 'signIn';
            authNotice.value = result.message;
        });
    }
    watch(authenticated, async (signedIn) => {
        if (signedIn && pendingLink.value) {
            try {
                await handleLink(pendingLink.value);
            } catch (e) {
                report(e);
            }
        }
    });
    function editSlots(a) {
        slotsAccount.value = a;
        timezone.value = a.timezone;
        slots.value = clone(a.slots || []);
    }
    async function saveSlots() {
        await act(async () => {
            await api('account', { id: slotsAccount.value.id, timezone: timezone.value, slots: slots.value });
            slotsAccount.value = null;
            await refresh();
            notice.value = 'Posting slots saved.';
        });
    }
    async function disconnect(a) {
        if (!confirm('Disconnect ' + a.name + ' and cancel its queued publications?')) return;
        await act(async () => {
            await api('disconnect', { id: a.id });
            await refresh();
        });
    }
    async function refreshMetrics(p) {
        await act(async () => {
            await api('analytics', { id: p.id });
            await refresh();
        });
    }
    function keyboard(e) {
        if (!authenticated.value) return;
        const postSelectionShortcut =
            !e.defaultPrevented && page.value === 'Posts' &&
            !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName) &&
            !e.target?.isContentEditable && !e.target?.closest('dialog, [role="dialog"]');
        if (
            postSelectionShortcut && (e.metaKey || e.ctrlKey) &&
            e.key.toLowerCase() === 'a' && !e.altKey && !e.shiftKey
        ) {
            e.preventDefault();
            selectAllDrafts({ target: { checked: true } });
        }
        if (
            postSelectionShortcut && e.key === 'Backspace' && selectedDraftIds.value.length &&
            !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.repeat
        ) {
            e.preventDefault();
            return deleteDrafts(selectedDraftIds.value);
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
            e.preventDefault();
            newDraft();
        }
        if (e.key === 'Escape') {
            scheduleOpen.value = false;
            slotsAccount.value = null;
            recovery.value = null;
        }
    }
    function beforeUnload(e) {
        if (pending.value || saving.value) {
            e.preventDefault();
            e.returnValue = '';
        }
    }
    watch(
        () => [state.value.settings.name, state.value.settings.email],
        () => {
            if (savingProfile.value) return;
            profileForm.value.name = state.value.settings.name || '';
            profileForm.value.email = state.value.settings.email || '';
        },
        { immediate: true },
    );
    watch(
        () => state.value.settings.email,
        async (email, _previous, onCleanup) => {
            let cancelled = false;
            onCleanup(() => {
                cancelled = true;
            });
            gravatarUrl.value = '';
            const normalized = (email || '').trim().toLowerCase();
            if (!normalized || !globalThis.crypto?.subtle) return;
            const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
            if (cancelled) return;
            const hash = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
            gravatarUrl.value = 'https://www.gravatar.com/avatar/' + hash + '?s=80&d=identicon';
        },
        { immediate: true },
    );
    onMounted(async () => {
        countdownTimer = setInterval(() => {
            now.value = Date.now();
        }, 1000);
        try {
            const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
            media?.addEventListener?.('change', (event) => {
                systemDark.value = event.matches;
            });
        } catch {
            // System theme changes are optional.
        }
        try {
            await refresh();
        } catch (e) {
            if (authenticated.value) report(e);
        }
        await readLink();
        linkTimer = setInterval(readLink, 1500);
        interval = setInterval(() => sync(false), 30000);
        window.addEventListener('beforeunload', beforeUnload);
        window.addEventListener('keydown', keyboard);
    });
    watch(page, (p) => {
        if (p === 'Accounts') sync(false);
    });
    onBeforeUnmount(() => {
        clearInterval(interval);
        clearInterval(linkTimer);
        clearInterval(countdownTimer);
        clearTimeout(connectTimer);
        window.removeEventListener('beforeunload', beforeUnload);
        window.removeEventListener('keydown', keyboard);
    });
    const activity = computed(() => {
        const events = [];
        for (const draft of state.value.drafts) {
            if (draft.created_at) {
                events.push({
                    id: 'created:' + draft.id,
                    type: 'created',
                    title: postTitle(draft),
                    at: draft.created_at,
                    draft,
                });
            }
            if (draft.updated_at && draft.updated_at !== draft.created_at) {
                events.push({
                    id: 'updated:' + draft.id + ':' + draft.updated_at,
                    type: 'updated',
                    title: postTitle(draft),
                    at: draft.updated_at,
                    draft,
                });
            }
        }
        for (const publication of state.value.publications) {
            events.push({
                id: publication.id,
                type: publication.status,
                title: postTitle(publication),
                at:
                    publication.published_at ||
                    publication.scheduled_at ||
                    publication.updated_at ||
                    publication.created_at,
                account: accountFor(publication),
                draft: state.value.drafts.find((draft) => draft.id === publication.draft_id),
            });
        }
        return events.filter((event) => event.at).sort((a, b) => new Date(b.at) - new Date(a.at));
    });

    return {
        accountFor,
        activity,
        addPost,
        allDraftsSelected,
        allowScheduledEdit,
        api,
        attachment,
        authMode,
        authNotice,
        authenticated,
        authorizationForm,
        busy,
        canConnect,
        canReschedule,
        cancel,
        changed,
        chooseAuth,
        chosen,
        closeDraft,
        colorScheme,
        confirmPassword,
        connect,
        connectionForm,
        currentWorkspace,
        customTitle,
        customize,
        date,
        decideAuthorization,
        deleteDraft,
        deleteDrafts,
        deletePublication,
        disconnect,
        draftSummary,
        drafts,
        editSlots,
        editWorkspace,
        editor,
        email,
        error,
        flush,
        fullName,
        gravatarUrl,
        history,
        items,
        loaded,
        localDateTime,
        names,
        network,
        newDraft,
        notice,
        openDraft,
        openPost,
        openRecovery,
        page,
        password,
        pending,
        postUrl,
        postTitle,
        preview,
        previewItemsFor,
        previewOpen,
        profileForm,
        providerStatus,
        blueskyForm,
        connectBluesky,
        publicationStatus,
        publicationStatuses,
        queue,
        recover,
        recovery,
        recoveryAction,
        recoveryAt,
        recoveryId,
        refresh,
        refreshMetrics,
        removeMedia,
        removePost,
        resetForm,
        resetOverride,
        resetPassword,
        reschedule,
        saveSlots,
        saveWorkspace,
        saving,
        savingProfile,
        schedule,
        scheduleAt,
        scheduleMode,
        scheduleOpen,
        scheduledLocked,
        search,
        selectAllDrafts,
        selectDraft,
        selectConnection,
        selectedDraftIds,
        setTheme,
        sharedOverrideWarning,
        signOut,
        slots,
        slotsAccount,
        state,
        submitAuth,
        switchWorkspace,
        sync,
        syncing,
        theme,
        timezone,
        unlockScheduledEdit,
        updateProfile,
        upload,
        workspaceForm,
        workspaceImagePreview,
    };
}
