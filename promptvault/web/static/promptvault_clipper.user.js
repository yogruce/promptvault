// ==UserScript==
// @name         PromptVault Universal Clipper (1-Click Send to Vault)
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  Gemini, ChatGPT, Flow/ImageFX ve Suno AI'dan tek tuşla görsel, prompt, şarkı ve üst verileri yerel PromptVault kasasına aktarır.
// @author       PromptVault
// @match        *://gemini.google.com/*
// @match        *://*.gemini.google.com/*
// @match        *://chatgpt.com/*
// @match        *://*.chatgpt.com/*
// @match        *://suno.com/*
// @match        *://*.suno.com/*
// @match        *://app.suno.ai/*
// @match        *://labs.google/*
// @match        *://*.labs.google/*
// @match        *://aitestkitchen.withgoogle.com/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-end
// ==/UserScript==

(function() {
  'use strict';

  const VAULT_URL = 'http://127.0.0.1:7860';

  // --- FLOATING TOAST NOTIFICATION ---
  function showToast(msg, isSuccess = true) {
    let t = document.getElementById('pv-clipper-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'pv-clipper-toast';
      t.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 999999;
        background: #18181b;
        color: #fff;
        padding: 12px 18px;
        border-radius: 8px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 13.5px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.5);
        border: 1px solid ${isSuccess ? '#10b981' : '#ef4444'};
        display: flex;
        align-items: center;
        gap: 10px;
        transition: opacity 0.25s, transform 0.25s;
        opacity: 0;
        transform: translateY(10px);
      `;
      document.body.appendChild(t);
    }
    t.innerHTML = `${isSuccess ? '✅' : '❌'} <span>${msg}</span>`;
    t.style.borderColor = isSuccess ? '#10b981' : '#ef4444';
    t.style.opacity = '1';
    t.style.transform = 'translateY(0)';
    clearTimeout(t._tm);
    t._tm = setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateY(10px)';
    }, 3500);
  }

  // --- HTTP POST SENDER (GM_xmlhttpRequest) ---
  function sendToVault(endpoint, payload, onSuccess, onError) {
    GM_xmlhttpRequest({
      method: 'POST',
      url: `${VAULT_URL}/api/quick-import/${endpoint}`,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(payload),
      timeout: 20000,
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
      onerror: function(err) {
        onError('PromptVault sunucusuna ulaşılamadı! Programın açık (http://127.0.0.1:7860) olduğundan emin olun.');
      },
      ontimeout: function() {
        onError('İstek zaman aşımına uğradı.');
      }
    });
  }

  // Helper to convert img to base64
  async function imgToBase64(imgElement) {
    return new Promise((resolve, reject) => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = imgElement.naturalWidth || imgElement.width || 512;
        canvas.height = imgElement.naturalHeight || imgElement.height || 512;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imgElement, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        // Fallback to src URL if canvas tainted
        resolve(imgElement.src);
      }
    });
  }

  // --- BUTTON STYLE HELPER ---
  function createVaultButton(title = '⚡ Vault\'a Aktar') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pv-vault-btn';
    btn.innerHTML = title;
    btn.style.cssText = `
      background: linear-gradient(135deg, #7c3aed, #4f46e5);
      color: #ffffff;
      border: 0;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      font-family: system-ui, sans-serif;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 2px 8px rgba(124, 58, 237, 0.4);
      transition: transform 0.15s, filter 0.15s;
    `;
    btn.onmouseenter = () => btn.style.filter = 'brightness(1.15)';
    btn.onmouseleave = () => btn.style.filter = 'brightness(1.0)';
    return btn;
  }

  // ===================================================================
  // 1. SUNO AI (suno.com)
  // ===================================================================
  function initSuno() {
    if (!window.location.hostname.includes('suno.com')) return;

    function attachSunoButtons() {
      // Find download buttons or action bars on song pages and song rows
      const songActions = document.querySelectorAll('button[aria-label="More actions"], div[data-testid="song-row-actions"], .song-page-actions');
      songActions.forEach(container => {
        if (container.dataset.pvInjected) return;
        container.dataset.pvInjected = 'true';

        const btn = createVaultButton('⚡ Vault\'a Aktar');
        btn.onclick = async (e) => {
          e.stopPropagation();
          e.preventDefault();
          btn.textContent = '⏳ Aktarılıyor...';
          btn.disabled = true;

          // Extract song metadata from current URL or page
          const url = window.location.href;
          const idMatch = url.match(/song\/([a-f0-9\-]+)/);
          const songId = idMatch ? idMatch[1] : '';

          // Look for title & lyrics in DOM
          const titleEl = document.querySelector('h1, h2, [data-testid="song-title"]');
          const title = titleEl ? titleEl.textContent.trim() : 'Suno Şarkısı';

          const lyricsEl = document.querySelector('.lyrics, [data-testid="lyrics-content"], pre');
          const lyrics = lyricsEl ? lyricsEl.textContent.trim() : '';

          const styleEl = document.querySelector('[data-testid="style-tags"], .style-prompt');
          const style = styleEl ? styleEl.textContent.trim() : '';

          sendToVault('music', {
            title,
            lyrics,
            style,
            suno_id: songId,
            suno_url: url,
            generator: 'suno',
          }, (data) => {
            btn.innerHTML = '✓ Aktarıldı!';
            showToast(`"${data.title || title}" müzik kasasına aktarıldı! 🎵`);
            setTimeout(() => {
              btn.innerHTML = '⚡ Vault\'a Aktar';
              btn.disabled = false;
            }, 3000);
          }, (err) => {
            btn.innerHTML = '❌ Hata';
            showToast(err, false);
            setTimeout(() => {
              btn.innerHTML = '⚡ Vault\'a Aktar';
              btn.disabled = false;
            }, 3000);
          });
        };

        container.parentNode.insertBefore(btn, container.nextSibling);
      });

      // Persistent floating button on Suno
      if (!document.getElementById('pv-suno-floating-btn')) {
        const floatBtn = createVaultButton('⚡ Suno\'yu Vault\'a Aktar');
        floatBtn.id = 'pv-suno-floating-btn';
        floatBtn.style.position = 'fixed';
        floatBtn.style.bottom = '24px';
        floatBtn.style.left = '24px';
        floatBtn.style.zIndex = '2147483647';
        floatBtn.style.padding = '10px 18px';
        floatBtn.style.fontSize = '13.5px';
        floatBtn.style.fontWeight = 'bold';
        floatBtn.style.boxShadow = '0 6px 25px rgba(0,0,0,0.7)';
        floatBtn.onclick = () => {
          const url = window.location.href;
          const idMatch = url.match(/song\/([a-f0-9\-]+)/);
          const songId = idMatch ? idMatch[1] : '';

          let title = '';
          const titleEl = document.querySelector('h1, h2, [data-testid="song-title"], .song-title, [class*="songTitle"]');
          if (titleEl) title = titleEl.textContent.trim();

          let lyrics = '';
          const lyricsEl = document.querySelector('.lyrics, [data-testid="lyrics-content"], pre, [class*="lyricsContent"]');
          if (lyricsEl) lyrics = lyricsEl.textContent.trim();

          let style = '';
          const styleEl = document.querySelector('[data-testid="style-tags"], .style-prompt, [class*="styleTags"]');
          if (styleEl) style = styleEl.textContent.trim();

          floatBtn.textContent = '⏳ Aktarılıyor...';
          floatBtn.disabled = true;
          sendToVault('music', {
            title: title || 'Suno Şarkısı', lyrics, style, suno_id: songId, suno_url: url, generator: 'suno'
          }, (data) => {
            floatBtn.innerHTML = '✓ Aktarıldı!';
            showToast(`"${data.title || title}" müzik kasasına aktarıldı! 🎵`);
            setTimeout(() => { floatBtn.innerHTML = '⚡ Suno\'yu Vault\'a Aktar'; floatBtn.disabled = false; }, 3000);
          }, (err) => {
            floatBtn.innerHTML = '❌ Hata';
            showToast(err, false);
            setTimeout(() => { floatBtn.innerHTML = '⚡ Suno\'yu Vault\'a Aktar'; floatBtn.disabled = false; }, 3000);
          });
        };
        document.body.appendChild(floatBtn);
      }
    }

    setInterval(attachSunoButtons, 2000);
  }

  // ===================================================================
  // 2. GOOGLE GEMINI (gemini.google.com)
  // ===================================================================
  function initGemini() {
    if (!window.location.hostname.includes('gemini.google.com')) return;

    function attachGeminiButtons() {
      // Find generated images in chat
      const images = document.querySelectorAll('img[src*="googleusercontent.com"]:not([data-pv-injected])');
      images.forEach(img => {
        // Skip user avatar images (small)
        if (img.width < 120 && img.height < 120) return;
        img.dataset.pvInjected = 'true';

        // Find enclosing turn or bubble to extract prompt
        const turn = img.closest('.turn-container, .response-container, conversation-turn') || img.parentElement;
        let promptText = '';
        if (turn) {
          const prevUserTurn = turn.previousElementSibling || turn.closest('.conversation-container')?.querySelector('.user-query-container');
          if (prevUserTurn) {
            promptText = prevUserTurn.textContent.trim();
          }
        }

        // Overlay button container
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position: relative; display: inline-block;';
        img.parentNode.insertBefore(wrap, img);
        wrap.appendChild(img);

        const btn = createVaultButton('⚡ Vault\'a Gönder');
        btn.style.position = 'absolute';
        btn.style.top = '10px';
        btn.style.right = '10px';
        btn.style.zIndex = '50';

        btn.onclick = async (e) => {
          e.stopPropagation();
          e.preventDefault();
          btn.textContent = '⏳ Gönderiliyor...';
          btn.disabled = true;

          const b64 = await imgToBase64(img);
          sendToVault('image', {
            prompt: promptText || 'Gemini Generated Image',
            generator: 'gemini',
            image_b64: b64,
            source_url: window.location.href,
          }, () => {
            btn.innerHTML = '✓ Eklendi!';
            showToast('Gemini görseli ve promptu kasaya kaydedildi! 🎨');
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

        wrap.appendChild(btn);
      });

      // Persistent floating button on Gemini
      if (!document.getElementById('pv-gemini-floating-btn')) {
        const floatBtn = createVaultButton('⚡ Gemini\'yi Vault\'a Gönder');
        floatBtn.id = 'pv-gemini-floating-btn';
        floatBtn.style.position = 'fixed';
        floatBtn.style.bottom = '24px';
        floatBtn.style.left = '24px';
        floatBtn.style.zIndex = '2147483647';
        floatBtn.style.padding = '10px 18px';
        floatBtn.style.fontSize = '13.5px';
        floatBtn.style.fontWeight = 'bold';
        floatBtn.style.boxShadow = '0 6px 25px rgba(0,0,0,0.7)';
        floatBtn.onclick = async () => {
          const allImgs = [...document.querySelectorAll('img')].filter(i => (i.naturalWidth > 120 || i.width > 120));
          const lastImg = allImgs[allImgs.length - 1];
          if (!lastImg) {
            showToast('Sayfada aktarılacak Gemini görseli bulunamadı!', false);
            return;
          }
          floatBtn.textContent = '⏳ Gönderiliyor...';
          floatBtn.disabled = true;
          const b64 = await imgToBase64(lastImg);
          const turn = lastImg.closest('.turn-container, .response-container, conversation-turn') || lastImg.parentElement;
          let promptText = '';
          if (turn) {
            const prevUserTurn = turn.previousElementSibling || turn.closest('.conversation-container')?.querySelector('.user-query-container');
            if (prevUserTurn) promptText = prevUserTurn.textContent.trim();
          }
          sendToVault('image', {
            prompt: promptText || 'Gemini Generated Image',
            generator: 'gemini',
            image_b64: b64,
            source_url: window.location.href,
          }, () => {
            floatBtn.innerHTML = '✓ Aktarıldı!';
            showToast('Gemini görseli ve promptu kasaya kaydedildi! 🎨');
            setTimeout(() => { floatBtn.innerHTML = '⚡ Gemini\'yi Vault\'a Gönder'; floatBtn.disabled = false; }, 3000);
          }, (err) => {
            floatBtn.innerHTML = '❌ Hata';
            showToast(err, false);
            setTimeout(() => { floatBtn.innerHTML = '⚡ Gemini\'yi Vault\'a Gönder'; floatBtn.disabled = false; }, 3000);
          });
        };
        document.body.appendChild(floatBtn);
      }
    }

    setInterval(attachGeminiButtons, 2000);
  }

  // ===================================================================
  // 3. CHATGPT / DALL-E (chatgpt.com)
  // ===================================================================
  function initChatGPT() {
    if (!window.location.hostname.includes('chatgpt.com')) return;

    function attachChatGPTButtons() {
      // Find DALL-E generated images
      const images = document.querySelectorAll('img[alt]:not([data-pv-injected])');
      images.forEach(img => {
        // Skip icons/avatars
        if (img.width < 150 && img.height < 150) return;
        if (!img.src || img.src.startsWith('data:image/svg')) return;
        img.dataset.pvInjected = 'true';

        const promptText = img.alt || '';

        const wrap = document.createElement('div');
        wrap.style.cssText = 'position: relative; display: inline-block;';
        img.parentNode.insertBefore(wrap, img);
        wrap.appendChild(img);

        const btn = createVaultButton('⚡ Vault\'a Gönder');
        btn.style.position = 'absolute';
        btn.style.top = '10px';
        btn.style.right = '10px';
        btn.style.zIndex = '50';

        btn.onclick = async (e) => {
          e.stopPropagation();
          e.preventDefault();
          btn.textContent = '⏳ Gönderiliyor...';
          btn.disabled = true;

          const b64 = await imgToBase64(img);
          sendToVault('image', {
            prompt: promptText || 'ChatGPT Generated Image',
            generator: 'chatgpt',
            image_b64: b64,
            source_url: window.location.href,
          }, () => {
            btn.innerHTML = '✓ Eklendi!';
            showToast('ChatGPT görseli ve promptu kasaya kaydedildi! 🎨');
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

        wrap.appendChild(btn);
      });

      // Persistent floating button on ChatGPT
      if (!document.getElementById('pv-chatgpt-floating-btn')) {
        const floatBtn = createVaultButton('⚡ ChatGPT\'yi Vault\'a Gönder');
        floatBtn.id = 'pv-chatgpt-floating-btn';
        floatBtn.style.position = 'fixed';
        floatBtn.style.bottom = '24px';
        floatBtn.style.left = '24px';
        floatBtn.style.zIndex = '2147483647';
        floatBtn.style.padding = '10px 18px';
        floatBtn.style.fontSize = '13.5px';
        floatBtn.style.fontWeight = 'bold';
        floatBtn.style.boxShadow = '0 6px 25px rgba(0,0,0,0.7)';
        floatBtn.onclick = async () => {
          const allImgs = [...document.querySelectorAll('img')].filter(i => (i.naturalWidth > 150 || i.width > 150) && !i.src.startsWith('data:image/svg'));
          const lastImg = allImgs[allImgs.length - 1];
          if (!lastImg) {
            showToast('Sayfada aktarılacak ChatGPT görseli bulunamadı!', false);
            return;
          }
          floatBtn.textContent = '⏳ Gönderiliyor...';
          floatBtn.disabled = true;
          const b64 = await imgToBase64(lastImg);
          const promptText = lastImg.alt || 'ChatGPT Generated Image';
          sendToVault('image', {
            prompt: promptText,
            generator: 'chatgpt',
            image_b64: b64,
            source_url: window.location.href,
          }, () => {
            floatBtn.innerHTML = '✓ Aktarıldı!';
            showToast('ChatGPT görseli ve promptu kasaya kaydedildi! 🎨');
            setTimeout(() => { floatBtn.innerHTML = '⚡ ChatGPT\'yi Vault\'a Gönder'; floatBtn.disabled = false; }, 3000);
          }, (err) => {
            floatBtn.innerHTML = '❌ Hata';
            showToast(err, false);
            setTimeout(() => { floatBtn.innerHTML = '⚡ ChatGPT\'yi Vault\'a Gönder'; floatBtn.disabled = false; }, 3000);
          });
        };
        document.body.appendChild(floatBtn);
      }
    }

    setInterval(attachChatGPTButtons, 2000);
  }

  // ===================================================================
  // 4. FLOW / IMAGEFX (labs.google/fx or aitestkitchen)
  // ===================================================================
  function initFlow() {
    if (!window.location.hostname.includes('labs.google') && !window.location.hostname.includes('aitestkitchen')) return;

    function attachFlowButtons() {
      const images = document.querySelectorAll('img:not([data-pv-injected])');
      images.forEach(img => {
        if (img.width < 180 && img.height < 180) return;
        img.dataset.pvInjected = 'true';

        // Find prompt input on page
        const promptInput = document.querySelector('textarea, [contenteditable="true"]');
        const promptText = promptInput ? promptInput.textContent || promptInput.value : '';

        const wrap = document.createElement('div');
        wrap.style.cssText = 'position: relative; display: inline-block;';
        img.parentNode.insertBefore(wrap, img);
        wrap.appendChild(img);

        const btn = createVaultButton('⚡ Vault\'a Gönder');
        btn.style.position = 'absolute';
        btn.style.top = '10px';
        btn.style.right = '10px';
        btn.style.zIndex = '50';

        btn.onclick = async (e) => {
          e.stopPropagation();
          e.preventDefault();
          btn.textContent = '⏳ Gönderiliyor...';
          btn.disabled = true;

          const b64 = await imgToBase64(img);
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

        wrap.appendChild(btn);
      });
    }

    setInterval(attachFlowButtons, 2000);
  }

  // Initialize for current domain
  initSuno();
  initGemini();
  initChatGPT();
  initFlow();
})();
