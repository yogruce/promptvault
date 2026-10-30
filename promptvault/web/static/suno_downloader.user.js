// ==UserScript==
// @name         Suno AI Clean Metadata & Lyrics Downloader
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Suno AI şarkılarının TAM stil promptunu ve sözlerini JSON çöpü olmadan tertemiz .txt olarak indirir.
// @author       CustomScript
// @match        https://suno.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const songCache = {};

    // 1. AŞAMA: Arka plan API trafiğinden sadece ilgili şarkıyı yakala
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = args[0] ? args[0].toString() : '';
            if (url.includes('/api/') || url.includes('clip') || url.includes('feed') || url.includes('song')) {
                const clone = response.clone();
                clone.json().then(data => {
                    extractSongsFromData(data);
                }).catch(() => {});
            }
        } catch (e) {}
        return response;
    };

    function extractSongsFromData(obj) {
        if (!obj || typeof obj !== 'object') return;

        if (obj.id && obj.metadata && typeof obj.metadata === 'object') {
            const meta = obj.metadata;
            const fullStyle = meta.tags || meta.gpt_description_prompt || obj.display_tags || '';
            const lyricsText = (meta.prompt && !meta.prompt.startsWith('$')) ? meta.prompt : '';

            // Model adını bul (Örn: V6 veya v5)
            let modelName = obj.major_model_version || '';
            if (meta.model_badges && meta.model_badges.songcard && meta.model_badges.songcard.display_name) {
                modelName = meta.model_badges.songcard.display_name;
            }

            const personaName = (obj.persona && obj.persona.name) ? obj.persona.name : '';

            if (fullStyle || lyricsText) {
                const existing = songCache[obj.id] || {};
                songCache[obj.id] = {
                    id: obj.id,
                    title: obj.title || existing.title || '',
                    style: fullStyle || existing.style || '',
                    lyrics: lyricsText || existing.lyrics || '',
                    model: modelName || existing.model || 'Suno AI',
                    persona: personaName || existing.persona || '',
                    created_at: obj.created_at || existing.created_at || ''
                };
            }
        }

        for (const key in obj) {
            // Persona içindeki eski root_clip şarkısının verilerini ana şarkıyla karıştırmamak için atla
            if (key === 'persona') continue;
            if (typeof obj[key] === 'object') {
                extractSongsFromData(obj[key]);
            }
        }
    }

    // 2. AŞAMA: Sayfa kaynağından ve DOM'dan TERTEMİZ veriyi çekme
    async function getSongData(songId) {
        let scriptStyle = '';
        let scriptModel = '';
        let scriptPersona = '';
        let scriptCreatedAt = '';

        // A) Next.js script verilerinden SADECE bu songId'ye ait olan bloğu cımbızla çek
        try {
            const scripts = Array.from(document.querySelectorAll('script'));
            for (const s of scripts) {
                const rawText = s.textContent || '';
                if (!rawText.includes(songId)) continue;

                // Kaçış karakterlerini (\" -> ") normale çevir ki JSON çöpü oluşmasın
                const unescaped = rawText.replace(/\\"/g, '"').replace(/\\\\/g, '\\');

                // Sadece bu şarkının ID'sinin geçtiği yerden başlayarak 3500 karakterlik alanı tara (Persona şarkısına taşmasın)
                const idIndex = unescaped.indexOf(`"id":"${songId}"`);
                const targetChunk = idIndex !== -1
                    ? unescaped.substring(Math.max(0, idIndex - 500), idIndex + 3500)
                    : unescaped;

                // Tam stili ("tags":"...") tırnak içinde güvenle yakala
                const tagsMatch = targetChunk.match(/"tags"\s*:\s*"([^"]+)"/);
                if (tagsMatch && tagsMatch[1]) {
                    scriptStyle = tagsMatch[1].trim();
                }

                // Model sürümünü yakala (Örn: "display_name":"V6" veya "major_model_version":"v6")
                const badgeMatch = targetChunk.match(/"display_name"\s*:\s*"(V\d+[^"]*)"/i) || targetChunk.match(/"major_model_version"\s*:\s*"([^"]+)"/i);
                if (badgeMatch && badgeMatch[1]) {
                    scriptModel = badgeMatch[1].toUpperCase();
                }

                // Persona adını yakala
                const personaMatch = targetChunk.match(/"persona"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
                if (personaMatch && personaMatch[1]) {
                    scriptPersona = personaMatch[1].trim();
                }

                // Oluşturulma tarihini yakala
                const dateMatch = targetChunk.match(/"created_at"\s*:\s*"([^"]+)"/);
                if (dateMatch && dateMatch[1]) {
                    scriptCreatedAt = new Date(dateMatch[1]).toLocaleString('tr-TR');
                }
            }
        } catch (e) {}

        // B) DOM (Ekran) üzerinden Tam Stil Yakalama (Yedek ve Doğrulayıcı)
        const allElements = Array.from(document.querySelectorAll('div, p, span, a, button, pre, textarea'));
        let domStyle = '';

        const summaryToggleEl = allElements.find(el =>
            el.children.length === 0 &&
            el.innerText &&
            (el.innerText.includes('Show Summary') || el.innerText.includes('Hide Summary'))
        );

        if (summaryToggleEl) {
            if (summaryToggleEl.innerText.includes('Hide Summary')) {
                summaryToggleEl.click();
                await new Promise(r => setTimeout(r, 150));
            }

            let current = summaryToggleEl;
            for (let i = 0; i < 6; i++) {
                if (!current.parentElement) break;
                current = current.parentElement;

                const fullText = current.innerText || '';
                if (fullText.includes('Show Summary') || fullText.includes('Hide Summary')) {
                    const lines = fullText.split('\n').map(l => l.trim()).filter(l =>
                        l.length > 0 &&
                        !l.includes('Show Summary') &&
                        !l.includes('Hide Summary') &&
                        !l.includes('Add a Caption') &&
                        !l.includes('{"') // JSON kalıntılarını kesin olarak reddet
                    );
                    lines.sort((a, b) => b.length - a.length);
                    if (lines.length > 0 && lines[0].length > domStyle.length && lines[0].length < 1000) {
                        domStyle = lines[0];
                    }
                }
            }
        }

        // Stil adaylarından JSON içermeyen temiz ve tam olanı seç
        const cached = songCache[songId] || {};
        const cleanCandidates = [cached.style, scriptStyle, domStyle]
            .filter(Boolean)
            .map(s => s.split('","')[0].trim()) // Her ihtimale karşı JSON sızıntısı varsa kes
            .filter(s => s.length > 5 && !s.includes('{"'));

        cleanCandidates.sort((a, b) => b.length - a.length);
        const finalStyle = cleanCandidates[0] || 'Bulunamadı';

        // C) Şarkı Adını Temizle ("by kullanıcı_adı" ve "| Suno" kısımlarını at)
        const titleEl = document.querySelector('h1') || document.querySelector('title');
        let rawTitle = cached.title || (titleEl ? titleEl.innerText : 'Suno_Sarki');
        rawTitle = rawTitle
            .replace(/\s*\|\s*Suno.*$/i, '')
            .replace(/\s+by\s+[a-zA-Z0-9_.-]+$/i, '')
            .trim();

        // D) Şarkı Sözlerini (Lyrics) Yakala
        let lyrics = cached.lyrics || 'Bulunamadı';
        if (lyrics === 'Bulunamadı' || lyrics.startsWith('$')) {
            let maxNewlines = 0;
            allElements.forEach(el => {
                if (el.children.length === 0 && el.innerText) {
                    const txt = el.innerText.trim();
                    const lines = txt.split('\n').length;
                    if (lines > maxNewlines && lines > 3 && !txt.includes('Create') && !txt.includes('Library') && txt !== finalStyle && !txt.includes('{"')) {
                        maxNewlines = lines;
                        lyrics = txt;
                    }
                }
            });

            if (lyrics === 'Bulunamadı' || lyrics.startsWith('$')) {
                const containers = Array.from(document.querySelectorAll('div, pre, textarea'));
                containers.forEach(el => {
                    const txt = (el.innerText || '').trim();
                    const lines = txt.split('\n').length;
                    if ((txt.includes('[Verse') || txt.includes('[Chorus') || txt.includes('[Intro')) && lines > maxNewlines && txt.length < 6000) {
                        if (!txt.includes('Show Summary') && !txt.includes('Add a Caption') && !txt.includes('{"')) {
                            maxNewlines = lines;
                            lyrics = txt;
                        }
                    }
                });
            }
        }

        return {
            id: songId,
            title: rawTitle,
            style: finalStyle,
            lyrics: lyrics,
            model: cached.model || scriptModel || 'Suno AI',
            persona: cached.persona || scriptPersona || 'Yok',
            created_at: (cached.created_at ? new Date(cached.created_at).toLocaleString('tr-TR') : '') || scriptCreatedAt || new Date().toLocaleString('tr-TR')
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

    // 4. AŞAMA: Arayüz Butonu
    function createUI() {
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

        btn.onmouseover = () => btn.style.transform = 'scale(1.05)';
        btn.onmouseout = () => btn.style.transform = 'scale(1)';

        btn.onclick = async () => {
            const match = window.location.pathname.match(/\/song\/([a-f0-9-]+)/i);
            if (match && match[1]) {
                const songId = match[1];
                const data = await getSongData(songId);
                downloadTextFile(data);
            } else {
                alert('Lütfen önce indirmek istediğiniz şarkının detay sayfasına (suno.com/song/...) girin!');
            }
        };

        document.body.appendChild(btn);
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }
})();
