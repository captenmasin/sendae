<script setup>
import Icon from './Icon.vue';
import WorkspaceAvatar from './WorkspaceAvatar.vue';
import { useWorkspace } from './workspace.js';

const {
    busy,
    colorScheme,
    currentWorkspace,
    deleteWorkspace,
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
    <section class="settings-page">
        <article class="settings-section" aria-labelledby="settings-workspace">
            <div class="settings-section-heading">
                <h2 id="settings-workspace">Workspace</h2>
                <p>Your shared space for accounts and posts.</p>
            </div>
            <div class="settings-section-body">
                <div class="settings-identity">
                    <WorkspaceAvatar :workspace="currentWorkspace" :size="48" />
                    <div><h3>{{ currentWorkspace.name }}</h3><p>Current workspace</p></div>
                    <button class="outline" @click="editWorkspace()" :disabled="busy || syncing">
                        <Icon name="Pencil" :size="14" /> Edit workspace
                    </button>
                </div>
                <div class="settings-delete-row">
                    <p>{{ state.settings.workspaces?.length > 1 ? 'Remove this workspace and its content from Sendae.' : 'Create another workspace before deleting this one.' }}</p>
                    <button class="outline" @click="deleteWorkspace" :disabled="busy || syncing || !(state.settings.workspaces?.length > 1)">
                        <Icon name="Trash" :size="14" /> Delete workspace
                    </button>
                </div>
            </div>
        </article>
        <article class="settings-section" aria-labelledby="settings-appearance">
            <div class="settings-section-heading">
                <h2 id="settings-appearance">Appearance</h2>
                <p>Choose how Sendae looks on this device.</p>
            </div>
            <div class="settings-section-body">
                <div class="settings-theme-options" role="group" aria-label="Color theme">
                    <button v-for="option in [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]" :key="option[0]" :aria-pressed="theme === option[0]" @click="setTheme(option[0])">
                        <span class="settings-theme-preview" :class="'theme-preview-' + option[0]" aria-hidden="true"><i></i><span><b></b><b></b><b></b></span></span>
                        <span class="settings-theme-label">{{ option[1] }} <span class="theme-radio" aria-hidden="true"></span></span>
                    </button>
                </div>
                <p class="settings-hint">{{ theme === 'system' ? 'Matches your system. Currently ' + colorScheme + '.' : (colorScheme === 'dark' ? 'Dark' : 'Light') + ' appearance is enabled.' }}</p>
            </div>
        </article>
        <article class="settings-section" aria-labelledby="settings-account">
            <div class="settings-section-heading">
                <h2 id="settings-account">Account</h2>
                <p>Manage your profile and sign-in details.</p>
            </div>
            <div class="settings-section-body">
                <div class="settings-identity settings-account-identity">
                    <img v-if="gravatarUrl" class="settings-gravatar" :src="gravatarUrl" alt="" width="44" height="44" />
                    <div><h3>{{ state.settings.name || 'Your account' }}</h3><p>{{ state.settings.email }}</p></div>
                </div>
                <form class="settings-profile-form" @submit.prevent="updateProfile">
                    <div class="settings-fields">
                        <label>Name<input v-model="profileForm.name" maxlength="100" required autocomplete="name" :disabled="busy || savingProfile" /></label>
                        <label>Email<input v-model="profileForm.email" type="email" required autocomplete="username" :disabled="busy || savingProfile" /></label>
                    </div>
                    <p class="settings-hint">Your profile image uses Gravatar for this email address.</p>
                    <div class="settings-password">
                        <h3>Password</h3>
                        <p class="settings-hint">Enter your current password to change your email or set a new password.</p>
                        <label>Current password<input v-model="profileForm.current_password" type="password" autocomplete="current-password" :disabled="busy || savingProfile" :required="profileForm.email !== state.settings.email || !!profileForm.password" /></label>
                        <div class="settings-fields">
                            <label>New password<input v-model="profileForm.password" type="password" minlength="8" autocomplete="new-password" :disabled="busy || savingProfile" /></label>
                            <label>Confirm new password<input v-model="profileForm.password_confirmation" type="password" minlength="8" autocomplete="new-password" :disabled="busy || savingProfile" :required="!!profileForm.password" /></label>
                        </div>
                    </div>
                    <div class="settings-account-actions">
                        <button class="primary" :disabled="busy || savingProfile || syncing">{{ savingProfile ? 'Saving…' : 'Save account' }}</button>
                        <button type="button" class="outline" @click="signOut" :disabled="busy || savingProfile"><Icon name="LogOut" :size="14" />Sign out</button>
                    </div>
                </form>
            </div>
        </article>
    </section>
</template>

<style scoped>
.settings-page { max-width: 980px; margin: 0 40px 48px; }
.settings-section { display: grid; grid-template-columns: 175px minmax(0, 1fr); gap: 36px; padding: 30px 0; border-top: 1px solid var(--border); }
.settings-section:first-child { padding-top: 24px; }
.settings-section-heading h2 { font-size: 16px; letter-spacing: -.2px; margin-bottom: 8px; }
.settings-section-heading p, .settings-hint, .settings-identity p, .settings-delete-row p { color: var(--muted); font-size: 12px; line-height: 1.6; }
.settings-section-body { min-width: 0; }
.settings-identity { display: flex; align-items: center; gap: 14px; }
.settings-identity>div { flex: 1; min-width: 0; }
.settings-identity h3, .settings-identity p { overflow-wrap: anywhere; }
.settings-identity h3 { font-size: 15px; margin-bottom: 3px; }
.settings-identity .outline, .settings-delete-row .outline { gap: 8px; }
.settings-delete-row { display: flex; gap: 20px; justify-content: space-between; align-items: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border); }
.settings-delete-row .outline { font-size: 11px; padding: 9px 12px; }
.settings-delete-row button:disabled { cursor: not-allowed; }
.settings-theme-options { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.settings-theme-options>button { min-width: 0; text-align: left; padding: 7px; border: 1px solid var(--border); border-radius: 9px; }
.settings-theme-options>button[aria-pressed=true] { border-color: currentColor; box-shadow: 0 0 0 1px currentColor; }
.settings-theme-preview { display: flex; gap: 8px; height: 82px; padding: 10px; overflow: hidden; border-radius: 5px; background: #fafafa; border: 1px solid #ddd; }
.settings-theme-preview>i { width: 24%; border-radius: 2px; background: #ddd; }
.settings-theme-preview>span { display: grid; gap: 7px; flex: 1; align-content: center; }
.settings-theme-preview b { display: block; height: 8px; border-radius: 2px; background: #e2e2e2; }
.settings-theme-preview b:first-child { width: 55%; background: #aaa; }
.theme-preview-dark { background: #1e1e1e; border-color: #444; }
.theme-preview-dark>i, .theme-preview-dark b { background: #3c3c3c; }
.theme-preview-dark b:first-child { background: #777; }
.theme-preview-system { background: linear-gradient(115deg, #fafafa 50%, #1e1e1e 50%); }
.theme-preview-system b { background: #999; }
.settings-theme-label { display: flex; justify-content: space-between; align-items: center; padding: 11px 3px 4px; font-size: 12px; }
.theme-radio { width: 13px; height: 13px; border: 1px solid var(--muted); border-radius: 50%; }
[aria-pressed=true] .theme-radio { border: 4px solid currentColor; }
.settings-section-body>.settings-hint { margin-top: 14px; }
.settings-gravatar { border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.settings-account-identity { margin-bottom: 24px; }
.settings-profile-form { display: grid; gap: 18px; }
.settings-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.settings-profile-form label { font-size: 12px; }
.settings-profile-form input { width: 100%; min-width: 0; font-size: 13px; }
.settings-profile-form>.settings-hint { margin-top: -8px; }
.settings-password { display: grid; gap: 16px; padding-top: 20px; border-top: 1px solid var(--border); }
.settings-password h3 { font-size: 13px; }
.settings-password .settings-hint { margin-top: -10px; }
.settings-password>label { width: calc(50% - 8px); }
.settings-account-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 4px; }
.settings-account-actions .outline { gap: 8px; }
@media (max-width: 1100px) { .settings-page { margin-left: 25px; margin-right: 25px; } .settings-section { grid-template-columns: 135px minmax(0, 1fr); gap: 24px; } }
@media (max-width: 900px) { .settings-section { grid-template-columns: 1fr; gap: 22px; } .settings-section-heading p { max-width: none; } }
@media (max-width: 580px) { .settings-identity { flex-wrap: wrap; } .settings-identity>button { margin-left: 62px; } .settings-delete-row { align-items: flex-start; flex-direction: column; gap: 12px; } .settings-fields { grid-template-columns: 1fr; } .settings-password>label { width: 100%; } .settings-theme-options { gap: 8px; } .settings-theme-preview { height: 64px; padding: 7px; gap: 5px; } }
</style>
