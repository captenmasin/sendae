<script setup>
import { useWorkspace } from './workspace.js';

const {
    accountFor,
    busy,
    cancel,
    date,
    deletePublication,
    history,
    openPost,
    openRecovery,
    page,
    postUrl,
    publicationStatus,
    queue,
    symbols,
} = useWorkspace();
</script>

<template>
    <div class="page-heading">
        <div>
            <h1>{{ page === 'Queue' ? 'Queue' : 'Published' }}</h1>
        </div>
    </div>
    <section class="content-section">
        <div v-for="p in page === 'Queue' ? queue : history" :key="p.id" class="publication-row">
            <span class="big-network">{{ symbols[accountFor(p)?.provider] || '↗' }}</span>
            <div class="publication-main">
                <h3>{{ p.snapshot.title }}</h3>
                <p>{{ accountFor(p)?.name || 'Disconnected account' }} · {{ date(p.scheduled_at) }}</p>
                <p v-if="p.error" class="error-text">{{ p.error }}</p>
                <div v-if="p.receipts?.length" class="receipt-links">
                    <small>{{ p.receipts.length }} confirmed post(s)</small>
                    <template v-for="(id, index) in p.receipts" :key="id">
                        <a
                            v-if="postUrl(p, id)"
                            :href="postUrl(p, id)"
                            class="outline"
                            @click.prevent="openPost(p, id)"
                            @auxclick.middle.prevent="openPost(p, id)"
                            target="_blank"
                            rel="noopener"
                        >
                            View post{{ p.receipts.length > 1 ? ' ' + (index + 1) : '' }} ↗
                        </a>
                        <code v-else>{{ id }}</code>
                    </template>
                </div>
            </div>
            <span class="tag" :class="p.status">{{ publicationStatus(p) }}</span>
            <button
                v-if="['failed', 'missed', 'uncertain', 'cancelled'].includes(p.status)"
                class="outline"
                @click="openRecovery(p)"
            >
                Recover
            </button>
            <button
                v-if="p.status === 'cancelled'"
                class="outline"
                @click="deletePublication(p)"
                :disabled="busy"
            >
                Delete
            </button>
            <button
                v-if="['scheduled', 'retry', 'failed', 'missed'].includes(p.status)"
                class="outline"
                @click="cancel(p)"
                :disabled="busy"
            >
                Cancel
            </button>
        </div>
        <div v-if="!(page === 'Queue' ? queue : history).length" class="empty">
            <div class="empty-art">{{ page === 'Queue' ? '◷' : '↗' }}</div>
            <h2>{{ page === 'Queue' ? 'No queued posts' : 'No publications' }}</h2>
            <p>
                {{
                    page === 'Queue'
                        ? 'Schedule a draft for a specific time or add it to your weekly queue.'
                        : 'Published posts and failed attempts appear here.'
                }}
            </p>
            <button class="outline" @click="page = 'Posts'">Back to posts</button>
        </div>
    </section>
</template>
