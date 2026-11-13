// ==UserScript==
// @name         PromptVault Universal Clipper (1-Click Send to Vault)
// @namespace    http://tampermonkey.net/
// @version      1.4.0
// @description  ChatGPT, Google Gemini, Flow/ImageFX ve Suno AI'dan tek tuşla görsel, tam prompt, şarkı ve sözleri yerel PromptVault kasasına aktarır. (Chrome, Edge, Firefox uyumlu)
// @author       PromptVault
// @match        *://gemini.google.com/*
// @match        *://*.gemini.google.com/*
// @match        *://aistudio.google.com/*
// @match        *://*.aistudio.google.com/*
// @match        *://chatgpt.com/*
// @match        *://*.chatgpt.com/*
// @match        *://suno.com/*
// @match        *://*.suno.com/*
// @match        *://app.suno.ai/*
// @match        *://labs.google/*
// @match        *://*.labs.google/*
// @match        *://aitestkitchen.withgoogle.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @connect      127.0.0.1
// @connect      localhost
// @connect      suno.com
// @connect      studio-api.prod.suno.com
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function() {
  'use strict';

  const VAULT_URL = 'http://127.0.0.1:7860';
  const songCache = {};

  function extractSunoReqUrl(input) {
    if (!input) return '';
    if (typeof input === 'string') return input;
    if (typeof input.url === 'string') return input.url;
    try { return String(input); } catch (e) { return ''; }
  }

  function isSunoApiUrl(url) {
    return Boolean(url && (
      url.includes('/a/api/') ||
      url.includes('/api/') ||
      url.includes('studio-api') ||
      url.includes('clip') ||
      url.includes('feed') ||
      url.includes('song')
    ));
  }

  function pickValidSunoAudioUrl(obj) {
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

  // ===================================================================
  // 1. SUNO AI: GELİŞMİŞ ÇİFT KATMANLI VERİ YAKALAMA (Chrome, Edge, Firefox)
  // ===================================================================
  if (window.location.hostname.includes('suno.com') || window.location.hostname.includes('suno.ai')) {
    // A) Tampermonkey Sandbox / UnsafeWindow katmanı
    const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    if (win) {
      try {
        const origFetch = win.fetch;
        win.fetch = async function(...args) {
          const res = await origFetch.apply(this, args);
          try {
            const url = extractSunoReqUrl(args[0]);
            if (isSunoApiUrl(url)) {
              res.clone().json().then(data => {
                extractSongsFromData(data);
              }).catch(() => {});
            }
          } catch (e) {}
          return res;
        };
      } catch (e) {}
    }

    // B) Sayfa Ana Dünyasına (Main World) Doğrudan Script Enjeksiyonu (Manifest V3 Chromium Uyumlu)
    try {
      const injectScript = document.createElement('script');
      injectScript.textContent = `
        (function() {
          if (window.__pvClipperSunoHooked) return;
          window.__pvClipperSunoHooked = true;
          const orig = window.fetch;
          window.fetch = async function(...args) {
            const r = await orig.apply(this, args);
            try {
              const req = args[0];
              const u = typeof req === 'string' ? req : (req && req.url ? req.url : '');
              if (u && (u.includes('/a/api/') || u.includes('/api/') || u.includes('studio-api') || u.includes('clip') || u.includes('feed') || u.includes('song'))) {
                r.clone().json().then(d => {
                  window.postMessage({ type: 'PV_SUNO_DATA', data: d }, '*');
                }).catch(() => {});
              }
            } catch(e) {}
            return r;
          };
        })();
      `;
      (document.head || document.documentElement).appendChild(injectScript);
      injectScript.remove();
    } catch (e) {}

    // Ana dünyadan gelen mesajları dinle
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'PV_SUNO_DATA' && e.data.data) {
        extractSongsFromData(e.data.data);
      }
    });
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

      const lyricsText = (typeof meta.prompt === 'string' && !meta.prompt.startsWith('$'))
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
      const audioUrl = pickValidSunoAudioUrl(obj);
      const titleVal = (typeof obj.title === 'string' && !obj.title.startsWith('$')) ? obj.title.trim() : '';

      if (titleVal || fullStyle || lyricsText || modelName || audioUrl) {
        const existing = songCache[obj.id] || {};
        songCache[obj.id] = {
          id: obj.id,
          title: titleVal || existing.title || '',
          style: fullStyle || existing.style || '',
          lyrics: lyricsText || existing.lyrics || '',
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

  // ===================================================================
  // 2. ORTAK YARDIMCI FONKSİYONLAR
  // ===================================================================

  // Güvenli Body Hazır Olma Bekleyicisi (document-start için)
  function whenBodyReady(fn) {
    if (document.body) {
      fn();
    } else {
      const check = setInterval(() => {
        if (document.body) {
          clearInterval(check);
          fn();
        }
      }, 50);
      document.addEventListener('DOMContentLoaded', () => {
        clearInterval(check);
        if (document.body) fn();
      }, { once: true });
    }
  }

  // Floating Toast Bildirimi
  function showToast(msg, isSuccess = true) {
    whenBodyReady(() => {
      let t = document.getElementById('pv-clipper-toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'pv-clipper-toast';
        t.style.cssText = `
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 2147483647;
          background: #18181b;
          color: #fff;
          padding: 12px 18px;
          border-radius: 8px;
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 13.5px;
          box-shadow: 0 8px 30px rgba(0,0,0,0.55);
          border: 1px solid ${isSuccess ? '#10b981' : '#ef4444'};
          display: flex;
          align-items: center;
          gap: 10px;
          transition: opacity 0.25s, transform 0.25s;
          opacity: 0;
          transform: translateY(10px);
          pointer-events: none;
        `;
        (document.body || document.documentElement).appendChild(t);
      }
      t.innerHTML = `${isSuccess ? '✅' : '❌'} <span>${msg}</span>`;
      t.style.borderColor = isSuccess ? '#10b981' : '#ef4444';
      t.style.opacity = '1';
      t.style.transform = 'translateY(0)';
      clearTimeout(t._tm);
      t._tm = setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateY(10px)';
      }, 4000);
    });
  }

  // PromptVault API İstek Gönderici (GM_xmlhttpRequest - Mixed Content ve CORS'u aşar)
  function sendToVault(endpoint, payload, onSuccess, onError) {
    if (typeof GM_xmlhttpRequest !== 'undefined') {
      GM_xmlhttpRequest({
        method: 'POST',
        url: `${VAULT_URL}/api/quick-import/${endpoint}`,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(payload),
        timeout: 25000,
        onload: function(res) {
          if (res.status >= 200 && res.status < 300) {
            try {
              const data = JSON.parse(res.responseText);
              onSuccess(data);
            } catch (e) {
              onSuccess({ ok: true });
            }
          } else {
            let err = `Hata (${res.status})`;
            try {
              const j = JSON.parse(res.responseText);
              if (j.detail) err = j.detail;
            } catch {}
            onError(err);
          }
        },
        onerror: function() {
          onError('PromptVault sunucusuna ulaşılamadı! Programın açık (http://127.0.0.1:7860) olduğundan emin olun.');
        },
        ontimeout: function() {
          onError('İstek zaman aşımına uğradı.');
        }
      });
    } else {
      // Standart fetch yedeği
      fetch(`${VAULT_URL}/api/quick-import/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(r => r.json())
      .then(onSuccess)
      .catch(e => onError('Sunucuya ulaşılamadı: ' + e.message));
    }
  }

  // Güvenli Görsel -> Base64 Data URL Çevirici
  async function imageToDataUrl(imgElement) {
    if (!imgElement) return null;
    const src = imgElement.src || '';
    if (src.startsWith('data:image/')) return src;

    // 1. Blob URL ise sayfa içinden fetch ile anında al
    if (src.startsWith('blob:')) {
      try {
        const res = await fetch(src);
        const blob = await res.blob();
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (e) {}
    }

    // 2. HTTP/HTTPS URL ise GM_xmlhttpRequest ile CORS engelini aşarak al
    if (src.startsWith('http://') || src.startsWith('https://')) {
      try {
        const b64 = await new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'GET',
            url: src,
            responseType: 'blob',
            timeout: 15000,
            onload: function(res) {
              if (res.status >= 200 && res.status < 300 && res.response) {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(res.response);
              } else {
                reject(new Error('Status: ' + res.status));
              }
            },
            onerror: reject,
            ontimeout: reject
          });
        });
        if (b64 && b64.startsWith('data:image/')) return b64;
      } catch (e) {}
    }

    // 3. Canvas yedeği
    try {
      const canvas = document.createElement('canvas');
      canvas.width = imgElement.naturalWidth || imgElement.width || 512;
      canvas.height = imgElement.naturalHeight || imgElement.height || 512;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgElement, 0, 0);
      return canvas.toDataURL('image/png');
    } catch (e) {
      return src;
    }
  }

  // Buton Oluşturucu
  function createVaultButton(title = '⚡ Vault\'a Gönder', small = false) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pv-vault-btn';
    btn.innerHTML = title;
    btn.style.cssText = `
      background: linear-gradient(135deg, #7c3aed, #4f46e5);
      color: #ffffff;
      border: 0;
      border-radius: ${small ? '4px' : '6px'};
      padding: ${small ? '4px 8px' : '6px 12px'};
      font-size: ${small ? '11px' : '12px'};
      font-weight: 600;
      font-family: system-ui, -apple-system, sans-serif;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.45);
      transition: transform 0.15s, filter 0.15s;
      user-select: none;
      line-height: 1.2;
    `;
    btn.onmouseenter = () => {
      btn.style.filter = 'brightness(1.18)';
      btn.style.transform = 'scale(1.03)';
    };
    btn.onmouseleave = () => {
      btn.style.filter = 'brightness(1.0)';
      btn.style.transform = 'scale(1)';
    };
    return btn;
  }

  // ===================================================================
  // 3. SUNO AI ENTEGRASYONU (suno.com)
  // ===================================================================
  function initSuno() {
    if (!window.location.hostname.includes('suno.com') && !window.location.hostname.includes('suno.ai')) return;

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

    // Şarkı Verilerini Çıkar (Cache + Dahili API Doğrudan Çağrı + Next.js RSC + DOM)
    async function getSongData(songId) {
      let cached = songCache[songId] || {};

      // 1. Suno güncel API'lerini tara (/a/api/clip, studio-api, /a/api/feed/v2)
      if (!cached.style || !cached.lyrics || !cached.title || !cached.model || cached.style === 'Stil belirtilmemiş') {
        const origin = window.location.origin || 'https://suno.com';
        const endpoints = [
          { url: `${origin}/a/api/clip/${songId}`, credentials: 'include' },
          { url: `https://studio-api.prod.suno.com/api/clip/${songId}`, credentials: 'omit' },
          { url: `${origin}/a/api/feed/v2?ids=${songId}`, credentials: 'include' },
          { url: `${origin}/a/api/feed/?ids=${songId}`, credentials: 'include' }
        ];
        const fetchFn = (typeof unsafeWindow !== 'undefined' && unsafeWindow.fetch)
          ? unsafeWindow.fetch.bind(unsafeWindow)
          : window.fetch.bind(window);
        for (const ep of endpoints) {
          try {
            const apiRes = await fetchFn(ep.url, { credentials: ep.credentials });
            if (apiRes && apiRes.ok) {
              const data = await apiRes.json();
              extractSongsFromData(data);
              cached = songCache[songId] || cached;
              if (cached.style && cached.lyrics) break;
            }
          } catch (e) {}
        }
      }

      // 2. Next.js RSC Script chunk tarama (Yedek)
      if (!cached.style || !cached.lyrics || !cached.title) {
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
              const chunk = idx !== -1 ? text.substring(Math.max(0, idx - 2000), idx + 12000) : text;

              const title = extractJsonField(chunk, 'title');
              if (title && !title.startsWith('$') && !cached.title) cached.title = title.trim();

              const tags = extractJsonField(chunk, 'tags') ||
                           extractJsonField(chunk, 'display_tags') ||
                           extractJsonField(chunk, 'gpt_description_prompt');
              if (tags && !tags.startsWith('$') && !cached.style) cached.style = tags.trim();

              const prompt = extractJsonField(chunk, 'prompt');
              if (prompt && !prompt.startsWith('$') && !cached.lyrics) cached.lyrics = prompt.trim();

              const model = extractJsonField(chunk, 'major_model_version') || extractJsonField(chunk, 'model_name');
              if (model && !cached.model) cached.model = model;

              const badgeMatch = chunk.match(/"display_name"\s*:\s*"(V\d+[^"]*)"/i);
              if (badgeMatch && badgeMatch[1]) cached.model = badgeMatch[1];

              const personaMatch = chunk.match(/"persona"\s*:\s*\{[^}]*"name"\s*:\s*"((?:[^"\\]|\\.)*)"/);
              if (personaMatch && personaMatch[1] && !cached.persona) {
                cached.persona = decodeJsonStringLiteral(personaMatch[1]).trim();
              }

              const handle = extractJsonField(chunk, 'display_name') || extractJsonField(chunk, 'handle');
              if (handle && !/^v\d+/i.test(handle) && !cached.artist) cached.artist = handle.trim();

              const createdAt = extractJsonField(chunk, 'created_at');
              if (createdAt && !cached.created_at) cached.created_at = createdAt;
            }
          }
        } catch (e) {}
      }

      // 3. Modern DOM Stil & Meta Taraması (Yalnızca eksikler varsa)
      let domStyle = '';
      if (!cached.style) {
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
      }

      // Sanatçı / Kullanıcı Adı & Başlık Taraması
      let rawTitle = cached.title || '';
      let artistName = (cached.artist || cached.persona || '').replace(/^Yok$/i, '').trim();

      if (!rawTitle) {
        const h1Text = document.querySelector('h1')?.innerText || document.querySelector('h1')?.textContent || '';
        if (h1Text.trim()) {
          rawTitle = h1Text.trim();
        } else {
          const docTitle = document.querySelector('meta[property="og:title"]')?.content || document.title || '';
          rawTitle = docTitle.replace(/\s*\|\s*Suno.*$/i, '').trim();
          if (rawTitle.includes(' by ')) {
            const idx = rawTitle.lastIndexOf(' by ');
            if (!artistName) artistName = rawTitle.slice(idx + 4).trim();
            rawTitle = rawTitle.slice(0, idx).trim();
          }
        }
      }
      if (!artistName) {
        const userLink = Array.from(document.querySelectorAll('a[href^="/@"], a[href*="suno.com/@"]'))
          .find(a => (a.innerText || a.textContent || '').trim().length > 0);
        if (userLink) {
          artistName = (userLink.innerText || userLink.textContent || '').replace(/^@/, '').trim();
        }
      }

      // DOM Sözler Taraması
      let lyrics = cached.lyrics || '';
      if (!lyrics) {
        const lyricCandidates = Array.from(document.querySelectorAll(
          '[role="tabpanel"] div.relative.font-sans, ' +
          '[data-testid*="lyrics"], [class*="lyrics"], [class*="Lyrics"], ' +
          'div.relative.font-sans.text-foreground-primary, div[class*="prompt"], [class*="PromptText"], pre'
        ));
        for (const el of lyricCandidates) {
          const txt = (el.innerText || el.textContent || '').trim();
          if (txt && txt.length > 10 && txt.length < 15000 &&
              (txt.includes('[Verse') || txt.includes('[Chorus') || txt.includes('[Intro') ||
               txt.includes('[Bridge') || txt.includes('[Outro') || txt.split('\n').length >= 3)) {
            lyrics = txt;
            break;
          }
        }
        if (!lyrics) {
          const containers = Array.from(document.querySelectorAll('main div, [role="tabpanel"] div, section div'));
          let bestLen = 0;
          for (const el of containers) {
            if (el.closest('nav, header, footer, [role="tablist"]')) continue;
            const txt = (el.innerText || '').trim();
            const lines = txt.split('\n').length;
            if ((txt.includes('[Verse') || txt.includes('[Chorus') || txt.includes('[Intro')) &&
                lines >= 3 && txt.length < 8000 && txt.length > bestLen) {
              bestLen = txt.length;
              lyrics = txt;
            }
          }
        }
      }
      if (!lyrics && cached.make_instrumental) {
        lyrics = '[Instrumental]';
      }

      let audioUrl = cached.audio_url || '';
      if (!audioUrl) {
        const ogAudio = document.querySelector('meta[property="og:audio"]')?.content || '';
        const audioEl = document.querySelector('audio source, audio[src]');
        const candidateAudio = ogAudio || (audioEl ? (audioEl.src || audioEl.currentSrc) : '');
        if (candidateAudio && !candidateAudio.includes('/api/forbidden')) {
          audioUrl = candidateAudio;
        }
      }

      return {
        id: songId,
        title: rawTitle || 'Suno Şarkısı',
        style: cached.style || domStyle || 'Özel Suno Stili',
        lyrics: lyrics || 'Enstrümantal veya söz belirtilmemiş',
        model: cached.model || 'Suno AI',
        persona: cached.persona || '',
        artist: artistName || 'Suno AI',
        created_at: cached.created_at ? new Date(cached.created_at).toLocaleString('tr-TR') : new Date().toLocaleString('tr-TR'),
        audio_url: audioUrl
      };
    }

    // Şarkıyı PromptVault'a aktar
    async function exportSongToVault(songId, btnElement) {
      if (!songId) {
        showToast('Şarkı ID bulunamadı!', false);
        return;
      }
      const origText = btnElement ? btnElement.innerHTML : '';
      if (btnElement) {
        btnElement.innerHTML = '⏳ Aktarılıyor...';
        btnElement.disabled = true;
      }

      try {
        const song = await getSongData(songId);

        const headerLines = [
          `=========================================`,
          `ŞARKI ADI   : ${song.title}`,
          `ŞARKI ID    : ${song.id}`,
          `MODEL       : ${song.model}`
        ];
        if (song.persona) {
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

        sendToVault('music', {
          metadata_txt: headerLines.join('\n'),
          title: song.title,
          style: song.style,
          lyrics: song.lyrics,
          model: song.model,
          persona: song.persona,
          artist: song.artist || song.persona,
          suno_id: song.id,
          suno_url: `https://suno.com/song/${song.id}`,
          audio_url: song.audio_url || ''
        }, () => {
          if (btnElement) btnElement.innerHTML = '✓ Aktarıldı!';
          showToast(`"${song.title}" başarıyla müzik kasasına aktarıldı! 🎵`);
          setTimeout(() => {
            if (btnElement) {
              btnElement.innerHTML = origText || '⚡ Vault\'a Aktar';
              btnElement.disabled = false;
            }
          }, 3000);
        }, (err) => {
          if (btnElement) btnElement.innerHTML = '❌ Hata';
          showToast(err, false);
          setTimeout(() => {
            if (btnElement) {
              btnElement.innerHTML = origText || '⚡ Vault\'a Aktar';
              btnElement.disabled = false;
            }
          }, 3000);
        });
      } catch (err) {
        if (btnElement) {
          btnElement.innerHTML = '❌ Hata';
          btnElement.disabled = false;
        }
        showToast('Aktarım hatası: ' + err.message, false);
      }
    }

    // Butonları Yerleştir
    function attachSunoButtons() {
      // 1. Şarkı Detay Sayfasındaki Buton
      const match = window.location.pathname.match(/\/song\/([a-f0-9\-]+)/i);
      if (match && match[1]) {
        const songId = match[1];
        const actionArea = document.querySelector(
          'button[aria-label^="More options for"], ' +
          'button[aria-label="More actions"], ' +
          'button[aria-label="Share"], ' +
          'div[class*="actions"]'
        );
        if (actionArea && !document.getElementById('pv-suno-page-btn')) {
          const btn = createVaultButton('⚡ Vault\'a Aktar');
          btn.id = 'pv-suno-page-btn';
          btn.style.marginLeft = '8px';
          btn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            exportSongToVault(songId, btn);
          };
          if (actionArea.parentElement) {
            actionArea.parentElement.appendChild(btn);
          }
        }
      }

      // 2. Şarkı Listesi Satırlarına Buton
      const songLinks = document.querySelectorAll('a[href*="/song/"]:not([data-pv-row-injected])');
      songLinks.forEach(link => {
        link.dataset.pvRowInjected = 'true';
        if (link.closest('[aria-label^="Playbar:"]') || link.getAttribute('aria-label')?.startsWith('Playbar:')) return;
        const hrefMatch = (link.getAttribute('href') || link.href || '').match(/\/song\/([a-f0-9\-]+)/i);
        if (!hrefMatch || !hrefMatch[1]) return;
        const rowSongId = hrefMatch[1];

        const row = link.closest('div[role="row"], div[data-testid="song-row"], div[class*="row"], tr');
        if (row && !row.querySelector('.pv-suno-row-btn')) {
          const rowBtn = createVaultButton('⚡ Vault', true);
          rowBtn.className += ' pv-suno-row-btn';
          rowBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            exportSongToVault(rowSongId, rowBtn);
          };
          row.appendChild(rowBtn);
        }
      });

      // 3. Sabit Kayan Buton (Suno alt çalarını engellemeyecek şekilde bottom: 90px)
      whenBodyReady(() => {
        if (!document.getElementById('pv-suno-floating-btn')) {
          const floatBtn = createVaultButton('⚡ Suno\'yu Vault\'a Aktar');
          floatBtn.id = 'pv-suno-floating-btn';
          floatBtn.style.position = 'fixed';
          floatBtn.style.bottom = '90px';
          floatBtn.style.right = '20px';
          floatBtn.style.zIndex = '999999';
          floatBtn.style.padding = '10px 16px';
          floatBtn.style.fontSize = '13px';
          floatBtn.style.fontWeight = 'bold';
          floatBtn.style.boxShadow = '0 6px 20px rgba(0,0,0,0.6)';
          floatBtn.onclick = () => {
            const m = window.location.pathname.match(/\/song\/([a-f0-9\-]+)/i);
            let targetSongId = m ? m[1] : '';

            if (!targetSongId) {
              const playerLink = document.querySelector(
                'a[aria-label^="Playbar: Title for"][href*="/song/"], ' +
                'a[aria-label^="Playbar:"][href*="/song/"], ' +
                'footer a[href*="/song/"], ' +
                '[data-testid="player"] a[href*="/song/"]'
              );
              if (playerLink) {
                const pm = (playerLink.getAttribute('href') || playerLink.href || '').match(/\/song\/([a-f0-9\-]+)/i);
                if (pm) targetSongId = pm[1];
              }
            }

            if (targetSongId) {
              exportSongToVault(targetSongId, floatBtn);
            } else {
              showToast('Lütfen önce bir şarkı sayfasına girin veya bir şarkı çalın!', false);
            }
          };
          (document.body || document.documentElement).appendChild(floatBtn);
        }
      });
    }

    setInterval(attachSunoButtons, 2000);
  }

  // ===================================================================
  // 4. CHATGPT / DALL-E ENTEGRASYONU (chatgpt.com)
  // ===================================================================
  function initChatGPT() {
    if (!window.location.hostname.includes('chatgpt.com')) return;

    // ChatGPT Kullanıcı Mesajını (TAM VE KESİNTİSİZ PROMPT) Çıkar
    function extractChatGPTPrompt(img) {
      let promptText = '';

      function cleanPrompt(raw) {
        if (!raw) return '';
        return raw
          .replace(/\s*(Daha fazla göster|Daha az göster|Show more|Show less|Daha fazla|Daha az)\s*[\^v]?$/i, '')
          .replace(/[\^v]$/, '')
          .trim();
      }

      function extractFromUserEl(userEl) {
        if (!userEl) return '';
        // "Daha fazla göster" butonu varsa tıkla (tam metni aç)
        const expandBtn = Array.from(userEl.querySelectorAll('button, [role="button"]')).find(b => {
          const t = (b.textContent || '').trim().toLowerCase();
          return t.includes('daha fazla') || t.includes('show more');
        });
        if (expandBtn) {
          try { expandBtn.click(); } catch(e) {}
        }

        const textEl = userEl.querySelector('.whitespace-pre-wrap, .font-user-message, div[class*="text"], p') || userEl;
        const clone = textEl.cloneNode(true);
        // "Daha az göster ^", "Copy", kopyalama ve düzenleme butonlarını DOM klonundan temizle
        clone.querySelectorAll('button, svg, [role="button"], [aria-hidden="true"]').forEach(b => b.remove());
        const full = clone.textContent || clone.innerText || '';
        return cleanPrompt(full);
      }

      // 1. Görselin bulunduğu turn'den geriye doğru en yakın kullanıcı mesajını bul
      if (img) {
        const turn = img.closest('article, [data-message-author-role="assistant"], [data-message-id], [data-testid*="conversation-turn"]');
        if (turn) {
          const allTurns = Array.from(document.querySelectorAll('article, [data-message-id], [data-testid*="conversation-turn"]'));
          const myIdx = allTurns.indexOf(turn);
          if (myIdx > 0) {
            for (let i = myIdx - 1; i >= 0; i--) {
              const cand = allTurns[i];
              const isUser = cand.matches('[data-message-author-role="user"]') ||
                             cand.querySelector('[data-message-author-role="user"], .font-user-message, [data-testid*="user-message"]');
              if (isUser) {
                promptText = extractFromUserEl(cand);
                if (promptText) break;
              }
            }
          }
        }
      }

      // 2. Bulunamazsa veya kayan buton tıklandıysa: Sohbetteki tüm kullanıcı mesajlarını tara ve en sonuncusunu al
      if (!promptText) {
        const userSelectors = [
          '[data-message-author-role="user"]',
          '[data-testid*="user-message"]',
          '[data-testid*="conversation-turn-user"]',
          '.font-user-message',
          '.user-message-bubble-color'
        ];
        const allUserEls = Array.from(document.querySelectorAll(userSelectors.join(',')));
        if (allUserEls.length > 0) {
          const lastEl = allUserEls[allUserEls.length - 1];
          promptText = extractFromUserEl(lastEl);
        }
      }

      // 3. Fallback: Sayfadaki herhangi bir .whitespace-pre-wrap kullanıcısı
      if (!promptText) {
        const preWraps = Array.from(document.querySelectorAll('.whitespace-pre-wrap'));
        for (let i = preWraps.length - 1; i >= 0; i--) {
          const el = preWraps[i];
          if (!el.closest('[data-message-author-role="assistant"]')) {
            promptText = extractFromUserEl(el);
            if (promptText) break;
          }
        }
      }

      // 4. Sohbet balonu bulunamazsa görselin alt etiketine bak
      if (!promptText && img && img.alt && !img.alt.toLowerCase().startsWith('generated image')) {
        promptText = cleanPrompt(img.alt);
      }

      return promptText || 'ChatGPT Generated Image';
    }

    function attachChatGPTButtons() {
      const images = Array.from(document.querySelectorAll('img:not([data-pv-injected])'));
      images.forEach(img => {
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if ((w > 0 && w < 140) || (h > 0 && h < 140)) return;
        if (!img.src || img.src.startsWith('data:image/svg')) return;
        if (img.closest('.avatar, [alt*="Avatar" i], [alt*="Profile" i], [data-message-author-role="user"]')) return;

        img.dataset.pvInjected = 'true';

        const parent = img.parentElement;
        if (!parent) return;
        if (parent.querySelector('.pv-vault-btn')) return;

        if (getComputedStyle(parent).position === 'static') {
          parent.style.position = 'relative';
        }

        const btn = createVaultButton('⚡ Vault\'a Gönder');
        btn.style.position = 'absolute';
        btn.style.top = '10px';
        btn.style.right = '10px';
        btn.style.zIndex = '999';
        btn.style.pointerEvents = 'auto';
        btn.style.boxShadow = '0 3px 12px rgba(0,0,0,0.6)';
        btn.style.opacity = '0.9';

        btn.onclick = async (e) => {
          e.stopPropagation();
          e.preventDefault();
          btn.textContent = '⏳ Gönderiliyor...';
          btn.disabled = true;

          const promptText = extractChatGPTPrompt(img);
          const b64 = await imageToDataUrl(img);

          sendToVault('image', {
            prompt: promptText,
            generator: 'chatgpt',
            image_b64: b64,
            source_url: window.location.href,
          }, () => {
            btn.innerHTML = '✓ Eklendi!';
            showToast('ChatGPT görseli ve tam promptu kasaya kaydedildi! 🎨');
            setTimeout(() => {
              btn.innerHTML = '⚡ Vault\'a Gönder';
              btn.disabled = false;
            }, 3000);
          }, (err) => {
            btn.innerHTML = '❌ Hata';
            showToast(err, false);
            setTimeout(() => {
              btn.innerHTML = '⚡ Vault\'a Gönder';
              btn.disabled = false;
            }, 3000);
          });
        };

        parent.appendChild(btn);
      });

      // Sabit Sol Alt Kayan Buton
      whenBodyReady(() => {
        if (!document.getElementById('pv-chatgpt-floating-btn')) {
          const floatBtn = createVaultButton('⚡ ChatGPT\'yi Vault\'a Gönder');
          floatBtn.id = 'pv-chatgpt-floating-btn';
          floatBtn.style.position = 'fixed';
          floatBtn.style.bottom = '24px';
          floatBtn.style.left = '24px';
          floatBtn.style.zIndex = '99999';
          floatBtn.style.padding = '10px 18px';
          floatBtn.style.fontSize = '13.5px';
          floatBtn.style.fontWeight = 'bold';
          floatBtn.style.boxShadow = '0 6px 25px rgba(0,0,0,0.7)';
          floatBtn.onclick = async () => {
            // Kullanıcının yüklediği referans görseli değil, üretilen çıktıyı seç
            const allImgs = [...document.querySelectorAll('article img, [data-message-author-role="assistant"] img, main img, img')].filter(i => {
              const w = i.naturalWidth || i.width || 0;
              const h = i.naturalHeight || i.height || 0;
              const isUserUploaded = i.closest('[data-message-author-role="user"]');
              const isAvatar = i.closest('.avatar, [alt*="Avatar" i], [alt*="Profile" i]');
              return (w > 150 || h > 150) && !i.src.startsWith('data:image/svg') && !isUserUploaded && !isAvatar;
            });
            const lastImg = allImgs[allImgs.length - 1];
            if (!lastImg) {
              showToast('Sayfada aktarılacak ChatGPT görseli bulunamadı!', false);
              return;
            }
            floatBtn.textContent = '⏳ Gönderiliyor...';
            floatBtn.disabled = true;

            const promptText = extractChatGPTPrompt(lastImg);
            const b64 = await imageToDataUrl(lastImg);

            sendToVault('image', {
              prompt: promptText,
              generator: 'chatgpt',
              image_b64: b64,
              source_url: window.location.href,
            }, () => {
              floatBtn.innerHTML = '✓ Aktarıldı!';
              showToast('ChatGPT görseli ve tam promptu kasaya kaydedildi! 🎨');
              setTimeout(() => { floatBtn.innerHTML = '⚡ ChatGPT\'yi Vault\'a Gönder'; floatBtn.disabled = false; }, 3000);
            }, (err) => {
              floatBtn.innerHTML = '❌ Hata';
              showToast(err, false);
              setTimeout(() => { floatBtn.innerHTML = '⚡ ChatGPT\'yi Vault\'a Gönder'; floatBtn.disabled = false; }, 3000);
            });
          };
          (document.body || document.documentElement).appendChild(floatBtn);
        }
      });
    }

    setInterval(attachChatGPTButtons, 2000);
  }

  // ===================================================================
  // 5. GOOGLE GEMINI ENTEGRASYONU (gemini.google.com & aistudio)
  // ===================================================================
  function initGemini() {
    if (!window.location.hostname.includes('gemini.google.com') && !window.location.hostname.includes('aistudio.google.com')) return;

    // Gemini Kullanıcı Sorusunu (TAM VE KESİNTİSİZ PROMPT) Çıkar
    function extractGeminiPrompt(img) {
      let promptText = '';

      function cleanPrompt(raw) {
        if (!raw) return '';
        return raw
          .replace(/\s*(Daha fazla göster|Daha az göster|Show more|Show less|Daha fazla|Daha az)\s*[\^v]?$/i, '')
          .replace(/[\^v]$/, '')
          .trim();
      }

      function extractFromQueryEl(q) {
        if (!q) return '';
        // "Daha fazla göster" butonu varsa tıkla ve tam metni aç
        const expandBtn = Array.from(q.querySelectorAll('button, [role="button"]')).find(b => {
          const t = (b.textContent || '').trim().toLowerCase();
          return t.includes('daha fazla') || t.includes('show more') || t.includes('read more');
        });
        if (expandBtn) {
          try { expandBtn.click(); } catch(e) {}
        }

        const clone = q.cloneNode(true);
        // Düzenle, kopyala, daha az göster butonlarını temizle
        clone.querySelectorAll('button, mat-icon, svg, [role="button"], read-more-wrapper button, [aria-hidden="true"]').forEach(b => b.remove());
        const full = clone.textContent || clone.innerText || '';
        return cleanPrompt(full);
      }

      if (img) {
        const turn = img.closest('conversation-turn, model-response, .model-response, [data-message-author-role="model"], .turn-container');
        if (turn) {
          const allTurns = Array.from(document.querySelectorAll('conversation-turn, model-response, .turn-container, [data-message-id]'));
          const myIdx = allTurns.indexOf(turn);
          if (myIdx > 0) {
            for (let i = myIdx - 1; i >= 0; i--) {
              const cand = allTurns[i];
              const q = cand.querySelector('.user-query-container, .user-query, .query-text, [data-message-author-role="user"], user-query');
              if (q) {
                promptText = extractFromQueryEl(q);
                if (promptText) break;
              }
            }
          }
        }
      }

      if (!promptText) {
        const querySelectors = [
          'user-query',
          '.user-query-container',
          '.user-query',
          '.query-text',
          '.query-content',
          '[data-message-author-role="user"]'
        ];
        const allQueries = Array.from(document.querySelectorAll(querySelectors.join(',')));
        if (allQueries.length > 0) {
          const lastQ = allQueries[allQueries.length - 1];
          promptText = extractFromQueryEl(lastQ);
        }
      }

      if (!promptText && img && img.alt && !img.alt.toLowerCase().startsWith('generated image') && !img.alt.toLowerCase().includes('avatar')) {
        promptText = cleanPrompt(img.alt);
      }

      return promptText || 'Gemini Generated Image';
    }

    // Hızlı ve güvenli Gemini görsellerini bulma (Freezing korumalı)
    function findGeminiImages() {
      const results = [];
      const selectors = [
        'img[src*="googleusercontent"]',
        'img[src*="blob:"]',
        'img[src*="data:image"]',
        'conversation-turn img',
        'model-response img',
        '.model-response img',
        '[data-message-author-role="model"] img',
        '.image-container img',
        'img.image'
      ];
      const imgs = Array.from(document.querySelectorAll(selectors.join(',')));
      for (const img of imgs) {
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if ((w > 0 && w < 120) || (h > 0 && h < 120)) continue;
        const src = img.src || '';
        if (!src || src.startsWith('data:image/svg')) continue;
        const alt = (img.alt || '').toLowerCase();
        if (alt.includes('avatar') || alt.includes('logo') || alt.includes('icon')) continue;
        if (img.closest?.('.avatar, [aria-label*="avatar" i], [class*="avatar" i], .user-icon')) continue;
        results.push(img);
      }
      return results;
    }

    function attachGeminiButtons() {
      const images = findGeminiImages();
      images.forEach(img => {
        if (img.dataset.pvInjected) return;
        img.dataset.pvInjected = 'true';

        const parent = img.parentElement;
        if (!parent) return;
        if (parent.querySelector('.pv-vault-btn')) return;

        if (getComputedStyle(parent).position === 'static') {
          parent.style.position = 'relative';
        }

        const btn = createVaultButton('⚡ Vault\'a Gönder');
        btn.style.position = 'absolute';
        btn.style.top = '10px';
        btn.style.right = '10px';
        btn.style.zIndex = '999';
        btn.style.pointerEvents = 'auto';
        btn.style.boxShadow = '0 3px 12px rgba(0,0,0,0.6)';
        btn.style.opacity = '0.9';

        btn.onclick = async (e) => {
          e.stopPropagation();
          e.preventDefault();
          btn.textContent = '⏳ Gönderiliyor...';
          btn.disabled = true;

          const promptText = extractGeminiPrompt(img);
          const b64 = await imageToDataUrl(img);

          sendToVault('image', {
            prompt: promptText,
            generator: 'gemini',
            image_b64: b64,
            source_url: window.location.href,
          }, () => {
            btn.innerHTML = '✓ Eklendi!';
            showToast('Gemini görseli ve tam promptu kasaya kaydedildi! 🎨');
            setTimeout(() => {
              btn.innerHTML = '⚡ Vault\'a Gönder';
              btn.disabled = false;
            }, 3000);
          }, (err) => {
            btn.innerHTML = '❌ Hata';
            showToast(err, false);
            setTimeout(() => {
              btn.innerHTML = '⚡ Vault\'a Gönder';
              btn.disabled = false;
            }, 3000);
          });
        };

        parent.appendChild(btn);
      });

      // Sabit Sol Alt Kayan Buton
      whenBodyReady(() => {
        if (!document.getElementById('pv-gemini-floating-btn')) {
          const floatBtn = createVaultButton('⚡ Gemini\'yi Vault\'a Gönder');
          floatBtn.id = 'pv-gemini-floating-btn';
          floatBtn.style.position = 'fixed';
          floatBtn.style.bottom = '24px';
          floatBtn.style.left = '24px';
          floatBtn.style.zIndex = '99999';
          floatBtn.style.padding = '10px 18px';
          floatBtn.style.fontSize = '13.5px';
          floatBtn.style.fontWeight = 'bold';
          floatBtn.style.boxShadow = '0 6px 25px rgba(0,0,0,0.7)';
          floatBtn.onclick = async () => {
            const allImgs = findGeminiImages();
            const lastImg = allImgs[allImgs.length - 1];
            if (!lastImg) {
              showToast('Sayfada aktarılacak Gemini görseli bulunamadı!', false);
              return;
            }
            floatBtn.textContent = '⏳ Gönderiliyor...';
            floatBtn.disabled = true;
            const promptText = extractGeminiPrompt(lastImg);
            const b64 = await imageToDataUrl(lastImg);
            sendToVault('image', {
              prompt: promptText,
              generator: 'gemini',
              image_b64: b64,
              source_url: window.location.href,
            }, () => {
              floatBtn.innerHTML = '✓ Aktarıldı!';
              showToast('Gemini görseli ve tam promptu kasaya kaydedildi! 🎨');
              setTimeout(() => { floatBtn.innerHTML = '⚡ Gemini\'yi Vault\'a Gönder'; floatBtn.disabled = false; }, 3000);
            }, (err) => {
              floatBtn.innerHTML = '❌ Hata';
              showToast(err, false);
              setTimeout(() => { floatBtn.innerHTML = '⚡ Gemini\'yi Vault\'a Gönder'; floatBtn.disabled = false; }, 3000);
            });
          };
          (document.body || document.documentElement).appendChild(floatBtn);
        }
      });
    }

    setInterval(attachGeminiButtons, 2000);
  }

  // ===================================================================
  // 6. FLOW / IMAGEFX ENTEGRASYONU (labs.google / aitestkitchen)
  // ===================================================================
  function initFlow() {
    if (!window.location.hostname.includes('labs.google') && !window.location.hostname.includes('aitestkitchen')) return;

    function attachFlowButtons() {
      const images = Array.from(document.querySelectorAll('img:not([data-pv-injected])'));
      images.forEach(img => {
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if ((w > 0 && w < 160) || (h > 0 && h < 160)) return;
        if (!img.src || img.src.startsWith('data:image/svg')) return;

        img.dataset.pvInjected = 'true';

        const parent = img.parentElement;
        if (!parent) return;
        if (parent.querySelector('.pv-vault-btn')) return;

        if (getComputedStyle(parent).position === 'static') {
          parent.style.position = 'relative';
        }

        const btn = createVaultButton('⚡ Vault\'a Gönder');
        btn.style.position = 'absolute';
        btn.style.top = '10px';
        btn.style.right = '10px';
        btn.style.zIndex = '999';
        btn.style.pointerEvents = 'auto';

        btn.onclick = async (e) => {
          e.stopPropagation();
          e.preventDefault();
          btn.textContent = '⏳ Gönderiliyor...';
          btn.disabled = true;

          const promptInput = document.querySelector('textarea, [contenteditable="true"]');
          const promptText = promptInput ? (promptInput.textContent || promptInput.value || '') : '';

          const b64 = await imageToDataUrl(img);
          sendToVault('image', {
            prompt: promptText || 'Flow Generated Image',
            generator: 'flow',
            image_b64: b64,
            source_url: window.location.href,
          }, () => {
            btn.innerHTML = '✓ Eklendi!';
            showToast('Flow görseli ve promptu kasaya kaydedildi! 🎨');
            setTimeout(() => {
              btn.innerHTML = '⚡ Vault\'a Gönder';
              btn.disabled = false;
            }, 3000);
          }, (err) => {
            btn.innerHTML = '❌ Hata';
            showToast(err, false);
            setTimeout(() => {
              btn.innerHTML = '⚡ Vault\'a Gönder';
              btn.disabled = false;
            }, 3000);
          });
        };

        parent.appendChild(btn);
      });
    }

    setInterval(attachFlowButtons, 2000);
  }

  // ===================================================================
  // 7. SİTEYE ÖZEL BAŞLATMA
  // ===================================================================
  initSuno();
  initChatGPT();
  initGemini();
  initFlow();

})();
