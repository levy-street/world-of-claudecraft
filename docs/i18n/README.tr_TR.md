<div align="center">

# World of ClaudeCraft

**Elle örülmüş bir dünyada görev yap, grup kur ve raid yap, üstelik tarayıcında ücretsiz. Açık kaynak, web3 ve şu anda çevrimiçi.**

**Resmi web sitesi: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.32.3-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.tr_TR.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Čeština](README.cs_CZ.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · **Türkçe** · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Hemen oyna](https://worldofclaudecraft.com/) · [Kendi dünyanı barındır](#host-your-own-world-one-command) · [Bir ajan eğit](#train-an-agent-headless-rl) · [Web3](#web3) · [Katkıda bulun](CONTRIBUTING.tr_TR.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![World of ClaudeCraft başlık ekranı](../../docs/screenshots/title-screen.jpg)

</div>

## Bu nedir

World of ClaudeCraft, şu anda tarayıcında oynayabileceğin, tek bir komutla kendin barındırabileceğin ve hatta oynaması için yapay zeka ajanları eğitebileceğin eksiksiz, klasik dönem tarzı bir MMO oyunudur. Ücretsiz, açık kaynaklı ve [worldofclaudecraft.com](https://worldofclaudecraft.com/) adresinde canlı.

Tek bir paylaşılan dünya, hepsi aynı oyun çekirdeğinden gelen üç farklı yerde çalışır:

- **yetkili çok oyunculu sunucu**, worldofclaudecraft.com adresinde oynadığın canlı dünya, Postgres destekli hesapların tek bir kalıcı diyarı paylaştığı yer,
- **çevrimdışı tarayıcı dünyası**, geliştirme sunucusundan aldığın yerel tek oyunculu bir Sim, geliştirme için ve oyun çekirdeğini baştan sona okumak için kullanışlı,
- **başsız RL ortamı**, Python'un gerçek oyunu bir Gym arabirimi üzerinden sürdüğü yer.

Aynı tohum, aynı dünya, her yerde. Gördüklerinin büyük bölümü hâlâ çalışma zamanında koddan çiziliyor, geri kalanı ise projeyle birlikte gönderilen özenle seçilmiş bir varlık kümesi, böylece bir çatal kutudan çıkar çıkmaz çalışır.

## Öne çıkanlar

- **Dokuz klasik sınıf**, her biri seviye atladıkça derece kazanan eksiksiz klasik dönem tarzı bir donanıma sahip, ayrıca eksiksiz bir **yetenek sistemi** (sınıf başına üç uzmanlık, toplamda 27 uzmanlık).
- Seviye 1'den 20'ye kadar **üç açık dünya bölgesi**, 90'dan fazla görev ve Gravecaller komplosu hakkında tek, birbirine bağlı bir hikaye.
- **Beş örnek zindan**, dördü beş oyunculu seçkin raid ve biri tek kişilik bir mahzen; seçkin ölçekleme, AoE patron mekanikleri, tier setlerinde toplanan sınıf arketipi ganimeti ve daha zengin ödülleri olan bir **Heroic zorluk kademesi** ile, ayrıca açık dünyada **world boss**'lar ve on oyunculu bir raid finali.
- **İki ölçeklenebilir delve**, bir veya iki oyuncu artı bir yapay zeka yoldaşı için küçük grup modu, Normal ve Heroic kademelerinde her seferinde rastgele odalardan yeniden inşa edilir.
- İki arena haritasında **dereceli PvP**: 1v1 ve 2v2 sıralamaları, daha canlı bir 2v2 Fiesta modu ve 3v3 ile 5v5 hedef modu olan **Protect Yumi**. Dereceli oyun Honor kazandırır; Honor da PvE'de zindan ganimetini asla geçmeyen, yalnızca PvP'ye özgü bir donanım seti satın alır.
- **The Vale Cup**, Eastbrook'un güneyindeki kendi stadyumunda oynanan bir boarball ligi, ve **Card Duel**, kasabada düzenlenen hızlı, karşılıklı bir kart oyunu.
- **Bir Book of Deeds**: kozmetik unvanlardan, rozet çerçevelerinden ve Renown'dan oluşan bir başarım günlüğü; dünya içindeki Chronicler NPC'lerin tuttuğu bölge başına Chronicles ve ömür boyu bir lider tablosuyla birlikte.
- **Derin bir meslek ekonomisi**: dört toplama mesleği on zanaatı besler, aşçılık ve simyadan kuyumculuğa, silah ustalığına ve büyülemeye kadar; kademeli aletler, kasaba tezgahları, başyapıt kalitesi ve siparişlerle, hepsi oyuncu güdümlü bir **World Market**'e ve **Ravenpost** posta hizmetine akar.
- **Gerçek çok oyunculu**: gruplar ve raid'ler, loncalar, takas, düellolar, vuruş hakları, grup-bölünmüş XP, fısıltılar, uzakta durumu ve rol kuyruklarıyla hazır grup ilanları içeren bir **Dungeon Finder**.
- **3D düzenleyicide değil, kodda yazıldı**: arazi, su, hava, kasaba yerleşimleri, gerçek zamanlı gölgeler ve efektler çalışma zamanında üretilir; gönderilen modeller ise elde yontulmak yerine prosedürel fabrikalar ve özenle seçilmiş bir varlık kütüphanesi tarafından inşa edilir.
- Belirleyici, sim-anahtar-yayar bir boru hattı aracılığıyla **22 yerel ayara çevrilmiş**.
- **`/wiki` adresinde eşlik eden bir wiki**, doğrudan canlı oyun içeriğinden üretilir, böylece belgelediği dünyadan sapması mümkün değildir.
- **Her platformda yerel uygulamalar**: Windows, Linux ve macOS için otomatik güncellemeli ve isteğe bağlı Steam başarım yansıtmalı imzalı masaüstü yükleyicileri, ayrıca iOS ve Android yapıları, hepsi tarayıcı istemcisini ve aynı çevrimiçi dünyayı paylaşır.
- **Elindeki makineye ölçeklenir**: grafik ön ayarları ve otomatik bir kare hızı düzenleyicisi görsel zenginliği akıcılıkla takas eder ve bir oyuncunun tepki verdiği hiçbir şeyi gizlemelerini engelleyen bir adalet kuralına tabidir.
- Gymnasium bağlamaları, ödül şekillendirme ve bir kıyaslama modu içeren **başsız RL ortamı**.
- **$WOC yardımcı işlevi, tamamen isteğe bağlı**: sahiplik flair'i, Daily Rewards ve kozmetik mağazada indirimli bir ödeme seçeneği için bir Solana cüzdanı bağla. Oyun ücretsiz oynanabilir ve emanetsiz kalır.
- **Season 1 Armory**: fiat, SOL, USDC veya $WOC ile satın alınan Claudium'u kullanarak WOC Store üzerinden kozmetik silah kaplamaları topla. Kozmetikler asla savaş gücü sağlamaz.

## Ekran görüntüleri

![Eastbrook kasaba meydanı, kamp ateşi ve görev verenler](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Eastbrook kamp ateşinde alacakaranlık](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Eastbrook kamp ateşinde alacakaranlık* | ![Hollow Crypt'te seçkin çekişler](../../docs/screenshots/hollow-crypt.jpg)<br>*Hollow Crypt'te meşale ışığında seçkin çekişler* |
| ![Yıkık şapeldeki huzursuz ölüler](../../docs/screenshots/restless-dead.jpg)<br>*Yıkık şapeldeki huzursuz ölüler* | ![Vale Bandits ile bir kavga](../../docs/screenshots/vale-bandits.jpg)<br>*Haydut kampında sayıca üstün düşmana karşı* |
| ![Kuzey yolunda avlanan Old Greyjaw](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, ender ortaya çıkan, kuzey yolunda kıstırıldı* | ![Satıcı ve çanta arabirimi](../../docs/screenshots/vendor-and-bags.jpg)<br>*Trader Wilkes'ta donanım kuşanma, satıcı ve çantalar açıkken* |
| ![Glimmermere kıyısındaki ay geçidi](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Boğulmuşlar Glimmermere ay geçidinden çıkıyor* | ![Drowned Temple sunağındaki Ysolei](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest ve Drowned Temple'ın sunağı* |

Hava, biyom güdümlüdür ve yalnızca görüntülemeyle ilgilidir, bu yüzden belirleyici sime asla dokunmaz:

| | | |
|:---:|:---:|:---:|
| ![Eastbrook Vale üzerinde açık gökyüzü](../../docs/screenshots/weather-vale_clear.jpg)<br>*Vale üzerinde açık* | ![Mirefen Marsh üzerinde yağmur](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Mirefen Marsh üzerinde yağmur* | ![Thornpeak Heights üzerinde kar](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Thornpeak Heights üzerinde kar* |

## Oyna

Tarayıcında [worldofclaudecraft.com](https://worldofclaudecraft.com/) adresinde oyna veya Windows, Linux, macOS, iOS ya da Android için yerel uygulamayı kur. Her istemci aynı çevrimiçi dünyaya bağlanır.

### Çevrimiçi, diğer oyuncularla

Bir hesap oluştur, bir karakter oluştur ve canlı dünyaya gir. Aynı istemci/sunucu yığınını kendin çalıştırmak için aşağıdaki [Kendi dünyanı barındır](#host-your-own-world-one-command) bölümüne bak.

### Çevrimdışı, geliştirme sunucusunda

Çevrimdışı mod, hesabı ve sunucu yetkisi olmayan yerel tek oyunculu bir dünyadır, bu yüzden yalnızca geliştirme yapılarında gönderilir. Geliştirme sunucusunu çalıştır, mod seçicide belirir:

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

Karakterine isim ver, dokuz sınıftan herhangi birini seç ve merkezlerle çevrili bir pazar kasabası olan **Eastbrook Vale**'de (seviye 1-7) başla: kuzeyde kurt patikaları, doğuda yaban domuzu çayırları, batıda Sableweb ormanları, kuzeybatıda Mirror Lake, güneybatıda burrower'ların bastığı bir bakır kazısı ve kuzeydoğuda huzursuz ölülerin yıkık bir şapeli, güneydoğuda da Gorrak'ın haydut kampı. Kuzey yolu, bir dağ geçidinden **Mirefen Marsh**'a (6-13, merkez Fenbridge) ve oradan yukarıya **Thornpeak Heights**'a (13-20, merkez Highwatch) tırmanır. Dünya tohumu `src/main.ts` içinde sabittir, bu yüzden her ziyarette aynı yerdir.

### Windows, Linux ve macOS için masaüstü uygulamaları

World of ClaudeCraft, üç büyük masaüstü platformunun hepsi için eksiksiz masaüstü uygulamaları olarak gönderilir: imzalı Windows yükleyicileri, Linux AppImage ve deb paketleri, ayrıca imzalı ve noter onaylı evrensel macOS yapıları. Tarayıcıyla aynı oyun istemcisini ve aynı çevrimiçi dünyayı kullanırlar, üstüne yerel paketleme ve otomatik güncellemeler gelir.

Çevrimiçi oturum açma yalnızca Discord ve e-postadır, tam olarak web akışının aynısı: e-posta/parola uygulamanın içinde giriş yapar ve "Continue with Discord" varsayılan tarayıcını `/desktop-login` sayfasında açar; bu sayfa tek kullanımlık bir kodu `worldofclaudecraft://` derin bağlantısı üzerinden uygulamaya geri verir ve uygulama da onu normal bir World of ClaudeCraft oturum belirteciyle takas eder.

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

Kabuğu `VITE_DESKTOP_API_ORIGIN` ile farklı bir API'ye yönelt, örneğin yerel bir sunucuya veya bir hazırlık ana bilgisayarına:

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

Hazırlık yapıları için üretim API kaynağını `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` ile geçersiz kıl (bu bir DERLEME zamanı değeridir: pakete gömülür ve paketlenmiş uygulamaya damgalanır, kurulu yapılar ise onu çalışma zamanı ortam değişkeni olarak yok sayar). Steam bir dağıtım kanalıdır (aynı Electron paketi, SteamPipe ile yüklenir) ve masaüstü oyuncuları kazandıkları deed'leri Steam başarımlarına yansıtmak için bir Steam hesabı bağlayabilir; oturum açmanın kendisi e-posta ve Discord olarak kalır. Tam sürüm kılavuzu (imzalama, noter onayı, otomatik güncelleme yayımlama, SteamPipe depoları, sunucu dağıtımı) `docs/desktop-release.md` içindedir. iOS ve Android, kendi kılavuzu `docs/mobile-store-release.md` içinde olan Capacitor üzerinden gönderilir.

<a id="host-your-own-world-one-command"></a>

## Kendi dünyanı barındır (tek komut)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

**Uzaktan barındırma** için, compose yığınını herhangi bir VPS'e koy, ortamda gerçek bir `POSTGRES_PASSWORD` ayarla ve 8787 portunu bir TLS ters proxy ile öne al. Caddy bunu birkaç satıra indirir; WebSocket'ler otomatik olarak proxy'lenir ve istemci https sayfalarında otomatik olarak `wss://` seçer. Kimlik doğrulama uç noktaları hız sınırlıdır, parolalar scrypt ile karmalanır ve oturumlar sona erer. Üretimde asla `ALLOW_DEV_COMMANDS=1` ayarlama, çünkü tüm `/dev` hile setini etkinleştirir: test botlarının kullandığı seviye ve ışınlanma hilelerinin yanı sıra eşya verme, yaratık doğurma, örnek ışınlamaları ve oyun içi geliştirici komut arayüzü. [DEPLOY.md](../../DEPLOY.md), sağlık ve metrik uç noktalarını genel kenardan uzak tutan ters proxy yapılandırması dahil tam üretim kılavuzudur.

<a id="develop-online-with-hot-reload"></a>

### Sıcak yeniden yüklemeyle çevrimiçi geliştir

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api, /admin/api, and /ws)
```

http://localhost:5173 adresini aç, **Play Online**'ı seç, bir hesap oluştur, bir karakter oluştur ve Enter World. Karakter seçme ekranı, News & Updates panelinde en son sürüm haberlerini gösterir ve henüz görmediklerin için NEW rozetleri koyar. İkinci bir sekme aç ve birbirinizi kasabada görmek için tekrar giriş yap. `Enter` sohbeti açar. Oyuncu wiki'si, http://localhost:5173/wiki adresinde ve üretimde `/wiki` altında sunulan, depo içindeki Guide'dır; içeriği `npm run wiki:content` tarafından güncel oyun verisinden üretilir.

Neyin kalıcı olduğu ve sunucunun nasıl kontrolü elinde tuttuğu:

- **Hesaplar**: scrypt ile karmalanmış parolalar ve süresi dolan taşıyıcı belirteçleri.
- **Karakterler**: diyar başına hesap başına en fazla 10; seviye, donanım, çantalar, banka kasası, görevler, yetenekler, meslekler, PvP ve deed ilerlemesi, konum ve para Postgres'te JSONB olarak kalıcıdır, bir zamanlayıcıyla, çıkışta ve sunucu kapanışında kaydedilir. İsimler diyar başına benzersizdir ve klasik tarzdır.
- **Sunucu yetkilidir**: istemciler hareket niyetini ve komutları 20 Hz'de akıtır; sunucu tek paylaşılan `Sim`'i çalıştırır ve ilgi kapsamlı anlık görüntüler artı oyuncu başına olaylar döndürür. Her savaş zarı, ganimet düşüşü, görev kredisi ve satıcı işlemi sunucu tarafında çözülür. İstemci bir görüntüleyicidir.

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

env = WoWClassicEnv(player_class="warrior")   # any of the nine classes
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **Gözlem ve eylem uzayları içerikten türetilir.** Bunları sabit kodlamak yerine başlangıçta ortamın `info` yanıtından sorgula; oyunla birlikte büyürler. Eylem uzayı, hareketi, hedefi, saldırıyı, tam yetenek donanımını, etkileşimi ve yeme/içmeyi kapsayan bir `Discrete`'tir; gözlem ise kendini, yetenekleri, hedefi, yakındaki yaratıkları, en yakın etkileşilebiliri ve görev ilerlemesini kapsayan bir `Box`'tır.
- **Ödül**, tik başına sayaç farklarının ağırlıklı toplamıdır (XP, verilen ve alınan hasar, öldürmeler, ölümler, görev ilerlemesi, seviye atlamaları), her sıfırlamada ayarlanabilir. Her `step` bir eylem uygular ve varsayılan olarak beş sim tikini ilerletir, yani simüle edilen saniye başına kabaca dört karar.
- **Yapı gereği belirleyici.** Duvar saati yok, `Math.random` yok. Sıfırlamayı tohumla ve bölüm tam olarak yeniden oynar.

Protokol ve bağlamalar `headless/CLAUDE.md` ve `python/CLAUDE.md` içinde belgelenmiştir.

<a id="web3"></a>

## Web3

World of ClaudeCraft, Solana üzerindeki topluluk jetonumuz **$WOC** etrafında web3 yerlisidir. Bir Solana cüzdanı bağla, tek bir imzayla hesabına ilişkilendir (emanetsiz, onaylanacak işlem yok) ve salt okunur $WOC bakiyen, kozmetik bir sahiplik kademesi rozetinin yanında HUD'da görünür.

$WOC'un canlı oyunda isteğe bağlı bir yardımcı işlevi de vardır:

- **WOC Store**: tek yönlü kozmetik para birimi olan Claudium'u fiat, SOL, USDC veya $WOC ile satın al. $WOC ödeme rayı diğerlerine göre indirimlidir.
- **Season 1 Armory**: Claudium'u kozmetik silah kaplaması koleksiyonlarına harca. Mağaza satın alımları istatistik veya savaş gücü eklemez.
- **Daily Rewards**: uygun doğrulanmış sahipler, günlük bir çevirme ve dönüşümlü görevler aracılığıyla puan kazanabilir, sonra günlük ödül havuzundan bir pay için yarışabilir.

Bunların hiçbiri oynamak için gerekli değildir. Cüzdan ilişkilendirme isteğe bağlı ve emanetsizdir, kazan-için-öde yoktur ve tüm oyun bir cüzdan bağlamadan da gayet iyi oynanır.

**$WOC sözleşme adresi (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Jeton hakkında daha fazla bilgi: [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Dünyada bir tur

### Dokuz sınıf

Her sınıf, temelden uygulanmış klasik dönem MMO mekanikleriyle çalışır ve 1-20 seviyeleri boyunca dereceli büyüler öğrenir; Low Blow, Early Grave, Skyfall, Urgent Prayer ve Ancestral Strike gibi imza yetenekler tırmanışın ikinci yarısında açılır.

- **Warrior**: rage, Iron Bellow, Onrush, Quaking Blow, Maiming Strike, Gaping Wounds (vuruşlarına binen bir kanama), Widening Arc, Hobbling Cut, Blood Toll, Redhand (dodge proc).
- **Paladin**: Verdict ile salınan Oathbrand, Mending Light, Steadfast Aura, Oath of Iron, Ward of Faith (absorb), Sundering Gavel (stun), Last Rite.
- **Hunter**: menzilli otomatik saldırı (klasik tarzda ölü bölgeyle 8-35 yd), Gutting Strike, Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Counterfang, Fettering Slash ve seviye 10'dan itibaren evcilleştirilebilir bir evcil hayvan.
- **Rogue**: energy ve combo points, Wicked Slash, Dirt Nap, Craven Thrust (arkadan, hançer), Eye Jab, Ghostfoot, Cutthroat Tempo, Swift Heels.
- **Priest**: Smite, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding (absorb), Lingering Grace (HoT), Mindfracture.
- **Shaman**: Arc Bolt, Stonebound Weapon (imbue), Mending Waters, Earthen Jolt, Thunder Ward (thorns), Cinder Jolt.
- **Mage**: Cinderbolt, Hoarfrost Mantle, Aether Insight, Rimelance, Waterbind, Cinderfall, Aether Darts (channeled), Bewitch, Icebind, çağrılan bir su elementali ve bir zaman büyüsü iyileştirme uzmanlığı olan Chronomancy.
- **Warlock**: Gloom Bolt, Fiendhide, Burning Pact, Blackrot, Hard Bargain, Hex of Anguish, Consume ve Emberkin'den Wraithborn'a yedi çağrılabilir iblis.
- **Druid**: Wildbolt, Wildmend, Wildward, Lunar Tempest, Wildbloom, Briarguard, Gripping Roots ve 5'te Wolf Form, 8'de Bruin Form, 10'da Moonwing Form şekil değiştirmeleri.

İyileştirmeler ve buff'lar grup üyelerine iner, iyileştirme crit yapabilir ve absorb kalkanları sağlıktan önce hasarı emer. Puanları **sınıf başına üç yetenek uzmanlığı** boyunca harca (Battlecraft/Bloodrush/Ironguard, Moongrove/Wildfang/Groveheart ve benzeri); tahsis sunucu tarafından doğrulanır ve bir yapı dizesi olarak dışa aktarılabilir.

### Zindanlar

Gravecaller hikayesi üç beş oyunculu seçkin örnek boyunca akar, dördüncüsü kendi boğulmuş efsanesiyle bir ay geçidinin ardında bekler ve kaşifler için bir kenarda tek kişilik bir mahzen durur.

- **The Hollow Crypt** (5 oyuncu) Fallen Chapel'in altında: eşli seçkin döküntü, Sexton Marrow mini patronu ve Morthen the Gravecaller ile onun tekrarlayan gölge AoE'si. Mahzen kapısı grubunu, bir kez boşaldığında sıfırlanan özel bir örnek kopyasına ışınlar.
- **The Sunken Bastion** (5 oyuncu, seviye 13 civarı, güneydoğu Mirefen): Vael the Fogbinder, dövüş uzadıkça Drowned Thralls dalgaları çağırır.
- **Gravewyrm Sanctum** (5 oyuncu, seviye 20, Thornpeak'in altında): seçkin boneguard ve scaleguard içeren üç oda, Korgath the Bound, Grand Necromancer Velkhar ve epik silahların düştüğü Korzul the Gravewyrm.
- **The Drowned Temple** (5 oyuncu) Glimmermere ay geçidi boyunca: Choirmother Selthe'ye ve ardından, ay gelgitleri ve çağrılan Moonspawn'ları yerinde duran bir grubu cezalandıran Ysolei, Avatar of the Drowned Moon'a giden soluk, ay-moru bir örnek.
- **The Abandoned Crypt** (tek kişilik) Thornpeak'te: izi **Nythraxis, Scourge of Thornpeak**'e giden kraliyet kapısının mührünü açan, üç ruh wardstone'u boyunca savaşılan on oyunculu bir raid finaline götüren, tek kişi için sessiz bir kilit taşı ve günlük dalışı.

Her örnek **Heroic** olarak da çalışır: daha yüksek seviyeli düşmanlar, daha keskin mekanikler ve kendi ganimeti ile satıcı para birimi. Hazırlık görev zincirleri tek kişilik oynanabilir, böylece hikaye asla bir grup bulmanın arkasına kapatılmaz. Otomatik beş botlu raid'imiz (odak-ateş ve şifacı yapay zekasıyla warrior, paladin, priest, mage, hunter) Hollow Crypt'i yaklaşık beş dakikada temizler (`node scripts/crypt_raid.mjs`, `ALLOW_DEV_COMMANDS=1` gerektirir).

### Delve'ler

Delve'ler, bir veya iki oyuncu için ayrı, ölçeklenebilir bir küçük grup modudur; her seferinde rastgele odalardan yeniden inşa edilir ve bir ganimet zarı yerine kilit açma mini oyunuyla açılan kilitli bir kutsal emanet sandığında biter. **The Collapsed Reliquary** (seviye 7 ve üstü) Deacon Varric'te sona erer ve tek başına gidersen bir yapay zeka yoldaşı, Tessa, yanında savaşır. **The Drowned Litany** (seviye 12 ve üstü) izi Mirefen Marsh'ın kıyısındaki su basmış bir tapınağa kadar takip eder. Bir delve panosu kademeyi belirler: Heroic düşman seviyelerini yükseltir ve daha zengin ödüller için rastgele bir ek özellik ekler.

### Dereceli PvP (the Ashen Coliseum)

Sıraya girmek için `G`'ye veya arena butonuna bas. Eşleştirme dövüşçüleri özel bir çukura ışınlar, kısa bir geri sayım adil bir başlangıç için herkesi iyileştirir ve sıfırlar ve bir taraf pes ettiğinde maç biter. Kimse ölmez ve tam sıraya girdiğin yere geri dönersin. Protect Yumi, Coliseum çukurunda değil, kendi labirentinde oynanır.

- **1v1 ve 2v2 dereceli sıralamaları**, her biri kalıcı bir Elo tarzı derecelendirme ve tüm zamanların lider tablosuyla.
- **2v2 Fiesta**, takımların bir alaşağı hedefine koştuğu, güçlendirme toplamalarının güç dağıttığı ve kapanan bir halkanın kavgayı bir araya zorladığı daha canlı bir parti modu.
- **Protect Yumi**, bir labirentte oynanan, derecelendirilmemiş 3v3 ve 5v5 hedef modu: her takım bir kedi yoldaşını korurken diğer tarafınkini düşürmeye çalışır, bu yüzden refakat ve yakalamalar ham öldürmelerden daha çok önem taşır.

Dereceli galibiyetler ve Fiesta alaşağıları **Honor** kazandırır; kasabadaki levazımcı bunu bir Warfare donanım setiyle takas eder. Warfare yalnızca PvP'ye özgü bir istatistiktir, bu yüzden set düelloları kazanır ama PvE'de asla aynı kademedeki zindan ganimetini geçmez.

### Birlikte oynamak

- **Dungeon Finder**: zindanlara ve raid'lere göz atmak, patronları ve ganimeti incelemek, otomatik bir tank/şifacı/DPS rol kuyruğuna katılmak veya hazır bir grup ilanı oluşturmak için `Shift+I` ile aç. Finder ile kurulan gruplar yine de girişe birlikte gider.
- **Gruplar** en fazla 5 kişi, dolduğunda iki gruptan oluşan 10 oyunculu bir raid'e dönüşür: bir oyuncuya sağ tıkla ve Invite to Party. Üyeler vuruş haklarını ve görev kredisini paylaşır, XP'yi klasik dönem grup bonuslarıyla böler ve mini haritada nokta olarak görünür. Grup sohbeti için `/p`, ganimeti çözmek için `/roll`.
- **Takas**: sağ tıkla ve Trade. Her iki taraf eşyaları ve parayı sahneler, her ikisi de kabul etmeli ve takas atomiktir ve sunucu tarafından doğrulanır. Görev eşyaları takas edilemez ve uzaklaşmak iptal eder.
- **Düellolar**: sağ tıkla ve Challenge to a Duel. 3 saniyelik bir geri sayım, sonra bir taraf 1 hp'ye ulaşana kadar savaş; kazanan bölge çapında ilan edilir ve 60 yard öteye koşmak kaybettirir.
- **Vuruş hakları ve uzakta durumu**: bir yaratığa ilk hasar veren oyuncu onun ganimetine, XP'sine ve görev kredisine sahip olur; `/afk` ve `/dnd` seni, fısıltılara otomatik yanıtla uzakta olarak işaretler.

### Dünya ve sistemler

- **Meslekler** (`Shift+P`): dört toplama mesleği (madencilik, ormancılık, şifalı ot toplama, balıkçılık) on zanaatı besler, aşçılık ve simyadan silah ustalığına, kuyumculuğa ve büyülemeye kadar. Toplama aletleri hangi kaynakları işleyebileceğini belirleyen kademelerde gelir, üretim kasaba tezgahlarında yapılır ve ustanın imzasını taşıyan başyapıt kalitesi şansı vardır, ayrıca uzmanlaştıkça keşfedilecek bir arketip sistemi bulunur.
- **The World Market**: donanım, malzeme ve sarf malzemeleri için merkez kasabalardan göz atılabilen, oyuncu güdümlü bir müzayede evi.
- **Ravenpost postası**: diğer karakterlere eşya ve para gönder, ekler talep edilene kadar güvenle tutulur.
- **Loncalar**: tüzükler, kadrolar, rütbeler ve lonca sohbeti.
- **The Guide**: `/wiki` adresinde sınıfları, yaratıkları, bölgeleri ve deed'leri kapsayan, aranabilir site içi bir wiki; doğrudan canlı oyun içeriğinden üretilir, böylece belgelediği dünyadan sapması mümkün değildir.
- **The Vale Cup ve Card Duel**: Eastbrook'un güneyindeki Sowfield stadyumunda 1v1'den 5v5'e formatlarda boarball ve kasabada Card Master'ın düzenlediği hızlı, karşılıklı bir kart oyunu.
- **Daily Rewards**: doğrulanmış $WOC sahipleri günlük bir çevirmeden ve dönüşümlü görevlerden lider tablosu puanı kazanabilir, günlük ödül havuzundan otomatik ödemelerle.
- **WOC Store ve Season 1 Armory**: Claudium'u fiat, SOL, USDC veya $WOC ile satın al, sonra onu tamamen kozmetik silah kaplamalarına harca.
- **Yeme ve içme**: geri kazanmak için otur, hasar veya ayağa kalkmayla bozulur ve evet, aynı anda yiyip içebilirsin.
- Yiyecek ve su satın alan ve dürüst beyaz donanım satan **satıcılar**, parayı altın, gümüş ve bakır olarak gösterir.
- **Kişisel bir banka** (the Gilded Strongbox): her merkez kasabadaki kasadarlar karakter başına bir kasa tutar, 24 yuvadan parayla satın alınan genişletmelerle 96 yuvaya kadar, ayrıca doğrulanmış bir e-posta, ilişkilendirilmiş hesaplar ve davetlerle çevrimiçi kazanılan bonus yuvalar.
- **The Book of Deeds**: görevlerden, öldürmelerden, temizlemelerden ve keyiflerden oluşan bir başarım günlüğü (varsayılan `Shift+Z`); isim plakanda, sohbette ve tablolarda taşıyabileceğin kozmetik unvanlar öder, ayrıca peşinde olduğun deed'ler için bir HUD takipçisi, Chronicler NPC'lerin tuttuğu bölge başına Chronicles ve ömür boyu bir Renown lider tablosu içerir; genel liste `/wiki/deeds` adresinde bulunur.
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
| `C` `P` `L` `M` `B` `N` `T` | karakter, büyü kitabı, görev günlüğü, dünya haritası, çantalar, yetenekler, üretim |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | arena, arkadaşlar ve lonca, lider tablosu, takvim, Vale Cup, Dungeon Finder, meslekler, deed'ler |
| `Z` / `X` | silahlarını kınına sok veya çek, emote çarkı |
| `V` / `R` / `Esc` | isim plakaları, otomatik koşu, en üstteki pencereyi kapat (veya oyun menüsünü aç) |

Her tuş ataması, tuş atamaları panelinden yeniden eşlenebilir. Dokunmatik kontroller (bir hareket çubuğu, kamera sürükleme ve ekran üstü eylem butonları) mobilde otomatik olarak açılır.

## Mimari (tek sim, üç ana bilgisayar)

Üç fikir projeyi bir arada tutar:

- **Tek sim, üç ana bilgisayar.** Aynı `src/sim/` kodu çevrimdışı tarayıcı dünyasını, çevrimiçi sunucuyu ve RL ortamını çalıştırır. Davranış her yerde aynı olmalıdır ve testler bunu böyle tutmak için vardır.
- **`IWorld` tek dikiştir.** `IWorld`, `src/world_api/` altında alan başına facet arabirimleri olarak tanımlanır ve `src/world_api.ts` tarafından toplanır. Çevrimdışı `Sim` onu yapısal olarak karşılar ve çevrimiçi `ClientWorld` onu sunucu anlık görüntülerini yansıtarak uygular. Görüntüleyici ve HUD yalnızca `IWorld` ile konuşur, asla somut bir dünyayla değil, böylece yeni bir özellik önce ilgili facet'i ve sonra her iki dünyayı da genişletir.
- **Sunucu yetkilidir.** İstemciler niyet gönderir; sunucu sonuçlara karar verir. İstemci asla savaşı, ganimeti veya ekonomiyi kendi başına çözmez.

Sim sabit bir 20 Hz tiktir (`DT = 1/20`), tüm rastgelelik tek tohumlu bir `Rng` üzerinden akar ve `src/sim/` sıfır DOM, tarayıcı veya Three.js içe aktarması taşır. Aynı kodun bir Node ortam sunucusuna, yetkili bir oyun döngüsüne ve bir tarayıcı sekmesine tek bir satır değiştirmeden paketlenmesini sağlayan şey budur.

### Proje düzeni

| Yol | Ne olduğu |
|---|---|
| `src/sim/` | Belirleyici oyun çekirdeği, gerçeğin kaynağı. DOM veya Three bağımlılığı yok. |
| `src/sim/content/` | Kod olarak veri: dokuz sınıf, yetenekler, bölgeler, zindanlar, delve'ler, eşyalar, tarifler, büyülemeler, talent'ler, meslekler, deed'ler. |
| `src/world_api.ts` + `src/world_api/` | `IWorld`, görüntüleyicinin ve HUD'un bağlı olduğu dikiş: alan başına bir facet arabirimi. |
| `src/` (geri kalanı) | Three.js görüntüleyici, HUD ve stiller, girdi/ses, çevrimiçi ayna ve yönetici, rehber ile düzenleyici SPA'ları. |
| `server/` | Yetkili sunucu: HTTP ve WS, dünya döngüsü, Postgres, kimlik doğrulama, sosyal, denetleme. |
| `server/http/` | REST istek boru hattı: tablo yönlendirici, ara yazılım ve alan başına rota tanımları. |
| `headless/` + `python/` | RL ortam sunucusu (`env_server.ts`) ve Python Gym bağlamaları. |
| `bot/` | Discord botu (roller, aktarma, etkinlik akışı). |
| `electron/`, `android/`, `ios/` | Masaüstü (Steam) ve yerel mobil kabuklar. |
| `tests/` | Vitest paketi. |
| `scripts/` | Derleme, varlık, i18n, SFX, ekran görüntüsü ve tarayıcı E2E araçları. |
| `deploy/` · `mediawiki/` | Üretim ilk açılış varlıkları ve oyuncu wiki'si konteyneri. |
| `public/` · `docs/` | Statik varlıklar (siteye birebir dağıtılır) ve tasarım belgeleri. |

Bunların hiçbiri şeref sözüne bırakılmamıştır: `tests/architecture.test.ts` her sim
dosyasını yasak bir içe aktarma, bir DOM globali ya da başıboş bir saat veya `Math.random`
çağrısı için tarar ve `tests/world_api_parity.test.ts` dikişi sabitler, böylece iki dünya
birbirinden ayrışamaz.

Çoğu dizin yerel kurallarıyla kendi `CLAUDE.md`'sini taşır ve proje değişmezlerinin tam
seti kök [`CLAUDE.md`](../../CLAUDE.md) içinde bulunur. Ajan katkıcılar oradan başlar,
sonra kendi çalışma zamanlarının giriş noktasını alır: Codex için [`AGENTS.md`](../../AGENTS.md)
artı [Codex operatör kılavuzu](../codex.md), Gemini için [`GEMINI.md`](../../GEMINI.md).
Hepsi aynı kanonik mimariye akar.

## Klasikler gibi inşa edildi

Savaş, seviye atlama ve tehdit hepsi otantik klasik dönem kurallarıyla çalışır: rage ve energy, hit ve dodge tabloları, armor azaltma, gerçek XP eğrisi, vuruş zamanlayıcıları ve global cooldown. Yaklaşık olarak taklit etmek yerine hatırladığın gibi hissettirir. Okumak istersen kesin sayılar `src/sim/` içinde bulunur.

Dünya bir 3D düzenleyicide değil kodda yazılır ve onu küçük, belirleyici ve çatallaması
kolay tutan şey de budur:

- Arazi, su, hava, gökyüzü, kasaba yerleşimleri, gerçek zamanlı gölgeler ve savaş efektleri çalışma zamanında simin kendi verisinden üretilir.
- Gönderilen modeller de aynı şekilde inşa edilir: `scripts/assets/` altındaki prosedürel fabrikalar, projenin image-to-GLB boru hattı üzerinden belirleyici GLB'ler dışa aktarır, yanında özenle seçilmiş bir CC0 model kiti kütüphanesiyle. İskeletli yaratık ve karakter aileleri tam yürüme, saldırı, büyü yapma, oturma ve ölüm animasyonları taşır.
- Simgeler, gönderilmiş bir dosyası olmayan her şey için sanatı besteleyen katmanlı bir ressamdır, böylece hiçbir şey asla simgesiz kalmaz; yetenekler, eşyalar ve deed'ler için üzerine özenle seçilmiş boyalı sanat katmanlanır.
- Eksiksiz bir klasik HUD (birim çerçeveleri, eylem çubukları, ipuçları, görev günlüğü, dünya haritası, mini harita, yüzen savaş metni, the Book of Deeds), örneklenmiş konumsal ve arabirim ses efektleri ve depo içinde prosedürel olarak bestelenmiş, bölgeler, kasabalar, zindanlar ve savaş arasında çapraz solan akış remaster'ları olarak gönderilen bir müzik.

Gönderilen her varlık ve lisansı [CREDITS.md](../../CREDITS.md) içinde kayıtlıdır ve birlikte
gönderilen üçüncü taraf bağımlılıkları bildirimlerini [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) içinde taşır.

## Geliştirme

Oyun istemcisinin yanı sıra derleme, operatör panosunu, `/editor` adresindeki dünya
düzenleyicisini ve `/wiki` adresindeki genel Guide'ı üretir, hepsi aynı geliştirme sunucusundan sunulur.

Gate'in ve ses testlerinin kullandığı her FFmpeg yolu, birlikte gönderilen
`ffmpeg-static`/`ffprobe-static` npm paketlerini çözer, bu yüzden normal bir katkı için
sistemde FFmpeg kurulumu gerekmez. Uygunluk ölçen yollar (`npm run sfx:check`, ses testleri,
Studio'nun dışa aktarma doğrulaması) doğrudan statik ikili dosyalara bağlanır, `PATH` yedeği
olmadan: betikleri atlayan bir kurulum onları eksik bıraktıysa `npm ci` komutunu yeniden
çalıştır. Studio'nun oynatma ve kodlama süreçleri ile `npm run gate` ön kontrolü,
`PATH`'e geri düşen `scripts/sfx/ffmpeg_paths.mjs` üzerinden çözer. Bazı bağımsız ses
üretici betikleri (örneğin `scripts/gen_ui_sfx.mjs`) hâlâ varsayılan olarak `PATH` `ffmpeg` kullanır.

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

Mantık ve birim testleri Vitest kullanır. Yinelerken tek bir dosya çalıştır: `npx vitest run tests/sim.test.ts`. Arabirim değişikliklerinin ayrıca erişilebilirliği, klavye gezinmesini ve dokunma hedeflerini kapsayan, tercihe bağlı bir gerçek tarayıcı paketi vardır: `npm run test:browser`. Ekran görüntüsü ve smoke betikleri gerçek tarayıcıları `puppeteer-core` aracılığıyla sürer ve `npm run dev` çalışıyor olmasını gerektirir; ağ düzeyindeki betikler (`mp_integration.mjs`, `social_e2e.mjs`, `crypt_raid.mjs`) sunucuyla doğrudan konuşur ve bunun yerine `npm run server` gerektirir. Tarayıcı ajanları, basılı tuşları simüle etmek yerine hareketi `window.__game.controller` aracılığıyla sürebilir, örneğin `controller.move({ forward: true }, facingRadians)` veya `{ f: 1, sr: 1 }` gibi kompakt bayraklar.

Kontroller katmanlar hâlinde çalışır, [docs/qa-gate.md](../qa-gate.md) içinde açıklanmıştır:
klonunu `git config core.hooksPath .githooks` ile paylaşılan hook'lara yönelt, böylece
makinenden bir şey ayrılmadan önce hızlı bir taban kontrolü çalışır.

Sunucu komutları için yukarıdaki [Çevrimiçi geliştir](#develop-online-with-hot-reload),
katkı iş akışı için [CONTRIBUTING.md](CONTRIBUTING.tr_TR.md), ses üretimi ve
artefakt dışa aktarımı için [SFX Studio eğitimi](../sfx-studio-tutorial.md), üretim için
[DEPLOY.md](../../DEPLOY.md) ve varlık lisansları için
[CREDITS.md](../../CREDITS.md) dosyalarına bak.

## Yerelleştirme

Her oyuncuya görünür dize `t()` üzerinden çözülür ve oyun **22 yerel ayarda** gönderilir (İngilizce, iki İspanyolca, iki Fransızca, Kanada İngilizcesi, İtalyanca, Almanca, Basitleştirilmiş ve Geleneksel Çince, Korece, Japonca, Brezilya Portekizcesi, Rusça, Çekçe, Felemenkçe, Lehçe, Endonezce, Türkçe, İsveççe, Vietnamca ve Danca). Sim ve sunucu dilden bağımsız kalır: istemcinin sınırda yeniden yerelleştirdiği kararlı anahtarlar veya İngilizce yayarlar, bu da belirleyiciliği bozulmadan tutar. Katkıda bulunanlar yalnızca İngilizce ekler; bakımcı her sürümden önce diğer yerel ayarları toplu olarak doldurur. İş akışı `docs/i18n-scaling/translation-workflow.md` içinde belgelenmiştir.

## Katkıda bulunma

Her türlü katkı memnuniyetle karşılanır: kod, çeviriler, hata raporları ve belgeler. Kurulum için [CONTRIBUTING.md](CONTRIBUTING.tr_TR.md) ile başla, [Davranış Kuralları](../../CODE_OF_CONDUCT.md)'nı oku ve bir güvenlik açığı bildirmeden önce [SECURITY.md](../../SECURITY.md)'yi kontrol et. Burada yeni misin? [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue) etiketli sorunlara bak, bir [sorun](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) aç veya [Discord](https://discord.com/invite/worldofclaudecraft)'da merhaba de.

Aktif geliştirme en yeni `release/vX.Y.Z` dalında yürüyor. Varsaymak yerine hangisi olduğuna bak, sonra ondan dallan ve pull request'ini oraya yönelt. Asla `main` dalından dallanma veya onu hedefleme; `main` yalnızca o sürüm yayımlandığında bir sürüm dalı alır. [CONTRIBUTING.md](CONTRIBUTING.tr_TR.md), güncel olanı bulan tek satırlık komutu içerir.

## Lisans

**Kod [MIT lisanslıdır](../../LICENSE), o yüzden çatalla, yeniden düzenle ve kendi dünyanı barındır.** Bütün mesele bu ve ne bu sayfadaki ne de web sitemizdeki hiçbir şey bunu geri almaz.

Üç şey ayrı lisanslanır, bu yüzden hangisinin hangisi olduğunu bilmek otuz saniyeye değer:

| Ne | Lisans | Yeniden dağıtabilir misin? |
|---|---|---|
| **Kaynak kodu**, yani aşağıda ayrılan medya varlıkları dışındaki her şey | [MIT](../../LICENSE) | Evet. Ticari olarak da. |
| **Medya varlıkları**: modeller, dokular, HDRI'lar, simgeler, sesler, yazı tipleri (çoğunlukla `public/` altında) | Varlık başına, [CREDITS.md](../../CREDITS.md) içinde kayıtlı | Çoğunlukla evet (çoğu CC0). Bazıları değil, aşağıya bak. |
| **İsim ve marka**: "World of ClaudeCraft", "Levy Street", logolar | Lisanslanmamış | Hayır. |

**Çatalla ve kendi dünyanı barındır. Bu işe yarar ve varlıklar önünde engel değil.** Gördüklerinin çoğu CC0 kamu malıdır (KayKit, Quaternius, Kenney, ambientCG, Poly Haven) ve kendi ürettiğimiz aksesuarlar, yaratıklar, arka planlar ve arabirim sesleri projeyle birlikte gönderilir, böylece bir çatal kutudan çıkar çıkmaz çalışır. Sadece onları söküp bağımsız sanat olarak satamazsın.

Yeniden dağıtmadan önce kaldırman veya değiştirmen gerekenler:

- `public/ui/skills/` altındaki **CraftPix sınıf yetenek simgeleri** Levy Street tarafından satın alındı ve **yeniden dağıtılamaz**, o yüzden onları göndermek istiyorsan kendi lisansını satın al;
- **@jamiecypher ses efektleri** CC BY-NC 4.0'dır, yani onları atıfla ve ticari olmayan biçimde paylaş, ancak ticari izin yalnızca bu proje için geçerlidir;
- **mağaza ve prestij sanatı** (Season 1 Armory, Claudium seti, meslekler sanat seti, Book of Deeds simgeleri, seçkin ejderha amblemi) sipariş üzerine yapılmış ticari sanattır ve **hakları saklıdır**;
- **üçüncü taraf marka işaretleri** (Twitch, X, Kick, YouTube, Discord, Solana, USDC) sahiplerinin ticari markalarıdır ve onları lisanslamak bize düşmez;
- **izinle kullanılan bir avuç simge ve kayıt** başkasına geçirilmek için izin gerektirir.

[CREDITS.md](../../CREDITS.md) yetkili listedir ve varlık başına bir yeniden dağıtım sütunu içerir. Bir varlık orada listelenmişse, o lisans projenin MIT lisansının önüne geçer. O kayıt hâlâ tamamlanıyor, bu yüzden orada eksik olan bir medya varlığı serbest değil, kaydedilmemiş demektir: ona güvenmeden önce sor. Kaynak kodu için durum tersidir ve ayrılmayan her şey MIT'dir.

[Hizmet Şartlarımız](https://worldofclaudecraft.com/terms), worldofclaudecraft.com adresinde işlettiğimiz barındırılan oyunu kapsar: hesaplar, davranış kuralları, sanal eşyalar. MIT Lisansı'nın bu kaynak kodunda sana verdiği hakları kısıtlamazlar.
