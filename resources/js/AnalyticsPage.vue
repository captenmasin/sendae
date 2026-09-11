<script setup>
import AccountLogo from './AccountLogo.vue';
import Icon from './Icon.vue';
import { useWorkspace } from './workspace.js';

const { accountFor, busy, date, postTitle, refreshMetrics, state } = useWorkspace();
</script>

<template>
    <div class="page-heading">
        <div>
            <h1>Analytics</h1>
            <p>Engagement for published posts.</p>
        </div>
    </div>
    <section class="content-section">
        <div class="analytics-note">
            Updated daily for 7 days, again at day 30, and whenever you refresh. Unavailable metrics stay
            unavailable.
        </div>
        <article
            class="metrics-card"
            v-for="p in state.publications.filter((p) => p.status === 'published')"
            :key="p.id"
        >
            <div class="metrics-heading">
                <div>
                    <h3>{{ postTitle(p) }}</h3>
                    <p><AccountLogo :account="accountFor(p)" :size="16" /> {{ accountFor(p)?.name }} · Published: {{ date(p.published_at) }}</p>
                </div>
                <button class="outline" @click="refreshMetrics(p)" :disabled="busy">Refresh</button>
            </div>
            <div class="metrics-grid">
                <div
                    v-for="(value, key) in p.metrics || {
                        views: null,
                        likes: null,
                        comments: null,
                        reposts: null,
                    }"
                    :key="key"
                >
                    <strong>{{ value === null ? '—' : value.toLocaleString() }}</strong>
                    <span>{{ key.replaceAll('_', ' ') }}</span>
                </div>
            </div>
            <small>
                {{ p.metrics_status.replaceAll('_', ' ') }} ·
                {{
                    p.metrics_refreshed_at
                        ? 'Last checked ' + date(p.metrics_refreshed_at)
                        : 'Not refreshed yet'
                }}
            </small>
        </article>
        <div v-if="!state.publications.some((p) => p.status === 'published')" class="empty">
            <div class="empty-art"><Icon name="ChartColumn" :size="36" /></div>
            <h2>No analytics yet</h2>
            <p>Publish a post to see its metrics.</p>
        </div>
    </section>
</template>
