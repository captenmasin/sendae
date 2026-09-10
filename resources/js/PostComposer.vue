<script setup>
import { useWorkspace } from './workspace.js';

const {
    addPost,
    attachment,
    busy,
    changed,
    chosen,
    closeDraft,
    customize,
    deleteDraft,
    editor,
    items,
    names,
    network,
    page,
    pending,
    preview,
    publicationStatuses,
    removeMedia,
    removePost,
    resetOverride,
    saving,
    scheduleOpen,
    state,
    symbols,
    syncing,
    upload,
} = useWorkspace();
</script>

<template>
    <fieldset v-if="editor" class="composer" :disabled="busy">
        <div class="composer-top">
            <span>{{ saving ? 'Saving…' : pending ? 'Unsaved changes' : '✓ Saved on this Mac' }}</span>
            <button class="icon-button" @click="closeDraft" aria-label="Close composer">×</button>
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
        <input
            class="title-input"
            aria-label="Post title"
            v-model="editor.title"
            @input="changed"
            maxlength="200"
            placeholder="Post title"
        />
        <div class="destinations">
            <label
                v-for="a in state.accounts.filter((a) => a.status === 'connected')"
                :key="a.id"
                class="destination"
                :class="{ checked: editor.content.account_ids.includes(a.id) }"
            >
                <input type="checkbox" :value="a.id" v-model="editor.content.account_ids" @change="changed" />
                <span class="network-icon">{{ symbols[a.provider] }}</span>
                {{ a.name }}
            </label>
            <button
                v-if="!state.accounts.some((a) => a.status === 'connected')"
                class="text-button"
                @click="page = 'Accounts'"
            >
                ＋ Connect an account
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
                {{ names[key] }}
                <i v-if="editor.content.overrides[key]">•</i>
            </button>
        </div>
        <div v-if="network !== 'shared'" class="override-note">
            Only {{ names[network] }} uses this version.
            <button class="text-button" @click="resetOverride">Use shared draft</button>
        </div>
        <div class="post-editor" v-for="(item, index) in items" :key="index">
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
                rows="7"
            ></textarea>
            <div class="attachments">
                <div v-for="id in item.media_ids" :key="id" class="attachment">
                    <video
                        v-if="attachment(id)?.mime.startsWith('video/')"
                        :src="'/local/media/' + id"
                        controls
                    ></video>
                    <img v-else :src="'/local/media/' + id" :alt="attachment(id)?.name || 'Attachment'" />
                    <button @click="removeMedia(item, id)" aria-label="Remove attachment">×</button>
                </div>
            </div>
            <div class="editor-tools">
                <label class="upload-button">
                    ▧
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
            v-if="network === 'shared' || ['x', 'threads'].includes(network)"
            class="add-post"
            @click="addPost"
        >
            ＋ Add to thread
        </button>
        <details class="preview">
            <summary>Preview</summary>
            <article v-for="(item, i) in preview" :key="i">
                <strong>{{ chosen[0]?.name || 'Your account' }}</strong>
                <p>{{ item.text || 'Your post will appear here.' }}</p>
                <small v-if="item.media_ids.length">{{ item.media_ids.length }} attachment(s)</small>
            </article>
            <small>
                Network rendering may vary. LinkedIn and Facebook combine shared threads; select their tab to
                edit.
            </small>
        </details>
        <footer class="composer-footer">
            <button class="text-button" @click="deleteDraft" :disabled="busy || saving || syncing">
                Delete post
            </button>
            <button class="primary" @click="scheduleOpen = true" :disabled="busy || saving">
                Schedule
                <span>↗</span>
            </button>
        </footer>
    </fieldset>
</template>
