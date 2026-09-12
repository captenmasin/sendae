<script setup>
import { computed } from 'vue';
import {
    Activity,
    ArrowUpRight,
    AtSign,
    BadgeCheck,
    CalendarDays,
    ChartColumn,
    ChevronLeft,
    ChevronRight,
    CircleAlert,
    CirclePlus,
    Clock,
    FileText,
    ImagePlus,
    Inbox,
    LogOut,
    Moon,
    Paperclip,
    Pencil,
    Plus,
    RefreshCw,
    Settings,
    Sun,
    Trash,
    Upload,
    X,
} from '@lucide/vue';

const icons = {
    Activity,
    ArrowUpRight,
    AtSign,
    BadgeCheck,
    CalendarDays,
    ChartColumn,
    ChevronLeft,
    ChevronRight,
    CircleAlert,
    CirclePlus,
    Clock,
    FileText,
    ImagePlus,
    Inbox,
    LogOut,
    Moon,
    Paperclip,
    Pencil,
    Plus,
    RefreshCw,
    Settings,
    Sun,
    Trash,
    Upload,
    X,
};

const props = defineProps({
    name: { type: String, required: true },
    size: { type: Number, default: 16 },
});
const icon = computed(() => icons[props.name]);
</script>

<template>
    <component :is="icon" :size="size" :stroke-width="1.6" aria-hidden="true" />
</template>
