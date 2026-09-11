<script setup>
import AccountLogo from './AccountLogo.vue';
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
        <button class="outline" @click="sync()" :disabled="syncing || busy">Refresh</button>
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
                        ＋ Connect
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
                                </h3>
                            </div>
                            <button
                                class="icon-button account-disconnect"
                                @click="disconnect(a)"
                                :disabled="busy || syncing"
                                :aria-label="'Disconnect ' + a.name"
                                :title="'Disconnect ' + a.name"
                            >
                                <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.5"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    aria-hidden="true"
                                >
                                    <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
                                </svg>
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
