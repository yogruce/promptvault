// ==UserScript==
// @name         PromptVault Universal Clipper (1-Click Send to Vault)
// @namespace    http://tampermonkey.net/
// @version      1.3.0
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
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function() {
  'use strict';

  const VAULT_URL = 'http://127.0.0.1:7860';
  const songCache = {};

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
            const url = args[0] ? args[0].toString() : '';
            if (url.includes('/api/') || url.includes('clip') || url.includes('feed') || url.includes('song')) {
              const clone = res.clone();
              clone.json().then(data => {
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
          const orig = window.fetch;
          window.fetch = async function(...args) {
            const r = await orig.apply(this, args);
            try {
              const u = args[0] ? args[0].toString() : '';
              if (u.includes('/api/') || u.includes('clip') || u.includes('feed') || u.includes('song')) {
                const c = r.clone();
                c.json().then(d => {
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

  function extractSongsFromData(obj) {
    if (!obj || typeof obj !== 'object') return;

    if (obj.id && (obj.metadata || obj.title || obj.audio_url)) {
      const meta = (obj.metadata && typeof obj.metadata === 'object') ? obj.metadata : {};
      const fullStyle = meta.tags || meta.gpt_description_prompt || obj.display_tags || '';
      const lyricsText = (meta.prompt && !meta.prompt.startsWith('$')) ? meta.prompt : '';

      let modelName = obj.major_model_version || '';
      if (meta.model_badges && meta.model_badges.songcard && meta.model_badges.songcard.display_name) {
        modelName = meta.model_badges.songcard.display_name;
      }

      const personaName = (obj.persona && obj.persona.name) ? obj.persona.name : '';
      const audioUrl = obj.audio_url || obj.source_audio_url || '';

      const existing = songCache[obj.id] || {};
      songCache[obj.id] = {
        id: obj.id,
        title: obj.title || existing.title || '',
        style: fullStyle || existing.style || '',
        lyrics: lyricsText || existing.lyrics || '',
        model: modelName || existing.model || 'Suno AI',
        persona: personaName || existing.persona || '',
        created_at: obj.created_at || existing.created_at || '',
        audio_url: audioUrl || existing.audio_url || ''
      };
    }

    for (const key in obj) {
      if (key === 'persona') continue;
      if (typeof obj[key] === 'object') {
        extractSongsFromData(obj[key]);
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

    // Şarkı Verilerini Çıkar (Cache + Dahili API Doğrudan Çağrı + DOM)
    async function getSongData(songId) {
      let cached = songCache[songId] || {};

      // 1. Suno dahili API'lerini tara (Feed v2, feed, clip)
      if (!cached.style || !cached.lyrics || cached.style === 'Stil belirtilmemiş') {
        const endpoints = [
          `/api/feed/v2?ids=${songId}`,
          `/api/feed/?ids=${songId}`,
          `/api/clip/${songId}`
        ];
        const fetchFn = (typeof unsafeWindow !== 'undefined' && unsafeWindow.fetch) ? unsafeWindow.fetch : window.fetch;
        for (const ep of endpoints) {
          try {
            const apiRes = await fetchFn(ep);
            if (apiRes && apiRes.ok) {
              const data = await apiRes.json();
              const clipObj = Array.isArray(data) ? data.find(c => c && c.id === songId) : (data && data.clips ? data.clips.find(c => c && c.id === songId) : data);
              if (clipObj && clipObj.id) {
                const meta = (clipObj.metadata && typeof clipObj.metadata === 'object') ? clipObj.metadata : {};
                const fullStyle = meta.tags || meta.gpt_description_prompt || clipObj.display_tags || '';
                const lyricsText = (meta.prompt && !meta.prompt.startsWith('$')) ? meta.prompt : '';
                let modelName = clipObj.major_model_version || '';
                if (meta.model_badges?.songcard?.display_name) {
                  modelName = meta.model_badges.songcard.display_name;
                }
                const personaName = (clipObj.persona && clipObj.persona.name) ? clipObj.persona.name : '';
                const audioUrl = clipObj.audio_url || clipObj.source_audio_url || '';

                cached = {
                  id: clipObj.id,
                  title: clipObj.title || cached.title || '',
                  style: fullStyle || cached.style || '',
                  lyrics: lyricsText || cached.lyrics || '',
                  model: modelName || cached.model || 'Suno AI',
                  persona: personaName || cached.persona || '',
                  created_at: clipObj.created_at || cached.created_at || '',
                  audio_url: audioUrl || cached.audio_url || ''
                };
                songCache[songId] = cached;
                if (cached.style && cached.lyrics) break;
              }
            }
          } catch (e) {}
        }
      }

      // 2. Next.js Script chunk tarama (Yedek)
      if (!cached.style || !cached.lyrics) {
        try {
          const scripts = Array.from(document.querySelectorAll('script'));
          for (const s of scripts) {
            const rawText = s.textContent || '';
            if (!rawText.includes(songId)) continue;
            const unescaped = rawText.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            const idIndex = unescaped.indexOf(`"id":"${songId}"`);
            const targetChunk = idIndex !== -1 ? unescaped.substring(Math.max(0, idIndex - 500), idIndex + 4500) : unescaped;

            const tagsMatch = targetChunk.match(/"tags"\s*:\s*"([^"]+)"/) || targetChunk.match(/"display_tags"\s*:\s*"([^"]+)"/);
            if (tagsMatch && tagsMatch[1] && !cached.style) cached.style = tagsMatch[1].trim();

            const promptMatch = targetChunk.match(/"prompt"\s*:\s*"([^"]+)"/);
            if (promptMatch && promptMatch[1] && !promptMatch[1].startsWith('$') && !cached.lyrics) {
              cached.lyrics = promptMatch[1].replace(/\\n/g, '\n').trim();
            }

            const modelMatch = targetChunk.match(/"display_name"\s*:\s*"(V\d+[^"]*)"/i) || targetChunk.match(/"major_model_version"\s*:\s*"([^"]+)"/i);
            if (modelMatch && modelMatch[1] && !cached.model) cached.model = modelMatch[1].toUpperCase();

            const personaMatch = targetChunk.match(/"persona"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
            if (personaMatch && personaMatch[1] && !cached.persona) cached.persona = personaMatch[1].trim();
          }
        } catch (e) {}
      }

      // 3. DOM (Ekran) üzerinden Tam Stil Yakalama (Show Summary tıkla)
      const allElements = Array.from(document.querySelectorAll('div, p, span, a, button, pre, textarea'));
      let domStyle = '';
      try {
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
                !l.includes('{"')
              );
              lines.sort((a, b) => b.length - a.length);
              if (lines.length > 0 && lines[0].length > domStyle.length && lines[0].length < 1000) {
                domStyle = lines[0];
              }
            }
          }
        }
      } catch (e) {}

      // Sanatçı / Kullanıcı Adı (Persona yoksa @username bul)
      let artistName = (cached.persona || '').replace(/^Yok$/i, '').trim();
      if (!artistName) {
        const userLink = document.querySelector('a[href^="/@"], a[href*="suno.com/@"]');
        if (userLink) {
          artistName = (userLink.innerText || userLink.textContent || '').replace(/^@/, '').trim();
        }
      }

      // DOM Başlık Taraması
      const titleEl = document.querySelector('h1') || document.querySelector('title');
      let rawTitle = cached.title || (titleEl ? titleEl.innerText : 'Suno Şarkısı');
      rawTitle = rawTitle.replace(/\s*\|\s*Suno.*$/i, '').replace(/\s+by\s+[a-zA-Z0-9_.-]+$/i, '').trim();

      // DOM Sözler Taraması
      let lyrics = cached.lyrics || '';
      if (!lyrics) {
        let maxLines = 0;
        allElements.forEach(el => {
          if (el.children.length === 0 && el.innerText) {
            const txt = el.innerText.trim();
            const lines = txt.split('\n').length;
            if (lines > maxLines && lines > 3 && !txt.includes('Create') && !txt.includes('Library') && !txt.includes('{"')) {
              maxLines = lines;
              lyrics = txt;
            }
          }
        });
        if (!lyrics) {
          const containers = Array.from(document.querySelectorAll('div, pre, textarea'));
          containers.forEach(el => {
            const txt = (el.innerText || '').trim();
            const lines = txt.split('\n').length;
            if ((txt.includes('[Verse') || txt.includes('[Chorus') || txt.includes('[Intro')) && lines > maxLines && txt.length < 6000) {
              maxLines = lines;
              lyrics = txt;
            }
          });
        }
      }

      let audioUrl = cached.audio_url || '';
      if (!audioUrl) {
        const audioEl = document.querySelector('audio source, audio[src]');
        if (audioEl) audioUrl = audioEl.src || '';
      }

      return {
        id: songId,
        title: rawTitle || 'Suno Şarkısı',
        style: cached.style || domStyle || 'Özel Suno Stili',
        lyrics: lyrics || 'Enstrümantal veya söz belirtilmemiş',
        model: cached.model || 'Suno AI',
        persona: artistName || 'Bilinmeyen Sanatçı',
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
          artist: song.persona,
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
        const actionArea = document.querySelector('button[aria-label="More actions"], button[aria-label="Share"], div[class*="actions"]');
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
        const hrefMatch = link.href.match(/\/song\/([a-f0-9\-]+)/i);
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
              const playerLink = document.querySelector('footer a[href*="/song/"], [data-testid="player"] a[href*="/song/"], a[href*="/song/"]');
              if (playerLink) {
                const pm = playerLink.href.match(/\/song\/([a-f0-9\-]+)/i);
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
          .replace(/\s*(Daha fazla göster|Daha az göster|Show more|Show less)\s*\^?$/i, '')
          .replace(/\s*\^$/, '')
          .trim();
      }

      function extractFromUserEl(userEl) {
        if (!userEl) return '';
        const textEl = userEl.querySelector('.whitespace-pre-wrap') || userEl;
        const clone = textEl.cloneNode(true);
        // "Daha az göster ^", "Copy", kopyalama ve düzenleme butonlarını DOM klonundan temizle
        clone.querySelectorAll('button, svg, [role="button"]').forEach(b => b.remove());
        return cleanPrompt(clone.innerText || clone.textContent || '');
      }

      // 1. Görselin bulunduğu asistana ait turn'den önceki kullanıcı mesajını bul
      if (img) {
        const turn = img.closest('article, [data-message-author-role="assistant"], [data-message-id]');
        if (turn) {
          let prev = turn.previousElementSibling;
          while (prev) {
            const userEl = prev.matches?.('[data-message-author-role="user"]') 
              ? prev 
              : prev.querySelector?.('[data-message-author-role="user"]');
            if (userEl) {
              promptText = extractFromUserEl(userEl);
              if (promptText) break;
            }
            prev = prev.previousElementSibling;
          }
        }
      }

      // 2. Bulunamazsa veya kayan buton tıklandıysa: Sohbetteki en son kullanıcı mesajını al
      if (!promptText) {
        const allUserEls = Array.from(document.querySelectorAll('[data-message-author-role="user"]'));
        if (allUserEls.length > 0) {
          const lastEl = allUserEls[allUserEls.length - 1];
          promptText = extractFromUserEl(lastEl);
        }
      }

      // 3. Sohbet balonu bulunamazsa görselin alt etiketine bak
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
          .replace(/\s*(Daha fazla göster|Daha az göster|Show more|Show less)\s*\^?$/i, '')
          .replace(/\s*\^$/, '')
          .trim();
      }

      function extractFromQueryEl(q) {
        if (!q) return '';
        const clone = q.cloneNode(true);
        // Düzenle, kopyala, daha az göster butonlarını temizle
        clone.querySelectorAll('button, mat-icon, svg, [role="button"], read-more-wrapper button').forEach(b => b.remove());
        return cleanPrompt(clone.innerText || clone.textContent || '');
      }

      if (img) {
        const turn = img.closest('conversation-turn, model-response, .model-response, [data-message-author-role="model"], .turn-container');
        if (turn) {
          let prev = turn.previousElementSibling;
          while (prev) {
            const q = prev.querySelector?.('.user-query-container, .user-query, .query-text, [data-message-author-role="user"], user-query');
            if (q) {
              promptText = extractFromQueryEl(q);
              if (promptText) break;
            }
            if (prev.matches?.('.user-query-container, .user-query, .query-text, [data-message-author-role="user"], user-query')) {
              promptText = extractFromQueryEl(prev);
              if (promptText) break;
            }
            prev = prev.previousElementSibling;
          }
        }
      }

      if (!promptText) {
        const allQueries = Array.from(document.querySelectorAll('.user-query-container, .user-query, .query-text, [data-message-author-role="user"], user-query'));
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

    // Shadow DOM da dahil Gemini görsellerini bul
    function findGeminiImages() {
      const results = [];
      function scan(root) {
        if (!root) return;
        const imgs = root.querySelectorAll('img');
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
        const all = root.querySelectorAll('*');
        for (const el of all) {
          if (el.shadowRoot) scan(el.shadowRoot);
        }
      }
      scan(document);
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
