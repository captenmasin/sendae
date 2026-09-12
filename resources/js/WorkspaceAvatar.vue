<script setup>
import { computed } from 'vue';

const props = defineProps({
    workspace: { type: Object, required: true },
    size: { type: Number, default: 30 },
});
const letter = computed(() => {
    const name = (props.workspace?.name || '').trim();
    return (name && Array.from(name)[0].toUpperCase()) || '?';
});
const imageSrc = computed(() => {
    if (!props.workspace?.has_image || !props.workspace?.id) return '';
    const stamp = props.workspace.updated_at || '';
    return '/local/workspaceImage/' + props.workspace.id + (stamp ? '?v=' + encodeURIComponent(stamp) : '');
});
</script>

<template>
    <span class="workspace-avatar" :style="{ width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.45) + 'px' }" aria-hidden="true">
        <img v-if="imageSrc" :src="imageSrc" alt="" />
        <span v-else>{{ letter }}</span>
    </span>
</template>

<style scoped>
.workspace-avatar {
    flex-shrink: 0;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-weight: 600;
    line-height: 1;
}
</style>
