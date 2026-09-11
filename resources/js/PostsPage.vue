<script setup>
import AccountLogo from './AccountLogo.vue';
import Icon from './Icon.vue';
import PostComposer from './PostComposer.vue';
import { useWorkspace } from './workspace.js';

const {
    allDraftsSelected,
    busy,
    closeDraft,
    customTitle,
    date,
    deleteDrafts,
    draftSummary,
    drafts,
    editor,
    newDraft,
    postTitle,
    publicationStatuses,
    search,
    selectAllDrafts,
    selectDraft,
    selectedDraftIds,
    state,
    syncing,
} = useWorkspace();
</script>

<template>
    <div class="posts-inbox">
        <section class="posts-list" aria-label="Posts">
            <div class="posts-list-heading">
                <h1>Posts</h1>
                <span class="posts-count">{{ state.drafts.length }}</span>
                <button class="compose-button" @click="newDraft" :disabled="busy" aria-label="New post" title="New post (⌘ N)">
                    <Icon name="Pencil" :size="18" />
                </button>
            </div>
            <div v-if="state.drafts.length" class="posts-search">
                <input v-model="search" type="search" placeholder="Search posts…" aria-label="Search posts" :disabled="busy" />
            </div>
            <div v-if="drafts.length" class="posts-list-toolbar">
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
                <span role="status">{{ selectedDraftIds.length ? selectedDraftIds.length + ' selected' : drafts.length + (drafts.length === 1 ? ' post' : ' posts') }}</span>
            </div>
            <div class="posts-rows">
                <button
                    v-for="draft in drafts"
                    :key="draft.id"
                    class="post-row"
                    :class="{ selected: selectedDraftIds.includes(draft.id) || (!selectedDraftIds.length && editor?.id === draft.id) }"
                    :aria-pressed="selectedDraftIds.includes(draft.id) || (!selectedDraftIds.length && editor?.id === draft.id)"
                    aria-describedby="post-selection-help"
                    @click="selectDraft(draft, $event)"
                    :disabled="busy || syncing"
                >
                    <span class="post-row-meta">
                        <span class="draft-statuses">
                            <span v-if="draft.title.includes('(conflict copy)')" class="tag">Conflict copy</span>
                            <span v-else-if="!publicationStatuses[draft.id]" class="tag">Draft</span>
                            <span v-for="(count, status) in publicationStatuses[draft.id]" :key="status" class="tag" :class="status">
                                {{ status.charAt(0).toUpperCase() + status.slice(1) }} · {{ count }}
                            </span>
                        </span>
                        <span>Updated {{ date(draft.updated_at) }}</span>
                    </span>
                    <h3>{{ postTitle(draft) }}</h3>
                    <p v-if="customTitle(draft)">{{ draftSummary(draft.content) }}</p>
                    <span class="post-row-accounts">
                        <span v-for="account in state.accounts.filter((account) => draft.content.account_ids.includes(account.id))" :key="account.id" :title="account.name">
                            <AccountLogo :account="account" />
                        </span>
                        <small v-if="!draft.content.account_ids.length">No accounts selected</small>
                        <small v-if="draft.content.items.length > 1">{{ draft.content.items.length }} posts</small>
                    </span>
                </button>
                <div v-if="!drafts.length" class="empty draft-empty" role="status">
                    <h2>{{ search ? 'No matching posts' : 'No posts' }}</h2>
                    <button v-if="search" class="text-button" @click="search = ''">Clear search</button>
                    <button v-else class="outline" @click="newDraft" :disabled="busy">New post</button>
                </div>
            </div>
        </section>
        <section class="posts-detail" aria-label="Post details">
            <div v-if="selectedDraftIds.length > 1 || (selectedDraftIds.length === 1 && editor?.id !== selectedDraftIds[0])" class="posts-selection">
                <div class="posts-selection-heading">
                    <h2>{{ selectedDraftIds.length }} {{ selectedDraftIds.length === 1 ? 'post' : 'posts' }} selected</h2>
                    <button class="text-button" @click="closeDraft" :disabled="busy || syncing">Clear selection</button>
                </div>
                <ul>
                    <li v-for="draft in drafts.filter((draft) => selectedDraftIds.includes(draft.id))" :key="draft.id">
                        <span>{{ postTitle(draft) }}</span>
                        <small>{{ date(draft.updated_at) }}</small>
                    </li>
                </ul>
                <button class="outline" @click="deleteDrafts(selectedDraftIds)" :disabled="busy || syncing">
                    {{ busy ? 'Please wait…' : 'Delete selected' }}
                </button>
            </div>
            <template v-else>
                <PostComposer v-if="editor" />
                <div v-else class="empty posts-detail-empty">
                    <h2>{{ state.drafts.length ? 'Select a post' : 'Create your first post' }}</h2>
                    <p>{{ state.drafts.length ? 'Choose a post to edit, or start a new one.' : 'Write a draft, choose your accounts, and schedule it.' }}</p>
                    <button class="primary" @click="newDraft" :disabled="busy"><Icon name="Plus" :size="14" /> New post</button>
                </div>
            </template>
        </section>
    </div>
</template>
