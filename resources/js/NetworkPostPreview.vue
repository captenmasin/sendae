<script setup>
import { computed, ref } from 'vue';
import { previewTextParts, useLinkPreviews } from './linkPreviews.js';
import { BadgeCheck, Bookmark, ChartNoAxesColumn, Ellipsis, Globe, Heart, MessageCircle, Repeat2, Send, Share, ThumbsUp } from '@lucide/vue';

const props = defineProps({
    account: { type: Object, required: true },
    items: { type: Array, required: true },
    media: { type: Array, default: () => [] },
});
const failedAvatar = ref(null);
const expanded = ref(false);
const { cardFor } = useLinkPreviews(props);
const provider = computed(() => props.account.provider);
const isLinkedIn = computed(() => ['linkedin', 'linkedin_page'].includes(provider.value));
const isFeedCard = computed(() => isLinkedIn.value || provider.value === 'facebook');
const handle = computed(() => {
    const value = props.account.username || props.account.handle
        || (provider.value === 'bluesky' || props.account.name?.startsWith('@') ? props.account.name : '');
    return value ? '@' + value.replace(/^@/, '') : '';
});
const actions = computed(() => {
    if (provider.value === 'facebook') return [[ThumbsUp, 'Like'], [MessageCircle, 'Comment'], [Share, 'Share']];
    if (isLinkedIn.value) return [[ThumbsUp, 'Like'], [MessageCircle, 'Comment'], [Repeat2, 'Repost'], [Send, 'Send']];
    if (provider.value === 'threads') return [[Heart, 'Like'], [MessageCircle, 'Reply'], [Repeat2, 'Repost'], [Send, 'Share']];
    if (provider.value === 'bluesky') return [[MessageCircle, 'Reply'], [Repeat2, 'Repost'], [Heart, 'Like'], [Ellipsis, 'More']];
    return [[MessageCircle, 'Reply'], [Repeat2, 'Repost'], [Heart, 'Like'], [ChartNoAxesColumn, 'Views'], [Bookmark, 'Bookmark'], [Share, 'Share']];
});
function attachment(id) {
    return props.media.find((item) => item.id === id);
}
function visibleMedia(item) {
    return provider.value === 'threads' ? item.media_ids || [] : (item.media_ids || []).slice(0, 4);
}
function textParts(text, card) {
    const parts = previewTextParts(text, provider.value);
    if (provider.value === 'x' && card) {
        const firstLink = parts.findIndex(part => part.url);
        if (firstLink >= 0 && parts.slice(firstLink + 1).every(part => !part.value.trim())) {
            return parts.slice(0, firstLink).map((part, index) => index === firstLink - 1 ? { ...part, value: part.value.trimEnd() } : part);
        }
    }
    return parts;
}
function canCollapse(item) {
    return isFeedCard.value && (item.text?.length > 240 || item.text?.split('\n').length > 3);
}
</script>

<template>
    <div class="network-preview" :data-provider="provider" :class="{ 'feed-card': isFeedCard }">
        <article v-for="(item, index) in items" :key="index" class="network-post"
            :class="{ 'thread-continuation': index < items.length - 1 }" :aria-label="'Post ' + (index + 1) + ' preview'">
            <div class="network-avatar" :class="{ organization: provider === 'linkedin_page' }" aria-hidden="true">
                <img v-if="account.avatar_url && account.avatar_url !== failedAvatar" :src="account.avatar_url"
                    alt="" referrerpolicy="no-referrer" @error="failedAvatar = account.avatar_url" />
                <span v-else>{{ Array.from(account.name?.replace(/^@/, '') || '?')[0].toUpperCase() }}</span>
            </div>
            <div class="network-identity">
                <div class="network-author">
                    <strong>{{ account.name }}</strong>
                    <BadgeCheck v-if="account.verified" class="network-verified" :size="16" aria-label="Verified account" />
                    <span v-if="!isFeedCard && provider !== 'threads' && handle" class="network-handle">{{ handle }}</span>
                    <span v-if="!isFeedCard" class="network-time">·&nbsp; now</span>
                </div>
                <div v-if="isFeedCard" class="network-meta"><span>Just now</span><span>·</span><Globe :size="12" aria-label="Public" /></div>
            </div>
            <Ellipsis v-if="provider !== 'bluesky'" class="network-more" :size="20" aria-hidden="true" />
            <div class="network-content">
                <p v-if="item.text" class="network-text" :class="{ collapsed: canCollapse(item) && !expanded }">
                    <span v-for="(part, partIndex) in textParts(item.text, cardFor(item))" :key="partIndex" :class="{ 'network-link': part.link }" :title="part.url">{{ part.value }}</span>
                </p>
                <button v-if="canCollapse(item) && !expanded" class="network-expand" @click="expanded = true">{{ isLinkedIn ? '…more' : 'See more' }}</button>
                <div v-if="cardFor(item)" class="network-link-card" :class="{ large: cardFor(item).large }" aria-label="Website preview">
                    <img v-if="cardFor(item).image" :src="cardFor(item).image" alt="" />
                    <div class="network-link-details">
                        <span class="network-link-domain">{{ cardFor(item).domain }}</span>
                        <strong>{{ cardFor(item).title }}</strong>
                        <span v-if="cardFor(item).description" class="network-link-description">{{ cardFor(item).description }}</span>
                    </div>
                </div>
                <div v-if="item.media_ids?.length" class="network-media"
                    :class="{ single: item.media_ids.length === 1, triple: item.media_ids.length === 3, carousel: provider === 'threads' && item.media_ids.length > 1 }"
                    :aria-label="item.media_ids.length + ' attachments'">
                    <div v-for="(id, mediaIndex) in visibleMedia(item)" :key="id" class="network-media-item">
                        <video v-if="attachment(id)?.mime?.startsWith('video/')" :src="'/local/media/' + id" controls playsinline preload="metadata" :aria-label="attachment(id)?.name || 'Attached video'"></video>
                        <img v-else :src="'/local/media/' + id" :alt="attachment(id)?.name || 'Attached image'" />
                        <span v-if="provider !== 'threads' && mediaIndex === 3 && item.media_ids.length > 4" class="network-media-more">+{{ item.media_ids.length - 4 }}</span>
                    </div>
                </div>
                <div class="network-actions" aria-hidden="true">
                    <span v-for="[icon, label] in actions" :key="label" :title="label">
                        <component :is="icon" :size="isFeedCard ? 20 : 19" :stroke-width="1.7" />
                        <span v-if="isFeedCard">{{ label }}</span>
                    </span>
                </div>
            </div>
        </article>
    </div>
</template>

<style scoped>
.network-preview {
    --preview-bg: #fff;
    --preview-ink: #0f1419;
    --preview-muted: #536471;
    --preview-border: #e4e7e9;
    width: 100%; max-width: 600px; margin: 0 auto; overflow: hidden;
    background: var(--preview-bg); color: var(--preview-ink);
    border: 1px solid var(--preview-border); border-radius: 12px;
    font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.4;
}
.network-preview .network-post {
    display: grid; grid-template-columns: 40px minmax(0, 1fr) 20px; gap: 2px 10px;
    position: relative; padding: 14px 16px; margin: 0; border: 0; border-radius: 0;
    color: var(--preview-ink); font-size: inherit;
}
.network-post + .network-post { border-top: 1px solid var(--preview-border); }
.network-avatar { width: 40px; height: 40px; border-radius: 50%; overflow: hidden; display: grid; place-items: center; background: var(--preview-border); font-size: 18px; font-weight: 600; grid-row: 1 / 3; }
.network-avatar img { width: 100%; height: 100%; object-fit: cover; }
.network-avatar.organization { border-radius: 3px; }
.network-identity { min-width: 0; align-self: start; padding-top: 1px; }
.network-author { display: flex; align-items: center; gap: 4px; min-width: 0; }
.network-author strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 700; }
.network-verified { flex-shrink: 0; }
.network-handle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--preview-muted); }
.network-time { white-space: nowrap; color: var(--preview-muted); font-size: 14px; }
.network-meta { display: flex; align-items: center; gap: 4px; color: var(--preview-muted); font-size: 12px; padding-top: 2px; }
.network-more { color: var(--preview-muted); justify-self: end; }
.network-content { grid-column: 2 / -1; min-width: 0; }
.network-preview .network-text { font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; color: var(--preview-ink); }
.network-link { color: #1d9bf0; text-decoration: none; }
.network-preview[data-provider=linkedin] .network-link, .network-preview[data-provider=linkedin_page] .network-link { color: #0a66c2; }
.network-preview[data-provider=facebook] .network-link { color: #216fdb; }
.network-preview[data-provider=threads] .network-link { color: var(--preview-ink); text-decoration: underline; }
.network-link-card { display: flex; margin-top: 10px; border: 1px solid var(--preview-border); border-radius: 14px; overflow: hidden; }
.network-link-card > img { width: 120px; height: 120px; object-fit: cover; flex-shrink: 0; }
.network-link-card.large { flex-direction: column; }
.network-link-card.large > img { width: 100%; height: auto; aspect-ratio: 1.91; object-fit: cover; }
.network-link-details { min-width: 0; padding: 12px; display: flex; flex-direction: column; justify-content: center; gap: 3px; }
.network-link-details strong, .network-link-description { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.network-link-domain, .network-link-description { color: var(--preview-muted); font-size: 13px; }
.feed-card .network-link-card { margin-left: -16px; margin-right: -16px; border-left: 0; border-right: 0; border-radius: 0; }
.feed-card .network-link-details { background: var(--preview-border); }
.network-preview[data-provider=facebook] .network-link-domain { text-transform: uppercase; font-size: 12px; }
.network-preview[data-provider=linkedin] .network-link-domain, .network-preview[data-provider=linkedin_page] .network-link-domain { order: 1; }
.network-preview[data-provider=linkedin] .network-link-description, .network-preview[data-provider=linkedin_page] .network-link-description { display: none; }
.network-preview[data-provider=bluesky] .network-link-card { border-radius: 8px; }
.network-preview[data-provider=bluesky] .network-link-domain { order: 1; }
.network-text.collapsed { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.network-expand { color: var(--preview-muted); padding: 2px 0 0; font: inherit; font-size: 14px; }
.network-expand:hover { text-decoration: underline; }
.network-media { margin-top: 10px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px; border: 1px solid var(--preview-border); border-radius: 14px; overflow: hidden; aspect-ratio: 1.4; }
.network-media-item { min-height: 0; min-width: 0; position: relative; overflow: hidden; background: var(--preview-border); }
.network-media img, .network-media video { display: block; width: 100%; height: 100%; object-fit: cover; }
.network-media.single { display: block; aspect-ratio: auto; }
.network-media.single img, .network-media.single video { height: auto; max-height: 560px; object-fit: contain; }
.network-media.triple .network-media-item:first-child { grid-row: span 2; }
.network-media-more { position: absolute; inset: 0; display: grid; place-items: center; background: #0007; color: #fff; font-size: 30px; font-weight: 600; }
.network-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--preview-muted); padding-top: 14px; }
.network-actions > span { display: inline-flex; align-items: center; gap: 7px; }
.thread-continuation::after { content: ''; position: absolute; width: 2px; background: var(--preview-border); top: 59px; bottom: -10px; left: 35px; }
.thread-continuation + .network-post { border-top: 0; }
.network-preview[data-provider=bluesky] { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.network-preview[data-provider=bluesky] .network-post { gap: 4px 10px; }
.network-preview[data-provider=threads] { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.network-preview[data-provider=threads] .network-actions { justify-content: flex-start; gap: 22px; color: var(--preview-ink); }
.network-preview[data-provider=threads] .network-content { padding-top: 4px; }
.network-preview[data-provider=threads] .network-time { margin-left: 3px; }
.network-media.carousel { display: flex; gap: 6px; overflow-x: auto; border: 0; aspect-ratio: auto; scroll-snap-type: x mandatory; }
.network-media.carousel .network-media-item { flex: 0 0 85%; height: 300px; border-radius: 8px; scroll-snap-align: start; }
.network-preview.feed-card { border-radius: 8px; }
.feed-card .network-post { gap: 0 10px; padding: 16px 16px 0; }
.feed-card .network-avatar { grid-row: 1; }
.feed-card .network-content { grid-column: 1 / -1; padding-top: 12px; }
.feed-card .network-actions { border-top: 1px solid var(--preview-border); margin-top: 12px; padding: 13px 2px; justify-content: space-around; font-size: 13px; font-weight: 600; gap: 8px; }
.network-preview[data-provider=facebook] { font-family: Helvetica, Arial, sans-serif; }
.network-preview[data-provider=facebook] .network-media { margin-left: -16px; margin-right: -16px; border: 0; border-radius: 0; }
.network-preview[data-provider=linkedin], .network-preview[data-provider=linkedin_page] { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; }
.network-preview[data-provider=linkedin] .network-author strong, .network-preview[data-provider=linkedin_page] .network-author strong { font-size: 14px; }
.network-preview[data-provider=linkedin] .network-media, .network-preview[data-provider=linkedin_page] .network-media { margin-left: -16px; margin-right: -16px; border: 0; border-radius: 0; }
html[data-theme=dark] .network-preview { --preview-bg: #000; --preview-ink: #e7e9ea; --preview-muted: #969da3; --preview-border: #2f3336; }
html[data-theme=dark] .network-preview[data-provider=facebook] { --preview-bg: #242526; --preview-ink: #e4e6eb; --preview-muted: #b0b3b8; --preview-border: #3a3b3c; }
html[data-theme=dark] .network-preview[data-provider=linkedin], html[data-theme=dark] .network-preview[data-provider=linkedin_page] { --preview-bg: #1b1f23; --preview-ink: #ffffffe6; --preview-muted: #ffffffad; --preview-border: #ffffff26; }
html[data-theme=dark] .network-preview[data-provider=threads] { --preview-bg: #181818; --preview-ink: #f3f5f7; --preview-muted: #999; --preview-border: #333; }
html[data-theme=dark] .network-preview[data-provider=bluesky] { --preview-bg: #161e27; --preview-ink: #f1f3f5; --preview-muted: #9aa9b9; --preview-border: #2e4052; }
@media (max-width: 520px) { .network-handle { display: none; } .feed-card .network-actions > span { flex-direction: column; gap: 3px; font-size: 11px; } }
</style>
