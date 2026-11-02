/**
 * PromptVault - Sistem Promptları (Gemini Gems, ChatGPT Artifacts, Custom GPTs, Custom)
 * Frontend Controller
 */
(() => {
  const CATEGORY_META = {
    gemini_gems: { name: "Gemini Gems", icon: "💎", badgeClass: "cat-gemini", desc: "Google Gemini özel Gem sistem talimatları" },
    chatgpt_artifacts: { name: "ChatGPT Artifacts", icon: "📦", badgeClass: "cat-artifacts", desc: "Etkileşimli kod, HTML/UI ve SVG üreten Artifact promptları" },
    chatgpt_gpts: { name: "ChatGPT GPTs", icon: "🤖", badgeClass: "cat-gpts", desc: "OpenAI Custom GPT sistem talimatları ve persona promptları" },
    custom: { name: "Özel (Custom)", icon: "🛠️", badgeClass: "cat-custom", desc: "Özel LLM ve genel amaçlı sistem promptları" }
  };

  const sysState = {
    category: "all",
    isFavorite: false,
    q: "",
    items: [],
    stats: null,
    editingId: null,
    currentDetail: null
  };

  const $ = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => [...p.querySelectorAll(s)];
  const esc = (s) => (s || "").toString().replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  // Toast notification helper
  function showToast(msg) {
    if (window.toast) return window.toast(msg);
    const t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add("hidden"), 3000);
  }

  // Copy to clipboard helper
  async function copyPromptToClipboard(text, successTitle = "") {
    try {
      await navigator.clipboard.writeText(text);
      const msg = successTitle
        ? `"${successTitle}" panoya kopyalandı!`
        : (window.t ? window.t("sys_copied_toast") : "Sistem promptu panoya kopyalandı!");
      showToast(msg);
      return true;
    } catch (err) {
      console.error("Kopyalama hatası:", err);
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showToast(window.t ? window.t("sys_copied_toast") : "Sistem promptu panoya kopyalandı!");
      return true;
    }
  }

  // API wrapper
  async function sysApi(url, opts = {}) {
    const res = await fetch(url, { credentials: "same-origin", ...opts });
    if (!res.ok) {
      let msg = "İstek başarısız";
      try {
        const j = await res.json();
        msg = j.detail || j.message || JSON.stringify(j);
      } catch {}
      throw new Error(msg);
    }
    return res.json();
  }

  // Load Prompts from server
  async function loadSystemPrompts() {
    const grid = $("#sysPromptsGrid");
    if (grid && sysState.items.length === 0) {
      grid.innerHTML = '<div style="padding:40px; text-align:center; color:var(--muted); grid-column:1/-1;">Sistem promptları yükleniyor...</div>';
    }

    const params = new URLSearchParams();
    if (sysState.category && sysState.category !== "all" && sysState.category !== "favorite") {
      params.set("category", sysState.category);
    }
    if (sysState.category === "favorite" || sysState.isFavorite) {
      params.set("is_favorite", "true");
    }
    if (sysState.q.trim()) {
      params.set("q", sysState.q.trim());
    }

    try {
      const data = await sysApi(`/api/system-prompts?${params.toString()}`);
      sysState.items = data || [];
      renderSystemPrompts();
      loadSystemPromptStats();
    } catch (err) {
      console.error("loadSystemPrompts error:", err);
      if (grid) {
        grid.innerHTML = `<div style="padding:40px; text-align:center; color:var(--danger); grid-column:1/-1;">Yükleme hatası: ${esc(err.message)}</div>`;
      }
    }
  }

  // Load and render stats in header
  async function loadSystemPromptStats() {
    try {
      const stats = await sysApi("/api/system-prompts/stats");
      sysState.stats = stats;
      renderStatsBar(stats);
    } catch (err) {
      console.warn("loadSystemPromptStats error:", err);
    }
  }

  function renderStatsBar(stats) {
    const textEl = $("#sysStatsText");
    if (!textEl || !stats) return;

    const gems = stats.categories?.gemini_gems || 0;
    const artifacts = stats.categories?.chatgpt_artifacts || 0;
    const gpts = stats.categories?.chatgpt_gpts || 0;
    const custom = stats.categories?.custom || 0;
    const wordPrompt = window.t ? window.t("sys_stats_prompts") : "Sistem Promptu";

    textEl.textContent = `${stats.total} ${wordPrompt} · 💎 ${gems} Gems · 📦 ${artifacts} Artifacts · 🤖 ${gpts} GPTs · 🛠️ ${custom} Özel`;
  }

  // Render cards grid
  function renderSystemPrompts() {
    const grid = $("#sysPromptsGrid");
    const empty = $("#sysEmptyState");
    if (!grid) return;

    grid.innerHTML = "";

    if (!sysState.items || sysState.items.length === 0) {
      if (empty) empty.classList.remove("hidden");
      return;
    }

    if (empty) empty.classList.add("hidden");

    sysState.items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "sys-prompt-card";
      card.dataset.id = item.id;

      const meta = CATEGORY_META[item.category] || CATEGORY_META.custom;
      const catIcon = item.icon || meta.icon;
      const catName = meta.name;
      const catClass = meta.badgeClass;

      const modelBadge = item.target_model
        ? `<span class="sys-model-badge" title="Önerilen Model">⚡ ${esc(item.target_model)}</span>`
        : "";

      const favActiveClass = item.is_favorite ? "active" : "";
      const favStar = item.is_favorite ? "★" : "☆";

      const tagsHtml = (item.tags || []).map((t) =>
        `<span class="sys-tag-chip" data-tag="${esc(t)}">#${esc(t)}</span>`
      ).join("");

      // Clean preview text (up to 4 lines)
      const previewText = item.content.slice(0, 320) + (item.content.length > 320 ? "..." : "");

      card.innerHTML = `
        <div class="sys-card-header">
          <div style="display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span class="sys-cat-badge ${catClass}">
              <span>${catIcon}</span> <span>${catName}</span>
            </span>
            ${modelBadge}
          </div>
          <button class="sys-btn-fav ${favActiveClass}" type="button" title="${item.is_favorite ? 'Favorilerden Çıkar' : 'Favorilere Ekle'}">${favStar}</button>
        </div>

        <div class="sys-card-body">
          <h3 class="sys-card-title">${esc(item.title)}</h3>
          ${item.description ? `<p class="sys-card-desc muted small">${esc(item.description)}</p>` : ""}
          <div class="sys-content-box" title="Tam metni kopyalamak veya incelemek için tıklayın">
            <pre class="sys-preview-pre"><code>${esc(previewText)}</code></pre>
            <div class="sys-preview-overlay">
              <span class="small" style="color:var(--accent);">👁️ İncelemek veya Kopyalamak İçin Tıklayın</span>
            </div>
          </div>
          ${tagsHtml ? `<div class="sys-card-tags">${tagsHtml}</div>` : ""}
        </div>

        <div class="sys-card-footer">
          <button class="sys-btn-copy primary small" type="button" title="Sistem promptunu tek tıkla panoya kopyala">
            📋 ${window.t ? window.t("sys_copy_prompt") : "Promptu Kopyala"}
          </button>
          <div style="flex:1"></div>
          <button class="sys-btn-inspect ghost small" type="button" title="Detaylı İncele">👁️</button>
          <button class="sys-btn-edit ghost small" type="button" title="Düzenle">✏️</button>
          <button class="sys-btn-del ghost small danger" type="button" title="Sil">🗑️</button>
        </div>
      `;

      // Event listeners
      // 1. Copy button
      const copyBtn = card.querySelector(".sys-btn-copy");
      copyBtn?.addEventListener("click", async (e) => {
        e.stopPropagation();
        await copyPromptToClipboard(item.content, item.title);
        const origText = copyBtn.innerHTML;
        copyBtn.innerHTML = "✓ Kopyalandı!";
        copyBtn.style.background = "#10b981";
        setTimeout(() => {
          copyBtn.innerHTML = origText;
          copyBtn.style.background = "";
        }, 2000);
      });

      // 2. Favorite button
      const favBtn = card.querySelector(".sys-btn-fav");
      favBtn?.addEventListener("click", async (e) => {
        e.stopPropagation();
        await toggleFavorite(item.id);
      });

      // 3. Inspect / Detail modal
      card.querySelector(".sys-content-box")?.addEventListener("click", () => openDetailModal(item));
      card.querySelector(".sys-btn-inspect")?.addEventListener("click", (e) => {
        e.stopPropagation();
        openDetailModal(item);
      });

      // 4. Edit button
      card.querySelector(".sys-btn-edit")?.addEventListener("click", (e) => {
        e.stopPropagation();
        openEditModal(item);
      });

      // 5. Delete button
      card.querySelector(".sys-btn-del")?.addEventListener("click", (e) => {
        e.stopPropagation();
        deletePrompt(item.id, item.title);
      });

      // 6. Tag chip clicks (filters search)
      card.querySelectorAll(".sys-tag-chip").forEach((chip) => {
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          const tag = chip.dataset.tag;
          if (tag) {
            const searchInput = $("#sysSearch");
            if (searchInput) searchInput.value = tag;
            sysState.q = tag;
            loadSystemPrompts();
          }
        });
      });

      grid.appendChild(card);
    });
  }

  // Toggle favorite
  async function toggleFavorite(id) {
    try {
      const updated = await sysApi(`/api/system-prompts/${id}/favorite`, { method: "POST" });
      const idx = sysState.items.findIndex((x) => x.id === id);
      if (idx !== -1) {
        sysState.items[idx] = updated;
        renderSystemPrompts();
        loadSystemPromptStats();
      }
    } catch (err) {
      showToast("Favori güncellenemedi: " + err.message);
    }
  }

  // Delete prompt
  async function deletePrompt(id, title) {
    const confirmMsg = window.currentLang === "en"
      ? `Are you sure you want to delete "${title}"?`
      : `"${title}" sistem promptunu silmek istediğinize emin misiniz?`;

    if (!confirm(confirmMsg)) return;

    try {
      await sysApi(`/api/system-prompts/${id}`, { method: "DELETE" });
      showToast(`"${title}" silindi`);
      sysState.items = sysState.items.filter((x) => x.id !== id);
      renderSystemPrompts();
      loadSystemPromptStats();
    } catch (err) {
      showToast("Silinemedi: " + err.message);
    }
  }

  // Modal: Open Create
  function openCreateModal() {
    sysState.editingId = null;
    const modal = $("#sysPromptModal");
    if (!modal) return;

    $("#sysModalTitle").textContent = window.t ? window.t("sys_modal_new_title") : "➕ Yeni Sistem Promptu Ekle";
    $("#sysTitleInput").value = "";
    $("#sysDescInput").value = "";
    $("#sysContentInput").value = "";
    $("#sysModelInput").value = "";
    $("#sysTagsInput").value = "";
    $("#sysFavInput").checked = false;

    // Default category based on active tab
    const activeCat = sysState.category && sysState.category !== "all" && sysState.category !== "favorite"
      ? sysState.category
      : "custom";
    $("#sysCategoryInput").value = activeCat;
    $("#sysIconInput").value = CATEGORY_META[activeCat]?.icon || "🛠️";

    updateWordCount();
    modal.classList.remove("hidden");
  }

  // Modal: Open Edit
  function openEditModal(item) {
    sysState.editingId = item.id;
    const modal = $("#sysPromptModal");
    if (!modal) return;

    $("#sysModalTitle").textContent = window.t ? window.t("sys_modal_edit_title") : "✏️ Sistem Promptunu Düzenle";
    $("#sysTitleInput").value = item.title || "";
    $("#sysCategoryInput").value = item.category || "custom";
    $("#sysIconInput").value = item.icon || CATEGORY_META[item.category]?.icon || "⚡";
    $("#sysModelInput").value = item.target_model || "";
    $("#sysDescInput").value = item.description || "";
    $("#sysContentInput").value = item.content || "";
    $("#sysTagsInput").value = (item.tags || []).join(", ");
    $("#sysFavInput").checked = Boolean(item.is_favorite);

    updateWordCount();
    modal.classList.remove("hidden");
  }

  function closeSysModal() {
    $("#sysPromptModal")?.classList.add("hidden");
    sysState.editingId = null;
  }

  // Modal: Save Prompt
  async function saveSysPrompt() {
    const title = $("#sysTitleInput")?.value?.trim();
    const content = $("#sysContentInput")?.value?.trim();
    if (!title) {
      alert("Lütfen sistem promptu için bir başlık girin.");
      $("#sysTitleInput")?.focus();
      return;
    }
    if (!content) {
      alert("Lütfen sistem promptu talimatlarını yazın.");
      $("#sysContentInput")?.focus();
      return;
    }

    const category = $("#sysCategoryInput")?.value || "custom";
    const icon = $("#sysIconInput")?.value?.trim() || CATEGORY_META[category]?.icon || "⚡";
    const target_model = $("#sysModelInput")?.value?.trim() || "";
    const description = $("#sysDescInput")?.value?.trim() || "";
    const tagsRaw = $("#sysTagsInput")?.value || "";
    const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
    const is_favorite = Boolean($("#sysFavInput")?.checked);

    const payload = {
      title,
      category,
      icon,
      target_model,
      description,
      content,
      tags,
      is_favorite
    };

    const saveBtn = $("#sysSaveBtn");
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Kaydediliyor...";
    }

    try {
      if (sysState.editingId) {
        await sysApi(`/api/system-prompts/${sysState.editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        showToast(`✓ "${title}" güncellendi`);
      } else {
        await sysApi("/api/system-prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        showToast(`✓ "${title}" kaydedildi`);
      }
      closeSysModal();
      loadSystemPrompts();
    } catch (err) {
      alert("Kaydetme hatası: " + err.message);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = window.t ? window.t("sys_save_btn") : "💾 Kaydet";
      }
    }
  }

  // Word & Character count in modal textarea
  function updateWordCount() {
    const val = $("#sysContentInput")?.value || "";
    const chars = val.length;
    const words = val.trim() ? val.trim().split(/\s+/).length : 0;
    const countEl = $("#sysWordCounter");
    if (countEl) {
      countEl.textContent = `${words} kelime · ${chars} karakter`;
    }
  }

  // Detail Modal
  function openDetailModal(item) {
    sysState.currentDetail = item;
    const modal = $("#sysPromptDetailModal");
    if (!modal) return;

    const meta = CATEGORY_META[item.category] || CATEGORY_META.custom;
    $("#sysDetailCatBadge").textContent = `${item.icon || meta.icon} ${meta.name}`;
    $("#sysDetailCatBadge").className = `sys-cat-badge ${meta.badgeClass}`;

    if ($("#sysDetailModel")) {
      $("#sysDetailModel").textContent = item.target_model ? `⚡ ${item.target_model}` : "Genel LLM";
      $("#sysDetailModel").style.display = item.target_model ? "inline-block" : "none";
    }

    $("#sysDetailTitle").textContent = item.title;
    $("#sysDetailDesc").textContent = item.description || "";
    $("#sysDetailDesc").style.display = item.description ? "block" : "none";

    const codeEl = $("#sysDetailContent");
    if (codeEl) codeEl.textContent = item.content;

    const chars = item.content.length;
    const words = item.content.trim() ? item.content.trim().split(/\s+/).length : 0;
    if ($("#sysDetailCounts")) {
      $("#sysDetailCounts").textContent = `${words} kelime · ${chars} karakter · Eklenme: ${item.created_at ? item.created_at.slice(0, 10) : ''}`;
    }

    const tagsContainer = $("#sysDetailTags");
    if (tagsContainer) {
      tagsContainer.innerHTML = (item.tags || []).map((t) => `<span class="sys-tag-chip">#${esc(t)}</span>`).join("");
      tagsContainer.style.display = (item.tags && item.tags.length) ? "flex" : "none";
    }

    modal.classList.remove("hidden");
  }

  function closeDetailModal() {
    $("#sysPromptDetailModal")?.classList.add("hidden");
    sysState.currentDetail = null;
  }

  // Sub-navigation tabs click handler
  function initTabs() {
    $$("#tabs-sysprompts button").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$("#tabs-sysprompts button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        const cat = btn.dataset.sysCategory || "all";
        sysState.category = cat;
        sysState.isFavorite = (cat === "favorite");
        loadSystemPrompts();
      });
    });
  }

  // Setup DOM events
  function initEvents() {
    // 1. Search debounce
    let searchTimer = null;
    $("#sysSearch")?.addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        sysState.q = e.target.value.trim();
        loadSystemPrompts();
      }, 300);
    });

    // 2. Clear search button
    $("#sysClearSearch")?.addEventListener("click", () => {
      const searchInput = $("#sysSearch");
      if (searchInput) searchInput.value = "";
      sysState.q = "";
      loadSystemPrompts();
    });

    // 3. New Prompt button
    $("#btnNewSysPrompt")?.addEventListener("click", openCreateModal);
    $("#btnNewSysPromptEmpty")?.addEventListener("click", openCreateModal);

    // 4. Modal events
    $("#sysModalClose")?.addEventListener("click", closeSysModal);
    $("#sysCancelBtn")?.addEventListener("click", closeSysModal);
    $("#sysSaveBtn")?.addEventListener("click", saveSysPrompt);
    $("#sysPromptModal")?.addEventListener("click", (e) => {
      if (e.target.id === "sysPromptModal") closeSysModal();
    });

    // 5. Category change in modal auto-suggest icon
    $("#sysCategoryInput")?.addEventListener("change", (e) => {
      const cat = e.target.value;
      const iconInput = $("#sysIconInput");
      if (iconInput && (!iconInput.value || ["💎", "📦", "🤖", "🛠️", "⚡"].includes(iconInput.value))) {
        iconInput.value = CATEGORY_META[cat]?.icon || "⚡";
      }
    });

    // 6. Textarea word counter
    $("#sysContentInput")?.addEventListener("input", updateWordCount);

    // 7. Helper template buttons in modal
    $("#btnInsertRoleTemplate")?.addEventListener("click", () => {
      const ta = $("#sysContentInput");
      if (!ta) return;
      const snippet = "\n\n# KİMLİK & ROL\nSen [Rol Adı / Uzmanlık] konusunda dünyanın önde gelen bir uzmanısın.\n";
      ta.value += snippet;
      updateWordCount();
      ta.focus();
    });

    $("#btnInsertConstraintsTemplate")?.addEventListener("click", () => {
      const ta = $("#sysContentInput");
      if (!ta) return;
      const snippet = "\n\n# KISITLAMALAR VE KURALLAR\n- Gereksiz dolgu veya teorik açıklama yapma; doğrudan çözüme odaklan.\n- Her zaman temiz, test edilebilir ve standartlara uygun çıktılar ver.\n";
      ta.value += snippet;
      updateWordCount();
      ta.focus();
    });

    // 8. Detail Modal events
    $("#sysDetailClose")?.addEventListener("click", closeDetailModal);
    $("#sysDetailModal")?.addEventListener("click", (e) => {
      if (e.target.id === "sysPromptDetailModal") closeDetailModal();
    });

    $("#sysDetailCopyBtn")?.addEventListener("click", async () => {
      if (!sysState.currentDetail) return;
      await copyPromptToClipboard(sysState.currentDetail.content, sysState.currentDetail.title);
      const btn = $("#sysDetailCopyBtn");
      if (btn) {
        btn.textContent = "✓ Kopyalandı!";
        setTimeout(() => (btn.textContent = "📋 Panoya Kopyala"), 2000);
      }
    });

    $("#sysDetailEditBtn")?.addEventListener("click", () => {
      const item = sysState.currentDetail;
      closeDetailModal();
      if (item) openEditModal(item);
    });

    $("#sysDetailExportMd")?.addEventListener("click", () => {
      if (!sysState.currentDetail) return;
      window.location.href = `/api/system-prompts/${sysState.currentDetail.id}/export?format=md`;
    });

    $("#sysDetailExportTxt")?.addEventListener("click", () => {
      if (!sysState.currentDetail) return;
      window.location.href = `/api/system-prompts/${sysState.currentDetail.id}/export?format=txt`;
    });
  }

  // Export functions to window
  window.loadSystemPrompts = loadSystemPrompts;
  window.loadSystemPromptStats = loadSystemPromptStats;
  window.openCreateSysPromptModal = openCreateModal;

  // Initialize when DOM ready
  function init() {
    initTabs();
    initEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
