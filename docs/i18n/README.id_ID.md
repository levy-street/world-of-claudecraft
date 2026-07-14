<div align="center">

# World of ClaudeCraft

**Jalankan quest, bentuk grup, dan serbu dunia buatan tangan, gratis di browser Anda. Open source, web3, dan online sekarang juga.**

**Situs resmi: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.25.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.id_ID.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/GjhnUsBtw)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · **Bahasa Indonesia** · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Main sekarang](https://worldofclaudecraft.com/) · [Hosting dunia Anda sendiri](#host-your-own-world-one-command) · [Latih sebuah agen](#train-an-agent-headless-rl) · [Web3](#web3) · [Berkontribusi](CONTRIBUTING.id_ID.md) · [Discord](https://discord.gg/GjhnUsBtw)

![Layar judul World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## Apa ini

World of ClaudeCraft adalah MMO era klasik yang lengkap dan bisa Anda mainkan sekarang juga di browser, Anda hosting sendiri dengan satu perintah, dan bahkan bisa melatih agen AI untuk memainkannya. Ini gratis, open source, dan live di [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Satu dunia bersama berjalan di tiga tempat, semuanya dari inti game yang sama:

- **dunia browser offline**, di mana Anda klik Play Offline dan langsung masuk,
- **server multiplayer otoritatif**, di mana akun yang didukung Postgres berbagi dunia yang hidup,
- **env RL headless**, di mana Python menggerakkan game sungguhan melalui antarmuka Gym.

Seed yang sama, dunia yang sama, di mana saja. Dan hampir tidak ada yang merupakan aset bawaan: kota, makhluk, ikon mantra, dan suara semuanya dihasilkan saat runtime.

## Sorotan

- **Sembilan class klasik**, masing-masing dengan kit bergaya vanilla sungguhan yang mendapatkan rank saat Anda naik level, ditambah **sistem talent** lengkap (tiga spec per class, total 27 spec).
- **Tiga zona dunia terbuka** dari level 1 hingga 20, hampir 80 quest, dan satu alur cerita terhubung tentang konspirasi Gravecaller.
- **Lima dungeon instance**, empat di antaranya raid elite lima pemain dan satu crypt solo, dengan penskalaan elite, mekanik bos AoE, dan loot arketipe class.
- **Delve yang dapat diskalakan**, mode grup kecil untuk satu atau dua pemain ditambah satu pendamping AI, dibangun ulang dari ruang acak setiap putaran di tier Normal dan Heroic.
- **The Ashen Coliseum**, arena PvP berperingkat dengan ladder 1v1 dan 2v2 ditambah mode 2v2 Fiesta (pengambilan augment, ring yang menyusut, yang pertama mencapai lima belas takedown).
- **Multiplayer sungguhan**: party, perdagangan, duel, hak tap, XP party-split, bisik, status away, dan server yang memiliki setiap lemparan combat.
- **Semuanya prosedural**: kota berangka kayu, keluarga makhluk yang ber-rig, ikon mantra yang dilukis di canvas, suara WebAudio, cuaca bioma, dan bayangan real-time. Tidak ada file model 3D untuk dunia.
- **Dilokalkan ke 21 locale** melalui pipeline deterministik dengan sim-emits-keys.
- **Lingkungan RL headless** dengan binding Gymnasium, pembentukan reward, dan mode benchmark.
- **Web3-native**: tautkan dompet Solana untuk menampilkan saldo $WOC Anda dan lencana holder kosmetik, sepenuhnya opsional dan non-custodial.

## Tangkapan layar

![Sebuah party berkumpul di luar apotek di Eastbrook](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Senja di api unggun Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Senja di api unggun Eastbrook* | ![Tarikan elite di the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Tarikan elite berkilau obor di the Hollow Crypt* |
| ![Mayat gelisah di kapel reruntuhan](../../docs/screenshots/restless-dead.jpg)<br>*Mayat gelisah di kapel reruntuhan* | ![Perkelahian dengan Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*Kalah jumlah di kamp bandit* |
| ![Old Greyjaw diburu di jalan utara](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, sang rare spawn, dikejar di jalan utara* | ![UI pedagang dan tas](../../docs/screenshots/vendor-and-bags.jpg)<br>*Melengkapi gear di tempat Smith Haldren, dengan tooltip, tas, dan koin* |
| ![Moongate di pantai Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Para drowned memanjat naik di moongate Glimmermere* | ![Ysolei di altar the Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Moonfire dan altar the Drowned Temple* |

Cuaca didorong oleh bioma dan hanya render, jadi tidak pernah menyentuh sim deterministik:

| | | |
|:---:|:---:|:---:|
| ![Langit cerah di atas Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Cerah di atas the Vale* | ![Hujan di atas Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Hujan di atas Mirefen Marsh* | ![Salju di Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Salju di Thornpeak Heights* |

## Mainkan

Anda punya dua cara masuk, dan keduanya menjalankan dunia yang sama.

### Offline, di browser Anda

```bash
npm install
npm run dev        # then open http://localhost:5173 and click Play Offline
```

Beri nama karakter Anda, pilih salah satu dari sembilan class, dan Anda mulai di **Eastbrook Vale** (level 1-7), sebuah kota pasar yang dikelilingi enam hub: jalur serigala di utara, padang babi hutan di timur, the Webwood di barat, Mirror Lake di barat laut, galian tembaga kobold di barat daya, dan kapel reruntuhan berisi mayat gelisah di timur laut, dengan kamp bandit Gorrak di tenggara. Jalan utara mendaki celah gunung menuju **Mirefen Marsh** (6-13, hub Fenbridge) dan terus naik ke **Thornpeak Heights** (13-20, hub Highwatch). Seed dunia ditetapkan di `src/main.ts`, jadi ini tempat yang sama di setiap kunjungan.

### Online, dengan pemain lain

Lihat [Hosting dunia Anda sendiri](#host-your-own-world-one-command) di bawah untuk menyiapkan game client/server sungguhan dengan akun dan karakter persisten.

<a id="host-your-own-world-one-command"></a>

## Hosting dunia Anda sendiri (satu perintah)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Untuk **hosting jarak jauh**, letakkan compose stack di VPS mana pun, atur `POSTGRES_PASSWORD` sungguhan di environment, dan letakkan reverse proxy TLS di depan port 8787. Caddy membuat ini dua baris (`your.domain { reverse_proxy localhost:8787 }`); WebSocket di-proxy secara otomatis dan client otomatis memilih `wss://` di halaman https. Endpoint autentikasi dibatasi rate per IP, password di-hash dengan scrypt, dan token kedaluwarsa setelah 7 hari. Jangan pernah mengatur `ALLOW_DEV_COMMANDS=1` di produksi, karena itu mengaktifkan cheat level dan teleport yang digunakan bot pengujian. Lihat [DEPLOY.md](../../DEPLOY.md) untuk panduan produksi lengkap.

<a id="develop-online-with-hot-reload"></a>

### Kembangkan online dengan hot reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api and /ws)
```

Buka http://localhost:5173, pilih **Play Online**, buat akun, buat karakter, dan Enter World. Buka tab kedua dan login lagi untuk melihat satu sama lain di kota. `Enter` membuka chat. Sebuah wiki pemain MediaWiki sungguhan muncul bersama Docker Compose stack di http://localhost:8080/wiki/; halaman seed-nya dihasilkan dari konten game saat ini dengan `npm run wiki:seed`.

Apa yang persisten dan bagaimana server tetap memegang kendali:

- **Akun**: password yang di-hash dengan scrypt dan bearer token 7 hari (`auth_tokens`).
- **Karakter**: hingga 10 per akun; level, gear, tas, quest, talent, posisi, dan uang persisten sebagai JSONB di Postgres, disimpan setiap 30 detik, saat logout, dan saat server dimatikan. Nama unik secara global, hanya huruf, gaya klasik.
- **Server bersifat otoritatif**: client melakukan streaming intent gerakan dan perintah pada 20 Hz; server menjalankan satu `Sim` bersama dan mengembalikan snapshot lingkup-interest (~120 yd) ditambah event per-pemain. Setiap lemparan combat, drop loot, kredit quest, dan transaksi pedagang diselesaikan di sisi server. Client adalah sebuah renderer.

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

env = WoWClassicEnv(player_class="warrior")   # warrior or mage
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **Ruang observasi dan aksi berasal dari konten.** Query keduanya dari balasan `info` env saat startup alih-alih meng-hardcode; keduanya tumbuh bersama game. Saat ini ruang aksi adalah `Discrete(44)` (gerakan, target, serang, kit ability lengkap, interaksi, makan/minum) dan observasi adalah `Box` berisi 276 float (diri, ability, target, mob terdekat, interaktif terdekat, kemajuan quest).
- **Reward** adalah jumlah berbobot dari delta penghitung per-tick (XP, damage yang diberikan dan diterima, kill, kematian, kemajuan quest, naik level), dapat disetel per reset. Setiap `step` menerapkan satu aksi dan memajukan lima sim tick secara default, jadi kira-kira empat keputusan per detik tersimulasi.
- **Deterministik berdasarkan konstruksi.** Tanpa wall clock, tanpa `Math.random`. Beri seed pada reset dan episode akan diputar ulang persis sama.

Protokol dan binding didokumentasikan di `headless/CLAUDE.md` dan `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft adalah web3-native di sekitar **$WOC**, token komunitas kami di Solana. Hubungkan dompet Solana, tautkan ke akun Anda dengan satu tanda tangan (non-custodial, tanpa transaksi untuk disetujui), dan saldo $WOC read-only Anda muncul di HUD bersama lencana tier holder kosmetik.

Ini hanya kosmetik dan tidak diperlukan untuk bermain. Tidak ada yang dihabiskan atau didapat di dalam game, tidak ada pay-to-win, dan seluruh game berjalan baik tanpa pernah menghubungkan dompet.

**Alamat kontrak $WOC (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Selengkapnya tentang token di [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Tur keliling dunia

### Sembilan class

Setiap class menggunakan mekanik bergaya vanilla sungguhan dan mempelajari mantra ber-rank sepanjang level 1-20 (Lightning Bolt R2 di 8, R3 di 14, R4 di 20, dengan ability band tinggi seperti Execute, Kidney Shot, Flash Heal, Stormstrike, dan Starfire yang tiba di level klasiknya).

- **Warrior**: rage, Heroic Strike (on-next-swing, off-GCD), Battle Shout, Charge, Rend, Thunder Clap, Hamstring, Bloodrage, Overpower (proc dodge).
- **Paladin**: Seal of Righteousness yang dilepaskan oleh Judgement, Holy Light, Devotion Aura, Blessing of Might, Divine Protection (absorb), Hammer of Justice (stun), Lay on Hands.
- **Hunter**: Auto Shot jarak jauh (8-35 yd dengan dead zone klasik), Raptor Strike, Aspect of the Hawk, Serpent Sting, Arcane Shot, Concussive Shot, Mongoose Bite, Wing Clip, dan pet yang dapat dijinakkan dari level 10.
- **Rogue**: energy dan combo point, Sinister Strike, Eviscerate, Backstab (dari belakang, dagger), Gouge, Evasion, Slice and Dice, Sprint.
- **Priest**: Smite, Lesser Heal, Power Word: Fortitude, Shadow Word: Pain, Power Word: Shield (absorb), Renew (HoT), Mind Blast.
- **Shaman**: Lightning Bolt, Rockbiter Weapon (imbue), Healing Wave, Earth Shock, Lightning Shield (thorns), Flame Shock.
- **Mage**: Fireball, Frost Armor, Arcane Intellect, Frostbolt, Conjure Water, Fire Blast, Arcane Missiles (channeled), Polymorph, Frost Nova.
- **Warlock**: Shadow Bolt, Demon Skin, Immolate, Corruption, Life Tap, Curse of Agony, Drain Life, dan tujuh demon yang dapat dipanggil dari Imp hingga Doomguard.
- **Druid**: Wrath, Healing Touch, Mark of the Wild, Moonfire, Rejuvenation, Thorns, Entangling Roots, Bear Form di 10.

Heal dan buff mengenai anggota party, healing bisa crit, dan absorb shield menyerap damage sebelum health. Belanjakan poin di **tiga talent spec per class** (Arms/Fury/Protection, Balance/Feral/Restoration, dan seterusnya); alokasi divalidasi server dan dapat diekspor sebagai string build.

### Dungeon

Alur cerita Gravecaller berjalan melalui empat instance elite lima pemain, dan satu crypt solo terletak di samping untuk para penjelajah.

- **The Hollow Crypt** (5 pemain) di bawah the Fallen Chapel: trash elite berpasangan, miniboss Sexton Marrow, dan Morthen the Gravecaller, yang menjatuhkan AoE Shadow Pulse setiap sepuluh detik. Pintu crypt menteleportasi party Anda ke salinan instance pribadi yang reset setelah lima menit kosong.
- **The Sunken Bastion** (5 pemain, sekitar level 13, tenggara Mirefen): Vael the Mistcaller memanggil gelombang Drowned Thralls pada health 60% dan 30%.
- **Gravewyrm Sanctum** (5 pemain, level 20, di bawah Thornpeak): tiga ruang boneguard elite dan drakonid, Korgath the Bound (mengamuk di bawah 30%), Grand Necromancer Velkhar, dan Korzul the Gravewyrm, tempat senjata epic jatuh.
- **The Drowned Temple** (5 pemain) melalui moongate Glimmermere: instance pucat ungu-bulan yang mengarah ke Choirmother Selthe lalu Ysolei, Avatar of the Drowned Moon, yang memancarkan Lunar Tide setiap sembilan detik dan memanggil Moonspawn pada 60% dan 30%.
- **The Abandoned Crypt** (solo) di Thornpeak: penyelaman keystone-dan-diari yang tenang untuk satu orang, yang jejaknya membuka pintu kerajaan menuju **Nythraxis, Scourge of Thornpeak**, finale raid sepuluh pemain yang diperjuangkan melintasi tiga soul wardstone.

Rantai quest menjelang itu bisa dilakukan solo, jadi cerita tidak pernah terkunci di balik keharusan menemukan grup. Raid lima-bot otomatis kami (warrior, paladin, priest, mage, hunter dengan focus-fire dan AI healer) membersihkan the Hollow Crypt dalam sekitar lima menit (`node scripts/crypt_raid.mjs`, membutuhkan `ALLOW_DEV_COMMANDS=1`).

### Delve

Delve adalah mode grup kecil yang terpisah dan dapat diskalakan untuk satu atau dua pemain. **The Collapsed Reliquary** (level 7 ke atas) adalah crypt yang dibangun ulang dari ruang acak di setiap putaran, berakhir di Deacon Varric. Lakukan solo dan seorang pendamping AI, Tessa, bertarung di sisi Anda. Brother Halven di reruntuhan The Collapsed Reliquary menjalankan papan delve, di mana Normal atau Heroic terserah Anda: Heroic menaikkan level musuh dan menambah afiks acak untuk reward yang lebih kaya.

### The Ashen Coliseum (PvP berperingkat)

Tekan `G` atau tombol arena untuk antre. Matchmaking menteleportasi para petarung ke lubang pribadi berkilau obor, hitung mundur singkat menyembuhkan dan mereset semua orang untuk awal yang adil, dan pertarungan berakhir saat satu pihak menyerah pada 1 hp. Tidak ada yang mati, dan Anda kembali persis di tempat Anda antre.

- **Ladder berperingkat 1v1 dan 2v2**, masing-masing dengan rating gaya Elo yang persisten (semua orang mulai di 1500) dan papan peringkat sepanjang masa (`GET /api/arena/leaderboard`).
- **2v2 Fiesta**, mode party yang lebih hidup: tim pertama yang mencapai lima belas takedown menang dalam batas enam menit, pemain respawn pada timer yang bertambah, pengambilan augment menjatuhkan power melintasi tiga gelombang, dan ring penutup memaksa pertarungan menyatu.

### Bermain bersama

- **Party** hingga 5: klik kanan seorang pemain dan Invite to Party. Anggota berbagi hak tap dan kredit quest, membagi XP dengan bonus grup vanilla sungguhan (1.166 / 1.3 / 1.43 untuk 3/4/5), dan muncul sebagai titik di minimap. `/p` untuk chat party, `/roll` untuk menyelesaikan loot.
- **Perdagangan**: klik kanan dan Trade. Kedua pihak menyiapkan item dan uang, keduanya harus menerima, dan pertukaran bersifat atomik serta divalidasi server. Item quest tidak bisa diperdagangkan, dan menjauh akan membatalkan.
- **Duel**: klik kanan dan Challenge to a Duel. Hitung mundur 3 detik, lalu bertarung hingga satu pihak mencapai 1 hp; pemenang diumumkan ke seluruh zona dan lari 60 yard menjauh berarti menyerah.
- **Hak tap dan status away**: pemain pertama yang merusak sebuah mob memiliki loot, XP, dan kredit quest-nya; `/afk` dan `/dnd` menandai Anda away dengan balasan otomatis ke bisikan.

### Dunia dan sistem

- **Makan dan minum**: duduk untuk memulihkan selama 18 detik, terganggu oleh damage atau berdiri, dan ya, Anda bisa makan dan minum sekaligus.
- **Pedagang** yang membeli makanan dan air serta menjual gear putih jujur, dengan koin ditampilkan dalam gold, silver, dan copper.
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
| `C` `P` `L` `M` `B` `G` | karakter, spellbook, log quest, peta dunia, tas, arena |
| `V` / `R` / `Esc` | nameplate, autorun, tutup jendela atau hapus target |

Kontrol sentuh (sebuah stik gerakan, seret kamera, dan tombol aksi di layar) muncul otomatis di perangkat seluler.

## Arsitektur (satu sim, tiga host)

Tiga ide menyatukan proyek ini:

- **Satu sim, tiga host.** Kode `src/sim/` yang sama menjalankan dunia browser offline, server online, dan env RL. Perilaku harus identik di mana saja, dan tes ada untuk menjaganya tetap demikian.
- **`IWorld` adalah satu-satunya seam.** `src/world_api.ts` mendefinisikan `IWorld`. `Sim` offline memenuhinya secara struktural dan `ClientWorld` online mengimplementasikannya dengan mencerminkan snapshot server. Renderer dan HUD hanya berbicara ke `IWorld`, tidak pernah ke dunia konkret, jadi fitur baru memperluas antarmuka terlebih dahulu lalu kedua dunia.
- **Server bersifat otoritatif.** Client mengirim intent; server memutuskan hasil. Client tidak pernah menyelesaikan combat, loot, atau ekonomi sendiri.

Sim adalah tick tetap 20 Hz (`DT = 1/20`), semua keacakan mengalir melalui satu `Rng` ber-seed, dan `src/sim/` tidak membawa import DOM, browser, atau Three.js sama sekali. Itulah yang memungkinkan kode yang sama dibundel menjadi server env Node, loop game otoritatif, dan tab browser tanpa mengubah satu baris pun.

### Tata letak proyek

| Path | Apa itu |
|---|---|
| `src/sim/` | Inti game deterministik, sumber kebenaran. Tanpa dependensi DOM atau Three. |
| `src/sim/content/` | Data sebagai kode: sembilan class, ability, zona, dungeon, item, talent. |
| `src/render/` | Renderer Three.js (geometri, tekstur, VFX prosedural). Membaca dunia, tidak pernah memutasinya. |
| `src/game/` | Input lokal, kamera, keybind, kontrol seluler, WebAudio prosedural. |
| `src/ui/` | HUD klasik (frame, jendela, tooltip, peta, floating combat text), ikon prosedural, i18n. |
| `src/net/` | Client online: autentikasi REST ditambah cermin dunia WebSocket (`ClientWorld`). |
| `src/admin/` | SPA dasbor admin (entri `admin.html` terpisah). |
| `server/` | Server otoritatif: HTTP dan WS, loop dunia, Postgres, auth, sosial, moderasi. |
| `headless/` + `python/` | Server env RL (`env_server.ts`) dan binding Python Gym. |
| `tests/` | Suite Vitest. |
| `scripts/` | Build aset ditambah skrip E2E browser, screenshot, dan integrasi. |
| `public/` · `docs/` | Aset statis (model GLB, tekstur, HDRI) dan dokumen desain. |

Sebagian besar direktori membawa `CLAUDE.md` sendiri dengan konvensi lokal. Kumpulan lengkap invariant proyek ada di [`CLAUDE.md`](../../CLAUDE.md) root.

## Dibangun seperti yang klasik

Combat, leveling, dan threat semuanya berjalan pada aturan era klasik yang autentik: rage dan energy, tabel hit dan dodge, mitigasi armor, kurva XP sungguhan, swing timer, dan global cooldown. Rasanya seperti yang Anda ingat alih-alih sekadar mendekatinya. Angka pastinya ada di `src/sim/` jika Anda ingin membacanya.

Dan hampir tidak ada yang merupakan aset bawaan. Dunia digambar dari kode:

- Kota, makhluk, medan, air, cuaca, dan bayangan real-time prosedural, tanpa file model 3D untuk dunia.
- Dua belas keluarga makhluk ber-rig dengan animasi jalan, serang, cast, duduk, dan kematian lengkap.
- Ikon mantra, item, dan buff yang dilukis di canvas saat runtime.
- HUD klasik lengkap (unit frame, action bar, tooltip, log quest, peta dunia, minimap, floating combat text) dan WebAudio prosedural untuk setiap suara.

## Pengembangan

```bash
npm test                        # vitest: formulas, combat, AI, quests, all 9 classes, parties, duels, trades, dungeons
npm run build                   # production web build
node scripts/smoke_browser.mjs  # warrior end-to-end (needs npm run dev)
node scripts/smoke_mage.mjs     # mage: casting, polymorph, conjure and drink, death and release
node scripts/visual_tour.mjs    # screenshot tour of the zone and UI into tmp/
node scripts/tour_temple.mjs    # screenshot tour of the Glimmermere and Drowned Temple into tmp/
node scripts/mp_integration.mjs # API, WS, and persistence checks (server running)
node scripts/social_e2e.mjs     # trade and duel over the wire (ALLOW_DEV_COMMANDS=1)
node scripts/arena_visual.mjs   # two clients queue and fight a ranked 1v1
node scripts/crypt_raid.mjs     # five bots clear the Hollow Crypt (ALLOW_DEV_COMMANDS=1)
```

Tes logika dan unit menggunakan Vitest. Saat beriterasi, jalankan satu file: `npx vitest run tests/sim.test.ts`. Skrip E2E dan visual menggerakkan browser sungguhan melalui `puppeteer-core` dan membutuhkan `npm run dev` berjalan (sering `npm run server` juga). Agen browser dapat menggerakkan gerakan melalui `window.__game.controller` alih-alih mensimulasikan tombol yang ditahan, misalnya `controller.move({ forward: true }, facingRadians)` atau flag ringkas seperti `{ f: 1, sr: 1 }`.

Untuk perintah server lihat [Kembangkan online](#develop-online-with-hot-reload) di atas, [DEPLOY.md](../../DEPLOY.md) untuk produksi, dan [CREDITS.md](../../CREDITS.md) untuk lisensi aset.

## Lokalisasi

Setiap string yang terlihat pemain diselesaikan melalui `t()`, dan game ini dikirimkan dalam **21 locale** (Inggris, dua Spanyol, dua Prancis, Inggris Kanada, Italia, Jerman, Tionghoa Sederhana dan Tradisional, Korea, Jepang, Portugis Brasil, Rusia, Belanda, Polandia, Indonesia, Turki, Swedia, Vietnam, dan Denmark). Sim dan server tetap agnostik bahasa: keduanya memancarkan key stabil atau bahasa Inggris yang dilokalkan ulang oleh client di batas, yang menjaga determinisme tetap utuh. Kontributor hanya menambahkan bahasa Inggris; pengelola mengisi locale lainnya secara batch sebelum setiap rilis. Alur kerjanya didokumentasikan di `docs/i18n-scaling/translation-workflow.md`.

## Berkontribusi

Kontribusi dalam segala bentuk disambut: kode, terjemahan, laporan bug, dan dokumentasi. Mulai dengan [CONTRIBUTING.id_ID.md](CONTRIBUTING.id_ID.md) untuk penyiapan, baca [Kode Etik](../../CODE_OF_CONDUCT.md), dan periksa [SECURITY.md](../../SECURITY.md) sebelum melaporkan kerentanan. Baru di sini? Cari issue berlabel [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), buka sebuah [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose), atau sapa kami di [Discord](https://discord.gg/GjhnUsBtw).

<div align="center">

![World of Claude](../../worldofclaude.png)

![Komunitas World of ClaudeCraft](../../woc_community.png)

</div>

## Lisensi

Kode ini [berlisensi MIT](../../LICENSE), jadi fork, remix, dan hosting dunia Anda sendiri.

Aset seni pihak ketiga yang dibundel (model, tekstur, HDRI) mempertahankan lisensinya sendiri, semuanya CC0 domain publik kecuali water normal map MIT, didokumentasikan per pack di [CREDITS.md](../../CREDITS.md).
