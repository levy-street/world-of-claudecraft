<div align="center">

# World of ClaudeCraft

**Begib dich auf Quests, schließe dich Gruppen an und raide eine handgebaute Welt, kostenlos in deinem Browser. Open Source, web3 und ab sofort online.**

**Offizielle Website: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.32.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.de_DE.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · **Deutsch** · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Čeština](README.cs_CZ.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Jetzt spielen](https://worldofclaudecraft.com/) · [Hoste deine eigene Welt](#host-your-own-world-one-command) · [Trainiere einen Agenten](#train-an-agent-headless-rl) · [Web3](#web3) · [Mitwirken](CONTRIBUTING.de_DE.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![Titelbildschirm von World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## Was das ist

World of ClaudeCraft ist ein komplettes MMO im Stil der klassischen Ära, das du sofort in deinem Browser spielen, mit einem einzigen Befehl selbst hosten und sogar KI-Agenten zum Spielen trainieren kannst. Es ist kostenlos, Open Source und live unter [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Eine geteilte Welt läuft an drei Orten, alle aus demselben Spielkern:

- der **autoritative Mehrspieler-Server**, die Live-Welt, die du auf worldofclaudecraft.com spielst, wo Postgres-gestützte Konten ein einziges persistentes Realm teilen,
- die **Offline-Browser-Welt**, eine lokale Einzelspieler-Sim aus dem Dev-Server, nützlich für die Entwicklung und um den Spielkern von Anfang bis Ende zu lesen,
- die **Headless-RL-Umgebung**, wo Python das echte Spiel über eine Gym-Schnittstelle steuert.

Gleicher Seed, gleiche Welt, überall. Vieles von dem, was du siehst, wird weiterhin zur Laufzeit aus Code gezeichnet, und der Rest ist ein kuratierter Asset-Satz, der mit dem Projekt ausgeliefert wird, sodass ein Fork sofort läuft.

## Highlights

- **Neun klassische Klassen**, jede mit einem vollständigen Kit im Stil der klassischen Ära, das mit dem Aufstieg an Rängen gewinnt, plus ein vollständiges **Talentsystem** (drei Spezialisierungen pro Klasse, 27 Spezialisierungen insgesamt).
- **Drei Open-World-Zonen** von Stufe 1 bis 20, mehr als 90 Quests und eine einzige zusammenhängende Geschichte über die Verschwörung des Gravecaller.
- **Fünf instanzierte Dungeons**, vier davon Elite-Raids für fünf Spieler und eine Solo-Krypta, mit Elite-Skalierung, AoE-Bossmechaniken, Beute nach Klassenarchetyp, die sich zu Tier-Sets sammelt, und einer **heroischen Schwierigkeitsstufe** mit reicheren Belohnungen, dazu **Weltbosse** in der offenen Welt und ein Raid-Finale für zehn Spieler.
- **Zwei skalierbare Delves**, ein Kleingruppen-Modus für ein oder zwei Spieler plus einen KI-Begleiter, bei jedem Durchlauf aus zufallsgenerierten Kammern neu aufgebaut, über die Stufen Normal und Heroisch.
- **Gewertetes PvP** auf zwei Arenakarten: 1v1- und 2v2-Ranglisten, ein lebhafterer 2v2-Fiesta-Modus und **Protect Yumi**, ein Zielmodus für 3v3 und 5v5. Gewertete Kämpfe zahlen Honor, das ein reines PvP-Ausrüstungsset kauft, welches Dungeon-Beute im PvE nie überflügelt.
- **Der Vale Cup**, eine Boarball-Liga in einem eigenen Stadion südlich von Eastbrook, und **Card Duel**, ein schnelles Kartenspiel Kopf an Kopf, das in der Stadt ausgetragen wird.
- **Ein Book of Deeds**: ein Erfolgsjournal mit kosmetischen Titeln, Abzeichenrahmen und Renown, mit zonenweisen Chronicles, die von Chronicler-NPCs in der Welt geführt werden, und einer Allzeit-Bestenliste.
- **Eine tiefe Berufswirtschaft**: vier Sammelberufe versorgen zehn Handwerke, von Kochkunst und Alchemie bis Juwelenschleifen, Waffenbau und Verzauberung, mit gestuften Werkzeugen, Werkbänken in der Stadt, Meisterwerk-Qualität und Auftragsarbeiten, die alle einen spielergetriebenen **World Market** und den Postdienst **Ravenpost** speisen.
- **Echtes Mehrspielererlebnis**: Gruppen und Raids, Gilden, Handel, Duelle, Tap-Rechte, gruppengeteilte EP, Flüstern, Abwesenheitsstatus und ein **Dungeon Finder** mit Rollenwarteschlangen und Premade-Einträgen.
- **In Code verfasst, nicht in einem 3D-Editor**: Gelände, Wasser, Wetter, Stadtlayouts, Echtzeit-Schatten und Effekte werden zur Laufzeit generiert, und die Modelle, die tatsächlich mitgeliefert werden, stammen aus prozeduralen Fabriken und einer kuratierten Asset-Bibliothek statt aus Handarbeit.
- **Lokalisiert in 22 Sprachen** über eine deterministische Pipeline, in der die Sim Schlüssel emittiert.
- **Ein begleitendes Wiki unter `/wiki`**, direkt aus den lebenden Spielinhalten generiert, sodass es nicht von der Welt abweichen kann, die es dokumentiert.
- **Native Apps auf jeder Plattform**: signierte Desktop-Installer für Windows, Linux und macOS mit automatischen Updates und optionaler Spiegelung von Steam-Erfolgen, dazu iOS- und Android-Builds, die alle denselben Browser-Client und dieselbe Online-Welt nutzen.
- **Skaliert auf die Maschine, die du hast**: Grafik-Voreinstellungen und ein automatischer Bildratenregler tauschen visuelle Fülle gegen Flüssigkeit und unterliegen einer Fairnessregel, die verhindert, dass sie jemals etwas verbergen, worauf ein Spieler reagiert.
- **Headless-RL-Umgebung** mit Gymnasium-Bindings, Reward-Shaping und einem Benchmark-Modus.
- **$WOC-Nutzen, vollständig optional**: verknüpfe eine Solana-Wallet für Holder-Flair, Daily Rewards und eine vergünstigte Zahlungsoption im Kosmetik-Store. Das Spiel bleibt kostenlos spielbar und nicht verwahrend.
- **Season 1 Armory**: sammle kosmetische Waffen-Skins über den WOC Store, mit Claudium, das du mit Fiat, SOL, USDC oder $WOC kaufst. Kosmetik verleiht niemals Kampfkraft.

## Screenshots

![Der Marktplatz von Eastbrook, Lagerfeuer und Questgeber](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Abenddämmerung am Lagerfeuer von Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Abenddämmerung am Lagerfeuer von Eastbrook* | ![Elite-Pulls in der Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Fackelbeleuchtete Elite-Pulls in der Hollow Crypt* |
| ![Die ruhelosen Toten an der zerstörten Kapelle](../../docs/screenshots/restless-dead.jpg)<br>*Die ruhelosen Toten an der zerstörten Kapelle* | ![Ein Handgemenge mit Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*In der Unterzahl im Banditenlager* |
| ![Old Greyjaw auf der Nordstraße zur Strecke gebracht](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, der seltene Spawn, auf der Nordstraße gestellt* | ![Händler- und Taschen-UI](../../docs/screenshots/vendor-and-bags.jpg)<br>*Ausrüsten bei Trader Wilkes, mit geöffnetem Händlerfenster und offenen Taschen* |
| ![Das Mondtor an der Küste von Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Die Ertrunkenen klettern am Mondtor von Glimmermere heraus* | ![Ysolei auf dem Altar des Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest und der Altar des Drowned Temple* |

Das Wetter wird vom Biom gesteuert und ist reine Darstellung, daher berührt es niemals die deterministische Sim:

| | | |
|:---:|:---:|:---:|
| ![Klarer Himmel über Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Klar über dem Vale* | ![Regen über Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Regen über Mirefen Marsh* | ![Schnee auf Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Schnee auf Thornpeak Heights* |

## Spiel es

Spiele im Browser auf [worldofclaudecraft.com](https://worldofclaudecraft.com/) oder installiere die native App für Windows, Linux, macOS, iOS oder Android. Jeder Client verbindet sich mit derselben Online-Welt.

### Online, mit anderen Spielern

Erstelle ein Konto, erstelle einen Charakter und betritt die Live-Welt. Um denselben Client/Server-Stack selbst zu betreiben, siehe [Hoste deine eigene Welt](#host-your-own-world-one-command) weiter unten.

### Offline, im Dev-Server

Der Offline-Modus ist eine lokale Einzelspieler-Welt ohne Konto und ohne Serverautorität, daher ist er nur in Entwicklungs-Builds enthalten. Starte den Dev-Server, und er erscheint in der Modusauswahl:

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

Benenne deinen Charakter, wähle eine der neun Klassen, und du startest in **Eastbrook Vale** (Stufen 1-7), einer Marktstadt, umringt von Knotenpunkten: Wolfsreviere im Norden, Eberwiesen im Osten, die Sableweb-Wälder im Westen, Mirror Lake im Nordwesten, eine von Buddlern verseuchte Kupfergrube im Südwesten und eine zerstörte Kapelle der ruhelosen Toten im Nordosten, mit Gorraks Banditenlager im Südosten. Die Nordstraße erklimmt einen Gebirgspass hinauf nach **Mirefen Marsh** (6-13, Knotenpunkt Fenbridge) und weiter hinauf zu den **Thornpeak Heights** (13-20, Knotenpunkt Highwatch). Der Welt-Seed ist in `src/main.ts` fixiert, daher ist es bei jedem Besuch derselbe Ort.

### Desktop-Apps für Windows, Linux und macOS

World of ClaudeCraft erscheint als vollwertige Desktop-App für alle drei großen Desktop-Plattformen: signierte Windows-Installer, Linux-AppImage- und deb-Pakete sowie signierte und notarisierte universelle macOS-Builds. Sie nutzen denselben Spiel-Client und dieselbe Online-Welt wie der Browser, mit nativer Paketierung und automatischen Updates.

Die Online-Anmeldung läuft ausschließlich über Discord und E-Mail, genau wie im Web: E-Mail und Passwort melden dich in der App an, und "Continue with Discord" öffnet deinen Standardbrowser auf der Seite `/desktop-login`, die einen Einmalcode über einen `worldofclaudecraft://`-Deep-Link an die App zurückgibt, den die App gegen ein normales Sitzungstoken von World of ClaudeCraft eintauscht.

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

Richte die Hülle mit `VITE_DESKTOP_API_ORIGIN` auf eine andere API aus, zum Beispiel einen lokalen Server oder einen Staging-Host:

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

Überschreibe den Produktions-API-Origin für Staging-Builds mit `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` (ein Wert zur BUILD-Zeit: er wird in das Bundle eingebacken und in die paketierte App gestempelt, und installierte Builds ignorieren ihn als Laufzeit-Umgebungsvariable). Steam ist ein Vertriebskanal (dasselbe Electron-Bundle, über SteamPipe hochgeladen), und Desktop-Spieler können ein Steam-Konto verknüpfen, um die verdienten Deeds als Steam-Erfolge zu spiegeln; die Anmeldung selbst bleibt E-Mail und Discord. Das vollständige Release-Runbook (Signierung, Notarisierung, Veröffentlichung eines Auto-Updates, SteamPipe-Depots, das Server-Deployment) ist `docs/desktop-release.md`. iOS und Android erscheinen über Capacitor, mit einem eigenen Runbook in `docs/mobile-store-release.md`.

<a id="host-your-own-world-one-command"></a>

## Hoste deine eigene Welt (ein Befehl)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Für **Remote-Hosting** stelle den Compose-Stack auf einem beliebigen VPS bereit, setze in der Umgebung ein echtes `POSTGRES_PASSWORD` und stelle Port 8787 einen TLS-Reverse-Proxy voran. Mit Caddy sind das eine Handvoll Zeilen; WebSockets werden automatisch weitergeleitet und der Client wählt auf https-Seiten automatisch `wss://`. Auth-Endpunkte sind ratenbegrenzt, Passwörter werden mit scrypt gehasht, und Anmeldesitzungen laufen ab. Setze niemals `ALLOW_DEV_COMMANDS=1` in der Produktion, denn es aktiviert den vollständigen `/dev`-Cheat-Satz: die Stufen- und Teleport-Cheats, die die Test-Bots nutzen, dazu Gegenstandsvergaben, Mob-Spawns, Instanz-Teleports und die spielinterne GUI für Dev-Befehle. [DEPLOY.md](../../DEPLOY.md) ist der vollständige Produktionsleitfaden, einschließlich der Reverse-Proxy-Konfiguration, die die Health- und Metrics-Endpunkte vom öffentlichen Rand fernhält.

<a id="develop-online-with-hot-reload"></a>

### Online entwickeln mit Hot Reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api, /admin/api, and /ws)
```

Öffne http://localhost:5173, wähle **Play Online**, erstelle ein Konto, erstelle einen Charakter und Enter World. Der Charakterauswahl-Bildschirm zeigt die neuesten Release-Neuigkeiten im Panel News & Updates, mit NEW-Abzeichen für alles, was du noch nicht gesehen hast. Öffne einen zweiten Tab und melde dich erneut an, um euch gegenseitig in der Stadt zu sehen. `Enter` öffnet den Chat. Das Spieler-Wiki ist der Guide aus dem Repository, erreichbar unter http://localhost:5173/wiki und in der Produktion unter `/wiki`; sein Inhalt wird von `npm run wiki:content` aus den aktuellen Spieldaten generiert.

Was persistiert und wie der Server die Kontrolle behält:

- **Konten**: scrypt-gehashte Passwörter und ablaufende Bearer-Tokens.
- **Charaktere**: bis zu 10 pro Konto und Realm; Stufe, Ausrüstung, Taschen, Banktresor, Quests, Talente, Berufe, PvP- und Deed-Fortschritt, Position und Geld persistieren als JSONB in Postgres, gespeichert per Timer, beim Abmelden und beim Herunterfahren des Servers. Namen sind pro Realm eindeutig und im klassischen Stil.
- **Der Server ist autoritativ**: Clients streamen Bewegungsabsicht und Befehle mit 20 Hz; der Server führt die eine geteilte `Sim` aus und liefert interessensbezogene Snapshots plus spielerbezogene Ereignisse zurück. Jeder Kampfwurf, Beutedrop, jede Questgutschrift und Händlertransaktion wird serverseitig aufgelöst. Der Client ist ein Renderer.

<a id="train-an-agent-headless-rl"></a>

## Trainiere einen Agenten (Headless-RL)

Derselbe deterministische Kern läuft als [Gymnasium](https://gymnasium.farama.org/)-Umgebung, sodass ein Agent gegen das tatsächliche Spiel lernt, nicht gegen eine Nachbildung davon. Der Env-Server (`headless/env_server.ts`) umhüllt eine `Sim` und spricht zeilengetrenntes JSON über stdio; die Python-Bindings in `python/` starten ihn als Subprozess und stellen die übliche `reset` / `step` / `close`-Schleife bereit.

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

- **Beobachtungs- und Aktionsräume sind inhaltsabgeleitet.** Frage sie beim Start aus der `info`-Antwort der Umgebung ab, statt sie fest zu codieren; sie wachsen mit dem Spiel. Der Aktionsraum ist ein `Discrete` über Bewegung, Ziel, Angriff, das vollständige Fähigkeiten-Kit, Interaktion und Essen/Trinken; die Beobachtung ist eine `Box` über Selbst, Fähigkeiten, Ziel, nahe Mobs, das nächste interagierbare Objekt und den Questfortschritt.
- **Reward** ist eine gewichtete Summe von Zähler-Deltas pro Tick (EP, ausgeteilter und erlittener Schaden, Kills, Tode, Questfortschritt, Stufenaufstiege), pro Reset einstellbar. Jeder `step` wendet eine Aktion an und rückt standardmäßig fünf Sim-Ticks vor, also grob vier Entscheidungen pro simulierter Sekunde.
- **Deterministisch von Grund auf.** Keine Wanduhr, kein `Math.random`. Seede den Reset und die Episode spielt sich exakt wieder ab.

Das Protokoll und die Bindings sind in `headless/CLAUDE.md` und `python/CLAUDE.md` dokumentiert.

<a id="web3"></a>

## Web3

World of ClaudeCraft ist web3-nativ rund um **$WOC**, unseren Community-Token auf Solana. Verbinde eine Solana-Wallet, verknüpfe sie mit einer einzigen Signatur mit deinem Konto (nicht verwahrend, keine zu bestätigende Transaktion), und dein schreibgeschützter $WOC-Kontostand erscheint im HUD neben einem kosmetischen Holder-Tier-Abzeichen.

$WOC hat außerdem optionalen Nutzen im laufenden Spiel:

- **WOC Store**: kaufe Claudium, die kosmetische Einwegwährung, mit Fiat, SOL, USDC oder $WOC. Der $WOC-Zahlungsweg ist gegenüber den anderen vergünstigt.
- **Season 1 Armory**: gib Claudium für kosmetische Waffen-Skin-Sammlungen aus. Store-Käufe verleihen weder Werte noch Kampfkraft.
- **Daily Rewards**: berechtigte verifizierte Holder können über ein tägliches Drehen und wechselnde Aufgaben Punkte verdienen und dann um einen Anteil am täglichen Preistopf konkurrieren.

Nichts davon wird zum Spielen benötigt. Das Verknüpfen einer Wallet ist optional und nicht verwahrend, es gibt kein Pay-to-Win, und das gesamte Spiel läuft einwandfrei, ohne jemals eine Wallet zu verbinden.

**$WOC-Contract-Adresse (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Mehr zum Token unter [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Eine Tour durch die Welt

### Die neun Klassen

Jede Klasse läuft auf MMO-Mechaniken der klassischen Ära, von Grund auf implementiert, und erlernt rangbasierte Zauber über die Stufen 1-20, wobei Signaturfähigkeiten wie Low Blow, Early Grave, Skyfall, Urgent Prayer und Ancestral Strike in der zweiten Hälfte des Aufstiegs freigeschaltet werden.

- **Warrior**: Wut, Iron Bellow, Onrush, Quaking Blow, Maiming Strike, Gaping Wounds (eine Blutung, die auf deinen Schlägen mitreitet), Widening Arc, Hobbling Cut, Blood Toll, Redhand (Ausweich-Proc).
- **Paladin**: Oathbrand, entfesselt durch Verdict, Mending Light, Steadfast Aura, Oath of Iron, Ward of Faith (Absorption), Sundering Gavel (Betäubung), Last Rite.
- **Hunter**: Fern-Auto-Angriff (8-35 yd mit einer Dead Zone im klassischen Stil), Gutting Strike, Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Counterfang, Fettering Slash und ein zähmbares Pet ab Stufe 10.
- **Rogue**: Energie und Combo-Punkte, Wicked Slash, Dirt Nap, Craven Thrust (von hinten, Dolch), Eye Jab, Ghostfoot, Cutthroat Tempo, Swift Heels.
- **Priest**: Smite, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding (Absorption), Lingering Grace (HoT), Mindfracture.
- **Shaman**: Arc Bolt, Stonebound Weapon (Imbue), Mending Waters, Earthen Jolt, Thunder Ward (Dornen), Cinder Jolt.
- **Mage**: Cinderbolt, Hoarfrost Mantle, Aether Insight, Rimelance, Waterbind, Cinderfall, Aether Darts (kanalisiert), Bewitch, Icebind, ein beschworenes Wasserelementar und Chronomancy, eine Heilspezialisierung mit Zeitmagie.
- **Warlock**: Gloom Bolt, Fiendhide, Burning Pact, Blackrot, Hard Bargain, Hex of Anguish, Consume und sieben beschwörbare Dämonen vom Emberkin bis zum Wraithborn.
- **Druid**: Wildbolt, Wildmend, Wildward, Lunar Tempest, Wildbloom, Briarguard, Gripping Roots und Gestaltwandel in Wolf Form auf 5, Bruin Form auf 8 und Moonwing Form auf 10.

Heilungen und Buffs treffen Gruppenmitglieder, Heilung kann critten, und Absorb-Schilde schlucken Schaden, bevor er die Gesundheit erreicht. Verteile Punkte über **drei Talentspezialisierungen pro Klasse** (Battlecraft/Bloodrush/Ironguard, Moongrove/Wildfang/Groveheart und so weiter); die Verteilung wird serverseitig validiert und ist als Build-String exportierbar.

### Dungeons

Die Gravecaller-Geschichte verläuft durch drei Elite-Instanzen für fünf Spieler, eine vierte wartet hinter einem Mondtor mit ihrer eigenen Überlieferung der Ertrunkenen, und eine Solo-Krypta liegt für Entdecker abseits.

- **The Hollow Crypt** (5 Spieler) unter der Fallen Chapel: paarweise Elite-Trash, der Miniboss Sexton Marrow sowie Morthen the Gravecaller und sein wiederkehrender Schatten-AoE. Die Kryptentür teleportiert deine Gruppe in eine private Instanzkopie, die sich zurücksetzt, sobald sie leer ist.
- **The Sunken Bastion** (5 Spieler, um Stufe 13, Südosten von Mirefen): Vael the Fogbinder beschwört im Verlauf des Kampfes Wellen von Drowned Thralls.
- **Gravewyrm Sanctum** (5 Spieler, Stufe 20, unter Thornpeak): drei Kammern voller Elite-Knochenwache und Schuppenwache, Korgath the Bound, Grand Necromancer Velkhar und Korzul the Gravewyrm, wo epische Waffen fallen.
- **The Drowned Temple** (5 Spieler) durch das Mondtor von Glimmermere: eine fahle, mondviolette Instanz, die zu Choirmother Selthe und dann zu Ysolei, Avatar of the Drowned Moon, führt, deren Mondgezeiten und beschworene Moonspawn eine stehende Gruppe bestrafen.
- **The Abandoned Crypt** (Solo) in Thornpeak: ein stiller Tauchgang aus Schlüsselsteinen und Tagebüchern für einen Einzelnen, dessen Spur die königliche Tür zu **Nythraxis, Scourge of Thornpeak** entsiegelt, einem Raid-Finale für zehn Spieler, das über drei Seelen-Wardsteine ausgetragen wird.

Jede Instanz läuft außerdem auf **Heroisch**: höherstufige Gegner, schärfere Mechaniken und eine eigene Beute- und Händlerwährung. Die hinführenden Questketten sind solofähig, sodass die Geschichte nie davon abhängt, eine Gruppe zu finden. Unser automatisierter Fünf-Bot-Raid (Warrior, Paladin, Priest, Mage, Hunter mit Fokusfeuer und Heiler-KI) räumt die Hollow Crypt in etwa fünf Minuten (`node scripts/crypt_raid.mjs`, benötigt `ALLOW_DEV_COMMANDS=1`).

### Delves

Delves sind ein separater, skalierbarer Kleingruppen-Modus für ein oder zwei Spieler, bei jedem Durchlauf aus zufallsgenerierten Kammern neu aufgebaut und endend an einer verschlossenen Reliquientruhe, die sich über ein Schlossknack-Minispiel statt über einen Beutewurf öffnet. **The Collapsed Reliquary** (ab Stufe 7) endet bei Deacon Varric, und wenn du allein gehst, kämpft die KI-Begleiterin Tessa an deiner Seite. **The Drowned Litany** (ab Stufe 12) folgt der Spur in einen gefluteten Schrein am Rand von Mirefen Marsh. Ein Delve-Board legt die Stufe fest: Heroisch hebt die Gegnerstufen an und fügt für reichere Belohnungen ein zufälliges Affix hinzu.

### Gewertetes PvP (das Ashen Coliseum)

Drücke `G` oder den Arena-Button, um dich anzustellen. Das Matchmaking teleportiert die Kämpfer in eine private Grube, ein kurzer Countdown heilt und setzt alle für einen fairen Start zurück, und das Gefecht endet, wenn eine Seite aufgibt. Niemand stirbt, und du kehrst genau dorthin zurück, wo du dich angestellt hast. Protect Yumi wird in einem eigenen Labyrinth statt in der Grube des Coliseums ausgetragen.

- **Gewertete 1v1- und 2v2-Ranglisten**, jede mit einer persistenten Elo-artigen Wertung und einer Allzeit-Bestenliste.
- **2v2-Fiesta**, ein lebhafterer Party-Modus, in dem Teams um ein Ausschaltungsziel wettrennen, während Augment-Aufnahmen Macht abwerfen und ein sich schließender Ring den Kampf zusammenzwingt.
- **Protect Yumi**, ein ungewerteter Zielmodus für 3v3 und 5v5, in einem Labyrinth ausgetragen: jedes Team bewacht einen Katzenbegleiter und versucht, den der Gegenseite zu Fall zu bringen, sodass Eskorten und Picks mehr zählen als reine Kills.

Gewertete Siege und Fiesta-Ausschaltungen zahlen **Honor**, das der Quartiermeister in der Stadt gegen ein Set aus Warfare-Ausrüstung tauscht. Warfare ist ein reiner PvP-Wert, sodass das Set Duelle gewinnt, ohne im PvE jemals Dungeon-Beute derselben Stufe zu überflügeln.

### Gemeinsam spielen

- **Dungeon Finder**: Öffne ihn mit `Shift+I`, um Dungeons und Raids zu durchstöbern, Bosse und Beute zu prüfen, einer automatischen Warteschlange für Tank/Heiler/DPS beizutreten oder einen Premade-Eintrag zu erstellen. Über den Finder gebildete Gruppen reisen weiterhin gemeinsam zum Eingang.
- **Gruppen** bis zu 5, die sich bei voller Besetzung in einen Raid mit 10 Spielern aus zwei Gruppen verwandeln: Rechtsklick auf einen Spieler und In Gruppe einladen. Mitglieder teilen Tap-Rechte und Questgutschrift, teilen EP mit den Gruppenboni der klassischen Ära und erscheinen als Punkte auf der Minimap. `/p` für den Gruppenchat, `/roll` zum Auswürfeln von Beute.
- **Handel**: Rechtsklick und Handeln. Beide Seiten legen Gegenstände und Geld vor, beide müssen bestätigen, und der Tausch ist atomar und serverseitig validiert. Questgegenstände können nicht gehandelt werden, und Auseinandergehen bricht ab.
- **Duelle**: Rechtsklick und Zu einem Duell herausfordern. Ein 3-Sekunden-Countdown, dann Kampf, bis eine Seite 1 HP erreicht; der Sieger wird zonenweit verkündet, und 60 Yards wegzulaufen bedeutet Aufgabe.
- **Tap-Rechte und Abwesenheitsstatus**: der erste Spieler, der einem Mob Schaden zufügt, besitzt dessen Beute, EP und Questgutschrift; `/afk` und `/dnd` markieren dich als abwesend mit einer automatischen Antwort auf Flüstern.

### Welt und Systeme

- **Berufe** (`Shift+P`): vier Sammelberufe (Bergbau, Holzfällerei, Kräuterkunde, Angeln) versorgen zehn Handwerke, von Kochkunst und Alchemie bis Waffenbau, Juwelenschleifen und Verzauberung. Sammelwerkzeuge gibt es in Stufen, die entscheiden, welche Vorkommen du bearbeiten kannst, Handwerk läuft an Werkbänken in der Stadt mit einer Chance auf Meisterwerk-Qualität, die dein Herstellerzeichen trägt, und es gibt ein Archetypensystem, das du beim Spezialisieren entdeckst.
- **Der World Market**: ein spielergetriebenes Auktionshaus für Ausrüstung, Materialien und Verbrauchsgüter, aus den Knotenpunktstädten durchstöberbar.
- **Ravenpost-Post**: sende Gegenstände und Münzen an andere Charaktere, wobei Anhänge sicher verwahrt bleiben, bis sie abgeholt werden.
- **Gilden**: Gründungsurkunden, Mitgliederlisten, Ränge und Gildenchat.
- **Der Guide**: ein durchsuchbares Wiki auf der Seite unter `/wiki` zu Klassen, Kreaturen, Zonen und Deeds, direkt aus den lebenden Spielinhalten generiert, sodass es nicht von der Welt abweichen kann, die es dokumentiert.
- **Der Vale Cup und Card Duel**: Boarball im Sowfield-Stadion südlich von Eastbrook, in Formaten von 1v1 bis 5v5, und ein schnelles Kartenspiel Kopf an Kopf, das der Card Master in der Stadt ausrichtet.
- **Daily Rewards**: verifizierte $WOC-Holder können über ein tägliches Drehen und wechselnde Aufgaben Bestenlistenpunkte verdienen, mit automatischen Auszahlungen aus dem täglichen Preistopf.
- **WOC Store und Season 1 Armory**: kaufe Claudium mit Fiat, SOL, USDC oder $WOC und gib es dann für rein kosmetische Waffen-Skins aus.
- **Essen und Trinken**: setz dich zum Regenerieren, unterbrochen durch Schaden oder Aufstehen, und ja, du kannst gleichzeitig essen und trinken.
- **Händler**, die Essen und Wasser kaufen und ehrliche weiße Ausrüstung verkaufen, mit Münzen in Gold, Silber und Kupfer.
- **Eine persönliche Bank** (die Gilded Strongbox): Verwalter in jeder Knotenpunktstadt führen einen Tresor pro Charakter, von 24 Plätzen bis auf 96 mit für Münzen gekauften Erweiterungen, dazu Bonusplätze, die online für eine verifizierte E-Mail, verknüpfte Konten und Empfehlungen verdient werden.
- **Das Book of Deeds**: ein Erfolgsjournal (standardmäßig `Shift+Z`) über Quests, Kills, Clears und Freuden, das kosmetische Titel ausschüttet, die du auf deiner Namensplakette, im Chat und auf den Ranglisten tragen kannst, dazu ein HUD-Tracker für die Deeds, die du verfolgst, zonenweise Chronicles, die von Chronicler-NPCs geführt werden, und eine Allzeit-Bestenliste für Renown; die öffentliche Liste liegt unter `/wiki/deeds`.
- **Mob-KI**: Umherwandern, Näheaggro nach Stufenunterschied, soziale Pulls, Verfolgung, Leine und Reset, Leichenbeute und Respawns, mit einem seltenen Spawn (Old Greyjaw) auf einem langen Timer.
- **Angelplätze** mit eigenen Beutetabellen und seltenen Fängen.
- **Kosmetische Skins**, ausgewürfelt in den Seltenheiten ungewöhnlich, selten und episch, rein für die Optik.
- **Tod und Erholung**: entlasse deinen Geist zum Friedhof, erleide Sturzschaden und werde beim Schwimmen langsamer.
- **Biom-Wetter**: klar im Vale, Regen im Marsh, Schnee auf den Peaks, mit Überblendung, während du dich zwischen den Zonen bewegst.

### Steuerung (klassisches Layout)

| Eingabe | Aktion |
|---|---|
| `W` / `S` | laufen / zurückgehen. `A`/`D` drehen (mit gehaltener rechter Maustaste straffen), `Q`/`E` straffen |
| Rechts-Ziehen / Links-Ziehen | Mouselook / Kamera umkreisen. Mausrad zoomt, `Space` springt |
| `Tab` | nächste Feinde durchschalten. Linksklick zum Anvisieren, Rechtsklick zum Angreifen, Plündern oder Reden |
| `1`-`9`, `0`, `-`, `=` | Aktionsleiste |
| `F` | interagieren (eine Leiche plündern, ein Objekt aufheben, reden) |
| `C` `P` `L` `M` `B` `N` `T` | Charakter, Zauberbuch, Questlog, Weltkarte, Taschen, Talente, Handwerk |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | Arena, Freunde und Gilde, Bestenliste, Kalender, Vale Cup, Dungeon Finder, Berufe, Deeds |
| `Z` / `X` | Waffen wegstecken oder ziehen, Emote-Rad |
| `V` / `R` / `Esc` | Namensplaketten, Autorun, oberstes Fenster schließen (oder das Spielmenü öffnen) |

Jede Belegung ist im Tastenbelegungs-Panel neu zuweisbar. Touch-Steuerung (ein Bewegungsstick, Kamera-Ziehen und Aktionsbuttons auf dem Bildschirm) erscheint auf Mobilgeräten automatisch.

## Architektur (eine Sim, drei Hosts)

Drei Ideen halten das Projekt zusammen:

- **Eine Sim, drei Hosts.** Derselbe `src/sim/`-Code betreibt die Offline-Browser-Welt, den Online-Server und die RL-Umgebung. Das Verhalten muss überall identisch sein, und die Tests existieren, um das so zu halten.
- **`IWorld` ist die einzige Nahtstelle.** `IWorld` ist als domänenweise Facetten-Schnittstellen unter `src/world_api/` definiert, aggregiert von `src/world_api.ts`. Die Offline-`Sim` erfüllt es strukturell, und die Online-`ClientWorld` implementiert es, indem sie Server-Snapshots spiegelt. Der Renderer und das HUD sprechen nur mit `IWorld`, niemals mit einer konkreten Welt, sodass ein neues Feature zuerst die passende Facette erweitert und dann beide Welten.
- **Der Server ist autoritativ.** Clients senden Absicht; der Server entscheidet die Ergebnisse. Der Client löst Kampf, Beute oder Wirtschaft niemals selbst auf.

Die Sim ist ein fester 20-Hz-Tick (`DT = 1/20`), alle Zufälligkeit fließt durch eine einzige geseedete `Rng`, und `src/sim/` enthält keinerlei DOM-, Browser- oder Three.js-Imports. Genau das erlaubt es, denselben Code in einen Node-Env-Server, eine autoritative Spielschleife und einen Browser-Tab zu bündeln, ohne eine Zeile zu ändern.

### Projektaufbau

| Pfad | Was es ist |
|---|---|
| `src/sim/` | Deterministischer Spielkern, die Quelle der Wahrheit. Keine DOM- oder Three-Abhängigkeiten. |
| `src/sim/content/` | Daten als Code: die neun Klassen, Fähigkeiten, Zonen, Dungeons, Delves, Gegenstände, Rezepte, Verzauberungen, Talente, Berufe, Deeds. |
| `src/world_api.ts` + `src/world_api/` | `IWorld`, die Nahtstelle, von der Renderer und HUD abhängen: eine Facetten-Schnittstelle pro Domäne. |
| `src/` (Rest) | Three.js-Renderer, HUD und Styles, Eingabe und Audio, Online-Spiegel sowie die Admin-, Guide- und Editor-SPAs. |
| `server/` | Autoritativer Server: HTTP und WS, Weltschleife, Postgres, Auth, Soziales, Moderation. |
| `server/http/` | Die REST-Anfrage-Pipeline: Tabellen-Router, Middleware und domänenweise Routendefinitionen. |
| `headless/` + `python/` | RL-Env-Server (`env_server.ts`) und Python-Gym-Bindings. |
| `bot/` | Discord-Bot (Rollen, Relay, Aktivitäts-Feed). |
| `electron/`, `android/`, `ios/` | Desktop-Hülle (Steam) und native Mobile-Hüllen. |
| `tests/` | Vitest-Suite. |
| `scripts/` | Build-, Asset-, i18n-, SFX-, Screenshot- und Browser-E2E-Werkzeuge. |
| `deploy/` · `mediawiki/` | Produktions-Assets für den ersten Start und der Container für das Spieler-Wiki. |
| `public/` · `docs/` | Statische Assets (wortgetreu auf die Seite ausgeliefert) und Designdokumente. |

Nichts davon beruht auf Vertrauen: `tests/architecture.test.ts` durchsucht jede Sim-Datei nach
einem verbotenen Import, einem DOM-Global oder einem verirrten Uhr- oder `Math.random`-Aufruf, und
`tests/world_api_parity.test.ts` fixiert die Nahtstelle, damit die beiden Welten nicht auseinanderdriften.

Die meisten Verzeichnisse tragen ihre eigene `CLAUDE.md` mit lokalen Konventionen, und der
vollständige Satz an Projektinvarianten lebt in der Wurzel-[`CLAUDE.md`](../../CLAUDE.md).
Mitwirkende Agenten starten dort und greifen dann den Einstiegspunkt ihrer Laufzeit auf:
[`AGENTS.md`](../../AGENTS.md) plus den [Codex-Bedienungsleitfaden](../codex.md) für Codex,
[`GEMINI.md`](../../GEMINI.md) für Gemini. Alle führen in dieselbe kanonische Architektur.

## Gebaut wie die Klassiker

Kampf, Stufenaufstieg und Bedrohung laufen allesamt nach authentischen Regeln der klassischen Ära: Wut und Energie, Treffer- und Ausweichtabellen, Rüstungsminderung, die echte EP-Kurve, Swing-Timer und der globale Cooldown. Es fühlt sich so an, wie du es in Erinnerung hast, statt es nur anzunähern. Die genauen Zahlen liegen in `src/sim/`, falls du sie nachlesen willst.

Die Welt wird in Code verfasst statt in einem 3D-Editor, und genau das hält sie klein,
deterministisch und leicht zu forken:

- Gelände, Wasser, Wetter, Himmel, Stadtlayouts, Echtzeit-Schatten und Kampfeffekte werden zur Laufzeit aus den eigenen Daten der Sim generiert.
- Die Modelle, die tatsächlich mitgeliefert werden, entstehen genauso: prozedurale Fabriken unter `scripts/assets/` exportieren deterministische GLBs über die Image-to-GLB-Pipeline des Projekts, ergänzt um eine kuratierte Bibliothek aus CC0-Modellkits. Geriggte Kreaturen- und Charakterfamilien tragen vollständige Geh-, Angriffs-, Zauber-, Sitz- und Todesanimationen.
- Symbole entstehen durch einen geschichteten Painter, der für alles ohne mitgelieferte Datei Grafik komponiert, sodass nie ein Symbol fehlt, mit kuratierter gemalter Grafik darüber für Fähigkeiten, Gegenstände und Deeds.
- Ein vollständiges klassisches HUD (Unit-Frames, Aktionsleisten, Tooltips, Questlog, Weltkarte, Minimap, Floating Combat Text, das Book of Deeds), gesampelte räumliche und Interface-Soundeffekte sowie ein Soundtrack, der im Repository prozedural komponiert und als gestreamte Remaster ausgeliefert wird, die zwischen Zonen, Städten, Dungeons und Kampf überblenden.

Jedes ausgelieferte Asset und seine Lizenz sind in [CREDITS.md](../../CREDITS.md) verzeichnet, und
gebündelte Drittanbieter-Abhängigkeiten tragen ihre Hinweise in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Entwicklung

Neben dem Spiel-Client erzeugt der Build das Betreiber-Dashboard, den Welteditor unter
`/editor` und den öffentlichen Guide unter `/wiki`, alle vom selben Dev-Server ausgeliefert.

Jeder FFmpeg-Pfad, den das Gate und die Audiotests nutzen, löst die gebündelten npm-Pakete
`ffmpeg-static`/`ffprobe-static` auf, sodass ein normaler Beitrag keine systemweite
FFmpeg-Installation braucht. Die konformitätsmessenden Pfade (`npm run sfx:check`, die Audiotests,
die Exportvalidierung des Studios) binden direkt an die statischen Binaries, ohne `PATH`-Rückfall:
führe `npm ci` erneut aus, falls eine Installation mit übersprungenen Skripten sie fehlen ließ. Die
Wiedergabe- und Encode-Prozesse des Studios sowie der Preflight von `npm run gate` lösen über
`scripts/sfx/ffmpeg_paths.mjs` auf, das sehr wohl auf `PATH` zurückfällt. Einige eigenständige
Audio-Generator-Skripte (zum Beispiel `scripts/gen_ui_sfx.mjs`) nutzen weiterhin standardmäßig
`ffmpeg` aus `PATH`.

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

Logik- und Unit-Tests nutzen Vitest. Führe beim Iterieren eine einzelne Datei aus: `npx vitest run tests/sim.test.ts`. Für Interface-Änderungen gibt es zusätzlich eine optionale Suite im echten Browser, die Barrierefreiheit, Tastaturnavigation und Touch-Ziele abdeckt: `npm run test:browser`. Die Screenshot- und Smoke-Skripte steuern echte Browser über `puppeteer-core` und benötigen ein laufendes `npm run dev`; die Skripte auf Protokollebene (`mp_integration.mjs`, `social_e2e.mjs`, `crypt_raid.mjs`) sprechen direkt mit dem Server und benötigen stattdessen `npm run server`. Browser-Agenten können Bewegung über `window.__game.controller` steuern, statt gehaltene Tasten zu simulieren, zum Beispiel `controller.move({ forward: true }, facingRadians)` oder kompakte Flags wie `{ f: 1, sr: 1 }`.

Prüfungen laufen in Schichten, beschrieben in [docs/qa-gate.md](../qa-gate.md): richte deinen
Klon mit `git config core.hooksPath .githooks` auf die geteilten Hooks aus, und eine schnelle
Grundprüfung läuft, bevor irgendetwas deine Maschine verlässt.

Die Server-Befehle findest du unter [Online entwickeln](#develop-online-with-hot-reload) oben,
[CONTRIBUTING.de_DE.md](CONTRIBUTING.de_DE.md) für den Beitrags-Workflow, das
[SFX-Studio-Tutorial](../sfx-studio-tutorial.md) für Sounderstellung und
Artefakt-Export, [DEPLOY.md](../../DEPLOY.md) für die Produktion und
[CREDITS.md](../../CREDITS.md) für Asset-Lizenzen.

## Lokalisierung

Jede für Spieler sichtbare Zeichenkette wird über `t()` aufgelöst, und das Spiel erscheint in **22 Sprachen** (Englisch, zwei Spanisch, zwei Französisch, Englisch Kanada, Italienisch, Deutsch, vereinfachtes und traditionelles Chinesisch, Koreanisch, Japanisch, brasilianisches Portugiesisch, Russisch, Tschechisch, Niederländisch, Polnisch, Indonesisch, Türkisch, Schwedisch, Vietnamesisch und Dänisch). Die Sim und der Server bleiben sprachneutral: sie emittieren stabile Schlüssel oder Englisch, das der Client an der Grenze neu lokalisiert, was den Determinismus intakt hält. Mitwirkende fügen nur Englisch hinzu; der Maintainer füllt vor jedem Release die übrigen Sprachen im Batch. Der Workflow ist in `docs/i18n-scaling/translation-workflow.md` dokumentiert.

## Mitwirken

Beiträge jeder Art sind willkommen: Code, Übersetzungen, Fehlerberichte und Dokumentation. Beginne mit [CONTRIBUTING.de_DE.md](CONTRIBUTING.de_DE.md) für die Einrichtung, lies den [Verhaltenskodex](../../CODE_OF_CONDUCT.md) und prüfe [SECURITY.md](../../SECURITY.md), bevor du eine Schwachstelle meldest. Neu hier? Halte Ausschau nach Issues mit dem Label [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), öffne ein [Issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) oder sag Hallo auf [Discord](https://discord.com/invite/worldofclaudecraft).

Die aktive Entwicklung läuft auf dem neuesten `release/vX.Y.Z`-Branch. Schlage ihn nach, statt ihn anzunehmen, zweige dann davon ab und richte deinen Pull Request darauf aus. Zweige niemals von `main` ab und richte auch nichts darauf aus; `main` erhält einen Release-Branch erst, wenn diese Version erscheint. [CONTRIBUTING.md](CONTRIBUTING.de_DE.md) enthält den einzeiligen Befehl, der den aktuellen findet.

## Lizenz

**Der Code ist [MIT-lizenziert](../../LICENSE), also forke ihn, remixe ihn und hoste deine eigene Welt.** Genau darum geht es, und nichts anderes auf dieser Seite oder auf unserer Website nimmt das zurück.

Drei Dinge sind separat lizenziert, daher lohnen sich dreißig Sekunden, um zu wissen, was was ist:

| Was | Lizenz | Darfst du es weitergeben? |
|---|---|---|
| **Quellcode**, also alles außer den unten ausgenommenen Medien-Assets | [MIT](../../LICENSE) | Ja. Auch kommerziell. |
| **Medien-Assets**: Modelle, Texturen, HDRIs, Symbole, Sounds, Schriften (überwiegend unter `public/`) | Je Asset, verzeichnet in [CREDITS.md](../../CREDITS.md) | Überwiegend ja (die meisten sind CC0). Einige nicht, siehe unten. |
| **Name und Branding**: "World of ClaudeCraft", "Levy Street", die Logos | Nicht lizenziert | Nein. |

**Forke es und hoste deine eigene Welt. Das funktioniert, und die Assets stehen dir nicht im Weg.** Das meiste, was du siehst, ist CC0-Public-Domain (KayKit, Quaternius, Kenney, ambientCG, Poly Haven), und unsere eigenen generierten Props, Kreaturen, Kulissen und Interface-Sounds werden mit dem Projekt ausgeliefert, sodass ein Fork sofort läuft. Du kannst sie nur nicht herauslösen und als eigenständige Kunst verkaufen.

Was du vor einer Weitergabe entfernen oder ersetzen müsstest:

- die **CraftPix-Klassenfähigkeitssymbole** unter `public/ui/skills/` wurden von Levy Street gekauft und **dürfen nicht weitergegeben werden**, kaufe also deine eigene Lizenz, wenn du sie ausliefern willst;
- die **@jamiecypher-Soundeffekte** stehen unter CC BY-NC 4.0, teile sie also nicht kommerziell und mit Namensnennung, doch die kommerzielle Erlaubnis gilt nur für dieses Projekt;
- die **Store- und Prestige-Grafik** (Season 1 Armory, das Claudium-Set, das Berufs-Grafikset, Book of Deeds-Symbole, das Elite-Drachenemblem) ist in Auftrag gegebene kommerzielle Kunst, und **alle Rechte sind vorbehalten**;
- die **Markenzeichen von Drittanbietern** (Twitch, X, Kick, YouTube, Discord, Solana, USDC) sind Marken ihrer Inhaber und stehen nicht in unserer Verfügung, um sie weiterzulizenzieren;
- eine Handvoll **mit Erlaubnis genutzter Symbole und Aufnahmen** brauchen eine Erlaubnis zur Weitergabe.

[CREDITS.md](../../CREDITS.md) ist die maßgebliche Liste, mit einer Weitergabespalte je Asset. Wo ein Asset dort aufgeführt ist, hat diese Lizenz Vorrang vor der MIT-Lizenz des Projekts. Dieses Register wird noch vervollständigt, ein dort fehlendes Medien-Asset ist also nicht erfasst statt frei: frage nach, bevor du dich darauf verlässt. Beim Quellcode ist es andersherum, und alles, was nicht ausgenommen ist, ist MIT.

Unsere [Nutzungsbedingungen](https://worldofclaudecraft.com/terms) gelten für das gehostete Spiel, das wir auf worldofclaudecraft.com betreiben: Konten, Verhalten, virtuelle Gegenstände. Sie schränken die Rechte nicht ein, die dir die MIT-Lizenz an diesem Quellcode gibt.
