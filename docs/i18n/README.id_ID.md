<div align="center">

# World of ClaudeCraft

**Jalankan quest, bentuk grup, dan serbu dunia buatan tangan, gratis di browser Anda. Open source, web3, dan online sekarang juga.**

**Situs resmi: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.34.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.id_ID.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Čeština](README.cs_CZ.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · **Bahasa Indonesia** · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Main sekarang](https://worldofclaudecraft.com/) · [Hosting dunia Anda sendiri](#host-your-own-world-one-command) · [Latih sebuah agen](#train-an-agent-headless-rl) · [Web3](#web3) · [Berkontribusi](CONTRIBUTING.id_ID.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![Layar judul World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## Apa ini

World of ClaudeCraft adalah MMO era klasik yang lengkap dan bisa Anda mainkan sekarang juga di browser, Anda hosting sendiri dengan satu perintah, dan bahkan bisa melatih agen AI untuk memainkannya. Ini gratis, open source, dan live di [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Satu dunia bersama berjalan di tiga tempat, semuanya dari inti game yang sama:

- **server multiplayer otoritatif**, dunia hidup yang Anda mainkan di worldofclaudecraft.com, tempat akun yang didukung Postgres berbagi satu realm persisten,
- **dunia browser offline**, sebuah Sim single-player lokal yang Anda dapatkan dari server dev, berguna untuk pengembangan dan untuk membaca inti game dari ujung ke ujung,
- **env RL headless**, di mana Python menggerakkan game sungguhan melalui antarmuka Gym.

Seed yang sama, dunia yang sama, di mana saja. Sebagian besar dari yang Anda lihat masih digambar dari kode saat runtime, dan sisanya adalah kumpulan aset terkurasi yang dikirim bersama proyek, jadi sebuah fork langsung berjalan tanpa persiapan tambahan.

## Sorotan

- **Sembilan class klasik**, masing-masing dengan kit lengkap bergaya era klasik yang mendapatkan rank saat Anda naik level, ditambah **sistem talent** lengkap (tiga spec per class, total 27 spec).
- **Tiga zona dunia terbuka** dari level 1 hingga 20, lebih dari 90 quest, dan satu alur cerita terhubung tentang konspirasi Gravecaller.
- **Lima dungeon instance**, empat di antaranya raid elite lima pemain dan satu crypt solo, dengan penskalaan elite, mekanik bos AoE, loot arketipe class yang terkumpul menjadi tier set, dan **tier kesulitan Heroic** dengan reward lebih kaya, ditambah **world boss** dunia terbuka dan finale raid sepuluh pemain.
- **Dua delve yang dapat diskalakan**, mode grup kecil untuk satu atau dua pemain ditambah satu pendamping AI, dibangun ulang dari ruang acak setiap putaran di tier Normal dan Heroic.
- **PvP berperingkat** di dua peta arena: ladder 1v1 dan 2v2, mode 2v2 Fiesta yang lebih hidup, dan **Protect Yumi**, mode objektif 3v3 dan 5v5. Permainan berperingkat membayar Honor, yang membeli set gear khusus PvP yang tidak pernah melampaui loot dungeon di PvE.
- **The Vale Cup**, liga boarball yang dimainkan di stadionnya sendiri di selatan Eastbrook, dan **Card Duel**, permainan kartu satu lawan satu yang cepat dan diselenggarakan di kota.
- **Book of Deeds**: jurnal pencapaian berisi gelar kosmetik, bingkai lencana, dan Renown, dengan Chronicle per zona yang dijaga NPC Chronicler di dalam dunia serta papan peringkat sepanjang masa.
- **Ekonomi profesi yang dalam**: empat profesi pengumpulan memasok sepuluh kerajinan, dari memasak dan alkimia hingga jewelcrafting, weaponcrafting, dan enchanting, dengan alat bertingkat, workstation kota, kualitas masterwork, dan pesanan, semuanya memasok **World Market** yang digerakkan pemain dan layanan surat **Ravenpost**.
- **Multiplayer sungguhan**: party dan raid, guild, perdagangan, duel, hak tap, XP party-split, bisik, status away, dan **Dungeon Finder** dengan antrean peran dan daftar grup premade.
- **Ditulis dalam kode, bukan di editor 3D**: medan, air, cuaca, tata letak kota, bayangan real-time, dan efek dihasilkan saat runtime, dan model yang memang dikirim dibangun oleh pabrik prosedural dan pustaka aset terkurasi alih-alih dipahat dengan tangan.
- **Dilokalkan ke 22 locale** melalui pipeline deterministik dengan sim-emits-keys.
- **Wiki pendamping di `/wiki`**, dihasilkan langsung dari konten game yang hidup sehingga tidak bisa menyimpang dari dunia yang didokumentasikannya.
- **Aplikasi native di setiap platform**: installer desktop bertanda tangan untuk Windows, Linux, dan macOS dengan pembaruan otomatis dan pencerminan achievement Steam yang opsional, ditambah build iOS dan Android, semuanya berbagi client browser dan dunia online yang sama.
- **Menyesuaikan dengan mesin yang Anda punya**: preset grafis dan governor frame rate otomatis menukar kekayaan visual demi kelancaran, dan tunduk pada aturan keadilan yang mencegahnya menyembunyikan sesuatu yang direspons pemain.
- **Lingkungan RL headless** dengan binding Gymnasium, pembentukan reward, dan mode benchmark.
- **Utilitas $WOC, sepenuhnya opsional**: tautkan dompet Solana untuk gaya holder, Daily Rewards, dan opsi pembayaran berdiskon di toko kosmetik. Game tetap gratis dimainkan dan non-custodial.
- **Season 1 Armory**: kumpulkan skin senjata kosmetik melalui WOC Store, menggunakan Claudium yang dibeli dengan fiat, SOL, USDC, atau $WOC. Kosmetik tidak pernah memberikan kekuatan combat.

## Tangkapan layar

![Alun-alun kota Eastbrook, api unggun, dan para pemberi quest](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Senja di api unggun Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Senja di api unggun Eastbrook* | ![Tarikan elite di the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Tarikan elite berkilau obor di the Hollow Crypt* |
| ![Mayat gelisah di kapel reruntuhan](../../docs/screenshots/restless-dead.jpg)<br>*Mayat gelisah di kapel reruntuhan* | ![Perkelahian dengan Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*Kalah jumlah di kamp bandit* |
| ![Old Greyjaw diburu di jalan utara](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, sang rare spawn, dikejar di jalan utara* | ![UI pedagang dan tas](../../docs/screenshots/vendor-and-bags.jpg)<br>*Melengkapi gear di tempat Trader Wilkes, dengan pedagang dan tas terbuka* |
| ![Moongate di pantai Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Para drowned memanjat naik di moongate Glimmermere* | ![Ysolei di altar the Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest dan altar the Drowned Temple* |

Cuaca didorong oleh bioma dan hanya render, jadi tidak pernah menyentuh sim deterministik:

| | | |
|:---:|:---:|:---:|
| ![Langit cerah di atas Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Cerah di atas the Vale* | ![Hujan di atas Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Hujan di atas Mirefen Marsh* | ![Salju di Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Salju di Thornpeak Heights* |

## Mainkan

Mainkan di browser Anda di [worldofclaudecraft.com](https://worldofclaudecraft.com/), atau pasang aplikasi native untuk Windows, Linux, macOS, iOS, atau Android. Setiap client terhubung ke dunia online yang sama.

### Online, dengan pemain lain

Buat akun, buat karakter, dan masuk ke dunia yang hidup. Untuk menjalankan sendiri stack client/server yang sama, lihat [Hosting dunia Anda sendiri](#host-your-own-world-one-command) di bawah.

### Offline, di server dev

Mode offline adalah dunia single-player lokal tanpa akun dan tanpa otoritas server, jadi mode ini hanya dikirim dalam build pengembangan. Jalankan server dev dan mode itu muncul di pemilih mode:

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

Beri nama karakter Anda, pilih salah satu dari sembilan class, dan Anda mulai di **Eastbrook Vale** (level 1-7), sebuah kota pasar yang dikelilingi hub: jalur serigala di utara, padang babi hutan di timur, hutan Sableweb di barat, Mirror Lake di barat laut, galian tembaga yang dipenuhi burrower di barat daya, dan kapel reruntuhan berisi mayat gelisah di timur laut, dengan kamp bandit Gorrak di tenggara. Jalan utara mendaki celah gunung menuju **Mirefen Marsh** (6-13, hub Fenbridge) dan terus naik ke **Thornpeak Heights** (13-20, hub Highwatch). Seed dunia ditetapkan di `src/sim/world_seed.ts`, jadi ini tempat yang sama di setiap kunjungan.

### Aplikasi desktop untuk Windows, Linux, dan macOS

World of ClaudeCraft dikirim sebagai aplikasi desktop penuh untuk ketiga platform desktop utama: installer Windows bertanda tangan, paket AppImage dan deb untuk Linux, serta build macOS universal yang ditandatangani dan dinotarisasi. Semuanya memakai client game dan dunia online yang sama dengan browser, dengan pengemasan native dan pembaruan otomatis.

Masuk online hanya lewat Discord dan email, persis seperti alur web: email/password login di dalam aplikasi, dan "Continue with Discord" membuka browser default Anda pada halaman `/desktop-login`, yang mengembalikan kode sekali pakai ke aplikasi melalui deep link `worldofclaudecraft://` yang lalu ditukar aplikasi menjadi token sesi World of ClaudeCraft biasa.

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

Arahkan shell ke API lain dengan `VITE_DESKTOP_API_ORIGIN`, misalnya server lokal atau host staging:

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

Timpa origin API produksi untuk build staging dengan `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` (sebuah nilai BUILD-time: nilai itu dipanggang ke dalam bundel dan dicap ke aplikasi yang dikemas, dan build yang sudah terpasang mengabaikannya sebagai env var runtime). Steam adalah kanal distribusi (bundel Electron yang sama, diunggah lewat SteamPipe), dan pemain desktop dapat menautkan akun Steam untuk mencerminkan deed yang mereka raih menjadi achievement Steam; proses masuk sendiri tetap email dan Discord. Runbook rilis lengkap (penandatanganan, notarisasi, publikasi pembaruan otomatis, depot SteamPipe, deploy server) ada di `docs/desktop-release.md`. iOS dan Android dikirim melalui Capacitor, dengan runbook-nya sendiri di `docs/mobile-store-release.md`.

<a id="host-your-own-world-one-command"></a>

## Hosting dunia Anda sendiri (satu perintah)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Untuk **hosting jarak jauh**, letakkan compose stack di VPS mana pun, atur `POSTGRES_PASSWORD` sungguhan di environment, dan letakkan reverse proxy TLS di depan port 8787. Caddy membuat ini hanya beberapa baris; WebSocket di-proxy secara otomatis dan client otomatis memilih `wss://` di halaman https. Endpoint autentikasi dibatasi rate-nya, password di-hash dengan scrypt, dan sesi login kedaluwarsa. Jangan pernah mengatur `ALLOW_DEV_COMMANDS=1` di produksi, karena itu mengaktifkan seluruh set cheat `/dev`: cheat level dan teleport yang dipakai bot pengujian, ditambah pemberian item, spawn mob, teleport instance, dan GUI perintah dev di dalam game. [DEPLOY.md](../../DEPLOY.md) adalah panduan produksi lengkap, termasuk konfigurasi reverse proxy yang menjauhkan endpoint health dan metrics dari tepi publik.

<a id="develop-online-with-hot-reload"></a>

### Kembangkan online dengan hot reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api, /admin/api, and /ws)
```

Buka http://localhost:5173, pilih **Play Online**, buat akun, buat karakter, dan Enter World. Layar pemilihan karakter menampilkan berita rilis terbaru di panel News & Updates, dengan lencana NEW untuk apa pun yang belum Anda lihat. Buka tab kedua dan login lagi untuk melihat satu sama lain di kota. `Enter` membuka chat. Wiki pemain adalah Guide di dalam repo, disajikan di http://localhost:5173/wiki dan di `/wiki` pada produksi; kontennya dihasilkan dari data game saat ini oleh `npm run wiki:content`.

Apa yang persisten dan bagaimana server tetap memegang kendali:

- **Akun**: password yang di-hash dengan scrypt dan bearer token yang kedaluwarsa.
- **Karakter**: hingga 10 per akun per realm; level, gear, tas, brankas bank, quest, talent, profesi, kemajuan PvP dan deed, posisi, dan uang persisten sebagai JSONB di Postgres, disimpan pada timer, saat logout, dan saat server dimatikan. Nama unik per realm dan bergaya klasik.
- **Server bersifat otoritatif**: client melakukan streaming intent gerakan dan perintah pada 20 Hz; server menjalankan satu `Sim` bersama dan mengembalikan snapshot lingkup-interest ditambah event per-pemain. Setiap lemparan combat, drop loot, kredit quest, dan transaksi pedagang diselesaikan di sisi server. Client adalah sebuah renderer.

<a id="train-an-agent-headless-rl"></a>

## Latih sebuah agen (RL headless)

Inti deterministik yang sama berjalan sebagai lingkungan [Gymnasium](https://gymnasium.farama.org/), sehingga sebuah agen belajar melawan game sungguhan, bukan implementasi ulangnya. Server env (`headless/env_server.ts`) membungkus satu `Sim` dan berbicara JSON yang dipisahkan baris baru melalui stdio; binding Python di `python/` menjalankannya sebagai subprocess dan mengekspos loop `reset` / `step` / `close` yang biasa.

```bash
npm run build:env    # bundle the env server to dist-env/env_server.cjs
npm run env          # run it directly (NDJSON on stdio)
npm run bench        # in-process throughput benchmark (no IPC)

# drive it from Python
pip install gymnasium numpy
python python/example_random_agent.py
```

```python
from wow_env import WoWClassicEnv

env = WoWClassicEnv(player_class="warrior")   # any of the nine classes
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **Ruang observasi dan aksi berasal dari konten.** Query keduanya dari balasan `info` env saat startup alih-alih meng-hardcode; keduanya tumbuh bersama game. Ruang aksi adalah `Discrete` yang mencakup gerakan, target, serang, kit ability lengkap, interaksi, dan makan/minum; observasinya adalah `Box` yang mencakup diri, ability, target, mob terdekat, interaktif terdekat, dan kemajuan quest.
- **Reward** adalah jumlah berbobot dari delta penghitung per-tick (XP, damage yang diberikan dan diterima, kill, kematian, kemajuan quest, naik level), dapat disetel per reset. Setiap `step` menerapkan satu aksi dan memajukan lima sim tick secara default, jadi kira-kira empat keputusan per detik tersimulasi.
- **Deterministik berdasarkan konstruksi.** Tanpa wall clock, tanpa `Math.random`. Beri seed pada reset dan episode akan diputar ulang persis sama.

Protokol dan binding didokumentasikan di `headless/CLAUDE.md` dan `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft adalah web3-native di sekitar **$WOC**, token komunitas kami di Solana. Hubungkan dompet Solana, tautkan ke akun Anda dengan satu tanda tangan (non-custodial, tanpa transaksi untuk disetujui), dan saldo $WOC read-only Anda muncul di HUD bersama lencana tier holder kosmetik.

$WOC juga punya utilitas opsional di dalam game yang hidup:

- **WOC Store**: beli Claudium, mata uang kosmetik satu arah, dengan fiat, SOL, USDC, atau $WOC. Jalur pembayaran $WOC diberi diskon dibanding yang lain.
- **Season 1 Armory**: belanjakan Claudium untuk koleksi skin senjata kosmetik. Pembelian di toko tidak menambah stat atau kekuatan combat.
- **Daily Rewards**: holder terverifikasi yang memenuhi syarat dapat mengumpulkan poin melalui putaran harian dan tugas bergilir, lalu bersaing memperebutkan bagian dari kolam hadiah harian.

Tidak satu pun dari ini diperlukan untuk bermain. Menautkan dompet bersifat opsional dan non-custodial, tidak ada pay-to-win, dan seluruh game berjalan baik tanpa pernah menghubungkan dompet.

**Alamat kontrak $WOC (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Selengkapnya tentang token di [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Tur keliling dunia

### Sembilan class

Setiap class berjalan pada mekanik MMO era klasik yang diimplementasikan dari prinsip dasar, dan mempelajari mantra ber-rank sepanjang level 1-20, dengan ability khas seperti Low Blow, Early Grave, Skyfall, Urgent Prayer, dan Ancestral Strike yang terbuka di paruh belakang pendakian.

- **Warrior**: rage, Iron Bellow, Onrush, Quaking Blow, Maiming Strike, Gaping Wounds (bleed yang menempel pada pukulan Anda), Widening Arc, Hobbling Cut, Blood Toll, Redhand (proc dodge).
- **Paladin**: Oathbrand yang dilepaskan oleh Verdict, Mending Light, Steadfast Aura, Oath of Iron, Ward of Faith (absorb), Sundering Gavel (stun), Last Rite.
- **Hunter**: serangan otomatis jarak jauh (8-35 yd dengan dead zone bergaya klasik), Gutting Strike, Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Counterfang, Fettering Slash, dan pet yang dapat dijinakkan dari level 10.
- **Rogue**: energy dan combo point, Wicked Slash, Dirt Nap, Craven Thrust (dari belakang, dagger), Eye Jab, Ghostfoot, Cutthroat Tempo, Swift Heels.
- **Priest**: Smite, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding (absorb), Lingering Grace (HoT), Mindfracture.
- **Shaman**: Arc Bolt, Stonebound Weapon (imbue), Mending Waters, Earthen Jolt, Thunder Ward (thorns), Cinder Jolt.
- **Mage**: Cinderbolt, Hoarfrost Mantle, Aether Insight, Rimelance, Waterbind, Cinderfall, Aether Darts (channeled), Bewitch, Icebind, satu elemental air yang dipanggil, dan Chronomancy, spec healing sihir waktu.
- **Warlock**: Gloom Bolt, Fiendhide, Burning Pact, Blackrot, Hard Bargain, Hex of Anguish, Consume, dan tujuh demon yang dapat dipanggil dari Emberkin hingga Wraithborn.
- **Druid**: Wildbolt, Wildmend, Wildward, Lunar Tempest, Wildbloom, Briarguard, Gripping Roots, dan berubah wujud menjadi Wolf Form di level 5, Bruin Form di 8, dan Moonwing Form di 10.

Heal dan buff mengenai anggota party, healing bisa crit, dan absorb shield menyerap damage sebelum health. Belanjakan poin di **tiga talent spec per class** (Battlecraft/Bloodrush/Ironguard, Moongrove/Wildfang/Groveheart, dan seterusnya); alokasi divalidasi server dan dapat diekspor sebagai string build.

### Dungeon

Alur cerita Gravecaller berjalan melalui tiga instance elite lima pemain, instance keempat menunggu di balik sebuah moongate dengan lore drowned-nya sendiri, dan satu crypt solo terletak di samping untuk para penjelajah.

- **The Hollow Crypt** (5 pemain) di bawah the Fallen Chapel: trash elite berpasangan, miniboss Sexton Marrow, dan Morthen the Gravecaller dengan AoE bayangannya yang berulang. Pintu crypt menteleportasi party Anda ke salinan instance pribadi yang reset begitu instance itu kosong.
- **The Sunken Bastion** (5 pemain, sekitar level 13, tenggara Mirefen): Vael the Fogbinder memanggil gelombang Drowned Thralls seiring pertarungan berlarut.
- **Gravewyrm Sanctum** (5 pemain, level 20, di bawah Thornpeak): tiga ruang boneguard dan scaleguard elite, Korgath the Bound, Grand Necromancer Velkhar, dan Korzul the Gravewyrm, tempat senjata epic jatuh.
- **The Drowned Temple** (5 pemain) melalui moongate Glimmermere: instance pucat ungu-bulan yang mengarah ke Choirmother Selthe lalu Ysolei, Avatar of the Drowned Moon, yang pasang surut bulannya dan Moonspawn yang dipanggilnya menghukum grup yang diam di tempat.
- **The Abandoned Crypt** (solo) di Thornpeak: penyelaman keystone-dan-diari yang tenang untuk satu orang, yang jejaknya membuka pintu kerajaan menuju **Nythraxis, Scourge of Thornpeak**, finale raid sepuluh pemain yang diperjuangkan melintasi tiga soul wardstone.

Setiap instance juga berjalan pada **Heroic**: musuh berlevel lebih tinggi, mekanik yang lebih tajam, serta loot dan mata uang pedagangnya sendiri. Rantai quest menjelang itu bisa dilakukan solo, jadi cerita tidak pernah terkunci di balik keharusan menemukan grup. Raid lima-bot otomatis kami (warrior, paladin, priest, mage, hunter dengan focus-fire dan AI healer) membersihkan the Hollow Crypt dalam sekitar lima menit (`node scripts/crypt_raid.mjs`, membutuhkan `ALLOW_DEV_COMMANDS=1`).

### Delve

Delve adalah mode grup kecil yang terpisah dan dapat diskalakan untuk satu atau dua pemain, dibangun ulang dari ruang acak di setiap putaran dan berakhir pada peti reliquary terkunci yang dibuka lewat minigame membobol kunci alih-alih lemparan loot. **The Collapsed Reliquary** (level 7 ke atas) berakhir di Deacon Varric, dengan seorang pendamping AI, Tessa, bertarung di sisi Anda jika Anda pergi sendiri. **The Drowned Litany** (level 12 ke atas) mengikuti jejak itu ke kuil yang terendam di tepi Mirefen Marsh. Sebuah papan delve menentukan tier-nya: Heroic menaikkan level musuh dan menambah afiks acak untuk reward yang lebih kaya.

### PvP berperingkat (the Ashen Coliseum)

Tekan `G` atau tombol arena untuk antre. Matchmaking menteleportasi para petarung ke lubang pribadi, hitung mundur singkat menyembuhkan dan mereset semua orang untuk awal yang adil, dan pertarungan berakhir saat satu pihak menyerah. Tidak ada yang mati, dan Anda kembali persis di tempat Anda antre. Protect Yumi diperjuangkan di labirinnya sendiri, bukan di lubang Coliseum.

- **Ladder berperingkat 1v1 dan 2v2**, masing-masing dengan rating gaya Elo yang persisten dan papan peringkat sepanjang masa.
- **2v2 Fiesta**, mode party yang lebih hidup di mana tim berlomba menuju target takedown sementara pengambilan augment menjatuhkan power dan ring penutup memaksa pertarungan menyatu.
- **Protect Yumi**, mode objektif 3v3 dan 5v5 tanpa peringkat yang diperjuangkan di labirin: setiap tim menjaga seekor familiar kucing sambil berusaha menjatuhkan milik pihak lawan, sehingga pengawalan dan pick lebih penting daripada jumlah kill mentah.

Kemenangan berperingkat dan takedown Fiesta membayar **Honor**, yang ditukar quartermaster di kota dengan satu set gear Warfare. Warfare adalah stat khusus PvP, jadi setnya memenangkan duel tanpa pernah melampaui loot dungeon setier di PvE.

### Bermain bersama

- **Dungeon Finder**: buka dengan `Shift+I` untuk menelusuri dungeon dan raid, memeriksa bos dan loot, bergabung ke antrean peran tank/healer/DPS otomatis, atau membuat daftar grup premade. Grup yang dibentuk Finder tetap berjalan bersama menuju pintu masuk.
- **Party** hingga 5, diubah menjadi raid 10 pemain berisi dua grup begitu penuh: klik kanan seorang pemain dan Invite to Party. Anggota berbagi hak tap dan kredit quest, membagi XP dengan bonus grup era klasik, dan muncul sebagai titik di minimap. `/p` untuk chat party, `/roll` untuk menyelesaikan loot.
- **Perdagangan**: klik kanan dan Trade. Kedua pihak menyiapkan item dan uang, keduanya harus menerima, dan pertukaran bersifat atomik serta divalidasi server. Item quest tidak bisa diperdagangkan, dan menjauh akan membatalkan.
- **Duel**: klik kanan dan Challenge to a Duel. Hitung mundur 3 detik, lalu bertarung hingga satu pihak mencapai 1 hp; pemenang diumumkan ke seluruh zona dan lari 60 yard menjauh berarti menyerah.
- **Hak tap dan status away**: pemain pertama yang merusak sebuah mob memiliki loot, XP, dan kredit quest-nya; `/afk` dan `/dnd` menandai Anda away dengan balasan otomatis ke bisikan.

### Dunia dan sistem

- **Profesi** (`Shift+P`): empat profesi pengumpulan (menambang, menebang, herbalisme, memancing) memasok sepuluh kerajinan, dari memasak dan alkimia hingga weaponcrafting, jewelcrafting, dan enchanting. Alat pengumpulan hadir dalam tier yang menentukan node mana yang bisa Anda kerjakan, crafting berjalan di workstation kota dengan peluang kualitas masterwork yang membawa tanda pembuatnya, dan ada sistem arketipe untuk ditemukan saat Anda menspesialisasi.
- **The World Market**: rumah lelang yang digerakkan pemain untuk gear, material, dan konsumabel, dapat ditelusuri dari kota-kota hub.
- **Surat Ravenpost**: kirim item dan koin ke karakter lain, dengan lampiran disimpan aman sampai diklaim.
- **Guild**: piagam, roster, rank, dan chat guild.
- **The Guide**: wiki di dalam situs yang dapat dicari di `/wiki`, mencakup class, makhluk, zona, dan deed, dihasilkan langsung dari konten game yang hidup sehingga tidak bisa menyimpang dari dunia yang didokumentasikannya.
- **The Vale Cup dan Card Duel**: boarball di stadion Sowfield selatan Eastbrook, dalam format dari 1v1 hingga 5v5, dan permainan kartu satu lawan satu yang cepat, dipandu Card Master di kota.
- **Daily Rewards**: holder $WOC terverifikasi dapat mengumpulkan poin papan peringkat dari putaran harian dan tugas bergilir, dengan pembayaran otomatis dari kolam hadiah harian.
- **WOC Store dan Season 1 Armory**: beli Claudium dengan fiat, SOL, USDC, atau $WOC, lalu belanjakan untuk skin senjata yang murni kosmetik.
- **Makan dan minum**: duduk untuk memulihkan, terganggu oleh damage atau berdiri, dan ya, Anda bisa makan dan minum sekaligus.
- **Pedagang** yang membeli makanan dan air serta menjual gear putih jujur, dengan koin ditampilkan dalam gold, silver, dan copper.
- **Bank pribadi** (the Gilded Strongbox): bursar di setiap kota hub menyimpan satu brankas per karakter, dari 24 slot hingga 96 dengan perluasan yang dibeli koin, ditambah slot bonus yang didapat secara online untuk email terverifikasi, akun tertaut, dan referal.
- **The Book of Deeds**: jurnal pencapaian (default `Shift+Z`) berisi quest, kill, clear, dan kesenangan, yang membayar gelar kosmetik untuk Anda kenakan di nameplate, di chat, dan di papan, ditambah pelacak HUD untuk deed yang sedang Anda kejar, Chronicle per zona yang dijaga NPC Chronicler, dan papan peringkat Renown sepanjang masa; daftar publiknya ada di `/wiki/deeds`.
- **AI mob**: berkeliaran, aggro kedekatan berdasarkan selisih level, tarikan sosial, kejar, leash dan reset, loot mayat, dan respawn, dengan rare spawn (Old Greyjaw) pada timer panjang.
- **Spot memancing** dengan tabel loot sendiri dan tangkapan langka.
- **Skin kosmetik** yang dilempar pada kelangkaan uncommon, rare, dan epic, murni untuk tampilan.
- **Kematian dan pemulihan**: lepaskan roh Anda ke kuburan, terima damage jatuh, dan melambat saat berenang.
- **Cuaca bioma**: cerah di the Vale, hujan di the Marsh, salju di the Peaks, saling memudar saat Anda berpindah antar zona.

### Kontrol (tata letak klasik)

| Input | Aksi |
|---|---|
| `W` / `S` | lari / mundur. `A`/`D` berbelok (strafe dengan tombol kanan mouse ditahan), `Q`/`E` strafe |
| seret-kanan / seret-kiri | mouselook / kamera orbit. Roda untuk zoom, `Space` untuk lompat |
| `Tab` | berganti antar musuh terdekat. klik kiri untuk menargetkan, klik kanan untuk menyerang, looting, atau bicara |
| `1`-`9`, `0`, `-`, `=` | action bar |
| `F` | interaksi (looting mayat, mengambil objek, bicara) |
| `C` `P` `L` `M` `B` `N` `T` | karakter, spellbook, log quest, peta dunia, tas, talent, crafting |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | arena, teman dan guild, papan peringkat, kalender, Vale Cup, Dungeon Finder, profesi, deed |
| `Z` / `X` | sarungkan atau hunus senjata Anda, roda emote |
| `V` / `R` / `Esc` | nameplate, autorun, tutup jendela teratas (atau buka menu game) |

Setiap binding dapat dipetakan ulang di panel keybind. Kontrol sentuh (sebuah stik gerakan, seret kamera, dan tombol aksi di layar) muncul otomatis di perangkat seluler.

## Arsitektur (satu sim, tiga host)

Tiga ide menyatukan proyek ini:

- **Satu sim, tiga host.** Kode `src/sim/` yang sama menjalankan dunia browser offline, server online, dan env RL. Perilaku harus identik di mana saja, dan tes ada untuk menjaganya tetap demikian.
- **`IWorld` adalah satu-satunya seam.** `IWorld` didefinisikan sebagai antarmuka facet per domain di bawah `src/world_api/`, diagregasi oleh `src/world_api.ts`. `Sim` offline memenuhinya secara struktural dan `ClientWorld` online mengimplementasikannya dengan mencerminkan snapshot server. Renderer dan HUD hanya berbicara ke `IWorld`, tidak pernah ke dunia konkret, jadi fitur baru memperluas facet yang cocok terlebih dahulu lalu kedua dunia.
- **Server bersifat otoritatif.** Client mengirim intent; server memutuskan hasil. Client tidak pernah menyelesaikan combat, loot, atau ekonomi sendiri.

Sim adalah tick tetap 20 Hz (`DT = 1/20`), semua keacakan mengalir melalui satu `Rng` ber-seed, dan `src/sim/` tidak membawa import DOM, browser, atau Three.js sama sekali. Itulah yang memungkinkan kode yang sama dibundel menjadi server env Node, loop game otoritatif, dan tab browser tanpa mengubah satu baris pun.

### Tata letak proyek

| Path | Apa itu |
|---|---|
| `src/sim/` | Inti game deterministik, sumber kebenaran. Tanpa dependensi DOM atau Three. |
| `src/sim/content/` | Data sebagai kode: sembilan class, ability, zona, dungeon, delve, item, resep, enchant, talent, profesi, deed. |
| `src/world_api.ts` + `src/world_api/` | `IWorld`, seam yang menjadi sandaran renderer dan HUD: satu antarmuka facet per domain. |
| `src/` (sisanya) | Renderer Three.js, HUD + style, input/audio, cermin online, serta SPA admin, guide, dan editor. |
| `server/` | Server otoritatif: HTTP dan WS, loop dunia, Postgres, auth, sosial, moderasi. |
| `server/http/` | Pipeline request REST: router tabel, middleware, dan definisi rute per domain. |
| `headless/` + `python/` | Server env RL (`env_server.ts`) dan binding Python Gym. |
| `bot/` | Bot Discord (peran, relay, feed aktivitas). |
| `electron/`, `android/`, `ios/` | Shell desktop (Steam) dan mobile native. |
| `tests/` | Suite Vitest. |
| `scripts/` | Perkakas build, aset, i18n, SFX, screenshot, dan E2E browser. |
| `deploy/` · `mediawiki/` | Aset first-boot produksi dan kontainer wiki pemain. |
| `public/` · `docs/` | Aset statis (dideploy apa adanya ke situs) dan dokumen desain. |

Semua ini bukan sistem kepercayaan: `tests/architecture.test.ts` memindai setiap file sim untuk
import terlarang, global DOM, atau panggilan jam atau `Math.random` yang nyasar, dan
`tests/world_api_parity.test.ts` menyematkan seam agar kedua dunia tidak bisa menyimpang.

Sebagian besar direktori membawa `CLAUDE.md` sendiri dengan konvensi lokal, dan kumpulan lengkap
invariant proyek ada di [`CLAUDE.md`](../../CLAUDE.md) root. Kontributor agen mulai
di sana, lalu mengambil entry point runtime-nya: [`AGENTS.md`](../../AGENTS.md) ditambah
[panduan operator Codex](../codex.md) untuk Codex, [`GEMINI.md`](../../GEMINI.md) untuk Gemini. Semuanya
bermuara pada arsitektur kanonik yang sama.

## Dibangun seperti yang klasik

Combat, leveling, dan threat semuanya berjalan pada aturan era klasik yang autentik: rage dan energy, tabel hit dan dodge, mitigasi armor, kurva XP sungguhan, swing timer, dan global cooldown. Rasanya seperti yang Anda ingat alih-alih sekadar mendekatinya. Angka pastinya ada di `src/sim/` jika Anda ingin membacanya.

Dunia ini ditulis dalam kode alih-alih di editor 3D, dan itulah yang membuatnya tetap kecil,
deterministik, dan mudah di-fork:

- Medan, air, cuaca, langit, tata letak kota, bayangan real-time, dan efek combat dihasilkan saat runtime dari data sim itu sendiri.
- Model yang memang dikirim dibangun dengan cara yang sama: pabrik prosedural di bawah `scripts/assets/` mengekspor GLB deterministik melalui pipeline image-to-GLB proyek ini, bersama pustaka terkurasi berisi kit model CC0. Keluarga makhluk dan karakter yang ber-rig membawa animasi jalan, serang, cast, duduk, dan kematian lengkap.
- Ikon adalah pelukis berlapis yang menyusun seni untuk apa pun yang tidak punya file bawaan, jadi tidak ada yang pernah kehilangan ikon, dengan seni lukis terkurasi dilapiskan di atasnya untuk ability, item, dan deed.
- HUD klasik lengkap (unit frame, action bar, tooltip, log quest, peta dunia, minimap, floating combat text, Book of Deeds), efek suara spasial dan antarmuka yang disampel, serta soundtrack yang dikomposisi secara prosedural di dalam repo dan dikirim sebagai remaster ter-stream yang saling memudar antara zona, kota, dungeon, dan combat.

Setiap aset yang dikirim dan lisensinya dicatat di [CREDITS.md](../../CREDITS.md), dan dependensi
pihak ketiga yang dibundel membawa pemberitahuannya di [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Pengembangan

Selain client game, build menghasilkan dasbor operator, editor dunia di
`/editor`, dan Guide publik di `/wiki`, semuanya disajikan dari server dev yang sama.

Setiap jalur FFmpeg yang dijalankan gate dan tes audio menyelesaikan paket npm
`ffmpeg-static`/`ffprobe-static` yang dibundel, jadi kontribusi biasa tidak butuh instalasi
FFmpeg sistem. Jalur yang mengukur konformansi (`npm run sfx:check`, tes audio,
validasi ekspor Studio) mengikat langsung ke biner statis itu, tanpa fallback `PATH`:
jalankan ulang `npm ci` jika instalasi yang melewati skrip membuatnya hilang. Spawn pemutaran dan
encode Studio serta preflight `npm run gate` menyelesaikannya lewat `scripts/sfx/ffmpeg_paths.mjs`,
yang memang jatuh kembali ke `PATH`. Beberapa skrip generator audio mandiri (misalnya
`scripts/gen_ui_sfx.mjs`) masih memakai `ffmpeg` dari `PATH` secara default.

```bash
npm test                        # vitest: formulas, combat, AI, quests, all 9 classes, parties, duels, trades, dungeons
npm run gate                    # complete CI-equivalent contribution gate
npm run build                   # production web build
npm run sfx:studio              # local SFX authoring, runtime mix, and production export
node scripts/smoke_browser.mjs  # warrior end-to-end (needs npm run dev)
node scripts/smoke_mage.mjs     # mage: casting, polymorph, conjure and drink, death and release
node scripts/visual_tour.mjs    # screenshot tour of the zone and UI into tmp/
node scripts/tour_temple.mjs    # screenshot tour of the Glimmermere and Drowned Temple into tmp/
node scripts/mp_integration.mjs # API, WS, and persistence checks (server running)
node scripts/social_e2e.mjs     # trade and duel over the wire (ALLOW_DEV_COMMANDS=1)
node scripts/arena_visual.mjs   # two clients queue and fight a ranked 1v1
node scripts/crypt_raid.mjs     # five bots clear the Hollow Crypt (ALLOW_DEV_COMMANDS=1)
```

Tes logika dan unit menggunakan Vitest. Saat beriterasi, jalankan satu file: `npx vitest run tests/sim.test.ts`. Perubahan antarmuka juga punya suite browser sungguhan yang bersifat opt-in, mencakup aksesibilitas, navigasi keyboard, dan target sentuh: `npm run test:browser`. Skrip screenshot dan smoke menggerakkan browser sungguhan melalui `puppeteer-core` dan membutuhkan `npm run dev` berjalan; skrip tingkat wire (`mp_integration.mjs`, `social_e2e.mjs`, `crypt_raid.mjs`) berbicara langsung ke server dan membutuhkan `npm run server` sebagai gantinya. Agen browser dapat menggerakkan gerakan melalui `window.__game.controller` alih-alih mensimulasikan tombol yang ditahan, misalnya `controller.move({ forward: true }, facingRadians)` atau flag ringkas seperti `{ f: 1, sr: 1 }`.

Pemeriksaan berjalan berlapis, dijelaskan di [docs/qa-gate.md](../qa-gate.md): arahkan clone Anda ke
hook bersama dengan `git config core.hooksPath .githooks` dan sebuah lantai cepat berjalan sebelum
apa pun meninggalkan mesin Anda.

Untuk perintah server lihat [Kembangkan online](#develop-online-with-hot-reload) di atas,
[CONTRIBUTING.id_ID.md](CONTRIBUTING.id_ID.md) untuk alur kerja kontribusi,
[tutorial SFX Studio](../sfx-studio-tutorial.md) untuk penulisan suara dan
ekspor artefak, [DEPLOY.md](../../DEPLOY.md) untuk produksi, dan
[CREDITS.md](../../CREDITS.md) untuk lisensi aset.

<a id="localization"></a>

## Lokalisasi

Setiap string yang terlihat pemain diselesaikan melalui `t()`, dan game ini dikirimkan dalam **22 locale** (Inggris, dua Spanyol, dua Prancis, Inggris Kanada, Italia, Jerman, Tionghoa Sederhana dan Tradisional, Korea, Jepang, Portugis Brasil, Rusia, Ceko, Belanda, Polandia, Indonesia, Turki, Swedia, Vietnam, dan Denmark). Sim dan server tetap agnostik bahasa: keduanya memancarkan key stabil atau bahasa Inggris yang dilokalkan ulang oleh client di batas, yang menjaga determinisme tetap utuh. Kontributor hanya menambahkan bahasa Inggris; pengelola mengisi locale lainnya secara batch sebelum setiap rilis. Alur kerjanya didokumentasikan di `docs/i18n-scaling/translation-workflow.md`.

## Berkontribusi

Kontribusi dalam segala bentuk disambut: kode, terjemahan, laporan bug, dan dokumentasi. Mulai dengan [CONTRIBUTING.id_ID.md](CONTRIBUTING.id_ID.md) untuk penyiapan, baca [Kode Etik](../../CODE_OF_CONDUCT.md), dan periksa [SECURITY.md](../../SECURITY.md) sebelum melaporkan kerentanan. Baru di sini? Cari issue berlabel [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), buka sebuah [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose), atau sapa kami di [Discord](https://discord.com/invite/worldofclaudecraft).

Pengembangan aktif berjalan di branch `release/vX.Y.Z` terbaru. Cari tahu branch itu alih-alih menebaknya, lalu buat branch darinya dan targetkan branch itu dengan pull request Anda. Jangan pernah membuat branch dari atau menargetkan `main`, yang hanya menerima sebuah branch rilis ketika versi tersebut dikirim. [CONTRIBUTING.md](CONTRIBUTING.id_ID.md) memuat perintah satu baris yang menemukan branch rilis saat ini.

## Lisensi

**Kodenya [berlisensi MIT](../../LICENSE), jadi fork, remix, dan hosting dunia Anda sendiri.** Itulah inti seluruhnya, dan tidak ada hal lain di halaman ini atau di situs web kami yang menariknya kembali.

Tiga hal dilisensikan secara terpisah, jadi tiga puluh detik untuk tahu mana yang mana itu sepadan:

| Apa | Lisensi | Boleh didistribusikan ulang? |
|---|---|---|
| **Kode sumber**, artinya semuanya kecuali aset media yang dikecualikan di bawah | [MIT](../../LICENSE) | Ya. Termasuk secara komersial. |
| **Aset media**: model, tekstur, HDRI, ikon, suara, font (sebagian besar di bawah `public/`) | Per aset, dicatat di [CREDITS.md](../../CREDITS.md) | Sebagian besar ya (kebanyakan CC0). Sebagian tidak, lihat di bawah. |
| **Nama dan branding**: "World of ClaudeCraft", "Levy Street", logo-logonya | Tidak dilisensikan | Tidak. |

**Fork dan hosting dunia Anda sendiri. Itu berhasil, dan asetnya tidak menghalangi Anda.** Sebagian besar yang Anda lihat adalah CC0 domain publik (KayKit, Quaternius, Kenney, ambientCG, Poly Haven), dan prop, makhluk, latar, serta suara antarmuka hasil generasi kami sendiri dikirim bersama proyek sehingga sebuah fork langsung berjalan tanpa persiapan tambahan. Anda hanya tidak boleh mengangkatnya keluar dan menjualnya sebagai karya seni mandiri.

Yang perlu Anda hapus atau ganti sebelum mendistribusikan ulang:

- **ikon ability class CraftPix** di bawah `public/ui/skills/` dibeli oleh Levy Street dan **tidak boleh didistribusikan ulang**, jadi belilah lisensi Anda sendiri jika ingin mengirimkannya;
- **efek suara @jamiecypher** berlisensi CC BY-NC 4.0, jadi bagikan secara non-komersial dengan kredit, tetapi hak komersialnya hanya berlaku untuk proyek ini;
- **seni toko dan prestise** (Season 1 Armory, set Claudium, set seni profesi, ikon Book of Deeds, emblem naga elite) adalah seni komersial pesanan dan **haknya dilindungi**;
- **merek pihak ketiga** (Twitch, X, Kick, YouTube, Discord, Solana, USDC) adalah merek dagang milik pemiliknya dan bukan milik kami untuk dilisensikan lebih lanjut;
- segelintir **ikon dan rekaman yang dipakai dengan izin** butuh izin untuk diteruskan.

[CREDITS.md](../../CREDITS.md) adalah daftar yang otoritatif, dengan kolom distribusi ulang per aset. Di mana sebuah aset terdaftar di sana, lisensi itulah yang berlaku di atas lisensi MIT proyek ini. Register tersebut masih dilengkapi, jadi aset media yang belum ada di sana berarti belum tercatat, bukan bebas: tanyakan dulu sebelum mengandalkannya. Kode sumber berlaku sebaliknya, dan semua yang tidak dikecualikan adalah MIT.

[Ketentuan Layanan](https://worldofclaudecraft.com/terms) kami mencakup game terhosting yang kami jalankan di worldofclaudecraft.com: akun, perilaku, item virtual. Ketentuan itu tidak membatasi hak yang diberikan Lisensi MIT kepada Anda atas kode sumber ini.
