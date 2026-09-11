<script setup>
import { computed } from 'vue';
import AccountLogo from './AccountLogo.vue';
import Icon from './Icon.vue';
import { useWorkspace } from './workspace.js';

const {
    addPost,
    allowScheduledEdit,
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
    publicationStatuses,
    removeMedia,
    removePost,
    resetOverride,
    saving,
    schedule,
    scheduleOpen,
    scheduledLocked,
    sharedOverrideWarning,
    state,
    syncing,
    unlockScheduledEdit,
    upload,
} = useWorkspace();
const postName = computed({
    get: () => customTitle(editor.value),
    set: (value) => { editor.value.title = value; },
});
const locked = computed(() => scheduledLocked.value && !allowScheduledEdit.value);
</script>

<template>
    <fieldset v-if="editor" class="composer" :disabled="busy">
        <div class="composer-top">
            <span>{{ pending && !saving ? 'Unsaved changes' : '' }}</span>
            <button class="icon-button" @click="closeDraft" aria-label="Close composer">
                <Icon name="X" :size="18" />
            </button>
        </div>
        <div v-if="publicationStatuses[editor.id]" class="draft-statuses draft-publications" role="status">
            <small>Publications</small>
            <span
                v-for="(count, status) in publicationStatuses[editor.id]"
                :key="status"
                class="tag"
                :class="status"
            >
                {{ status.charAt(0).toUpperCase() + status.slice(1) }} · {{ count }}
            </span>
        </div>
        <div v-if="scheduledLocked" class="composer-alert" role="status">
            <p>
                This post is already scheduled. Editing the draft does not change queued publications unless you
                cancel and schedule again.
            </p>
            <button v-if="!allowScheduledEdit" class="outline" type="button" @click="unlockScheduledEdit">
                Edit draft anyway
            </button>
        </div>
        <label for="post-name" class="post-name-label">Title</label>
        <input
            id="post-name"
            class="title-input"
            aria-label="Post title"
            v-model="postName"
            @input="changed"
            maxlength="200"
            :placeholder="postTitle({ content: editor.content })"
            title="Leave blank to use the opening words of your post. This name is not published."
            :readonly="locked"
        />
        <div class="destinations-heading">Publish to</div>
        <div class="destinations">
            <label
                v-for="a in state.accounts.filter((a) => a.status === 'connected')"
                :key="a.id"
                class="destination"
                :class="{ checked: editor.content.account_ids.includes(a.id) }"
            >
                <input type="checkbox" :value="a.id" v-model="editor.content.account_ids" @change="changed" :disabled="locked" />
                <AccountLogo :provider="a.provider" :size="14" />
                {{ a.name }}
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
        </div>
        <div v-if="network !== 'shared'" class="override-note">
            Only {{ names[network] }} uses this version.
            <button class="text-button" @click="resetOverride">Use shared draft</button>
        </div>
        <div v-else-if="sharedOverrideWarning" class="override-note" role="status">{{ sharedOverrideWarning }}</div>
        <div class="post-editor" v-for="(item, index) in items" :key="index">
            <div class="post-number">
                <span>{{ String(index + 1).padStart(2, '0') }}</span>
                <button
                    v-if="items.length > 1"
                    class="text-button"
                    @click="removePost(index)"
                    :aria-label="'Remove post ' + (index + 1)"
                    :disabled="locked"
                >
                    Remove
                </button>
            </div>
            <textarea
                :aria-label="'Post ' + (index + 1)"
                v-model="item.text"
                @input="changed"
                placeholder="What’s on your mind?"
                rows="7"
                :readonly="locked"
            ></textarea>
            <div class="attachments">
                <div v-for="id in item.media_ids" :key="id" class="attachment">
                    <video
                        v-if="attachment(id)?.mime.startsWith('video/')"
                        :src="'/local/media/' + id"
                        controls
                    ></video>
                    <img v-else :src="'/local/media/' + id" :alt="attachment(id)?.name || 'Attachment'" />
                    <button @click="removeMedia(item, id)" aria-label="Remove attachment" :disabled="locked">
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
                        :disabled="busy || locked"
                    />
                </label>
                <span>{{ Array.from(item.text).length }} characters</span>
            </div>
        </div>
        <button
            v-if="network === 'shared' || ['x', 'threads', 'bluesky'].includes(network)"
            class="add-post"
            @click="addPost"
            :disabled="locked"
        >
            <Icon name="Plus" :size="14" /> Add to thread
        </button>
        <div class="preview">
            <button class="text-button" @click="previewOpen = !previewOpen" :aria-expanded="previewOpen">
                {{ previewOpen ? 'Hide preview' : 'Show realistic preview' }}
            </button>
            <div v-if="previewOpen" class="preview-stack">
                <article
                    v-for="account in chosen.length ? chosen : [{ name: 'Preview', provider: network === 'shared' ? 'x' : network }]"
                    :key="account.id || account.provider"
                    class="social-preview"
                    :data-provider="account.provider"
                >
                    <header>
                        <AccountLogo :account="account.id ? account : null" :provider="account.provider" :size="36" />
                        <div>
                            <strong>
                                {{ account.name }}
                                <Icon v-if="account.verified" name="BadgeCheck" :size="14" />
                            </strong>
                            <small>{{ names[account.provider] || 'Shared' }} · Preview</small>
                        </div>
                    </header>
                    <div v-for="(item, index) in previewItemsFor(account)" :key="index" class="preview-item">
                        <p>{{ item.text || ' ' }}</p>
                        <div v-if="item.media_ids?.length" class="preview-media">
                            <template v-for="id in item.media_ids" :key="id">
                                <video v-if="attachment(id)?.mime.startsWith('video/')" :src="'/local/media/' + id" controls></video>
                                <img v-else :src="'/local/media/' + id" :alt="attachment(id)?.name || 'Attachment'" />
                            </template>
                        </div>
                    </div>
                </article>
            </div>
        </div>
        <footer class="composer-footer">
            <button class="text-button" @click="deleteDraft" :disabled="busy || saving || syncing">
                Delete post
            </button>
            <div class="composer-actions">
                <button class="outline" @click="schedule('now')" :disabled="busy || saving || !chosen.length || locked">
                    Post now
                </button>
                <button class="primary" @click="scheduleOpen = true" :disabled="busy || saving || locked">
                    Schedule
                    <Icon name="ArrowUpRight" :size="14" />
                </button>
            </div>
        </footer>
    </fieldset>
</template>

<style scoped>
.post-name-label { color: var(--muted); font-size: 11px; margin: 0 0 4px; }
.composer-actions { display: flex; align-items: center; gap: 8px; }
</style>
