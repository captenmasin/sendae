<script setup>
import AccountLogo from './AccountLogo.vue';
import Icon from './Icon.vue';
import { useWorkspace } from './workspace.js';

const {
    busy,
    canConnect,
    connect,
    disconnect,
    editSlots,
    names,
    providerStatus,
    state,
    sync,
    syncing,
} = useWorkspace();
</script>

<template>
    <div class="page-heading">
        <div><h1>Accounts</h1></div>
        <button class="outline" @click="sync()" :disabled="syncing || busy">
            <Icon name="RefreshCw" :size="14" />
            Refresh
        </button>
    </div>
    <section class="content-section">
        <div class="account-grid">
            <article v-for="(label, key) in names" :key="key" class="account-card">
                <div class="account-card-heading">
                    <AccountLogo :provider="key" />
                    <h2>{{ label }}</h2>
                    <button
                        v-if="canConnect(key)"
                        class="text-button"
                        @click="connect(key)"
                        :disabled="busy || syncing"
                        :aria-label="'Connect ' + label"
                    >
                        <Icon name="Plus" :size="12" /> Connect
                    </button>
                    <span v-else class="tag">{{ providerStatus(key) }}</span>
                </div>
                <ul
                    v-if="state.accounts.some((a) => a.provider === key && a.status !== 'disconnected')"
                    class="account-connections"
                >
                    <li
                        v-for="a in state.accounts.filter(
                            (a) => a.provider === key && a.status !== 'disconnected',
                        )"
                        :key="a.id"
                    >
                        <div class="account-identity">
                            <AccountLogo :account="a" :size="28" />
                            <div class="account-details">
                                <h3>
                                    {{ key === 'threads' && !a.name.startsWith('@') ? '@' : '' }}{{ a.name }}
                                    <span v-if="a.verified" class="verified-badge" title="Verified">
                                        <Icon name="BadgeCheck" :size="14" />
                                        <span class="visually-hidden">Verified</span>
                                    </span>
                                </h3>
                            </div>
                            <button
                                class="icon-button account-disconnect"
                                @click="disconnect(a)"
                                :disabled="busy || syncing"
                                :aria-label="'Disconnect ' + a.name"
                                :title="'Disconnect ' + a.name"
                            >
                                <Icon name="Trash" :size="16" />
                            </button>
                        </div>
                        <div class="account-actions">
                            <button class="text-button" @click="editSlots(a)" :disabled="busy || syncing">
                                {{
                                    a.slots?.length
                                        ? a.slots.length + ' posting slot' + (a.slots.length === 1 ? '' : 's')
                                        : 'Manage posting slots'
                                }}
                            </button>
                        </div>
                    </li>
                </ul>
                <p v-else>Not connected</p>
            </article>
        </div>
    </section>
</template>
