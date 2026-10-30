// PromptVault Internationalization (TR / EN)
const TRANSLATIONS = {
  tr: {
    // Header & Domain
    brand_sub: "AI Prompt, Metadata & Suno AI Yöneticisi",
    domain_images: "🎨 Görseller",
    domain_music: "🎵 Müzik (Suno AI)",
    btn_settings: "⚙️ Ayarlar",

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

    // Gallery Toolbar
    search_images_ph: 'Ara: kedi "red hair" -blurry tag:portrait lora:detail gen:comfyui is:fav rating:>=3',
    sort_added: "En yeni",
    sort_oldest: "En eski",
    sort_mtime: "Dosya tarihi",
    sort_rating: "Puan",
    sort_path: "Yol",
    btn_upload: "⬆ Görsel Ekle",
    btn_drive_sync: "☁ Drive'a Yedekle",
    btn_select_mode: "☐ Çoklu Seçim",
    bulk_selected: "seçili",
    bulk_all: "Tümünü seç",
    bulk_clear: "Seçimi temizle",
    bulk_delete: "🗑 Seçilenleri Sil",
    bulk_tags_ph: "Toplu etiketler (virgülle)",
    bulk_apply: "Etiketle",
    btn_more: "Daha fazla yükle",
    empty_gallery: "Henüz görsel yok.",

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
    copied_style_toast: "Suno Stil Promptu panoya kopyalandı! 📋",
    copied_lyrics_toast: "✓ Saf şarkı sözleri (tagsız) panoya kopyalandı! 📋"
  },
  en: {
    // Header & Domain
    brand_sub: "AI Prompt, Metadata & Suno AI Manager",
    domain_images: "🎨 Images",
    domain_music: "🎵 Music (Suno AI)",
    btn_settings: "⚙️ Settings",

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

    // Gallery Toolbar
    search_images_ph: 'Search: cat "red hair" -blurry tag:portrait lora:detail gen:comfyui is:fav rating:>=3',
    sort_added: "Newest",
    sort_oldest: "Oldest",
    sort_mtime: "File date",
    sort_rating: "Rating",
    sort_path: "Path",
    btn_upload: "⬆ Upload Image",
    btn_drive_sync: "☁ Backup to Drive",
    btn_select_mode: "☐ Select Mode",
    bulk_selected: "selected",
    bulk_all: "Select all",
    bulk_clear: "Clear selection",
    bulk_delete: "🗑 Delete Selected",
    bulk_tags_ph: "Bulk tags (comma separated)",
    bulk_apply: "Tag",
    btn_more: "Load more",
    empty_gallery: "No images yet.",

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
window.currentLang = () => currentLang;
window.applyI18n = applyI18n;
