<script setup>
import AccountLogo from './AccountLogo.vue';
import WorkspaceAvatar from './WorkspaceAvatar.vue';
import { useWorkspace } from './workspace.js';

const vModal = { mounted: (el) => el.showModal(), beforeUnmount: (el) => el.close() };

function callbackHost(uri) {
    try {
        return new URL(uri).hostname;
    } catch {
        return '';
    }
}
function isLoopback(uri) {
    const host = callbackHost(uri);
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

const {
    authenticated,
    authorizationForm,
    busy,
    blueskyForm,
    connectBluesky,
    canReschedule,
    chosen,
    connectionForm,
    decideAuthorization,
    editQueueSlots,
    error,
    postTitle,
    previewQueue,
    queueAccountsWithoutSlots,
    queuePreview,
    queuePreviewDate,
    queuePreviewError,
    queuePreviewing,
    recover,
    recovery,
    separatesPublication,
    recoveryAction,
    recoveryAt,
    recoveryId,
    resetForm,
    resetPassword,
    saveSlots,
    saveWorkspace,
    schedule,
    scheduleAt,
    scheduleMode,
    scheduleOpen,
    scheduledLocked,
    selectConnection,
    slots,
    slotsAccount,
    state,
    syncing,
    timezone,
    unschedule,
    workspaceForm,
    workspaceImagePreview,
} = useWorkspace();
</script>

<template>
    <template v-if="authenticated">
        <dialog
            v-if="blueskyForm"
            v-modal
            class="modal-backdrop"
            aria-labelledby="bluesky-title"
            @cancel.prevent="!busy && (blueskyForm = null)"
            @click.self="!busy && (blueskyForm = null)"
        >
            <section class="modal">
                <button
                    class="modal-close"
                    @click="blueskyForm = null"
                    aria-label="Close Bluesky connection"
                    :disabled="busy"
                >
                    ×
                </button>
                <h2 id="bluesky-title">Connect Bluesky</h2>
                <p>Create an app password in Bluesky under Settings → Privacy and security → App passwords.</p>
                <form @submit.prevent="connectBluesky">
                    <label>
                        Handle
                        <input
                            v-model="blueskyForm.identifier"
                            placeholder="you.bsky.social"
                            autocomplete="username"
                            maxlength="253"
                            required
                            autofocus
                            :disabled="busy"
                        />
                    </label>
                    <label>
                        App password
                        <input
                            v-model="blueskyForm.password"
                            type="password"
                            autocomplete="off"
                            maxlength="100"
                            required
                            :disabled="busy"
                        />
                    </label>
                    <p class="muted">
                        Use an app password, not your account password. Supports accounts hosted by Bluesky,
                        with text, threads and up to four images per post.
                    </p>
                    <p v-if="error" role="alert">{{ error }}</p>
                    <button class="primary" :disabled="busy || syncing">
                        {{ busy ? 'Connecting…' : 'Connect Bluesky' }}
                    </button>
                </form>
            </section>
        </dialog>
        <dialog
            v-if="workspaceForm"
            v-modal
            class="modal-backdrop"
            aria-labelledby="workspace-title"
            @cancel.prevent="!busy && (workspaceForm = null)"
            @click.self="!busy && (workspaceForm = null)"
        >
            <section class="modal">
                <button
                    class="modal-close"
                    @click="workspaceForm = null"
                    aria-label="Close workspace settings"
                    :disabled="busy"
                >
                    ×
                </button>
                <h2 id="workspace-title">{{ workspaceForm.id ? 'Edit workspace' : 'New workspace' }}</h2>
                <form @submit.prevent="saveWorkspace">
                    <div class="workspace-image-preview">
                        <img v-if="workspaceImagePreview" :src="workspaceImagePreview" alt="Workspace image preview" />
                        <WorkspaceAvatar v-else :workspace="{ ...workspaceForm, has_image: false }" :size="48" />
                        <div class="workspace-image-controls">
                            <label class="outline workspace-image-upload">
                                {{ workspaceImagePreview ? 'Change image' : 'Upload image' }}
                                <input type="file" accept="image/jpeg,image/png,image/webp" :disabled="busy" @change="workspaceForm.imageFile = $event.target.files[0]" />
                            </label>
                            <button
                                v-if="workspaceForm.has_image || workspaceForm.imageFile"
                                type="button"
                                class="text-button"
                                :disabled="busy"
                                @click="workspaceForm.imageFile = null; workspaceForm.removeImage = true; workspaceForm.has_image = false"
                            >Remove image</button>
                        </div>
                    </div>
                    <label>
                        Workspace name
                        <input
                            v-model="workspaceForm.name"
                            maxlength="100"
                            required
                            autofocus
                            :disabled="busy"
                            placeholder="Sitepulse"
                        />
                    </label>
                    <p class="muted">JPG, PNG or WebP up to 2 MB. Without an image, your workspace uses its first letter.</p>
                    <p v-if="error" role="alert" class="error-text">{{ error }}</p>
                    <button class="primary" :disabled="busy || syncing">
                        {{ busy ? 'Saving…' : workspaceForm.id ? 'Save changes' : 'Create workspace' }}
                    </button>
                </form>
            </section>
        </dialog>
        <dialog
            v-if="recovery"
            v-modal
            class="modal-backdrop"
            aria-labelledby="recovery-title"
            @cancel.prevent="!busy && (recovery = null)"
            @click.self="!busy && (recovery = null)"
        >
            <section class="modal" aria-labelledby="recovery-title">
                <button class="modal-close" @click="recovery = null" aria-label="Close publication editor" :disabled="busy">×</button>
                <h2 id="recovery-title">{{ canReschedule(recovery) ? 'Change date & time' : 'Recover this publication' }}</h2>
                <p v-if="canReschedule(recovery)">{{ postTitle(recovery) }}</p>
                <p v-else>
                    {{ postTitle(recovery) }} · {{ recovery.receipts?.length || 0 }} confirmed item(s)
                    will be retained.
                </p>
                <form @submit.prevent="recover">
                    <label v-if="!canReschedule(recovery)">
                        Recovery action
                        <select v-model="recoveryAction">
                            <template v-if="recovery.status === 'uncertain'">
                                <option value="confirmed">I found the published post</option>
                                <option value="not_published">I verified that it was not published</option>
                            </template>
                            <option v-else value="reschedule">Reschedule unfinished items</option>
                        </select>
                    </label>
                    <label v-if="recoveryAction === 'confirmed'">
                        Published post link
                        <input v-model="recoveryId" required placeholder="Paste the post’s full URL (or provider ID)" />
                    </label>
                    <label v-else>
                        New date & time
                        <input v-model="recoveryAt" type="datetime-local" required :disabled="busy || syncing" />
                    </label>
                    <p v-if="canReschedule(recovery)" class="muted">Times in {{ Intl.DateTimeFormat().resolvedOptions().timeZone }}</p>
                    <p v-else class="muted">
                        Check the actual provider before resolving an uncertain outcome. Rescheduling an
                        already published item can create a duplicate.
                    </p>
                    <p v-if="separatesPublication(recovery) && recoveryAction === 'reschedule'" class="muted">Changing this destination’s time or unscheduling it moves it to a separate post in Posts. Other destinations keep their schedules.</p>
                    <p v-if="recovery.status === 'uncertain'" class="muted">Open this account on the social network and check item {{ (recovery.receipts || []).length + 1 }}: “{{ recovery.snapshot.items?.[(recovery.receipts || []).length]?.text }}”. If it exists, copy its link here. If it does not, choose “not published” before rescheduling.</p>
                    <p v-if="error" role="alert">{{ error }}</p>
                    <button class="primary" :disabled="busy || syncing">
                        {{
                            busy ? 'Saving…' : canReschedule(recovery) ? 'Save changes' : recoveryAction === 'confirmed'
                                ? 'Verify & record post'
                                : 'Reschedule unfinished work'
                        }}
                    </button>
                    <button v-if="canReschedule(recovery)" type="button" class="outline" @click="unschedule(recovery)" :disabled="busy || syncing">
                        Unschedule
                    </button>
                </form>
            </section>
        </dialog>
        <dialog
            v-if="scheduleOpen"
            v-modal
            class="modal-backdrop"
            aria-labelledby="schedule-title"
            @cancel.prevent="scheduleOpen = false"
            @click.self="scheduleOpen = false"
        >
            <section class="modal" aria-labelledby="schedule-title">
                <button class="modal-close" @click="scheduleOpen = false" aria-label="Close scheduling">
                    ×
                </button>
                <h2 id="schedule-title">{{ scheduledLocked ? 'Change date & time' : 'Schedule post' }}</h2>
                <p v-if="error" class="error-text" role="alert">{{ error }}</p>
                <p>
                    Selected accounts:
                    {{ chosen.map((a) => a.name).join(', ') || 'None. Select accounts in the composer.' }}
                </p>
                <form @submit.prevent="schedule()">
                    <label>
                        Publish time
                        <select v-model="scheduleMode" @change="scheduleMode === 'queue' && previewQueue()">
                            <option value="exact">Choose a date & time</option>
                            <option value="queue">Next weekly slot per account</option>
                        </select>
                    </label>
                    <label v-if="scheduleMode === 'exact'">
                        Date & time · {{ Intl.DateTimeFormat().resolvedOptions().timeZone }}
                        <input v-model="scheduleAt" type="datetime-local" required />
                    </label>
                    <template v-if="scheduleMode === 'queue'">
                        <p v-if="queueAccountsWithoutSlots.length" class="error-text">
                            Add weekly posting slots for {{ queueAccountsWithoutSlots.map((account) => account.name).join(', ') }} first.
                            <button
                                type="button"
                                class="text-button"
                                @click="editQueueSlots(queueAccountsWithoutSlots[0])"
                            >Manage posting slots</button>
                        </p>
                        <p v-else-if="queuePreviewing" class="muted">Finding the next available slot…</p>
                        <p v-else-if="queuePreviewError" class="error-text">{{ queuePreviewError }}</p>
                        <ul v-else-if="queuePreview.length" class="queue-preview" aria-label="Next weekly posting times">
                            <li v-for="preview in queuePreview" :key="preview.account_id">
                                <strong>{{ preview.name }}</strong> · {{ queuePreviewDate(preview) }}
                            </li>
                        </ul>
                        <p v-else class="muted">Choose this option to review the next available time for each account.</p>
                    </template>
                    <button class="primary" :disabled="busy || !chosen.length || scheduleMode === 'queue' && (!queuePreview.length || queuePreviewing || queueAccountsWithoutSlots.length || queuePreviewError)">
                        {{
                            busy ? 'Saving…' : scheduledLocked ? 'Update' : 'Confirm schedule'
                        }}
                    </button>
                    <button v-if="scheduledLocked" type="button" class="outline" @click="async () => { await unschedule(); if (!error) scheduleOpen = false; }" :disabled="busy || syncing">
                        Unschedule
                    </button>
                </form>
            </section>
        </dialog>
        <dialog
            v-if="slotsAccount"
            v-modal
            class="modal-backdrop"
            aria-labelledby="slots-title"
            @cancel.prevent="slotsAccount = null"
            @click.self="slotsAccount = null"
        >
            <section class="modal" aria-labelledby="slots-title">
                <button class="modal-close" @click="slotsAccount = null" aria-label="Close posting slots">
                    ×
                </button>
                <h2 id="slots-title">Posting slots · {{ slotsAccount.name }}</h2>
                <form @submit.prevent="saveSlots">
                    <label>
                        Account timezone
                        <input v-model="timezone" placeholder="Europe/London" required list="timezones" />
                        <datalist id="timezones">
                            <option
                                v-for="zone in Intl.supportedValuesOf('timeZone')"
                                :value="zone"
                                :key="zone"
                            />
                        </datalist>
                    </label>
                    <div v-for="(slot, index) in slots" :key="index" class="slot-row">
                        <select v-model.number="slot.day" aria-label="Day">
                            <option
                                v-for="(day, i) in [
                                    'Sunday',
                                    'Monday',
                                    'Tuesday',
                                    'Wednesday',
                                    'Thursday',
                                    'Friday',
                                    'Saturday',
                                ]"
                                :value="i"
                                :key="i"
                            >
                                {{ day }}
                            </option>
                        </select>
                        <input type="time" v-model="slot.time" required aria-label="Posting time" />
                        <button
                            type="button"
                            class="icon-button"
                            @click="slots.splice(index, 1)"
                            aria-label="Remove slot"
                        >
                            ×
                        </button>
                    </div>
                    <button type="button" class="text-button" @click="slots.push({ day: 1, time: '09:00' })">
                        ＋ Add weekly slot
                    </button>
                    <p class="muted">
                        Slots follow the local clock through daylight saving changes. Actual dates appear in
                        your queue.
                    </p>
                    <button class="primary" :disabled="busy">Save posting slots</button>
                </form>
            </section>
        </dialog>
    </template>
    <dialog
        v-if="resetForm"
        v-modal
        class="modal-backdrop"
        aria-labelledby="reset-title"
        @cancel.prevent="resetForm = null"
    >
        <section class="modal">
            <button class="modal-close" @click="resetForm = null" aria-label="Close password reset">×</button>
            <h2 id="reset-title">Choose a new password</h2>
            <p v-if="error" role="alert">{{ error }}</p>
            <form @submit.prevent="resetPassword">
                <label>
                    Email
                    <input v-model="resetForm.email" type="email" autocomplete="username" required />
                </label>
                <label>
                    Password · at least 8 characters
                    <input
                        v-model="resetForm.password"
                        type="password"
                        autocomplete="new-password"
                        minlength="8"
                        required
                        autofocus
                    />
                </label>
                <label>
                    Confirm password
                    <input
                        v-model="resetForm.password_confirmation"
                        type="password"
                        autocomplete="new-password"
                        minlength="8"
                        required
                    />
                </label>
                <button class="primary" :disabled="busy">Update password</button>
            </form>
        </section>
    </dialog>
    <dialog
        v-if="connectionForm"
        v-modal
        class="modal-backdrop"
        aria-labelledby="connection-title"
        @cancel.prevent="!busy && (connectionForm = null)"
        @click.self="!busy && (connectionForm = null)"
    >
        <section class="modal connection-modal">
            <button
                class="modal-close"
                @click="connectionForm = null"
                aria-label="Cancel account connection"
                :disabled="busy"
            >
                ×
            </button>
            <header class="connection-header">
                <h2 id="connection-title">Add accounts</h2>
                <p>
                    Select the profiles to add to
                    <strong>{{ state.settings.workspaces?.find((w) => w.id === connectionForm.workspace_id)?.name || 'this workspace' }}</strong>.
                </p>
            </header>
            <p v-if="error" class="connection-error" role="alert">{{ error }}</p>
            <form class="connection-form" @submit.prevent="selectConnection">
                <fieldset class="connection-accounts">
                    <legend>Accounts found</legend>
                    <label
                        v-for="(account, index) in connectionForm.accounts"
                        :key="account.provider_id"
                        class="connection-account"
                        :class="{ selected: connectionForm.selected.includes(index) }"
                    >
                        <input type="checkbox" v-model="connectionForm.selected" :value="index" :disabled="busy" />
                        <AccountLogo :account="account" :provider="connectionForm.provider" :size="24" />
                        <span>{{ account.name }}</span>
                    </label>
                </fieldset>
                <label class="connection-timezone">
                    <span>Timezone</span>
                    <input v-model="connectionForm.timezone" required list="connection-timezones" :disabled="busy" />
                    <small>Used for this account’s posting schedule.</small>
                    <datalist id="connection-timezones">
                        <option v-for="zone in Intl.supportedValuesOf('timeZone')" :value="zone" :key="zone" />
                    </datalist>
                </label>
                <footer class="connection-actions">
                    <button type="button" class="text-button" @click="connectionForm = null" :disabled="busy">Cancel</button>
                    <button class="primary" :disabled="busy || !connectionForm.selected.length">
                        {{ busy ? 'Connecting…' : connectionForm.selected.length ? `Connect ${connectionForm.selected.length} account${connectionForm.selected.length === 1 ? '' : 's'}` : 'Select accounts' }}
                    </button>
                </footer>
            </form>
        </section>
    </dialog>
    <dialog
        v-if="authorizationForm"
        v-modal
        class="modal-backdrop"
        aria-labelledby="authorization-title"
        @cancel.prevent="decideAuthorization(false)"
    >
        <section class="modal authorization-modal">
            <h2 id="authorization-title">Connect {{ authorizationForm.client }}?</h2>
            <p>
                {{ authorizationForm.client }} can read and edit drafts, attach media, schedule, publish, cancel, and
                refresh analytics in every workspace on this account, including workspaces created later. Publishing
                will not ask for another approval.
            </p>
            <p>Signed in as {{ state.settings.email }}.</p>
            <p v-if="isLoopback(authorizationForm.redirect_uri)">This approval returns to an app on this Mac.</p>
            <p v-else-if="callbackHost(authorizationForm.redirect_uri)">Returns to {{ callbackHost(authorizationForm.redirect_uri) }}.</p>
            <p v-if="error" role="alert">{{ error }}</p>
            <footer class="authorization-actions">
                <button class="primary" @click="decideAuthorization(true)" :disabled="busy">Authorize access</button>
                <button type="button" class="outline" @click="decideAuthorization(false)" :disabled="busy">Decline</button>
            </footer>
        </section>
    </dialog>
</template>

<style scoped>
.workspace-image-controls { display: flex; align-items: center; gap: 14px; }
.workspace-image-upload { cursor: pointer; position: relative; }
.workspace-image-upload input { position: absolute; width: 1px; height: 1px; padding: 0; opacity: 0; }
.workspace-image-upload:focus-within { outline: 2px solid currentColor; outline-offset: 3px; }
.workspace-image-preview { margin: 0; }
.queue-preview { display: grid; gap: 6px; margin: 0; padding-left: 18px; font-size: 12px; }
.authorization-modal > p { margin-bottom: 14px; }
.authorization-actions { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
</style>
