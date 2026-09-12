<script setup>
import { computed, ref } from 'vue';
import AccountLogo from './AccountLogo.vue';
import Icon from './Icon.vue';
import NetworkPostPreview from './NetworkPostPreview.vue';
import { useWorkspace } from './workspace.js';

const vModal = { mounted: (el) => el.showModal(), beforeUnmount: (el) => el.close() };

const {
    addPost,
    attachment,
    busy,
    changed,
    chosen,
    closeDraft,
    customize,
    customTitle,
    deleteDraft,
    editor,
    items,
    names,
    network,
    page,
    pending,
    postTitle,
    previewItemsFor,
    previewOpen,
    removeMedia,
    removePost,
    resetOverride,
    saving,
    schedule,
    scheduledLocked,
    scheduledUpdateError,
    openSchedule,
    sharedOverrideWarning,
    state,
    syncing,
    upload,
} = useWorkspace();
const postName = computed({
    get: () => customTitle(editor.value),
    set: (value) => { editor.value.title = value; },
});
const previewAccountId = ref(null);
const previewAccounts = computed(() => chosen.value.length ? chosen.value : [{ name: 'Your account', provider: network.value === 'shared' ? 'x' : network.value }]);
const previewAccount = computed(() => previewAccounts.value.find((account) => account.id === previewAccountId.value)
    || previewAccounts.value.find((account) => account.provider === network.value) || previewAccounts.value[0]);
</script>

<template>
    <fieldset v-if="editor" class="composer" :disabled="busy">
        <div class="composer-heading">
            <label for="post-name" class="post-name-label">Title</label>
            <span v-if="pending && !saving" class="composer-save-status">Unsaved changes</span>
            <button class="icon-button" @click="closeDraft" aria-label="Close composer">
                <Icon name="X" :size="18" />
            </button>
        </div>
        <input
            id="post-name"
            class="title-input"
            aria-label="Post title"
            v-model="postName"
            @input="changed"
            maxlength="200"
            :placeholder="postTitle({ content: editor.content })"
            title="Leave blank to use the opening words of your post. This name is not published."
        />
        <div v-if="scheduledUpdateError" class="override-note mb-3" role="alert">
            <span>Draft saved. The scheduled post could not be updated: {{ scheduledUpdateError }}</span>
            <button class="text-button" @click="page = 'Accounts'">Manage accounts</button>
            <button class="text-button" @click="schedule('preserve')" :disabled="busy || syncing || saving">Retry update</button>
        </div>
        <div class="destinations">
            <label
                v-for="a in state.accounts.filter((a) => a.status === 'connected' || editor.content.account_ids.includes(a.id))"
                :key="a.id"
                class="destination"
                :class="{ checked: editor.content.account_ids.includes(a.id) }"
            >
                <input type="checkbox" :value="a.id" v-model="editor.content.account_ids" @change="changed" />
                <AccountLogo :provider="a.provider" :size="14" />
                {{ a.name }}
                <small v-if="a.status !== 'connected'">Reconnect required</small>
                <Icon v-if="a.verified" name="BadgeCheck" :size="12" />
            </label>
            <button
                v-if="!state.accounts.some((a) => a.status === 'connected')"
                class="text-button"
                @click="page = 'Accounts'"
            >
                <Icon name="Plus" :size="12" /> Connect an account
            </button>
        </div>
        <div class="network-tabs">
            <button :class="{ active: network === 'shared' }" @click="customize('shared')">
                Shared draft
            </button>
            <button
                v-for="key in [...new Set(chosen.map((a) => a.provider))]"
                :key="key"
                :class="{ active: network === key }"
                @click="customize(key)"
            >
                <AccountLogo :provider="key" :size="14" /> {{ names[key] }}
                <i v-if="editor.content.overrides[key]">•</i>
            </button>
            <button class="text-button preview-toggle" @click="previewOpen = true" aria-haspopup="dialog">
                Show post preview
            </button>
        </div>
        <div v-if="network !== 'shared'" class="override-note">
            Only {{ names[network] }} uses this version.
            <button class="text-button" @click="resetOverride">Use shared draft</button>
        </div>
        <div v-else-if="sharedOverrideWarning" class="override-note" role="status">{{ sharedOverrideWarning }}</div>
        <div class="post-editor" v-for="(item, index) in items" :key="network + ':' + index">
            <div class="post-number">
                <span>{{ String(index + 1).padStart(2, '0') }}</span>
                <button
                    v-if="items.length > 1"
                    class="text-button"
                    @click="removePost(index)"
                    :aria-label="'Remove post ' + (index + 1)"
                >
                    Remove
                </button>
            </div>
            <textarea
                :aria-label="'Post ' + (index + 1)"
                v-model="item.text"
                @input="changed"
                placeholder="What’s on your mind?"
                rows="5"
                ></textarea>
            <div class="attachments">
                <div v-for="id in item.media_ids" :key="id" class="attachment">
                    <video
                        v-if="attachment(id)?.mime.startsWith('video/')"
                        :src="'/local/media/' + id"
                        controls
                    ></video>
                    <img v-else :src="'/local/media/' + id" :alt="attachment(id)?.name || 'Attachment'" />
                    <button @click="removeMedia(item, id)" aria-label="Remove attachment">
                        <Icon name="X" :size="12" />
                    </button>
                </div>
            </div>
            <div class="editor-tools">
                <label class="upload-button">
                    <Icon name="Paperclip" :size="14" />
                    <span>Attach media</span>
                    <input
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                        @change="upload($event, index)"
                        :disabled="busy"
                    />
                </label>
                <span>{{ Array.from(item.text).length }} characters</span>
            </div>
        </div>
        <button
            v-if="network === 'shared' || ['x', 'threads', 'bluesky'].includes(network)"
            class="add-post"
            @click="addPost"
        >
            <Icon name="Plus" :size="14" /> Add to thread
        </button>
        <dialog v-if="previewOpen" v-modal class="modal-backdrop" aria-labelledby="post-preview-title"
            @cancel.prevent="previewOpen = false" @click.self="previewOpen = false">
            <section class="modal post-preview-modal">
                <button class="modal-close" @click="previewOpen = false" aria-label="Close post preview">×</button>
                <h2 id="post-preview-title">Post preview</h2>
            <div class="preview-stack">
                <div class="preview-accounts" aria-label="Preview account">
                    <button v-for="account in previewAccounts" :key="account.id || account.provider"
                        :aria-pressed="account === previewAccount"
                        @click="previewAccountId = account.id">
                        <AccountLogo :provider="account.provider" :size="14" />
                        <span>{{ names[account.provider] }}<small v-if="previewAccounts.length > 1"> · {{ account.name }}</small></span>
                    </button>
                </div>
                <NetworkPostPreview :key="previewAccount.id || previewAccount.provider" :account="previewAccount"
                    :items="previewItemsFor(previewAccount)" :media="state.media" />
            </div>
            </section>
        </dialog>
        <footer class="composer-footer">
            <button class="text-button" @click="deleteDraft" :disabled="busy || syncing">
                Delete post
            </button>
            <div class="composer-actions">
                <button class="outline" @click="schedule('now')" :disabled="busy || !chosen.length">
                    Post now
                </button>
                <button v-if="scheduledLocked" class="outline" @click="openSchedule" :disabled="busy">
                    Change date &amp; time
                </button>
                <button v-else class="primary" @click="openSchedule" :disabled="busy || syncing">
                    Schedule
                    <Icon name="ArrowUpRight" :size="14" />
                </button>
            </div>
        </footer>
    </fieldset>
</template>

<style scoped>
.post-preview-modal { width: 600px; }
.preview-toggle { margin-left: auto; }
.add-post { display: inline-flex; align-items: center; gap: 7px; }
.composer-heading { display: flex; align-items: center; gap: 10px; min-height: 28px; margin: 0 0 4px; }
.composer-heading .icon-button { margin-left: auto; }
.post-name-label { color: var(--muted); font-size: 11px; margin: 0; }
.composer-save-status { color: var(--muted); font-size: 11px; }
.composer-actions { display: flex; align-items: center; gap: 8px; }
.preview-accounts { display: flex; flex-wrap: wrap; gap: 6px; }
.preview-accounts button { display: flex; align-items: center; gap: 7px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 6px; color: var(--muted); font-size: 11px; text-align: left; }
.preview-accounts button[aria-pressed=true] { background: var(--selected, var(--paper)); color: var(--ink, var(--accent)); border-color: var(--border-strong, var(--muted)); }
.preview-accounts small { font-size: inherit; }
</style>
