<script setup>
import { useWorkspace } from './workspace.js';

const { busy, currentWorkspace, editWorkspace, signOut, state, syncing } = useWorkspace();
</script>

<template>
    <div class="page-heading">
        <div><h1>Settings</h1></div>
    </div>
    <section class="settings-content">
        <article class="settings-card">
            <h2>Workspace</h2>
            <p>
                <span aria-hidden="true">{{ currentWorkspace.icon }}</span>
                {{ currentWorkspace.name }}
            </p>
            <button class="outline" @click="editWorkspace()" :disabled="busy || syncing">
                Edit workspace
            </button>
        </article>
        <article class="settings-card">
            <h2>Account</h2>
            <p>{{ state.settings.email }}</p>
            <button class="outline" @click="signOut" :disabled="busy">Sign out</button>
        </article>
    </section>
</template>
