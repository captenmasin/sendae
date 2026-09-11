<script setup>
import { provide, watch } from 'vue';
import { Toaster, toast } from 'vue-sonner';
import { createWorkspace, workspaceKey } from './workspace.js';
import AppSidebar from './AppSidebar.vue';
import AppDialogs from './AppDialogs.vue';
import AuthScreen from './AuthScreen.vue';
import PostsPage from './PostsPage.vue';
import PublicationsPage from './PublicationsPage.vue';
import ActivityPage from './ActivityPage.vue';
import AccountsPage from './AccountsPage.vue';
import AnalyticsPage from './AnalyticsPage.vue';
import SettingsPage from './SettingsPage.vue';

const workspace = createWorkspace();
provide(workspaceKey, workspace);
const { authenticated, colorScheme, currentWorkspace, gravatarUrl, page, error, notice, loaded } = workspace;
watch(notice, (message) => {
    if (!message || !authenticated.value) return;
    toast.success(message);
    notice.value = '';
});
watch(error, (message) => {
    if (message && authenticated.value) toast.error(message);
});
const pages = {
    Posts: { component: PostsPage, icon: 'Inbox' },
    Queue: { component: PublicationsPage, icon: 'Clock' },
    Published: { component: PublicationsPage, icon: 'ArrowUpRight' },
    Activity: { component: ActivityPage, icon: 'Activity' },
    Analytics: { component: AnalyticsPage, icon: 'ChartColumn' },
    Accounts: { component: AccountsPage, icon: 'AtSign' },
    Settings: { component: SettingsPage, icon: 'Settings' },
};
try {
    const savedPage = window.sessionStorage.getItem('sendae.page');
    if (Object.hasOwn(pages, savedPage)) page.value = savedPage;
} catch {
    // Navigation remains available when session storage is unavailable.
}
watch(page, (value) => {
    try {
        window.sessionStorage.setItem('sendae.page', value);
    } catch {
        // Storage failures must not interrupt navigation.
    }
}, { flush: 'sync' });
</script>

<template>
    <AuthScreen v-if="!authenticated" />
    <div v-else class="app-shell">
        <AppSidebar :pages="pages" />
        <main :class="{ 'posts-main': page === 'Posts' }">
            <header v-if="page !== 'Posts'">
                <div class="breadcrumb">
                    {{ currentWorkspace.name }}
                    <span>/</span>
                    <strong>{{ page }}</strong>
                </div>
                <span class="owner-avatar">
                    <img v-if="gravatarUrl" :src="gravatarUrl" alt="" />
                    <span v-else>You</span>
                </span>
            </header>
            <div v-if="!loaded" class="empty"><p>Opening your workspace…</p></div>
            <component v-else :is="pages[page].component" />
        </main>
    </div>
    <AppDialogs />
    <Toaster v-if="authenticated" position="bottom-right" :theme="colorScheme" :duration="5000" close-button />
</template>
