<div align="center">

# World of ClaudeCraft

**Wykonuj questy, twórz drużyny i raiduj ręcznie zbudowany świat, za darmo w przeglądarce. Open source, web3 i online już teraz.**

**Oficjalna strona: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.34.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.pl_PL.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Čeština](README.cs_CZ.md) · [Nederlands](README.nl_NL.md) · **Polski** · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Zagraj teraz](https://worldofclaudecraft.com/) · [Postaw własny świat](#host-your-own-world-one-command) · [Wytrenuj agenta](#train-an-agent-headless-rl) · [Web3](#web3) · [Współtworzenie](CONTRIBUTING.pl_PL.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![Ekran tytułowy World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## Czym to jest

World of ClaudeCraft to kompletne MMO w stylu klasycznej ery, w które możesz zagrać już teraz w przeglądarce, postawić je samodzielnie jedną komendą, a nawet wytrenować agentów AI, by w nie grali. Jest darmowe, open source i dostępne na żywo pod adresem [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Jeden wspólny świat działa w trzech miejscach, wszystkie z tego samego rdzenia gry:

- **autorytatywny serwer wieloosobowy**, żywy świat, w który grasz na worldofclaudecraft.com, gdzie konta oparte na Postgres współdzielą jedno trwałe królestwo,
- **świat offline w przeglądarce**, lokalny jednoosobowy `Sim` dostarczany przez serwer deweloperski, przydatny przy pracy nad projektem i do przeczytania rdzenia gry od początku do końca,
- **bezgłowe środowisko RL**, gdzie Python steruje prawdziwą grą przez interfejs Gym.

Ten sam seed, ten sam świat, wszędzie. Duża część tego, co widzisz, wciąż jest rysowana z kodu w czasie działania, a reszta to wyselekcjonowany zestaw zasobów dostarczany razem z projektem, więc fork działa od razu.

## Najważniejsze cechy

- **Dziewięć klasycznych klas**, każda z pełnym zestawem w stylu klasycznej ery, który zyskuje rangi wraz z poziomami, plus pełny **system talentów** (trzy specjalizacje na klasę, 27 specjalizacji w sumie).
- **Trzy strefy otwartego świata** od poziomu 1 do 20, ponad 90 questów i jedna spójna fabuła o spisku Gravecaller.
- **Pięć instancjonowanych lochów**, cztery z nich to pięcioosobowe raidy elitarne, a jeden to samotna krypta, z elitarnym skalowaniem, mechanikami bossów AoE, lootem dopasowanym do archetypów klas, który składa się na zestawy tierowe, oraz **poziomem trudności Heroic** z bogatszymi nagrodami, a do tego **world bosses** w otwartym świecie i dziesięcioosobowy finał raidowy.
- **Dwa skalowalne delves**, tryb dla małej grupy jednego lub dwóch graczy plus towarzysz AI, odbudowywane z losowych komnat przy każdym wejściu, w poziomach Normal i Heroic.
- **Rankingowe PvP** na dwóch mapach areny: drabinki 1v1 i 2v2, żywszy tryb 2v2 Fiesta oraz **Protect Yumi**, tryb zadaniowy 3v3 i 5v5. Gra rankingowa płaci w Honor, za który kupuje się zestaw sprzętu wyłącznie do PvP, nigdy nieprzewyższający lootu z lochów w PvE.
- **The Vale Cup**, liga boarballa rozgrywana na własnym stadionie na południe od Eastbrook, oraz **Card Duel**, szybka gra karciana jeden na jednego prowadzona w mieście.
- **Book of Deeds**: dziennik osiągnięć z kosmetycznymi tytułami, obramowaniami odznak i Renown, z Chronicles dla każdej strefy prowadzonymi przez NPC typu Chronicler oraz z wieczną tablicą wyników.
- **Głęboka ekonomia profesji**: cztery profesje zbierackie zasilają dziesięć rzemiosł, od gotowania i alchemii po jubilerstwo, płatnerstwo i zaklinanie, z narzędziami w tierach, warsztatami w miastach, jakością masterwork i zleceniami, a wszystko to napędza sterowany przez graczy **World Market** oraz usługę pocztową **Ravenpost**.
- **Prawdziwy multiplayer**: drużyny i raidy, gildie, handel, pojedynki, prawa do lootu, dzielenie XP w drużynie, szepty, status nieobecności oraz **Dungeon Finder** z kolejkami ról i ogłoszeniami grup premade.
- **Tworzone w kodzie, nie w edytorze 3D**: teren, woda, pogoda, układy miast, cienie w czasie rzeczywistym i efekty są generowane w czasie działania, a modele, które faktycznie są dostarczane, powstają w proceduralnych fabrykach i w wyselekcjonowanej bibliotece zasobów, a nie z ręcznej rzeźby.
- **Zlokalizowane do 22 języków** przez deterministyczny potok, w którym sim emituje klucze.
- **Towarzysząca wiki pod `/wiki`**, generowana wprost z aktualnej zawartości gry, więc nie może rozjechać się ze światem, który opisuje.
- **Natywne aplikacje na każdą platformę**: podpisane instalatory desktopowe dla Windows, Linux i macOS z automatycznymi aktualizacjami i opcjonalnym odzwierciedlaniem osiągnięć Steam, plus buildy iOS i Android, wszystkie współdzielące klienta przeglądarkowego i ten sam świat online.
- **Skaluje się do maszyny, którą masz**: presety graficzne i automatyczny regulator liczby klatek wymieniają bogactwo wizualne na płynność, a trzyma je w ryzach zasada uczciwości, która nie pozwala im nigdy ukryć czegoś, na co gracz reaguje.
- **Bezgłowe środowisko RL** z powiązaniami Gymnasium, kształtowaniem nagrody i trybem benchmarku.
- **Użyteczność $WOC, w pełni opcjonalna**: powiąż portfel Solana, by uzyskać wyróżnienie posiadacza, Daily Rewards i tańszą opcję płatności w sklepie kosmetycznym. Gra pozostaje darmowa i niepowiernicza.
- **Season 1 Armory**: zbieraj kosmetyczne skiny broni w WOC Store, używając Claudium kupionego za walutę fiducjarną, SOL, USDC lub $WOC. Kosmetyki nigdy nie dają mocy bojowej.

## Zrzuty ekranu

![Rynek w Eastbrook, ognisko i questodawcy](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Zmierzch przy ognisku w Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Zmierzch przy ognisku w Eastbrook* | ![Elitarne pulle w the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Oświetlone pochodniami elitarne pulle w the Hollow Crypt* |
| ![Niespokojni umarli przy zrujnowanej kaplicy](../../docs/screenshots/restless-dead.jpg)<br>*Niespokojni umarli przy zrujnowanej kaplicy* | ![Bijatyka z Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*W przewadze liczebnej wroga w obozie bandytów* |
| ![Old Greyjaw dopadnięty na północnej drodze](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, rzadki spawn, dopadnięty na północnej drodze* | ![Interfejs sprzedawcy i toreb](../../docs/screenshots/vendor-and-bags.jpg)<br>*Zaopatrywanie się u Trader Wilkes, z otwartym oknem sprzedawcy i torbami* |
| ![Brama księżycowa na brzegu Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Utopieni wychodzą przy bramie księżycowej w Glimmermere* | ![Ysolei na ołtarzu the Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest i ołtarz the Drowned Temple* |

Pogoda jest sterowana biomami i istnieje tylko w warstwie renderowania, więc nigdy nie dotyka deterministycznego sima:

| | | |
|:---:|:---:|:---:|
| ![Czyste niebo nad Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Pogodnie nad Vale* | ![Deszcz nad Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Deszcz nad Mirefen Marsh* | ![Śnieg na Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Śnieg na Thornpeak Heights* |

## Zagraj

Graj w przeglądarce na [worldofclaudecraft.com](https://worldofclaudecraft.com/) albo zainstaluj natywną aplikację na Windows, Linux, macOS, iOS lub Android. Każdy klient łączy się z tym samym światem online.

### Online, z innymi graczami

Utwórz konto, utwórz postać i wejdź do żywego świata. Aby samodzielnie uruchomić ten sam stos klient/serwer, zobacz [Postaw własny świat](#host-your-own-world-one-command) poniżej.

### Offline, na serwerze deweloperskim

Tryb offline to lokalny świat jednoosobowy bez konta i bez autorytetu serwera, więc jest dostarczany wyłącznie w buildach deweloperskich. Uruchom serwer deweloperski, a pojawi się w wyborze trybu:

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

Nazwij swoją postać, wybierz jedną z dziewięciu klas i zaczynasz w **Eastbrook Vale** (poziomy 1-7), miasteczku targowym otoczonym węzłami: ścieżki wilków na północy, łąki dzików na wschodzie, lasy Sableweb na zachodzie, Mirror Lake na północnym zachodzie, opanowany przez drążycieli wykop miedzi na południowym zachodzie i zrujnowana kaplica niespokojnych umarłych na północnym wschodzie, z obozem bandytów Gorrak na południowym wschodzie. Północna droga wspina się przez przełęcz górską do **Mirefen Marsh** (6-13, węzeł Fenbridge), a dalej w górę do **Thornpeak Heights** (13-20, węzeł Highwatch). Seed świata jest ustalony w `src/sim/world_seed.ts`, więc to to samo miejsce przy każdej wizycie.

### Aplikacje desktopowe na Windows, Linux i macOS

World of ClaudeCraft jest dostarczany jako pełne aplikacje desktopowe na wszystkie trzy główne platformy: podpisane instalatory Windows, pakiety Linux AppImage i deb oraz podpisane i notaryzowane uniwersalne buildy macOS. Używają tego samego klienta gry i tego samego świata online co przeglądarka, z natywnym pakowaniem i automatycznymi aktualizacjami.

Logowanie online odbywa się wyłącznie przez Discord i e-mail, dokładnie tak jak w wersji webowej: e-mail i hasło logują wewnątrz aplikacji, a „Continue with Discord” otwiera domyślną przeglądarkę na stronie `/desktop-login`, która przekazuje aplikacji jednorazowy kod przez głęboki link `worldofclaudecraft://`, wymieniany następnie na zwykły token sesji World of ClaudeCraft.

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

Skieruj powłokę na inne API przez `VITE_DESKTOP_API_ORIGIN`, na przykład na lokalny serwer albo host stagingowy:

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

Produkcyjne origin API dla buildów stagingowych nadpiszesz przez `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` (to wartość z czasu BUDOWANIA: jest wbudowywana w bundle i stemplowana w spakowanej aplikacji, a zainstalowane buildy ignorują ją jako zmienną środowiskową w czasie działania). Steam jest kanałem dystrybucji (ten sam bundle Electron, wysyłany przez SteamPipe), a gracze na desktopie mogą powiązać konto Steam, by odzwierciedlać zdobyte deeds w osiągnięciach Steam; samo logowanie pozostaje przy e-mailu i Discordzie. Pełny runbook wydawniczy (podpisywanie, notaryzacja, publikowanie automatycznej aktualizacji, depoty SteamPipe, wdrożenie serwera) to `docs/desktop-release.md`. iOS i Android są dostarczane przez Capacitor, z własnym runbookiem w `docs/mobile-store-release.md`.

<a id="host-your-own-world-one-command"></a>

## Postaw własny świat (jedną komendą)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Aby **hostować zdalnie**, umieść stos compose na dowolnym VPS, ustaw prawdziwe `POSTGRES_PASSWORD` w środowisku i wystaw port 8787 za odwrotnym proxy z TLS. W Caddy to kilka linijek; WebSockety są proxowane automatycznie, a klient sam wybiera `wss://` na stronach https. Punkty końcowe uwierzytelniania mają limit zapytań, hasła są haszowane przez scrypt, a sesje logowania wygasają. Nigdy nie ustawiaj `ALLOW_DEV_COMMANDS=1` na produkcji, ponieważ włącza to pełny zestaw cheatów `/dev`: cheaty na poziom i teleportację, których używają boty testowe, a do tego przyznawanie przedmiotów, spawnowanie mobów, teleportację do instancji i wbudowany w grę interfejs komend deweloperskich. [DEPLOY.md](../../DEPLOY.md) to pełny przewodnik produkcyjny, razem z konfiguracją odwrotnego proxy, która trzyma punkty końcowe zdrowia i metryk poza publiczną krawędzią.

<a id="develop-online-with-hot-reload"></a>

### Rozwijaj online z hot reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api, /admin/api, and /ws)
```

Otwórz http://localhost:5173, wybierz **Play Online**, utwórz konto, utwórz postać i wejdź do świata (Enter World). Ekran wyboru postaci pokazuje najnowsze wiadomości wydawnicze w panelu News & Updates, z odznakami NEW przy wszystkim, czego jeszcze nie widziałeś. Otwórz drugą kartę i zaloguj się ponownie, by zobaczyć się nawzajem w mieście. `Enter` otwiera czat. Wiki gracza to Guide leżący w repozytorium, serwowany pod http://localhost:5173/wiki oraz pod `/wiki` na produkcji; jego treść jest generowana z aktualnych danych gry komendą `npm run wiki:content`.

Co jest zachowywane i jak serwer pozostaje u steru:

- **Konta**: hasła haszowane przez scrypt i wygasające tokeny bearer.
- **Postacie**: do 10 na konto w każdym królestwie; poziom, ekwipunek, torby, skarbiec bankowy, questy, talenty, profesje, postęp PvP i deeds, pozycja oraz pieniądze są zachowywane jako JSONB w Postgres, zapisywane na timerze, przy wylogowaniu i przy wyłączeniu serwera. Imiona są unikalne w obrębie królestwa i utrzymane w klasycznym stylu.
- **Serwer jest autorytatywny**: klienci strumieniują intencję ruchu i komendy z częstotliwością 20 Hz; serwer uruchamia jeden wspólny `Sim` i zwraca migawki ograniczone zakresem zainteresowania plus zdarzenia dla każdego gracza. Każdy rzut walki, drop lootu, zaliczenie questa i transakcja u sprzedawcy są rozstrzygane po stronie serwera. Klient jest renderem.

<a id="train-an-agent-headless-rl"></a>

## Wytrenuj agenta (bezgłowe RL)

Ten sam deterministyczny rdzeń działa jako środowisko [Gymnasium](https://gymnasium.farama.org/), więc agent uczy się na prawdziwej grze, a nie na jej reimplementacji. Serwer środowiska (`headless/env_server.ts`) opakowuje jeden `Sim` i mówi JSON-em rozdzielanym znakami nowej linii przez stdio; powiązania Pythona w `python/` uruchamiają go jako podproces i wystawiają zwykłą pętlę `reset` / `step` / `close`.

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

- **Przestrzenie obserwacji i akcji wywodzą się z zawartości.** Odpytuj o nie z odpowiedzi `info` środowiska przy starcie, zamiast je zakodować na sztywno; rosną wraz z grą. Przestrzeń akcji to `Discrete` obejmujące ruch, cel, atak, pełny zestaw umiejętności, interakcję oraz jedzenie i picie; obserwacja to `Box` obejmujące gracza, umiejętności, cel, pobliskie moby, najbliższy obiekt interaktywny i postęp questów.
- **Nagroda** to ważona suma przyrostów liczników na tick (XP, zadane i otrzymane obrażenia, zabójstwa, śmierci, postęp questów, awanse), regulowana przy każdym resecie. Każdy `step` stosuje jedną akcję i domyślnie posuwa o pięć ticków sima, czyli mniej więcej cztery decyzje na symulowaną sekundę.
- **Deterministyczne z założenia.** Brak zegara ściennego, brak `Math.random`. Zaseeduj reset, a epizod odtworzy się dokładnie.

Protokół i powiązania są udokumentowane w `headless/CLAUDE.md` i `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft jest natywnie web3 wokół **$WOC**, naszego społecznościowego tokena na Solana. Połącz portfel Solana, powiąż go z kontem jednym podpisem (niepowiernicze, brak transakcji do zatwierdzenia), a twoje tylko do odczytu saldo $WOC pojawi się w HUD obok kosmetycznej odznaki poziomu posiadacza.

$WOC ma też opcjonalną użyteczność w żywej grze:

- **WOC Store**: kupuj Claudium, jednokierunkową walutę kosmetyczną, za walutę fiducjarną, SOL, USDC lub $WOC. Ścieżka płatności $WOC jest tańsza od pozostałych.
- **Season 1 Armory**: wydawaj Claudium na kolekcje kosmetycznych skinów broni. Zakupy w sklepie nie dodają statystyk ani mocy bojowej.
- **Daily Rewards**: uprawnieni zweryfikowani posiadacze mogą zdobywać punkty przez codzienne losowanie i rotujące zadania, a potem rywalizować o udział w dziennej puli nagród.

Nic z tego nie jest potrzebne do gry. Powiązanie portfela jest opcjonalne i niepowiernicze, nie ma pay-to-win, a cała gra działa świetnie bez ani jednego połączenia portfela.

**Adres kontraktu $WOC (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Więcej o tokenie na [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Wycieczka po świecie

### Dziewięć klas

Każda klasa korzysta z mechanik MMO klasycznej ery zaimplementowanych od podstaw i uczy się zaklęć z rangami w poziomach 1-20, a sygnaturowe umiejętności jak Low Blow, Early Grave, Skyfall, Urgent Prayer i Ancestral Strike odblokowują się w drugiej połowie wspinaczki.

- **Warrior**: rage, Iron Bellow, Onrush, Quaking Blow, Maiming Strike, Gaping Wounds (krwawienie towarzyszące twoim uderzeniom), Widening Arc, Hobbling Cut, Blood Toll, Redhand (proc z uniku).
- **Paladin**: Oathbrand uwalniane przez Verdict, Mending Light, Steadfast Aura, Oath of Iron, Ward of Faith (absorpcja), Sundering Gavel (ogłuszenie), Last Rite.
- **Hunter**: dystansowy autoatak (8-35 yd z martwą strefą w klasycznym stylu), Gutting Strike, Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Counterfang, Fettering Slash oraz oswajalny zwierzak od poziomu 10.
- **Rogue**: energia i punkty combo, Wicked Slash, Dirt Nap, Craven Thrust (od tyłu, sztylet), Eye Jab, Ghostfoot, Cutthroat Tempo, Swift Heels.
- **Priest**: Smite, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding (absorpcja), Lingering Grace (HoT), Mindfracture.
- **Shaman**: Arc Bolt, Stonebound Weapon (nasączenie), Mending Waters, Earthen Jolt, Thunder Ward (kolce), Cinder Jolt.
- **Mage**: Cinderbolt, Hoarfrost Mantle, Aether Insight, Rimelance, Waterbind, Cinderfall, Aether Darts (kanałowane), Bewitch, Icebind, przyzywany żywiołak wody oraz Chronomancy, lecznicza specjalizacja oparta na magii czasu.
- **Warlock**: Gloom Bolt, Fiendhide, Burning Pact, Blackrot, Hard Bargain, Hex of Anguish, Consume oraz siedem przyzywalnych demonów od Emberkin do Wraithborn.
- **Druid**: Wildbolt, Wildmend, Wildward, Lunar Tempest, Wildbloom, Briarguard, Gripping Roots oraz przemiana w Wolf Form na 5, Bruin Form na 8 i Moonwing Form na 10.

Leczenie i wzmocnienia trafiają w członków drużyny, leczenie może trafić krytycznie, a tarcze absorpcyjne pochłaniają obrażenia przed zdrowiem. Wydawaj punkty w **trzech specjalizacjach talentów na klasę** (Battlecraft/Bloodrush/Ironguard, Moongrove/Wildfang/Groveheart i tak dalej); alokacja jest walidowana po stronie serwera i eksportowalna jako ciąg buildu.

### Lochy

Fabuła Gravecaller przebiega przez trzy pięcioosobowe instancje elitarne, czwarta czeka za bramą księżycową z własną opowieścią o utopionych, a samotna krypta stoi z boku dla odkrywców.

- **The Hollow Crypt** (5 graczy) pod the Fallen Chapel: sparowany elitarny trash, miniboss Sexton Marrow oraz Morthen the Gravecaller z powracającym cieniem AoE. Drzwi krypty teleportują twoją drużynę do prywatnej kopii instancji, która resetuje się, gdy tylko opustoszeje.
- **The Sunken Bastion** (5 graczy, około poziomu 13, południowo-wschodni Mirefen): Vael the Fogbinder przyzywa fale Drowned Thralls, im dłużej trwa walka.
- **Gravewyrm Sanctum** (5 graczy, poziom 20, pod Thornpeak): trzy komnaty elitarnych kościanych i łuskowych strażników, Korgath the Bound, Grand Necromancer Velkhar oraz Korzul the Gravewyrm, gdzie wypada epicka broń.
- **The Drowned Temple** (5 graczy) przez bramę księżycową Glimmermere: blada, księżycowo-fioletowa instancja prowadząca do Choirmother Selthe, a potem do Ysolei, Avatar of the Drowned Moon, której księżycowe przypływy i przyzywane Moonspawn karzą grupę stojącą w miejscu.
- **The Abandoned Crypt** (solo) w Thornpeak: cicha wyprawa z kluczem i pamiętnikiem dla jednego, której trop odpieczętowuje królewskie drzwi do **Nythraxis, Scourge of Thornpeak**, dziesięcioosobowego finału raidu rozgrywanego na trzech kamieniach strażniczych dusz.

Każda instancja działa też w wersji **Heroic**: wyżej poziomowani przeciwnicy, ostrzejsze mechaniki oraz własny loot i waluta u sprzedawcy. Prowadzące do nich łańcuchy questów da się przejść solo, więc fabuła nigdy nie jest zablokowana za znalezieniem grupy. Nasz zautomatyzowany raid pięciu botów (warrior, paladin, priest, mage, hunter ze skupionym ostrzałem i AI uzdrowiciela) czyści the Hollow Crypt w jakieś pięć minut (`node scripts/crypt_raid.mjs`, wymaga `ALLOW_DEV_COMMANDS=1`).

### Delves

Delves to osobny, skalowalny tryb dla małej grupy jednego lub dwóch graczy, odbudowywany z losowych komnat przy każdym wejściu i kończący się na zamkniętej skrzyni relikwiarza, którą otwiera minigra we włamywanie zamiast rzutu na loot. **The Collapsed Reliquary** (poziom 7 i wyżej) kończy się na Deacon Varric, a jeśli idziesz sam, u twojego boku walczy towarzyszka AI, Tessa. **The Drowned Litany** (poziom 12 i wyżej) prowadzi tropem do zalanej świątyni na skraju Mirefen Marsh. Tablica delves ustala poziom trudności: Heroic podnosi poziomy wrogów i dodaje losowy afiks dla bogatszych nagród.

### Rankingowe PvP (the Ashen Coliseum)

Naciśnij `G` lub przycisk areny, by dołączyć do kolejki. Dobieranie graczy teleportuje wojowników na prywatną arenę, krótkie odliczanie leczy i resetuje wszystkich dla uczciwego startu, a starcie kończy się, gdy jedna strona się poddaje. Nikt nie ginie, a wracasz dokładnie tam, gdzie dołączyłeś do kolejki. Protect Yumi rozgrywa się we własnym labiryncie, a nie na arenie Coliseum.

- **Rankingowe drabinki 1v1 i 2v2**, każda z trwałym rankingiem w stylu Elo i wieczną tablicą wyników.
- **2v2 Fiesta**, żywszy tryb drużynowy, w którym zespoły ścigają się do progu pokonanych, zbierane wzmocnienia rozdają moc, a zamykający się pierścień zmusza do wspólnej walki.
- **Protect Yumi**, nierankingowy tryb zadaniowy 3v3 i 5v5 rozgrywany w labiryncie: każda drużyna pilnuje kociego chowańca i próbuje ubić chowańca przeciwników, więc eskorty i wyłapywanie celów liczą się bardziej niż same zabójstwa.

Rankingowe zwycięstwa i pokonani w Fiesta płacą w **Honor**, który kwatermistrz w mieście wymienia na zestaw sprzętu Warfare. Warfare to statystyka wyłącznie PvP, więc zestaw wygrywa pojedynki, nigdy nie przewyższając lootu z lochów tego samego tieru w PvE.

### Gra razem

- **Dungeon Finder**: otwórz go przez `Shift+I`, by przeglądać lochy i raidy, oglądać bossów i loot, dołączyć do automatycznej kolejki ról tank/uzdrowiciel/DPS albo wystawić ogłoszenie grupy premade. Grupy złożone przez Finder i tak wędrują do wejścia razem.
- **Drużyny** do 5, zamieniane w dziesięcioosobowy raid z dwóch grup, gdy się zapełnią: kliknij gracza prawym przyciskiem i Invite to Party. Członkowie dzielą prawa do lootu i zaliczenie questów, dzielą XP z bonusami grupowymi klasycznej ery i pojawiają się jako punkty na minimapie. `/p` na czat drużyny, `/roll` na rozstrzygnięcie lootu.
- **Handel**: kliknij prawym przyciskiem i Trade. Obie strony wystawiają przedmioty i pieniądze, obie muszą zaakceptować, a wymiana jest atomowa i walidowana po stronie serwera. Przedmiotów questowych nie da się wymieniać, a rozejście się anuluje transakcję.
- **Pojedynki**: kliknij prawym przyciskiem i Challenge to a Duel. 3-sekundowe odliczanie, potem walka do momentu, aż jedna strona trafi w 1 hp; zwycięzca jest ogłaszany na całą strefę, a odbiegnięcie na 60 jardów oznacza poddanie.
- **Prawa do lootu i status nieobecności**: pierwszy gracz, który zrani moba, posiada jego loot, XP i zaliczenie questa; `/afk` i `/dnd` oznaczają cię jako nieobecnego z automatyczną odpowiedzią na szepty.

### Świat i systemy

- **Profesje** (`Shift+P`): cztery profesje zbierackie (górnictwo, drwalstwo, zielarstwo, rybołówstwo) zasilają dziesięć rzemiosł, od gotowania i alchemii po płatnerstwo, jubilerstwo i zaklinanie. Narzędzia zbierackie mają tiery, które decydują, przy których żyłach możesz pracować, rzemiosło toczy się przy miejskich warsztatach z szansą na jakość masterwork niosącą znak twórcy, a w miarę specjalizacji odkrywasz system archetypów.
- **The World Market**: napędzany przez graczy dom aukcyjny dla sprzętu, materiałów i mikstur, przeglądany z miast węzłowych.
- **Poczta Ravenpost**: wysyłaj przedmioty i monety innym postaciom, a załączniki czekają bezpiecznie do odebrania.
- **Gildie**: statuty, listy członków, rangi i czat gildii.
- **The Guide**: przeszukiwalna wiki w witrynie pod `/wiki`, obejmująca klasy, stworzenia, strefy i deeds, generowana wprost z aktualnej zawartości gry, więc nie może rozjechać się ze światem, który opisuje.
- **The Vale Cup i Card Duel**: boarball na stadionie Sowfield na południe od Eastbrook, w formatach od 1v1 do 5v5, oraz szybka gra karciana jeden na jednego prowadzona przez Card Mastera w mieście.
- **Daily Rewards**: zweryfikowani posiadacze $WOC mogą zdobywać punkty do tablicy wyników z codziennego losowania i rotujących zadań, z automatycznymi wypłatami z dziennej puli nagród.
- **WOC Store i Season 1 Armory**: kupuj Claudium za walutę fiducjarną, SOL, USDC lub $WOC, a potem wydawaj je na czysto kosmetyczne skiny broni.
- **Jedzenie i picie**: usiądź, by regenerować, przerywane przez obrażenia lub wstanie, i tak, możesz jeść i pić naraz.
- **Sprzedawcy**, którzy kupują jedzenie i wodę oraz sprzedają uczciwy biały sprzęt, z monetami pokazanymi w złocie, srebrze i miedzi.
- **Osobisty bank** (the Gilded Strongbox): szafarze w każdym mieście węzłowym trzymają skarbiec dla każdej postaci, od 24 slotów aż do 96 z rozszerzeniami kupowanymi za monety, plus dodatkowe sloty zdobywane online za zweryfikowany e-mail, powiązane konta i polecenia.
- **The Book of Deeds**: dziennik osiągnięć (domyślnie `Shift+Z`) z questów, zabójstw, przejść i ciekawostek, wypłacający kosmetyczne tytuły, które możesz nosić na plakietce, na czacie i na tablicach, plus tracker w HUD dla deeds, za którymi gonisz, Chronicles dla każdej strefy prowadzone przez NPC typu Chronicler i wieczna tablica wyników Renown; publiczna lista mieszka pod `/wiki/deeds`.
- **AI mobów**: wędrowanie, agresja na bliskość zależna od różnicy poziomów, pulle społeczne, pościg, smycz i reset, loot z trupa i respawny, z rzadkim spawnem (Old Greyjaw) na długim liczniku.
- **Łowiska** z własnymi tabelami lootu i rzadkimi połowami.
- **Kosmetyczne skiny** losowane w rzadkości uncommon, rare i epic, czysto dla wyglądu.
- **Śmierć i powrót**: uwolnij ducha do cmentarza, otrzymuj obrażenia od upadku i zwalniaj podczas pływania.
- **Pogoda biomów**: pogodnie w Vale, deszcz w Marsh, śnieg na Peaks, z płynnym przejściem, gdy przemieszczasz się między strefami.

### Sterowanie (klasyczny układ)

| Wejście | Akcja |
|---|---|
| `W` / `S` | bieg / cofanie. `A`/`D` skręt (strafe z wciśniętym prawym przyciskiem myszy), `Q`/`E` strafe |
| przeciąganie prawym / lewym | rozglądanie się / orbita kamery. Kółko przybliża, `Space` skacze |
| `Tab` | przełączanie najbliższych wrogów. Lewy przycisk wybiera cel, prawy atakuje, lootuje lub rozmawia |
| `1`-`9`, `0`, `-`, `=` | pasek akcji |
| `F` | interakcja (zlootuj trupa, podnieś obiekt, rozmawiaj) |
| `C` `P` `L` `M` `B` `N` `T` | postać, księga zaklęć, dziennik questów, mapa świata, torby, talenty, rzemiosło |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | arena, znajomi i gildia, tablica wyników, kalendarz, Vale Cup, Dungeon Finder, profesje, deeds |
| `Z` / `X` | schowaj lub dobądź broń, koło emotek |
| `V` / `R` / `Esc` | plakietki, autobieg, zamknij wierzchnie okno (lub otwórz menu gry) |

Każdy skrót da się przemapować w panelu klawiszologii. Sterowanie dotykowe (gałka ruchu, przeciąganie kamery i przyciski akcji na ekranie) pojawia się automatycznie na urządzeniach mobilnych.

## Architektura (jeden sim, trzy hosty)

Projekt spinają trzy idee:

- **Jeden sim, trzy hosty.** Ten sam kod `src/sim/` uruchamia świat offline w przeglądarce, serwer online i środowisko RL. Zachowanie musi być wszędzie identyczne, a testy istnieją po to, by tak pozostało.
- **`IWorld` jest jedynym szwem.** `IWorld` jest zdefiniowany jako interfejsy fasetowe per domena w `src/world_api/`, agregowane przez `src/world_api.ts`. Offline'owy `Sim` spełnia go strukturalnie, a online'owy `ClientWorld` implementuje go, odzwierciedlając migawki serwera. Render i HUD rozmawiają tylko z `IWorld`, nigdy z konkretnym światem, więc nowa funkcja najpierw rozszerza odpowiednią fasetę, a potem oba światy.
- **Serwer jest autorytatywny.** Klienci wysyłają intencję; serwer decyduje o wynikach. Klient nigdy nie rozstrzyga sam walki, lootu ani ekonomii.

Sim to stały tick 20 Hz (`DT = 1/20`), cała losowość płynie przez jeden zaseedowany `Rng`, a `src/sim/` nie niesie żadnych importów DOM, przeglądarki ani Three.js. To właśnie pozwala temu samemu kodowi zbundlować się w serwer środowiska Node, autorytatywną pętlę gry i kartę przeglądarki bez zmiany ani jednej linii.

### Układ projektu

| Ścieżka | Co to jest |
|---|---|
| `src/sim/` | Deterministyczny rdzeń gry, źródło prawdy. Brak zależności DOM ani Three. |
| `src/sim/content/` | Dane jako kod: dziewięć klas, umiejętności, strefy, lochy, delves, przedmioty, receptury, zaklęcia, talenty, profesje, deeds. |
| `src/world_api.ts` + `src/world_api/` | `IWorld`, szew, od którego zależą render i HUD: jeden interfejs fasetowy na domenę. |
| `src/` (reszta) | Render Three.js, HUD i style, wejście/audio, lustro online oraz SPA panelu administratora, przewodnika i edytora. |
| `server/` | Autorytatywny serwer: HTTP i WS, pętla świata, Postgres, uwierzytelnianie, funkcje społeczne, moderacja. |
| `server/http/` | Potok żądań REST: router tablicowy, middleware i definicje tras per domena. |
| `headless/` + `python/` | Serwer środowiska RL (`env_server.ts`) i powiązania Python Gym. |
| `bot/` | Bot Discord (role, przekaz, kanał aktywności). |
| `electron/`, `android/`, `ios/` | Powłoki desktopowa (Steam) i natywne mobilne. |
| `tests/` | Zestaw Vitest. |
| `scripts/` | Narzędzia do budowania, zasobów, i18n, SFX, zrzutów ekranu i przeglądarkowego E2E. |
| `deploy/` · `mediawiki/` | Zasoby pierwszego uruchomienia na produkcji i kontener wiki gracza. |
| `public/` · `docs/` | Statyczne zasoby (wdrażane na stronę bez zmian) i dokumenty projektowe. |

Nic z tego nie stoi na słowie honoru: `tests/architecture.test.ts` przeczesuje każdy plik
sima w poszukiwaniu zakazanego importu, globalnej zmiennej DOM albo zabłąkanego wywołania
zegara czy `Math.random`, a `tests/world_api_parity.test.ts` przypina szew, żeby oba światy
nie mogły się rozjechać.

Większość katalogów niesie własny `CLAUDE.md` z lokalnymi konwencjami, a pełen zestaw
niezmienników projektu mieszka w głównym [`CLAUDE.md`](../../CLAUDE.md). Współtwórcy będący
agentami zaczynają właśnie tam, a potem biorą punkt wejścia swojego środowiska:
[`AGENTS.md`](../../AGENTS.md) plus [przewodnik operatora Codex](../codex.md) dla Codeksa,
[`GEMINI.md`](../../GEMINI.md) dla Gemini. Wszystkie prowadzą do tej samej kanonicznej
architektury.

## Zbudowane jak klasyki

Walka, zdobywanie poziomów i zagrożenie działają na autentycznych zasadach klasycznej ery: rage i energia, tabele trafień i uników, redukcja obrażeń przez pancerz, prawdziwa krzywa XP, liczniki uderzeń i globalny cooldown. Czuje się tak, jak pamiętasz, a nie jest jedynie przybliżeniem. Dokładne liczby mieszkają w `src/sim/`, jeśli chcesz je przeczytać.

Świat jest tworzony w kodzie, a nie w edytorze 3D, i to właśnie trzyma go małym,
deterministycznym i łatwym do sforkowania:

- Teren, woda, pogoda, niebo, układy miast, cienie w czasie rzeczywistym i efekty walki są generowane w czasie działania z własnych danych sima.
- Modele, które faktycznie są dostarczane, powstają tak samo: proceduralne fabryki w `scripts/assets/` eksportują deterministyczne GLB przez projektowy potok image-to-GLB, obok wyselekcjonowanej biblioteki zestawów modeli CC0. Zrigowane rodziny stworzeń i postaci niosą pełne animacje chodu, ataku, rzucania, siedzenia i śmierci.
- Ikony to warstwowy malarz, który komponuje grafikę dla wszystkiego, co nie ma dostarczonego pliku, więc nigdy niczemu nie brakuje ikony, a na wierzchu leży wyselekcjonowana malowana grafika dla umiejętności, przedmiotów i deeds.
- Kompletny klasyczny HUD (ramki jednostek, paski akcji, podpowiedzi, dziennik questów, mapa świata, minimapa, pływający tekst walki, the Book of Deeds), próbkowane dźwięki przestrzenne i interfejsowe oraz ścieżka dźwiękowa skomponowana proceduralnie w repozytorium i dostarczana jako strumieniowane remastery przenikające się między strefami, miastami, lochami i walką.

Każdy dostarczony zasób i jego licencja są zapisane w [CREDITS.md](../../CREDITS.md), a dołączone
zależności stron trzecich niosą swoje noty w [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Rozwój

Poza klientem gry build produkuje panel operatora, edytor świata pod `/editor` oraz publiczny
Guide pod `/wiki`, wszystkie serwowane z tego samego serwera deweloperskiego.

Każda ścieżka FFmpeg, z której korzysta gate i testy audio, rozwiązuje się do dołączonych
paczek npm `ffmpeg-static`/`ffprobe-static`, więc zwykły wkład nie wymaga systemowej
instalacji FFmpeg. Ścieżki mierzące zgodność (`npm run sfx:check`, testy audio, walidacja
eksportu w Studio) wiążą się bezpośrednio ze statycznymi binariami, bez odwrotu do `PATH`:
uruchom ponownie `npm ci`, jeśli instalacja z pominiętymi skryptami zostawiła je bez plików.
Odtwarzanie i kodowanie uruchamiane przez Studio oraz preflight `npm run gate` rozwiązują
się przez `scripts/sfx/ffmpeg_paths.mjs`, które akurat ma odwrót do `PATH`. Niektóre
samodzielne skrypty generujące audio (na przykład `scripts/gen_ui_sfx.mjs`) nadal domyślnie
sięgają po `ffmpeg` z `PATH`.

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

Testy logiki i jednostkowe używają Vitest. Podczas iteracji uruchom pojedynczy plik: `npx vitest run tests/sim.test.ts`. Zmiany w interfejsie mają też opcjonalny zestaw testów w prawdziwej przeglądarce, obejmujący dostępność, nawigację klawiaturą i cele dotykowe: `npm run test:browser`. Skrypty zrzutów ekranu i smoke sterują prawdziwymi przeglądarkami przez `puppeteer-core` i wymagają działającego `npm run dev`; skrypty działające na poziomie łącza (`mp_integration.mjs`, `social_e2e.mjs`, `crypt_raid.mjs`) rozmawiają z serwerem bezpośrednio i wymagają zamiast tego `npm run server`. Agenci przeglądarkowi mogą sterować ruchem przez `window.__game.controller` zamiast symulować wciśnięte klawisze, na przykład `controller.move({ forward: true }, facingRadians)` lub kompaktowe flagi jak `{ f: 1, sr: 1 }`.

Kontrole działają warstwami, opisanymi w [docs/qa-gate.md](../qa-gate.md): wskaż swojemu
klonowi wspólne hooki przez `git config core.hooksPath .githooks`, a szybka podłoga
uruchomi się, zanim cokolwiek opuści twoją maszynę.

Komendy serwera znajdziesz w [Rozwijaj online](#develop-online-with-hot-reload) powyżej,
[CONTRIBUTING.pl_PL.md](CONTRIBUTING.pl_PL.md) opisuje proces współtworzenia,
[tutorial SFX Studio](../sfx-studio-tutorial.md) tworzenie dźwięku i eksport
artefaktów, [DEPLOY.md](../../DEPLOY.md) produkcję, a
[CREDITS.md](../../CREDITS.md) licencje zasobów.

## Lokalizacja

Każdy widoczny dla gracza ciąg jest rozstrzygany przez `t()`, a gra jest dostarczana w **22 językach** (angielski, dwa hiszpańskie, dwa francuskie, angielski kanadyjski, włoski, niemiecki, chiński uproszczony i tradycyjny, koreański, japoński, brazylijski portugalski, rosyjski, czeski, niderlandzki, polski, indonezyjski, turecki, szwedzki, wietnamski i duński). Sim i serwer pozostają niezależne od języka: emitują stabilne klucze lub angielski, który klient ponownie lokalizuje na granicy, co utrzymuje determinizm nienaruszony. Współtwórcy dodają tylko angielski; opiekun wsadowo wypełnia pozostałe języki przed każdym wydaniem. Proces jest udokumentowany w `docs/i18n-scaling/translation-workflow.md`.

## Współtworzenie

Mile widziane są wszelkiego rodzaju wkłady: kod, tłumaczenia, zgłoszenia błędów i dokumentacja. Zacznij od [CONTRIBUTING.pl_PL.md](CONTRIBUTING.pl_PL.md) po konfigurację, przeczytaj [Kodeks postępowania](../../CODE_OF_CONDUCT.md) i sprawdź [SECURITY.md](../../SECURITY.md) przed zgłoszeniem podatności. Nowy tutaj? Poszukaj zgłoszeń oznaczonych [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), otwórz [zgłoszenie](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) lub przywitaj się na [Discordzie](https://discord.com/invite/worldofclaudecraft).

Aktywny rozwój toczy się na najnowszej gałęzi `release/vX.Y.Z`. Sprawdź, która to jest, zamiast zgadywać, a potem odbij od niej gałąź i to ją wskazuj jako cel pull requesta. Nigdy nie odbijaj od `main` ani nie celuj w `main`, który dostaje gałąź wydania dopiero wtedy, gdy dana wersja wychodzi. [CONTRIBUTING.md](CONTRIBUTING.pl_PL.md) zawiera jednolinijkowe polecenie, które znajduje bieżącą gałąź.

## Licencja

**Kod jest [na licencji MIT](../../LICENSE), więc forkuj go, remiksuj i postaw własny świat.** O to właśnie chodzi i nic innego na tej stronie ani na naszej witrynie tego nie cofa.

Trzy rzeczy są licencjonowane osobno, więc warto poświęcić trzydzieści sekund, by wiedzieć, co jest czym:

| Co | Licencja | Czy możesz to redystrybuować? |
|---|---|---|
| **Kod źródłowy**, czyli całość poza wydzielonymi niżej zasobami medialnymi | [MIT](../../LICENSE) | Tak. Komercyjnie też. |
| **Zasoby medialne**: modele, tekstury, HDRI, ikony, dźwięki, fonty (głównie pod `public/`) | Per zasób, zapisane w [CREDITS.md](../../CREDITS.md) | Przeważnie tak (większość to CC0). Niektóre nie, patrz niżej. |
| **Nazwa i marka**: „World of ClaudeCraft”, „Levy Street”, logotypy | Nielicencjonowane | Nie. |

**Forkuj i postaw własny świat. To działa, a zasoby ci nie przeszkadzają.** Większość tego, co widzisz, to CC0 domena publiczna (KayKit, Quaternius, Kenney, ambientCG, Poly Haven), a nasze własne generowane propy, stworzenia, tła i dźwięki interfejsu są dostarczane z projektem, więc fork działa od razu. Nie możesz tylko wyjąć ich i sprzedawać jako samodzielną grafikę.

Co trzeba by usunąć albo zastąpić przed redystrybucją:

- **ikony umiejętności klasowych CraftPix** pod `public/ui/skills/` zostały kupione przez Levy Street i **nie mogą być redystrybuowane**, więc kup własną licencję, jeśli chcesz je dostarczać;
- **efekty dźwiękowe @jamiecypher** są na CC BY-NC 4.0, więc udostępniaj je niekomercyjnie z podaniem autora, ale zgoda komercyjna obejmuje wyłącznie ten projekt;
- **grafika sklepowa i prestiżowa** (Season 1 Armory, zestaw Claudium, zestaw grafik profesji, ikony Book of Deeds, emblemat elitarnego smoka) to zamówiona grafika komercyjna i **prawa są zastrzeżone**;
- **znaki marek stron trzecich** (Twitch, X, Kick, YouTube, Discord, Solana, USDC) są znakami towarowymi swoich właścicieli i nie do nas należy ich dalsze licencjonowanie;
- garść **ikon i nagrań używanych za zgodą** wymaga zgody, by przekazać je dalej.

[CREDITS.md](../../CREDITS.md) jest listą rozstrzygającą, z kolumną redystrybucji przy każdym zasobie. Tam, gdzie zasób jest na niej wymieniony, ta licencja ma pierwszeństwo przed licencją MIT projektu. Ten rejestr wciąż jest uzupełniany, więc zasób medialny, którego w nim brakuje, jest niezapisany, a nie wolny: zapytaj, zanim na nim polegniesz. Z kodem źródłowym jest odwrotnie i wszystko, co nie zostało wydzielone, jest na MIT.

Nasze [Warunki korzystania](https://worldofclaudecraft.com/terms) obejmują hostowaną grę, którą prowadzimy na worldofclaudecraft.com: konta, zachowanie, przedmioty wirtualne. Nie ograniczają praw, które daje ci licencja MIT do tego kodu źródłowego.
