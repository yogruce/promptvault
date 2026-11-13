// Suno AI Clean Metadata & Lyrics Downloader Content Script (v2.0)
(function() {
    'use strict';

    const songCache = {};

    function pickValidAudioUrl(obj) {
        const candidates = [obj.audio_url, obj.source_audio_url];
        if (Array.isArray(obj.media_urls)) {
            for (const m of obj.media_urls) {
                if (m && typeof m.url === 'string') candidates.push(m.url);
            }
        }
        return candidates.find(u =>
            typeof u === 'string' &&
            /^https?:\/\//i.test(u) &&
            !u.includes('/api/forbidden')
        ) || '';
    }

    function extractSongsFromData(obj, seen = new WeakSet()) {
        if (!obj || typeof obj !== 'object') return;
        if (seen.has(obj)) return;
        seen.add(obj);

        if (Array.isArray(obj)) {
            for (const item of obj) extractSongsFromData(item, seen);
            return;
        }

        if (typeof obj.id === 'string' && obj.id.length >= 8 &&
            (obj.metadata || obj.title || obj.major_model_version || obj.audio_url || obj.media_urls)) {
            const meta = (obj.metadata && typeof obj.metadata === 'object') ? obj.metadata : {};
            const rawTags = meta.tags || obj.display_tags || meta.display_tags || obj.tags || '';
            const rawGptPrompt = meta.gpt_description_prompt || '';
            const fullStyle = (typeof rawTags === 'string' && rawTags.trim())
                ? rawTags.trim()
                : (typeof rawGptPrompt === 'string' ? rawGptPrompt.trim() : '');

            const rawPrompt = (typeof meta.prompt === 'string' && !meta.prompt.startsWith('$'))
                ? meta.prompt
                : ((typeof obj.prompt === 'string' && !obj.prompt.startsWith('$')) ? obj.prompt : '');

            let modelName = obj.major_model_version || obj.model_name || '';
            if (meta.model_badges && meta.model_badges.songcard && meta.model_badges.songcard.display_name) {
                modelName = meta.model_badges.songcard.display_name;
            }

            const personaName = (obj.persona && typeof obj.persona.name === 'string') ? obj.persona.name.trim() : '';
            const creatorName = (typeof obj.display_name === 'string' && obj.display_name.trim())
                ? obj.display_name.trim()
                : ((typeof obj.handle === 'string') ? obj.handle.trim() : '');
            const audioUrl = pickValidAudioUrl(obj);
            const titleVal = (typeof obj.title === 'string' && !obj.title.startsWith('$')) ? obj.title.trim() : '';

            if (titleVal || fullStyle || rawPrompt || modelName || audioUrl) {
                const existing = songCache[obj.id] || {};
                songCache[obj.id] = {
                    id: obj.id,
                    title: titleVal || existing.title || '',
                    style: fullStyle || existing.style || '',
                    lyrics: rawPrompt || existing.lyrics || '',
                    model: modelName || existing.model || '',
                    persona: personaName || existing.persona || '',
                    artist: creatorName || existing.artist || '',
                    created_at: obj.created_at || existing.created_at || '',
                    audio_url: audioUrl || existing.audio_url || '',
                    make_instrumental: Boolean(meta.make_instrumental ?? existing.make_instrumental)
                };
            }
        }

        for (const key of Object.keys(obj)) {
            if (key === 'persona' || key === 'root_clip') continue;
            const val = obj[key];
            if (val && typeof val === 'object') {
                extractSongsFromData(val, seen);
            }
        }
    }

    // 1. AŞAMA: MAIN world interceptor'dan gelen API verilerini dinle
    window.addEventListener('message', (e) => {
        if (e.source === window && e.data && e.data.type === 'PV_SUNO_DATA' && e.data.data) {
            extractSongsFromData(e.data.data);
        }
    });

    // 2. AŞAMA: Doğrudan Suno API + Next.js RSC Script + Modern DOM Çıkarımı
    async function fetchSongFromApi(songId) {
        const origin = window.location.origin || 'https://suno.com';
        const endpoints = [
            { url: `${origin}/a/api/clip/${songId}`, credentials: 'include' },
            { url: `https://studio-api.prod.suno.com/api/clip/${songId}`, credentials: 'omit' },
            { url: `${origin}/a/api/feed/v2?ids=${songId}`, credentials: 'include' },
            { url: `${origin}/a/api/feed/?ids=${songId}`, credentials: 'include' }
        ];

        for (const ep of endpoints) {
            try {
                const res = await fetch(ep.url, { credentials: ep.credentials });
                if (res && res.ok) {
                    const data = await res.json();
                    extractSongsFromData(data);
                    const c = songCache[songId];
                    if (c && (c.style || c.lyrics)) return;
                }
            } catch (e) {}
        }
    }

    function decodeJsonStringLiteral(raw) {
        if (!raw) return '';
        try {
            return JSON.parse(`"${raw}"`);
        } catch (e) {
            return raw.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }
    }

    function extractJsonField(chunk, fieldName) {
        const re = new RegExp(`"${fieldName}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
        const m = chunk.match(re);
        return (m && m[1]) ? decodeJsonStringLiteral(m[1]) : '';
    }

    function extractFromNextScripts(songId) {
        const result = { title: '', style: '', lyrics: '', model: '', persona: '', artist: '', created_at: '' };
        try {
            const scripts = Array.from(document.querySelectorAll('script'));
            for (const s of scripts) {
                const rawText = s.textContent || '';
                if (!rawText.includes(songId)) continue;

                const payloads = [];
                if (rawText.includes(`"id":"${songId}"`)) {
                    payloads.push(rawText);
                }
                const strLitRegex = /"((?:[^"\\]|\\.)*)"/g;
                let match;
                while ((match = strLitRegex.exec(rawText)) !== null) {
                    if (match[1].length > 100 && match[1].includes(songId)) {
                        try {
                            const decoded = JSON.parse(`"${match[1]}"`);
                            if (typeof decoded === 'string' && decoded.includes(songId)) {
                                payloads.push(decoded);
                            }
                        } catch (e) {}
                    }
                }
                if (payloads.length === 0) {
                    payloads.push(rawText.replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
                }

                for (const text of payloads) {
                    const idIndex = text.indexOf(`"id":"${songId}"`);
                    const idx = idIndex !== -1 ? idIndex : text.indexOf(songId);
                    const chunk = idx !== -1
                        ? text.substring(Math.max(0, idx - 2000), idx + 12000)
                        : text;

                    const title = extractJsonField(chunk, 'title');
                    if (title && !title.startsWith('$') && !result.title) result.title = title.trim();

                    const tags = extractJsonField(chunk, 'tags') ||
                                 extractJsonField(chunk, 'display_tags') ||
                                 extractJsonField(chunk, 'gpt_description_prompt');
                    if (tags && !tags.startsWith('$') && !result.style) result.style = tags.trim();

                    const prompt = extractJsonField(chunk, 'prompt');
                    if (prompt && !prompt.startsWith('$') && !result.lyrics) result.lyrics = prompt.trim();

                    const model = extractJsonField(chunk, 'major_model_version') ||
                                  extractJsonField(chunk, 'model_name');
                    if (model && !result.model) result.model = model;

                    const badgeMatch = chunk.match(/"display_name"\s*:\s*"(V\d+[^"]*)"/i);
                    if (badgeMatch && badgeMatch[1]) result.model = badgeMatch[1];

                    const personaMatch = chunk.match(/"persona"\s*:\s*\{[^}]*"name"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                    if (personaMatch && personaMatch[1] && !result.persona) {
                        result.persona = decodeJsonStringLiteral(personaMatch[1]).trim();
                    }

                    const handle = extractJsonField(chunk, 'display_name') || extractJsonField(chunk, 'handle');
                    if (handle && !/^v\d+/i.test(handle) && !result.artist) result.artist = handle.trim();

                    const createdAt = extractJsonField(chunk, 'created_at');
                    if (createdAt && !result.created_at) result.created_at = createdAt;
                }
            }
        } catch (e) {}
        return result;
    }

    function extractFromDom() {
        let domTitle = '';
        let domArtist = '';
        let domStyle = '';
        let domLyrics = '';

        const h1 = document.querySelector('h1') || document.querySelector('[role="heading"][aria-level="1"]');
        if (h1 && (h1.innerText || h1.textContent)) {
            domTitle = (h1.innerText || h1.textContent).trim();
        } else {
            const rawDocTitle = document.querySelector('meta[property="og:title"]')?.content || document.title || '';
            domTitle = rawDocTitle
                .replace(/\s*\|\s*Suno.*$/i, '')
                .replace(/\s+by\s+[a-zA-Z0-9_.-]+$/i, '')
                .trim();
        }

        const userLink = Array.from(document.querySelectorAll('a[href^="/@"], a[href*="suno.com/@"]'))
            .find(a => (a.innerText || a.textContent || '').trim().length > 0);
        if (userLink) {
            domArtist = (userLink.innerText || userLink.textContent || '').replace(/^@/, '').trim();
        }

        const copyStylesBtn = document.querySelector('button[aria-label="Copy styles to clipboard"]');
        let styleScope = document;
        if (copyStylesBtn) {
            let p = copyStylesBtn.parentElement;
            for (let i = 0; i < 4 && p; i++) {
                if (p.querySelector('a[href^="/style/"]')) {
                    styleScope = p;
                    break;
                }
                p = p.parentElement;
            }
        }
        const styleLinks = Array.from(styleScope.querySelectorAll('a[href^="/style/"]'));
        if (styleLinks.length > 0) {
            const seen = new Set();
            const tags = [];
            for (const a of styleLinks) {
                const t = (a.getAttribute('title') || a.innerText || a.textContent || '').trim();
                if (t && !seen.has(t.toLowerCase())) {
                    seen.add(t.toLowerCase());
                    tags.push(t);
                }
            }
            if (tags.length > 0) domStyle = tags.join(', ');
        }

        if (!domStyle) {
            const ogDesc = document.querySelector('meta[property="og:description"]')?.content || '';
            if (ogDesc && !/Listen and make your own on Suno/i.test(ogDesc) && ogDesc.length > 5) {
                domStyle = ogDesc.trim();
            }
        }

        const lyricsCandidates = Array.from(document.querySelectorAll(
            '[role="tabpanel"] div.relative.font-sans, ' +
            '[data-testid*="lyrics"], [class*="lyrics"], [class*="Lyrics"], ' +
            'div.relative.font-sans.text-foreground-primary, pre'
        ));
        for (const el of lyricsCandidates) {
            const txt = (el.innerText || el.textContent || '').trim();
            if (txt && txt.length > 10 && txt.length < 15000 &&
                (txt.includes('[Verse') || txt.includes('[Chorus') || txt.includes('[Intro') ||
                 txt.includes('[Bridge') || txt.includes('[Outro') || txt.split('\n').length >= 3)) {
                domLyrics = txt;
                break;
            }
        }

        if (!domLyrics) {
            const containers = Array.from(document.querySelectorAll('main div, [role="tabpanel"] div, section div'));
            let bestLen = 0;
            for (const el of containers) {
                if (el.closest('nav, header, footer, [role="tablist"]')) continue;
                const txt = (el.innerText || '').trim();
                const lines = txt.split('\n').length;
                if ((txt.includes('[Verse') || txt.includes('[Chorus') || txt.includes('[Intro')) &&
                    lines >= 3 && txt.length < 8000 && txt.length > bestLen) {
                    bestLen = txt.length;
                    domLyrics = txt;
                }
            }
        }

        return { title: domTitle, artist: domArtist, style: domStyle, lyrics: domLyrics };
    }

    async function getSongData(songId) {
        let cached = songCache[songId] || {};

        if (!cached.style || !cached.lyrics || !cached.title || !cached.model) {
            await fetchSongFromApi(songId);
            cached = songCache[songId] || {};
        }

        const scriptData = (!cached.style || !cached.lyrics || !cached.title)
            ? extractFromNextScripts(songId)
            : { title: '', style: '', lyrics: '', model: '', persona: '', artist: '', created_at: '' };

        const domData = (!cached.style || !cached.lyrics || !cached.title)
            ? extractFromDom()
            : { title: '', artist: '', style: '', lyrics: '' };

        const finalStyle = (cached.style || scriptData.style || domData.style || '')
            .split('","')[0]
            .trim() || 'Bulunamadı';

        let finalLyrics = cached.lyrics || scriptData.lyrics || domData.lyrics || '';
        if (!finalLyrics) {
            finalLyrics = cached.make_instrumental ? '[Instrumental]' : 'Bulunamadı';
        }

        const finalTitle = cached.title || scriptData.title || domData.title || 'Suno_Sarki';
        const finalModel = cached.model || scriptData.model || 'Suno AI';
        const finalPersona = cached.persona || scriptData.persona || 'Yok';
        const finalArtist = cached.artist || scriptData.artist || domData.artist || '';
        const rawCreatedAt = cached.created_at || scriptData.created_at || '';

        return {
            id: songId,
            title: finalTitle,
            style: finalStyle,
            lyrics: finalLyrics,
            model: finalModel,
            persona: finalPersona,
            artist: finalArtist,
            created_at: rawCreatedAt ? new Date(rawCreatedAt).toLocaleString('tr-TR') : new Date().toLocaleString('tr-TR')
        };
    }

    // 3. AŞAMA: TXT Dosyası İndirme
    function downloadTextFile(song) {
        const safeTitle = song.title.replace(/[\\/:*?"<>|]/g, '_');
        const filename = `${safeTitle} [${song.id.substring(0, 8)}]_metadata.txt`;

        const headerLines = [
            `=========================================`,
            `ŞARKI ADI   : ${song.title}`,
            `ŞARKI ID    : ${song.id}`,
            `MODEL       : ${song.model}`
        ];

        if (song.persona && song.persona !== 'Yok') {
            headerLines.push(`PERSONA     : ${song.persona}`);
        } else if (song.artist) {
            headerLines.push(`SANATÇI     : ${song.artist}`);
        }

        headerLines.push(
            `TARİH       : ${song.created_at}`,
            `LİNK        : https://suno.com/song/${song.id}`,
            `=========================================`,
            ``,
            `[TAM STİL / PROMPT]`,
            `${song.style}`,
            ``,
            `[ŞARKI SÖZLERİ & META ETİKETLER]`,
            `${song.lyrics}`,
            `=========================================`
        );

        const content = headerLines.join('\n');
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function detectCurrentSongId() {
        const match = window.location.pathname.match(/\/song\/([a-f0-9-]{8,})/i);
        if (match && match[1]) return match[1];

        const playerLink = document.querySelector(
            'a[aria-label^="Playbar: Title for"][href*="/song/"], ' +
            'a[aria-label^="Playbar:"][href*="/song/"], ' +
            'footer a[href*="/song/"], ' +
            '[data-testid="player"] a[href*="/song/"]'
        );
        if (playerLink) {
            const href = playerLink.getAttribute('href') || playerLink.href || '';
            const pm = href.match(/\/song\/([a-f0-9-]{8,})/i);
            if (pm && pm[1]) return pm[1];
        }
        return '';
    }

    // 4. AŞAMA: Arayüz Butonu
    function createUI() {
        if (!document.body && !document.documentElement) return;
        if (document.getElementById('suno-meta-dl-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'suno-meta-dl-btn';
        btn.innerText = '📥 Tam Metadata İndir (.txt)';
        btn.style.cssText = `
            position: fixed;
            bottom: 90px;
            right: 20px;
            z-index: 999999;
            background: linear-gradient(135deg, #ff512f, #dd2476);
            color: white;
            border: none;
            padding: 12px 18px;
            border-radius: 8px;
            font-family: sans-serif;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            transition: transform 0.2s;
        `;

        btn.onmouseover = () => { btn.style.transform = 'scale(1.05)'; };
        btn.onmouseout = () => { btn.style.transform = 'scale(1)'; };

        btn.onclick = async () => {
            const songId = detectCurrentSongId();
            if (!songId) {
                alert('Lütfen önce indirmek istediğiniz şarkının detay sayfasına (suno.com/song/...) girin veya bir şarkı çalın!');
                return;
            }
            btn.innerText = '⏳ Çekiliyor...';
            btn.disabled = true;
            try {
                const data = await getSongData(songId);
                downloadTextFile(data);
            } finally {
                btn.innerText = '📥 Tam Metadata İndir (.txt)';
                btn.disabled = false;
            }
        };

        (document.body || document.documentElement).appendChild(btn);
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }
    setInterval(createUI, 2500);
})();
