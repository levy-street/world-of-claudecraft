<div align="center">

# World of ClaudeCraft

**Elle örülmüş bir dünyada görev yap, grup kur ve raid yap, üstelik tarayıcında ücretsiz. Açık kaynak, web3 ve şu anda çevrimiçi.**

**Resmi web sitesi: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r185-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.28.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.tr_TR.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · **Türkçe** · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Hemen oyna](https://worldofclaudecraft.com/) · [Kendi dünyanı barındır](#host-your-own-world-one-command) · [Bir ajan eğit](#train-an-agent-headless-rl) · [Web3](#web3) · [Katkıda bulun](CONTRIBUTING.tr_TR.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![World of ClaudeCraft başlık ekranı](../../docs/screenshots/title-screen.jpg)

</div>

## Bu nedir

World of ClaudeCraft, şu anda tarayıcında oynayabileceğin, tek bir komutla kendin barındırabileceğin ve hatta oynaması için yapay zeka ajanları eğitebileceğin eksiksiz, klasik dönem tarzı bir MMO oyunudur. Ücretsiz, açık kaynaklı ve [worldofclaudecraft.com](https://worldofclaudecraft.com/) adresinde canlı.

Tek bir paylaşılan dünya, hepsi aynı oyun çekirdeğinden gelen üç farklı yerde çalışır:

- **çevrimdışı tarayıcı dünyası**, Play Offline butonuna tıklarsın ve içindesin,
- **yetkili çok oyunculu sunucu**, Postgres destekli hesapların canlı bir dünyayı paylaştığı yer,
- **başsız RL ortamı**, Python'un gerçek oyunu bir Gym arabirimi üzerinden sürdüğü yer.

Aynı tohum, aynı dünya, her yerde. Ve neredeyse hiçbir şey hazır gönderilmiş bir varlık değil: kasabalar, yaratıklar, büyü simgeleri ve sesler hepsi çalışma zamanında üretiliyor.

## Öne çıkanlar

- **Dokuz klasik sınıf**, her biri seviye atladıkça derece kazanan gerçek vanilla tarzı bir donanıma sahip, ayrıca eksiksiz bir **yetenek sistemi** (sınıf başına üç uzmanlık, toplamda 27 uzmanlık).
- Seviye 1'den 20'ye kadar **üç açık dünya bölgesi**, neredeyse 80 görev ve Gravecaller komplosu hakkında tek, birbirine bağlı bir hikaye.
- **Beş örnek zindan**, dördü beş oyunculu seçkin raid ve biri tek kişilik bir mahzen, seçkin ölçekleme, AoE patron mekanikleri ve sınıf arketipi ganimetiyle.
- **Ölçeklenebilir delve'ler**, bir veya iki oyuncu artı bir yapay zeka yoldaşı için küçük grup modu, her seferinde rastgele odalardan yeniden inşa edilir, Normal ve Heroic kademeleri boyunca.
- **The Ashen Coliseum**, 1v1 ve 2v2 sıralamaları artı bir 2v2 Fiesta modu (güçlendirme toplamaları, daralan bir halka, on beş alaşağıya ilk ulaşan) içeren dereceli bir PvP arenası.
- **Gerçek çok oyunculu**: gruplar, takas, düellolar, vuruş hakları, grup-bölünmüş XP, fısıltılar, uzakta durumu ve her savaş zarını sahiplenen bir sunucu.
- **Prosedürel her şey**: ahşap iskeletli kasabalar, kemikli yaratık aileleri, tuval üzerine çizilmiş boyalı büyü simgeleri, WebAudio sesi, biyom havası ve gerçek zamanlı gölgeler. Dünya için hiçbir 3D model dosyası yok.
- Belirleyici, sim-anahtar-yayar bir boru hattı aracılığıyla **21 yerel ayara çevrilmiş**.
- Gymnasium bağlamaları, ödül şekillendirme ve bir kıyaslama modu içeren **başsız RL ortamı**.
- **Web3 yerlisi**: $WOC bakiyeni ve kozmetik bir sahip rozetini göstermek için bir Solana cüzdanı bağla, tamamen isteğe bağlı ve emanetsiz.

## Ekran görüntüleri

![Eastbrook'ta eczanenin dışında toplanan bir grup](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Eastbrook kamp ateşinde alacakaranlık](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Eastbrook kamp ateşinde alacakaranlık* | ![Hollow Crypt'te seçkin çekişler](../../docs/screenshots/hollow-crypt.jpg)<br>*Hollow Crypt'te meşale ışığında seçkin çekişler* |
| ![Yıkık şapeldeki huzursuz ölüler](../../docs/screenshots/restless-dead.jpg)<br>*Yıkık şapeldeki huzursuz ölüler* | ![Vale Bandits ile bir kavga](../../docs/screenshots/vale-bandits.jpg)<br>*Haydut kampında sayıca üstün düşmana karşı* |
| ![Kuzey yolunda avlanan Old Greyjaw](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, ender ortaya çıkan, kuzey yolunda kıstırıldı* | ![Satıcı ve çanta arabirimi](../../docs/screenshots/vendor-and-bags.jpg)<br>*Smith Haldren'da donanım kuşanma, ipuçları, çantalar ve parayla* |
| ![Glimmermere kıyısındaki ay geçidi](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Boğulmuşlar Glimmermere ay geçidinden çıkıyor* | ![Drowned Temple sunağındaki Ysolei](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Moonfire ve Drowned Temple'ın sunağı* |

Hava, biyom güdümlüdür ve yalnızca görüntülemeyle ilgilidir, bu yüzden belirleyici sime asla dokunmaz:

| | | |
|:---:|:---:|:---:|
| ![Eastbrook Vale üzerinde açık gökyüzü](../../docs/screenshots/weather-vale_clear.jpg)<br>*Vale üzerinde açık* | ![Mirefen Marsh üzerinde yağmur](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Mirefen Marsh üzerinde yağmur* | ![Thornpeak Heights üzerinde kar](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Thornpeak Heights üzerinde kar* |

## Oyna

İçeri girmenin iki yolu var ve ikisi de aynı dünyayı çalıştırır.

### Çevrimdışı, tarayıcında

```bash
npm install
npm run dev        # then open http://localhost:5173 and click Play Offline
```

Karakterine isim ver, dokuz sınıftan herhangi birini seç ve **Eastbrook Vale**'de (seviye 1-7) başla, altı merkezle çevrili bir pazar kasabası: kuzeyde kurt patikaları, doğuda yaban domuzu çayırları, batıda Webwood, kuzeybatıda Mirror Lake, güneybatıda bir kobold bakır madeni ve kuzeydoğuda huzursuz ölülerin yıkık bir şapeli, güneydoğuda da Gorrak'ın haydut kampı. Kuzey yolu, bir dağ geçidinden **Mirefen Marsh**'a (6-13, merkez Fenbridge) ve oradan yukarıya **Thornpeak Heights**'a (13-20, merkez Highwatch) tırmanır. Dünya tohumu `src/main.ts` içinde sabittir, bu yüzden her ziyarette aynı yerdir.

### Çevrimiçi, diğer oyuncularla

Hesaplar ve kalıcı karakterlerle gerçek istemci/sunucu oyununu ayağa kaldırmak için aşağıdaki [Kendi dünyanı barındır](#host-your-own-world-one-command) bölümüne bakın.

<a id="host-your-own-world-one-command"></a>

## Kendi dünyanı barındır (tek komut)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

**Uzaktan barındırma** için, compose yığınını herhangi bir VPS'e koyun, ortamda gerçek bir `POSTGRES_PASSWORD` ayarlayın ve 8787 portunu bir TLS ters proxy ile öne alın. Caddy bunu iki satıra indirir (`your.domain { reverse_proxy localhost:8787 }`); WebSocket'ler otomatik olarak proxy'lenir ve istemci https sayfalarında otomatik olarak `wss://` seçer. Kimlik doğrulama uç noktaları IP başına hız sınırlıdır, parolalar scrypt ile karmalanır ve belirteçler 7 gün sonra sona erer. Üretimde asla `ALLOW_DEV_COMMANDS=1` ayarlamayın, çünkü test botlarının kullandığı seviye ve ışınlanma hilelerini etkinleştirir. Tam üretim kılavuzu için [DEPLOY.md](../../DEPLOY.md) dosyasına bakın.

<a id="develop-online-with-hot-reload"></a>

### Sıcak yeniden yüklemeyle çevrimiçi geliştir

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api and /ws)
```

http://localhost:5173 adresini aç, **Play Online**'ı seç, bir hesap oluştur, bir karakter oluştur ve Enter World. İkinci bir sekme aç ve birbirinizi kasabada görmek için tekrar giriş yap. `Enter` sohbeti açar. Docker Compose yığınının yanında http://localhost:8080/wiki/ adresinde gerçek bir MediaWiki oyuncu wiki'si açılır; tohum sayfaları, `npm run wiki:seed` ile mevcut oyun içeriğinden üretilir.

Neyin kalıcı olduğu ve sunucunun nasıl kontrolü elinde tuttuğu:

- **Hesaplar**: scrypt ile karmalanmış parolalar ve 7 günlük taşıyıcı belirteçleri (`auth_tokens`).
- **Karakterler**: hesap başına en fazla 10; seviye, donanım, çantalar, görevler, yetenekler, konum ve para Postgres'te JSONB olarak kalıcıdır, her 30 saniyede bir, çıkışta ve sunucu kapanışında kaydedilir. İsimler küresel olarak benzersiz, yalnızca harf, klasik tarzdır.
- **Sunucu yetkilidir**: istemciler hareket niyetini ve komutları 20 Hz'de akıtır; sunucu tek paylaşılan `Sim`'i çalıştırır ve ilgi kapsamlı anlık görüntüler (~120 yd) artı oyuncu başına olaylar döndürür. Her savaş zarı, ganimet düşüşü, görev kredisi ve satıcı işlemi sunucu tarafında çözülür. İstemci bir görüntüleyicidir.

<a id="train-an-agent-headless-rl"></a>

## Bir ajan eğit (başsız RL)

Aynı belirleyici çekirdek bir [Gymnasium](https://gymnasium.farama.org/) ortamı olarak çalışır, böylece bir ajan gerçek oyuna karşı öğrenir, onun yeniden uygulanmasına karşı değil. Ortam sunucusu (`headless/env_server.ts`) tek bir `Sim`'i sarar ve stdio üzerinden yeni satırla ayrılmış JSON konuşur; `python/` içindeki Python bağlamaları onu bir alt süreç olarak başlatır ve olağan `reset` / `step` / `close` döngüsünü ortaya çıkarır.

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

- **Gözlem ve eylem uzayları içerikten türetilir.** Bunları başlangıçta ortamın `info` yanıtından sorgula, sabit kodlamak yerine; oyunla birlikte büyürler. Bugün eylem uzayı `Discrete(44)`'tür (hareket, hedef, saldırı, tam yetenek donanımı, etkileşim, yeme/içme) ve gözlem 276 float'tan oluşan bir `Box`'tır (kendi, yetenekler, hedef, yakındaki yaratıklar, en yakın etkileşilebilir, görev ilerlemesi).
- **Ödül**, tik başına sayaç farklarının ağırlıklı toplamıdır (XP, verilen ve alınan hasar, öldürmeler, ölümler, görev ilerlemesi, seviye atlamaları), her sıfırlamada ayarlanabilir. Her `step` bir eylem uygular ve varsayılan olarak beş sim tikini ilerletir, yani simüle edilen saniye başına kabaca dört karar.
- **Yapı gereği belirleyici.** Duvar saati yok, `Math.random` yok. Sıfırlamayı tohumla ve bölüm tam olarak yeniden oynar.

Protokol ve bağlamalar `headless/CLAUDE.md` ve `python/CLAUDE.md` içinde belgelenmiştir.

<a id="web3"></a>

## Web3

World of ClaudeCraft, Solana üzerindeki topluluk jetonumuz **$WOC** etrafında web3 yerlisidir. Bir Solana cüzdanı bağla, tek bir imzayla hesabına ilişkilendir (emanetsiz, onaylanacak işlem yok) ve salt okunur $WOC bakiyen, kozmetik bir sahip kademesi rozetinin yanında HUD'da görünür.

Yalnızca kozmetiktir ve oynamak için gerekli değildir. Oyun içinde hiçbir şey harcanmaz veya kazanılmaz, kazan-için-öde yoktur ve tüm oyun bir cüzdan bağlamadan da gayet iyi oynanır.

**$WOC sözleşme adresi (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Jeton hakkında daha fazla bilgi: [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Dünyada bir tur

### Dokuz sınıf

Her sınıf gerçek vanilla tarzı mekanikler kullanır ve seviye 1-20 boyunca dereceli büyüler öğrenir (8'de Lightning Bolt R2, 14'te R3, 20'de R4, Execute, Kidney Shot, Flash Heal, Stormstrike ve Starfire gibi yüksek bantlı yetenekler klasik seviyelerinde gelir).

- **Warrior**: rage, Heroic Strike (sonraki vuruşta, GCD dışı), Battle Shout, Charge, Rend, Thunder Clap, Hamstring, Bloodrage, Overpower (dodge proc).
- **Paladin**: Judgement ile salınan Seal of Righteousness, Holy Light, Devotion Aura, Blessing of Might, Divine Protection (absorb), Hammer of Justice (stun), Lay on Hands.
- **Hunter**: menzilli Auto Shot (klasik ölü bölgeyle 8-35 yd), Raptor Strike, Aspect of the Hawk, Serpent Sting, Arcane Shot, Concussive Shot, Mongoose Bite, Wing Clip ve seviye 10'dan itibaren evcilleştirilebilir bir evcil hayvan.
- **Rogue**: energy ve combo points, Sinister Strike, Eviscerate, Backstab (arkadan, hançer), Gouge, Evasion, Slice and Dice, Sprint.
- **Priest**: Smite, Lesser Heal, Power Word: Fortitude, Shadow Word: Pain, Power Word: Shield (absorb), Renew (HoT), Mind Blast.
- **Shaman**: Lightning Bolt, Rockbiter Weapon (imbue), Healing Wave, Earth Shock, Lightning Shield (thorns), Flame Shock.
- **Mage**: Fireball, Frost Armor, Arcane Intellect, Frostbolt, Conjure Water, Fire Blast, Arcane Missiles (channeled), Polymorph, Frost Nova.
- **Warlock**: Shadow Bolt, Demon Skin, Immolate, Corruption, Life Tap, Curse of Agony, Drain Life ve Imp'ten Doomguard'a yedi çağrılabilir iblis.
- **Druid**: Wrath, Healing Touch, Mark of the Wild, Moonfire, Rejuvenation, Thorns, Entangling Roots, 10'da Bear Form.

İyileştirmeler ve buff'lar grup üyelerine iner, iyileştirme crit yapabilir ve absorb kalkanları sağlıktan önce hasarı emer. Puanları **sınıf başına üç yetenek uzmanlığı** boyunca harca (Arms/Fury/Protection, Balance/Feral/Restoration ve benzeri); tahsis sunucu tarafından doğrulanır ve bir yapı dizesi olarak dışa aktarılabilir.

### Zindanlar

Gravecaller hikayesi dört beş oyunculu seçkin örnek boyunca akar ve kaşifler için bir kenarda tek kişilik bir mahzen durur.

- **The Hollow Crypt** (5 oyuncu) Fallen Chapel'in altında: eşli seçkin döküntü, Sexton Marrow mini patronu ve her on saniyede bir Shadow Pulse AoE düşüren Morthen the Gravecaller. Mahzen kapısı grubunu, beş dakika boş kaldıktan sonra sıfırlanan özel bir örnek kopyasına ışınlar.
- **The Sunken Bastion** (5 oyuncu, seviye 13 civarı, güneydoğu Mirefen): Vael the Mistcaller, %60 ve %30 sağlıkta Drowned Thralls dalgaları çağırır.
- **Gravewyrm Sanctum** (5 oyuncu, seviye 20, Thornpeak'in altında): seçkin boneguard ve drakonid içeren üç oda, Korgath the Bound (%30'un altında öfkelenir), Grand Necromancer Velkhar ve epik silahların düştüğü Korzul the Gravewyrm.
- **The Drowned Temple** (5 oyuncu) Glimmermere ay geçidi boyunca: Choirmother Selthe'ye ve ardından Ysolei, Avatar of the Drowned Moon'a giden soluk, ay-moru bir örnek, her dokuz saniyede bir Lunar Tide vurur ve %60 ile %30'da Moonspawn çağırır.
- **The Abandoned Crypt** (tek kişilik) Thornpeak'te: izi **Nythraxis, Scourge of Thornpeak**'e kraliyet kapısını açan, üç ruh wardstone boyunca savaşılan on oyunculu bir raid finaline götüren tek kişi için sessiz bir kilit taşı ve günlük dalışı.

Hazırlık görev zincirleri tek kişilik oynanabilir, böylece hikaye asla bir grup bulmanın arkasına kapatılmaz. Otomatik beş botlu raid'imiz (odak-ateş ve şifacı yapay zekasıyla warrior, paladin, priest, mage, hunter) Hollow Crypt'i yaklaşık beş dakikada temizler (`node scripts/crypt_raid.mjs`, `ALLOW_DEV_COMMANDS=1` gerektirir).

### Delve'ler

Delve'ler, bir veya iki oyuncu için ayrı, ölçeklenebilir bir küçük grup modudur. **The Collapsed Reliquary** (seviye 7 ve üstü), her seferinde rastgele odalardan yeniden inşa edilen, Deacon Varric'te biten bir mahzendir. Tek kişilik oyna ve bir yapay zeka yoldaşı, Tessa, yanında savaşsın. Reliquary harabesindeki Brother Halven delve panosunu yönetir, burada Normal mı yoksa Heroic mi senin kararın: Heroic düşman seviyelerini yükseltir ve daha zengin ödüller için rastgele bir ek özellik ekler.

### The Ashen Coliseum (dereceli PvP)

Sıraya girmek için `G`'ye veya arena butonuna bas. Eşleştirme dövüşçüleri özel, meşale ışıklı bir çukura ışınlar, kısa bir geri sayım adil bir başlangıç için herkesi iyileştirir ve sıfırlar, ve bir taraf 1 hp'de teslim olduğunda maç biter. Kimse ölmez ve tam sıraya girdiğin yere geri dönersin.

- **1v1 ve 2v2 dereceli sıralamaları**, her biri kalıcı bir Elo tarzı derecelendirme (herkes 1500'de başlar) ve tüm zamanların lider tablosuyla (`GET /api/arena/leaderboard`).
- **2v2 Fiesta**, daha canlı bir parti modu: on beş alaşağıya ilk ulaşan takım altı dakikalık bir sınır içinde kazanır, oyuncular büyüyen zamanlayıcılarla yeniden doğar, güçlendirme toplamaları üç dalga boyunca güç düşürür ve kapanan bir halka kavgayı bir araya zorlar.

### Birlikte oynamak

- **Gruplar** en fazla 5 kişi: bir oyuncuya sağ tıkla ve Invite to Party. Üyeler vuruş haklarını ve görev kredisini paylaşır, XP'yi gerçek vanilla grup bonuslarıyla böler (3/4/5 için 1.166 / 1.3 / 1.43) ve mini haritada nokta olarak görünür. Grup sohbeti için `/p`, ganimeti çözmek için `/roll`.
- **Takas**: sağ tıkla ve Trade. Her iki taraf eşyaları ve parayı sahneler, her ikisi de kabul etmeli ve takas atomiktir ve sunucu tarafından doğrulanır. Görev eşyaları takas edilemez ve uzaklaşmak iptal eder.
- **Düellolar**: sağ tıkla ve Challenge to a Duel. 3 saniyelik bir geri sayım, sonra bir taraf 1 hp'ye ulaşana kadar savaş; kazanan bölge çapında ilan edilir ve 60 yard öteye koşmak kaybettirir.
- **Vuruş hakları ve uzakta durumu**: bir yaratığa ilk hasar veren oyuncu onun ganimetine, XP'sine ve görev kredisine sahip olur; `/afk` ve `/dnd` seni, fısıltılara otomatik yanıtla uzakta olarak işaretler.

### Dünya ve sistemler

- **Yeme ve içme**: 18 saniye boyunca geri kazanmak için otur, hasar veya ayağa kalkmayla bozulur ve evet, aynı anda yiyip içebilirsin.
- Yiyecek ve su satın alan ve dürüst beyaz donanım satan **satıcılar**, parayı altın, gümüş ve bakır olarak gösterir.
- **Yaratık yapay zekası**: dolaşma, seviye farkına göre yakınlık öfkesi, sosyal çekişler, kovalama, tasma ve sıfırlama, ceset ganimeti ve yeniden doğuşlar, uzun bir zamanlayıcıda ender bir doğuşla (Old Greyjaw).
- Kendi ganimet tabloları ve ender yakalamaları olan **balıkçılık** noktaları.
- Uncommon, rare ve epic nadirlikte atılan **kozmetik kaplamalar**, tamamen görünüm için.
- **Ölüm ve kurtarma**: ruhunu mezarlığa salıver, düşme hasarı al ve yüzerken yavaşla.
- **Biyom havası**: Vale'de açık, Marsh'ta yağmur, Peaks'te kar, bölgeler arasında hareket ederken çapraz solarak.

### Kontroller (klasik düzen)

| Girdi | Eylem |
|---|---|
| `W` / `S` | koş / geri pedalla. `A`/`D` döner (sağ fare basılıyken strafe), `Q`/`E` strafe |
| sağ sürükle / sol sürükle | mouselook / yörünge kamera. Tekerlek yakınlaştırır, `Space` zıplar |
| `Tab` | en yakın düşmanları döngüle. hedeflemek için sol tık, saldırmak, ganimet toplamak veya konuşmak için sağ tık |
| `1`-`9`, `0`, `-`, `=` | eylem çubuğu |
| `F` | etkileşim (bir cesetten ganimet topla, bir nesne al, konuş) |
| `C` `P` `L` `M` `B` `G` | karakter, büyü kitabı, görev günlüğü, dünya haritası, çantalar, arena |
| `V` / `R` / `Esc` | isim plakaları, otomatik koşu, pencereleri kapat veya hedefi temizle |

Dokunmatik kontroller (bir hareket çubuğu, kamera sürükleme ve ekran üstü eylem butonları) mobilde otomatik olarak açılır.

## Mimari (tek sim, üç ana bilgisayar)

Üç fikir projeyi bir arada tutar:

- **Tek sim, üç ana bilgisayar.** Aynı `src/sim/` kodu çevrimdışı tarayıcı dünyasını, çevrimiçi sunucuyu ve RL ortamını çalıştırır. Davranış her yerde aynı olmalıdır ve testler bunu böyle tutmak için vardır.
- **`IWorld` tek dikiştir.** `src/world_api.ts`, `IWorld`'ü tanımlar. Çevrimdışı `Sim` onu yapısal olarak karşılar ve çevrimiçi `ClientWorld` onu sunucu anlık görüntülerini yansıtarak uygular. Görüntüleyici ve HUD yalnızca `IWorld` ile konuşur, asla somut bir dünyayla değil, böylece yeni bir özellik önce arabirimi genişletir ve sonra her iki dünyayı da.
- **Sunucu yetkilidir.** İstemciler niyet gönderir; sunucu sonuçlara karar verir. İstemci asla savaşı, ganimeti veya ekonomiyi kendi başına çözmez.

Sim sabit bir 20 Hz tiktir (`DT = 1/20`), tüm rastgelelik tek tohumlu bir `Rng` üzerinden akar ve `src/sim/` sıfır DOM, tarayıcı veya Three.js içe aktarması taşır. Aynı kodun bir Node ortam sunucusuna, yetkili bir oyun döngüsüne ve bir tarayıcı sekmesine tek bir satır değiştirmeden paketlenmesini sağlayan şey budur.

### Proje düzeni

| Yol | Ne olduğu |
|---|---|
| `src/sim/` | Belirleyici oyun çekirdeği, gerçeğin kaynağı. DOM veya Three bağımlılığı yok. |
| `src/sim/content/` | Kod olarak veri: dokuz sınıf, yetenekler, bölgeler, zindanlar, eşyalar, yetenekler. |
| `src/render/` | Three.js görüntüleyici (prosedürel geometri, dokular, VFX). Dünyayı okur, asla değiştirmez. |
| `src/game/` | Yerel girdi, kamera, tuş atamaları, mobil kontroller, prosedürel WebAudio. |
| `src/ui/` | Klasik HUD (çerçeveler, pencereler, ipuçları, harita, yüzen savaş metni), prosedürel simgeler, i18n. |
| `src/net/` | Çevrimiçi istemci: REST kimlik doğrulama artı bir WebSocket dünya aynası (`ClientWorld`). |
| `src/admin/` | Yönetici panosu SPA'sı (ayrı `admin.html` girişi). |
| `server/` | Yetkili sunucu: HTTP ve WS, dünya döngüsü, Postgres, kimlik doğrulama, sosyal, denetleme. |
| `headless/` + `python/` | RL ortam sunucusu (`env_server.ts`) ve Python Gym bağlamaları. |
| `tests/` | Vitest paketi. |
| `scripts/` | Varlık derlemesi artı tarayıcı E2E, ekran görüntüsü ve entegrasyon betikleri. |
| `public/` · `docs/` | Statik varlıklar (GLB modelleri, dokular, HDRI'lar) ve tasarım belgeleri. |

Çoğu dizin yerel kurallarıyla kendi `CLAUDE.md`'sini taşır. Proje değişmezlerinin tam seti kök [`CLAUDE.md`](../../CLAUDE.md) içinde bulunur.

## Klasikler gibi inşa edildi

Savaş, seviye atlama ve tehdit hepsi otantik klasik dönem kurallarıyla çalışır: rage ve energy, hit ve dodge tabloları, armor azaltma, gerçek XP eğrisi, vuruş zamanlayıcıları ve global cooldown. Yaklaşık olarak taklit etmek yerine hatırladığın gibi hissettirir. Okumak istersen kesin sayılar `src/sim/` içinde bulunur.

Ve neredeyse hiçbiri hazır gönderilmiş bir varlık değil. Dünya koddan çizilir:

- Prosedürel kasabalar, yaratıklar, arazi, su, hava ve gerçek zamanlı gölgeler, dünya için hiçbir 3D model dosyası olmadan.
- Tam yürüme, saldırı, büyü yapma, oturma ve ölüm animasyonlarıyla on iki kemikli yaratık ailesi.
- Çalışma zamanında tuval üzerine boyanmış büyü, eşya ve buff simgeleri.
- Eksiksiz bir klasik HUD (birim çerçeveleri, eylem çubukları, ipuçları, görev günlüğü, dünya haritası, mini harita, yüzen savaş metni) ve her ses için prosedürel WebAudio.

## Geliştirme

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

Mantık ve birim testleri Vitest kullanır. Yinelerken tek bir dosya çalıştır: `npx vitest run tests/sim.test.ts`. E2E ve görsel betikler gerçek tarayıcıları `puppeteer-core` aracılığıyla sürer ve `npm run dev` çalışıyor olmasını gerektirir (çoğu zaman `npm run server` da). Tarayıcı ajanları, basılı tuşları simüle etmek yerine hareketi `window.__game.controller` aracılığıyla sürebilir, örneğin `controller.move({ forward: true }, facingRadians)` veya `{ f: 1, sr: 1 }` gibi kompakt bayraklar.

Sunucu komutları için yukarıdaki [Çevrimiçi geliştir](#develop-online-with-hot-reload), üretim için [DEPLOY.md](../../DEPLOY.md) ve varlık lisansları için [CREDITS.md](../../CREDITS.md) dosyalarına bakın.

## Yerelleştirme

Her oyuncuya görünür dize `t()` üzerinden çözülür ve oyun **21 yerel ayarda** gönderilir (İngilizce, iki İspanyolca, iki Fransızca, Kanada İngilizcesi, İtalyanca, Almanca, Basitleştirilmiş ve Geleneksel Çince, Korece, Japonca, Brezilya Portekizcesi, Rusça, Felemenkçe, Lehçe, Endonezce, Türkçe, İsveççe, Vietnamca ve Danca). Sim ve sunucu dilden bağımsız kalır: istemcinin sınırda yeniden yerelleştirdiği kararlı anahtarlar veya İngilizce yayarlar, bu da belirleyiciliği bozulmadan tutar. Katkıda bulunanlar yalnızca İngilizce ekler; bakımcı her sürümden önce diğer yerel ayarları toplu olarak doldurur. İş akışı `docs/i18n-scaling/translation-workflow.md` içinde belgelenmiştir.

## Katkıda bulunma

Her türlü katkı memnuniyetle karşılanır: kod, çeviriler, hata raporları ve belgeler. Kurulum için [CONTRIBUTING.tr_TR.md](CONTRIBUTING.tr_TR.md) ile başla, [Davranış Kuralları](../../CODE_OF_CONDUCT.md)'nı oku ve bir güvenlik açığı bildirmeden önce [SECURITY.md](../../SECURITY.md)'yi kontrol et. Burada yeni misin? [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue) etiketli sorunlara bak, bir [sorun](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) aç veya [Discord](https://discord.com/invite/worldofclaudecraft)'da merhaba de.

<div align="center">

![World of Claude](../../worldofclaude.png)

![World of ClaudeCraft topluluğu](../../woc_community.png)

</div>

## Lisans

Kod [MIT lisanslıdır](../../LICENSE), o yüzden çatalla, yeniden düzenle ve kendi dünyanı barındır.

Birlikte gönderilen üçüncü taraf sanat varlıkları (modeller, dokular, HDRI'lar) kendi lisanslarını korur, MIT su normal haritaları dışında tümü CC0 kamu malıdır, her paket için [CREDITS.md](../../CREDITS.md) içinde belgelenmiştir.
