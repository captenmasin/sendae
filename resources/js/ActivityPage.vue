<script setup>
import { computed, ref } from 'vue';
import AccountLogo from './AccountLogo.vue';
import Icon from './Icon.vue';
import { useWorkspace } from './workspace.js';

const { activity, busy, date, isFullyPublished, openDraft, page, state } = useWorkspace();
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
const type = ref('all');
const accountId = ref('all');
const accounts = computed(() => activity.value
    .filter((event) => event.account)
    .map((event) => event.account)
    .filter((account, index, all) => all.findIndex((item) => item.id === account.id) === index));
const visibleActivity = computed(() => activity.value.filter((event) =>
    (type.value === 'all' || event.type === type.value) &&
    (accountId.value === 'all' || event.account?.id === accountId.value)));
</script>

<template>
    <div class="page-heading">
        <div><h1>Activity</h1></div>
    </div>
    <section class="content-section">
        <div v-if="activity.length" class="activity-filters" aria-label="Filter activity">
            <label>
                Status
                <select v-model="type">
                    <option value="all">All activity</option>
                    <option v-for="(label, value) in labels" :key="value" :value="value">{{ label }}</option>
                </select>
            </label>
            <label>
                Account
                <select v-model="accountId">
                    <option value="all">All accounts</option>
                    <option v-for="account in accounts" :key="account.id" :value="account.id">{{ account.name }}</option>
                </select>
            </label>
        </div>
        <ol v-if="visibleActivity.length" class="activity-list">
            <li v-for="event in visibleActivity" :key="event.id">
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
                    v-if="event.draft && !isFullyPublished(event.draft.id) && state.drafts.some((draft) => draft.id === event.draft.id)"
                    class="text-button"
                    @click="openDraft(event.draft)"
                    :disabled="busy"
                >
                    Open
                </button>
            </li>
        </ol>
        <div v-else-if="activity.length" class="empty">
            <h2>No matching activity</h2>
            <p>Try another status or account.</p>
        </div>
        <div v-else class="empty">
            <div class="empty-art"><Icon name="Activity" :size="36" /></div>
            <h2>No activity yet</h2>
            <p>Drafts, schedules, and published posts appear here in order.</p>
            <button class="outline" @click="page = 'Posts'">Back to posts</button>
        </div>
    </section>
</template>

<style scoped>
.activity-filters { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
.activity-filters label { display: grid; gap: 6px; font-size: 12px; }
</style>
