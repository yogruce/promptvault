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
      if (domain === 'images') {
        btnImages.classList.add('active');
        btnMusic.classList.remove('active');
        viewImages.classList.remove('hidden');
        viewMusic.classList.add('hidden');
        navImages.classList.remove('hidden');
        navMusic.classList.add('hidden');
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
        el.textContent = `🎵 ${s.total_songs} Şarkı · 🏢 ${s.total_workspaces} Workspace · ⭐ ${s.favorites} Favori · 🔊 ${s.with_audio} Sesli`;
      }
    } catch (e) {}
  }

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
      selFilter.innerHTML = '<option value="">🏢 Tüm Workspaces (Hepsi)</option>';
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

      card.innerHTML = `
        <div class="song-card-header">
          <div class="chk" title="Seç">${state.selected.has(song.id) ? '✓' : ''}</div>
          <div class="song-badges">
            <span class="song-ws-badge" style="background:${wsColor}22; color:${wsColor}; border:1px solid ${wsColor}66">
              📁 ${escapeHtml(wsName)}
            </span>
            ${song.persona ? `<span class="song-persona-badge" title="Suno Persona">🎭 ${escapeHtml(song.persona)}</span>` : ''}
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
            <div class="song-no-audio">📄 Sadece Söz ve Stil Promptu</div>
          `}

          <!-- STYLE PROMPT BOX -->
          <div class="song-style-box">
            <div class="song-section-label">
              <span>🎯 TAM STİL / PROMPT</span>
              <button class="btn-copy-style ghost small" data-style="${escapeHtml(song.style)}" title="Promptu kopyala">📋 Kopyala</button>
            </div>
            <div class="song-style-content">${escapeHtml(song.style || 'Stil belirtilmemiş')}</div>
          </div>

          <!-- LYRICS PREVIEW -->
          <div class="song-lyrics-box">
            <div class="song-section-label">
              <span>📝 ŞARKI SÖZLERİ</span>
              <button class="btn-view-lyrics ghost small" data-id="${song.id}" title="Tam sözleri aç">📖 Genişlet</button>
            </div>
            <div class="song-lyrics-preview">${formatLyrics(song.lyrics)}</div>
          </div>
        </div>

        <div class="song-card-footer">
          <div class="song-stars">${ratingStars}</div>
          <div class="song-actions">
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
      btnCopy.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(song.style || '');
        toast('Suno Stil Promptu panoya kopyalandı! 📋');
      });

      // 5. View Full Lyrics
      const btnLyrics = card.querySelector('.btn-view-lyrics');
      btnLyrics.addEventListener('click', (e) => {
        e.stopPropagation();
        openLyricsModal(song);
      });

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
            <button class="btn-ws-del ghost small danger" data-id="${w.id}">🗑 Sil</button>
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

        card.querySelector('.btn-ws-del').addEventListener('click', async () => {
          if (!confirm(`"${w.name}" çalışma alanını silmek istiyor musunuz? (İçindeki şarkılar silinmez, Genel alanına geçer)`)) return;
          try {
            await api(`/api/music/workspaces/${w.id}`, { method: 'DELETE' });
            toast('Çalışma alanı silindi');
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

  // ===================================================================
  // MODALS
  // ===================================================================
  // 1. Lyrics Modal
  function openLyricsModal(song) {
    const modal = $('#musicLyricsModal');
    if (!modal) return;
    $('#mlTitle').textContent = song.title;
    $('#mlArtist').textContent = song.artist ? `👤 ${song.artist}` : '';
    $('#mlStyle').textContent = song.style || 'Belirtilmemiş';
    $('#mlContent').innerHTML = formatLyrics(song.lyrics);
    $('#mlCopyBtn').onclick = () => {
      navigator.clipboard.writeText(song.lyrics || '');
      toast('Şarkı sözleri panoya kopyalandı! 📋');
    };
    $('#mlCopyStyleBtn').onclick = () => {
      navigator.clipboard.writeText(song.style || '');
      toast('Suno Tam Stil promptu panoya kopyalandı! 📋');
    };
    modal.classList.remove('hidden');
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
    $('#mlClose')?.addEventListener('click', () => $('#musicLyricsModal')?.classList.add('hidden'));
    $('#meClose')?.addEventListener('click', () => $('#musicEditModal')?.classList.add('hidden'));
    $('#meCancel')?.addEventListener('click', () => $('#musicEditModal')?.classList.add('hidden'));
    $('#muClose')?.addEventListener('click', () => $('#musicUploadModal')?.classList.add('hidden'));
    $('#muCancel')?.addEventListener('click', () => $('#musicUploadModal')?.classList.add('hidden'));
    $('#wsClose')?.addEventListener('click', () => $('#workspaceModal')?.classList.add('hidden'));
    $('#wsCancel')?.addEventListener('click', () => $('#workspaceModal')?.classList.add('hidden'));

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
          toast('Yeni çalışma alanı oluşturuldu');
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
