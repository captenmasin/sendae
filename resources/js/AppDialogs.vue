<script setup>
import AccountLogo from './AccountLogo.vue';
import { useWorkspace } from './workspace.js';

const vModal = { mounted: (el) => el.showModal(), beforeUnmount: (el) => el.close() };

const {
    authenticated,
    authorizationForm,
    busy,
    canReschedule,
    chosen,
    connectionForm,
    decideAuthorization,
    error,
    postTitle,
    recover,
    recovery,
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
    selectConnection,
    slots,
    slotsAccount,
    state,
    syncing,
    timezone,
    workspaceForm,
} = useWorkspace();
</script>

<template>
    <template v-if="authenticated">
        <dialog
            v-if="workspaceForm"
            v-modal
            class="modal-backdrop"
            aria-labelledby="workspace-title"
            @cancel.prevent="workspaceForm = null"
            @click.self="workspaceForm = null"
        >
            <section class="modal">
                <button
                    class="modal-close"
                    @click="workspaceForm = null"
                    aria-label="Close workspace settings"
                >
                    ×
                </button>
                <h2 id="workspace-title">{{ workspaceForm.id ? 'Edit workspace' : 'New workspace' }}</h2>
                <form @submit.prevent="saveWorkspace">
                    <label>
                        Name
                        <input
                            v-model="workspaceForm.name"
                            maxlength="100"
                            required
                            autofocus
                            placeholder="Sitepulse"
                        />
                    </label>
                    <label>
                        Icon
                        <input
                            v-model="workspaceForm.icon"
                            maxlength="32"
                            required
                            aria-describedby="workspace-icon-hint"
                        />
                    </label>
                    <div id="workspace-icon-hint" class="muted">Use a symbol, emoji, or initials.</div>
                    <div class="workspace-icons">
                        <button
                            v-for="icon in ['◻', '◎', '◈', '✳', '⌘', '⚡', '★', '◒']"
                            :key="icon"
                            type="button"
                            @click="workspaceForm.icon = icon"
                            :aria-label="'Use ' + icon + ' icon'"
                            :aria-pressed="workspaceForm.icon === icon"
                        >
                            {{ icon }}
                        </button>
                    </div>
                    <button class="primary" :disabled="busy || syncing">
                        {{ workspaceForm.id ? 'Save changes' : 'Create workspace' }}
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
                        Provider post ID
                        <input v-model="recoveryId" required placeholder="Post ID or LinkedIn URN" />
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
                    <p v-if="error" role="alert">{{ error }}</p>
                    <button class="primary" :disabled="busy || syncing">
                        {{
                            busy ? 'Saving…' : canReschedule(recovery) ? 'Save changes' : recoveryAction === 'confirmed'
                                ? 'Verify & record post'
                                : 'Reschedule unfinished work'
                        }}
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
                <h2 id="schedule-title">Schedule post</h2>
                <p v-if="error" class="error-text" role="alert">{{ error }}</p>
                <p>
                    Selected accounts:
                    {{ chosen.map((a) => a.name).join(', ') || 'None. Select accounts in the composer.' }}
                </p>
                <form @submit.prevent="schedule">
                    <label>
                        Publish time
                        <select v-model="scheduleMode">
                            <option value="exact">Choose a date & time</option>
                            <option value="queue">Next weekly slot per account</option>
                            <option value="now">Publish now</option>
                        </select>
                    </label>
                    <label v-if="scheduleMode === 'exact'">
                        Date & time · {{ Intl.DateTimeFormat().resolvedOptions().timeZone }}
                        <input v-model="scheduleAt" type="datetime-local" required />
                    </label>
                    <p class="muted">Scheduling requires confirmation from Sendae.</p>
                    <button class="primary" :disabled="busy || !chosen.length">
                        {{
                            busy ? 'Confirming…' : scheduleMode === 'now' ? 'Publish now' : 'Confirm schedule'
                        }}
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
        @cancel.prevent="connectionForm = null"
    >
        <section class="modal">
            <button class="modal-close" @click="connectionForm = null" aria-label="Cancel account connection">
                ×
            </button>
            <h2 id="connection-title">Choose accounts</h2>
            <p>
                Connect to
                {{
                    state.settings.workspaces?.find((w) => w.id === connectionForm.workspace_id)?.name ||
                    'the workspace where you started this connection'
                }}.
            </p>
            <p v-if="error" role="alert">{{ error }}</p>
            <form @submit.prevent="selectConnection">
                <label
                    v-for="(account, index) in connectionForm.accounts"
                    :key="account.provider_id"
                    class="destination"
                >
                    <input type="checkbox" v-model="connectionForm.selected" :value="index" />
                    <AccountLogo :account="account" :provider="connectionForm.provider" />
                    {{ account.name }}
                </label>
                <label>
                    Timezone
                    <input v-model="connectionForm.timezone" required />
                </label>
                <button class="primary" :disabled="busy || !connectionForm.selected.length">
                    Connect selected accounts
                </button>
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
        <section class="modal">
            <h2 id="authorization-title">Connect {{ authorizationForm.client }}?</h2>
            <p>
                This client will be able to read and edit drafts, attach media, schedule, publish, cancel, and
                refresh analytics. Publishing will not ask for another approval.
            </p>
            <p>Signed in as {{ state.settings.email }}.</p>
            <p>Requested permissions: {{ authorizationForm.scopes.join(', ') }}</p>
            <p style="overflow-wrap: anywhere">Return to: {{ authorizationForm.redirect_uri }}</p>
            <p v-if="error" role="alert">{{ error }}</p>
            <button class="primary" @click="decideAuthorization(true)" :disabled="busy">
                Authorize access
            </button>
            <button class="outline" @click="decideAuthorization(false)" :disabled="busy">Decline</button>
        </section>
    </dialog>
</template>
