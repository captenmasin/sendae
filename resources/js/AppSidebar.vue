<script setup>
import { computed } from 'vue';
import Icon from './Icon.vue';
import WorkspaceAvatar from './WorkspaceAvatar.vue';
import { useWorkspace } from './workspace.js';

const props = defineProps({ pages: { type: Object, required: true } });
const navigation = computed(() => Object.entries(props.pages).filter(([name]) => name !== 'Settings'));

const {
    busy,
    currentWorkspace,
    editWorkspace,
    newDraft,
    page,
    queue,
    saving,
    state,
    switchWorkspace,
    syncing,
} = useWorkspace();
</script>

<template>
    <aside class="sidebar">
        <a href="#" class="brand" @click.prevent="page = 'Posts'">
            sendae
            <span>✳</span>
        </a>
        <div class="workspace-picker">
            <WorkspaceAvatar :workspace="currentWorkspace" />
            <select
                aria-label="Workspace"
                :value="currentWorkspace.id"
                @change="switchWorkspace"
                :disabled="busy || syncing || saving"
            >
                <option
                    v-for="workspace in state.settings.workspaces?.length
                        ? state.settings.workspaces
                        : [currentWorkspace]"
                    :key="workspace.id"
                    :value="workspace.id"
                >
                    {{ workspace.name }}
                </option>
            </select>
            <button
                class="icon-button"
                @click="editWorkspace(true)"
                :disabled="busy || syncing"
                aria-label="New workspace"
            >
                <Icon name="Plus" :size="16" />
            </button>
        </div>
        <button class="primary new-draft" @click="newDraft" :disabled="busy">
            <Icon name="Plus" :size="16" />
            <span>New post</span>
            <kbd>⌘ N</kbd>
        </button>
        <nav aria-label="Main navigation">
            <button
                v-for="[label, view] in navigation"
                :key="label"
                :aria-current="page === label ? 'page' : undefined"
                :class="{ active: page === label }"
                @click="page = label"
            >
                <span class="nav-icon"><Icon :name="view.icon" :size="16" /></span>
                {{ label }}
                <span v-if="label === 'Posts' || label === 'Queue'" class="count">
                    {{ label === 'Posts' ? state.drafts.length : queue.length }}
                </span>
            </button>
        </nav>
        <div class="sidebar-bottom">
            <button
                class="settings-nav"
                :class="{ active: page === 'Settings' }"
                :aria-current="page === 'Settings' ? 'page' : undefined"
                @click="page = 'Settings'"
            >
                <Icon name="Settings" :size="16" />
                <span>Settings</span>
            </button>
        </div>
    </aside>
</template>
