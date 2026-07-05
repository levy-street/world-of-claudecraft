<div align="center">

# World of ClaudeCraft

**Affronta missioni, forma gruppi e fai incursioni in un mondo costruito a mano, gratis nel tuo browser. Open source, web3 e online proprio ora.**

**Sito ufficiale: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.14.1-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.it_IT.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/GjhnUsBtw)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · **Italiano** · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Gioca ora](https://worldofclaudecraft.com/) · [Ospita il tuo mondo](#host-your-own-world-one-command) · [Addestra un agente](#train-an-agent-headless-rl) · [Web3](#web3) · [Contribuisci](CONTRIBUTING.it_IT.md) · [Discord](https://discord.gg/GjhnUsBtw)

![Schermata del titolo di World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## Di cosa si tratta

World of ClaudeCraft è un MMO completo in stile classico che puoi giocare proprio ora nel tuo browser, ospitare da solo con un unico comando e su cui puoi persino addestrare agenti IA a giocare. È gratuito, open source e attivo su [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Un unico mondo condiviso gira in tre posti, tutti a partire dallo stesso nucleo di gioco:

- il **mondo offline nel browser**, dove fai clic su Play Offline e sei subito dentro,
- il **server multiplayer autoritativo**, dove account basati su Postgres condividono un mondo vivo,
- l'**ambiente RL headless**, dove Python pilota il gioco vero attraverso un'interfaccia Gym.

Stesso seed, stesso mondo, ovunque. E quasi nulla è un asset preconfezionato: le città, le creature, le icone delle magie e il suono sono tutti generati a runtime.

## In evidenza

- **Nove classi classiche**, ognuna con un vero kit in stile vanilla che acquisisce ranghi man mano che sali di livello, più un completo **sistema di talenti** (tre specializzazioni per classe, 27 specializzazioni in tutto).
- **Tre zone open world** dal livello 1 al 20, quasi 80 missioni e un'unica trama collegata sulla cospirazione dei Gravecaller.
- **Cinque dungeon a istanze**, quattro dei quali incursioni d'élite per cinque giocatori e una cripta in solitaria, con scaling d'élite, meccaniche dei boss ad AoE e bottino legato all'archetipo della classe.
- **Delve scalabili**, una modalità per piccoli gruppi da uno o due giocatori più un compagno IA, ricostruita da camere casuali a ogni run nei livelli Normale ed Eroico.
- **L'Ashen Coliseum**, un'arena PvP classificata con scale 1v1 e 2v2 più una modalità Fiesta 2v2 (potenziamenti da raccogliere, un cerchio che si restringe, primo a quindici eliminazioni).
- **Multiplayer vero**: gruppi, scambi, duelli, diritti di tap, XP divisa nel gruppo, sussurri, stato di assenza e un server che possiede ogni tiro di combattimento.
- **Tutto procedurale**: città a graticcio, famiglie di creature dotate di scheletro, icone delle magie dipinte su canvas, suono WebAudio, meteo per bioma e ombre in tempo reale. Nessun file di modello 3D per il mondo.
- **Localizzato in 21 lingue** tramite una pipeline deterministica in cui la sim emette chiavi.
- **Ambiente RL headless** con binding Gymnasium, modellazione della ricompensa e una modalità benchmark.
- **Nativo web3**: collega un portafoglio Solana per mostrare il tuo saldo $WOC e un distintivo cosmetico da possessore, del tutto opzionale e non in custodia.

## Screenshot

![Un gruppo si raduna fuori dall'apotecario a Eastbrook](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Crepuscolo al falò di Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Crepuscolo al falò di Eastbrook* | ![Pull d'élite nella Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Pull d'élite a lume di torcia nella Hollow Crypt* |
| ![I morti senza pace nella cappella in rovina](../../docs/screenshots/restless-dead.jpg)<br>*I morti senza pace nella cappella in rovina* | ![Una rissa con i Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*In inferiorità numerica all'accampamento dei banditi* |
| ![Old Greyjaw braccato sulla strada del nord](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, lo spawn raro, abbattuto sulla strada del nord* | ![Interfaccia del venditore e delle borse](../../docs/screenshots/vendor-and-bags.jpg)<br>*Ci si equipaggia da Smith Haldren, con tooltip, borse e monete* |
| ![Il moongate sulla riva di Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Gli annegati risalgono al moongate di Glimmermere* | ![Ysolei sull'altare del Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Moonfire e l'altare del Drowned Temple* |

Il meteo è guidato dal bioma ed esiste solo a livello di rendering, quindi non tocca mai la sim deterministica:

| | | |
|:---:|:---:|:---:|
| ![Cieli sereni su Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Sereno sulla Vale* | ![Pioggia su Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Pioggia su Mirefen Marsh* | ![Neve su Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Neve su Thornpeak Heights* |

## Giocaci

Hai due modi per entrare, e fanno girare lo stesso mondo.

### Offline, nel tuo browser

```bash
npm install
npm run dev        # then open http://localhost:5173 and click Play Offline
```

Dai un nome al tuo personaggio, scegli una qualsiasi delle nove classi e parti in **Eastbrook Vale** (livelli 1-7), una città di mercato circondata da sei hub: i sentieri dei lupi a nord, i prati dei cinghiali a est, la Webwood a ovest, Mirror Lake a nordovest, uno scavo di rame dei kobold a sudovest e una cappella in rovina di morti senza pace a nordest, con l'accampamento dei banditi di Gorrak a sudest. La strada del nord risale un passo di montagna fino a **Mirefen Marsh** (6-13, hub Fenbridge) e prosegue su fino a **Thornpeak Heights** (13-20, hub Highwatch). Il seed del mondo è fissato in `src/main.ts`, quindi è lo stesso luogo a ogni visita.

### Online, con altri giocatori

Vedi [Ospita il tuo mondo](#host-your-own-world-one-command) qui sotto per allestire il vero gioco client/server con account e personaggi persistenti.

<a id="host-your-own-world-one-command"></a>

## Ospita il tuo mondo (un solo comando)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Per l'**hosting remoto**, metti lo stack compose su un qualsiasi VPS, imposta una vera `POSTGRES_PASSWORD` nell'ambiente e poni davanti alla porta 8787 un reverse proxy TLS. Con Caddy bastano due righe (`your.domain { reverse_proxy localhost:8787 }`); i WebSocket vengono proxati automaticamente e il client seleziona da solo `wss://` sulle pagine https. Gli endpoint di autenticazione hanno un rate limit per IP, le password sono cifrate con scrypt e i token scadono dopo 7 giorni. Non impostare mai `ALLOW_DEV_COMMANDS=1` in produzione, poiché abilita i trucchi di livello e teletrasporto usati dai bot di test. Vedi [DEPLOY.md](../../DEPLOY.md) per la guida completa alla produzione.

<a id="develop-online-with-hot-reload"></a>

### Sviluppa online con hot reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api and /ws)
```

Apri http://localhost:5173, scegli **Play Online**, crea un account, crea un personaggio ed Enter World. Apri una seconda scheda e accedi di nuovo per vedervi a vicenda in città. `Enter` apre la chat. Un vero wiki MediaWiki per i giocatori si avvia insieme allo stack Docker Compose su http://localhost:8080/wiki/; le sue pagine iniziali sono generate dal contenuto di gioco corrente con `npm run wiki:seed`.

Cosa persiste e come il server resta al comando:

- **Account**: password cifrate con scrypt e bearer token di 7 giorni (`auth_tokens`).
- **Personaggi**: fino a 10 per account; livello, equipaggiamento, borse, missioni, talenti, posizione e denaro persistono come JSONB in Postgres, salvati ogni 30 secondi, al logout e allo spegnimento del server. I nomi sono univoci a livello globale, solo lettere, in stile classico.
- **Il server è autoritativo**: i client trasmettono in streaming l'intento di movimento e i comandi a 20 Hz; il server fa girare l'unica `Sim` condivisa e restituisce snapshot limitati all'interesse (~120 yd) più eventi per ciascun giocatore. Ogni tiro di combattimento, drop di bottino, credito di missione e transazione col venditore si risolve lato server. Il client è un renderer.

<a id="train-an-agent-headless-rl"></a>

## Addestra un agente (RL headless)

Lo stesso nucleo deterministico gira come ambiente [Gymnasium](https://gymnasium.farama.org/), quindi un agente impara contro il gioco vero, non contro una sua reimplementazione. Il server dell'ambiente (`headless/env_server.ts`) avvolge un'unica `Sim` e parla JSON delimitato da newline su stdio; i binding Python in `python/` lo lanciano come sottoprocesso ed espongono il consueto ciclo `reset` / `step` / `close`.

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

- **Gli spazi di osservazione e di azione derivano dal contenuto.** Interrogali dalla risposta `info` dell'ambiente all'avvio invece di codificarli rigidamente; crescono insieme al gioco. Oggi lo spazio di azione è `Discrete(44)` (movimento, bersaglio, attacco, l'intero kit di abilità, interazione, mangiare/bere) e l'osservazione è un `Box` di 276 float (sé, abilità, bersaglio, mob vicini, interagibile più vicino, progresso delle missioni).
- **La ricompensa** è una somma pesata delle differenze dei contatori per tick (XP, danno inflitto e subito, uccisioni, morti, progresso delle missioni, salite di livello), regolabile a ogni reset. Ogni `step` applica un'azione e fa avanzare cinque tick della sim per impostazione predefinita, quindi all'incirca quattro decisioni per secondo simulato.
- **Deterministico per costruzione.** Nessun orologio reale, nessun `Math.random`. Imposta il seed del reset e l'episodio si riproduce esattamente.

Il protocollo e i binding sono documentati in `headless/CLAUDE.md` e `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft è nativo web3 intorno a **$WOC**, il nostro token della community su Solana. Collega un portafoglio Solana, associalo al tuo account con una sola firma (non in custodia, nessuna transazione da approvare) e il tuo saldo $WOC in sola lettura compare nell'HUD insieme a un distintivo cosmetico di livello da possessore.

È solo cosmetico e non serve per giocare. Nulla si spende o si guadagna in gioco, non c'è pay-to-win e l'intero gioco si gioca benissimo senza mai collegare un portafoglio.

**Indirizzo del contratto $WOC (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Maggiori informazioni sul token su [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Un giro per il mondo

### Le nove classi

Ogni classe usa vere meccaniche in stile vanilla e impara magie a ranghi attraverso i livelli 1-20 (Lightning Bolt R2 a 8, R3 a 14, R4 a 20, con abilità di fascia alta come Execute, Kidney Shot, Flash Heal, Stormstrike e Starfire che arrivano al loro livello classico).

- **Warrior**: ira, Heroic Strike (al prossimo colpo, fuori GCD), Battle Shout, Charge, Rend, Thunder Clap, Hamstring, Bloodrage, Overpower (proc da schivata).
- **Paladin**: Seal of Righteousness scatenato da Judgement, Holy Light, Devotion Aura, Blessing of Might, Divine Protection (assorbimento), Hammer of Justice (stordimento), Lay on Hands.
- **Hunter**: Auto Shot a distanza (8-35 yd con la classica zona morta), Raptor Strike, Aspect of the Hawk, Serpent Sting, Arcane Shot, Concussive Shot, Mongoose Bite, Wing Clip e un pet domabile dal livello 10.
- **Rogue**: energia e punti combo, Sinister Strike, Eviscerate, Backstab (alle spalle, con pugnale), Gouge, Evasion, Slice and Dice, Sprint.
- **Priest**: Smite, Lesser Heal, Power Word: Fortitude, Shadow Word: Pain, Power Word: Shield (assorbimento), Renew (HoT), Mind Blast.
- **Shaman**: Lightning Bolt, Rockbiter Weapon (incantamento), Healing Wave, Earth Shock, Lightning Shield (spine), Flame Shock.
- **Mage**: Fireball, Frost Armor, Arcane Intellect, Frostbolt, Conjure Water, Fire Blast, Arcane Missiles (canalizzato), Polymorph, Frost Nova.
- **Warlock**: Shadow Bolt, Demon Skin, Immolate, Corruption, Life Tap, Curse of Agony, Drain Life e sette demoni evocabili dall'Imp al Doomguard.
- **Druid**: Wrath, Healing Touch, Mark of the Wild, Moonfire, Rejuvenation, Thorns, Entangling Roots, Bear Form a 10.

Cure e buff colpiscono i membri del gruppo, le cure possono fare critico e gli scudi di assorbimento incassano il danno prima della salute. Spendi punti tra **tre specializzazioni di talenti per classe** (Arms/Fury/Protection, Balance/Feral/Restoration, e così via); l'allocazione è validata dal server ed esportabile come stringa di build.

### Dungeon

La trama dei Gravecaller attraversa quattro istanze d'élite per cinque giocatori, e una cripta in solitaria sta in disparte per gli esploratori.

- **The Hollow Crypt** (5 giocatori) sotto la Fallen Chapel: trash d'élite in coppia, il miniboss Sexton Marrow e Morthen the Gravecaller, che rilascia un AoE Shadow Pulse ogni dieci secondi. La porta della cripta teletrasporta il tuo gruppo in una copia privata dell'istanza che si resetta dopo cinque minuti vuota.
- **The Sunken Bastion** (5 giocatori, intorno al livello 13, Mirefen sudest): Vael the Mistcaller evoca ondate di Drowned Thralls al 60% e al 30% di salute.
- **Gravewyrm Sanctum** (5 giocatori, livello 20, sotto Thornpeak): tre camere di boneguard e drakonid d'élite, Korgath the Bound (va in furia sotto il 30%), Grand Necromancer Velkhar e Korzul the Gravewyrm, dove cadono armi epiche.
- **The Drowned Temple** (5 giocatori) attraverso il moongate di Glimmermere: un'istanza pallida, viola-luna che conduce a Choirmother Selthe e poi a Ysolei, Avatar of the Drowned Moon, che pulsa Lunar Tide ogni nove secondi ed evoca Moonspawn al 60% e al 30%.
- **The Abandoned Crypt** (in solitaria) a Thornpeak: una tranquilla discesa fatta di chiavi di volta e diari per uno, la cui traccia dissigilla la porta reale verso **Nythraxis, Scourge of Thornpeak**, un finale a incursione per dieci giocatori combattuto attraverso tre wardstone delle anime.

Le catene di missioni preparatorie sono affrontabili in solitaria, quindi la storia non è mai bloccata dietro il trovare un gruppo. La nostra incursione automatizzata a cinque bot (warrior, paladin, priest, mage, hunter con IA di focus-fire e cura) ripulisce la Hollow Crypt in circa cinque minuti (`node scripts/crypt_raid.mjs`, richiede `ALLOW_DEV_COMMANDS=1`).

### Delve

Le delve sono una modalità per piccoli gruppi separata e scalabile per uno o due giocatori. **The Collapsed Reliquary** (livello 7 e oltre) è una cripta ricostruita da camere casuali a ogni run, che si conclude con Deacon Varric. Affrontala in solitaria e un compagno IA, Tessa, combatte al tuo fianco. Brother Halven, presso la rovina della reliquia, gestisce la bacheca delle delve, dove Normale o Eroico è una tua scelta: l'Eroico alza i livelli dei nemici e aggiunge un affisso casuale per ricompense più ricche.

### L'Ashen Coliseum (PvP classificato)

Premi `G` o il pulsante dell'arena per metterti in coda. Il matchmaking teletrasporta i combattenti in una fossa privata illuminata da torce, un breve conto alla rovescia cura e resetta tutti per una partenza equa, e lo scontro finisce quando uno schieramento si arrende a 1 hp. Nessuno muore, e torni esattamente dove ti sei messo in coda.

- **Scale classificate 1v1 e 2v2**, ciascuna con un punteggio persistente in stile Elo (tutti partono da 1500) e una classifica di tutti i tempi (`GET /api/arena/leaderboard`).
- **Fiesta 2v2**, una modalità di gruppo più vivace: la prima squadra a quindici eliminazioni vince entro un limite di sei minuti, i giocatori rinascono con timer crescenti, i potenziamenti da raccogliere distribuiscono potere su tre ondate e un cerchio che si chiude costringe lo scontro a unirsi.

### Giocare insieme

- **Gruppi** fino a 5: clic destro su un giocatore e Invita al Gruppo. I membri condividono i diritti di tap e il credito di missione, dividono l'XP con i veri bonus di gruppo vanilla (1.166 / 1.3 / 1.43 per 3/4/5) e compaiono come puntini sulla minimappa. `/p` per la chat di gruppo, `/roll` per assegnare il bottino.
- **Scambi**: clic destro e Scambia. Entrambe le parti mettono in scena oggetti e denaro, entrambe devono accettare, e lo scambio è atomico e validato dal server. Gli oggetti delle missioni non possono essere scambiati, e allontanarsi annulla tutto.
- **Duelli**: clic destro e Sfida a Duello. Un conto alla rovescia di 3 secondi, poi si combatte finché uno schieramento arriva a 1 hp; il vincitore è annunciato in tutta la zona e scappare a 60 yard di distanza fa perdere.
- **Diritti di tap e stato di assenza**: il primo giocatore a danneggiare un mob ne possiede il bottino, l'XP e il credito di missione; `/afk` e `/dnd` ti segnalano come assente con una risposta automatica ai sussurri.

### Mondo e sistemi

- **Mangiare e bere**: siediti per recuperare nell'arco di 18 secondi, interrotto dal danno o dall'alzarsi, e sì, puoi mangiare e bere contemporaneamente.
- **Venditori** che comprano cibo e acqua e vendono onesto equipaggiamento bianco, con le monete mostrate in oro, argento e rame.
- **IA dei mob**: vagabondaggio, aggro per prossimità in base alla differenza di livello, pull sociali, inseguimento, guinzaglio e reset, bottino dai cadaveri e respawn, con uno spawn raro (Old Greyjaw) su un timer lungo.
- **Punti di pesca** con le proprie tabelle di bottino e catture rare.
- **Skin cosmetiche** ottenute con rarità non comune, rara ed epica, puramente estetiche.
- **Morte e recupero**: libera il tuo spirito verso il cimitero, subisci danni da caduta e rallenta mentre nuoti.
- **Meteo per bioma**: sereno nella Vale, pioggia nella Marsh, neve sui Peaks, con dissolvenze incrociate mentre ti sposti tra le zone.

### Comandi (layout classico)

| Input | Azione |
|---|---|
| `W` / `S` | corri / indietreggia. `A`/`D` girano (strafe con il tasto destro del mouse premuto), `Q`/`E` strafe |
| trascinamento destro / sinistro | mouselook / camera in orbita. La rotella zooma, `Space` salta |
| `Tab` | scorri i nemici più vicini. Clic sinistro per bersagliare, clic destro per attaccare, saccheggiare o parlare |
| `1`-`9`, `0`, `-`, `=` | barra delle azioni |
| `F` | interagisci (saccheggia un cadavere, raccogli un oggetto, parla) |
| `C` `P` `L` `M` `B` `G` | personaggio, libro degli incantesimi, registro missioni, mappa del mondo, borse, arena |
| `V` / `R` / `Esc` | targhette dei nomi, corsa automatica, chiudi finestre o annulla bersaglio |

I comandi touch (uno stick di movimento, trascinamento della camera e pulsanti d'azione su schermo) compaiono automaticamente su dispositivi mobili.

## Architettura (una sim, tre host)

Tre idee tengono insieme il progetto:

- **Una sim, tre host.** Lo stesso codice `src/sim/` fa girare il mondo offline nel browser, il server online e l'ambiente RL. Il comportamento deve essere identico ovunque, e i test esistono per mantenerlo tale.
- **`IWorld` è l'unica giuntura.** `src/world_api.ts` definisce `IWorld`. La `Sim` offline lo soddisfa strutturalmente e la `ClientWorld` online lo implementa rispecchiando gli snapshot del server. Il renderer e l'HUD parlano solo con `IWorld`, mai con un mondo concreto, quindi una nuova funzionalità estende prima l'interfaccia e poi entrambi i mondi.
- **Il server è autoritativo.** I client inviano l'intento; il server decide gli esiti. Il client non risolve mai da solo combattimento, bottino o economia.

La sim è un tick fisso a 20 Hz (`DT = 1/20`), tutta la casualità scorre attraverso un unico `Rng` con seed, e `src/sim/` non porta alcun import di DOM, browser o Three.js. È questo che permette allo stesso codice di compilarsi in un server di ambiente Node, in un ciclo di gioco autoritativo e in una scheda del browser senza cambiare una riga.

### Struttura del progetto

| Percorso | Cos'è |
|---|---|
| `src/sim/` | Nucleo di gioco deterministico, la fonte di verità. Nessuna dipendenza da DOM o Three. |
| `src/sim/content/` | Dati come codice: le nove classi, abilità, zone, dungeon, oggetti, talenti. |
| `src/render/` | Renderer Three.js (geometria, texture, VFX procedurali). Legge il mondo, non lo muta mai. |
| `src/game/` | Input locale, camera, scorciatoie da tastiera, comandi mobili, WebAudio procedurale. |
| `src/ui/` | HUD classico (frame, finestre, tooltip, mappa, testo di combattimento fluttuante), icone procedurali, i18n. |
| `src/net/` | Client online: autenticazione REST più uno specchio del mondo via WebSocket (`ClientWorld`). |
| `src/admin/` | SPA della dashboard di amministrazione (entry `admin.html` separato). |
| `server/` | Server autoritativo: HTTP e WS, ciclo del mondo, Postgres, autenticazione, social, moderazione. |
| `headless/` + `python/` | Server di ambiente RL (`env_server.ts`) e binding Python Gym. |
| `tests/` | Suite Vitest. |
| `scripts/` | Build degli asset più script di E2E del browser, screenshot e integrazione. |
| `public/` · `docs/` | Asset statici (modelli GLB, texture, HDRI) e documenti di design. |

La maggior parte delle directory porta il proprio `CLAUDE.md` con convenzioni locali. L'insieme completo degli invarianti del progetto vive nel [`CLAUDE.md`](../../CLAUDE.md) di radice.

## Costruito come i classici

Combattimento, livellamento e minaccia girano tutti su autentiche regole dell'era classica: ira ed energia, tabelle di colpo e schivata, mitigazione dell'armatura, la vera curva XP, i timer dei colpi e il cooldown globale. Lo senti come lo ricordi, anziché come un'approssimazione. I numeri esatti vivono in `src/sim/` se li vuoi leggere.

E quasi nulla di tutto ciò è un asset preconfezionato. Il mondo è disegnato dal codice:

- Città, creature, terreno, acqua, meteo e ombre in tempo reale procedurali, senza file di modello 3D per il mondo.
- Dodici famiglie di creature dotate di scheletro con animazioni complete di camminata, attacco, lancio, seduta e morte.
- Icone di magie, oggetti e buff dipinte su canvas a runtime.
- Un HUD classico completo (frame delle unità, barre delle azioni, tooltip, registro missioni, mappa del mondo, minimappa, testo di combattimento fluttuante) e WebAudio procedurale per ogni suono.

## Sviluppo

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

I test di logica e unità usano Vitest. Mentre iteri, esegui un singolo file: `npx vitest run tests/sim.test.ts`. Gli script di E2E e visivi pilotano browser veri tramite `puppeteer-core` e richiedono che `npm run dev` sia in esecuzione (spesso anche `npm run server`). Gli agenti del browser possono pilotare il movimento attraverso `window.__game.controller` invece di simulare tasti tenuti premuti, per esempio `controller.move({ forward: true }, facingRadians)` o flag compatti come `{ f: 1, sr: 1 }`.

Per i comandi del server vedi [Sviluppa online](#develop-online-with-hot-reload) sopra, [DEPLOY.md](../../DEPLOY.md) per la produzione e [CREDITS.md](../../CREDITS.md) per le licenze degli asset.

## Localizzazione

Ogni stringa visibile al giocatore si risolve attraverso `t()`, e il gioco è distribuito in **21 lingue** (inglese, due spagnolo, due francese, inglese del Canada, italiano, tedesco, cinese semplificato e tradizionale, coreano, giapponese, portoghese brasiliano, russo, olandese, polacco, indonesiano, turco, svedese, vietnamita e danese). La sim e il server restano agnostici rispetto alla lingua: emettono chiavi stabili o inglese che il client ri-localizza al confine, il che mantiene intatto il determinismo. I contributori aggiungono solo l'inglese; il manutentore riempie in blocco le altre lingue prima di ogni release. Il flusso di lavoro è documentato in `docs/i18n-scaling/translation-workflow.md`.

## Contribuire

I contributi di ogni tipo sono benvenuti: codice, traduzioni, segnalazioni di bug e documentazione. Inizia con [CONTRIBUTING.md](CONTRIBUTING.it_IT.md) per la configurazione, leggi il [Codice di Condotta](../../CODE_OF_CONDUCT.md) e consulta [SECURITY.md](../../SECURITY.md) prima di segnalare una vulnerabilità. Nuovo qui? Cerca le issue con etichetta [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), apri una [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) o saluta su [Discord](https://discord.gg/GjhnUsBtw).

<div align="center">

![World of Claude](../../worldofclaude.png)

![Community di World of ClaudeCraft](../../woc_community.png)

</div>

## Licenza

Il codice è [sotto licenza MIT](../../LICENSE), quindi fai un fork, remixalo e ospita il tuo mondo.

Gli asset artistici di terze parti inclusi (modelli, texture, HDRI) mantengono le proprie licenze, tutte CC0 di pubblico dominio tranne le normal map dell'acqua sotto licenza MIT, documentate per pacchetto in [CREDITS.md](../../CREDITS.md).
