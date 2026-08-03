<div align="center">

# World of ClaudeCraft

**Affronta missioni, forma gruppi e fai incursioni in un mondo costruito a mano, gratis nel tuo browser. Open source, web3 e online proprio ora.**

**Sito ufficiale: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.33.1-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.it_IT.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · **Italiano** · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Čeština](README.cs_CZ.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Gioca ora](https://worldofclaudecraft.com/) · [Ospita il tuo mondo](#host-your-own-world-one-command) · [Addestra un agente](#train-an-agent-headless-rl) · [Web3](#web3) · [Contribuisci](CONTRIBUTING.it_IT.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![Schermata del titolo di World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## Di cosa si tratta

World of ClaudeCraft è un MMO completo in stile classico che puoi giocare proprio ora nel tuo browser, ospitare da solo con un unico comando e su cui puoi persino addestrare agenti IA a giocare. È gratuito, open source e attivo su [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Un unico mondo condiviso gira in tre posti, tutti a partire dallo stesso nucleo di gioco:

- il **server multiplayer autoritativo**, il mondo vivo su cui giochi su worldofclaudecraft.com, dove account basati su Postgres condividono un unico reame persistente,
- il **mondo offline nel browser**, una Sim locale per giocatore singolo che ottieni dal server di sviluppo, utile per lo sviluppo e per leggere il nucleo di gioco da cima a fondo,
- l'**ambiente RL headless**, dove Python pilota il gioco vero attraverso un'interfaccia Gym.

Stesso seed, stesso mondo, ovunque. Gran parte di ciò che vedi è ancora disegnata dal codice a runtime, e il resto è un insieme curato di asset distribuito insieme al progetto, così un fork funziona subito.

## In evidenza

- **Nove classi classiche**, ognuna con un kit completo in stile classico che acquisisce ranghi man mano che sali di livello, più un completo **sistema di talenti** (tre specializzazioni per classe, 27 specializzazioni in tutto).
- **Tre zone open world** dal livello 1 al 20, più di 90 missioni e un'unica trama collegata sulla cospirazione dei Gravecaller.
- **Cinque dungeon a istanze**, quattro dei quali incursioni d'élite per cinque giocatori e una cripta in solitaria, con scaling d'élite, meccaniche dei boss ad AoE, bottino legato all'archetipo della classe che si raccoglie in set di tier e un **livello di difficoltà Eroico** con ricompense più ricche, più **world boss** all'aperto e un finale a incursione per dieci giocatori.
- **Due delve scalabili**, una modalità per piccoli gruppi da uno o due giocatori più un compagno IA, ricostruita da camere casuali a ogni run nei livelli Normale ed Eroico.
- **PvP classificato** su due mappe d'arena: scale 1v1 e 2v2, una più vivace modalità Fiesta 2v2 e **Protect Yumi**, una modalità a obiettivi 3v3 e 5v5. Il gioco classificato paga Honor, che acquista un set di equipaggiamento solo PvP che non supera mai il bottino dei dungeon in PvE.
- **La Vale Cup**, un campionato di boarball giocato nel suo stadio a sud di Eastbrook, e **Card Duel**, un rapido gioco di carte uno contro uno ospitato in città.
- **Un Book of Deeds**: un diario di imprese fatto di titoli cosmetici, bordi per i distintivi e Renown, con Chronicles per zona tenute da PNG Chronicler nel mondo e una classifica di tutti i tempi.
- **Un'economia delle professioni profonda**: quattro mestieri di raccolta alimentano dieci lavorazioni, dalla cucina e l'alchimia alla gioielleria, alla forgiatura di armi e all'incantamento, con strumenti a livelli, postazioni di lavoro in città, qualità capolavoro e commissioni, il tutto confluendo in un **World Market** guidato dai giocatori e nel servizio postale **Ravenpost**.
- **Multiplayer vero**: gruppi e incursioni, gilde, scambi, duelli, diritti di tap, XP divisa nel gruppo, sussurri, stato di assenza e un **Dungeon Finder** con code per ruolo ed elenchi di gruppi premade.
- **Creato nel codice, non in un editor 3D**: terreno, acqua, meteo, disposizione delle città, ombre in tempo reale ed effetti sono generati a runtime, e i modelli che vengono distribuiti sono costruiti da fabbriche procedurali e da una libreria curata di asset anziché scolpiti a mano.
- **Localizzato in 22 lingue** tramite una pipeline deterministica in cui la sim emette chiavi.
- **Un wiki di accompagnamento su `/wiki`**, generato direttamente dal contenuto di gioco vivo, così non può divergere dal mondo che documenta.
- **App native su ogni piattaforma**: installer desktop firmati per Windows, Linux e macOS con aggiornamenti automatici e mirroring opzionale delle imprese su Steam, più build iOS e Android, tutte condividendo il client del browser e lo stesso mondo online.
- **Si adatta alla macchina che hai**: i preset grafici e un governatore automatico del frame rate scambiano ricchezza visiva per fluidità, e sono tenuti a una regola di equità che impedisce loro di nascondere qualcosa a cui un giocatore reagisce.
- **Ambiente RL headless** con binding Gymnasium, modellazione della ricompensa e una modalità benchmark.
- **Utilità di $WOC, del tutto opzionale**: collega un portafoglio Solana per avere flair da possessore, i Daily Rewards e un'opzione di pagamento scontata nel negozio di cosmetici. Il gioco resta gratuito e non in custodia.
- **Season 1 Armory**: colleziona skin cosmetiche per le armi attraverso il WOC Store, usando Claudium acquistato con valuta tradizionale, SOL, USDC o $WOC. I cosmetici non forniscono mai potere in combattimento.

## Screenshot

![La piazza di Eastbrook, il falò e chi assegna le missioni](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Crepuscolo al falò di Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Crepuscolo al falò di Eastbrook* | ![Pull d'élite nella Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Pull d'élite a lume di torcia nella Hollow Crypt* |
| ![I morti senza pace nella cappella in rovina](../../docs/screenshots/restless-dead.jpg)<br>*I morti senza pace nella cappella in rovina* | ![Una rissa con i Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*In inferiorità numerica all'accampamento dei banditi* |
| ![Old Greyjaw braccato sulla strada del nord](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, lo spawn raro, abbattuto sulla strada del nord* | ![Interfaccia del venditore e delle borse](../../docs/screenshots/vendor-and-bags.jpg)<br>*Ci si equipaggia da Trader Wilkes, con il venditore e le borse aperti* |
| ![Il moongate sulla riva di Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Gli annegati risalgono al moongate di Glimmermere* | ![Ysolei sull'altare del Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest e l'altare del Drowned Temple* |

Il meteo è guidato dal bioma ed esiste solo a livello di rendering, quindi non tocca mai la sim deterministica:

| | | |
|:---:|:---:|:---:|
| ![Cieli sereni su Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Sereno sulla Vale* | ![Pioggia su Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Pioggia su Mirefen Marsh* | ![Neve su Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Neve su Thornpeak Heights* |

## Giocaci

Gioca nel tuo browser su [worldofclaudecraft.com](https://worldofclaudecraft.com/), oppure installa l'app nativa per Windows, Linux, macOS, iOS o Android. Ogni client si collega allo stesso mondo online.

### Online, con altri giocatori

Crea un account, crea un personaggio ed entra nel mondo vivo. Per far girare tu stesso lo stesso stack client/server, vedi [Ospita il tuo mondo](#host-your-own-world-one-command) qui sotto.

### Offline, nel server di sviluppo

La modalità offline è un mondo locale in giocatore singolo senza account e senza autorità del server, quindi è inclusa solo nelle build di sviluppo. Avvia il server di sviluppo e compare nel selettore delle modalità:

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

Dai un nome al tuo personaggio, scegli una qualsiasi delle nove classi e parti in **Eastbrook Vale** (livelli 1-7), una città di mercato circondata da hub: i sentieri dei lupi a nord, i prati dei cinghiali a est, i boschi di Sableweb a ovest, Mirror Lake a nordovest, uno scavo di rame infestato dai burrower a sudovest e una cappella in rovina di morti senza pace a nordest, con l'accampamento dei banditi di Gorrak a sudest. La strada del nord risale un passo di montagna fino a **Mirefen Marsh** (6-13, hub Fenbridge) e prosegue su fino a **Thornpeak Heights** (13-20, hub Highwatch). Il seed del mondo è fissato in `src/main.ts`, quindi è lo stesso luogo a ogni visita.

### App desktop per Windows, Linux e macOS

World of ClaudeCraft è distribuito come app desktop complete per tutte e tre le principali piattaforme desktop: installer Windows firmati, pacchetti Linux AppImage e deb, e build macOS universali firmate e autenticate. Usano lo stesso client di gioco e lo stesso mondo online del browser, con pacchettizzazione nativa e aggiornamenti automatici.

L'accesso online avviene solo con Discord ed email, esattamente come nel flusso web: email e password accedono dentro l'app, e "Continue with Discord" apre il tuo browser predefinito sulla pagina `/desktop-login`, che restituisce all'app un codice monouso tramite un deep link `worldofclaudecraft://` che l'app scambia con un normale token di sessione di World of ClaudeCraft.

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

Punta la shell verso un'API diversa con `VITE_DESKTOP_API_ORIGIN`, per esempio un server locale o un host di staging:

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

Sovrascrivi l'origine dell'API di produzione per le build di staging con `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` (un valore di BUILD: viene incorporato nel bundle e impresso nell'app pacchettizzata, e le build installate lo ignorano come variabile d'ambiente a runtime). Steam è un canale di distribuzione (lo stesso bundle Electron, caricato via SteamPipe), e i giocatori desktop possono collegare un account Steam per rispecchiare le imprese che ottengono nelle achievement di Steam; l'accesso in sé resta email e Discord. Il runbook completo di release (firma, autenticazione, pubblicazione di un aggiornamento automatico, depot SteamPipe, deploy del server) è `docs/desktop-release.md`. iOS e Android sono distribuiti tramite Capacitor, con il proprio runbook in `docs/mobile-store-release.md`.

<a id="host-your-own-world-one-command"></a>

## Ospita il tuo mondo (un solo comando)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Per l'**hosting remoto**, metti lo stack compose su un qualsiasi VPS, imposta una vera `POSTGRES_PASSWORD` nell'ambiente e poni davanti alla porta 8787 un reverse proxy TLS. Con Caddy bastano poche righe; i WebSocket vengono proxati automaticamente e il client seleziona da solo `wss://` sulle pagine https. Gli endpoint di autenticazione hanno un rate limit, le password sono cifrate con scrypt e le sessioni di accesso scadono. Non impostare mai `ALLOW_DEV_COMMANDS=1` in produzione, poiché abilita l'intero set di trucchi `/dev`: i trucchi di livello e teletrasporto usati dai bot di test, più la concessione di oggetti, lo spawn di mob, i teletrasporti nelle istanze e la GUI dei comandi di sviluppo in gioco. [DEPLOY.md](../../DEPLOY.md) è la guida completa alla produzione, inclusa la configurazione del reverse proxy che tiene gli endpoint di salute e metriche fuori dal bordo pubblico.

<a id="develop-online-with-hot-reload"></a>

### Sviluppa online con hot reload

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api, /admin/api, and /ws)
```

Apri http://localhost:5173, scegli **Play Online**, crea un account, crea un personaggio ed Enter World. La schermata di selezione del personaggio mostra le ultime notizie di release nel pannello News & Updates, con distintivi NEW per tutto ciò che non hai ancora visto. Apri una seconda scheda e accedi di nuovo per vedervi a vicenda in città. `Enter` apre la chat. Il wiki per i giocatori è la Guide interna al repository, servita su http://localhost:5173/wiki e su `/wiki` in produzione; il suo contenuto è generato dai dati di gioco correnti da `npm run wiki:content`.

Cosa persiste e come il server resta al comando:

- **Account**: password cifrate con scrypt e bearer token con scadenza.
- **Personaggi**: fino a 10 per account per reame; livello, equipaggiamento, borse, cassaforte in banca, missioni, talenti, professioni, progressi PvP e delle imprese, posizione e denaro persistono come JSONB in Postgres, salvati a intervalli regolari, al logout e allo spegnimento del server. I nomi sono univoci per reame e in stile classico.
- **Il server è autoritativo**: i client trasmettono in streaming l'intento di movimento e i comandi a 20 Hz; il server fa girare l'unica `Sim` condivisa e restituisce snapshot limitati all'interesse più eventi per ciascun giocatore. Ogni tiro di combattimento, drop di bottino, credito di missione e transazione col venditore si risolve lato server. Il client è un renderer.

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

env = WoWClassicEnv(player_class="warrior")   # any of the nine classes
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **Gli spazi di osservazione e di azione derivano dal contenuto.** Interrogali dalla risposta `info` dell'ambiente all'avvio invece di codificarli rigidamente; crescono insieme al gioco. Lo spazio di azione è un `Discrete` che copre movimento, bersaglio, attacco, l'intero kit di abilità, interazione e mangiare/bere; l'osservazione è un `Box` che copre sé, abilità, bersaglio, mob vicini, l'interagibile più vicino e il progresso delle missioni.
- **La ricompensa** è una somma pesata delle differenze dei contatori per tick (XP, danno inflitto e subito, uccisioni, morti, progresso delle missioni, salite di livello), regolabile a ogni reset. Ogni `step` applica un'azione e fa avanzare cinque tick della sim per impostazione predefinita, quindi all'incirca quattro decisioni per secondo simulato.
- **Deterministico per costruzione.** Nessun orologio reale, nessun `Math.random`. Imposta il seed del reset e l'episodio si riproduce esattamente.

Il protocollo e i binding sono documentati in `headless/CLAUDE.md` e `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft è nativo web3 intorno a **$WOC**, il nostro token della community su Solana. Collega un portafoglio Solana, associalo al tuo account con una sola firma (non in custodia, nessuna transazione da approvare) e il tuo saldo $WOC in sola lettura compare nell'HUD insieme a un distintivo cosmetico di livello da possessore.

$WOC ha anche un'utilità opzionale nel gioco vivo:

- **WOC Store**: acquista Claudium, la valuta cosmetica a senso unico, con valuta tradizionale, SOL, USDC o $WOC. Il canale di pagamento in $WOC è scontato rispetto agli altri.
- **Season 1 Armory**: spendi Claudium in collezioni di skin cosmetiche per le armi. Gli acquisti nel negozio non aggiungono statistiche né potere in combattimento.
- **Daily Rewards**: i possessori verificati idonei possono guadagnare punti attraverso una ruota giornaliera e incarichi a rotazione, poi competere per una quota del montepremi quotidiano.

Niente di tutto questo serve per giocare. Il collegamento del portafoglio è opzionale e non in custodia, non c'è pay-to-win e l'intero gioco si gioca benissimo senza mai collegare un portafoglio.

**Indirizzo del contratto $WOC (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Maggiori informazioni sul token su [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Un giro per il mondo

### Le nove classi

Ogni classe gira su meccaniche MMO dell'era classica implementate da zero, e impara magie a ranghi attraverso i livelli 1-20, con abilità distintive come Low Blow, Early Grave, Skyfall, Urgent Prayer e Ancestral Strike che si sbloccano nella seconda metà della scalata.

- **Warrior**: ira, Iron Bellow, Onrush, Quaking Blow, Maiming Strike, Gaping Wounds (un sanguinamento che cavalca i tuoi colpi), Widening Arc, Hobbling Cut, Blood Toll, Redhand (proc da schivata).
- **Paladin**: Oathbrand scatenato da Verdict, Mending Light, Steadfast Aura, Oath of Iron, Ward of Faith (assorbimento), Sundering Gavel (stordimento), Last Rite.
- **Hunter**: attacco automatico a distanza (8-35 yd con la classica zona morta), Gutting Strike, Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Counterfang, Fettering Slash e un pet domabile dal livello 10.
- **Rogue**: energia e punti combo, Wicked Slash, Dirt Nap, Craven Thrust (alle spalle, con pugnale), Eye Jab, Ghostfoot, Cutthroat Tempo, Swift Heels.
- **Priest**: Smite, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding (assorbimento), Lingering Grace (HoT), Mindfracture.
- **Shaman**: Arc Bolt, Stonebound Weapon (incantamento), Mending Waters, Earthen Jolt, Thunder Ward (spine), Cinder Jolt.
- **Mage**: Cinderbolt, Hoarfrost Mantle, Aether Insight, Rimelance, Waterbind, Cinderfall, Aether Darts (canalizzato), Bewitch, Icebind, un elementale d'acqua evocato e Chronomancy, una specializzazione di cura basata sulla magia del tempo.
- **Warlock**: Gloom Bolt, Fiendhide, Burning Pact, Blackrot, Hard Bargain, Hex of Anguish, Consume e sette demoni evocabili, da Emberkin a Wraithborn.
- **Druid**: Wildbolt, Wildmend, Wildward, Lunar Tempest, Wildbloom, Briarguard, Gripping Roots e la trasformazione in Wolf Form a 5, Bruin Form a 8 e Moonwing Form a 10.

Cure e buff colpiscono i membri del gruppo, le cure possono fare critico e gli scudi di assorbimento incassano il danno prima della salute. Spendi punti tra **tre specializzazioni di talenti per classe** (Battlecraft/Bloodrush/Ironguard, Moongrove/Wildfang/Groveheart, e così via); l'allocazione è validata dal server ed esportabile come stringa di build.

### Dungeon

La trama dei Gravecaller attraversa tre istanze d'élite per cinque giocatori, una quarta attende dietro un moongate con la propria tradizione degli annegati, e una cripta in solitaria sta in disparte per gli esploratori.

- **The Hollow Crypt** (5 giocatori) sotto la Fallen Chapel: trash d'élite in coppia, il miniboss Sexton Marrow e Morthen the Gravecaller con il suo AoE d'ombra ricorrente. La porta della cripta teletrasporta il tuo gruppo in una copia privata dell'istanza che si resetta una volta svuotata.
- **The Sunken Bastion** (5 giocatori, intorno al livello 13, Mirefen sudest): Vael the Fogbinder evoca ondate di Drowned Thralls man mano che lo scontro va avanti.
- **Gravewyrm Sanctum** (5 giocatori, livello 20, sotto Thornpeak): tre camere di boneguard e scaleguard d'élite, Korgath the Bound, Grand Necromancer Velkhar e Korzul the Gravewyrm, dove cadono armi epiche.
- **The Drowned Temple** (5 giocatori) attraverso il moongate di Glimmermere: un'istanza pallida, viola-luna che conduce a Choirmother Selthe e poi a Ysolei, Avatar of the Drowned Moon, le cui maree lunari e i Moonspawn evocati puniscono un gruppo che resta fermo.
- **The Abandoned Crypt** (in solitaria) a Thornpeak: una tranquilla discesa fatta di chiavi di volta e diari per uno, la cui traccia dissigilla la porta reale verso **Nythraxis, Scourge of Thornpeak**, un finale a incursione per dieci giocatori combattuto attraverso tre wardstone delle anime.

Ogni istanza gira anche in **Eroico**: nemici di livello più alto, meccaniche più affilate e bottino e valuta del venditore propri. Le catene di missioni preparatorie sono affrontabili in solitaria, quindi la storia non è mai bloccata dietro il trovare un gruppo. La nostra incursione automatizzata a cinque bot (warrior, paladin, priest, mage, hunter con IA di focus-fire e cura) ripulisce la Hollow Crypt in circa cinque minuti (`node scripts/crypt_raid.mjs`, richiede `ALLOW_DEV_COMMANDS=1`).

### Delve

Le delve sono una modalità per piccoli gruppi separata e scalabile per uno o due giocatori, ricostruita da camere casuali a ogni run e conclusa su una cassa reliquiario chiusa a chiave che si apre attraverso un minigioco di scasso anziché con un tiro sul bottino. **The Collapsed Reliquary** (livello 7 e oltre) si conclude con Deacon Varric, con una compagna IA, Tessa, che combatte al tuo fianco se vai in solitaria. **The Drowned Litany** (livello 12 e oltre) segue la traccia dentro un santuario allagato ai margini di Mirefen Marsh. Una bacheca delle delve imposta il livello: l'Eroico alza i livelli dei nemici e aggiunge un affisso casuale per ricompense più ricche.

### PvP classificato (l'Ashen Coliseum)

Premi `G` o il pulsante dell'arena per metterti in coda. Il matchmaking teletrasporta i combattenti in una fossa privata, un breve conto alla rovescia cura e resetta tutti per una partenza equa, e lo scontro finisce quando uno schieramento si arrende. Nessuno muore, e torni esattamente dove ti sei messo in coda. Protect Yumi si combatte nel proprio labirinto anziché nella fossa del Coliseum.

- **Scale classificate 1v1 e 2v2**, ciascuna con un punteggio persistente in stile Elo e una classifica di tutti i tempi.
- **Fiesta 2v2**, una modalità di gruppo più vivace in cui le squadre corrono verso un obiettivo di eliminazioni mentre i potenziamenti da raccogliere distribuiscono potere e un cerchio che si chiude costringe lo scontro a unirsi.
- **Protect Yumi**, una modalità a obiettivi non classificata 3v3 e 5v5 combattuta in un labirinto: ogni squadra custodisce un famiglio felino mentre cerca di abbattere quello avversario, quindi scorte e prese contano più delle uccisioni pure.

Le vittorie classificate e le eliminazioni in Fiesta pagano **Honor**, che il quartiermastro in città scambia con un set di equipaggiamento Warfare. Warfare è una statistica solo PvP, quindi il set vince i duelli senza mai superare in equipaggiamento il bottino dei dungeon di pari livello in PvE.

### Giocare insieme

- **Dungeon Finder**: aprilo con `Shift+I` per sfogliare dungeon e incursioni, esaminare boss e bottino, unirti a una coda automatica per ruolo tank/curatore/DPS o creare un annuncio di gruppo premade. I gruppi formati dal Finder viaggiano comunque insieme fino all'ingresso.
- **Gruppi** fino a 5, convertiti in un'incursione da 10 giocatori formata da due gruppi una volta al completo: clic destro su un giocatore e Invita al Gruppo. I membri condividono i diritti di tap e il credito di missione, dividono l'XP con i bonus di gruppo dell'era classica e compaiono come puntini sulla minimappa. `/p` per la chat di gruppo, `/roll` per assegnare il bottino.
- **Scambi**: clic destro e Scambia. Entrambe le parti mettono in scena oggetti e denaro, entrambe devono accettare, e lo scambio è atomico e validato dal server. Gli oggetti delle missioni non possono essere scambiati, e allontanarsi annulla tutto.
- **Duelli**: clic destro e Sfida a Duello. Un conto alla rovescia di 3 secondi, poi si combatte finché uno schieramento arriva a 1 hp; il vincitore è annunciato in tutta la zona e scappare a 60 yard di distanza fa perdere.
- **Diritti di tap e stato di assenza**: il primo giocatore a danneggiare un mob ne possiede il bottino, l'XP e il credito di missione; `/afk` e `/dnd` ti segnalano come assente con una risposta automatica ai sussurri.

### Mondo e sistemi

- **Professioni** (`Shift+P`): quattro mestieri di raccolta (estrazione mineraria, taglio del legname, erboristeria, pesca) alimentano dieci lavorazioni, dalla cucina e l'alchimia alla forgiatura di armi, alla gioielleria e all'incantamento. Gli strumenti di raccolta esistono in livelli che decidono quali nodi puoi lavorare, la creazione avviene alle postazioni di lavoro in città con una possibilità di qualità capolavoro che porta il marchio del tuo artigiano, e c'è un sistema di archetipi da scoprire mentre ti specializzi.
- **Il World Market**: una casa d'aste guidata dai giocatori per equipaggiamento, materiali e consumabili, consultabile dalle città hub.
- **Posta Ravenpost**: invia oggetti e monete ad altri personaggi, con gli allegati custoditi al sicuro finché non vengono ritirati.
- **Gilde**: statuti, roster, ranghi e chat di gilda.
- **La Guide**: un wiki interno al sito, ricercabile, su `/wiki`, che copre classi, creature, zone e imprese, generato direttamente dal contenuto di gioco vivo così non può divergere dal mondo che documenta.
- **La Vale Cup e Card Duel**: boarball allo stadio di Sowfield a sud di Eastbrook, in formati dall'1v1 al 5v5, e un rapido gioco di carte uno contro uno ospitato dal Card Master in città.
- **Daily Rewards**: i possessori di $WOC verificati possono guadagnare punti per la classifica da una ruota giornaliera e da incarichi a rotazione, con pagamenti automatici dal montepremi quotidiano.
- **WOC Store e Season 1 Armory**: acquista Claudium con valuta tradizionale, SOL, USDC o $WOC, poi spendilo in skin per le armi puramente cosmetiche.
- **Mangiare e bere**: siediti per recuperare, interrotto dal danno o dall'alzarsi, e sì, puoi mangiare e bere contemporaneamente.
- **Venditori** che comprano cibo e acqua e vendono onesto equipaggiamento bianco, con le monete mostrate in oro, argento e rame.
- **Una banca personale** (la Gilded Strongbox): i tesorieri in ogni città hub tengono una cassaforte per personaggio, da 24 slot fino a 96 con espansioni acquistabili in monete, più slot bonus guadagnati online per un'email verificata, account collegati e inviti.
- **Il Book of Deeds**: un diario di imprese (per impostazione predefinita `Shift+Z`) fatto di missioni, uccisioni, completamenti e sfizi, che paga titoli cosmetici da indossare sulla targhetta del nome, in chat e sulle classifiche, più un tracker nell'HUD per le imprese che stai inseguendo, Chronicles per zona tenute dai PNG Chronicler e una classifica Renown di tutti i tempi; l'elenco pubblico vive su `/wiki/deeds`.
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
| `C` `P` `L` `M` `B` `N` `T` | personaggio, libro degli incantesimi, registro missioni, mappa del mondo, borse, talenti, creazione oggetti |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | arena, amici e gilda, classifica, calendario, Vale Cup, Dungeon Finder, professioni, imprese |
| `Z` / `X` | rinfodera o sguaina le armi, ruota delle emote |
| `V` / `R` / `Esc` | targhette dei nomi, corsa automatica, chiudi la finestra in primo piano (o apri il menu di gioco) |

Ogni assegnazione è rimappabile nel pannello dei comandi. I comandi touch (uno stick di movimento, trascinamento della camera e pulsanti d'azione su schermo) compaiono automaticamente su dispositivi mobili.

## Architettura (una sim, tre host)

Tre idee tengono insieme il progetto:

- **Una sim, tre host.** Lo stesso codice `src/sim/` fa girare il mondo offline nel browser, il server online e l'ambiente RL. Il comportamento deve essere identico ovunque, e i test esistono per mantenerlo tale.
- **`IWorld` è l'unica giuntura.** `IWorld` è definita come interfacce facet per dominio sotto `src/world_api/`, aggregate da `src/world_api.ts`. La `Sim` offline la soddisfa strutturalmente e la `ClientWorld` online la implementa rispecchiando gli snapshot del server. Il renderer e l'HUD parlano solo con `IWorld`, mai con un mondo concreto, quindi una nuova funzionalità estende prima il facet corrispondente e poi entrambi i mondi.
- **Il server è autoritativo.** I client inviano l'intento; il server decide gli esiti. Il client non risolve mai da solo combattimento, bottino o economia.

La sim è un tick fisso a 20 Hz (`DT = 1/20`), tutta la casualità scorre attraverso un unico `Rng` con seed, e `src/sim/` non porta alcun import di DOM, browser o Three.js. È questo che permette allo stesso codice di compilarsi in un server di ambiente Node, in un ciclo di gioco autoritativo e in una scheda del browser senza cambiare una riga.

### Struttura del progetto

| Percorso | Cos'è |
|---|---|
| `src/sim/` | Nucleo di gioco deterministico, la fonte di verità. Nessuna dipendenza da DOM o Three. |
| `src/sim/content/` | Dati come codice: le nove classi, abilità, zone, dungeon, delve, oggetti, ricette, incantamenti, talenti, professioni, imprese. |
| `src/world_api.ts` + `src/world_api/` | `IWorld`, la giuntura da cui dipendono il renderer e l'HUD: un'interfaccia facet per dominio. |
| `src/` (il resto) | Renderer Three.js, HUD e stili, input/audio, specchio online e le SPA di amministrazione, guida ed editor. |
| `server/` | Server autoritativo: HTTP e WS, ciclo del mondo, Postgres, autenticazione, social, moderazione. |
| `server/http/` | La pipeline delle richieste REST: router a tabella, middleware e definizioni di rotta per dominio. |
| `headless/` + `python/` | Server di ambiente RL (`env_server.ts`) e binding Python Gym. |
| `bot/` | Bot Discord (ruoli, relay, feed delle attività). |
| `electron/`, `android/`, `ios/` | Shell desktop (Steam) e mobile native. |
| `tests/` | Suite Vitest. |
| `scripts/` | Strumenti di build, asset, i18n, SFX, screenshot ed E2E del browser. |
| `deploy/` · `mediawiki/` | Asset di primo avvio in produzione e il container del wiki per i giocatori. |
| `public/` · `docs/` | Asset statici (distribuiti alla lettera sul sito) e documenti di design. |

Niente di tutto questo è affidato all'onore: `tests/architecture.test.ts` analizza ogni file
della sim in cerca di un import proibito, di una globale del DOM o di una chiamata vagante
all'orologio o a `Math.random`, e `tests/world_api_parity.test.ts` fissa la giuntura
affinché i due mondi non possano divergere.

La maggior parte delle directory porta il proprio `CLAUDE.md` con convenzioni locali, e
l'insieme completo degli invarianti del progetto vive nel [`CLAUDE.md`](../../CLAUDE.md) di
radice. I contributori agenti partono da lì, poi raccolgono il punto di ingresso del proprio
runtime: [`AGENTS.md`](../../AGENTS.md) più la [guida per operatori Codex](../codex.md) per
Codex, [`GEMINI.md`](../../GEMINI.md) per Gemini. Tutti confluiscono nella stessa
architettura canonica.

## Costruito come i classici

Combattimento, livellamento e minaccia girano tutti su autentiche regole dell'era classica: ira ed energia, tabelle di colpo e schivata, mitigazione dell'armatura, la vera curva XP, i timer dei colpi e il cooldown globale. Lo senti come lo ricordi, anziché come un'approssimazione. I numeri esatti vivono in `src/sim/` se li vuoi leggere.

Il mondo è creato nel codice anziché in un editor 3D, ed è questo che lo tiene piccolo,
deterministico e facile da forkare:

- Terreno, acqua, meteo, cielo, disposizione delle città, ombre in tempo reale ed effetti di combattimento sono generati a runtime dai dati stessi della sim.
- I modelli che vengono distribuiti sono costruiti allo stesso modo: fabbriche procedurali sotto `scripts/assets/` esportano GLB deterministici attraverso la pipeline image-to-GLB del progetto, insieme a una libreria curata di kit di modelli CC0. Le famiglie di creature e personaggi dotate di scheletro portano animazioni complete di camminata, attacco, lancio, seduta e morte.
- Le icone sono un pittore a livelli che compone l'arte per qualunque cosa non abbia un file distribuito, così nulla resta mai senza icona, con arte dipinta curata sovrapposta per abilità, oggetti e imprese.
- Un HUD classico completo (frame delle unità, barre delle azioni, tooltip, registro missioni, mappa del mondo, minimappa, testo di combattimento fluttuante, il Book of Deeds), effetti sonori spaziali e di interfaccia campionati, e una colonna sonora composta proceduralmente nel repository e distribuita come remaster in streaming che sfumano tra zone, città, dungeon e combattimento.

Ogni asset distribuito e la sua licenza sono registrati in [CREDITS.md](../../CREDITS.md), e le
dipendenze di terze parti incluse portano le proprie note in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Sviluppo

Oltre al client di gioco, la build produce la dashboard per gli operatori, l'editor del mondo su
`/editor` e la Guide pubblica su `/wiki`, tutti serviti dallo stesso server di sviluppo.

Ogni percorso FFmpeg che il gate e i test audio esercitano risolve i pacchetti npm inclusi
`ffmpeg-static`/`ffprobe-static`, quindi un contributo normale non richiede alcuna
installazione di FFmpeg di sistema. I percorsi che misurano la conformità (`npm run sfx:check`,
i test audio, la validazione dell'export dello Studio) si legano direttamente ai binari statici,
senza alcun ripiego su `PATH`: riesegui `npm ci` se un'installazione che ha saltato gli script
li ha lasciati mancanti. Gli spawn di riproduzione e codifica dello Studio e il preflight di
`npm run gate` risolvono tramite `scripts/sfx/ffmpeg_paths.mjs`, che invece ripiega su `PATH`.
Alcuni script autonomi di generazione audio (per esempio `scripts/gen_ui_sfx.mjs`) usano ancora
per impostazione predefinita l'`ffmpeg` di `PATH`.

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

I test di logica e unità usano Vitest. Mentre iteri, esegui un singolo file: `npx vitest run tests/sim.test.ts`. Le modifiche all'interfaccia hanno anche una suite opzionale su browser vero che copre accessibilità, navigazione da tastiera e dimensioni dei bersagli touch: `npm run test:browser`. Gli script di screenshot e di smoke pilotano browser veri tramite `puppeteer-core` e richiedono che `npm run dev` sia in esecuzione; gli script a livello di rete (`mp_integration.mjs`, `social_e2e.mjs`, `crypt_raid.mjs`) parlano direttamente con il server e richiedono invece `npm run server`. Gli agenti del browser possono pilotare il movimento attraverso `window.__game.controller` invece di simulare tasti tenuti premuti, per esempio `controller.move({ forward: true }, facingRadians)` o flag compatti come `{ f: 1, sr: 1 }`.

I controlli girano a livelli, descritti in [docs/qa-gate.md](../qa-gate.md): punta il tuo clone
agli hook condivisi con `git config core.hooksPath .githooks` e un livello minimo veloce gira
prima che qualcosa lasci la tua macchina.

Per i comandi del server vedi [Sviluppa online](#develop-online-with-hot-reload) sopra,
[CONTRIBUTING.md](CONTRIBUTING.it_IT.md) per il flusso di lavoro dei contributi, il
[tutorial dello SFX Studio](../sfx-studio-tutorial.md) per la creazione dei suoni e
l'export degli artefatti, [DEPLOY.md](../../DEPLOY.md) per la produzione e
[CREDITS.md](../../CREDITS.md) per le licenze degli asset.

## Localizzazione

Ogni stringa visibile al giocatore si risolve attraverso `t()`, e il gioco è distribuito in **22 lingue** (inglese, due spagnolo, due francese, inglese del Canada, italiano, tedesco, cinese semplificato e tradizionale, coreano, giapponese, portoghese brasiliano, russo, ceco, olandese, polacco, indonesiano, turco, svedese, vietnamita e danese). La sim e il server restano agnostici rispetto alla lingua: emettono chiavi stabili o inglese che il client ri-localizza al confine, il che mantiene intatto il determinismo. I contributori aggiungono solo l'inglese; il manutentore riempie in blocco le altre lingue prima di ogni release. Il flusso di lavoro è documentato in `docs/i18n-scaling/translation-workflow.md`.

## Contribuire

I contributi di ogni tipo sono benvenuti: codice, traduzioni, segnalazioni di bug e documentazione. Inizia con [CONTRIBUTING.md](CONTRIBUTING.it_IT.md) per la configurazione, leggi il [Codice di Condotta](../../CODE_OF_CONDUCT.md) e consulta [SECURITY.md](../../SECURITY.md) prima di segnalare una vulnerabilità. Nuovo qui? Cerca le issue con etichetta [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), apri una [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) o saluta su [Discord](https://discord.com/invite/worldofclaudecraft).

Lo sviluppo attivo procede sul ramo `release/vX.Y.Z` più recente. Cercalo invece di darlo per scontato, poi dirama da quello e puntaci la tua pull request. Non diramare mai da `main` né puntarlo, poiché riceve un ramo di release solo quando quella versione viene distribuita. [CONTRIBUTING.md](CONTRIBUTING.it_IT.md) contiene il comando di una riga che individua quello corrente.

## Licenza

**Il codice è [sotto licenza MIT](../../LICENSE), quindi fai un fork, remixalo e ospita il tuo mondo.** È tutto il punto della faccenda, e nulla in questa pagina o sul nostro sito lo ritira.

Tre cose sono concesse in licenza separatamente, quindi vale trenta secondi capire quale è quale:

| Cosa | Licenza | Puoi ridistribuirlo? |
|---|---|---|
| **Codice sorgente**, cioè tutto tranne gli asset multimediali esclusi qui sotto | [MIT](../../LICENSE) | Sì. Anche commercialmente. |
| **Asset multimediali**: modelli, texture, HDRI, icone, suoni, font (per lo più sotto `public/`) | Per asset, registrata in [CREDITS.md](../../CREDITS.md) | In gran parte sì (la maggior parte è CC0). Alcuni no, vedi sotto. |
| **Nome e branding**: "World of ClaudeCraft", "Levy Street", i loghi | Non concessi in licenza | No. |

**Fai un fork e ospita il tuo mondo. Funziona, e gli asset non ti sono d'intralcio.** La maggior parte di ciò che vedi è CC0 di pubblico dominio (KayKit, Quaternius, Kenney, ambientCG, Poly Haven), e i nostri prop, creature, sfondi e suoni di interfaccia generati sono distribuiti con il progetto, così un fork funziona subito. Semplicemente non puoi estrarli e venderli come arte a sé stante.

Cosa dovresti rimuovere o sostituire prima di ridistribuire:

- le **icone delle abilità di classe CraftPix** sotto `public/ui/skills/` sono state acquistate da Levy Street e **non possono essere ridistribuite**, quindi compra la tua licenza se vuoi distribuirle;
- gli **effetti sonori di @jamiecypher** sono CC BY-NC 4.0, quindi condividili in modo non commerciale con attribuzione, ma la concessione commerciale vale solo per questo progetto;
- l'**arte del negozio e del prestigio** (Season 1 Armory, il set Claudium, il set artistico delle professioni, le icone del Book of Deeds, l'emblema del drago d'élite) è arte commerciale su commissione e i **diritti sono riservati**;
- i **marchi di terze parti** (Twitch, X, Kick, YouTube, Discord, Solana, USDC) sono marchi registrati dei rispettivi proprietari e non spetta a noi concederli in licenza;
- una manciata di **icone e registrazioni usate con permesso** richiedono il permesso per essere passate ad altri.

[CREDITS.md](../../CREDITS.md) è l'elenco autorevole, con una colonna sulla ridistribuzione per ogni asset. Dove un asset è elencato lì, quella licenza prevale sulla licenza MIT del progetto. Quel registro è ancora in via di completamento, quindi un asset multimediale che vi manca è non registrato anziché libero: chiedi prima di farci affidamento. Per il codice sorgente vale il contrario, e tutto ciò che non è escluso è MIT.

I nostri [Termini di Servizio](https://worldofclaudecraft.com/terms) coprono il gioco ospitato che gestiamo su worldofclaudecraft.com: account, condotta, oggetti virtuali. Non limitano i diritti che la Licenza MIT ti concede su questo codice sorgente.
