// Runs in the page MAIN world to mirror Suno API responses to the extension content script
(function() {
    'use strict';
    if (window.__pvSunoExtHooked) return;
    window.__pvSunoExtHooked = true;

    const origFetch = window.fetch;
    window.fetch = async function(...args) {
        const res = await origFetch.apply(this, args);
        try {
            const req = args[0];
            const url = typeof req === 'string' ? req : (req && typeof req.url === 'string' ? req.url : '');
            if (url && (
                url.includes('/a/api/') ||
                url.includes('/api/') ||
                url.includes('studio-api') ||
                url.includes('clip') ||
                url.includes('feed') ||
                url.includes('song')
            )) {
                res.clone().json().then(data => {
                    window.postMessage({ type: 'PV_SUNO_DATA', data }, '*');
                }).catch(() => {});
            }
        } catch (e) {}
        return res;
    };
})();
