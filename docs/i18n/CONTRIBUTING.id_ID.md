<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · **Bahasa Indonesia** · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# Berkontribusi ke World of ClaudeCraft

Pertama-tama, terima kasih sudah berada di sini. World of ClaudeCraft dibangun
oleh komunitas orang-orang yang mencintai MMO klasik, dan setiap kontribusi, besar
atau kecil, membuatnya menjadi lebih baik. Memperbaiki salah ketik, menerjemahkan
game, melaporkan bug, membangun sebuah dungeon yang benar-benar baru: semuanya
berarti, dan kamu disambut di sini.

Panduan ini akan membantumu menyiapkan lingkungan kerja dan membuat kontribusi
pertamamu berjalan mulus. Kamu tidak perlu menjadi ahli. Jika ada yang kurang
jelas, tanyakan di [Discord](https://discord.gg/GjhnUsBtw) dan seseorang akan
dengan senang hati membantu.

Dengan ikut berpartisipasi, kamu setuju untuk mengikuti
[Kode Etik](../../CODE_OF_CONDUCT.md) kami.

## Cara berkontribusi

Ada tempat untuk semua orang di sini:

- **Kode.** Memperbaiki bug, menambahkan fitur, atau meningkatkan performa. Isu
  yang berlabel
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  dan [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  adalah tempat yang bagus untuk memulai.
- **Terjemahan.** Bantu para pemain di seluruh dunia dengan meningkatkan atau
  melengkapi sebuah bahasa. Lihat [Menerjemahkan game](#translating-the-game) di
  bawah. Ini adalah salah satu cara termudah dan paling berdampak untuk memulai.
- **Laporan bug dan ide fitur.** Buka sebuah [isu](https://github.com/levy-street/world-of-claudecraft/issues/new/choose).
  Laporan bug yang jelas adalah kontribusi yang nyata.
- **Dokumentasi.** Panduan seperti yang satu ini, README, dan dokumen desain di
  `docs/` selalu bisa ditingkatkan.
- **Playtesting dan masukan.** Mainkan game-nya, beri tahu kami apa yang terasa
  janggal, dan bagikan ide di Discord.

## Memulai

Kamu memerlukan [Node.js 22+](https://nodejs.org/) dan npm. Untuk server
multiplayer kamu juga akan membutuhkan [Docker](https://www.docker.com/) untuk
menjalankan Postgres.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Install dependencies
npm ci

# 3. Run the offline client (no server or database needed)
npm run dev          # open the URL it prints (usually http://localhost:5173)
```

Itu sudah cukup untuk memainkan dunia offline dan mengerjakan sebagian besar hal.
Untuk menjalankan stack online secara penuh:

```bash
npm run db:up        # start Postgres 16 in Docker (dev DB on port 5433)
npm run server       # build and run the authoritative game server on :8787
npm run dev          # in another terminal; the client proxies to the server
```

[README](../../README.md) memuat panduan host, kembangkan, dan main secara
lengkap, dan berkas-berkas `CLAUDE.md` di seluruh repo mendokumentasikan konvensi
untuk masing-masing area.

## Membuat perubahanmu

1. **Buat sebuah branch** dari `main`: `feature/<short-slug>` atau
   `fix/<short-slug>`.
2. **Buat commit yang terfokus.** Perubahan yang lebih kecil dan mandiri lebih
   mudah ditinjau dan digabungkan daripada yang besar.
3. **Tambahkan atau perbarui tes** untuk perilaku apa pun yang kamu ubah di
   `src/sim/` atau `server/`.
4. **Jaga agar teks yang terlihat pemain tetap dapat diterjemahkan.** Lihat
   [Lokalisasi](#localization) dan [Menerjemahkan game](#translating-the-game).

### Hal-hal yang perlu diingat

Ini adalah aturan inti yang menopang basis kode. Detail lengkapnya ada di
[`CLAUDE.md`](../../CLAUDE.md) di akar repo, tetapi versi singkatnya:

- **Inti simulasi (`src/sim/`) adalah sumber kebenaran**, dan tetap murni, tanpa
  impor DOM, browser, atau Three.js, sehingga kode yang persis sama berjalan
  secara offline, di server, dan di lingkungan RL headless.
- **Simulasi bersifat deterministik.** Ia berjalan pada tick tetap 20 Hz, dan
  semua keacakan melewati `Rng`, jangan pernah `Math.random`, `Date.now`, atau
  `performance.now` di logika sim. Seed yang sama selalu menghasilkan dunia yang
  sama.
- **Matematika gameplay mengikuti formula MMO era klasik** (rage, hit table,
  armor, kurva XP). Mohon jangan mengarang angka keseimbangan. Sebagai gantinya,
  sebutkan formulanya.
- **Jangan menyunting berkas yang dihasilkan secara manual** seperti
  `*.generated.ts`. Hasilkan ulang melalui proses build.
- **Jangan pernah meng-commit secret** atau berkas `.env`, dan jangan pernah
  mengaktifkan `ALLOW_DEV_COMMANDS` di jalur produksi, karena itu membuka cheat.

## Sebelum kamu membuka pull request

Mohon jalankan ini secara lokal. Ini adalah pemeriksaan yang sama dengan yang
dijalankan CI:

```bash
npm test                    # Vitest suite
npx tsc --noEmit            # TypeScript typecheck (the project is strict)
npm run security:gate       # malicious-code release gate (high-severity signatures; also asserted by npm test)
npm run build               # production client build
```

Jika kamu mengubah kode server atau headless, jalankan juga
`npm run build:server` dan `npm run build:env`.

Kemudian uji perubahanmu di desktop dan mobile, termasuk viewport seukuran ponsel
dalam mode potret dan lanskap, jika menyentuh apa pun yang dilihat pemain. Target
sentuh harus tetap minimal 40x40px dan input formulir minimal font 16px. Standar
UI didokumentasikan di [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Membuka pull request

Push branch-mu dan buka sebuah PR terhadap `main`.
[Templat pull request](../../.github/PULL_REQUEST_TEMPLATE.md) akan memandumu
melalui sebuah daftar periksa singkat. Mohon isi:

- Jelaskan **apa** yang berubah dan **mengapa**.
- Tautkan isu terkait apa pun (misalnya, "Closes #123").
- Tambahkan **tangkapan layar atau klip untuk perubahan UI**, di desktop dan
  mobile.
- Konfirmasi bahwa tes, typecheck, dan build lulus, serta string baru sudah
  diterjemahkan.

CI yang hijau dan daftar periksa yang lengkap adalah yang kami cari sebelum
menggabungkan. Seorang maintainer mungkin menyarankan perubahan. Itu adalah bagian
yang normal dan kolaboratif dari prosesnya, bukan sebuah penolakan. Kami berupaya
untuk bersikap baik dan konstruktif dalam tinjauan, dan kami meminta hal yang sama
darimu.

> Pesan commit dan judul PR mengikuti [Conventional Commits](https://www.conventionalcommits.org/)
> dengan scope di mana cocok (`feat(talents): ...`, `fix(net): ...`). Ini adalah
> konvensi yang kami sukai, bukan persyaratan yang ketat. Pesan yang jelas dan
> deskriptif lebih penting daripada format yang sempurna.

<a id="localization"></a>

## Lokalisasi

World of ClaudeCraft hadir dalam banyak bahasa, dan kami menjaganya tetap begitu
seiring game berkembang. Setiap string yang terlihat pemain diterjemahkan ke
setiap locale yang didukung.

- Semua teks yang berhadapan dengan pengguna adalah sebuah kunci `t()` yang
  didefinisikan di [`src/ui/i18n.ts`](../../src/ui/i18n.ts). Tambahkan string baru
  ke locale `en` terlebih dahulu, lalu sediakan terjemahan nyata di setiap locale
  lain dalam `supportedLanguages`. Tidak ada placeholder bahasa Inggris, dan tidak
  ada `// TODO`.
- Angka, uang, tanggal, satuan, dan persentase melewati formatter (`formatNumber`,
  `formatMoney`, `formatDateTime`, `Intl`) alih-alih penyusunan string secara
  manual.
- Teks yang berhadapan dengan pemain yang dipancarkan dari `src/sim/` atau
  `server/`, yang tetap agnostik terhadap bahasa, harus dilokalisasi ulang di batas
  klien dalam perubahan yang sama. Tes penjaga
  `npx vitest run tests/localization_fixes.test.ts` menegakkan hal ini.

Jika perubahanmu menambahkan sebuah string dan kamu hanya bisa menuliskannya dalam
beberapa bahasa, tidak masalah. Buka PR-nya dan minta bantuan untuk sisanya di
deskripsi. Kami jauh lebih suka membantumu menyelesaikannya daripada membuatmu
menahan diri.

<a id="translating-the-game"></a>

## Menerjemahkan game

Ingin meningkatkan sebuah bahasa, atau membantu menghadirkan game ke bahasa yang
baru? Kamu tidak perlu menulis kode game apa pun untuk melakukannya:

1. Buka [`src/ui/i18n.ts`](../../src/ui/i18n.ts) dan temukan locale yang ingin
   kamu kerjakan. Setiap objek locale mencantumkan kunci yang sama dengan `en`.
2. Tingkatkan terjemahan yang ada, atau lengkapi yang terbaca janggal.
3. Jalankan `npx tsc --noEmit` untuk memastikan tidak ada yang hilang, lalu buka
   sebuah PR.

Untuk mengusulkan sebuah locale yang benar-benar baru, atau untuk mendiskusikan
nada dan terminologi, mulai sebuah thread di
[Discord](https://discord.gg/GjhnUsBtw) dan kami akan membantumu menyambungkannya.
Penutur asli dan fasih sangat kami sambut. Terjemahan yang baik membuat game
terasa seperti rumah bagi para pemain di mana pun.

## Melaporkan bug dan meminta fitur

Mohon gunakan [templat isu](https://github.com/levy-street/world-of-claudecraft/issues/new/choose):

- **Laporan bug.** Cari [isu yang sudah ada](https://github.com/levy-street/world-of-claudecraft/issues)
  terlebih dahulu untuk menghindari duplikat, lalu sertakan langkah-langkah untuk
  mereproduksi, apa yang kamu harapkan, apa yang terjadi, dan lingkunganmu (offline
  atau online, browser, desktop atau mobile).
- **Permintaan fitur.** Jelaskan masalah yang ingin kamu pecahkan, bukan hanya
  solusinya. Konteks membantu kami merancang hal yang tepat.

## Mendapatkan bantuan

Tersangkut, atau hanya ingin menyapa? Bergabunglah dengan
[Discord komunitas](https://discord.gg/GjhnUsBtw). Tidak ada pertanyaan yang
terlalu kecil, dan kontributor baru selalu disambut.

## Lisensi

Dengan berkontribusi, kamu setuju bahwa kontribusimu akan dilisensikan di bawah
[Lisensi MIT](../../LICENSE) proyek, lisensi yang sama yang mencakup proyek ini.

---

Terima kasih telah berkontribusi ke World of ClaudeCraft. Kami tidak sabar untuk
melihat apa yang akan kamu bangun bersama kami.
