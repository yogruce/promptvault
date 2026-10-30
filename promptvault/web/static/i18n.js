// PromptVault Internationalization (TR / EN)
const TRANSLATIONS = {
  tr: {
    // Header & Domain
    brand_sub: "AI Prompt, Metadata & Suno AI Yöneticisi",
    domain_images: "Görseller",
    domain_music: "Müzik (Suno AI)",
    btn_settings: "Ayarlar",
    btn_settings_title: "Sistem ve Entegrasyon Ayarları",
    btn_quick_import: "Tek Tuşla Aktar",
    btn_quick_import_title: "Tek Tuşla Aktar (Quick Import)",
    qi_modal_title: "Tek Tuşla Kasaya Aktar (Quick Import)",
    qi_modal_desc: "Suno AI şarkılarını veya Gemini/ChatGPT görsellerini tek tuşla anında yerel kasaya kaydedin.",

    // Image Tabs
    tab_gallery: "Galeri",
    tab_tags: "Etiketler",
    tab_matrix: "Prompt Matrisi",
    tab_wildcards: "Wildcard",
    tab_scan: "Klasör Tara",

    // Music Tabs
    tab_music_songs: "🎵 Şarkılar",
    tab_music_workspaces: "🏢 Workspaces & Sanatçılar",
    tab_music_styles: "🏷️ Müzik Stilleri",
    tab_music_scan: "📂 Müzik Tara & Ekle",

    // Header & Dynamic Stats
    stat_images: "görsel",
    stat_tags: "etiket",
    stat_favorites: "favori",
    results_count: "sonuç",
    music_stats_songs: "Şarkı",
    music_stats_workspaces: "Workspace",
    music_stats_favorites: "Favori",
    music_stats_audio: "Sesli",

    // Gallery Toolbar
    search_images_ph: 'Ara: kedi "red hair" -blurry tag:portrait lora:detail gen:comfyui is:fav rating:>=3',
    sort_added: "En yeni",
    sort_oldest: "En eski",
    sort_mtime: "Dosya tarihi",
    sort_rating: "Puan",
    sort_path: "Yol",
    sort_title: "Şarkı Adı",
    sort_artist: "Sanatçı",
    btn_upload: "⬆ Görsel Ekle",
    btn_drive_sync: "☁ Drive'a Yedekle",
    btn_select_mode: "☐ Çoklu Seçim",
    selection_active: "Seçim Açık",
    bulk_selected: "seçili",
    bulk_all: "Tümünü seç",
    bulk_clear: "Seçimi temizle",
    bulk_delete: "🗑 Seçilenleri Sil",
    bulk_tags_ph: "Toplu etiketler (virgülle)",
    bulk_apply: "Etiketle",
    btn_more: "Daha fazla yükle",
    empty_gallery: "Henüz görsel yok.",
    or: "veya",

    // Image Detail Modal
    detail_prompt: "Prompt",
    detail_edit: "✏ Düzenle",
    detail_cancel: "İptal",
    detail_copy: "Kopyala",
    detail_to_matrix: "Matrise aktar",
    detail_generator: "Üretici Araç:",
    detail_neg_prompt: "Negatif Prompt",
    detail_save_prompt: "💾 Değişiklikleri Kaydet",
    detail_none: "yok",
    detail_params: "Parametreler",
    detail_copy_a1111: "A1111 biçiminde kopyala",
    detail_tags: "Etiketler",
    detail_tags_hint: "(tıkla = ara)",
    detail_add_tag_ph: "kullanıcı etiketi ekle (virgülle)",
    detail_add_tag_btn: "Ekle",
    detail_notes: "Notlar",
    detail_notes_ph: "Bu görsel hakkında not...",
    detail_raw_meta: "Ham metadata",
    detail_safe_vault: "🔒 Kasada Güvende",
    detail_safe_source_deleted: "🔒 Kasada Korunuyor (Kaynak Silinmiş)",
    detail_on_disk: "Diskte",
    detail_fav_on: "★ Favori",
    detail_fav_off: "☆ Favori",
    detail_delete_vault: "🗑 Kasadan Sil",

    // Upload & Manual Modal
    upload_title: "⬆ Görsel Ekle / Manuel Prompt Girişi",
    upload_desc: "PNG görselinizi sürükleyip bırakabilir veya seçebilirsiniz. Metadata varsa otomatik okunur.",
    upload_drop_prompt: "📁 Görsel seçmek için tıklayın veya buraya sürükleyin",
    upload_generator_label: "Üretici Araç",
    upload_model_label: "Model Adı",
    upload_tags_label: "Kullanıcı Etiketleri (virgülle)",
    upload_notes_label: "Notlar",
    upload_cancel: "İptal",
    upload_submit: "🔒 Kasaya Kaydet",

    // Tags Tab
    tag_kind_all: "Tüm türler",
    tag_filter_ph: "Etiket filtrele",
    tag_query_ph: "Sadece şu aramanın görsellerinde (ör. gen:comfyui)",
    tag_to_wildcard: "→ Wildcard",

    // Matrix Tab
    matrix_prompt_label: "Prompt şablonu",
    matrix_neg_label: "Negatif şablon",
    matrix_params_label: "Parametre eksenleri",
    matrix_add_param: "+ Parametre",
    matrix_mode_label: "Mod",
    matrix_mode_product: "Tüm kombinasyonlar",
    matrix_mode_random: "Rastgele örnek",
    matrix_count_label: "Adet",
    matrix_seed_label: "Seed",
    matrix_limit_label: "Limit",
    matrix_preview: "Önizle",
    matrix_export: "Dışa Aktar",
    matrix_save: "Kaydet",
    matrix_preview_title: "Önizleme",
    matrix_copy_sample: "İlk promptu kopyala",

    // Wildcards Tab
    wildcard_lists: "Wildcard Listeleri",
    wildcard_new: "+ Yeni",
    wildcard_save: "Kaydet",
    wildcard_delete: "Sil",
    wildcard_hint: "Satır başına bir öğe (boş satırlar yok sayılır)",

    // Folder Scan Tab
    scan_title: "Klasör Tara ve Kasaya Aktar",
    scan_desc: "Seçtiğiniz klasördeki tüm PNG/JPEG görseller taranır, içlerindeki prompt ve parametreler ayrıştırılarak yerel kasaya kopyalanır. Orijinal dosyaları silseniz bile kasadakiler güvende kalır.",
    scan_browse_btn: "📁 Gözat / Klasör Seç",
    scan_recursive: "Alt klasörleri de tara",
    scan_force: "Zaten taranmış dosyaları zorla yeniden oku",
    scan_start: "Taramayı Başlat",

    // Settings Tab
    settings_title: "⚙️ Sistem ve Entegrasyon Ayarları",
    settings_desc: "Arayüz dili, tek tuşla aktarım (clipper), Google Drive yedekleme ve geri yükleme (restore) ayarlarını buradan yönetebilirsiniz.",
    
    // Language Box
    lang_box_title: "🌐 Dil Tercihi / Interface Language",
    lang_box_desc: "Kullanmak istediğiniz arayüz dilini seçin. Değişiklikler anında uygulanır.",

    // Quick Import Clipper Box
    qi_title: "⚡ Tarayıcıdan Tek Tuşla Aktarım (Quick Import Clipper)",
    qi_desc: "Gemini, ChatGPT, Flow/ImageFX ve Suno AI web sitelerinden tek tuşla görsel, prompt, şarkı ve sözleri doğrudan yerel kasaya aktarın.",
    qi_status_active: "Aktif (Açık)",
    qi_status_disabled: "Devre Dışı (Kapalı)",
    qi_btn_disable: "Durdur / Kapat",
    qi_btn_enable: "Etkinleştir / Aç",
    qi_install_btn: "⚡ Tampermonkey Clipper Kur (.user.js)",
    qi_copy_script: "Scripti Kopyala",
    qi_install_hint: "Kurulduğunda Gemini, ChatGPT, Flow ve Suno sayfalarında otomatik '⚡ Vault'a Aktar' butonu görünür.",

    // Google Drive Box
    gd_title: "☁ Google Drive Yedekleme, Eşitleme & Geri Yükleme",
    gd_desc: "Tüm kasayı ve prompt veritabanını Google Drive'daki 'Prompt Vault' klasörüne otomatik yükleyin veya mevcut bir yedekten geri yükleyin.",
    gd_status_label: "Google Drive Durumu:",
    gd_unlinked: "Bağlı Değil",
    gd_linked: "Bağlandı",
    gd_btn_sync: "☁ Kasayı Drive'a Eşitle & Yedekle",
    gd_config_summary: "⚙ Google Cloud Client ID ve Secret Yapılandırması",
    gd_save_btn: "Bilgileri Kaydet",
    gd_login_btn: "🔑 Google ile Giriş Yap",
    gd_logout_btn: "Çıkış Yap",

    // Restore Box
    restore_title: "📥 Yedekten Geri Yükleme (Restore from Backup)",
    restore_desc: "Yeni kurulumlarda veya veri taşımada, Google Drive'daki 'PromptVault_Backup.json' yedeğinden ya da elinizdeki yerel bir JSON dosyasından tüm kütüphaneyi geri yükleyebilirsiniz.",
    restore_drive_btn: "📥 Drive'daki PromptVault_Backup.json'dan Geri Yükle",
    restore_download_imgs: "Drive'daki orijinal görselleri de yerel kasaya indir",
    restore_local_btn: "📁 Yerel JSON Dosyasından Geri Yükle",
    restore_local_hint: "Bilgisayarınızdaki PromptVault_Backup.json dosyasını seçin.",

    // Maintenance Box
    maint_title: "🧹 Kasa Temizliği & Bakım",
    maint_desc: "Eğer orijinal diskteki dosya silinmişse veritabanındaki disk yolunu temizler; kasa kopyanız silinmez.",
    maint_prune_btn: "Eksik Orijinal Yolları Temizle (Prune)",
    maint_lib_stats: "📊 Kütüphane Durumu & İstatistikler",

    // Music
    music_search_ph: "Şarkı adı, sözler, stil veya persona ara...",
    music_all_workspaces: "🏢 Tüm Workspaces (Hepsi)",
    btn_add_song: "➕ Şarkı Ekle",
    card_style_label: "🎯 TAM STİL / PROMPT",
    card_lyrics_label: "📄 ŞARKI SÖZLERİ",
    btn_copy_style: "📋 Kopyala",
    btn_copy_clean: "📋 Tagsız Kopyala",
    btn_expand: "📖 Genişlet",
    btn_collapse: "📕 Daralt",
    btn_sync_music: "Senkronla",
    btn_edit: "Düzenle",
    btn_delete: "Sil",
    no_audio_hint: "📄 Sadece Söz ve Stil Promptu",
    music_detail_prev: "Önceki",
    music_detail_next: "Sonraki",
    music_detail_download: "İndir:",
    music_detail_copy_style: "📋 Promptu Kopyala",
    music_tab_clean: "🎙️ Saf Sözler (Tagsız)",
    music_tab_raw: "📝 Orijinal (Etiketli)",
    music_copy_clean_btn: "📋 Tagsız Kopyala",
    music_copy_raw_btn: "📄 Orijinal Kopyala",
    copied_style_toast: "Suno Stil Promptu panoya kopyalandı! 📋",
    copied_lyrics_toast: "✓ Saf şarkı sözleri (tagsız) panoya kopyalandı! 📋"
  },
  en: {
    // Header & Domain
    brand_sub: "AI Prompt, Metadata & Suno AI Manager",
    domain_images: "Images",
    domain_music: "Music (Suno AI)",
    btn_settings: "Settings",
    btn_settings_title: "System & Integration Settings",
    btn_quick_import: "1-Click Import",
    btn_quick_import_title: "1-Click Send to Vault (Quick Import)",
    qi_modal_title: "1-Click Send to Vault (Quick Import)",
    qi_modal_desc: "Send Suno AI songs or Gemini/ChatGPT images directly to your local vault in 1 click.",

    // Image Tabs
    tab_gallery: "Gallery",
    tab_tags: "Tags",
    tab_matrix: "Prompt Matrix",
    tab_wildcards: "Wildcards",
    tab_scan: "Scan Folder",

    // Music Tabs
    tab_music_songs: "🎵 Songs",
    tab_music_workspaces: "🏢 Workspaces & Artists",
    tab_music_styles: "🏷️ Music Styles",
    tab_music_scan: "📂 Scan & Add Music",

    // Header & Dynamic Stats
    stat_images: "images",
    stat_tags: "tags",
    stat_favorites: "favorites",
    results_count: "results",
    music_stats_songs: "Songs",
    music_stats_workspaces: "Workspaces",
    music_stats_favorites: "Favorites",
    music_stats_audio: "with Audio",

    // Gallery Toolbar
    search_images_ph: 'Search: cat "red hair" -blurry tag:portrait lora:detail gen:comfyui is:fav rating:>=3',
    sort_added: "Newest",
    sort_oldest: "Oldest",
    sort_mtime: "File date",
    sort_rating: "Rating",
    sort_path: "Path",
    sort_title: "Song Title",
    sort_artist: "Artist",
    btn_upload: "⬆ Upload Image",
    btn_drive_sync: "☁ Backup to Drive",
    btn_select_mode: "☐ Select Mode",
    selection_active: "Selection Active",
    bulk_selected: "selected",
    bulk_all: "Select all",
    bulk_clear: "Clear selection",
    bulk_delete: "🗑 Delete Selected",
    bulk_tags_ph: "Bulk tags (comma separated)",
    bulk_apply: "Tag",
    btn_more: "Load more",
    empty_gallery: "No images yet.",
    or: "or",

    // Image Detail Modal
    detail_prompt: "Prompt",
    detail_edit: "✏ Edit",
    detail_cancel: "Cancel",
    detail_copy: "Copy",
    detail_to_matrix: "Send to Matrix",
    detail_generator: "Generator:",
    detail_neg_prompt: "Negative Prompt",
    detail_save_prompt: "💾 Save Changes",
    detail_none: "none",
    detail_params: "Parameters",
    detail_copy_a1111: "Copy in A1111 format",
    detail_tags: "Tags",
    detail_tags_hint: "(click = search)",
    detail_add_tag_ph: "add user tag (comma separated)",
    detail_add_tag_btn: "Add",
    detail_notes: "Notes",
    detail_notes_ph: "Notes about this image...",
    detail_raw_meta: "Raw metadata",
    detail_safe_vault: "🔒 Safe in Vault",
    detail_safe_source_deleted: "🔒 Preserved in Vault (Source Deleted)",
    detail_on_disk: "On Disk",
    detail_fav_on: "★ Favorite",
    detail_fav_off: "☆ Favorite",
    detail_delete_vault: "🗑 Delete from Vault",

    // Upload & Manual Modal
    upload_title: "⬆ Upload Image / Manual Prompt Entry",
    upload_desc: "Drag and drop or select your PNG/JPEG image. Metadata is extracted automatically.",
    upload_drop_prompt: "📁 Click to select an image or drag & drop here",
    upload_generator_label: "Generator",
    upload_model_label: "Model Name",
    upload_tags_label: "User Tags (comma separated)",
    upload_notes_label: "Notes",
    upload_cancel: "Cancel",
    upload_submit: "🔒 Save to Vault",

    // Tags Tab
    tag_kind_all: "All types",
    tag_filter_ph: "Filter tags",
    tag_query_ph: "Only in images matching search (e.g. gen:comfyui)",
    tag_to_wildcard: "→ Wildcard",

    // Matrix Tab
    matrix_prompt_label: "Prompt template",
    matrix_neg_label: "Negative template",
    matrix_params_label: "Parameter axes",
    matrix_add_param: "+ Parameter",
    matrix_mode_label: "Mode",
    matrix_mode_product: "All combinations",
    matrix_mode_random: "Random samples",
    matrix_count_label: "Count",
    matrix_seed_label: "Seed",
    matrix_limit_label: "Limit",
    matrix_preview: "Preview",
    matrix_export: "Export",
    matrix_save: "Save",
    matrix_preview_title: "Preview",
    matrix_copy_sample: "Copy first prompt",

    // Wildcards Tab
    wildcard_lists: "Wildcard Lists",
    wildcard_new: "+ New",
    wildcard_save: "Save",
    wildcard_delete: "Delete",
    wildcard_hint: "One item per line (empty lines ignored)",

    // Folder Scan Tab
    scan_title: "Scan Folder and Import to Vault",
    scan_desc: "All PNG/JPEG images in your chosen folder are scanned, prompts and parameters are parsed and copied into local vault. Even if originals are moved or deleted, vault copies remain safe.",
    scan_browse_btn: "📁 Browse / Choose Folder",
    scan_recursive: "Scan subfolders recursively",
    scan_force: "Force re-read already scanned files",
    scan_start: "Start Scanning",

    // Settings Tab
    settings_title: "⚙️ System & Integration Settings",
    settings_desc: "Manage interface language, 1-click clipper, Google Drive backup, and restore options here.",
    
    // Language Box
    lang_box_title: "🌐 Interface Language",
    lang_box_desc: "Select interface language. Changes take effect immediately.",

    // Quick Import Clipper Box
    qi_title: "⚡ 1-Click Quick Import Clipper",
    qi_desc: "Send images, prompts, songs, and lyrics directly into your local vault from Gemini, ChatGPT, Flow/ImageFX, and Suno AI in 1 click.",
    qi_status_active: "Active (Enabled)",
    qi_status_disabled: "Disabled",
    qi_btn_disable: "Disable",
    qi_btn_enable: "Enable",
    qi_install_btn: "⚡ Install Tampermonkey Clipper (.user.js)",
    qi_copy_script: "Copy Script",
    qi_install_hint: "When installed, an automatic '⚡ Send to Vault' button appears on Gemini, ChatGPT, Flow, and Suno pages.",

    // Google Drive Box
    gd_title: "☁ Google Drive Backup, Sync & Restore",
    gd_desc: "Automatically sync your vault and prompt database to the 'Prompt Vault' folder on Google Drive, or restore from an existing backup.",
    gd_status_label: "Google Drive Status:",
    gd_unlinked: "Not Connected",
    gd_linked: "Connected",
    gd_btn_sync: "☁ Backup & Sync Vault to Drive",
    gd_config_summary: "⚙ Google Cloud Client ID & Secret Configuration",
    gd_save_btn: "Save Credentials",
    gd_login_btn: "🔑 Sign in with Google",
    gd_logout_btn: "Sign Out",

    // Restore Box
    restore_title: "📥 Restore from Backup",
    restore_desc: "On fresh installations or data transfers, restore your entire library from 'PromptVault_Backup.json' in Google Drive or from a local JSON file.",
    restore_drive_btn: "📥 Restore from PromptVault_Backup.json on Drive",
    restore_download_imgs: "Also download original images from Drive to local vault",
    restore_local_btn: "📁 Restore from Local JSON File",
    restore_local_hint: "Select a PromptVault_Backup.json file from your computer.",

    // Maintenance Box
    maint_title: "🧹 Vault Maintenance & Cleanup",
    maint_desc: "Cleans broken original file paths from database if source files were deleted; vault copies remain safe.",
    maint_prune_btn: "Prune Missing Original Paths",
    maint_lib_stats: "📊 Library Statistics",

    // Music
    music_search_ph: "Search song title, lyrics, style or persona...",
    music_all_workspaces: "🏢 All Workspaces (All)",
    btn_add_song: "➕ Add Song",
    card_style_label: "🎯 FULL STYLE / PROMPT",
    card_lyrics_label: "📄 SONG LYRICS",
    btn_copy_style: "📋 Copy",
    btn_copy_clean: "📋 Copy Tagless",
    btn_expand: "📖 Expand",
    btn_collapse: "📕 Collapse",
    btn_sync_music: "Sync",
    btn_edit: "Edit",
    btn_delete: "Delete",
    no_audio_hint: "📄 Lyrics and Style Prompt Only",
    music_detail_prev: "Previous",
    music_detail_next: "Next",
    music_detail_download: "Download:",
    music_detail_copy_style: "📋 Copy Prompt",
    music_tab_clean: "🎙️ Clean Lyrics (Tagless)",
    music_tab_raw: "📝 Original (Tagged)",
    music_copy_clean_btn: "📋 Copy Tagless",
    music_copy_raw_btn: "📄 Copy Original",
    copied_style_toast: "Suno Style Prompt copied to clipboard! 📋",
    copied_lyrics_toast: "✓ Clean lyrics (tagless) copied to clipboard! 📋"
  }
};

let currentLang = localStorage.getItem('pv_lang') || 'tr';

function t(key) {
  const langDict = TRANSLATIONS[currentLang] || TRANSLATIONS.tr;
  return langDict[key] || TRANSLATIONS.tr[key] || key;
}

function setLanguage(lang) {
  if (lang !== 'tr' && lang !== 'en') lang = 'tr';
  currentLang = lang;
  localStorage.setItem('pv_lang', lang);
  document.documentElement.lang = lang;
  applyI18n();
  // Trigger language change listeners in app.js and music.js
  if (typeof window.onLanguageChange === 'function') {
    try { window.onLanguageChange(lang); } catch (e) {}
  }
  window.dispatchEvent(new CustomEvent('languagechange', { detail: { lang } }));
}

function applyI18n() {
  // Update all data-i18n elements
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });

  // Update all data-i18n-ph (placeholder) elements
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const key = el.getAttribute('data-i18n-ph');
    if (key) el.placeholder = t(key);
  });

  // Update all data-i18n-title elements
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.title = t(key);
  });

  // Update active states on language switcher buttons
  const btnTR = document.getElementById('btnLangTR');
  const btnEN = document.getElementById('btnLangEN');
  if (btnTR) btnTR.classList.toggle('active', currentLang === 'tr');
  if (btnEN) btnEN.classList.toggle('active', currentLang === 'en');
}

// Export for usage in window
window.t = t;
window.setLanguage = setLanguage;
window.applyI18n = applyI18n;
Object.defineProperty(window, 'currentLang', {
  get: () => currentLang,
  set: (v) => setLanguage(v)
});

// Auto-bind language buttons on DOM ready
if (typeof document !== 'undefined') {
  const initI18n = () => {
    applyI18n();
    document.getElementById('btnLangTR')?.addEventListener('click', (e) => {
      e.preventDefault();
      setLanguage('tr');
    });
    document.getElementById('btnLangEN')?.addEventListener('click', (e) => {
      e.preventDefault();
      setLanguage('en');
    });
    document.getElementById('btnSetLangTR')?.addEventListener('click', (e) => {
      e.preventDefault();
      setLanguage('tr');
    });
    document.getElementById('btnSetLangEN')?.addEventListener('click', (e) => {
      e.preventDefault();
      setLanguage('en');
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initI18n);
  } else {
    initI18n();
  }
}
