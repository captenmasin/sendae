<script setup>
import AccountLogo from './AccountLogo.vue';
import Icon from './Icon.vue';
import { useWorkspace } from './workspace.js';

const { activity, busy, date, openDraft, page, state } = useWorkspace();
const labels = {
    created: 'Draft created',
    updated: 'Draft updated',
    scheduled: 'Scheduled',
    retry: 'Retrying',
    publishing: 'Publishing',
    published: 'Published',
    failed: 'Failed',
    missed: 'Missed',
    uncertain: 'Needs review',
    cancelled: 'Cancelled',
};
</script>

<template>
    <div class="page-heading">
        <div><h1>Activity</h1></div>
    </div>
    <section class="content-section">
        <ol v-if="activity.length" class="activity-list">
            <li v-for="event in activity" :key="event.id">
                <AccountLogo v-if="event.account" :account="event.account" :size="28" />
                <span v-else class="activity-mark" aria-hidden="true">
                    <Icon :name="event.type === 'published' ? 'ArrowUpRight' : event.type === 'created' ? 'FileText' : 'Clock'" :size="14" />
                </span>
                <div>
                    <strong>{{ event.title }}</strong>
                    <p>
                        {{ labels[event.type] || event.type }}
                        <template v-if="event.account"> · {{ event.account.name }}</template>
                        · {{ date(event.at) }}
                    </p>
                </div>
                <button
                    v-if="event.draft && state.drafts.some((draft) => draft.id === event.draft.id)"
                    class="text-button"
                    @click="openDraft(event.draft)"
                    :disabled="busy"
                >
                    Open
                </button>
            </li>
        </ol>
        <div v-else class="empty">
            <div class="empty-art"><Icon name="Activity" :size="36" /></div>
            <h2>No activity yet</h2>
            <p>Drafts, schedules, and published posts appear here in order.</p>
            <button class="outline" @click="page = 'Posts'">Back to posts</button>
        </div>
    </section>
</template>
