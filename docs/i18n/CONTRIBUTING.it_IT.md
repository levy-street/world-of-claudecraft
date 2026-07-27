<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · **Italiano** · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Čeština](CONTRIBUTING.cs_CZ.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# Contribuire a World of ClaudeCraft

Prima di tutto, grazie di essere qui. World of ClaudeCraft è costruito da una
comunità di persone che amano gli MMO classici, e ogni contributo, grande o
piccolo, lo rende migliore. Correggere un refuso, tradurre il gioco, segnalare un
bug, creare un dungeon completamente nuovo: tutto conta, e qui sei il benvenuto.

Questa guida ti aiuterà a configurare l'ambiente e a rendere semplice il tuo primo
contributo. Non devi essere un esperto. Se qualcosa non è chiaro, chiedi su
[Discord](https://discord.com/invite/worldofclaudecraft) e qualcuno sarà felice di darti una mano.

Partecipando, accetti di seguire il nostro [Codice di Condotta](../../CODE_OF_CONDUCT.md).

## Modi per contribuire

C'è posto per tutti, qui:

- **Codice.** Correggi un bug, aggiungi una funzionalità o migliora le prestazioni.
  Le issue etichettate
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  e [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  sono buoni punti di partenza.
- **Traduzioni.** Aiuta i giocatori di tutto il mondo migliorando o completando una
  lingua. Vedi [Tradurre il gioco](#translating-the-game) più avanti. È uno dei
  modi più semplici e di maggiore impatto per iniziare.
- **Segnalazioni di bug e idee per nuove funzionalità.** Apri una
  [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose).
  Una segnalazione di bug chiara è un vero contributo.
- **Documentazione.** Guide come questa, il README e i documenti di design in
  `docs/` possono sempre essere migliorati.
- **Test di gioco e feedback.** Gioca, dicci cosa non ti convince e condividi le tue
  idee su Discord.

## Come iniziare

Ti serviranno [Node.js 26](https://nodejs.org/) e npm, le versioni usate dalla CI e
dall'immagine di produzione. Le major precedenti non sono testate. Per il server
multigiocatore ti servirà anche [Docker](https://www.docker.com/) per eseguire
Postgres.

```bash
# 1. Fai il fork del repository su GitHub, poi clona il tuo fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Installa le dipendenze
npm ci

# 3. Punta git agli hook del repository (una volta per clone)
git config core.hooksPath .githooks

# 4. Avvia il client offline (non servono server né database)
npm run dev          # apri l'URL che stampa (di solito http://localhost:5173)
```

Questo basta per giocare al mondo offline e lavorare sulla maggior parte delle cose.
Per eseguire l'intero stack online ti serve prima una password del database
nel tuo ambiente:

```bash
cp .env.example .env
# imposta POSTGRES_PASSWORD e fai puntare DATABASE_URL alla stessa password
npm run db:up        # avvia Postgres 16 in Docker (DB di sviluppo sulla porta 5433)
npm run server       # compila ed esegue il server di gioco autoritativo su :8787
npm run dev          # in un altro terminale; il client fa da proxy verso il server
```

Se hai intenzione di eseguire il gate completo descritto più avanti, installa una
volta il browser che utilizza: `npx playwright install chromium`.

Il [README](../../README.md) contiene la guida completa per ospitare, sviluppare e
giocare, e i file `CLAUDE.md` presenti in tutto il repository documentano le
convenzioni di ogni area.

### Toolchain TypeScript

Il controllo dei tipi gira su TypeScript 7, il compilatore nativo: `npx tsc --noEmit`
funziona esattamente come prima e un controllo completo del repository ora richiede
pochi secondi invece di decine di secondi. L'installazione usa il doppio alias
ufficiale: il pacchetto `typescript` risolve l'API JS di TypeScript 6 (tramite il
wrapper `@typescript/typescript6`) perché `svelte-check` consuma ancora quell'API,
mentre `@typescript/native` fornisce il binario `tsc`. Cose da sapere:

- **Editor.** VS Code ha bisogno dell'estensione "TypeScript 7" del marketplace
  (`TypeScriptTeam.native-preview`) per il supporto del language service nativo,
  finché non arriverà il supporto integrato; si attiva con l'impostazione
  `js/ts.experimental.useTsgo`, e il suo comando "Disable TypeScript 7 Language
  Server" è il ripiego previsto verso il tsserver di TypeScript 6. Gli IDE JetBrains
  rilevano automaticamente il server nativo solo sotto il nome di pacchetto
  `@typescript/native-preview`, quindi non lo troveranno tramite l'alias
  `@typescript/native` di questo repository; il loro supporto TypeScript 6 integrato
  funziona bene.
- **Flag utili di tsc.** `--checkers N` imposta il numero di worker paralleli per il
  controllo dei tipi (predefinito 4; i risultati sono identici con qualsiasi valore):
  abbassalo per limitare la memoria su un runner vincolato, alzalo su una macchina
  con molti core, e misura in entrambi i casi, perché di più non è sempre più veloce.
  `--singleThreaded` disabilita ogni parallelismo. Il controllo estemporaneo di un
  singolo file (`npx tsc somefile.ts`) genera un errore quando la directory contiene
  un `tsconfig.json`; passa `--ignoreConfig` per il comportamento di prima.
- **Lockfile.** Rigenera `package-lock.json` solo con
  `npx npm@10 install --package-lock-only`: il file usa la semantica di npm 10, e le
  major di npm più recenti (inclusa la npm 11 inclusa nel Node 26 della CI) eliminano
  silenziosamente le voci annidate di peer opzionali di `svelte-check`, il che
  disallinea `npm ci` in CI. Un semplice `npm ci` è sicuro con qualsiasi major di npm.
  Dopo la rigenerazione, verifica che `npm ci --dry-run` sia allineato sia con npm 10
  sia con la npm della tua workstation.
- **Quando rivederlo.** Riporta il doppio alias a una singola dipendenza `typescript`
  solo quando valgono ENTRAMBE le condizioni: l'API JS stabile di TypeScript 7.1 è
  stata rilasciata (TypeScript 7.0 non include alcuna API JS; il sostituto è
  tracciato nella issue 2824 di microsoft/typescript-go), e la issue 3063 di
  sveltejs/language-tools è stata chiusa con una versione di `svelte-check` che la
  adotta. Le modalità sperimentali `--tsgo` di svelte-check non eliminano il suo
  requisito dell'API di TypeScript 6, e il suo caricamento di TypeScript 7 in corso
  (PR 3073 di language-tools) legge l'alias `@typescript/native` che questo
  repository già usa, quindi non serve alcuna rinomina.

## Apportare la tua modifica

1. **Parti dall'ultimo branch di release, e mai da `main`.** Il lavoro attivo viene
   integrato su un branch `release/vX.Y.Z`; `main` lo segue a distanza e non è la base
   per i contributi. Trova il più recente e crea il branch a partire da quello:

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # il branch di release più recente
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   Esegui sempre quella ricerca invece di copiare un numero di versione da questa
   guida: i branch di release si avvicendano spesso, e il più recente cambia a ogni
   release. I branch sono `feature/<short-slug>` oppure `fix/<short-slug>`.
2. **Fai commit mirati.** Le modifiche piccole e autonome sono più facili da
   revisionare e integrare rispetto a quelle grandi.
3. **Aggiungi o aggiorna i test** per qualsiasi comportamento che modifichi in
   `src/sim/` o `server/`.
4. **Mantieni traducibile il testo visibile ai giocatori.** Vedi
   [Localizzazione](#localization) e [Tradurre il gioco](#translating-the-game).

### Cose da tenere a mente

Queste sono le regole portanti del codice. Tutti i dettagli si trovano nel file
[`CLAUDE.md`](../../CLAUDE.md) principale, ma in breve:

- **Il nucleo di simulazione (`src/sim/`) è la fonte di verità**, e resta puro,
  senza import di DOM, browser o Three.js, così che lo stesso identico codice giri
  offline, sul server e nell'ambiente RL headless.
- **La simulazione è deterministica.** Gira con un tick fisso a 20 Hz e tutta la
  casualità passa per `Rng`, mai per `Math.random`, `Date.now` o `performance.now`
  nella logica della simulazione. Lo stesso seed produce sempre lo stesso mondo.
- **La matematica di gioco segue le formule degli MMO dell'era classica** (rage,
  tabelle di hit, armatura, curve XP). Per favore non inventare valori di
  bilanciamento. Cita invece la formula.
- **La nuova logica arriva come un proprio modulo piccolo e testato dietro una
  giuntura esistente**, invece di essere aggiunta in coda a uno dei grandi file
  coordinatori. I dati che il renderer o l'HUD leggono attraversano l'interfaccia
  `IWorld` (`src/world_api/`) e sono implementati sia nel mondo offline sia in quello
  online; un nuovo sistema di simulazione va dietro `SimContext`; un nuovo endpoint
  REST è un modulo di route che puoi generare con `npm run new:endpoint`.
- **Non modificare a mano i file generati** come `*.generated.ts`. Rigenerali
  tramite la build.
- **Stile della copy interna: niente trattini lunghi, trattini medi o emoji** da
  nessuna parte, né nel codice, nei commenti, nella documentazione, nei messaggi di
  commit, nel testo delle PR o nella copy rivolta ai giocatori. Usa virgole, due
  punti, parentesi, o "a" per gli intervalli. Un controllo pre-push analizza il tuo
  diff e blocca il push in caso di riscontro.
- **Non committare mai segreti** né un file `.env`, e non abilitare mai
  `ALLOW_DEV_COMMANDS` in un percorso di produzione, perché sblocca i cheat.

### Stile del codice

La formattazione è affidata a [Biome](https://biomejs.dev/), configurato in
`biome.json`: indentazione di 2 spazi, righe da 100 colonne, virgolette singole,
virgole finali. Formatta solo i file che hai toccato
(`npx @biomejs/biome check --write <your-file.ts>`) e controllali con
`npm run ci:changed`. La CI verifica soltanto i file modificati, quindi per favore
non riformattare il resto dell'albero: un'esecuzione sull'intero repository fa
emergere debiti di lunga data che non tocca a te sistemare.

## Prima di aprire una pull request

Esegui il gate del repository in locale. È lo stesso contratto che la CI applica:

```bash
npm run gate
```

Mentre lavori, esegui una singola suite (`npx vitest run tests/sim.test.ts`) e
`npm run ci:changed` per la formattazione; `npm test` esegue tutto, e la mappa delle
suite si trova in `tests/CLAUDE.md`. Il `npm run gate` completo copre l'aggiornamento
degli artefatti generati, la scansione malware, la formattazione sui file modificati,
il controllo di conformità degli effetti sonori, l'intera suite di test, una
passata di regressione su browser reale, il typecheck strict e le build di client,
server e headless. I controlli a strati, dal minimo del pre-push in su, sono
descritti in [`docs/qa-gate.md`](../qa-gate.md).

Poi prova la tua modifica sia su desktop sia su mobile, includendo un viewport delle
dimensioni di un telefono in verticale e in orizzontale, se tocca qualcosa che i
giocatori vedono. Le aree di tocco devono restare almeno di 40x40px e gli input dei
moduli almeno a 16px di carattere. Gli standard dell'interfaccia sono documentati in
[`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Aprire la pull request

Pubblica il tuo branch e apri una PR **verso lo stesso branch `release/vX.Y.Z` più
recente da cui sei partito. Non puntare mai a `main`**, che è un branch di
integrazione al momento della release e non la base dei contributi. Spesso GitHub
preseleziona `main` per te, quindi cambia il branch di base prima di inviare. Il
[modello di pull request](../../.github/PULL_REQUEST_TEMPLATE.md) ti guiderà attraverso
una breve checklist. Per favore compilala:

- Descrivi **cosa** è cambiato e **perché**.
- Collega qualsiasi issue correlata (per esempio, "Closes #123").
- Aggiungi **screenshot o una clip per le modifiche all'interfaccia**, su desktop e
  mobile.
- Conferma che `npm run gate` passa e che le nuove stringhe rivolte ai giocatori
  seguono la politica per i contributori "prima l'inglese" descritta più sotto.

Sulla tua PR, la CI esegue formattazione e lint sui file che hai modificato, l'intera
suite di test su quattro shard paralleli, una passata di regressione su browser e il
typecheck più le build di client, server e headless. Corrisponde a ciò che
`npm run gate` esegue in locale, quindi un gate verde è un buon indicatore di una PR
verde.

Prima di integrare cerchiamo una CI verde e una checklist completa. Un maintainer
potrebbe suggerirti delle modifiche. È una parte normale e collaborativa del
processo, non un rifiuto. Puntiamo a essere gentili e costruttivi nelle revisioni,
e chiediamo lo stesso a te.

> I messaggi di commit e i titoli delle PR seguono i
> [Conventional Commits](https://www.conventionalcommits.org/) con uno scope
> (`feat(talents): ...`, `fix(net): ...`). Ogni commit porta anche un corpo: dopo una
> riga vuota, da una a quattro frasi semplici che dicono cosa è cambiato e perché,
> con a capo intorno alle 72 colonne. Un titolo da solo non basta.

<a id="localization"></a>

## Localizzazione

World of ClaudeCraft è distribuito in molte lingue. Ogni stringa visibile ai
giocatori deve essere una chiave di traduzione, mentre chi contribuisce una
funzionalità di norma aggiunge solo il testo sorgente in inglese.

- Tutto il testo rivolto agli utenti è una chiave `t()`. Aggiungi la nuova copy
  inglese al modulo per dominio corrispondente sotto
  [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) (gli elementi di cornice
  dell'HUD vanno in `hud_chrome.ts`), poi rendila con `t('dotted.key', values)`.
  Il solo inglese è esattamente ciò che serve per una PR di funzionalità: il
  maintainer riempie le altre lingue al momento della release, quindi non modifichi
  gli overlay in `src/ui/i18n.locales/` e non lasci mai un segnaposto in inglese o un
  `// TODO` al loro interno. L'eccezione M16 riguarda un nuovo valore inglese
  prolisso, che richiede anche i cinque riempimenti non latini descritti in
  [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).
- Numeri, denaro, date, unità e percentuali passano per i formatter
  (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) anziché per la
  costruzione manuale delle stringhe.
- Il testo rivolto ai giocatori emesso da `src/sim/` o `server/`, che restano
  indipendenti dalla lingua, deve essere ri-localizzato al confine del client nella
  stessa modifica. Il test di controllo
  `npx vitest run tests/localization_fixes.test.ts` lo verifica.
- Dopo aver aggiunto o cambiato una stringa qualsiasi, esegui `npm run i18n:gen` e
  committa i bundle rigenerati nella stessa modifica. Il gate e la CI confrontano
  entrambi gli artefatti committati con una rigenerazione pulita, quindi un bundle
  non aggiornato fa fallire la build.

Quindi aggiungi le tue stringhe in inglese e apri la PR; non devi tradurle tu. Se
vuoi dare una mano con le traduzioni, vedi la sezione successiva.

<a id="translating-the-game"></a>

## Tradurre il gioco

Vuoi migliorare una lingua, o aiutare a portare il gioco in una nuova? Non devi
scrivere alcun codice di gioco per farlo:

1. La maggior parte delle traduzioni rivolte ai giocatori vive nei file di overlay per
   lingua sotto [`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) (uno per lingua),
   che rispecchiano le chiavi inglesi in
   [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/). Il testo emesso dalla
   simulazione e dal server è tradotto in `src/ui/sim_i18n.ts` e
   `src/ui/server_i18n.ts`, la copy dei talenti nei moduli `talent_i18n`, e la
   dashboard di amministrazione ha il proprio insieme sotto
   `src/admin/i18n.locales/`.
2. Migliora le traduzioni esistenti, o completa quelle che suonano poco naturali.
3. Esegui `npm run i18n:gen`, committa i bundle rigenerati insieme alla tua modifica
   agli overlay, poi esegui le suite di localizzazione
   (`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`)
   e apri una PR. Il solo controllo dei tipi non ti dirà se manca una chiave, dato
   che gli overlay sono volutamente sparsi.

Per proporre una lingua completamente nuova, o per discutere di tono e
terminologia, avvia una discussione su [Discord](https://discord.com/invite/worldofclaudecraft) e ti
aiuteremo a impostarla. I madrelingua e chi parla fluentemente sono particolarmente
benvenuti. Buone traduzioni fanno sentire il gioco come a casa per i giocatori di
ogni parte del mondo.

## Segnalare bug e richiedere funzionalità

Per favore usa i [modelli di issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose):

- **Segnalazione di bug.** Cerca prima tra le
  [issue esistenti](https://github.com/levy-street/world-of-claudecraft/issues) per
  evitare duplicati, poi includi i passi per riprodurre il problema, cosa ti
  aspettavi, cosa è successo e il tuo ambiente (offline o online, browser, desktop o
  mobile).
- **Richiesta di funzionalità.** Descrivi il problema che stai cercando di
  risolvere, non solo la soluzione. Il contesto ci aiuta a progettare la cosa
  giusta.
- **Vulnerabilità di sicurezza.** Per favore non aprire una issue pubblica.
  Segnalale privatamente seguendo [SECURITY.md](../../SECURITY.md), e lavoreremo
  con te alla correzione e alla divulgazione.

## Ottenere aiuto

Bloccato, o hai solo voglia di salutare? Unisciti al
[Discord della comunità](https://discord.com/invite/worldofclaudecraft). Nessuna domanda è troppo
piccola, e i nuovi contributori sono sempre benvenuti.

## Licenza

Contribuendo con del codice, accetti che i tuoi contributi di codice siano
rilasciati sotto la [Licenza MIT](../../LICENSE) del progetto, la stessa licenza che
copre il progetto.

La Licenza MIT dice quello che intende: chiunque può usare, modificare e
ridistribuire il codice, a fini commerciali o meno. I nostri
[Termini di Servizio](https://worldofclaudecraft.com/terms) regolano il gioco
ospitato che gestiamo su worldofclaudecraft.com (account, condotta, oggetti
virtuali) e non limitano i diritti che la Licenza MIT concede a te o a chiunque
altro su questo codice. I nomi e il marchio "World of ClaudeCraft" e "Levy Street"
non sono coperti dalla Licenza MIT.

Gli asset creativi originali (registrazioni sonore, musica, arte e opere d'autore
simili) sono l'eccezione. Se contribuisci un asset originale che hai creato, puoi
invece mantenerne il copyright e rilasciarlo con una licenza a tua scelta (per
esempio CC BY-NC 4.0), a condizione che:

- la licenza, i percorsi degli asset che copre e la tua attribuzione siano
  registrati nella tabella delle licenze in [CREDITS.md](../../CREDITS.md)
  nell'ambito della stessa pull request, e
- includa come minimo una concessione perpetua e senza royalty a Levy Street per
  usare gli asset commercialmente in World of ClaudeCraft, incluse le release
  ufficiali e il negozio in gioco.

Per gli asset elencati nella tabella di CREDITS.md, quella licenza registrata
prevale sulla licenza MIT predefinita del progetto.

**Gli asset multimediali senza una voce in CREDITS.md non sono licenziati sotto
MIT.** Il registro è ancora in fase di completamento, quindi una voce mancante
significa che i termini non sono registrati, non che l'asset sia libero da
prendere. È una scelta deliberata: impedisce che un contributo non registrato
venga ceduto per impostazione predefinita. Per il codice vale il contrario, e
tutto ciò che non è escluso in CREDITS.md è MIT.

È proprio per questo che la voce nel registro non è burocrazia opzionale. Se
contribuisci un asset senza una riga in CREDITS.md, nessuno a valle può usarlo e
non abbiamo alcuna traccia di ciò che ci hai concesso. Compila onestamente anche
la colonna **Redistribution**. È ciò che dice a chi fa un fork di questo progetto
se può ridistribuire il tuo asset, e alcune righe sono contrassegnate
"No, permission required" proprio perché non può.

---

Grazie per aver contribuito a World of ClaudeCraft. Non vediamo l'ora di scoprire
cosa costruirai insieme a noi.
