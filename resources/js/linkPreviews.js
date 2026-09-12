import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

export function previewTextParts(text, provider) {
    return (text || '').split(/(https?:\/\/[^\s<>"']+|(?<![\p{L}\p{N}_@./:-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+(?:[\p{L}]{2,63}|xn--[a-z0-9-]+)(?![\p{L}\p{N}_-])(?::\d{1,5})?(?:[/?#][^\s<>"']*)?|#[\p{L}\p{N}_]+)/giu).flatMap((value, index) => {
        if (!value) return [];
        if (index % 2 === 0) return [{ value }];
        if (value.startsWith('#')) return [{ value, link: true }];
        let url = value.replace(/[.,;:!?]+$/, '');
        while (url.endsWith(')') && (url.match(/\)/g) || []).length > (url.match(/\(/g) || []).length) url = url.slice(0, -1);
        const href = /^https?:\/\//i.test(url) ? url : 'https://' + url;
        try {
            const parsed = new URL(href);
            if (!parsed.hostname || parsed.username || parsed.password) return [{ value }];
        } catch { return [{ value }]; }
        let label = url;
        if (provider === 'x') {
            label = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
            if (label.length > 40) label = label.slice(0, 39) + '…';
        }
        return [{ value: label, link: true, url: href }, ...(url.length < value.length ? [{ value: value.slice(url.length) }] : [])];
    });
}

export function useLinkPreviews(props) {
    const cards = ref({});
    const urls = computed(() => ['x', 'threads', 'linkedin', 'linkedin_page', 'facebook', 'bluesky'].includes(props.account.provider)
        ? [...new Set(props.items.filter(item => !item.media_ids?.length).map(item => previewTextParts(item.text, props.account.provider).find(part => part.url)?.url).filter(Boolean))]
        : []);
    let stop;
    onMounted(() => {
        stop = watch(() => JSON.stringify([props.account.provider, ...urls.value]), (key, _, cleanup) => {
            const [provider, ...links] = JSON.parse(key);
            cards.value = {};
            const controller = new AbortController();
            const timer = setTimeout(async () => {
                await Promise.all(links.map(async url => {
                    try {
                        const response = await fetch('/local/linkPreview?' + new URLSearchParams({ url, provider }), { signal: controller.signal, headers: { Accept: 'application/json' } });
                        const data = response.ok ? await response.json() : null;
                        if (!controller.signal.aborted && data?.card) cards.value = { ...cards.value, [url]: data.card };
                    } catch { /* A failed lookup leaves the text link visible. */ }
                }));
            }, 500);
            cleanup(() => { clearTimeout(timer); controller.abort(); });
        }, { immediate: true });
    });
    onUnmounted(() => stop?.());
    function cardFor(item) {
        if (item.media_ids?.length) return null;
        const url = previewTextParts(item.text, props.account.provider).find(part => part.url)?.url;
        return cards.value[url] || null;
    }
    return { cardFor };
}
