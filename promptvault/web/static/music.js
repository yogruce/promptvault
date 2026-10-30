// =====================================================================
// PromptVault ◈ Müzik & Suno AI Modülü (music.js)
// =====================================================================
(function() {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  const state = {
    domain: 'images', // 'images' | 'music'
    tab: 'songs',
    q: '',
    workspaceId: null,
    artist: '',
    sort: 'added',
    limit: 40,
    offset: 0,
    total: 0,
    selected: new Set(),
    lastSelectedIdx: null,
    workspaces: [],
    songs: [],
    audioPlayer: null,
    viewMode: localStorage.getItem('pv.musicViewMode') || 'grid',
    expandAll: localStorage.getItem('pv.musicExpandAll') === 'true',
  };

  // Toast helper
  function toast(msg, isErr = false) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.style.borderColor = isErr ? 'var(--danger)' : 'var(--accent)';
    t.classList.remove('hidden');
    clearTimeout(toast._tm);
    toast._tm = setTimeout(() => t.classList.add('hidden'), 3200);
  }

  // Escape HTML
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Format lyrics with highlighted structure tags and arrangement cues
  function formatLyrics(lyrics) {
    if (!lyrics) return '<span class="muted">Şarkı sözü bulunamadı</span>';
    const escaped = escapeHtml(lyrics);
    return escaped.replace(/\[([^\]\r\n]+)\]/g, (match, content) => {
      if (content.includes('|')) {
        const parts = content.split('|');
        const sec = parts[0].trim();
        const cue = parts.slice(1).join('|').trim();
        return `<div class="lyric-block-header"><span class="lyric-tag">[${sec}]</span> <span class="lyric-cue">| ${cue}</span></div>`;
      }
      return `<div class="lyric-block-header"><span class="lyric-tag">[${content}]</span></div>`;
    });
  }

  // Render song card lyrics preview (either pure clean lyrics or tagged)
  function renderLyricsPreview(song, mode = 'clean') {
    if (!song || !song.lyrics) return '<span class="muted">Şarkı sözü bulunamadı</span>';
    if (mode === 'clean') {
      const cleanLines = cleanLyricsForSync(song.lyrics);
      if (!cleanLines.length) return '<span class="muted">Şarkı sözü bulunamadı</span>';
      return cleanLines.map(escapeHtml).join('\n');
    }
    return formatLyrics(song.lyrics);
  }

  // API Client Helper
  async function api(path, opts = {}) {
    const res = await fetch(path, opts);
    if (!res.ok) {
      let errText = 'Hata oluştu';
      try {
        const data = await res.json();
        errText = data.detail || JSON.stringify(data);
      } catch (e) {
        errText = await res.text();
      }
      throw new Error(errText);
    }
    return res.json();
  }

  // ===================================================================
  // DOMAIN SWITCHER (Görseller vs Müzik)
  // ===================================================================
  function initDomainSwitcher() {
    const btnImages = $('#btnDomainImages');
    const btnMusic = $('#btnDomainMusic');
    const viewImages = $('#view-images');
    const viewMusic = $('#view-music');
    const navImages = $('#tabs');
    const navMusic = $('#tabs-music');

    if (!btnImages || !btnMusic) return;

    btnImages.addEventListener('click', () => switchDomain('images'));
    btnMusic.addEventListener('click', () => switchDomain('music'));

    function switchDomain(domain) {
      state.domain = domain;
      const viewSettings = $('#view-settings');
      const btnSettings = $('#btnGlobalSettings');
      viewSettings?.classList.add('hidden');
      btnSettings?.classList.remove('active');

      if (domain === 'images') {
        btnImages.classList.add('active');
        btnMusic.classList.remove('active');
        viewImages.classList.remove('hidden');
        viewMusic.classList.add('hidden');
        navImages.classList.remove('hidden');
        navMusic.classList.add('hidden');
        if (window.G && window.G.items.length === 0 && window.loadGallery) {
          window.loadGallery();
        }
      } else {
        btnMusic.classList.add('active');
        btnImages.classList.remove('active');
        viewMusic.classList.remove('hidden');
        viewImages.classList.add('hidden');
        navMusic.classList.remove('hidden');
        navImages.classList.add('hidden');

        // Initial load for music
        loadWorkspaces();
        loadSongs();
        loadMusicStats();
      }
    }

    // Music Tabs
    $$('#tabs-music button').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#tabs-music button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const targetTab = btn.dataset.musicTab;
        state.tab = targetTab;
        $$('.music-tab').forEach(sec => sec.classList.remove('active'));
        const activeSec = $(`#tab-music-${targetTab}`);
        if (activeSec) activeSec.classList.add('active');

        if (targetTab === 'songs') loadSongs();
        if (targetTab === 'workspaces') loadWorkspacesTab();
        if (targetTab === 'styles') loadStyleTags();
      });
    });
  }

  // ===================================================================
  // STATS & WORKSPACES
  // ===================================================================
  async function loadMusicStats() {
    try {
      const s = await api('/api/music/stats');
      const el = $('#musicStatsText');
      if (el) {
        const songW = window.t ? window.t("music_stats_songs") : "Şarkı";
        const wsW = window.t ? window.t("music_stats_workspaces") : "Workspace";
        const favW = window.t ? window.t("music_stats_favorites") : "Favori";
        const audW = window.t ? window.t("music_stats_audio") : "Sesli";
        el.textContent = `🎵 ${s.total_songs} ${songW} · 🏢 ${s.total_workspaces} ${wsW} · ⭐ ${s.favorites} ${favW} · 🔊 ${s.with_audio} ${audW}`;
      }
    } catch (e) {}
  }
  window.renderMusicStats = loadMusicStats;

  async function loadWorkspaces() {
    try {
      const list = await api('/api/music/workspaces');
      state.workspaces = list;
      populateWorkspaceDropdowns();
    } catch (e) {
      console.error('Workspaces yüklenemedi:', e);
    }
  }

  function populateWorkspaceDropdowns() {
    // 1. Filter dropdown in songs toolbar
    const selFilter = $('#musicWsFilter');
    if (selFilter) {
      const cur = selFilter.value;
      const allWsText = window.t ? window.t("music_all_workspaces") : "🏢 Tüm Workspaces (Hepsi)";
      selFilter.innerHTML = `<option value="">${allWsText}</option>`;
      state.workspaces.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = `${w.icon || '🎵'} ${w.name} (${w.song_count || 0})`;
        selFilter.appendChild(opt);
      });
      selFilter.value = cur;
    }

    // 2. Dropdown in manual add / upload modal
    const selModal = $('#muWorkspace');
    if (selModal) {
      selModal.innerHTML = '<option value="">(Belirtilmemiş / Genel)</option>';
      state.workspaces.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = `${w.icon || '🎵'} ${w.name}`;
        selModal.appendChild(opt);
      });
    }

    // 3. Dropdown in scan tab
    const selScan = $('#mScanWorkspace');
    if (selScan) {
      selScan.innerHTML = '<option value="">(Belirtilmemiş / Genel)</option>';
      state.workspaces.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = `${w.icon || '🎵'} ${w.name}`;
        selScan.appendChild(opt);
      });
    }

    // 4. Dropdown in bulk toolbar
    const selBulk = $('#musicBulkWs');
    if (selBulk) {
      selBulk.innerHTML = '<option value="">Seçilenleri Çalışma Alanına Taşı...</option>';
      state.workspaces.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = `${w.icon || '🎵'} ${w.name}`;
        selBulk.appendChild(opt);
      });
    }

    // 5. Dropdown in Quick Import Modal (for Music)
    const selQiMusic = $('#qiMusicWorkspace');
    if (selQiMusic) {
      selQiMusic.innerHTML = '';
      state.workspaces.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = `${w.icon || '🎵'} ${w.name}`;
        selQiMusic.appendChild(opt);
      });
      const genel = state.workspaces.find(w => w.name === 'Genel');
      if (genel) selQiMusic.value = String(genel.id);
    }
  }

  // ===================================================================
  // SONGS LIST & SEARCH
  // ===================================================================
  async function loadSongs(offset = 0) {
    state.offset = offset;
    const params = new URLSearchParams({
      q: state.q,
      sort: state.sort,
      limit: state.limit,
      offset: state.offset,
    });
    if (state.workspaceId) params.append('workspace_id', state.workspaceId);
    if (state.artist) params.append('artist', state.artist);

    const listEl = $('#musicSongGrid');
    const emptyEl = $('#musicEmpty');
    const infoEl = $('#musicResultInfo');
    if (!listEl) return;

    try {
      const data = await api(`/api/music/songs?${params.toString()}`);
      state.total = data.total;
      state.songs = data.items;

      if (infoEl) {
        infoEl.textContent = `${data.total} şarkı bulundu (Gösterilen: ${data.items.length})`;
      }

      if (data.total === 0) {
        listEl.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
      }

      if (emptyEl) emptyEl.classList.add('hidden');
      renderSongCards(data.items, listEl);
    } catch (e) {
      toast('Şarkılar yüklenirken hata: ' + e.message, true);
    }
  }

  function renderSongCards(songs, container) {
    container.innerHTML = '';
    songs.forEach((song, idx) => {
      const card = document.createElement('div');
      card.className = 'song-card' + (state.selected.has(song.id) ? ' selected' : '');
      card.dataset.id = song.id;
      card.dataset.idx = idx;

      const wsColor = song.workspace_color || '#8b5cf6';
      const wsName = song.workspace_name || 'Genel';
      const artist = song.artist || 'Bilinmeyen Sanatçı';
      const ratingStars = renderStars(song.id, song.rating || 0);
      const safeCardTitle = (song.title || 'song').replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim() || 'song';

      card.innerHTML = `
        <div class="song-card-header">
          <div class="chk" title="Seç">${state.selected.has(song.id) ? '✓' : ''}</div>
          <div class="song-badges">
            <span class="song-ws-badge" style="background:${wsColor}22; color:${wsColor}; border:1px solid ${wsColor}66">
              📁 ${escapeHtml(wsName)}
            </span>
            ${song.persona ? `<span class="song-persona-badge" title="Suno Persona">🎭 ${escapeHtml(song.persona)}</span>` : ''}
            ${song.has_synced_lyrics ? `<span class="song-synced-badge" title="Senkronize LRC ve SRT hazır">🎙️ LRC/SRT</span>` : ''}
            <span class="song-model-badge">${escapeHtml(song.model || 'Suno AI')}</span>
          </div>
          <button class="song-fav-btn ${song.favorite ? 'on' : ''}" data-id="${song.id}" title="Favori">★</button>
        </div>

        <div class="song-main">
          <div class="song-title-row">
            <h3 class="song-title" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</h3>
            <span class="song-artist" title="Sanatçı/Grup">👤 ${escapeHtml(artist)}</span>
          </div>

          ${song.has_audio ? `
            <div class="song-audio-box">
              <audio controls preload="none" src="/api/music/songs/${song.id}/audio" style="width:100%; height:32px;"></audio>
            </div>
          ` : `
            <div class="song-no-audio">${window.t ? window.t('no_audio_hint') : '📄 Sadece Söz ve Stil Promptu'}</div>
          `}

          <!-- STYLE PROMPT BOX -->
          <div class="song-style-box">
            <div class="song-section-label">
              <span>${window.t ? window.t('card_style_label') : '🎯 TAM STİL / PROMPT'}</span>
              <button type="button" class="btn-copy-style ghost small" data-style="${escapeHtml(song.style)}" title="Promptu kopyala">${window.t ? window.t('btn_copy_style') : '📋 Kopyala'}</button>
            </div>
            <div class="song-style-content" title="Genişletmek / daraltmak için tıklayın">${escapeHtml(song.style || 'Stil belirtilmemiş')}</div>
          </div>

          <!-- LYRICS PREVIEW -->
          <div class="song-lyrics-box">
            <div class="song-section-label">
              <span>${window.t ? window.t('card_lyrics_label') : '📄 ŞARKI SÖZLERİ'}</span>
              <div style="display:inline-flex; gap:6px;">
                <button type="button" class="btn-copy-clean-lyrics ghost small" data-id="${song.id}" title="Suno AI etiketleri olmadan saf şarkı sözlerini kopyala">${window.t ? window.t('btn_copy_clean') : '📋 Tagsız Kopyala'}</button>
                <button type="button" class="btn-toggle-lyrics ghost small" title="Şarkı sözlerini kartta genişlet/daralt">${window.t ? window.t('btn_expand') : '📖 Genişlet'}</button>
              </div>
            </div>
            <div class="song-lyrics-preview">${formatLyrics(song.lyrics)}</div>
          </div>
        </div>

        <div class="song-card-footer">
          <div class="song-stars">${ratingStars}</div>
          <div class="song-actions">
            ${song.has_audio ? `<button class="btn-open-sync ghost small" data-id="${song.id}" title="DistroKid tarzı şarkı sözü senkronla">🎙️ Senkronla</button>` : ''}
            ${song.has_synced_lyrics ? `
              <a href="/api/music/songs/${song.id}/download/lrc" download="${escapeHtml(safeCardTitle)}.lrc" class="ghost small" title="LRC formatında indir">📥 LRC</a>
              <a href="/api/music/songs/${song.id}/download/srt" download="${escapeHtml(safeCardTitle)}.srt" class="ghost small" title="SRT altyazı indir">📥 SRT</a>
            ` : ''}
            ${song.suno_url ? `<a href="${song.suno_url}" target="_blank" class="btn-suno ghost small" title="Suno sayfasında aç">🔗 Suno</a>` : ''}
            <button class="btn-edit-song ghost small" data-id="${song.id}" title="Düzenle">✏ Düzenle</button>
            <button class="btn-delete-song ghost small danger" data-id="${song.id}" title="Sil">🗑</button>
          </div>
        </div>
      `;

      // Event listeners for card
      // 1. Checkbox toggle / selection
      const chk = card.querySelector('.chk');
      chk.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSelect(song.id, idx, e.shiftKey);
      });

      // 2. Favorite toggle
      const favBtn = card.querySelector('.song-fav-btn');
      favBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const newFav = !song.favorite;
        try {
          await api(`/api/music/songs/${song.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ favorite: newFav }),
          });
          song.favorite = newFav;
          favBtn.classList.toggle('on', newFav);
          loadMusicStats();
        } catch (err) {
          toast('Favori güncellenemedi: ' + err.message, true);
        }
      });

      // 3. Stars rating
      card.querySelectorAll('.star').forEach(st => {
        st.addEventListener('click', async (e) => {
          e.stopPropagation();
          const r = parseInt(st.dataset.val, 10);
          try {
            await api(`/api/music/songs/${song.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rating: r }),
            });
            song.rating = r;
            card.querySelector('.song-stars').innerHTML = renderStars(song.id, r);
            toast(`Puan verildi: ${r} Yıldız`);
          } catch (err) {
            toast('Puan kaydedilemedi: ' + err.message, true);
          }
        });
      });

      // 4. Copy style
      const btnCopy = card.querySelector('.btn-copy-style');
      btnCopy?.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(song.style || '');
        toast('Suno Stil Promptu panoya kopyalandı! 📋');
      });

      // 4.1 Click style prompt to open detail
      const styleContent = card.querySelector('.song-style-content');
      styleContent?.addEventListener('click', (e) => {
        e.stopPropagation();
        openSongDetail(idx);
      });

      // 5. Copy clean lyrics (tagless)
      const btnCopyClean = card.querySelector('.btn-copy-clean-lyrics');
      btnCopyClean?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const cleanLines = cleanLyricsForSync(song.lyrics || '');
        if (!cleanLines.length) return toast('Kopyalanacak şarkı sözü bulunamadı!', true);
        await navigator.clipboard.writeText(cleanLines.join('\n'));
        toast('✓ Saf şarkı sözleri (tagsız) panoya kopyalandı! 📋');
      });

      // 5.1 Open Song Detail Modal on "Genişlet" button (just like Image Gallery detail)
      const btnToggleLyrics = card.querySelector('.btn-toggle-lyrics');
      btnToggleLyrics?.addEventListener('click', (e) => {
        e.stopPropagation();
        openSongDetail(idx);
      });

      // 5.2 Stop propagation on audio clicks so card click doesn't fire
      const cardAudio = card.querySelector('audio');
      cardAudio?.addEventListener('click', (e) => e.stopPropagation());

      // 5.3 Clicking anywhere on card (except buttons, links, audio, chk, stars) opens Song Detail
      card.addEventListener('click', (e) => {
        if (e.target.closest('button, a, audio, .chk, .star, .song-fav-btn')) return;
        openSongDetail(idx);
      });

      // 5.1 Open Lyrics Synchronizer
      const btnSync = card.querySelector('.btn-open-sync');
      if (btnSync) {
        btnSync.addEventListener('click', (e) => {
          e.stopPropagation();
          openSyncModal(song);
        });
      }

      // 6. Edit song
      const btnEdit = card.querySelector('.btn-edit-song');
      btnEdit.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditSongModal(song);
      });

      // 7. Delete song
      const btnDel = card.querySelector('.btn-delete-song');
      btnDel.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`"${song.title}" adlı şarkıyı kasadan silmek istediğinize emin misiniz?`)) return;
        try {
          await api(`/api/music/songs/${song.id}`, { method: 'DELETE' });
          card.remove();
          toast('Şarkı silindi');
          loadMusicStats();
        } catch (err) {
          toast('Silinemedi: ' + err.message, true);
        }
      });

      container.appendChild(card);
    });
  }

  function renderStars(songId, rating) {
    let html = '';
    for (let i = 1; i <= 5; i++) {
      html += `<span class="star ${i <= rating ? 'on' : ''}" data-val="${i}">★</span>`;
    }
    return html;
  }

  // ===================================================================
  // SELECTION & BULK ACTIONS
  // ===================================================================
  function toggleSelect(id, idx, isShift) {
    if (isShift && state.lastSelectedIdx !== null && state.songs.length > 0) {
      const start = Math.min(state.lastSelectedIdx, idx);
      const end = Math.max(state.lastSelectedIdx, idx);
      for (let i = start; i <= end; i++) {
        state.selected.add(state.songs[i].id);
      }
    } else {
      if (state.selected.has(id)) {
        state.selected.delete(id);
      } else {
        state.selected.add(id);
      }
    }
    state.lastSelectedIdx = idx;
    updateBulkBar();
    refreshSelectionUI();
  }

  function updateBulkBar() {
    const bar = $('#musicBulkBar');
    const cnt = $('#musicBulkCount');
    if (!bar) return;
    if (state.selected.size > 0) {
      bar.classList.remove('hidden');
      if (cnt) cnt.textContent = `${state.selected.size} seçili`;
    } else {
      bar.classList.add('hidden');
    }
  }

  function refreshSelectionUI() {
    $$('.song-card').forEach(card => {
      const id = parseInt(card.dataset.id, 10);
      const isSel = state.selected.has(id);
      card.classList.toggle('selected', isSel);
      const chk = card.querySelector('.chk');
      if (chk) chk.textContent = isSel ? '✓' : '';
    });
  }

  // ===================================================================
  // WORKSPACES TAB
  // ===================================================================
  async function loadWorkspacesTab() {
    const grid = $('#workspacesGrid');
    if (!grid) return;
    try {
      const list = await api('/api/music/workspaces');
      state.workspaces = list;
      populateWorkspaceDropdowns();

      grid.innerHTML = '';
      list.forEach(w => {
        const card = document.createElement('div');
        card.className = 'workspace-card';
        card.style.borderColor = w.color || 'var(--line)';

        const isGenel = w.name === 'Genel';
        card.innerHTML = `
          <div class="ws-header">
            <span class="ws-icon" style="background:${w.color}22; color:${w.color}">${escapeHtml(w.icon || '🎵')}</span>
            <div class="ws-info">
              <h3 class="ws-name">${escapeHtml(w.name)}</h3>
              <p class="ws-desc muted small">${escapeHtml(w.description || 'Açıklama yok')}</p>
            </div>
            <span class="ws-badge">${w.song_count || 0} Şarkı</span>
          </div>
          <div class="ws-actions">
            <button class="btn-ws-filter ghost small" data-id="${w.id}">🔍 Bu Alandaki Şarkıları Göster</button>
            <div style="flex:1"></div>
            <button class="btn-ws-edit ghost small" data-id="${w.id}">✏ Düzenle</button>
            ${isGenel ? '' : `<button class="btn-ws-del ghost small danger" data-id="${w.id}">🗑 Sil</button>`}
          </div>
        `;

        card.querySelector('.btn-ws-filter').addEventListener('click', () => {
          state.workspaceId = w.id;
          const sel = $('#musicWsFilter');
          if (sel) sel.value = w.id;
          $('#tab-music-songs-btn').click();
          loadSongs();
        });

        card.querySelector('.btn-ws-edit').addEventListener('click', () => openWorkspaceModal(w));

        card.querySelector('.btn-ws-del')?.addEventListener('click', async () => {
          if (!confirm(`"${w.name}" çalışma alanını silmek istiyor musunuz? (İçindeki şarkılar silinmez, Genel alanına geçer)`)) return;
          try {
            await api(`/api/music/workspaces/${w.id}`, { method: 'DELETE' });
            toast('Müzik çalışma alanı silindi');
            loadWorkspacesTab();
            loadWorkspaces();
          } catch (e) {
            toast('Silinemedi: ' + e.message, true);
          }
        });

        grid.appendChild(card);
      });
    } catch (e) {
      toast('Workspaces yüklenemedi: ' + e.message, true);
    }
  }

  // ===================================================================
  // STYLES & TAGS TAB
  // ===================================================================
  async function loadStyleTags() {
    const container = $('#musicTagsCloud');
    if (!container) return;
    try {
      const tags = await api('/api/music/tags?limit=150');
      container.innerHTML = '';
      if (tags.length === 0) {
        container.innerHTML = '<div class="muted">Henüz kaydedilmiş müzik stili etiketi yok.</div>';
        return;
      }
      tags.forEach(t => {
        const chip = document.createElement('div');
        chip.className = 'music-tag-chip';
        chip.innerHTML = `<span class="tname">${escapeHtml(t.name)}</span> <span class="tcnt">${t.count}</span>`;
        chip.addEventListener('click', () => {
          state.q = `style:"${t.name}"`;
          const inputQ = $('#musicQ');
          if (inputQ) inputQ.value = state.q;
          $('#tab-music-songs-btn').click();
          loadSongs();
        });
        container.appendChild(chip);
      });
    } catch (e) {
      toast('Stiller yüklenemedi: ' + e.message, true);
    }
  }

  // Clock formatting helper
  function fmtClock(t) {
    t = Math.max(0, parseFloat(t) || 0);
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
  }

  // ===================================================================
  // MODALS
  // ===================================================================
  // 1. Song Detail & Expansion Modal (Mirrors Gallery Detail Modal)
  function openSongDetail(target) {
    let idx = -1;
    if (typeof target === 'number') {
      idx = target;
    } else if (target && target.id) {
      idx = state.songs.findIndex(s => s.id === target.id);
    }
    if (idx < 0 || idx >= state.songs.length) return;
    state.currentSongIdx = idx;
    const song = state.songs[idx];
    const modal = $('#musicLyricsModal');
    if (!modal) return;

    // Title
    $('#mlTitle').textContent = song.title || 'İsimsiz Şarkı';

    // Badges
    const wsColor = song.workspace_color || '#8b5cf6';
    const wsName = song.workspace_name || 'Genel';
    const artist = song.artist || 'Bilinmeyen Sanatçı';
    const badgesHtml = `
      <span class="song-ws-badge" style="background:${wsColor}22; color:${wsColor}; border:1px solid ${wsColor}66">
        📁 ${escapeHtml(wsName)}
      </span>
      ${song.persona ? `<span class="song-persona-badge" title="Suno Persona">🎭 ${escapeHtml(song.persona)}</span>` : ''}
      <span class="song-artist" style="font-size:13px; font-weight:600; color:var(--accent2); margin:0 4px;">👤 ${escapeHtml(artist)}</span>
      <span class="song-model-badge">${escapeHtml(song.model || 'Suno AI')}</span>
      ${song.has_synced_lyrics ? `<span class="song-synced-badge" title="Senkronize LRC ve SRT hazır">🎙️ LRC/SRT</span>` : ''}
    `;
    const badgesEl = $('#mlBadges');
    if (badgesEl) badgesEl.innerHTML = badgesHtml;

    // Audio Player
    const audioEl = $('#mlAudio');
    const playerBox = $('#mlPlayerBox');
    if (audioEl) {
      if (song.has_audio) {
        audioEl.src = `/api/music/songs/${song.id}/audio`;
        playerBox?.classList.remove('hidden');
      } else {
        audioEl.pause();
        audioEl.src = '';
        playerBox?.classList.add('hidden');
      }
    }

    // Stars rating
    const starsEl = $('#mlStars');
    if (starsEl) {
      starsEl.innerHTML = renderStars(song.id, song.rating || 0);
      starsEl.querySelectorAll('.star').forEach(st => {
        st.onclick = async (e) => {
          e.stopPropagation();
          const r = parseInt(st.dataset.val, 10);
          try {
            await api(`/api/music/songs/${song.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rating: r }),
            });
            song.rating = r;
            starsEl.innerHTML = renderStars(song.id, r);
            const cardStar = $(`#musicSongList .song-card[data-id="${song.id}"] .song-stars`);
            if (cardStar) cardStar.innerHTML = renderStars(song.id, r);
            toast(`Puan verildi: ${r} Yıldız`);
          } catch (err) {
            toast('Puan kaydedilemedi: ' + err.message, true);
          }
        };
      });
    }

    // Favorite Button
    const favBtn = $('#mlFavBtn');
    if (favBtn) {
      favBtn.textContent = song.favorite
        ? (window.t ? window.t('detail_fav_on') : '★ Favori')
        : (window.t ? window.t('detail_fav_off') : '☆ Favori');
      favBtn.classList.toggle('active', !!song.favorite);
      favBtn.onclick = async (e) => {
        e.stopPropagation();
        const newFav = !song.favorite;
        try {
          await api(`/api/music/songs/${song.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ favorite: newFav }),
          });
          song.favorite = newFav;
          favBtn.textContent = newFav
            ? (window.t ? window.t('detail_fav_on') : '★ Favori')
            : (window.t ? window.t('detail_fav_off') : '☆ Favori');
          favBtn.classList.toggle('active', newFav);
          const cardFav = $(`#musicSongList .song-card[data-id="${song.id}"] .song-fav-btn`);
          if (cardFav) cardFav.classList.toggle('on', newFav);
          loadMusicStats();
        } catch (err) {
          toast('Favori güncellenemedi: ' + err.message, true);
        }
      };
    }

    // Suno Link
    const sunoLink = $('#mlSunoLink');
    if (sunoLink) {
      if (song.suno_url) {
        sunoLink.href = song.suno_url;
        sunoLink.classList.remove('hidden');
      } else {
        sunoLink.classList.add('hidden');
      }
    }

    // Downloads
    const safeTitle = (song.title || 'Suno_Sarkisi').replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim() || 'song';
    const dlTxt = $('#mlDlTxt');
    const dlLrc = $('#mlDlLrc');
    const dlSrt = $('#mlDlSrt');
    const dlAudio = $('#mlDlAudio');
    if (dlTxt) {
      dlTxt.href = `/api/music/songs/${song.id}/download/txt`;
      dlTxt.setAttribute('download', `${safeTitle}_metadata.txt`);
    }
    if (song.has_synced_lyrics) {
      if (dlLrc) {
        dlLrc.href = `/api/music/songs/${song.id}/download/lrc`;
        dlLrc.setAttribute('download', `${safeTitle}.lrc`);
        dlLrc.classList.remove('hidden');
      }
      if (dlSrt) {
        dlSrt.href = `/api/music/songs/${song.id}/download/srt`;
        dlSrt.setAttribute('download', `${safeTitle}.srt`);
        dlSrt.classList.remove('hidden');
      }
    } else {
      if (dlLrc) dlLrc.classList.add('hidden');
      if (dlSrt) dlSrt.classList.add('hidden');
    }
    if (song.has_audio && dlAudio) {
      dlAudio.href = `/api/music/songs/${song.id}/download/audio`;
      dlAudio.setAttribute('download', `${safeTitle}.mp3`);
      dlAudio.classList.remove('hidden');
    } else if (dlAudio) {
      dlAudio.classList.add('hidden');
    }

    // Edit button inside detail modal
    const editBtn = $('#mlEditBtn');
    if (editBtn) {
      editBtn.onclick = () => {
        closeSongDetailModal();
        openEditSongModal(song);
      };
    }

    // Delete button inside detail modal
    const deleteBtn = $('#mlDeleteBtn');
    if (deleteBtn) {
      deleteBtn.onclick = async () => {
        if (!confirm(`"${song.title}" adlı şarkıyı kasadan silmek istediğinize emin misiniz?`)) return;
        try {
          await api(`/api/music/songs/${song.id}`, { method: 'DELETE' });
          closeSongDetailModal();
          state.songs = state.songs.filter(s => s.id !== song.id);
          const card = $(`#musicSongList .song-card[data-id="${song.id}"]`);
          if (card) card.remove();
          toast('Şarkı silindi');
          loadMusicStats();
        } catch (err) {
          toast('Silinemedi: ' + err.message, true);
        }
      };
    }

    // Style / Prompt
    const styleEl = $('#mlStyle');
    if (styleEl) styleEl.textContent = song.style || 'Belirtilmemiş';

    $('#mlCopyStyleBtn').onclick = () => {
      navigator.clipboard.writeText(song.style || '');
      toast('Suno Tam Stil promptu panoya kopyalandı! 📋');
    };

    // Synchronizer button
    const syncBtn = $('#mlOpenSyncBtn');
    if (syncBtn) {
      if (song.has_audio) {
        syncBtn.classList.remove('hidden');
        syncBtn.onclick = () => {
          closeSongDetailModal();
          openSyncModal(song);
        };
      } else {
        syncBtn.classList.add('hidden');
      }
    }

    // Lyrics Content & Tabs
    let currentModalMode = 'clean';
    const updateModalLyricsView = () => {
      const cleanLines = cleanLyricsForSync(song.lyrics || '');
      const contentEl = $('#mlContent');
      if (!contentEl) return;
      if (currentModalMode === 'clean') {
        $('#mlTabClean')?.classList.add('active');
        $('#mlTabRaw')?.classList.remove('active');
        contentEl.classList.remove('tagged-mode');
        contentEl.innerHTML = cleanLines.length
          ? cleanLines.map(l => `<div style="margin-bottom:8px">${escapeHtml(l)}</div>`).join('')
          : '<span class="muted">Şarkı sözü bulunamadı</span>';
      } else {
        $('#mlTabRaw')?.classList.add('active');
        $('#mlTabClean')?.classList.remove('active');
        contentEl.classList.add('tagged-mode');
        contentEl.innerHTML = formatLyrics(song.lyrics);
      }
    };
    updateModalLyricsView();

    $('#mlTabClean').onclick = () => {
      currentModalMode = 'clean';
      updateModalLyricsView();
    };
    $('#mlTabRaw').onclick = () => {
      currentModalMode = 'raw';
      updateModalLyricsView();
    };

    $('#mlCopyCleanBtn').onclick = async () => {
      const cleanText = cleanLyricsForSync(song.lyrics || '').join('\n');
      if (!cleanText) return toast('Kopyalanacak şarkı sözü bulunamadı!', true);
      await navigator.clipboard.writeText(cleanText);
      toast('✓ Saf şarkı sözleri (tagsız) panoya kopyalandı! 📋');
    };

    $('#mlCopyBtn').onclick = () => {
      navigator.clipboard.writeText(song.lyrics || '');
      toast('Orijinal şarkı sözleri (etiketli) panoya kopyalandı! 📋');
    };

    // Navigation buttons (‹ and ›)
    const prevBtn = $('#mlPrev');
    const nextBtn = $('#mlNext');
    if (prevBtn) {
      prevBtn.classList.toggle('disabled', idx <= 0);
      prevBtn.onclick = () => {
        if (idx > 0) openSongDetail(idx - 1);
      };
    }
    if (nextBtn) {
      nextBtn.classList.toggle('disabled', idx >= state.songs.length - 1);
      nextBtn.onclick = () => {
        if (idx < state.songs.length - 1) openSongDetail(idx + 1);
      };
    }

    modal.classList.remove('hidden');
  }

  function closeSongDetailModal() {
    const modal = $('#musicLyricsModal');
    if (modal) modal.classList.add('hidden');
    const audioEl = $('#mlAudio');
    if (audioEl) {
      audioEl.pause();
      audioEl.src = '';
    }
  }

  function openLyricsModal(song) {
    openSongDetail(song);
  }

  // ===================================================================
  // 🎙️ DISTROKID STYLE LYRICS SYNCHRONIZER ENGINE
  // ===================================================================
  const sync = {
    song: null,
    audio: null,
    lines: [],
    starts: [],
    ends: [],
    idx: 0,
    held: false,
    active: false,
    paused: false,
    latency: 120,
    timer: null,
  };

  function cleanLyricsForSync(text) {
    if (!text) return [];
    const rawLines = text.split(/\r?\n/);
    const cleaned = [];

    const instrumentalCueRegex = /^\s*\((?:instrumental|guitar\s+solo|solo|intro|outro|bridge|verse\s*\d*|chorus|drop|beat\s+drop|instrumental\s+break|fade\s+out|applause)[^)]*\)\s*$/i;
    const metaHeaderRegex = /^(?:şarkı\s+adı|şarkı\s+ıd|şarkı\s+id|model|persona|tarih|link|title|song\s+id|date|url)\s*:/i;

    for (let raw of rawLines) {
      let line = raw.trim();
      if (!line) continue;
      if (line.startsWith('===') || line.startsWith('---') || line.startsWith('___')) continue;
      if (metaHeaderRegex.test(line)) continue;
      if (instrumentalCueRegex.test(line)) continue;

      // Remove bracketed Suno AI tags like [Verse 1], [Chorus | ...], [Intro], etc.
      let stripped = line.replace(/\[[^\]]*\]/g, '').trim();
      stripped = stripped.replace(/\s+/g, ' ');

      if (stripped.length > 0) {
        cleaned.push(stripped);
      }
    }
    return cleaned;
  }

  function openSyncModal(song) {
    if (!song.has_audio) {
      toast('Bu şarkının henüz ses dosyası (.mp3 / .wav) yok! Önce ses dosyası yükleyin.', true);
      return;
    }
    sync.song = song;
    sync.audio = $('#msAudio');
    sync.audio.src = `/api/music/songs/${song.id}/audio`;
    sync.audio.load();

    $('#msTitle').textContent = `🎙️ Senkronlayıcı: ${song.title}`;
    $('#msSubtitle').textContent = (song.persona ? `🎭 ${song.persona}` : (song.artist ? `👤 ${song.artist}` : '')) + ` · ${song.model || 'Suno AI'}`;

    // Clean lyrics by stripping Suno AI structure & prompt tags ([Verse 1 | ...], [Chorus], etc.)
    const cleanLines = cleanLyricsForSync(song.lyrics || '');

    // Check if song already has saved sync items
    let savedSync = null;
    if (song.synced_lyrics) {
      try {
        const parsed = JSON.parse(song.synced_lyrics);
        if (Array.isArray(parsed) && parsed.length > 0) {
          savedSync = parsed;
        }
      } catch {}
    }

    if (savedSync) {
      sync.lines = savedSync.map(it => it.text);
      sync.starts = savedSync.map(it => it.start);
      sync.ends = savedSync.map(it => it.end);
      sync.idx = sync.lines.length;
    } else {
      sync.lines = cleanLines;
      sync.starts = new Array(cleanLines.length).fill(null);
      sync.ends = new Array(cleanLines.length).fill(null);
      sync.idx = 0;
    }

    sync.held = false;
    sync.active = false;
    sync.paused = false;

    $('#msLatency').value = sync.latency;
    $('#msLatencyVal').textContent = sync.latency;

    renderSyncStream();
    if (savedSync) {
      $('#msBtnPlay').disabled = false;
      $('#msBtnPlay').textContent = '▶ Yeniden Senkronla';
      $('#msBtnPause').disabled = true;
      $('#msBtnBack').disabled = true;
      $('#msBtnRestart').disabled = false;
      $('#msBtnSaveVault').disabled = false;
      $('#msDlLrc').disabled = false;
      $('#msDlSrt').disabled = false;
      $('#msDlTxt').disabled = false;
      $('#msStatusMsg').textContent = `✓ Bu şarkı için kayıtlı ${savedSync.length} satır senkron mevcut. Dilerseniz hemen indirebilir veya yeniden senkronlayabilirsiniz.`;
    } else {
      resetSyncUI();
    }

    $('#musicSyncModal').classList.remove('hidden');
  }

  function renderSyncStream() {
    const stream = $('#msSyncStream');
    stream.innerHTML = '';
    sync.lines.forEach((line, i) => {
      const row = document.createElement('div');
      const isDone = sync.starts[i] !== null;
      const isCur = i === sync.idx && !isDone;
      row.className = 'sync-line' + (isCur ? ' cur' : '') + (isDone ? ' done' : '');
      row.dataset.idx = i;
      const timeStr = isDone ? fmtClock(sync.starts[i]) : '--:--.--';
      row.innerHTML = `
        <span class="line-idx">${i + 1}</span>
        <span class="line-time">${timeStr}</span>
        <span class="line-text">${escapeHtml(line)}</span>
      `;
      stream.appendChild(row);
    });
    const doneCount = sync.starts.filter(s => s !== null).length;
    $('#msCounter').textContent = `${doneCount} / ${sync.lines.length} Satır`;
  }

  function resetSyncUI() {
    $('#msBtnPlay').disabled = false;
    $('#msBtnPlay').textContent = '▶ Senkrona Başla';
    $('#msBtnPause').disabled = true;
    $('#msBtnPause').textContent = '⏸ Duraklat (Esc)';
    $('#msBtnBack').disabled = true;
    $('#msBtnRestart').disabled = true;
    $('#msBtnSaveVault').disabled = true;
    $('#msDlLrc').disabled = true;
    $('#msDlSrt').disabled = true;
    $('#msDlTxt').disabled = true;
    $('#msClock').textContent = '00:00.00 / 00:00.00';
    $('#msProgBar').style.width = '0%';
    $('#msStatusMsg').textContent = 'Senkrona başlamak için ▶ Senkrona Başla butonuna basın.';
    $('#msLyricsEditView').classList.add('hidden');
    $('#msSyncStream').classList.remove('hidden');
  }

  function startSync() {
    if (!sync.lines.length) {
      toast('Senkronlanacak şarkı sözü bulunamadı! "Sözleri Düzenle" butonundan ekleyebilirsiniz.', true);
      return;
    }
    if (sync.idx >= sync.lines.length) {
      sync.starts = new Array(sync.lines.length).fill(null);
      sync.ends = new Array(sync.lines.length).fill(null);
      sync.idx = 0;
      renderSyncStream();
    }
    sync.active = true;
    sync.paused = false;
    sync.audio.currentTime = 0;
    sync.audio.play();

    $('#msBtnPlay').disabled = true;
    $('#msBtnPause').disabled = false;
    $('#msBtnBack').disabled = false;
    $('#msBtnRestart').disabled = false;
    $('#msStatusMsg').textContent = '▶ Çalıyor: Söz girince SPACE tuşuna basılı tutun, satır bitince bırakın!';

    clearInterval(sync.timer);
    sync.timer = setInterval(tickSync, 50);
  }

  function pauseSync() {
    if (!sync.active) return;
    if (sync.paused) {
      sync.audio.play();
      sync.paused = false;
      $('#msBtnPause').textContent = '⏸ Duraklat (Esc)';
      $('#msStatusMsg').textContent = '▶ Çalmaya devam ediyor.';
    } else {
      sync.audio.pause();
      sync.paused = true;
      $('#msBtnPause').textContent = '▶ Devam Et (Esc)';
      $('#msStatusMsg').textContent = '⏸ Duraklatıldı. Devam etmek için Esc tuşuna veya butona basın.';
    }
  }

  function stepBackLine() {
    if (!sync.active || sync.idx === 0) return;
    if (sync.held) {
      sync.held = false;
    }
    sync.idx--;
    sync.starts[sync.idx] = null;
    sync.ends[sync.idx] = null;

    // Rewind audio by 2 seconds
    sync.audio.currentTime = Math.max(0, sync.audio.currentTime - 2.0);

    const rows = $$('#msSyncStream .sync-line');
    rows.forEach((r, i) => {
      r.classList.remove('cur', 'held');
      if (i === sync.idx) {
        r.classList.remove('done');
        r.classList.add('cur');
        r.querySelector('.line-time').textContent = '--:--.--';
        r.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (i > sync.idx) {
        r.classList.remove('done');
        r.querySelector('.line-time').textContent = '--:--.--';
      }
    });

    $('#msCounter').textContent = `${sync.idx} / ${sync.lines.length} Satır`;
    $('#msStatusMsg').textContent = '⏪ 1 satır geri alındı, şarkı 2 saniye geriye sarıldı.';
  }

  function restartSync() {
    sync.audio.pause();
    sync.audio.currentTime = 0;
    sync.starts = new Array(sync.lines.length).fill(null);
    sync.ends = new Array(sync.lines.length).fill(null);
    sync.idx = 0;
    sync.held = false;
    sync.paused = false;
    renderSyncStream();
    startSync();
  }

  function tickSync() {
    if (!sync.active) return;
    const cur = sync.audio.currentTime || 0;
    const dur = sync.audio.duration || 0;
    $('#msClock').textContent = `${fmtClock(cur)} / ${fmtClock(dur)}`;
    if (dur > 0) {
      $('#msProgBar').style.width = `${Math.min(100, (cur / dur) * 100)}%`;
    }

    if (sync.audio.ended) {
      if (sync.held && sync.idx < sync.lines.length) {
        sync.ends[sync.idx] = cur;
        sync.idx++;
        sync.held = false;
      }
      finishSync();
    }
  }

  function onSpaceDown() {
    if (!sync.active || sync.paused || sync.held || sync.idx >= sync.lines.length) return;
    sync.held = true;
    sync.starts[sync.idx] = sync.audio.currentTime;

    const row = $(`#msSyncStream .sync-line[data-idx="${sync.idx}"]`);
    if (row) {
      row.classList.add('held');
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function onSpaceUp() {
    if (!sync.active || !sync.held || sync.idx >= sync.lines.length) return;
    sync.held = false;
    const endTime = sync.audio.currentTime;
    sync.ends[sync.idx] = endTime;

    const curRow = $(`#msSyncStream .sync-line[data-idx="${sync.idx}"]`);
    if (curRow) {
      curRow.classList.remove('held', 'cur');
      curRow.classList.add('done');
      curRow.querySelector('.line-time').textContent = fmtClock(sync.starts[sync.idx]);
    }

    sync.idx++;
    $('#msCounter').textContent = `${sync.idx} / ${sync.lines.length} Satır`;

    if (sync.idx < sync.lines.length) {
      const nextRow = $(`#msSyncStream .sync-line[data-idx="${sync.idx}"]`);
      if (nextRow) {
        nextRow.classList.add('cur');
        nextRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      finishSync();
    }
  }

  function finishSync() {
    clearInterval(sync.timer);
    sync.active = false;
    sync.audio.pause();
    $('#msBtnPlay').disabled = false;
    $('#msBtnPause').disabled = true;
    $('#msBtnSaveVault').disabled = false;
    $('#msDlLrc').disabled = false;
    $('#msDlSrt').disabled = false;
    $('#msDlTxt').disabled = false;
    $('#msStatusMsg').textContent = '✓ Tüm satırlar zamanlandı! 💾 Kasaya Senkronize Kaydet butonuna basarak kaydedebilirsiniz.';
    toast('✓ Şarkı sözü senkronizasyonu tamamlandı!');
  }

  async function saveSyncToVault() {
    const items = [];
    for (let i = 0; i < sync.lines.length; i++) {
      const s = sync.starts[i];
      if (s === null || s === undefined) continue;
      let e = sync.ends[i];
      if (e === null || e === undefined || e <= s) {
        e = (i + 1 < sync.lines.length && sync.starts[i + 1] !== null) ? sync.starts[i + 1] : s + 3.0;
      }
      items.push({ start: s, end: e, text: sync.lines[i] });
    }
    if (!items.length) {
      toast('Henüz zamanlanmış satır bulunmuyor!', true);
      return;
    }

    try {
      $('#msBtnSaveVault').disabled = true;
      $('#msBtnSaveVault').textContent = 'Kaydediliyor...';
      const updated = await api(`/api/music/songs/${sync.song.id}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, latency_ms: sync.latency }),
      });
      sync.song = updated;
      toast('✓ Senkronize sözler (LRC, SRT, TXT) başarıyla kasaya kaydedildi! 💾');
      $('#msBtnSaveVault').textContent = '✓ Kasaya Kaydedildi';
      loadSongs();
    } catch (e) {
      toast('Kaydetme hatası: ' + e.message, true);
      $('#msBtnSaveVault').disabled = false;
      $('#msBtnSaveVault').textContent = '💾 Kasaya Senkronize Kaydet';
    }
  }

  function downloadSyncFormat(fmt) {
    if (!sync.song) return;
    window.location.href = `/api/music/songs/${sync.song.id}/download/${fmt}`;
  }

  // 2. Edit Song Modal
  function openEditSongModal(song) {
    const modal = $('#musicEditModal');
    if (!modal) return;
    $('#meSongId').value = song.id;
    $('#meTitle').value = song.title || '';
    $('#meArtist').value = song.artist || '';
    if ($('#mePersona')) $('#mePersona').value = song.persona || '';
    $('#meStyle').value = song.style || '';
    $('#meLyrics').value = song.lyrics || '';
    $('#meNotes').value = song.notes || '';
    $('#meUrl').value = song.suno_url || '';

    // Populate workspace select in modal
    const wsSel = $('#meWorkspace');
    wsSel.innerHTML = '<option value="">(Belirtilmemiş / Genel)</option>';
    state.workspaces.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.textContent = `${w.icon || '🎵'} ${w.name}`;
      wsSel.appendChild(opt);
    });
    wsSel.value = song.workspace_id || '';

    modal.classList.remove('hidden');
  }

  // 3. Workspace Modal (Add / Edit)
  function openWorkspaceModal(ws = null) {
    const modal = $('#workspaceModal');
    if (!modal) return;
    $('#wsModalId').value = ws ? ws.id : '';
    $('#wsModalTitle').textContent = ws ? '✏ Çalışma Alanını Düzenle' : '➕ Yeni Çalışma Alanı / Proje';
    $('#wsName').value = ws ? ws.name : '';
    $('#wsDesc').value = ws ? ws.description : '';
    $('#wsColor').value = ws ? ws.color : '#8b5cf6';
    $('#wsIcon').value = ws ? ws.icon : '🎵';
    modal.classList.remove('hidden');
  }

  // ===================================================================
  // INITIALIZATION & EVENT HANDLERS
  // ===================================================================
  function initEvents() {
    // Search input
    const inputQ = $('#musicQ');
    if (inputQ) {
      let tm;
      inputQ.addEventListener('input', () => {
        clearTimeout(tm);
        tm = setTimeout(() => {
          state.q = inputQ.value.trim();
          loadSongs();
        }, 300);
      });
    }

    // Workspace filter
    const selWs = $('#musicWsFilter');
    if (selWs) {
      selWs.addEventListener('change', () => {
        state.workspaceId = selWs.value ? parseInt(selWs.value, 10) : null;
        loadSongs();
      });
    }

    // Artist filter
    const inputArtist = $('#musicArtistFilter');
    if (inputArtist) {
      let tm;
      inputArtist.addEventListener('input', () => {
        clearTimeout(tm);
        tm = setTimeout(() => {
          state.artist = inputArtist.value.trim();
          loadSongs();
        }, 300);
      });
    }

    // Sort
    const selSort = $('#musicSort');
    if (selSort) {
      selSort.addEventListener('change', () => {
        state.sort = selSort.value;
        loadSongs();
      });
    }

    // Bulk bar buttons
    $('#musicBulkAll')?.addEventListener('click', () => {
      state.songs.forEach(s => state.selected.add(s.id));
      updateBulkBar();
      refreshSelectionUI();
    });

    $('#musicBulkClear')?.addEventListener('click', () => {
      state.selected.clear();
      updateBulkBar();
      refreshSelectionUI();
    });

    $('#musicBulkDelete')?.addEventListener('click', async () => {
      if (!confirm(`${state.selected.size} şarkıyı silmek istediğinize emin misiniz?`)) return;
      try {
        await api('/api/music/bulk/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: Array.from(state.selected) }),
        });
        toast(`${state.selected.size} şarkı silindi`);
        state.selected.clear();
        updateBulkBar();
        loadSongs();
        loadMusicStats();
      } catch (e) {
        toast('Silme başarısız: ' + e.message, true);
      }
    });

    $('#musicBulkApplyWs')?.addEventListener('click', async () => {
      const wsVal = $('#musicBulkWs').value;
      const wsId = wsVal ? parseInt(wsVal, 10) : null;
      try {
        await api('/api/music/bulk/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: Array.from(state.selected), workspace_id: wsId }),
        });
        toast(`${state.selected.size} şarkının çalışma alanı güncellendi`);
        state.selected.clear();
        updateBulkBar();
        loadSongs();
        loadWorkspaces();
      } catch (e) {
        toast('Güncellenemedi: ' + e.message, true);
      }
    });

    // Add Song Modal Button
    $('#btnAddSong')?.addEventListener('click', () => {
      populateWorkspaceDropdowns();
      $('#musicUploadModal')?.classList.remove('hidden');
    });

    // Close Modals
    $('#mlClose')?.addEventListener('click', closeSongDetailModal);
    $('#musicLyricsModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'musicLyricsModal') closeSongDetailModal();
    });

    // Keyboard navigation for Song Detail Modal (ArrowLeft / ArrowRight / Escape)
    document.addEventListener('keydown', (e) => {
      const modal = $('#musicLyricsModal');
      if (!modal || modal.classList.contains('hidden')) return;
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (e.key === 'Escape') closeSongDetailModal();
      if (e.key === 'ArrowLeft') $('#mlPrev')?.click();
      if (e.key === 'ArrowRight') $('#mlNext')?.click();
    });
    $('#meClose')?.addEventListener('click', () => $('#musicEditModal')?.classList.add('hidden'));
    $('#meCancel')?.addEventListener('click', () => $('#musicEditModal')?.classList.add('hidden'));
    $('#muClose')?.addEventListener('click', () => $('#musicUploadModal')?.classList.add('hidden'));
    $('#muCancel')?.addEventListener('click', () => $('#musicUploadModal')?.classList.add('hidden'));
    $('#wsClose')?.addEventListener('click', () => $('#workspaceModal')?.classList.add('hidden'));
    $('#wsCancel')?.addEventListener('click', () => $('#workspaceModal')?.classList.add('hidden'));

    // Synchronizer Modal Events
    $('#msClose')?.addEventListener('click', () => {
      if (sync.audio) sync.audio.pause();
      clearInterval(sync.timer);
      sync.active = false;
      $('#musicSyncModal')?.classList.add('hidden');
    });

    $('#msBtnPlay')?.addEventListener('click', startSync);
    $('#msBtnPause')?.addEventListener('click', pauseSync);
    $('#msBtnBack')?.addEventListener('click', stepBackLine);
    $('#msBtnRestart')?.addEventListener('click', restartSync);
    $('#msBtnSaveVault')?.addEventListener('click', saveSyncToVault);

    $('#msDlLrc')?.addEventListener('click', () => downloadSyncFormat('lrc'));
    $('#msDlSrt')?.addEventListener('click', () => downloadSyncFormat('srt'));
    $('#msDlTxt')?.addEventListener('click', () => downloadSyncFormat('txt'));

    $('#msLatency')?.addEventListener('input', (e) => {
      sync.latency = parseInt(e.target.value, 10);
      $('#msLatencyVal').textContent = sync.latency;
    });

    $('#msBtnEditLyrics')?.addEventListener('click', () => {
      const editView = $('#msLyricsEditView');
      const streamView = $('#msSyncStream');
      if (editView.classList.contains('hidden')) {
        $('#msLyricsText').value = sync.lines.join('\n');
        editView.classList.remove('hidden');
        streamView.classList.add('hidden');
      } else {
        editView.classList.add('hidden');
        streamView.classList.remove('hidden');
      }
    });

    $('#msBtnSaveLyrics')?.addEventListener('click', () => {
      const text = $('#msLyricsText').value;
      const cleanLines = cleanLyricsForSync(text);
      if (!cleanLines.length) {
        toast('Söz bulunamadı veya tüm satırlar etiket!', true);
        return;
      }
      sync.lines = cleanLines;
      sync.starts = new Array(cleanLines.length).fill(null);
      sync.ends = new Array(cleanLines.length).fill(null);
      sync.idx = 0;
      renderSyncStream();
      $('#msLyricsEditView').classList.add('hidden');
      $('#msSyncStream').classList.remove('hidden');
      toast(`Sözler temizlendi ve senkrona hazırlandı (${cleanLines.length} satır)!`);
    });

    // Global Key Events for Synchronizer
    window.addEventListener('keydown', (e) => {
      const modal = $('#musicSyncModal');
      if (!modal || modal.classList.contains('hidden')) return;
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        onSpaceDown();
      } else if (e.code === 'Backspace') {
        e.preventDefault();
        stepBackLine();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        pauseSync();
      } else if (e.code === 'F5') {
        e.preventDefault();
        restartSync();
      }
    });

    window.addEventListener('keyup', (e) => {
      const modal = $('#musicSyncModal');
      if (!modal || modal.classList.contains('hidden')) return;
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        onSpaceUp();
      }
    });

    // Submit Edit Song Form
    $('#meSubmit')?.addEventListener('click', async () => {
      const id = $('#meSongId').value;
      const wsVal = $('#meWorkspace').value;
      const body = {
        title: $('#meTitle').value.trim(),
        artist: $('#meArtist').value.trim(),
        persona: $('#mePersona') ? $('#mePersona').value.trim() : undefined,
        style: $('#meStyle').value.trim(),
        lyrics: $('#meLyrics').value.trim(),
        notes: $('#meNotes').value.trim(),
        suno_url: $('#meUrl').value.trim(),
        workspace_id: wsVal ? parseInt(wsVal, 10) : null,
      };
      try {
        await api(`/api/music/songs/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        toast('Şarkı güncellendi');
        $('#musicEditModal')?.classList.add('hidden');
        loadSongs();
      } catch (e) {
        toast('Kaydedilemedi: ' + e.message, true);
      }
    });

    // Submit Workspace Form
    $('#btnNewWorkspace')?.addEventListener('click', () => openWorkspaceModal());
    $('#wsSubmit')?.addEventListener('click', async () => {
      const id = $('#wsModalId').value;
      const body = {
        name: $('#wsName').value.trim(),
        description: $('#wsDesc').value.trim(),
        color: $('#wsColor').value.trim(),
        icon: $('#wsIcon').value.trim(),
      };
      if (!body.name) return toast('Çalışma alanı adı boş olamaz', true);
      try {
        if (id) {
          await api(`/api/music/workspaces/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          toast('Çalışma alanı güncellendi');
        } else {
          await api('/api/music/workspaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          toast('Yeni müzik çalışma alanı oluşturuldu');
        }
        $('#workspaceModal')?.classList.add('hidden');
        loadWorkspacesTab();
        loadWorkspaces();
        loadMusicStats();
      } catch (e) {
        toast('Kaydedilemedi: ' + e.message, true);
      }
    });

    // Upload & Add Song Form
    $('#muSubmit')?.addEventListener('click', async () => {
      const txtFile = $('#muTxtFile')?.files[0];
      const audioFile = $('#muAudioFile')?.files[0];
      const wsVal = $('#muWorkspace').value;
      const artist = $('#muArtist').value.trim();

      if (!txtFile && !audioFile) {
        return toast('Lütfen en az bir dosya seçin (.txt metadata veya .mp3)', true);
      }

      const fd = new FormData();
      if (txtFile) fd.append('txt_file', txtFile);
      if (audioFile) fd.append('audio_file', audioFile);
      if (wsVal) fd.append('workspace_id', wsVal);
      if (artist) fd.append('artist', artist);

      try {
        $('#muSubmit').disabled = true;
        $('#muSubmit').textContent = 'Yükleniyor...';
        await fetch('/api/music/upload', { method: 'POST', body: fd });
        toast('Şarkı başarıyla eklendi! 🎵');
        $('#musicUploadModal')?.classList.add('hidden');
        loadSongs();
        loadMusicStats();
      } catch (e) {
        toast('Yükleme hatası: ' + e.message, true);
      } finally {
        $('#muSubmit').disabled = false;
        $('#muSubmit').textContent = '🔒 Kasaya Kaydet';
      }
    });

    // Music Scan Tab
    $('#mScanBrowse')?.addEventListener('click', async () => {
      try {
        const data = await api('/api/dialog/pick-folder', { method: 'POST' });
        if (data.path) $('#mScanPath').value = data.path;
      } catch (e) {
        toast('Klasör seçilemedi: ' + e.message, true);
      }
    });

    $('#mScanStart')?.addEventListener('click', async () => {
      const path = $('#mScanPath').value.trim();
      if (!path) return toast('Lütfen bir klasör yolu seçin', true);
      const wsVal = $('#mScanWorkspace').value;
      const artist = $('#mScanArtist').value.trim();

      try {
        const res = await api('/api/music/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path,
            workspace_id: wsVal ? parseInt(wsVal, 10) : null,
            artist,
          }),
        });
        toast('Müzik klasörü taraması başlatıldı...');
        pollScanStatus();
      } catch (e) {
        toast('Tarama başlatılamadı: ' + e.message, true);
      }
    });

    // Suno Extension & Userscript Guides
    $('#btnCopyUserscript')?.addEventListener('click', async () => {
      try {
        const res = await fetch('/static/suno_downloader.user.js');
        const text = await res.text();
        await navigator.clipboard.writeText(text);
        toast('📋 Userscript kodu panoya kopyalandı!');
      } catch (e) {
        toast('Kopyalanamadı: ' + e.message, true);
      }
    });

    $('#btnShowExtGuide')?.addEventListener('click', () => {
      $('#sunoExtGuideModal')?.classList.remove('hidden');
    });

    $('#segClose')?.addEventListener('click', () => {
      $('#sunoExtGuideModal')?.classList.add('hidden');
    });

    $('#segOk')?.addEventListener('click', () => {
      $('#sunoExtGuideModal')?.classList.add('hidden');
    });

    $('#btnCopyExtPath')?.addEventListener('click', async () => {
      const val = $('#segExtPathInput')?.value;
      if (val) {
        await navigator.clipboard.writeText(val);
        toast('📋 Klasör yolu panoya kopyalandı!');
      }
    });

    function pollScanStatus() {
      const logEl = $('#mScanLog');
      const interval = setInterval(async () => {
        try {
          const status = await api('/api/music/scan');
          if (status.stats) {
            logEl.textContent = `Taranan: ${status.stats.scanned} dosya · Eklenen/Eşleşen: ${status.stats.added} şarkı`;
          }
          if (!status.running) {
            clearInterval(interval);
            toast('Tarama tamamlandı! 🎵');
            loadSongs();
            loadWorkspaces();
            loadMusicStats();
          }
        } catch (e) {
          clearInterval(interval);
        }
      }, 1000);
    }
  }

  // Initialize once DOM is ready
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => {
      initDomainSwitcher();
      initEvents();
    });
  } else {
    initDomainSwitcher();
    initEvents();
  }
})();
