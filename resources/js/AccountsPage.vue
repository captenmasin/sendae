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
        <div>
            <h1>Accounts</h1>
            <p>Manage this workspace’s profiles and posting schedules.</p>
        </div>
        <button class="outline" @click="sync()" :disabled="syncing || busy">
            <Icon name="RefreshCw" :size="14" />
            Refresh
        </button>
    </div>
    <section class="content-section accounts-section" aria-label="Social accounts">
        <div class="account-grid">
            <article v-for="(label, key) in names" :key="key" class="account-card">
                <div class="account-card-heading">
                    <span class="account-provider-mark"><AccountLogo :provider="key" :size="22" /></span>
                    <h2>{{ label }}</h2>
                    <button
                        v-if="canConnect(key)"
                        class="outline account-connect"
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
                            <AccountLogo :account="a" :size="40" />
                            <div class="account-details">
                                <h3>
                                    {{ key === 'threads' && !a.name.startsWith('@') ? '@' : '' }}{{ a.name }}
                                </h3>
                                <div class="account-status">
                                    <span v-if="a.verified" class="account-verification" :title="'Verified on ' + label">
                                        <Icon name="BadgeCheck" :size="14" />
                                        <span>Verified</span>
                                    </span>
                                    <span v-if="a.status !== 'connected'" class="account-reconnect-status">
                                        <Icon name="CircleAlert" :size="13" /> Reconnect to publish
                                    </span>
                                </div>
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
                            <button
                                v-if="a.status !== 'connected' && canConnect(key)"
                                class="text-button"
                                @click="connect(key)"
                                :disabled="busy || syncing"
                                :aria-label="'Reconnect ' + a.name"
                            >Reconnect</button>
                            <button class="text-button" @click="editSlots(a)" :disabled="busy || syncing">
                                <Icon name="Clock3" :size="13" />
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

<style scoped>
.accounts-section{border-top:0;padding-top:0}
.account-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:20px;max-width:1100px}
.account-card{padding:0;border-radius:12px;background:var(--surface,#fff);overflow:hidden}
.account-card-heading{padding:18px 20px;gap:11px}
.account-card-heading h2{font-size:15px;letter-spacing:-.2px}
.account-provider-mark{display:grid;place-items:center;width:38px;height:38px;border:1px solid var(--border);background:var(--paper);border-radius:10px;flex-shrink:0}
.account-card-heading>.account-connect{margin-left:auto;padding:7px 10px;gap:5px;font-size:11px}
.account-card-heading>.tag{white-space:normal;text-align:right;line-height:1.4;color:var(--muted);background:var(--paper)}
.account-connections{margin:0;gap:0}
.account-connections li{padding:20px;border-top:1px solid var(--border)}
.account-identity{gap:12px}
.account-details{flex:1}
.account-details h3{font-size:14px;line-height:1.5}
.account-status{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:4px;font-size:11px;color:var(--muted)}
.account-status:empty{display:none}
.account-verification,.account-reconnect-status{display:inline-flex;align-items:center;gap:4px}
.account-verification{font-weight:550;color:var(--accent)}
.account-disconnect{border-radius:6px;min-width:30px;min-height:30px}
.account-disconnect:hover{background:var(--paper)}
.account-actions{padding-left:52px;margin-top:11px;justify-content:flex-start;gap:14px}
.account-actions .text-button{display:inline-flex;align-items:center;gap:5px;color:var(--muted);line-height:1.5}
.account-actions .text-button:hover{color:var(--accent)}
.account-card>p{padding:0 20px 20px;margin:0;color:var(--muted);font-size:12px}
@media(max-width:600px){.account-card-heading,.account-connections li{padding:16px}.account-card>p{padding:0 16px 16px}}
</style>
