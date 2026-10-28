# PromptVault ◈

Yapay zeka modelleriyle üretilen görsellerin (Stable Diffusion, Midjourney, NovelAI, ComfyUI, Fooocus, InvokeAI, vb.) PNG metadata'larını okuyan, parametre ve prompt'larını ayrıştırıp yerel SQLite veritabanında FTS5 tam metin araması ve otomatik ağırlıklı etiketlerle indeksleyen, aynı zamanda yeni üretimler için esnek kombinasyonlu **Prompt Matrisi** motoru ve modern web arayüzü sunan kütüphane ve yazılım.

- **Toplu Klasör Tarama & Gözat Butonu**:
  - `Kasa & Tarama` sekmesinde bulunan **"📁 Gözat / Klasör Seç"** butonuna basarak bilgisayarınızdaki herhangi bir klasörü görsel arayüzden seçebilirsiniz; dosya yolunu elle yazmak zorunda kalmazsınız.

---

## ☁ Google Drive Entegrasyonu & Tek Tuşla Yedekleme

PromptVault, kasadaki tüm görselleri ve prompt veritabanını **Google Drive** üzerinde otomatik olarak senkronize edebilir:
- **Tek Tuşla Yedekleme**:
  - Galeride ve Kasa sekmesinde bulunan **"☁ Drive'a Yedekle"** butonuna tek tıklamayla, henüz Drive'a yüklenmemiş olan tüm yeni görseller ve prompt'lar taranır ve doğrudan yüklenir.
- **Otomatik "Prompt Vault" Klasörü**:
  - Google Drive hesabınızda otomatik olarak bir **`Prompt Vault`** klasörü oluşturulur.
  - Her görsel kendi çözünürlüğü ve metadata açıklamasıyla yüklenir.
  - Ayrıca klasörün içine tüm prompt ve etiket arşivinizi içeren `PromptVault_Backup.json` dosyası da otomatik yedeklenir.
- **Akıllı Eşitleme**:
  - Daha önce yüklenmiş görseller tekrar yüklenmez (veritabanında `gdrive_id` takip edilir), sadece yeni eklenenler yüklenir.

---

## 🔒 Kasa (Vault) Koruması ve Veri Güvenliği

PromptVault, adının hakkını vererek tam bir **Kasa (Vault)** mimarisiyle çalışır:
- **Kaynak Dosya Silinirse Ne Olur?**
  - Taranan veya yüklenen her görsel, veritabanına kaydedilirken aynı zamanda kütüphanenin kasa deposuna (`~/.promptvault/vault`) kopyalanarak arşivlenir.
  - Orijinal üretim klasörünüzü silseniz, temizleseniz veya başka diske taşısanız dahi; görsel dosyası, prompt'u, negatif prompt'u, tüm üretim parametreleri ve etiketleri **kasada güvende kalır ve silinmez**.
  - Galeri ve detay pencereleri otomatik olarak kasa kopyasından beslenir.
- **Tekil Görsel Yükleme & Sürükle-Bırak**:
  - Web arayüzünde **"⬆ Görsel Ekle"** butonuna basabilir veya herhangi bir PNG/JPEG görselini doğrudan tarayıcı ekranına sürükleyip bırakabilirsiniz.
  - Varsa görselin içindeki metadata otomatik okunur.
- **Promptları Kendiniz Girin veya Düzenleyin**:
  - Yükleme sırasında veya galerideki herhangi bir görselin detayında **"✏ Düzenle"** butonuna tıklayarak prompt ve negatif prompt'u istediğiniz gibi değiştirebilirsiniz.
  - Prompt güncellendiğinde sistem SQLite FTS5 arama indeksini ve ağırlıklı etiketleri anında yeniden senkronize eder.
  - İsterseniz görsel dosyası olmadan doğrudan metin olarak da yeni prompt kayıtları oluşturabilirsiniz.

---

## 🚀 Hızlı Başlangıç (Tek Tıkla Başlatma)

Klasör içindeki **`start_web.bat`** dosyasına çift tıklayarak web arayüzünü doğrudan tarayıcınızda açabilirsiniz.

Alternatif olarak terminalden:
```powershell
cd C:\Users\yogru\.gemini\antigravity\scratch\promptvault
.\.venv\Scripts\promptvault serve --open --port 7860
```

1. **Görsel Pikselini Çözmeden Ultra Hızlı Metadata Okuma**:
   - PNG dosyasındaki `tEXt`, `zTXt` ve `iTXt` chunk'larını doğrudan ikili (binary) düzeyde okur. Yüz binlerce dosyalık arşivleri saniyeler içinde tarayabilir.
2. **Evrensel ve Model/Araç Bağımsız Ayrıştırıcı (Parser)**:
   - **Automatic1111 / SD-WebUI / Forge**: `parameters` metnini (positive prompt, negative prompt, steps, sampler, cfg, seed, model, lora hashes, clip skip vb.) ayrıştırır.
   - **ComfyUI**: Düğüm grafını (graph JSON) ve iş akışını (workflow) analiz eder; KSampler, CLIPTextEncode, LoraLoader, CheckpointLoader ve bağlantılı dinamik metin düğümlerini çözer.
   - **NovelAI**: V3/V4 formatları, `Comment` JSON, `uc` (unwanted content) ve `Source` alanları.
   - **InvokeAI**: `invokeai_metadata` ve `sd-metadata` formatları.
   - **Fooocus & Genel JSON**: JSON biçimindeki parametreler.
   - **Midjourney / DALL-E / Diğerleri**: `Description`, `Comment`, `UserComment` gibi EXIF/XMP metin alanları.
3. **Otomatik Ağırlıklı Etiketleme ve Tokenizasyon**:
   - SD attention parantez ağırlıklarını `(word:1.3)`, `((word))`, `[word]` hesaplayarak etiketler.
   - LoRA'ları `<lora:name:weight>` ayrı bir etiket türü olarak kaydeder.
   - Model adı ve üretim aracını otomatik olarak etiket sınıfına ekler.
   - Kullanıcıların kendi özel etiketlerini ve notlarını eklemesine izin verir.
4. **Yerel SQLite + FTS5 Arama Motoru**:
   - Gelişmiş arama sözdizimi: `kedi "kırmızı saç" -bulanık tag:portre lora:detail gen:comfyui is:fav rating:>=4 seed:1234 w:>=1024`
   - Dosyalar taşındığında veya yeniden adlandırıldığında SHA1 hash kontrolü ile kullanıcı notları, puanları ve etiketleri korunur.
5. **Kombinasyonlu Prompt Matrisi Motoru**:
   - `{a|b|c}` Kartezyen çarpım kombinasyonları
   - `{kırmızı {kedi|tilki}|kurt}` İç içe gruplar ve hiyerarşik varyasyonlar
   - `{|ayrıntılı}` Boş seçenekle isteğe bağlı ifadeler
   - `{1-5}` veya `{20-40:5}` Sayı ve adım aralıkları
   - `{2$$a|b|c}` Seçenekler arasından N tanesini seçme kombinasyonu
   - `{@karakter:kedi|tilki}` Adlandırılmış eksen; aynı seçim prompt'un başka yerinde `{@karakter}` ile tekrar kullanılır
   - `__wildcard__` Dinamik harici dosya veya veritabanı kelime listeleri
   - Parametre eksenleri: `steps`, `cfg_scale`, `sampler` gibi alanlara matris uygulama
   - Dışa aktarma formatları: Metin (TXT), A1111 "Prompts from file", CSV, JSON, JSONL.
6. **Yerel Web Arayüzü**:
   - Hızlı küçük resim (thumbnail) önbelleği ile galeri görünümü.
   - Detay modalı: Prompt, negatif prompt ve parametreleri tek tıkla kopyalama, A1111 formatına çevirme, tek tıkla Prompt Matrisine aktarma.
   - Canlı matris önizlemesi, varyasyon hesaplayıcı, wildcard düzenleyici ve klasör tarama arayüzü.

---

## 📦 Kurulum

```bash
# Proje dizinine gidin
cd promptvault

# Sanal ortamı aktifleştirin ve yükleyin
pip install -e ".[web]"
```

Geliştirici veya test paketleriyle yüklemek için:
```bash
pip install -e ".[dev]"
pytest
```

---

## 💻 Kullanım: Python Kütüphanesi Olarak

### 1. Bir PNG dosyasının metadata verisini okuma
```python
from promptvault import read_metadata

meta = read_metadata("output.png")
print("Üretici:", meta.generator)      # 'a1111', 'comfyui', 'novelai', vb.
print("Prompt:", meta.prompt)
print("Negatif:", meta.negative)
print("Parametreler:", meta.params)    # {'steps': 30, 'cfg_scale': 7.0, 'sampler': 'DPM++ 2M', ...}
print("Model:", meta.model)
print("LoRA'lar:", meta.loras)         # [('add_detail', 0.6)]
```

### 2. Kütüphane Veritabanı ve Arama
```python
from promptvault import Library

# Veritabanını aç (varsayılan: ~/.promptvault/library.db)
lib = Library("my_library.db")

# Klasörü tara ve otomatik indeksle
stats = lib.scan("C:/stable-diffusion/outputs")
print(f"{stats['added']} yeni görsel eklendi.")

# Gelişmiş arama
total, images = lib.search('tag:landscape gen:comfyui is:fav rating:>=4')
for img in images:
    print(img["id"], img["path"], img["prompt"])

# Kullanıcı etiketi ve puan ekleme
lib.add_tags(image_id=1, names=["favorilerim", "duvar-kagidi"])
lib.update(image_id=1, rating=5, favorite=True, notes="Harika ışıklandırma")
```

### 3. Prompt Matrisi Üretimi
```python
from promptvault import Matrix, MatrixSpec, expand

# Hızlı tek satırlık genişletme:
prompts = expand("a {cute|majestic} {cat|fox} in {snow|autumn leaves}")
# -> 4 adet kombinasyon üretir

# Çok eksenli ve parametreli matris:
spec = MatrixSpec(
    prompt="masterpiece, {@subject:cat|fox} with {@subject} ears, in {rain|sunny day}",
    negative="blurry, lowres",
    params={
        "steps": "{20-30:5}",         # 20, 25, 30
        "cfg_scale": [6, 7.5],
        "sampler": "Euler a"
    }
)
m = Matrix(spec)
print(f"Toplam kombinasyon: {m.count()}")

for row in m.rows(limit=5):
    print(row["prompt"], row["params"])
```

---

## 🖥️ Komut Satırı (CLI)

PromptVault tam teşekküllü bir CLI aracına sahiptir:

```bash
# PNG dosyasının metadatasını terminalde incele
promptvault read image.png

# Klasörleri tara ve veritabanına ekle
promptvault scan "D:\AI_Images"

# Arama yap
promptvault search "kedi tag:portrait gen:a1111 rating:>=4"

# Etiket istatistiklerini listele
promptvault tags --kind prompt --limit 20

# Prompt matrisi oluştur ve A1111 formatında kaydet
promptvault matrix "masterpiece, a {cyberpunk|steampunk} {cat|owl}" -p steps="20,30" -f a1111 -o prompts.txt

# Web arayüzünü başlat ve tarayıcıda aç
promptvault serve --open --port 7860
```

---

## 🌐 Web Arayüzü

`promptvault serve --open` komutu ile tarayıcınızda açılan yerel arayüzde:
- **Galeri Sekmesi**: Görseller arasında arama yapın, yıldız puanı verin, favorilere ekleyin, küçük resimleri görüntüleyin, toplu seçimle birden fazla görsele etiket atayın.
- **Detay Penceresi**: Prompt, negatif prompt ve parametreleri panoya tek tıkla kopyalayın, doğrudan "Prompt Matrisi" sekmesine aktarın.
- **Etiketler Sekmesi**: En sık kullanılan prompt kelimelerini, LoRA'ları ve modelleri frekans çubuklarıyla görün; tek tıkla arama filtresine dönüştürün veya wildcard listesi yapın.
- **Prompt Matrisi Sekmesi**: Şablonunuzu yazarken canlı olarak toplam kombinasyon sayısını ve önizleme satırlarını görün. TXT, A1111 formatı veya CSV/JSON olarak dışa aktarın.
- **Wildcards Sekmesi**: `__stil__`, `__karakterler__` gibi kelime listelerini oluşturun, içe/dışa aktarın ve yönetin.
