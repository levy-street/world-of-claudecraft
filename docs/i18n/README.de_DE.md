<div align="center">

# World of ClaudeCraft

**Begib dich auf Quests, schließe dich Gruppen an und raide eine handgebaute Welt, kostenlos in deinem Browser. Open Source, web3 und ab sofort online.**

**Offizielle Website: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.24.1-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.de_DE.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/GjhnUsBtw)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · **Deutsch** · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Jetzt spielen](https://worldofclaudecraft.com/) · [Hoste deine eigene Welt](#host-your-own-world-one-command) · [Trainiere einen Agenten](#train-an-agent-headless-rl) · [Web3](#web3) · [Mitwirken](CONTRIBUTING.de_DE.md) · [Discord](https://discord.gg/GjhnUsBtw)

![Titelbildschirm von World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## Was das ist

World of ClaudeCraft ist ein komplettes MMO im Stil der klassischen Ära, das du sofort in deinem Browser spielen, mit einem einzigen Befehl selbst hosten und sogar KI-Agenten zum Spielen trainieren kannst. Es ist kostenlos, Open Source und live unter [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Eine geteilte Welt läuft an drei Orten, alle aus demselben Spielkern:

- die **Offline-Browser-Welt**, wo du auf Play Offline klickst und sofort drin bist,
- der **autoritative Mehrspieler-Server**, wo Postgres-gestützte Konten eine lebendige Welt teilen,
- die **Headless-RL-Umgebung**, wo Python das echte Spiel über eine Gym-Schnittstelle steuert.

Gleicher Seed, gleiche Welt, überall. Und fast nichts ist ein mitgeliefertes Asset: die Städte, Kreaturen, Zaubersymbole und der Sound werden allesamt zur Laufzeit generiert.

## Highlights

- **Neun klassische Klassen**, jede mit einem echten Vanilla-Kit, das mit dem Aufstieg an Rängen gewinnt, plus ein vollständiges **Talentsystem** (drei Spezialisierungen pro Klasse, 27 Spezialisierungen insgesamt).
- **Drei Open-World-Zonen** von Stufe 1 bis 20, fast 80 Quests und eine einzige zusammenhängende Geschichte über die Verschwörung des Gravecaller.
- **Fünf instanzierte Dungeons**, vier davon Elite-Raids für fünf Spieler und eine Solo-Krypta, mit Elite-Skalierung, AoE-Bossmechaniken und Beute nach Klassenarchetyp.
- **Skalierbare Delves**, ein Kleingruppen-Modus für ein oder zwei Spieler plus einen KI-Begleiter, bei jedem Durchlauf aus zufallsgenerierten Kammern neu aufgebaut, über die Stufen Normal und Heroisch.
- **Das Ashen Coliseum**, eine gewertete PvP-Arena mit 1v1- und 2v2-Ranglisten plus einem 2v2-Fiesta-Modus (Augment-Aufnahmen, ein schrumpfender Ring, wer zuerst fünfzehn Ausschaltungen erreicht).
- **Echtes Mehrspielererlebnis**: Gruppen, Handel, Duelle, Tap-Rechte, gruppengeteilte EP, Flüstern, Abwesenheitsstatus und ein Server, dem jeder Kampfwurf gehört.
- **Alles prozedural**: Fachwerkstädte, geriggte Kreaturenfamilien, auf Canvas gemalte Zaubersymbole, WebAudio-Sound, Biom-Wetter und Echtzeit-Schatten. Keine 3D-Modelldateien für die Welt.
- **Lokalisiert in 21 Sprachen** über eine deterministische Pipeline, in der die Sim Schlüssel emittiert.
- **Headless-RL-Umgebung** mit Gymnasium-Bindings, Reward-Shaping und einem Benchmark-Modus.
- **Web3-nativ**: Verknüpfe eine Solana-Wallet, um deinen $WOC-Kontostand und ein kosmetisches Holder-Abzeichen anzuzeigen, vollständig optional und nicht verwahrend.

## Screenshots

![Eine Gruppe versammelt sich vor der Apotheke in Eastbrook](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Abenddämmerung am Lagerfeuer von Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Abenddämmerung am Lagerfeuer von Eastbrook* | ![Elite-Pulls in der Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Fackelbeleuchtete Elite-Pulls in der Hollow Crypt* |
| ![Die ruhelosen Toten an der zerstörten Kapelle](../../docs/screenshots/restless-dead.jpg)<br>*Die ruhelosen Toten an der zerstörten Kapelle* | ![Ein Handgemenge mit Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*In der Unterzahl im Banditenlager* |
| ![Old Greyjaw auf der Nordstraße zur Strecke gebracht](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, der seltene Spawn, auf der Nordstraße gestellt* | ![Händler- und Taschen-UI](../../docs/screenshots/vendor-and-bags.jpg)<br>*Ausrüsten bei Smith Haldren, mit Tooltips, Taschen und Münzen* |
| ![Das Mondtor an der Küste von Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Die Ertrunkenen klettern am Mondtor von Glimmermere heraus* | ![Ysolei auf dem Altar des Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Mondfeuer und der Altar des Drowned Temple* |

Das Wetter wird vom Biom gesteuert und ist reine Darstellung, daher berührt es niemals die deterministische Sim:

| | | |
|:---:|:---:|:---:|
| ![Klarer Himmel über Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Klar über dem Vale* | ![Regen über Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Regen über Mirefen Marsh* | ![Schnee auf Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Schnee auf Thornpeak Heights* |

## Spiel es

Du hast zwei Einstiegswege, und sie laufen in derselben Welt.

### Offline, in deinem Browser

```bash
npm install
npm run dev        # then open http://localhost:5173 and click Play Offline
```

Benenne deinen Charakter, wähle eine der neun Klassen, und du startest in **Eastbrook Vale** (Stufen 1-7), einer Marktstadt, umringt von sechs Knotenpunkten: Wolfsreviere im Norden, Eberwiesen im Osten, der Webwood im Westen, Mirror Lake im Nordwesten, eine Kobold-Kupfermine im Südwesten und eine zerstörte Kapelle der ruhelosen Toten im Nordosten, mit Gorraks Banditenlager im Südosten. Die Nordstraße erklimmt einen Gebirgspass hinauf nach **Mirefen Marsh** (6-13, Knotenpunkt Fenbridge) und weiter hinauf zu den **Thornpeak Heights** (13-20, Knotenpunkt Highwatch). Der Welt-Seed ist in `src/main.ts` fixiert, daher ist es bei jedem Besuch derselbe Ort.

### Online, mit anderen Spielern

Siehe [Hoste deine eigene Welt](#host-your-own-world-one-command) weiter unten, um das echte Client/Server-Spiel mit Konten und persistenten Charakteren aufzusetzen.

<a id="host-your-own-world-one-command"></a>

## Hoste deine eigene Welt (ein Befehl)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Für **Remote-Hosting** stelle den Compose-Stack auf einem beliebigen VPS bereit, setze in der Umgebung ein echtes `POSTGRES_PASSWORD` und stelle Port 8787 einen TLS-Reverse-Proxy voran. Caddy schafft das in zwei Zeilen (`your.domain { reverse_proxy localhost:8787 }`); WebSockets werden automatisch weitergeleitet und der Client wählt auf https-Seiten automatisch `wss://`. Auth-Endpunkte sind pro IP ratenbegrenzt, Passwörter werden mit scrypt gehasht, und Tokens laufen nach 7 Tagen ab. Setze niemals `ALLOW_DEV_COMMANDS=1` in der Produktion, da es die Stufen- und Teleport-Cheats aktiviert, die die Test-Bots nutzen. Den vollständigen Produktionsleitfaden findest du in [DEPLOY.md](../../DEPLOY.md).

<a id="develop-online-with-hot-reload"></a>

### Online entwickeln mit Hot Reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api and /ws)
```

Öffne http://localhost:5173, wähle **Play Online**, erstelle ein Konto, erstelle einen Charakter und Enter World. Öffne einen zweiten Tab und melde dich erneut an, um euch gegenseitig in der Stadt zu sehen. `Enter` öffnet den Chat. Ein echtes MediaWiki-Spieler-Wiki steht neben dem Docker-Compose-Stack unter http://localhost:8080/wiki/ bereit; seine Seed-Seiten werden aus dem aktuellen Spielinhalt mit `npm run wiki:seed` generiert.

Was persistiert und wie der Server die Kontrolle behält:

- **Konten**: scrypt-gehashte Passwörter und 7-Tage-Bearer-Tokens (`auth_tokens`).
- **Charaktere**: bis zu 10 pro Konto; Stufe, Ausrüstung, Taschen, Quests, Talente, Position und Geld persistieren als JSONB in Postgres, gespeichert alle 30 Sekunden, beim Abmelden und beim Herunterfahren des Servers. Namen sind global eindeutig, nur Buchstaben, im klassischen Stil.
- **Der Server ist autoritativ**: Clients streamen Bewegungsabsicht und Befehle mit 20 Hz; der Server führt die eine geteilte `Sim` aus und liefert interessensbezogene Snapshots (~120 yd) plus spielerbezogene Ereignisse zurück. Jeder Kampfwurf, Beutedrop, jede Questgutschrift und Händlertransaktion wird serverseitig aufgelöst. Der Client ist ein Renderer.

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

env = WoWClassicEnv(player_class="warrior")   # warrior or mage
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **Beobachtungs- und Aktionsräume sind inhaltsabgeleitet.** Frage sie beim Start aus der `info`-Antwort der Umgebung ab, statt sie fest zu codieren; sie wachsen mit dem Spiel. Heute ist der Aktionsraum `Discrete(44)` (Bewegung, Ziel, Angriff, das vollständige Fähigkeiten-Kit, Interaktion, Essen/Trinken) und die Beobachtung ist eine `Box` aus 276 Floats (Selbst, Fähigkeiten, Ziel, nahe Mobs, nächstes interagierbares Objekt, Questfortschritt).
- **Reward** ist eine gewichtete Summe von Zähler-Deltas pro Tick (EP, ausgeteilter und erlittener Schaden, Kills, Tode, Questfortschritt, Stufenaufstiege), pro Reset einstellbar. Jeder `step` wendet eine Aktion an und rückt standardmäßig fünf Sim-Ticks vor, also grob vier Entscheidungen pro simulierter Sekunde.
- **Deterministisch von Grund auf.** Keine Wanduhr, kein `Math.random`. Seede den Reset und die Episode spielt sich exakt wieder ab.

Das Protokoll und die Bindings sind in `headless/CLAUDE.md` und `python/CLAUDE.md` dokumentiert.

<a id="web3"></a>

## Web3

World of ClaudeCraft ist web3-nativ rund um **$WOC**, unseren Community-Token auf Solana. Verbinde eine Solana-Wallet, verknüpfe sie mit einer einzigen Signatur mit deinem Konto (nicht verwahrend, keine zu bestätigende Transaktion), und dein schreibgeschützter $WOC-Kontostand erscheint im HUD neben einem kosmetischen Holder-Tier-Abzeichen.

Es ist rein kosmetisch und zum Spielen nicht erforderlich. Im Spiel wird nichts ausgegeben oder verdient, es gibt kein Pay-to-Win, und das gesamte Spiel läuft einwandfrei, ohne jemals eine Wallet zu verbinden.

**$WOC-Contract-Adresse (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Mehr zum Token unter [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Eine Tour durch die Welt

### Die neun Klassen

Jede Klasse nutzt echte Vanilla-Mechaniken und erlernt rangbasierte Zauber über die Stufen 1-20 (Lightning Bolt R2 auf 8, R3 auf 14, R4 auf 20, mit High-Band-Fähigkeiten wie Execute, Kidney Shot, Flash Heal, Stormstrike und Starfire, die auf ihrer klassischen Stufe eintreffen).

- **Warrior**: Wut, Heroic Strike (beim nächsten Schlag, off-GCD), Battle Shout, Charge, Rend, Thunder Clap, Hamstring, Bloodrage, Overpower (Dodge-Proc).
- **Paladin**: Seal of Righteousness, entfesselt durch Judgement, Holy Light, Devotion Aura, Blessing of Might, Divine Protection (Absorption), Hammer of Justice (Betäubung), Lay on Hands.
- **Hunter**: Fern-Auto Shot (8-35 yd mit der klassischen Dead Zone), Raptor Strike, Aspect of the Hawk, Serpent Sting, Arcane Shot, Concussive Shot, Mongoose Bite, Wing Clip und ein zähmbares Pet ab Stufe 10.
- **Rogue**: Energie und Combo-Punkte, Sinister Strike, Eviscerate, Backstab (von hinten, Dolch), Gouge, Evasion, Slice and Dice, Sprint.
- **Priest**: Smite, Lesser Heal, Power Word: Fortitude, Shadow Word: Pain, Power Word: Shield (Absorption), Renew (HoT), Mind Blast.
- **Shaman**: Lightning Bolt, Rockbiter Weapon (Imbue), Healing Wave, Earth Shock, Lightning Shield (Thorns), Flame Shock.
- **Mage**: Fireball, Frost Armor, Arcane Intellect, Frostbolt, Conjure Water, Fire Blast, Arcane Missiles (kanalisiert), Polymorph, Frost Nova.
- **Warlock**: Shadow Bolt, Demon Skin, Immolate, Corruption, Life Tap, Curse of Agony, Drain Life und sieben beschwörbare Dämonen vom Imp bis zum Doomguard.
- **Druid**: Wrath, Healing Touch, Mark of the Wild, Moonfire, Rejuvenation, Thorns, Entangling Roots, Bear Form auf 10.

Heilungen und Buffs treffen Gruppenmitglieder, Heilung kann critten, und Absorb-Schilde schlucken Schaden, bevor er die Gesundheit erreicht. Verteile Punkte über **drei Talentspezialisierungen pro Klasse** (Arms/Fury/Protection, Balance/Feral/Restoration und so weiter); die Verteilung wird serverseitig validiert und ist als Build-String exportierbar.

### Dungeons

Die Gravecaller-Geschichte verläuft durch vier Elite-Instanzen für fünf Spieler, und eine Solo-Krypta liegt für Entdecker abseits.

- **The Hollow Crypt** (5 Spieler) unter der Fallen Chapel: paarweise Elite-Trash, der Miniboss Sexton Marrow und Morthen the Gravecaller, der alle zehn Sekunden einen Shadow Pulse als AoE wirkt. Die Kryptentür teleportiert deine Gruppe in eine private Instanzkopie, die sich nach fünf leeren Minuten zurücksetzt.
- **The Sunken Bastion** (5 Spieler, um Stufe 13, Südosten von Mirefen): Vael the Mistcaller beschwört bei 60% und 30% Gesundheit Wellen von Drowned Thralls.
- **Gravewyrm Sanctum** (5 Spieler, Stufe 20, unter Thornpeak): drei Kammern voller Elite-Knochenwächter und Drakoniden, Korgath the Bound (entbrennt unter 30%), Grand Necromancer Velkhar und Korzul the Gravewyrm, wo epische Waffen fallen.
- **The Drowned Temple** (5 Spieler) durch das Mondtor von Glimmermere: eine fahle, mondviolette Instanz, die zu Choirmother Selthe und dann zu Ysolei, Avatar of the Drowned Moon, führt, die alle neun Sekunden Lunar Tide pulsen lässt und bei 60% und 30% Moonspawn beschwört.
- **The Abandoned Crypt** (Solo) in Thornpeak: ein stiller Tauchgang aus Schlüsselsteinen und Tagebüchern für einen Einzelnen, dessen Spur die königliche Tür zu **Nythraxis, Scourge of Thornpeak** entsiegelt, einem Raid-Finale für zehn Spieler, das über drei Seelen-Wardsteine ausgetragen wird.

Die hinführenden Questketten sind solofähig, sodass die Geschichte nie davon abhängt, eine Gruppe zu finden. Unser automatisierter Fünf-Bot-Raid (Warrior, Paladin, Priest, Mage, Hunter mit Fokusfeuer und Heiler-KI) räumt die Hollow Crypt in etwa fünf Minuten (`node scripts/crypt_raid.mjs`, benötigt `ALLOW_DEV_COMMANDS=1`).

### Delves

Delves sind ein separater, skalierbarer Kleingruppen-Modus für ein oder zwei Spieler. **The Collapsed Reliquary** (ab Stufe 7) ist eine Krypta, die bei jedem Durchlauf aus zufallsgenerierten Kammern neu aufgebaut wird und bei Deacon Varric endet. Spiele es solo und ein KI-Begleiter, Tessa, kämpft an deiner Seite. Brother Halven an der Reliquienruine betreut das Delve-Board, wo Normal oder Heroisch deine Wahl ist: Heroisch hebt die Gegnerstufen an und fügt für reichere Belohnungen ein zufälliges Affix hinzu.

### Das Ashen Coliseum (gewertetes PvP)

Drücke `G` oder den Arena-Button, um dich anzustellen. Das Matchmaking teleportiert die Kämpfer in eine private, fackelbeleuchtete Grube, ein kurzer Countdown heilt und setzt alle für einen fairen Start zurück, und das Gefecht endet, wenn eine Seite bei 1 HP aufgibt. Niemand stirbt, und du kehrst genau dorthin zurück, wo du dich angestellt hast.

- **Gewertete 1v1- und 2v2-Ranglisten**, jede mit einer persistenten Elo-artigen Wertung (alle starten bei 1500) und einer Allzeit-Bestenliste (`GET /api/arena/leaderboard`).
- **2v2-Fiesta**, ein lebhafterer Party-Modus: das erste Team mit fünfzehn Ausschaltungen gewinnt innerhalb eines Sechs-Minuten-Limits, Spieler respawnen mit wachsenden Timern, Augment-Aufnahmen verteilen über drei Wellen Macht, und ein sich schließender Ring zwingt den Kampf zusammen.

### Gemeinsam spielen

- **Gruppen** bis zu 5: Rechtsklick auf einen Spieler und In Gruppe einladen. Mitglieder teilen Tap-Rechte und Questgutschrift, teilen EP mit den echten Vanilla-Gruppenboni (1.166 / 1.3 / 1.43 für 3/4/5) und erscheinen als Punkte auf der Minimap. `/p` für den Gruppenchat, `/roll` zum Auswürfeln von Beute.
- **Handel**: Rechtsklick und Handeln. Beide Seiten legen Gegenstände und Geld vor, beide müssen bestätigen, und der Tausch ist atomar und serverseitig validiert. Questgegenstände können nicht gehandelt werden, und Auseinandergehen bricht ab.
- **Duelle**: Rechtsklick und Zu einem Duell herausfordern. Ein 3-Sekunden-Countdown, dann Kampf, bis eine Seite 1 HP erreicht; der Sieger wird zonenweit verkündet, und 60 Yards wegzulaufen bedeutet Aufgabe.
- **Tap-Rechte und Abwesenheitsstatus**: der erste Spieler, der einem Mob Schaden zufügt, besitzt dessen Beute, EP und Questgutschrift; `/afk` und `/dnd` markieren dich als abwesend mit einer automatischen Antwort auf Flüstern.

### Welt und Systeme

- **Essen und Trinken**: Setze dich, um über 18 Sekunden zu regenerieren, unterbrochen durch Schaden oder Aufstehen, und ja, du kannst gleichzeitig essen und trinken.
- **Händler**, die Essen und Wasser kaufen und ehrliche weiße Ausrüstung verkaufen, mit Münzen in Gold, Silber und Kupfer.
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
| `C` `P` `L` `M` `B` `G` | Charakter, Zauberbuch, Questlog, Weltkarte, Taschen, Arena |
| `V` / `R` / `Esc` | Namensplaketten, Autorun, Fenster schließen oder Ziel löschen |

Touch-Steuerung (ein Bewegungsstick, Kamera-Ziehen und Aktionsbuttons auf dem Bildschirm) erscheint auf Mobilgeräten automatisch.

## Architektur (eine Sim, drei Hosts)

Drei Ideen halten das Projekt zusammen:

- **Eine Sim, drei Hosts.** Derselbe `src/sim/`-Code betreibt die Offline-Browser-Welt, den Online-Server und die RL-Umgebung. Das Verhalten muss überall identisch sein, und die Tests existieren, um das so zu halten.
- **`IWorld` ist die einzige Nahtstelle.** `src/world_api.ts` definiert `IWorld`. Die Offline-`Sim` erfüllt es strukturell, und die Online-`ClientWorld` implementiert es, indem sie Server-Snapshots spiegelt. Der Renderer und das HUD sprechen nur mit `IWorld`, niemals mit einer konkreten Welt, sodass ein neues Feature zuerst die Schnittstelle erweitert und dann beide Welten.
- **Der Server ist autoritativ.** Clients senden Absicht; der Server entscheidet die Ergebnisse. Der Client löst Kampf, Beute oder Wirtschaft niemals selbst auf.

Die Sim ist ein fester 20-Hz-Tick (`DT = 1/20`), alle Zufälligkeit fließt durch eine einzige geseedete `Rng`, und `src/sim/` enthält keinerlei DOM-, Browser- oder Three.js-Imports. Genau das erlaubt es, denselben Code in einen Node-Env-Server, eine autoritative Spielschleife und einen Browser-Tab zu bündeln, ohne eine Zeile zu ändern.

### Projektaufbau

| Pfad | Was es ist |
|---|---|
| `src/sim/` | Deterministischer Spielkern, die Quelle der Wahrheit. Keine DOM- oder Three-Abhängigkeiten. |
| `src/sim/content/` | Daten als Code: die neun Klassen, Fähigkeiten, Zonen, Dungeons, Gegenstände, Talente. |
| `src/render/` | Three.js-Renderer (prozedurale Geometrie, Texturen, VFX). Liest die Welt, mutiert sie nie. |
| `src/game/` | Lokale Eingabe, Kamera, Tastenbelegungen, Mobile-Steuerung, prozedurales WebAudio. |
| `src/ui/` | Klassisches HUD (Frames, Fenster, Tooltips, Karte, Floating Combat Text), prozedurale Symbole, i18n. |
| `src/net/` | Online-Client: REST-Auth plus ein WebSocket-Weltspiegel (`ClientWorld`). |
| `src/admin/` | Admin-Dashboard-SPA (separater `admin.html`-Einstieg). |
| `server/` | Autoritativer Server: HTTP und WS, Weltschleife, Postgres, Auth, Soziales, Moderation. |
| `headless/` + `python/` | RL-Env-Server (`env_server.ts`) und Python-Gym-Bindings. |
| `tests/` | Vitest-Suite. |
| `scripts/` | Asset-Build plus Browser-E2E, Screenshot- und Integrationsskripte. |
| `public/` · `docs/` | Statische Assets (GLB-Modelle, Texturen, HDRIs) und Designdokumente. |

Die meisten Verzeichnisse tragen ihre eigene `CLAUDE.md` mit lokalen Konventionen. Der vollständige Satz an Projektinvarianten lebt in der Wurzel-[`CLAUDE.md`](../../CLAUDE.md).

## Gebaut wie die Klassiker

Kampf, Stufenaufstieg und Bedrohung laufen allesamt nach authentischen Regeln der klassischen Ära: Wut und Energie, Treffer- und Ausweichtabellen, Rüstungsminderung, die echte EP-Kurve, Swing-Timer und der globale Cooldown. Es fühlt sich so an, wie du es in Erinnerung hast, statt es nur anzunähern. Die genauen Zahlen liegen in `src/sim/`, falls du sie nachlesen willst.

Und fast nichts davon ist ein mitgeliefertes Asset. Die Welt wird aus Code gezeichnet:

- Prozedurale Städte, Kreaturen, Gelände, Wasser, Wetter und Echtzeit-Schatten, ohne 3D-Modelldateien für die Welt.
- Zwölf geriggte Kreaturenfamilien mit vollständigen Geh-, Angriffs-, Zauber-, Sitz- und Todesanimationen.
- Zauber-, Gegenstands- und Buff-Symbole, zur Laufzeit auf Canvas gemalt.
- Ein vollständiges klassisches HUD (Unit-Frames, Aktionsleisten, Tooltips, Questlog, Weltkarte, Minimap, Floating Combat Text) und prozedurales WebAudio für jeden Sound.

## Entwicklung

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

Logik- und Unit-Tests nutzen Vitest. Führe beim Iterieren eine einzelne Datei aus: `npx vitest run tests/sim.test.ts`. Die E2E- und visuellen Skripte steuern echte Browser über `puppeteer-core` und benötigen ein laufendes `npm run dev` (oft auch `npm run server`). Browser-Agenten können Bewegung über `window.__game.controller` steuern, statt gehaltene Tasten zu simulieren, zum Beispiel `controller.move({ forward: true }, facingRadians)` oder kompakte Flags wie `{ f: 1, sr: 1 }`.

Die Server-Befehle findest du unter [Online entwickeln](#develop-online-with-hot-reload) oben, [DEPLOY.md](../../DEPLOY.md) für die Produktion und [CREDITS.md](../../CREDITS.md) für Asset-Lizenzen.

## Lokalisierung

Jede für Spieler sichtbare Zeichenkette wird über `t()` aufgelöst, und das Spiel erscheint in **21 Sprachen** (Englisch, zwei Spanisch, zwei Französisch, Englisch Kanada, Italienisch, Deutsch, vereinfachtes und traditionelles Chinesisch, Koreanisch, Japanisch, brasilianisches Portugiesisch, Russisch, Niederländisch, Polnisch, Indonesisch, Türkisch, Schwedisch, Vietnamesisch und Dänisch). Die Sim und der Server bleiben sprachneutral: sie emittieren stabile Schlüssel oder Englisch, das der Client an der Grenze neu lokalisiert, was den Determinismus intakt hält. Mitwirkende fügen nur Englisch hinzu; der Maintainer füllt vor jedem Release die übrigen Sprachen im Batch. Der Workflow ist in `docs/i18n-scaling/translation-workflow.md` dokumentiert.

## Mitwirken

Beiträge jeder Art sind willkommen: Code, Übersetzungen, Fehlerberichte und Dokumentation. Beginne mit [CONTRIBUTING.de_DE.md](CONTRIBUTING.de_DE.md) für die Einrichtung, lies den [Verhaltenskodex](../../CODE_OF_CONDUCT.md) und prüfe [SECURITY.md](../../SECURITY.md), bevor du eine Schwachstelle meldest. Neu hier? Halte Ausschau nach Issues mit dem Label [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), öffne ein [Issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) oder sag Hallo auf [Discord](https://discord.gg/GjhnUsBtw).

<div align="center">

![World of Claude](../../worldofclaude.png)

![World of ClaudeCraft Community](../../woc_community.png)

</div>

## Lizenz

Der Code ist [MIT-lizenziert](../../LICENSE), also forke ihn, remixe ihn und hoste deine eigene Welt.

Die mitgelieferten Kunst-Assets von Drittanbietern (Modelle, Texturen, HDRIs) behalten ihre eigenen Lizenzen, allesamt CC0-Public-Domain bis auf die MIT-Wassernormalmaps, je Pack dokumentiert in [CREDITS.md](../../CREDITS.md).
