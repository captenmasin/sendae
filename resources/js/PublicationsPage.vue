<script setup>
import { computed, ref } from 'vue';
import AccountLogo from './AccountLogo.vue';
import Icon from './Icon.vue';
import { useWorkspace } from './workspace.js';

const {
    accountFor,
    busy,
    canReschedule,
    cancel,
    date,
    deletePublication,
    history,
    localDateTime,
    openPost,
    openRecovery,
    page,
    postUrl,
    postTitle,
    publicationStatus,
    queue,
    reschedule,
    state,
    syncing,
} = useWorkspace();

const view = ref('calendar');
const month = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
const selectedDay = ref(null);
const draggedPost = ref(null);
const dragOverDay = ref(null);
const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const dayLabel = (day) => day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const time = (value) => new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const monthLabel = computed(() => month.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
const publicationsByDay = computed(() => {
    const days = new Map();
    for (const publication of queue.value) {
        if (!publication.scheduled_at) continue;
        const day = new Date(publication.scheduled_at);
        if (!Number.isFinite(day.getTime())) continue;
        const key = day.toDateString();
        if (!days.has(key)) days.set(key, []);
        days.get(key).push(publication);
    }
    return days;
});
const calendarDays = computed(() => {
    const year = month.value.getFullYear();
    const monthIndex = month.value.getMonth();
    const offset = (month.value.getDay() + 6) % 7;
    const length = Math.ceil((offset + new Date(year, monthIndex + 1, 0).getDate()) / 7) * 7;
    return Array.from({ length }, (_, index) => {
        const day = new Date(year, monthIndex, index - offset + 1);
        return {
            date: day,
            key: day.toDateString(),
            outside: day.getMonth() !== monthIndex,
            publications: publicationsByDay.value.get(day.toDateString()) || [],
        };
    });
});
const publications = computed(() => {
    if (page.value !== 'Queue') return history.value;
    if (view.value === 'calendar' && selectedDay.value) {
        return publicationsByDay.value.get(selectedDay.value.toDateString()) || [];
    }
    return queue.value;
});

function changeMonth(offset) {
    month.value = new Date(month.value.getFullYear(), month.value.getMonth() + offset, 1);
    selectedDay.value = null;
}

function showToday() {
    selectedDay.value = new Date();
    month.value = new Date(selectedDay.value.getFullYear(), selectedDay.value.getMonth(), 1);
}

function clearDrag() {
    draggedPost.value = null;
    dragOverDay.value = null;
}

function startDrag(event, publication) {
    if (busy.value || syncing.value || !canReschedule(publication)) {
        event.preventDefault();
        return;
    }
    draggedPost.value = { id: publication.id, workspaceId: state.value.settings.workspace_id };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', publication.id);
}

async function dropOnDay(day) {
    const dragged = draggedPost.value;
    clearDrag();
    if (!dragged || dragged.workspaceId !== state.value.settings.workspace_id || page.value !== 'Queue') return;
    const publication = queue.value.find((p) => p.id === dragged.id);
    if (!publication || busy.value || syncing.value || !canReschedule(publication)) return;
    const original = new Date(publication.scheduled_at);
    if (original.toDateString() === day.key) return;
    const at = localDateTime(day.date).slice(0, 10) + localDateTime(original).slice(10);
    if (await reschedule(publication, at)) selectedDay.value = day.date;
}
</script>

<template>
    <div class="page-heading publications-heading">
        <div>
            <h1>{{ page === 'Queue' ? 'Queue' : 'Published' }}</h1>
        </div>
        <div v-if="page === 'Queue'" class="schedule-views" role="group" aria-label="Schedule view">
            <button class="outline" :aria-pressed="view === 'calendar'" @click="view = 'calendar'">Calendar</button>
            <button class="outline" :aria-pressed="view === 'list'" @click="view = 'list'">List</button>
        </div>
    </div>
    <section class="content-section">
        <template v-if="page === 'Queue' && view === 'calendar'">
            <div class="calendar-toolbar">
                <div>
                    <h2 id="calendar-month" aria-live="polite">{{ monthLabel }}</h2>
                    <p>Times in {{ localTimezone }}</p>
                </div>
                <div class="calendar-navigation">
                    <button class="outline" aria-label="Previous month" @click="changeMonth(-1)"><Icon name="ChevronLeft" :size="16" /></button>
                    <button class="outline" @click="showToday">Today</button>
                    <button class="outline" aria-label="Next month" @click="changeMonth(1)"><Icon name="ChevronRight" :size="16" /></button>
                </div>
            </div>
            <div class="calendar-scroll" role="region" aria-labelledby="calendar-month" tabindex="0">
                <table class="schedule-calendar" aria-labelledby="calendar-month">
                    <thead>
                        <tr><th v-for="day in ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']" :key="day" scope="col">{{ day }}</th></tr>
                    </thead>
                    <tbody>
                        <tr v-for="week in calendarDays.length / 7" :key="week">
                            <td v-for="day in calendarDays.slice((week - 1) * 7, week * 7)" :key="day.key" :class="{ 'outside-month': day.outside }">
                                <div
                                    class="calendar-day"
                                    :class="{ selected: selectedDay?.toDateString() === day.key, 'drag-over': draggedPost && dragOverDay === day.key }"
                                    role="group"
                                    :aria-label="dayLabel(day.date) + ', ' + day.publications.length + ' queued posts'"
                                    :aria-current="day.key === new Date().toDateString() ? 'date' : undefined"
                                    @click="selectedDay = day.date"
                                    @dragover.prevent="draggedPost && (dragOverDay = day.key)"
                                    @dragleave.self="dragOverDay = null"
                                    @drop.prevent="dropOnDay(day)"
                                >
                                    <button class="calendar-day-number" :aria-label="dayLabel(day.date)" :aria-pressed="selectedDay?.toDateString() === day.key" @click.stop="selectedDay = day.date">{{ day.date.getDate() }}</button>
                                    <button
                                        v-for="p in day.publications.slice(0, 2)" :key="p.id" class="calendar-post"
                                        :aria-label="'Change date and time for ' + postTitle(p) + ', ' + (accountFor(p)?.name || 'Disconnected account') + ', ' + time(p.scheduled_at)"
                                        :draggable="canReschedule(p) && !busy && !syncing"
                                        :disabled="!canReschedule(p) || busy || syncing"
                                        @click.stop="openRecovery(p)"
                                        @dragstart="startDrag($event, p)"
                                        @dragend="clearDrag"
                                    >
                                        <span>{{ time(p.scheduled_at) }} · {{ accountFor(p)?.name || 'Disconnected account' }}</span>
                                        <strong>{{ postTitle(p) }}</strong>
                                    </button>
                                    <button v-if="day.publications.length > 2" class="calendar-more" @click.stop="selectedDay = day.date">+{{ day.publications.length - 2 }} more</button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div class="calendar-agenda-heading">
                <h2 aria-live="polite">{{ selectedDay ? dayLabel(selectedDay) : 'All queued posts' }}</h2>
                <button v-if="selectedDay" class="text-button" @click="selectedDay = null">Show all queued posts</button>
            </div>
        </template>
        <div v-for="p in publications" :key="p.id" class="publication-row">
            <AccountLogo :account="accountFor(p)" :size="42" />
            <div class="publication-main">
                <h3>{{ postTitle(p) }}</h3>
                <p>{{ accountFor(p)?.name || 'Disconnected account' }} · Scheduled: {{ date(p.scheduled_at) }}</p>
                <p v-if="p.error" class="error-text">{{ p.error }}</p>
                <div v-if="p.receipts?.length" class="receipt-links">
                    <small>{{ p.receipts.length }} confirmed post(s)</small>
                    <template v-for="(id, index) in p.receipts" :key="id">
                        <a
                            v-if="postUrl(p, id)"
                            :href="postUrl(p, id)"
                            class="outline"
                            @click.prevent="openPost(p, id)"
                            @auxclick.middle.prevent="openPost(p, id)"
                            target="_blank"
                            rel="noopener"
                        >
                            View post{{ p.receipts.length > 1 ? ' ' + (index + 1) : '' }} ↗
                        </a>
                        <code v-else>{{ id }}</code>
                    </template>
                </div>
            </div>
            <span class="tag" :class="p.status">{{ publicationStatus(p) }}</span>
            <button v-if="canReschedule(p)" class="outline" @click="openRecovery(p)" :disabled="busy || syncing">Change date & time</button>
            <button
                v-if="['failed', 'missed', 'uncertain', 'cancelled'].includes(p.status)"
                class="outline"
                @click="openRecovery(p)"
            >
                Recover
            </button>
            <button
                v-if="p.status === 'cancelled'"
                class="outline"
                @click="deletePublication(p)"
                :disabled="busy"
            >
                Delete
            </button>
            <button
                v-if="['scheduled', 'retry', 'failed', 'missed'].includes(p.status)"
                class="outline"
                @click="cancel(p)"
                :disabled="busy"
            >
                Cancel
            </button>
        </div>
        <div v-if="page === 'Queue' && view === 'calendar' && selectedDay && !publications.length" class="empty calendar-empty">
            <p>No queued posts for this day.</p>
        </div>
        <div v-else-if="!publications.length" class="empty">
            <div class="empty-art"><Icon :name="page === 'Queue' ? 'Clock' : 'ArrowUpRight'" :size="36" /></div>
            <h2>{{ page === 'Queue' ? 'No queued posts' : 'No publications' }}</h2>
            <p>
                {{
                    page === 'Queue'
                        ? 'Schedule a draft for a specific time or add it to your weekly queue.'
                        : 'Published posts and failed attempts appear here.'
                }}
            </p>
            <button class="outline" @click="page = 'Posts'">Back to posts</button>
        </div>
    </section>
</template>

<style scoped>
.publications-heading { flex-wrap: wrap; }
.schedule-views, .calendar-navigation { display: flex; gap: 6px; }
.schedule-views [aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: white; }
.calendar-toolbar, .calendar-agenda-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
.calendar-toolbar { margin-bottom: 20px; }
.calendar-toolbar h2 { font-size: 20px; }
.calendar-toolbar p { margin-top: 6px; font-size: 11px; color: var(--muted); }
.calendar-navigation .outline { min-width: 38px; }
.calendar-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
.calendar-scroll:focus-visible { outline: 2px solid #c0c0c0; outline-offset: 3px; }
.schedule-calendar { width: 100%; min-width: 630px; table-layout: fixed; border-collapse: collapse; background: white; }
.schedule-calendar th { padding: 12px; text-align: left; font-size: 11px; font-weight: 500; color: var(--muted); background: var(--paper); }
.schedule-calendar td { padding: 0; vertical-align: top; border-top: 1px solid var(--border); border-right: 1px solid var(--border); }
.schedule-calendar td:last-child { border-right: 0; }
.calendar-day { width: 100%; min-height: 140px; padding: 10px; display: flex; flex-direction: column; gap: 7px; text-align: left; }
.calendar-day:hover { background: var(--paper); }
.calendar-day.selected, .calendar-day.drag-over { background: #ededed; box-shadow: inset 0 0 0 1px #888; }
.calendar-day:focus-visible { outline-offset: -3px; }
.calendar-day-number { display: grid; place-items: center; width: 25px; height: 25px; font-size: 12px; border-radius: 50%; }
.calendar-day[aria-current="date"] .calendar-day-number { background: var(--accent); color: white; }
.outside-month { background: var(--paper); }
.outside-month .calendar-day-number { color: var(--muted); }
.calendar-post { display: grid; gap: 3px; width: 100%; border-left: 2px solid #aaa; padding: 4px 0 4px 6px; text-align: left; border-radius: 3px; }
.calendar-post:hover:not(:disabled) { background: #e5e5e5; }
.calendar-post[draggable="true"] { cursor: grab; }
.calendar-post[draggable="true"]:active { cursor: grabbing; }
.calendar-post:disabled { cursor: default; }
.calendar-post span, .calendar-post strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.calendar-post span, .calendar-more { color: var(--muted); font-size: 10px; }
.calendar-post strong { font-size: 11px; font-weight: 500; }
.calendar-agenda-heading { margin-top: 28px; }
.calendar-agenda-heading h2 { font-size: 16px; letter-spacing: 0; }
.calendar-agenda-heading .text-button { font-size: 11px; }
.calendar-empty { padding: 28px; }
</style>
