<script setup>
import Icon from './Icon.vue';
import WorkspaceAvatar from './WorkspaceAvatar.vue';
import { useWorkspace } from './workspace.js';

const {
    busy,
    colorScheme,
    currentWorkspace,
    editWorkspace,
    gravatarUrl,
    profileForm,
    savingProfile,
    setTheme,
    signOut,
    state,
    syncing,
    theme,
    updateProfile,
} = useWorkspace();
</script>

<template>
    <div class="page-heading">
        <div><h1>Settings</h1></div>
    </div>
    <section class="settings-content">
        <article class="settings-card">
            <h2>Workspace</h2>
            <p class="settings-workspace">
                <WorkspaceAvatar :workspace="currentWorkspace" :size="36" />
                {{ currentWorkspace.name }}
            </p>
            <button class="outline" @click="editWorkspace()" :disabled="busy || syncing">
                Edit workspace
            </button>
        </article>
        <article class="settings-card">
            <h2>Appearance</h2>
            <div class="theme-options" role="group" aria-label="Color theme">
                <button
                    v-for="option in [
                        ['system', 'System'],
                        ['light', 'Light'],
                        ['dark', 'Dark'],
                    ]"
                    :key="option[0]"
                    class="outline"
                    :aria-pressed="theme === option[0]"
                    @click="setTheme(option[0])"
                >
                    <Icon :name="option[0] === 'dark' ? 'Moon' : 'Sun'" :size="14" />
                    {{ option[1] }}
                </button>
            </div>
            <p class="muted">Currently {{ colorScheme }}.</p>
        </article>
        <article class="settings-card">
            <h2>Account</h2>
            <div class="account-profile">
                <img v-if="gravatarUrl" class="gravatar" :src="gravatarUrl" alt="" width="48" height="48" />
                <p>{{ state.settings.email }}</p>
            </div>
            <form class="profile-form" @submit.prevent="updateProfile">
                <label>
                    Name
                    <input v-model="profileForm.name" maxlength="100" required autocomplete="name" :disabled="busy || savingProfile" />
                </label>
                <label>
                    Email
                    <input v-model="profileForm.email" type="email" required autocomplete="username" :disabled="busy || savingProfile" />
                </label>
                <label>
                    Current password
                    <input
                        v-model="profileForm.current_password"
                        type="password"
                        autocomplete="current-password"
                        :disabled="busy || savingProfile"
                        :required="profileForm.email !== state.settings.email || !!profileForm.password"
                    />
                </label>
                <label>
                    New password
                    <input
                        v-model="profileForm.password"
                        type="password"
                        minlength="8"
                        autocomplete="new-password"
                        :disabled="busy || savingProfile"
                    />
                </label>
                <label>
                    Confirm new password
                    <input
                        v-model="profileForm.password_confirmation"
                        type="password"
                        minlength="8"
                        autocomplete="new-password"
                        :disabled="busy || savingProfile"
                        :required="!!profileForm.password"
                    />
                </label>
                <p class="muted">Avatars use Gravatar for this email. Current password is required to change email or password.</p>
                <button class="primary" :disabled="busy || savingProfile || syncing">
                    {{ savingProfile ? 'Saving…' : 'Save account' }}
                </button>
            </form>
            <button class="outline" @click="signOut" :disabled="busy">
                <Icon name="LogOut" :size="14" />
                Sign out
            </button>
        </article>
    </section>
</template>
