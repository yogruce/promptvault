"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, opts = {}) {
  const o = { ...opts, headers: { ...(opts.headers || {}) } };
  if (o.body && typeof o.body !== "string" && !(o.body instanceof FormData)) {
    o.headers["Content-Type"] = "application/json";
    o.body = JSON.stringify(o.body);
  }
  const r = await fetch(path, o);
  if (!r.ok) {
    let msg = r.statusText;
    try { const j = await r.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch {}
    throw new Error(msg);
  }
  const ct = r.headers.get("content-type") || "";
  return ct.includes("json") ? r.json() : r.text();
}
let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
async function copy(text) { await navigator.clipboard.writeText(text); toast("Panoya kopyalandı"); }

/* ------------------------------------------------------------ tabs */
function showTab(name) {
  const vSettings = $("#view-settings");
  const vImages = $("#view-images");
  const vMusic = $("#view-music");
  const btnSettings = $("#btnGlobalSettings");
  if (vSettings && !vSettings.classList.contains("hidden")) {
    vSettings.classList.add("hidden");
    vImages?.classList.remove("hidden");
    vMusic?.classList.add("hidden");
    btnSettings?.classList.remove("active");
    $("#btnDomainImages")?.classList.add("active");
    $("#btnDomainMusic")?.classList.remove("active");
    $("#tabs")?.classList.remove("hidden");
    $("#tabs-music")?.classList.add("hidden");
  }
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + name));
  if (name === "gallery" && G.items.length === 0) loadGallery();
  if (name === "workspaces") loadImageWorkspaces();
  if (name === "tags") loadTags();
  if (name === "matrix") loadMatrices();
  if (name === "wildcards") loadWildcards();
  if (name === "scan") loadLibStats();
}

function showSettingsView() {
  const vSettings = $("#view-settings");
  const vImages = $("#view-images");
  const vMusic = $("#view-music");
  const btnSettings = $("#btnGlobalSettings");
  const navImages = $("#tabs");
  const navMusic = $("#tabs-music");

  vImages?.classList.add("hidden");
  vMusic?.classList.add("hidden");
  vSettings?.classList.remove("hidden");
  btnSettings?.classList.add("active");
  $("#btnDomainImages")?.classList.remove("active");
  $("#btnDomainMusic")?.classList.remove("active");
  navImages?.classList.add("hidden");
  navMusic?.classList.add("hidden");

  loadLibStats();
  loadGDriveStatus();
  loadQuickImportStatus();
}
$("#btnGlobalSettings")?.addEventListener("click", showSettingsView);
$$("#tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-goto]"); if (g) { e.preventDefault(); showTab(g.dataset.goto); }
});

async function loadStats() {
  const s = await api("/api/stats");
  const imgWord = window.t ? window.t("stat_images") : "görsel";
  const tagWord = window.t ? window.t("stat_tags") : "etiket";
  const favWord = window.t ? window.t("stat_favorites") : "favori";
  $("#stats").textContent = `${s.images} ${imgWord} · ${s.tags} ${tagWord} · ${s.favorites} ${favWord}`;
  return s;
}

/* ---------------------------------------------------------- gallery */
const G = { items: [], total: 0, offset: 0, limit: 60, selecting: false, selected: new Set(), current: -1, workspaceId: null };
let lastSelectedIdx = null;

function quoteTag(name) { return /\s/.test(name) ? `tag:"${name}"` : `tag:${name}`; }
function searchFor(q) { $("#q").value = q; showTab("gallery"); closeModal(); loadGallery(); }

let isGalleryLoading = false;
async function loadGallery(append = false, retries = 8) {
  if (isGalleryLoading && !append) return;
  isGalleryLoading = true;
  try {
    if (!append) { G.offset = 0; G.items = []; }
    const qEl = $("#q");
    const qVal = qEl ? qEl.value.trim() : "";
    const sortVal = $("#sort") ? $("#sort").value : "added";
    const params = new URLSearchParams({ q: qVal, sort: sortVal, limit: G.limit, offset: G.offset });
    if (G.workspaceId !== null && G.workspaceId !== undefined && G.workspaceId !== "") {
      params.set("workspace_id", G.workspaceId);
    }
    const res = await api("/api/images?" + params);
    if (!res || !Array.isArray(res.items)) {
      throw new Error("Sunucudan geçersiz veri döndü");
    }
    G.total = typeof res.total === "number" ? res.total : res.items.length;
    if (append) {
      G.items.push(...res.items);
    } else {
      G.items = [...res.items];
    }
    G.offset = G.items.length;
    renderGrid(append ? res.items : G.items, append);
    const resWord = window.t ? window.t("results_count") : "sonuç";
    if ($("#resultInfo")) $("#resultInfo").textContent = `${G.total} ${resWord}`;
    if ($("#more")) $("#more").classList.toggle("hidden", G.items.length >= G.total);
    if ($("#empty")) $("#empty").classList.toggle("hidden", G.total > 0 || qVal !== "");
  } catch (e) {
    console.warn("loadGallery error:", e);
    if (retries > 0) {
      const delay = Math.min(2500, 300 + (8 - retries) * 300);
      if ($("#resultInfo") && G.items.length === 0) {
        $("#resultInfo").textContent = window.currentLang === "en" ? "Connecting to vault server..." : "Kasa sunucusuna bağlanılıyor...";
      }
      setTimeout(() => {
        isGalleryLoading = false;
        loadGallery(append, retries - 1);
      }, delay);
      return;
    }
    if ($("#resultInfo")) $("#resultInfo").textContent = e.message || "Yüklenemedi";
  } finally {
    isGalleryLoading = false;
  }
}
window.loadGallery = loadGallery;
window.G = G;

function cardHTML(it, idx) {
  const cap = it.prompt
    ? esc(it.prompt.slice(0, 140))
    : `<i>${window.currentLang === "en" ? "no prompt" : "prompt yok"}</i>`;
  const isSel = G.selected.has(it.id);
  const wsBadge = it.workspace_name
    ? `<span class="card-ws-badge" style="background:${esc(it.workspace_color || '#8b5cf6')}33; color:${esc(it.workspace_color || '#8b5cf6')}; border:1px solid ${esc(it.workspace_color || '#8b5cf6')}66;" title="${esc(it.workspace_name)}">${esc(it.workspace_icon || '📁')} ${esc(it.workspace_name)}</span>`
    : '';
  return `<div class="card ${isSel ? "selected" : ""}" data-idx="${idx}" data-id="${it.id}">
    <img loading="lazy" src="/api/images/${it.id}/thumb" alt="">
    <span class="gen">${esc(it.generator || "?")}</span>${it.favorite ? '<span class="fav">★</span>' : ""}
    ${wsBadge}
    <span class="chk" title="Seç (Shift ile aralık seçebilirsiniz)">${isSel ? "✓" : ""}</span>
    <div class="cap" title="${esc(it.prompt)}">${cap}</div></div>`;
}

function renderGrid(items, append) {
  const grid = $("#grid");
  const start = append ? G.items.length - items.length : 0;
  const html = items.map((it, i) => cardHTML(it, start + i)).join("");
  if (append) grid.insertAdjacentHTML("beforeend", html); else grid.innerHTML = html;
}

function toggleSelect(id, selectState = null) {
  const card = $(`#grid .card[data-id="${id}"]`);
  const shouldSelect = selectState !== null ? selectState : !G.selected.has(id);
  if (shouldSelect) {
    G.selected.add(id);
    if (card) {
      card.classList.add("selected");
      const chk = card.querySelector(".chk");
      if (chk) chk.textContent = "✓";
    }
  } else {
    G.selected.delete(id);
    if (card) {
      card.classList.remove("selected");
      const chk = card.querySelector(".chk");
      if (chk) chk.textContent = "";
    }
  }
  updateBulk();
}

function updateBulk() {
  const count = G.selected.size;
  const selWord = window.t ? window.t("bulk_selected") : "seçili";
  $("#bulkCount").textContent = `${count} ${selWord}`;
  $("#bulkbar").classList.toggle("hidden", count === 0 && !G.selecting);
  $("#bulkDelete").textContent = count > 0
    ? (window.currentLang === "en" ? `🗑 Delete ${count} Selected` : `🗑 Seçilen ${count} Görseli Sil`)
    : (window.t ? window.t("bulk_delete") : "🗑 Seçilenleri Sil");
}

function removeImagesFromUI(deletedIds) {
  const set = new Set(deletedIds);
  G.items = G.items.filter((it) => !set.has(it.id));
  G.total = Math.max(0, G.total - deletedIds.length);
  G.offset = Math.max(0, G.offset - deletedIds.length);

  // Kartları sayfayı veya yüklenenleri sıfırlamadan doğrudan DOM'dan sil
  deletedIds.forEach((id) => {
    G.selected.delete(id);
    const card = document.querySelector(`#grid .card[data-id="${id}"]`);
    if (card) card.remove();
  });

  // Kalan kartların indekslerini güncelle (modal yönlendirmesi için)
  $$("#grid .card").forEach((card, i) => {
    card.dataset.idx = i;
  });

  updateBulk();
  const resWord = window.t ? window.t("results_count") : "sonuç";
  $("#resultInfo").textContent = `${G.total} ${resWord}`;
  $("#empty").classList.toggle("hidden", G.total > 0 || $("#q").value !== "");
  $("#more").classList.toggle("hidden", G.items.length >= G.total);
}

$("#grid").addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (!card) return;
  const id = +card.dataset.id;
  const idx = +card.dataset.idx;
  const isChk = Boolean(e.target.closest(".chk"));

  // Checkbox'a tıklandıysa veya seçim modu açıksa
  if (isChk || G.selecting) {
    // Shift + Tık ile toplu aralık seçimi
    if (e.shiftKey && lastSelectedIdx !== null && lastSelectedIdx !== idx) {
      const start = Math.min(lastSelectedIdx, idx);
      const end = Math.max(lastSelectedIdx, idx);
      for (let i = start; i <= end; i++) {
        if (G.items[i]) toggleSelect(G.items[i].id, true);
      }
    } else {
      toggleSelect(id);
      lastSelectedIdx = idx;
    }
    return;
  }

  // Normal tıkta detay modalini aç
  openDetail(idx);
});

$("#q").addEventListener("input", debounce(() => loadGallery(), 350));
$("#sort").onchange = () => loadGallery();
$("#imgWsFilter")?.addEventListener("change", (e) => {
  G.workspaceId = e.target.value ? parseInt(e.target.value, 10) : null;
  loadGallery();
});
$("#more").onclick = () => loadGallery(true);

// Otomatik sonsuz kaydırma (Infinite Scroll) - butona sürekli basma zorunluluğunu kaldırır
if ("IntersectionObserver" in window) {
  const moreObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !$("#more").classList.contains("hidden")) {
      loadGallery(true);
    }
  }, { rootMargin: "350px" });
  moreObserver.observe($("#more"));
}

$("#selectMode").onclick = () => {
  G.selecting = !G.selecting;
  $("#grid").classList.toggle("selecting", G.selecting);
  $("#bulkbar").classList.toggle("hidden", !G.selecting && G.selected.size === 0);
  $("#selectMode").textContent = G.selecting
    ? (window.t ? "☑ " + (window.currentLang === "en" ? "Selection Active" : "Seçim Açık") : "☑ Seçim Açık")
    : (window.t ? window.t("btn_select_mode") : "☐ Çoklu Seçim");
};

$("#bulkAll").onclick = () => {
  G.items.forEach((i) => G.selected.add(i.id));
  $$(".card").forEach((c) => {
    c.classList.add("selected");
    const chk = c.querySelector(".chk");
    if (chk) chk.textContent = "✓";
  });
  updateBulk();
};

$("#bulkClear").onclick = () => {
  G.selected.clear();
  $$(".card").forEach((c) => {
    c.classList.remove("selected");
    const chk = c.querySelector(".chk");
    if (chk) chk.textContent = "";
  });
  updateBulk();
};

$("#bulkApply").onclick = async () => {
  const tags = $("#bulkTags").value.split(",").map((s) => s.trim()).filter(Boolean);
  if (!tags.length || !G.selected.size) return toast("Etiket ve görsel seçin");
  const r = await api("/api/bulk/tags", { method: "POST", body: { ids: [...G.selected], tags } });
  toast(`${r.updated} görsel etiketlendi`);
  $("#bulkTags").value = "";
  loadStats();
};

$("#bulkMoveWs")?.addEventListener("click", async () => {
  const ids = Array.from(G.selected);
  if (!ids.length) return toast(window.currentLang === "en" ? "Select images first" : "Lütfen önce görsel seçin");
  const wsVal = $("#bulkWorkspaceSelect")?.value;
  const wsId = wsVal ? parseInt(wsVal, 10) : null;
  try {
    const res = await api("/api/images/bulk-workspace", {
      method: "POST",
      body: { ids, workspace_id: wsId }
    });
    toast(window.currentLang === "en" ? `Moved ${res.updated} images to workspace` : `${res.updated} görsel projeye taşındı!`);
    G.selected.clear();
    updateBulk();
    loadGallery();
    loadImageWorkspaces();
    if (typeof window.loadWorkspaces === "function") window.loadWorkspaces();
  } catch (e) {
    toast("Hata: " + e.message);
  }
});

$("#bulkDelete").onclick = async () => {
  if (!G.selected.size) return toast("Lütfen silinecek görselleri seçin");
  const count = G.selected.size;
  if (!confirm(`${count} adet görseli kasadan silmek istediğinize emin misiniz?\n(Not: Orijinal dosyalarınız korunur, yalnızca kasa kayıtları ve kasa kopyaları silinir.)`)) return;
  const idsToDelete = [...G.selected];
  try {
    const r = await api("/api/bulk/delete", { method: "POST", body: { ids: idsToDelete } });
    toast(`${r.deleted_count} görsel kasadan silindi`);
    removeImagesFromUI(idsToDelete);
    loadStats();
  } catch (err) {
    toast("Silme hatası: " + err.message);
  }
};

// Klavyeden Delete tuşuna basıldığında seçilenleri sil
document.addEventListener("keydown", (e) => {
  if (e.key === "Delete" || e.key === "Backspace") {
    if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if ($("#modal").classList.contains("hidden") && G.selected.size > 0) {
      e.preventDefault();
      $("#bulkDelete").click();
    }
  }
});

/* ----------------------------------------------------------- detail */
let isEditingPrompt = false;

async function openDetail(idx) {
  if (idx < 0 || idx >= G.items.length) return;
  G.current = idx;
  isEditingPrompt = false;
  const id = G.items[idx].id;
  const d = await api(`/api/images/${id}`);
  $("#dImg").src = `/api/images/${id}/file`;
  renderDetail(d);
  $("#modal").classList.remove("hidden");
}
function closeModal() { $("#modal").classList.add("hidden"); isEditingPrompt = false; }
$("#mClose").onclick = closeModal;
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
$("#dPrev").onclick = () => openDetail(G.current - 1);
$("#dNext").onclick = async () => {
  if (G.current + 1 >= G.items.length && G.items.length < G.total) await loadGallery(true);
  openDetail(G.current + 1);
};
document.addEventListener("keydown", (e) => {
  if ($("#modal").classList.contains("hidden") || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (e.key === "Escape") closeModal();
  if (e.key === "ArrowLeft") $("#dPrev").click();
  if (e.key === "ArrowRight") $("#dNext").click();
});

function renderDetail(d) {
  const p = d.params || {};
  const order = ["model", "steps", "sampler", "scheduler", "cfg_scale", "seed", "width", "height", "denoise", "clip_skip"];
  const keys = [...order.filter((k) => k in p), ...Object.keys(p).filter((k) => !order.includes(k))];
  const rows = keys.map((k) => `<tr><td>${esc(k)}</td><td>${esc(typeof p[k] === "object" ? JSON.stringify(p[k]) : p[k])}</td></tr>`).join("");
  const tagChip = (t) => `<span class="chip ${t.kind}" data-tag="${esc(t.name)}" data-kind="${t.kind}" data-source="${t.source}"
      title="${t.kind}${t.weight !== 1 ? " · ağırlık " + t.weight : ""}">${esc(t.name)}${t.source === "user" ? '<span class="x">×</span>' : ""}</span>`;
  const stars = [1, 2, 3, 4, 5].map((n) => `<span data-r="${n}" class="${n <= d.rating ? "on" : ""}">★</span>`).join("");

  const vaultBadge = d.vault_exists
    ? (d.original_exists
        ? `<span class="vault-badge" title="Görsel ve prompt kasa deposunda korunuyor">${window.t ? window.t("detail_safe_vault") : "🔒 Kasada Güvende"}</span>`
        : `<span class="vault-badge unlinked" title="Kaynak dosya diskte silinmiş, ancak kasada korunuyor!">${window.t ? window.t("detail_safe_source_deleted") : "🔒 Kasada Korunuyor (Kaynak Silinmiş)"}</span>`)
    : `<span class="muted small">${window.t ? window.t("detail_on_disk") : "Diskte"}</span>`;

  $("#dInfo").innerHTML = `
    <div class="row">
      <span class="kind generator">${esc(d.generator)}</span>
      ${vaultBadge}
      <span class="muted small">${d.width}×${d.height}</span>
      <span class="stars" id="dStars">${stars}</span>
      <button class="favbtn" id="dFav">${d.favorite ? (window.t ? window.t("detail_fav_on") : "★ Favori") : (window.t ? window.t("detail_fav_off") : "☆ Favori")}</button>
      <button class="ghost danger small" id="dDelete" title="Görseli kasadan sil" style="margin-left:auto">${window.t ? window.t("detail_delete_vault") : "🗑 Kasadan Sil"}</button>
    </div>
    <div class="path">${esc(d.path)}</div>

    <h4>${window.t ? window.t("detail_prompt") : "Prompt"}
      <button class="ghost" id="dEditPrompt">${isEditingPrompt ? (window.t ? window.t("detail_cancel") : "İptal") : (window.t ? window.t("detail_edit") : "✏ Düzenle")}</button>
      <button class="ghost" id="dCopyP">${window.t ? window.t("detail_copy") : "Kopyala"}</button>
      <button class="ghost" id="dToMatrix">${window.t ? window.t("detail_to_matrix") : "Matrise aktar"}</button>
    </h4>

    ${isEditingPrompt ? `
      <div>
        <div class="row" style="margin-bottom:8px">
          <label style="margin:0; width:90px">${window.t ? window.t("detail_generator") : "Üretici Araç:"}</label>
          <select id="dGenEdit" style="flex:1">
            <option value="gemini" ${d.generator === "gemini" ? "selected" : ""}>Gemini</option>
            <option value="imagen" ${d.generator === "imagen" ? "selected" : ""}>Imagen</option>
            <option value="midjourney" ${d.generator === "midjourney" ? "selected" : ""}>Midjourney</option>
            <option value="dall-e" ${d.generator === "dall-e" ? "selected" : ""}>DALL-E</option>
            <option value="a1111" ${d.generator === "a1111" ? "selected" : ""}>Automatic1111 / WebUI</option>
            <option value="comfyui" ${d.generator === "comfyui" ? "selected" : ""}>ComfyUI</option>
            <option value="novelai" ${d.generator === "novelai" ? "selected" : ""}>NovelAI</option>
            <option value="invokeai" ${d.generator === "invokeai" ? "selected" : ""}>InvokeAI</option>
            <option value="fooocus" ${d.generator === "fooocus" ? "selected" : ""}>Fooocus</option>
            <option value="forge" ${d.generator === "forge" ? "selected" : ""}>Forge</option>
            <option value="generic" ${d.generator === "generic" || d.generator === "manual" ? "selected" : ""}>Diğer / Manuel</option>
          </select>
        </div>
        <textarea id="dPromptEdit" class="ptext-edit" rows="5">${esc(d.prompt)}</textarea>
        <h4>${window.t ? window.t("detail_neg_prompt") : "Negatif Prompt"}</h4>
        <textarea id="dNegEdit" class="ptext-edit" rows="3">${esc(d.negative)}</textarea>
        <div class="row" style="margin-top:8px">
          <button id="dSavePrompt" class="primary">${window.t ? window.t("detail_save_prompt") : "💾 Değişiklikleri Kaydet"}</button>
        </div>
      </div>
    ` : `
      <div class="ptext">${esc(d.prompt) || `<i class="muted">${window.t ? window.t("detail_none") : "yok"}</i>`}</div>
      ${d.negative ? `<h4>Negatif <button class="ghost" id="dCopyN">${window.t ? window.t("detail_copy") : "Kopyala"}</button></h4><div class="ptext neg">${esc(d.negative)}</div>` : ""}
    `}

    <h4>${window.t ? window.t("detail_params") : "Parametreler"} <button class="ghost" id="dCopyAll">${window.t ? window.t("detail_copy_a1111") : "A1111 biçiminde kopyala"}</button></h4>
    <table class="params">${rows || `<tr><td colspan="2" class="muted">${window.t ? window.t("detail_none") : "yok"}</td></tr>`}</table>
    <h4>${window.t ? window.t("detail_tags") : "Etiketler"} <span class="muted small" style="text-transform:none">${window.t ? window.t("detail_tags_hint") : "(tıkla = ara)"}</span></h4>
    <div class="chips" id="dTags">${d.tags.map(tagChip).join("")}</div>
    <div class="row"><input id="dTagInput" placeholder="${window.t ? window.t("detail_add_tag_ph") : "kullanıcı etiketi ekle (virgülle)"}" style="flex:1"><button id="dTagAdd" class="ghost">${window.t ? window.t("detail_add_tag_btn") : "Ekle"}</button></div>
    
    <div class="row" style="margin: 10px 0; align-items: center; gap: 8px; background:var(--panel2); padding:8px 12px; border-radius:6px;">
      <label style="margin:0; font-weight:600; font-size:12px; color:var(--muted);">${window.t ? window.t("detail_workspace") : "🏢 Proje / Alan:"}</label>
      <select id="dWorkspace" style="flex:1; padding:4px 8px; font-size:12.5px; border-radius:4px;">
        ${imageWorkspaces.map(w => `<option value="${w.id}" ${w.id === d.workspace_id ? "selected" : ""}>${esc(w.icon || '📁')} ${esc(w.name)}</option>`).join("")}
      </select>
    </div>

    <h4>${window.t ? window.t("detail_notes") : "Notlar"}</h4><textarea id="dNotes" rows="3" placeholder="${window.t ? window.t("detail_notes_ph") : "Bu görsel hakkında not..."}">${esc(d.notes)}</textarea>
    <details><summary class="muted small">${window.t ? window.t("detail_raw_meta") : "Ham metadata"} (${Object.keys(d.raw || {}).length} chunk)</summary><pre class="raw">${esc(JSON.stringify(d.raw, null, 2))}</pre></details>`;

  const patch = async (body) => {
    const nd = await api(`/api/images/${d.id}`, { method: "PATCH", body });
    Object.assign(G.items[G.current], nd);
    renderDetail(nd);
  };

  const btnEditPrompt = $("#dEditPrompt");
  if (btnEditPrompt) {
    btnEditPrompt.onclick = () => {
      isEditingPrompt = !isEditingPrompt;
      renderDetail(d);
    };
  }

  if (isEditingPrompt) {
    const btnSavePrompt = $("#dSavePrompt");
    if (btnSavePrompt) {
      btnSavePrompt.onclick = async () => {
        const newPrompt = $("#dPromptEdit")?.value || "";
        const newNeg = $("#dNegEdit")?.value || "";
        const newGen = $("#dGenEdit") ? $("#dGenEdit").value : undefined;
        await patch({ prompt: newPrompt, negative: newNeg, generator: newGen });
        isEditingPrompt = false;
        toast("Prompt ve üretici güncellendi");
        renderGrid(G.items, false);
        loadStats();
      };
    }
  }

  const dStars = $("#dStars");
  if (dStars) dStars.onclick = (e) => { const r = +e.target.dataset.r; if (r) patch({ rating: r === d.rating ? 0 : r }); };

  const dFav = $("#dFav");
  if (dFav) dFav.onclick = () => patch({ favorite: !d.favorite }).then(() => { renderGrid(G.items, false); loadStats(); });

  const dNotes = $("#dNotes");
  if (dNotes) dNotes.onchange = (e) => patch({ notes: e.target.value }).then(() => toast("Not kaydedildi"));

  const dWs = $("#dWorkspace");
  if (dWs) {
    dWs.onchange = async () => {
      const newWsId = dWs.value ? parseInt(dWs.value, 10) : null;
      try {
        await patch({ workspace_id: newWsId });
        renderGrid(G.items, false);
        loadImageWorkspaces();
        toast(window.currentLang === "en" ? "Workspace updated" : "Çalışma alanı güncellendi");
      } catch (err) {
        toast("Hata: " + err.message);
      }
    };
  }

  const dCopyP = $("#dCopyP");
  if (dCopyP) dCopyP.onclick = () => copy(d.prompt);

  const dCopyN = $("#dCopyN");
  if (dCopyN) dCopyN.onclick = () => copy(d.negative);

  const dCopyAll = $("#dCopyAll");
  if (dCopyAll) dCopyAll.onclick = () => copy(toA1111(d));

  const dToMatrix = $("#dToMatrix");
  if (dToMatrix) dToMatrix.onclick = () => { closeModal(); sendToMatrix(d); };

  const dDelete = $("#dDelete");
  if (dDelete) {
    dDelete.onclick = async () => {
      if (!confirm("Bu görseli kasadan silmek istediğinize emin misiniz?\n(Not: Bilgisayarınızdaki orijinal dosya korunur, yalnızca kasa kaydı silinir.)")) return;
      try {
        await api(`/api/images/${d.id}`, { method: "DELETE" });
        toast("Görsel kasadan silindi");
        closeModal();
        removeImagesFromUI([d.id]);
        loadStats();
      } catch (err) {
        toast("Silme hatası: " + err.message);
      }
    };
  }

  const addTags = async () => {
    const raw = $("#dTagInput")?.value || "";
    const tags = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!tags.length) return;
    d.tags = await api(`/api/images/${d.id}/tags`, { method: "POST", body: { tags } });
    if ($("#dTagInput")) $("#dTagInput").value = "";
    toast(`Etiket eklendi: ${tags.join(", ")}`);
    renderDetail(d);
    loadStats();
  };
  const dTagAdd = $("#dTagAdd");
  if (dTagAdd) dTagAdd.onclick = addTags;
  const dTagInput = $("#dTagInput");
  if (dTagInput) dTagInput.onkeydown = (e) => { if (e.key === "Enter") addTags(); };

  const dTags = $("#dTags");
  if (dTags) {
    dTags.onclick = async (e) => {
      const chip = e.target.closest(".chip"); if (!chip) return;
      if (e.target.classList.contains("x")) {
        const removedName = chip.dataset.tag;
        d.tags = await api(`/api/images/${d.id}/tags/${encodeURIComponent(removedName)}?kind=user`, { method: "DELETE" });
        toast(`Etiket silindi: ${removedName}`);
        renderDetail(d);
        loadStats();
        return;
      }
      const k = chip.dataset.kind, n = chip.dataset.tag;
      if (k === "generator") searchFor(`gen:${n}`); else if (k === "lora") searchFor(`lora:"${n}"`); else searchFor(quoteTag(n));
    };
  }
}

function toA1111(d) {
  const p = d.params || {};
  const names = { steps: "Steps", sampler: "Sampler", scheduler: "Schedule type", cfg_scale: "CFG scale", seed: "Seed", model: "Model", denoise: "Denoising strength", clip_skip: "Clip skip" };
  const parts = Object.entries(names).filter(([k]) => p[k] !== undefined).map(([k, n]) => `${n}: ${p[k]}`);
  if (p.width && p.height) parts.splice(4, 0, `Size: ${p.width}x${p.height}`);
  return `${d.prompt}\n${d.negative ? "Negative prompt: " + d.negative + "\n" : ""}${parts.join(", ")}`;
}

/* ------------------------------------------------------------- upload & manual add */
let selectedUploadFile = null;

function openUploadModal(file = null) {
  selectedUploadFile = file;
  $("#uploadModal").classList.remove("hidden");
  if (file) {
    handleFileSelected(file);
  } else {
    $("#uPreview").classList.add("hidden");
    $("#dropPrompt").textContent = window.t ? window.t("upload_drop_prompt") : "📁 Görsel seçmek için tıklayın veya buraya sürükleyin";
    $("#uPrompt").value = "";
    $("#uNegative").value = "";
    $("#uModel").value = "";
    $("#uTags").value = "";
    $("#uNotes").value = "";
  }
}
function closeUploadModal() {
  $("#uploadModal").classList.add("hidden");
  selectedUploadFile = null;
}

$("#btnUpload").onclick = () => openUploadModal();
$("#uClose").onclick = closeUploadModal;
$("#uCancel").onclick = closeUploadModal;
$("#uploadModal").addEventListener("click", (e) => { if (e.target.id === "uploadModal") closeUploadModal(); });

const dropZone = $("#dropZone");
dropZone.onclick = () => $("#uFileInput").click();
$("#uFileInput").onchange = (e) => {
  if (e.target.files.length) handleFileSelected(e.target.files[0]);
};

dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add("dragover"); };
dropZone.ondragleave = () => dropZone.classList.remove("dragover");
dropZone.ondrop = (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files.length) handleFileSelected(e.dataTransfer.files[0]);
};

// Global drag-and-drop onto page
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) {
    const f = e.dataTransfer.files[0];
    if (f.type.startsWith("image/") || f.name.endsWith(".png")) {
      openUploadModal(f);
    }
  }
});

async function handleFileSelected(file) {
  selectedUploadFile = file;
  $("#dropPrompt").textContent = `Seçilen: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  const url = URL.createObjectURL(file);
  $("#uPreview").src = url;
  $("#uPreview").classList.remove("hidden");

  // Read PNG metadata directly in browser to pre-fill prompt inputs
  try {
    const buf = await file.arrayBuffer();
    const textChunks = extractPngTextChunks(new Uint8Array(buf));
    if (textChunks.parameters) {
      const lines = textChunks.parameters.split("\n");
      const pos = [];
      const neg = [];
      let inNeg = false;
      for (const line of lines) {
        if (line.startsWith("Negative prompt:")) {
          inNeg = true;
          neg.push(line.replace("Negative prompt:", "").trim());
        } else if (line.includes("Steps:") && line.includes("Sampler:")) {
          const mMatch = line.match(/Model:\s*([^,]+)/);
          if (mMatch) $("#uModel").value = mMatch[1].trim();
        } else {
          (inNeg ? neg : pos).push(line);
        }
      }
      if (pos.length && !$("#uPrompt").value) $("#uPrompt").value = pos.join("\n").trim();
      if (neg.length && !$("#uNegative").value) $("#uNegative").value = neg.join("\n").trim();
    } else if (textChunks.Description && !$("#uPrompt").value) {
      $("#uPrompt").value = textChunks.Description.trim();
    } else if (textChunks.prompt && !$("#uPrompt").value) {
      // ComfyUI json or plain prompt
      try {
        const c = JSON.parse(textChunks.prompt);
        for (const n of Object.values(c)) {
          if (n.class_type === "CLIPTextEncode" && n.inputs && typeof n.inputs.text === "string") {
            if (!$("#uPrompt").value) $("#uPrompt").value = n.inputs.text;
            else if (!$("#uNegative").value) $("#uNegative").value = n.inputs.text;
          }
        }
      } catch {}
    }
  } catch {}
}

function extractPngTextChunks(bytes) {
  const chunks = {};
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return chunks;
  let pos = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder("utf-8");
  while (pos + 8 < bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos+4], bytes[pos+5], bytes[pos+6], bytes[pos+7]);
    if (type === "tEXt") {
      const data = bytes.subarray(pos + 8, pos + 8 + len);
      const nul = data.indexOf(0);
      if (nul > 0) {
        const key = dec.decode(data.subarray(0, nul));
        const val = dec.decode(data.subarray(nul + 1));
        chunks[key] = val;
      }
    }
    pos += 12 + len;
    if (type === "IEND") break;
  }
  return chunks;
}

$("#uSubmit").onclick = async () => {
  const prompt = $("#uPrompt").value;
  const negative = $("#uNegative").value;
  const model = $("#uModel").value;
  const generator = $("#uGenerator") ? $("#uGenerator").value : "";
  const tags = $("#uTags").value;
  const notes = $("#uNotes").value;
  const wsVal = $("#uWorkspace") ? $("#uWorkspace").value : "";
  const workspace_id = wsVal ? parseInt(wsVal, 10) : null;

  if (selectedUploadFile) {
    const fd = new FormData();
    fd.append("file", selectedUploadFile);
    if (prompt) fd.append("prompt", prompt);
    if (negative) fd.append("negative", negative);
    if (model) fd.append("model", model);
    if (generator) fd.append("generator", generator);
    if (tags) fd.append("tags", tags);
    if (notes) fd.append("notes", notes);
    if (workspace_id) fd.append("workspace_id", workspace_id);

    try {
      const res = await api("/api/upload", { method: "POST", body: fd });
      toast("Görsel ve prompt kasaya eklendi!");
      closeUploadModal();
      loadStats();
      loadGallery();
      loadImageWorkspaces();
    } catch (e) {
      toast("Hata: " + e.message);
    }
  } else {
    // Manual add without an image file
    if (!prompt.trim()) return toast("Lütfen en az bir prompt yazın veya bir görsel seçin");
    try {
      const tagList = tags.split(",").map((s) => s.trim()).filter(Boolean);
      await api("/api/manual-add", {
        method: "POST",
        body: { prompt, negative, model, generator, tags: tagList, notes, workspace_id }
      });
      toast("Kayıt kasaya eklendi!");
      closeUploadModal();
      loadStats();
      loadGallery();
      loadImageWorkspaces();
    } catch (e) {
      toast("Hata: " + e.message);
    }
  }
};

/* ------------------------------------------------------------- tags */
async function loadTags() {
  const params = new URLSearchParams({ kind: $("#tagKind").value, prefix: $("#tagFilter").value, q: $("#tagQuery").value, limit: 500 });
  const tags = await api("/api/tags?" + params);
  const max = Math.max(1, ...tags.map((t) => t.count));
  $("#tagList").innerHTML = tags.map((t) => `<div class="tagrow" data-tag="${esc(t.name)}" data-kind="${t.kind}">
      <div class="bar" style="width:${(100 * t.count) / max}%"></div><span class="kind ${t.kind}">${t.kind}</span>
      <span>${esc(t.name)}</span><span class="n">${t.count}</span></div>`).join("") || '<div class="muted">Etiket yok</div>';
}
$("#tagList").onclick = (e) => {
  const r = e.target.closest(".tagrow"); if (!r) return;
  const base = $("#tagQuery").value ? $("#tagQuery").value + " " : "";
  const k = r.dataset.kind, n = r.dataset.tag;
  searchFor(base + (k === "generator" ? `gen:${n}` : quoteTag(n)));
};
["#tagKind", "#tagFilter", "#tagQuery"].forEach((s) => $(s).addEventListener("input", debounce(loadTags, 300)));
$("#tagToWildcard").onclick = async () => {
  const name = prompt("Wildcard adı:", $("#tagKind").value || "tags"); if (!name) return;
  const r = await api("/api/wildcards/from-tags", { method: "POST", body: { name, kind: $("#tagKind").value || "prompt", query: $("#tagQuery").value, limit: 50 } });
  toast(`__${r.name}__ oluşturuldu (${r.items.length} satır)`);
};

/* ----------------------------------------------------------- matrix */
function addParamRow(key = "", value = "") {
  const row = document.createElement("div"); row.className = "prow";
  row.innerHTML = `<input placeholder="steps" value="${esc(key)}"><input placeholder="20, 30  veya  {20-40:10}" value="${esc(value)}"><button class="ghost small">✕</button>`;
  row.querySelector("button").onclick = () => { row.remove(); autoPreview(); };
  row.addEventListener("input", autoPreview);
  $("#mParams").appendChild(row);
}
function readSpec() {
  const params = {};
  $$("#mParams .prow").forEach((r) => {
    const [k, v] = $$("input", r).map((i) => i.value.trim());
    if (!k || !v) return;
    params[k] = v.includes("{") ? v : v.split(",").map((s) => s.trim()).filter(Boolean);
  });
  const spec = { prompt: $("#mPrompt").value, negative: $("#mNegative").value, params, mode: $("#mMode").value, limit: +$("#mLimit").value || 10000 };
  if (spec.mode === "random") { spec.count = +$("#mCount").value || 20; if ($("#mSeed").value !== "") spec.seed = +$("#mSeed").value; }
  return spec;
}
function writeSpec(s) {
  $("#mPrompt").value = s.prompt || ""; $("#mNegative").value = s.negative || "";
  $("#mParams").innerHTML = "";
  Object.entries(s.params || {}).forEach(([k, v]) => addParamRow(k, Array.isArray(v) ? v.join(", ") : v));
  $("#mMode").value = s.mode || "product"; $("#mCount").value = s.count || 20; $("#mSeed").value = s.seed ?? "";
  $("#mLimit").value = s.limit || 10000; syncMode(); preview();
}
function syncMode() { $$(".rnd").forEach((e) => (e.style.display = $("#mMode").value === "random" ? "" : "none")); }
async function preview() {
  const mErr = $("#mErr");
  const mTotal = $("#mCountBadge") || $("#mTotal");
  if (mErr) mErr.textContent = "";
  try {
    const r = await api("/api/matrix/preview", { method: "POST", body: { spec: readSpec(), limit: 300 } });
    if (mTotal) mTotal.textContent = r.count.toLocaleString("tr-TR") + ($("#mMode")?.value === "random" ? " olası" : "");
    const mRows = $("#mRows");
    if (mRows) {
      mRows.innerHTML = r.rows.map((row) => {
        const ps = Object.entries(row.params).map(([k, v]) => `<span class="chip axis">${esc(k)}=${esc(v)}</span>`).join("");
        return `<div class="mrow"><span class="i">#${row.index + 1}</span>${esc(row.prompt)}
          ${row.negative ? `<div class="neg">− ${esc(row.negative)}</div>` : ""}${ps ? `<div class="chips">${ps}</div>` : ""}</div>`;
      }).join("") + (r.rows.length < Math.min(r.count, readSpec().limit) ? `<div class="muted small center">…önizlemede ilk ${r.rows.length} satır</div>` : "");
    }
  } catch (e) {
    if (mErr) mErr.textContent = e.message;
    if (mTotal) mTotal.textContent = "–";
  }
}
const autoPreview = debounce(preview, 400);
["#mPrompt", "#mNegative", "#mCount", "#mSeed", "#mLimit"].forEach((s) => $(s)?.addEventListener("input", autoPreview));
$("#mMode")?.addEventListener("change", () => { syncMode(); preview(); });
$("#mAddParam")?.addEventListener("click", () => addParamRow());
$("#mPreview")?.addEventListener("click", preview);
async function exportText() {
  const fmt = $("#mFormat")?.value || "txt";
  return api("/api/matrix/export", { method: "POST", body: { spec: readSpec(), format: fmt } });
}
$("#mExport")?.addEventListener("click", async () => {
  try {
    const fmt = $("#mFormat")?.value || "txt";
    const r = await fetch("/api/matrix/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spec: readSpec(), format: fmt }) });
    if (!r.ok) throw new Error((await r.json()).detail);
    const blob = await r.blob();
    const name = (r.headers.get("content-disposition") || "").match(/filename="(.+)"/)?.[1] || "prompts.txt";
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { toast("Hata: " + e.message); }
});
($("#mCopySample") || $("#mCopy"))?.addEventListener("click", async () => {
  try {
    const t = await exportText();
    copy(typeof t === "string" ? t : JSON.stringify(t, null, 2));
  } catch (e) {
    toast(e.message);
  }
});
$("#mSave")?.addEventListener("click", async () => {
  const mNameEl = $("#mName");
  const name = mNameEl ? mNameEl.value.trim() : prompt("Matris adı:");
  if (!name) return toast("Matris adı girin");
  renderSaved(await api("/api/matrices", { method: "POST", body: { name, spec: readSpec() } }));
  toast("Kaydedildi");
});
let savedMatrices = [];
function renderSaved(list) {
  savedMatrices = list || [];
  const container = $("#mSavedList") || $("#mSaved");
  if (container) {
    container.innerHTML = savedMatrices.map((m, i) => `<span class="chip" data-i="${i}">${esc(m.name)}<span class="x" data-del="${i}">×</span></span>`).join("");
  }
}
const savedContainer = $("#mSavedList") || $("#mSaved");
savedContainer?.addEventListener("click", async (e) => {
  if (e.target.dataset.del !== undefined) {
    const m = savedMatrices[+e.target.dataset.del];
    if (confirm(`"${m.name}" silinsin mi?`)) renderSaved(await api(`/api/matrices/${encodeURIComponent(m.name)}`, { method: "DELETE" }));
    return;
  }
  const c = e.target.closest(".chip"); if (!c) return;
  const m = savedMatrices[+c.dataset.i];
  const mNameEl = $("#mName");
  if (mNameEl) mNameEl.value = m.name;
  writeSpec(m.spec);
});
async function loadMatrices() { renderSaved(await api("/api/matrices")); }
function sendToMatrix(d) {
  const p = d.params || {}; const params = {};
  ["steps", "cfg_scale", "sampler", "seed", "width", "height"].forEach((k) => { if (p[k] !== undefined) params[k] = [String(p[k])]; });
  showTab("matrix");
  writeSpec({ prompt: d.prompt, negative: d.negative, params, mode: "product" });
  toast("Prompt matrise aktarıldı – değişecek kısımları {a|b} ile işaretleyin");
}

/* -------------------------------------------------------- workspaces */
let imageWorkspaces = [];

async function loadImageWorkspaces() {
  try {
    const list = await api("/api/workspaces");
    imageWorkspaces = list || [];
    populateImageWorkspaceDropdowns();
    renderImageWorkspacesGrid();
  } catch (e) {
    console.warn("loadImageWorkspaces error:", e);
  }
}
window.loadImageWorkspaces = loadImageWorkspaces;

function populateImageWorkspaceDropdowns() {
  const currentWs = G.workspaceId;
  const allWord = window.t ? window.t("all_workspaces") : "🏢 Tüm Projeler / Workspaces";

  // Gallery filter dropdown
  const filterSel = $("#imgWsFilter");
  if (filterSel) {
    filterSel.innerHTML = `<option value="">${allWord}</option>` +
      imageWorkspaces.map(w => `<option value="${w.id}">${esc(w.icon || '📁')} ${esc(w.name)} (${w.image_count || 0})</option>`).join("");
    if (currentWs) filterSel.value = String(currentWs);
  }

  // Bulk bar move dropdown
  const bulkSel = $("#bulkWorkspaceSelect");
  if (bulkSel) {
    bulkSel.innerHTML = `<option value="">${window.currentLang === "en" ? "Select Target Workspace..." : "Hedef Proje Seçin..."}</option>` +
      imageWorkspaces.map(w => `<option value="${w.id}">${esc(w.icon || '📁')} ${esc(w.name)}</option>`).join("");
  }

  // Upload modal dropdown
  const uSel = $("#uWorkspace");
  if (uSel) {
    uSel.innerHTML = imageWorkspaces.map(w => `<option value="${w.id}">${esc(w.icon || '📁')} ${esc(w.name)}</option>`).join("");
    const genel = imageWorkspaces.find(w => w.name === "Genel");
    if (genel) uSel.value = String(genel.id);
  }

  // Quick import image dropdown
  const qiSel = $("#qiImageWorkspace");
  if (qiSel) {
    qiSel.innerHTML = imageWorkspaces.map(w => `<option value="${w.id}">${esc(w.icon || '📁')} ${esc(w.name)}</option>`).join("");
    const genel = imageWorkspaces.find(w => w.name === "Genel");
    if (genel) qiSel.value = String(genel.id);
  }
}

function renderImageWorkspacesGrid() {
  const grid = $("#imageWorkspacesGrid");
  if (!grid) return;
  grid.innerHTML = "";
  const imgWord = window.t ? window.t("ws_images_count") : "görsel";
  const filterBtnWord = window.t ? window.t("ws_filter_btn") : "Görselleri Filtrele";
  const editWord = window.t ? window.t("ws_edit") : "Düzenle";
  const delWord = window.t ? window.t("ws_delete") : "Sil";

  imageWorkspaces.forEach(w => {
    const card = document.createElement("div");
    card.className = "workspace-card";
    card.style.borderColor = w.color || "var(--line)";

    const isGenel = w.name === "Genel";
    card.innerHTML = `
      <div class="ws-header">
        <span class="ws-icon" style="background:${w.color || '#8b5cf6'}22; color:${w.color || '#8b5cf6'}">${esc(w.icon || '🎨')}</span>
        <div class="ws-info">
          <h3 class="ws-name">${esc(w.name)}</h3>
          <p class="ws-desc muted small">${esc(w.description || (window.currentLang === "en" ? "No description" : "Açıklama yok"))}</p>
        </div>
        <span class="ws-badge" style="background:${w.color || '#8b5cf6'}22; color:${w.color || '#8b5cf6'}; border:1px solid ${w.color || '#8b5cf6'}66;">
          🎨 ${w.image_count || 0} ${imgWord}
        </span>
      </div>
      <div class="ws-actions">
        <button class="btn-ws-filter ghost small" data-id="${w.id}">🔍 ${filterBtnWord}</button>
        <div style="flex:1"></div>
        <button class="btn-ws-edit ghost small" data-id="${w.id}">✏ ${editWord}</button>
        ${isGenel ? '' : `<button class="btn-ws-del ghost small danger" data-id="${w.id}">🗑 ${delWord}</button>`}
      </div>
    `;

    card.querySelector(".btn-ws-filter")?.addEventListener("click", () => {
      G.workspaceId = w.id;
      const sel = $("#imgWsFilter");
      if (sel) sel.value = String(w.id);
      showTab("gallery");
      loadGallery();
    });

    card.querySelector(".btn-ws-edit")?.addEventListener("click", () => {
      openImageWorkspaceModal(w);
    });

    card.querySelector(".btn-ws-del")?.addEventListener("click", async () => {
      const confirmMsg = window.currentLang === "en"
        ? `Are you sure you want to delete "${w.name}" workspace? (Images inside will be moved to Genel)`
        : `"${w.name}" çalışma alanını silmek istiyor musunuz? (İçindeki görseller Genel alanına geçer)`;
      if (!confirm(confirmMsg)) return;
      try {
        await api(`/api/workspaces/${w.id}`, { method: "DELETE" });
        toast(window.currentLang === "en" ? "Workspace deleted" : "Görsel çalışma alanı silindi");
        loadImageWorkspaces();
        if (G.workspaceId === w.id) {
          G.workspaceId = null;
          loadGallery();
        }
      } catch (e) {
        toast("Silinemedi: " + e.message, true);
      }
    });

    grid.appendChild(card);
  });
}

function openImageWorkspaceModal(ws = null) {
  const modal = $("#imageWorkspaceModal");
  if (!modal) return;
  if ($("#iwModalId")) $("#iwModalId").value = ws ? ws.id : "";
  if ($("#iwModalTitle")) $("#iwModalTitle").textContent = ws
    ? (window.currentLang === "en" ? "✏ Edit Image Workspace" : "✏ Görsel Alanını Düzenle")
    : (window.currentLang === "en" ? "➕ New Image Workspace" : "➕ Yeni Görsel Çalışma Alanı");
  if ($("#iwName")) $("#iwName").value = ws ? ws.name : "";
  if ($("#iwDesc")) $("#iwDesc").value = ws ? ws.description : "";
  if ($("#iwColor")) $("#iwColor").value = ws ? ws.color : "#8b5cf6";
  if ($("#iwIcon")) $("#iwIcon").value = ws ? ws.icon : "🎨";
  modal.classList.remove("hidden");
}
window.openImageWorkspaceModal = openImageWorkspaceModal;

$("#btnNewImageWs")?.addEventListener("click", () => {
  openImageWorkspaceModal();
});

$("#iwClose")?.addEventListener("click", () => {
  $("#imageWorkspaceModal")?.classList.add("hidden");
});

$("#iwCancel")?.addEventListener("click", () => {
  $("#imageWorkspaceModal")?.classList.add("hidden");
});

$("#iwSubmit")?.addEventListener("click", async () => {
  const id = $("#iwModalId")?.value;
  const name = $("#iwName")?.value.trim();
  const description = $("#iwDesc")?.value.trim();
  const color = $("#iwColor")?.value.trim() || "#8b5cf6";
  const icon = $("#iwIcon")?.value.trim() || "🎨";

  if (!name) {
    toast(window.currentLang === "en" ? "Workspace name cannot be empty" : "Çalışma alanı adı boş olamaz", true);
    return;
  }

  const payload = { name, description, color, icon };
  try {
    if (id) {
      await api(`/api/workspaces/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      toast(window.currentLang === "en" ? "Workspace updated" : "Görsel çalışma alanı güncellendi");
    } else {
      await api("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      toast(window.currentLang === "en" ? "New workspace created" : "Yeni görsel çalışma alanı oluşturuldu");
    }
    $("#imageWorkspaceModal")?.classList.add("hidden");
    loadImageWorkspaces();
  } catch (e) {
    toast("Kaydedilemedi: " + e.message, true);
  }
});

/* -------------------------------------------------------- wildcards */
let wildcards = {};
async function loadWildcards(select) {
  wildcards = await api("/api/wildcards");
  const names = Object.keys(wildcards).sort();
  $("#wList").innerHTML = names.map((n) => `<div class="wi ${n === select ? "active" : ""}" data-n="${esc(n)}"><span>__${esc(n)}__</span><span class="n">${wildcards[n].length}</span></div>`).join("")
    || '<div class="muted small">Henüz wildcard yok</div>';
}
$("#wList").onclick = (e) => {
  const w = e.target.closest(".wi"); if (!w) return;
  $$("#wList .wi").forEach((x) => x.classList.toggle("active", x === w));
  $("#wName").value = w.dataset.n; $("#wItems").value = wildcards[w.dataset.n].join("\n");
};
$("#wNew").onclick = () => { $("#wName").value = ""; $("#wItems").value = ""; $("#wName").focus(); };
$("#wSave").onclick = async () => {
  const name = $("#wName").value.trim().replace(/^__|__$/g, ""); if (!name) return toast("Ad girin");
  await api(`/api/wildcards/${encodeURIComponent(name)}`, { method: "PUT", body: { items: $("#wItems").value.split("\n") } });
  loadWildcards(name); toast(`__${name}__ kaydedildi`);
};
$("#wDelete").onclick = async () => {
  const name = $("#wName").value.trim(); if (!name || !confirm(`__${name}__ silinsin mi?`)) return;
  await api(`/api/wildcards/${encodeURIComponent(name)}`, { method: "DELETE" });
  $("#wName").value = ""; $("#wItems").value = ""; loadWildcards();
};

/* ------------------------------------------------------------- scan */
let scanTimer;

const btnBrowse = $("#scanBrowse") || $("#btnBrowseFolder");
if (btnBrowse) {
  btnBrowse.onclick = async () => {
    try {
      const res = await api("/api/dialog/pick-folder", { method: "POST" });
      if (res && res.path) {
        const scanPath = $("#scanPath");
        if (scanPath) scanPath.value = res.path;
        localStorage.setItem("pv.scanPath", res.path);
        toast(`Klasör seçildi: ${res.path}`);
      }
    } catch (e) {
      toast("Klasör seçici hatası: " + e.message);
    }
  };
}

async function pollScan() {
  const s = await api("/api/scan");
  const st = s.stats;
  const scanStatusEl = $("#scanStatus") || $("#scanInfo");
  if (st) {
    const scanBar = $("#scanBar");
    if (scanBar) scanBar.style.width = (st.total ? (100 * st.done) / st.total : 100) + "%";
    if (scanStatusEl) scanStatusEl.textContent = `${st.done}/${st.total} · ${st.added} yeni · ${st.updated} güncellendi · ${st.moved || 0} taşındı · ${st.skipped} değişmedi · ${st.error} hata`;
  }
  if (s.error && scanStatusEl) scanStatusEl.textContent = "Hata: " + s.error;
  if (s.running) scanTimer = setTimeout(pollScan, 500);
  else {
    const startBtn = $("#scanStart");
    if (startBtn) startBtn.disabled = false;
    loadStats();
    loadLibStats();
    loadGallery();
  }
}
const scanStartBtn = $("#scanStart");
if (scanStartBtn) {
  scanStartBtn.onclick = async () => {
    const scanPath = $("#scanPath");
    const path = scanPath ? scanPath.value.trim() : "";
    if (!path) return toast("Yol girin");
    localStorage.setItem("pv.scanPath", path);
    try {
      await api("/api/scan", {
        method: "POST",
        body: {
          path,
          recursive: $("#scanRec") ? $("#scanRec").checked : true,
          force: $("#scanForce") ? $("#scanForce").checked : false
        }
      });
      scanStartBtn.disabled = true;
      pollScan();
    } catch (e) {
      toast(e.message);
    }
  };
}

$("#prune")?.addEventListener("click", async () => {
  try {
    const r = await api("/api/prune", { method: "POST" });
    toast(`Kasa doğrulandı (${r.removed} geçersiz kayıt temizlendi)`);
    loadStats();
    loadLibStats();
  } catch (e) {
    toast("Hata: " + e.message);
  }
});

async function loadLibStats() {
  try {
    const s = await loadStats();
    const list = (o) => Object.entries(o || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join("");
    const libStatsEl = $("#libStats");
    if (libStatsEl) {
      libStatsEl.innerHTML = `<table class="params">
        <tr><td>Kayıtlı Görsel</td><td>${s.images} (${s.with_prompt} promptlu)</td></tr>
        <tr><td>Kasa Deposu</td><td><code>${esc(s.vault_dir || "~/.promptvault/vault")}</code></td></tr>
        <tr><td>Veritabanı</td><td>${esc(s.db_path)} ${s.fts ? "· FTS5 ✓" : ""}</td></tr></table>
        <h4 class="muted">Üreticiler</h4><table class="params">${list(s.generators)}</table>
        <h4 class="muted">En çok kullanılan modeller</h4><table class="params">${list(s.models)}</table>`;
    }
  } catch {}
}

/* ------------------------------------------------------------- init */
if ($("#q")) $("#q").value = "";
const scanPathEl = $("#scanPath");
if (scanPathEl) scanPathEl.value = localStorage.getItem("pv.scanPath") || "";
syncMode();
addParamRow("steps", "");

async function initPromptVault() {
  if ($("#q")) $("#q").value = "";
  Promise.allSettled([
    loadGallery(false, 8),
    loadImageWorkspaces(),
    loadStats(),
    loadGDriveStatus(),
    loadQuickImportStatus()
  ]);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPromptVault);
} else {
  initPromptVault();
}

// Güvenlik yedekleri: load, pageshow, focus ve visibilitychange tetikleyicileri
window.addEventListener("load", () => {
  if (G.items.length === 0) loadGallery(false, 5);
});
window.addEventListener("pageshow", () => {
  if (G.items.length === 0) loadGallery(false, 5);
});
window.addEventListener("focus", () => {
  if (G.items.length === 0) loadGallery(false, 3);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && G.items.length === 0) loadGallery(false, 3);
});
api("/api/scan").then((s) => {
  if (s && s.running) {
    const sb = $("#scanStart");
    if (sb) sb.disabled = true;
    pollScan();
  }
}).catch(() => {});

/* ------------------------------------------------------------- google drive */
let gdPollTimer = null;
let gdAuthPollTimer = null;

async function loadGDriveStatus() {
  try {
    const s = await api("/api/gdrive/status");
    const badge = $("#gdStatusBadge");
    const userEl = $("#gdUserEmail");
    const syncRow = $("#gdSyncRow");
    const setup = $("#gdSetup");
    const link = $("#gdFolderLink");

    if (s.authenticated) {
      badge.textContent = "✓ Google Drive Bağlı";
      badge.className = "vault-badge";
      userEl.textContent = s.user ? `${s.user.name} (${s.user.email})` : "";
      syncRow.classList.remove("hidden");
      setup.classList.add("hidden");
      if (s.folder && s.folder.url) {
        link.href = s.folder.url;
        link.classList.remove("hidden");
      } else {
        link.classList.add("hidden");
      }

      if (s.sync && s.sync.running) {
        pollGDriveSync();
      }
    } else {
      syncRow.classList.add("hidden");
      setup.classList.remove("hidden");
      userEl.textContent = "";
      if (s.configured) {
        badge.textContent = "Giriş Yapılmadı";
        badge.className = "kind user";
      } else {
        badge.textContent = "⚙ Yapılandırma Gerekli";
        badge.className = "kind";
      }

      if (s.error) {
        let errMsg = esc(s.error);
        if (s.error.includes("Google Drive API has not been used") || s.error.includes("disabled") || s.error.includes("accessNotConfigured")) {
          errMsg = `⚠️ <b>Google Drive API Henüz Etkinleştirilmemiş:</b><br>
            Google Cloud projenizde Drive API servisi kapalı olduğu için klasör oluşturulamadı.<br>
            👉 <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" style="color:var(--accent2); font-weight:bold; text-decoration:underline">Google Drive API'yi Etkinleştirmek İçin Tıklayın</a> (Açılan sayfada mavi <b>ETKİNLEŞTİR / ENABLE</b> butonuna basın, ardından buraya dönün).`;
        }
        $("#gdInfo").innerHTML = `<div style="background:#ff5c7a1a; border:1px solid var(--danger); padding:10px; border-radius:8px; margin-top:10px; line-height:1.6">${errMsg}</div>`;
      } else {
        $("#gdInfo").innerHTML = "";
      }
    }
    return s;
  } catch (e) {
    console.error("GDrive status error", e);
  }
}

$("#btnGdSaveConfig")?.addEventListener("click", async () => {
  const client_id = $("#gdClientId")?.value.trim() || "";
  const client_secret = $("#gdClientSecret")?.value.trim() || "";
  if (!client_id || !client_secret) return toast("Client ID ve Secret girin");
  await api("/api/gdrive/config", { method: "POST", body: { client_id, client_secret } });
  toast("Google Drive API kimlik bilgileri kaydedildi");
  loadGDriveStatus();
});

$("#btnGdLogin")?.addEventListener("click", async () => {
  try {
    const res = await api("/api/gdrive/login", { method: "POST" });
    toast(res.message || "Tarayıcıda Google giriş penceresi açıldı...");
    clearInterval(gdAuthPollTimer);
    gdAuthPollTimer = setInterval(async () => {
      const s = await loadGDriveStatus();
      if (s && s.authenticated) {
        clearInterval(gdAuthPollTimer);
        toast("Google Drive bağlantısı başarılı!");
      }
    }, 2000);
  } catch (e) {
    toast("Hata: " + e.message);
  }
});

$("#btnGdLogout")?.addEventListener("click", async () => {
  if (confirm("Google Drive oturumunu kapatmak istiyor musunuz?")) {
    await api("/api/gdrive/logout", { method: "POST" });
    toast("Oturum kapatıldı");
    loadGDriveStatus();
  }
});

async function startGDriveSync() {
  const s = await loadGDriveStatus();
  if (!s || !s.authenticated) {
    showTab("scan");
    toast("Lütfen önce Google Drive oturumu açın");
    return;
  }
  try {
    await api("/api/gdrive/sync", { method: "POST" });
    pollGDriveSync();
  } catch (e) {
    toast("Hata: " + e.message);
  }
}

async function pollGDriveSync() {
  clearTimeout(gdPollTimer);
  const s = await api("/api/gdrive/status");
  const p = s.sync || {};
  const bar = $("#gdBar");
  const progBox = $("#gdProgress");
  const info = $("#gdInfo");

  if (p.running) {
    progBox.classList.remove("hidden");
    const pct = p.total ? Math.round((p.done * 100) / p.total) : 50;
    bar.style.width = pct + "%";
    info.textContent = `Yükleniyor: ${p.done} / ${p.total} görsel tamamlandı...`;
    gdPollTimer = setTimeout(pollGDriveSync, 1200);
  } else {
    if (p.result) {
      progBox.classList.remove("hidden");
      bar.style.width = "100%";
      info.textContent = `✓ Eşitleme tamamlandı: ${p.result.uploaded} yeni görsel "Prompt Vault" klasörüne yüklendi!`;
      toast(`Google Drive: ${p.result.uploaded} yeni görsel yüklendi`);
    } else if (p.error) {
      info.textContent = "Hata: " + p.error;
    }
  }
}

$("#btnGdSync")?.addEventListener("click", startGDriveSync);
$("#btnQuickGdSync")?.addEventListener("click", startGDriveSync);

// Load GDrive status on init and tab switch
loadGDriveStatus();

/* ------------------------------------------------------------- quick import */
async function loadQuickImportStatus() {
  try {
    const s = await api("/api/quick-import/status");
    const badge = $("#qiStatusBadge");
    const btn = $("#btnToggleQuickImport");
    if (!badge || !btn) return;
    if (s.enabled) {
      badge.textContent = "Aktif (Açık)";
      badge.style.background = "#10b98122";
      badge.style.color = "#34d399";
      badge.style.borderColor = "#10b98155";
      btn.textContent = "Durdur / Kapat";
    } else {
      badge.textContent = "Devre Dışı (Kapalı)";
      badge.style.background = "#ef444422";
      badge.style.color = "#f87171";
      badge.style.borderColor = "#ef444455";
      btn.textContent = "Etkinleştir / Aç";
    }
  } catch {}
}

$("#btnToggleQuickImport")?.addEventListener("click", async () => {
  try {
    const cur = await api("/api/quick-import/status");
    const res = await api("/api/quick-import/toggle", {
      method: "POST",
      body: { enabled: !cur.enabled }
    });
    toast(res.enabled ? "⚡ Tarayıcıdan Hızlı Aktarım (Quick Import) açıldı!" : "Hızlı Aktarım kapatıldı.");
    loadQuickImportStatus();
  } catch (e) {
    toast("Hata: " + e.message);
  }
});

loadQuickImportStatus();

/* ----------------------------------------------------------- gdrive restore */
let gdRestorePollTimer = null;
async function startGDriveRestore() {
  const s = await loadGDriveStatus();
  if (!s || !s.authenticated) {
    toast("Lütfen önce Google Drive oturumu açın");
    return;
  }
  const download_images = $("#chkGdDownloadImgs") ? $("#chkGdDownloadImgs").checked : true;
  try {
    await api("/api/gdrive/restore", {
      method: "POST",
      body: { download_images }
    });
    $("#gdRestoreBox")?.classList.remove("hidden");
    const statusEl = $("#gdRestoreStatus");
    if (statusEl) statusEl.textContent = "Google Drive'dan 'PromptVault_Backup.json' aranıyor ve indiriliyor...";
    pollGDriveRestore();
  } catch (e) {
    toast("Hata: " + e.message);
  }
}

async function pollGDriveRestore() {
  clearTimeout(gdRestorePollTimer);
  try {
    const p = await api("/api/gdrive/restore-status");
    const bar = $("#gdRestoreBar");
    const statusEl = $("#gdRestoreStatus");
    if (!bar || !statusEl) return;

    if (p.running) {
      const pct = p.total ? Math.round((p.done * 100) / p.total) : 50;
      bar.style.width = pct + "%";
      statusEl.textContent = `Geri yükleniyor: ${p.done} / ${p.total} kayıt işlendi...`;
      gdRestorePollTimer = setTimeout(pollGDriveRestore, 1200);
    } else {
      if (p.result) {
        bar.style.width = "100%";
        const r = p.result;
        statusEl.innerHTML = `✓ <b>Geri yükleme tamamlandı!</b> Toplam: ${r.total} kayıt | Yeni: ${r.restored} | Güncellenen: ${r.updated} | İndirilen Görsel: ${r.images_downloaded}`;
        toast(`✓ ${r.restored} kayıt geri yüklendi!`);
        loadLibStats();
        loadStats();
        loadGallery(false);
      } else if (p.error) {
        statusEl.textContent = "Hata: " + p.error;
        toast("Geri yükleme hatası: " + p.error);
      }
    }
  } catch (e) {
    console.error("pollGDriveRestore error", e);
  }
}

$("#btnGdRestore")?.addEventListener("click", startGDriveRestore);

// Local JSON restore
$("#btnLocalRestore")?.addEventListener("click", () => {
  $("#localRestoreFileInput")?.click();
});

$("#localRestoreFileInput")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const statusEl = $("#localRestoreStatus");
  if (statusEl) statusEl.textContent = `"${file.name}" okunuyor ve kasaya aktarılıyor...`;

  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/gdrive/restore-local-json", {
      method: "POST",
      body: fd
    });
    if (!res.ok) {
      let err = "Dosya yüklenemedi";
      try { const j = await res.json(); if (j.detail) err = j.detail; } catch {}
      throw new Error(err);
    }
    const data = await res.json();
    const r = data.result || {};
    if (statusEl) {
      statusEl.innerHTML = `✓ <b>Başarılı!</b> Toplam: ${r.total} | Yeni: ${r.restored} | Güncellenen: ${r.updated}`;
    }
    toast(`✓ ${r.restored} görsel/prompt kaydı geri yüklendi!`);
    loadLibStats();
    loadStats();
    loadGallery(false);
  } catch (err) {
    if (statusEl) statusEl.textContent = "Hata: " + err.message;
    toast("Hata: " + err.message);
  } finally {
    e.target.value = "";
  }
});

/* --------------------------------------------------------- language toggle */
$("#btnLangTR")?.addEventListener("click", () => window.setLanguage && window.setLanguage("tr"));
$("#btnLangEN")?.addEventListener("click", () => window.setLanguage && window.setLanguage("en"));
$("#btnSetLangTR")?.addEventListener("click", () => window.setLanguage && window.setLanguage("tr"));
$("#btnSetLangEN")?.addEventListener("click", () => window.setLanguage && window.setLanguage("en"));

// Apply internationalization on load
if (window.applyI18n) {
  window.applyI18n();
}

window.onLanguageChange = (lang) => {
  loadStats();
  if (G.total !== undefined) {
    const resWord = window.t ? window.t("results_count") : "sonuç";
    $("#resultInfo").textContent = `${G.total} ${resWord}`;
    updateBulk();
  }
  if (G.items.length > 0) {
    renderGrid(G.items, false);
  }
  if (G.current !== -1 && !$("#modal")?.classList.contains("hidden")) {
    renderDetail(G.items[G.current]);
  }
  if (typeof window.renderMusicStats === "function") {
    window.renderMusicStats();
  }
  if (typeof window.loadSongs === "function") {
    window.loadSongs();
  }
  renderImageWorkspacesGrid();
};

/* -------------------------------------------------------- quick import modal */
function openQuickImportModal() {
  $("#quickImportModal")?.classList.remove("hidden");
}
function closeQuickImportModal() {
  $("#quickImportModal")?.classList.add("hidden");
}
$("#btnQuickImportModal")?.addEventListener("click", openQuickImportModal);
$("#qiClose")?.addEventListener("click", closeQuickImportModal);
$("#qiMusicCancel")?.addEventListener("click", closeQuickImportModal);
$("#qiImageCancel")?.addEventListener("click", closeQuickImportModal);

// Modal tabs
$("#qiTabMusic")?.addEventListener("click", () => {
  $("#qiTabMusic").classList.add("active");
  $("#qiTabImage").classList.remove("active");
  $("#qiTabExt").classList.remove("active");
  $("#qiPanelMusic").classList.remove("hidden");
  $("#qiPanelImage").classList.add("hidden");
  $("#qiPanelExt").classList.add("hidden");
});
$("#qiTabImage")?.addEventListener("click", () => {
  $("#qiTabImage").classList.add("active");
  $("#qiTabMusic").classList.remove("active");
  $("#qiTabExt").classList.remove("active");
  $("#qiPanelImage").classList.remove("hidden");
  $("#qiPanelMusic").classList.add("hidden");
  $("#qiPanelExt").classList.add("hidden");
});
$("#qiTabExt")?.addEventListener("click", () => {
  $("#qiTabExt").classList.add("active");
  $("#qiTabMusic").classList.remove("active");
  $("#qiTabImage").classList.remove("active");
  $("#qiPanelExt").classList.remove("hidden");
  $("#qiPanelMusic").classList.add("hidden");
  $("#qiPanelImage").classList.add("hidden");
});

// Submit music
$("#qiMusicSubmit")?.addEventListener("click", async () => {
  const url = $("#qiMusicUrl").value.trim();
  const title = $("#qiMusicTitle").value.trim();
  const artist = $("#qiMusicArtist").value.trim();
  const style = $("#qiMusicStyle").value.trim();
  const lyrics = $("#qiMusicLyrics").value.trim();
  const wsVal = $("#qiMusicWorkspace")?.value;
  const workspace_id = wsVal ? parseInt(wsVal, 10) : undefined;

  if (!url && !title && !style && !lyrics) {
    return toast("Lütfen bir şarkı linki, başlık veya söz/stil girin!");
  }

  const btn = $("#qiMusicSubmit");
  btn.textContent = "⏳ Kaydediliyor...";
  btn.disabled = true;

  try {
    const payload = {
      suno_url: url,
      title: title || (url ? "Suno Şarkısı" : "İsimsiz Şarkı"),
      style,
      lyrics,
      artist,
      generator: "suno"
    };
    if (workspace_id) payload.workspace_id = workspace_id;

    const res = await api("/api/quick-import/music", {
      method: "POST",
      body: payload
    });
    toast(`✓ "${res.title || title}" şarkısı kasaya aktarıldı! 🎵`);
    closeQuickImportModal();
    $("#qiMusicUrl").value = "";
    $("#qiMusicTitle").value = "";
    $("#qiMusicArtist").value = "";
    $("#qiMusicStyle").value = "";
    $("#qiMusicLyrics").value = "";
    if (window.loadSongs) window.loadSongs();
    loadImageWorkspaces();
  } catch (e) {
    toast("Hata: " + e.message);
  } finally {
    btn.textContent = "⚡ Şarkıyı Kasaya Aktar";
    btn.disabled = false;
  }
});

// Submit image
$("#qiImageSubmit")?.addEventListener("click", async () => {
  const prompt = $("#qiImagePrompt").value.trim();
  const image_url = $("#qiImageUrl").value.trim();
  const generator = $("#qiImageGen").value;
  const model = $("#qiImageModel").value.trim();
  const wsVal = $("#qiImageWorkspace")?.value;
  const workspace_id = wsVal ? parseInt(wsVal, 10) : undefined;

  if (!prompt && !image_url) {
    return toast("Lütfen en azından bir prompt veya görsel linki girin!");
  }

  const btn = $("#qiImageSubmit");
  btn.textContent = "⏳ Kaydediliyor...";
  btn.disabled = true;

  try {
    const payload = {
      prompt: prompt || `${generator} generated image`,
      generator,
      model: model || generator
    };
    if (workspace_id) payload.workspace_id = workspace_id;
    if (image_url.startsWith("data:image")) {
      payload.image_b64 = image_url;
    } else if (image_url) {
      payload.image_url = image_url;
    }
    await api("/api/quick-import/image", {
      method: "POST",
      body: payload
    });
    toast(`✓ Görsel ve prompt kasaya eklendi! 🎨`);
    closeQuickImportModal();
    $("#qiImagePrompt").value = "";
    $("#qiImageUrl").value = "";
    $("#qiImageModel").value = "";
    loadGallery(false);
    loadStats();
    loadImageWorkspaces();
  } catch (e) {
    toast("Hata: " + e.message);
  } finally {
    btn.textContent = "⚡ Görseli Kasaya Aktar";
    btn.disabled = false;
  }
});

/* --------------------------------------------------- copy clipper script */
async function copyClipperScript() {
  try {
    const res = await fetch("/static/promptvault_clipper.user.js?v=" + Date.now());
    if (!res.ok) throw new Error("Userscript dosyası yüklenemedi");
    const scriptCode = await res.text();
    await navigator.clipboard.writeText(scriptCode);
    toast("✓ Tampermonkey Clipper scripti panoya kopyalandı! Tampermonkey'e yapıştırabilirsiniz. 📋");
  } catch (e) {
    toast("Script kopyalama hatası: " + e.message, true);
  }
}
$("#btnCopyClipperScript")?.addEventListener("click", copyClipperScript);
$("#btnCopyClipperScriptModal")?.addEventListener("click", copyClipperScript);

