<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Čeština](CONTRIBUTING.cs_CZ.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · **Bahasa Indonesia** · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# Berkontribusi ke World of ClaudeCraft

Pertama-tama, terima kasih sudah berada di sini. World of ClaudeCraft dibangun
oleh komunitas orang-orang yang mencintai MMO klasik, dan setiap kontribusi, besar
atau kecil, membuatnya menjadi lebih baik. Memperbaiki salah ketik, menerjemahkan
game, melaporkan bug, membangun sebuah dungeon yang benar-benar baru: semuanya
berarti, dan kamu disambut di sini.

Panduan ini akan membantumu menyiapkan lingkungan kerja dan membuat kontribusi
pertamamu berjalan mulus. Kamu tidak perlu menjadi ahli. Jika ada yang kurang
jelas, tanyakan di [Discord](https://discord.com/invite/worldofclaudecraft) dan seseorang akan
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

Kamu memerlukan [Node.js 26](https://nodejs.org/) dan npm, versi yang dipakai CI
dan image produksi. Major yang lebih lama tidak diuji. Untuk server multiplayer
kamu juga akan membutuhkan [Docker](https://www.docker.com/) untuk menjalankan
Postgres.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Install dependencies
npm ci

# 3. Point git at the repository hooks (once per clone)
git config core.hooksPath .githooks

# 4. Run the offline client (no server or database needed)
npm run dev          # open the URL it prints (usually http://localhost:5173)
```

Itu sudah cukup untuk memainkan dunia offline dan mengerjakan sebagian besar hal.
Untuk menjalankan stack online secara penuh, kamu perlu password database di
environment-mu terlebih dahulu:

```bash
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # start Postgres 16 in Docker (dev DB on port 5433)
npm run server       # build and run the authoritative game server on :8787
npm run dev          # in another terminal; the client proxies to the server
```

Jika kamu berencana menjalankan gate lengkap di bawah, pasang sekali browser yang
dijalankannya: `npx playwright install chromium`.

[README](README.id_ID.md) memuat panduan host, kembangkan, dan main secara
lengkap, dan berkas-berkas `CLAUDE.md` di seluruh repo mendokumentasikan konvensi
untuk masing-masing area.

### Toolchain TypeScript

Pemeriksaan tipe berjalan di TypeScript 7, compiler natifnya: `npx tsc --noEmit`
bekerja persis seperti sebelumnya dan pemeriksaan seluruh repo kini memakan waktu
beberapa detik, bukan puluhan detik. Instalasinya memakai alias ganda resmi: paket
`typescript` menunjuk ke API JS TypeScript 6 (lewat wrapper
`@typescript/typescript6`) karena `svelte-check` masih memakai API itu, sementara
`@typescript/native` menyediakan biner `tsc`. Hal-hal yang perlu diketahui:

- **Editor.** VS Code memerlukan ekstensi marketplace "TypeScript 7"
  (`TypeScriptTeam.native-preview`) untuk dukungan language service natif sampai
  dukungan bawaannya dirilis; ekstensi itu diaktifkan lewat pengaturan
  `js/ts.experimental.useTsgo`, dan perintah "Disable TypeScript 7 Language
  Server" miliknya adalah jalan mundur yang disahkan ke tsserver TypeScript 6.
  IDE JetBrains hanya mendeteksi server natif secara otomatis di bawah nama paket
  `@typescript/native-preview`, jadi mereka tidak akan mengenalinya dari alias
  `@typescript/native` milik repo ini; dukungan TypeScript 6 bawaan mereka bekerja
  dengan baik.
- **Flag tsc yang berguna.** `--checkers N` mengatur jumlah worker pemeriksa tipe
  paralel (default 4; hasilnya identik pada jumlah berapa pun): turunkan untuk
  membatasi memori pada runner yang terbatas, naikkan pada mesin dengan banyak
  core, dan ukur di kedua kasus, karena lebih banyak tidak selalu lebih cepat.
  `--singleThreaded` mematikan seluruh paralelisme. Memeriksa satu berkas secara
  ad hoc (`npx tsc somefile.ts`) akan error ketika direktorinya punya
  `tsconfig.json`; berikan `--ignoreConfig` untuk perilaku lama.
- **Lockfile.** Hasilkan ulang `package-lock.json` hanya dengan
  `npx npm@10 install --package-lock-only`: berkas itu memakai semantik npm 10,
  dan major npm yang lebih baru (termasuk npm 11 yang dibundel Node 26 milik CI)
  diam-diam membuang entri optional-peer bersarang milik `svelte-check`, yang
  membuat `npm ci` di CI tidak sinkron. `npm ci` biasa aman di major npm mana pun.
  Setelah menghasilkan ulang, pastikan `npm ci --dry-run` sudah sinkron baik di
  npm 10 maupun di npm workstation-mu.
- **Kapan meninjau ulang.** Satukan kembali alias ganda menjadi satu dependensi
  `typescript` begitu KEDUANYA terpenuhi: API JS stabil TypeScript 7.1 sudah
  dirilis (TypeScript 7.0 tidak menyertakan API JS sama sekali; penggantinya
  dilacak di isu 2824 microsoft/typescript-go), dan isu 3063
  sveltejs/language-tools sudah ditutup dengan rilis `svelte-check` yang
  mengadopsinya. Mode eksperimental `--tsgo` milik svelte-check tidak menghapus
  kebutuhannya akan API TypeScript 6, dan pemuatan TypeScript 7 yang sedang
  dikerjakan di sana (PR 3073 language-tools) membaca alias `@typescript/native`
  yang sudah dipakai repo ini, jadi tidak perlu ada penggantian nama.

## Membuat perubahanmu

1. **Mulailah dari branch release terbaru, dan jangan pernah dari `main`.**
   Pekerjaan aktif diintegrasikan pada sebuah branch `release/vX.Y.Z`; `main`
   tertinggal di belakangnya dan bukan basis untuk kontribusi. Temukan yang
   terbaru dan buat branch darinya:

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # the newest release branch
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   Selalu jalankan pencarian itu alih-alih menyalin nomor versi dari panduan ini:
   branch rilis berganti cukup sering, dan yang terbaru bergeser setiap kali ada
   rilis. Branch diberi nama `feature/<short-slug>` atau `fix/<short-slug>`.
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
- **Logika baru masuk sebagai modul kecilnya sendiri yang teruji di balik seam
  yang sudah ada**, alih-alih ditempelkan ke salah satu berkas koordinator yang
  besar. Data yang dibaca renderer atau HUD melintasi antarmuka `IWorld`
  (`src/world_api/`) dan diimplementasikan di dunia offline maupun online; sebuah
  sistem simulasi baru berada di balik `SimContext`; sebuah endpoint REST baru
  adalah modul route yang bisa kamu buat kerangkanya dengan
  `npm run new:endpoint`.
- **Jangan menyunting berkas yang dihasilkan secara manual** seperti
  `*.generated.ts`. Hasilkan ulang melalui proses build.
- **Gaya penulisan rumah: tanpa em dash, en dash, atau emoji** di mana pun, baik
  di kode, komentar, dokumentasi, pesan commit, teks PR, maupun teks yang dilihat
  pemain. Gunakan koma, titik dua, tanda kurung, atau "sampai" untuk rentang.
  Sebuah pemeriksaan pre-push memindai diff-mu dan memblokir push jika menemukan
  salah satunya.
- **Jangan pernah meng-commit secret** atau berkas `.env`, dan jangan pernah
  mengaktifkan `ALLOW_DEV_COMMANDS` di jalur produksi, karena itu membuka cheat.

### Gaya kode

Pemformatan memakai [Biome](https://biomejs.dev/), yang dikonfigurasi di
`biome.json`: indentasi 2 spasi, baris 100 kolom, kutip tunggal, koma di akhir.
Format hanya berkas yang kamu sentuh
(`npx @biomejs/biome check --write <your-file.ts>`) dan periksa dengan
`npm run ci:changed`. CI hanya menilai berkas yang berubah, jadi mohon jangan
memformat ulang seluruh pohon repo: menjalankannya untuk repo penuh akan memunculkan
utang lama yang bukan tugasmu untuk membereskannya.

## Sebelum kamu membuka pull request

Jalankan gate repo secara lokal. Itu adalah kontrak yang sama dengan yang
ditegakkan CI:

```bash
npm run gate
```

Saat sedang beriterasi, jalankan satu suite saja
(`npx vitest run tests/sim.test.ts`) dan `npm run ci:changed` untuk pemformatan;
`npm test` menjalankan semuanya, dan peta suite-nya ada di `tests/CLAUDE.md`.
`npm run gate` yang lengkap mencakup kesegaran artefak yang dihasilkan, pemindaian
malware, pemformatan pada berkas yang berubah, pemeriksaan konformitas efek suara,
seluruh suite tes, satu putaran regresi di browser sungguhan, typecheck ketat,
serta build klien, server, dan headless. Pemeriksaan berlapis, mulai dari lantai
pre-push ke atas, dijelaskan di [`docs/qa-gate.md`](../qa-gate.md).

Kemudian uji perubahanmu di desktop dan mobile, termasuk viewport seukuran ponsel
dalam mode potret dan lanskap, jika menyentuh apa pun yang dilihat pemain. Target
sentuh harus tetap minimal 40x40px dan input formulir minimal font 16px. Standar
UI didokumentasikan di [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Membuka pull request

Push branch-mu dan buka sebuah PR **yang menargetkan branch `release/vX.Y.Z`
terbaru yang sama dengan tempatmu memulai. Jangan pernah menargetkan `main`**,
yang merupakan branch integrasi saat rilis, bukan basis kontribusi. GitHub sering
memilih `main` untukmu secara otomatis, jadi ganti base branch sebelum kamu
mengirimkannya.
[Templat pull request](../../.github/PULL_REQUEST_TEMPLATE.md) akan memandumu
melalui sebuah daftar periksa singkat. Mohon isi:

- Jelaskan **apa** yang berubah dan **mengapa**.
- Tautkan isu terkait apa pun (misalnya, "Closes #123").
- Tambahkan **tangkapan layar atau klip untuk perubahan UI**, di desktop dan
  mobile.
- Konfirmasi bahwa `npm run gate` lulus dan string baru yang dilihat pemain
  mengikuti kebijakan kontributor English-first di bawah.

Di PR-mu, CI menjalankan pemformatan dan lint pada berkas yang kamu ubah, seluruh
suite tes di empat shard paralel, satu putaran regresi browser, serta typecheck
ditambah build klien, server, dan headless. Itu sama dengan yang dijalankan
`npm run gate` secara lokal, jadi gate yang hijau adalah pertanda baik bahwa PR-mu
juga akan hijau.

CI yang hijau dan daftar periksa yang lengkap adalah yang kami cari sebelum
menggabungkan. Seorang maintainer mungkin menyarankan perubahan. Itu adalah bagian
yang normal dan kolaboratif dari prosesnya, bukan sebuah penolakan. Kami berupaya
untuk bersikap baik dan konstruktif dalam tinjauan, dan kami meminta hal yang sama
darimu.

> Pesan commit dan judul PR mengikuti [Conventional Commits](https://www.conventionalcommits.org/)
> dengan scope (`feat(talents): ...`, `fix(net): ...`). Setiap commit juga membawa
> body: setelah satu baris kosong, satu sampai empat kalimat sederhana yang
> menjelaskan apa yang berubah dan mengapa, dilipat di sekitar kolom 72. Judul saja
> tidak cukup.

<a id="localization"></a>

## Lokalisasi

World of ClaudeCraft hadir dalam banyak bahasa. Setiap string yang terlihat pemain
harus berupa kunci terjemahan, sementara kontributor fitur biasanya hanya
menambahkan sumber bahasa Inggrisnya.

- Semua teks yang berhadapan dengan pengguna adalah sebuah kunci `t()`. Tambahkan
  teks bahasa Inggris baru ke modul per domain yang sesuai di bawah
  [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) (elemen HUD baru masuk ke
  `hud_chrome.ts`), lalu render dengan `t('dotted.key', values)`. Bahasa Inggris
  saja justru tepat untuk sebuah PR fitur: maintainer mengisi locale lainnya saat
  rilis, jadi kamu tidak menyunting overlay `src/ui/i18n.locales/` dan tidak pernah
  meninggalkan placeholder bahasa Inggris atau `// TODO` di dalamnya. Pengecualian
  M16 adalah nilai bahasa Inggris baru yang panjang, yang juga membutuhkan lima
  pengisian non-Latin yang dijelaskan di
  [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).
- Angka, uang, tanggal, satuan, dan persentase melewati formatter (`formatNumber`,
  `formatMoney`, `formatDateTime`, `Intl`) alih-alih penyusunan string secara
  manual.
- Teks yang berhadapan dengan pemain yang dipancarkan dari `src/sim/` atau
  `server/`, yang tetap agnostik terhadap bahasa, harus dilokalisasi ulang di batas
  klien dalam perubahan yang sama. Tes penjaga
  `npx vitest run tests/localization_fixes.test.ts` menegakkan hal ini.
- Setelah menambahkan atau mengubah string apa pun, jalankan `npm run i18n:gen` dan
  commit bundle yang dihasilkan ulang dalam perubahan yang sama. Gate dan CI
  sama-sama membandingkan artefak yang di-commit dengan hasil regenerasi baru, jadi
  bundle yang basi akan menggagalkan build.

Jadi tambahkan string-mu dalam bahasa Inggris dan buka PR-nya; kamu tidak perlu
menerjemahkannya sendiri. Jika kamu ingin membantu dengan terjemahan, lihat bagian
berikutnya.

<a id="translating-the-game"></a>

## Menerjemahkan game

Ingin meningkatkan sebuah bahasa, atau membantu menghadirkan game ke bahasa yang
baru? Kamu tidak perlu menulis kode game apa pun untuk melakukannya:

1. Sebagian besar terjemahan yang dilihat pemain ada di berkas overlay per bahasa
   di bawah [`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) (satu per locale),
   yang mencerminkan kunci bahasa Inggris di
   [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/). Teks yang dipancarkan
   simulasi dan server diterjemahkan di `src/ui/sim_i18n.ts` dan
   `src/ui/server_i18n.ts`, teks talent di modul `talent_i18n`, dan dashboard admin
   punya kumpulannya sendiri di bawah `src/admin/i18n.locales/`.
2. Tingkatkan terjemahan yang ada, atau lengkapi yang terbaca janggal.
3. Jalankan `npm run i18n:gen`, commit bundle yang dihasilkan ulang bersama
   suntingan overlay-mu, lalu jalankan suite lokalisasi
   (`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`)
   dan buka sebuah PR. Pemeriksaan tipe saja tidak akan memberi tahu apakah ada
   kunci yang hilang, karena overlay memang sengaja dibuat jarang.

Untuk mengusulkan sebuah locale yang benar-benar baru, atau untuk mendiskusikan
nada dan terminologi, mulai sebuah thread di
[Discord](https://discord.com/invite/worldofclaudecraft) dan kami akan membantumu menyambungkannya.
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
- **Kerentanan keamanan.** Mohon jangan membuka isu publik. Laporkan secara privat
  dengan mengikuti [SECURITY.md](../../SECURITY.md), dan kami akan bekerja sama
  denganmu untuk perbaikan dan pengungkapannya.

## Mendapatkan bantuan

Tersangkut, atau hanya ingin menyapa? Bergabunglah dengan
[Discord komunitas](https://discord.com/invite/worldofclaudecraft). Tidak ada pertanyaan yang
terlalu kecil, dan kontributor baru selalu disambut.

## Lisensi

Dengan berkontribusi kode, kamu setuju bahwa kontribusi kodemu akan dilisensikan di
bawah [Lisensi MIT](../../LICENSE) proyek, lisensi yang sama yang mencakup proyek
ini.

Lisensi MIT berarti persis seperti yang tertulis: siapa pun boleh menggunakan,
memodifikasi, dan mendistribusikan ulang kodenya, secara komersial maupun tidak.
[Ketentuan Layanan](https://worldofclaudecraft.com/terms) kami mengatur game yang
kami hosting di worldofclaudecraft.com (akun, perilaku, item virtual) dan tidak
membatasi hak yang diberikan Lisensi MIT kepadamu atau siapa pun atas kode ini.
Nama dan branding "World of ClaudeCraft" serta "Levy Street" tidak dicakup oleh
Lisensi MIT.

Aset kreatif orisinal (rekaman suara, musik, seni, dan karya sejenis) adalah
pengecualiannya. Jika kamu menyumbangkan aset orisinal yang kamu buat sendiri, kamu
boleh tetap memegang hak ciptanya dan menyumbangkannya di bawah lisensi pilihanmu
(misalnya CC BY-NC 4.0), asalkan:

- lisensinya, jalur aset yang dicakupnya, dan atribusimu dicatat di tabel lisensi
  pada [CREDITS.md](../../CREDITS.md) sebagai bagian dari pull request yang sama,
  dan
- lisensi itu setidaknya menyertakan pemberian hak yang berlaku selamanya dan bebas
  royalti kepada Levy Street untuk menggunakan aset tersebut secara komersial di
  World of ClaudeCraft, termasuk rilis resmi dan toko dalam game.

Untuk aset yang tercantum di tabel CREDITS.md, lisensi yang tercatat itulah yang
berlaku, mengalahkan lisensi MIT bawaan proyek.

**Aset media tanpa entri di CREDITS.md tidak dilisensikan di bawah MIT.** Daftar
itu masih terus dilengkapi, jadi entri yang hilang berarti ketentuannya belum
tercatat, bukan berarti asetnya bebas diambil. Ini disengaja: hal itu mencegah
kontribusi yang belum terdaftar diberikan secara cuma-cuma. Untuk kode berlaku
sebaliknya, dan apa pun yang tidak dikecualikan di CREDITS.md adalah MIT.

Itulah tepatnya mengapa entri di daftar tersebut bukan sekadar administrasi
opsional. Jika kamu menyumbangkan sebuah aset tanpa baris di CREDITS.md, tidak ada
pihak di hilir yang bisa menggunakannya dan kami tidak punya catatan tentang apa
yang kamu berikan kepada kami. Isi kolom **Redistribution** dengan jujur juga. Itu
yang memberi tahu orang yang mem-fork proyek ini apakah mereka boleh meneruskan
asetmu, dan beberapa baris ditandai "No, permission required" justru karena mereka
tidak boleh.

---

Terima kasih telah berkontribusi ke World of ClaudeCraft. Kami tidak sabar untuk
melihat apa yang akan kamu bangun bersama kami.
