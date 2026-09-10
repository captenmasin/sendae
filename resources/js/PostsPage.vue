<script setup>
import PostComposer from './PostComposer.vue';
import { useWorkspace } from './workspace.js';

const {
    allDraftsSelected,
    busy,
    date,
    deleteDrafts,
    draftSummary,
    drafts,
    editor,
    newDraft,
    openDraft,
    publicationStatuses,
    search,
    selectAllDrafts,
    selectedDraftIds,
    state,
    symbols,
    syncing,
} = useWorkspace();
</script>

<template>
    <div class="page-heading">
        <div><h1>Posts</h1></div>
        <button class="outline" @click="newDraft">＋ New post</button>
    </div>
    <div class="draft-layout" :class="{ 'has-editor': editor }">
        <section class="draft-list">
            <div v-if="state.drafts.length" class="list-toolbar">
                <input
                    v-model="search"
                    type="search"
                    placeholder="Search posts…"
                    aria-label="Search posts"
                    :disabled="busy"
                />
            </div>
            <div v-if="drafts.length" class="bulk-toolbar">
                <label>
                    <input
                        type="checkbox"
                        :checked="allDraftsSelected"
                        :indeterminate="selectedDraftIds.length > 0 && !allDraftsSelected"
                        @change="selectAllDrafts"
                        :disabled="busy || syncing"
                    />
                    Select all
                </label>
                <span role="status">{{ selectedDraftIds.length }} selected</span>
                <button
                    class="outline"
                    @click="deleteDrafts(selectedDraftIds)"
                    :disabled="!selectedDraftIds.length || busy || syncing"
                >
                    {{ busy ? 'Please wait…' : 'Delete selected' }}
                </button>
            </div>
            <div v-for="draft in drafts" :key="draft.id" class="draft-row">
                <label class="draft-selection">
                    <input
                        type="checkbox"
                        v-model="selectedDraftIds"
                        :value="draft.id"
                        :aria-label="'Select post: ' + draft.title"
                        :disabled="busy || syncing"
                    />
                </label>
                <button
                    class="draft-card"
                    :class="{ selected: editor?.id === draft.id || selectedDraftIds.includes(draft.id) }"
                    @click="openDraft(draft)"
                    :disabled="busy"
                >
                    <div class="card-top">
                        <span class="draft-statuses">
                            <span v-if="draft.title.includes('(conflict copy)')" class="tag">
                                Conflict copy
                            </span>
                            <span v-else-if="!publicationStatuses[draft.id]" class="tag">Draft</span>
                            <span
                                v-for="(count, status) in publicationStatuses[draft.id]"
                                :key="status"
                                class="tag"
                                :class="status"
                            >
                                {{ status.charAt(0).toUpperCase() + status.slice(1) }} · {{ count }}
                            </span>
                        </span>
                        <span>{{ date(draft.updated_at) }}</span>
                    </div>
                    <h3>{{ draft.title }}</h3>
                    <p>{{ draftSummary(draft.content) }}</p>
                    <div class="card-footer">
                        <span class="mini-networks">
                            <span
                                v-for="a in state.accounts.filter((a) =>
                                    draft.content.account_ids.includes(a.id),
                                )"
                                :key="a.id"
                                :title="a.name"
                            >
                                {{ symbols[a.provider] }}
                            </span>
                            <small v-if="!draft.content.account_ids.length">No accounts selected</small>
                        </span>
                        <small>
                            {{
                                draft.content.items.length > 1
                                    ? draft.content.items.length + ' posts'
                                    : 'Single post'
                            }}
                            <span class="arrow">↗</span>
                        </small>
                    </div>
                </button>
            </div>
            <div v-if="!drafts.length" class="empty draft-empty" role="status">
                <h2>{{ search ? 'No matching posts' : 'No posts' }}</h2>
                <button class="primary" @click="newDraft">New post</button>
            </div>
        </section>
        <PostComposer v-if="editor" />
    </div>
</template>
