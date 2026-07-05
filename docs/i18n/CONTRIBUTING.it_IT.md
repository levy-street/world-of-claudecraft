<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · **Italiano** · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# Contribuire a World of ClaudeCraft

Prima di tutto, grazie di essere qui. World of ClaudeCraft è costruito da una
comunità di persone che amano gli MMO classici, e ogni contributo, grande o
piccolo, lo rende migliore. Correggere un refuso, tradurre il gioco, segnalare un
bug, creare un dungeon completamente nuovo: tutto conta, e qui sei il benvenuto.

Questa guida ti aiuterà a configurare l'ambiente e a rendere semplice il tuo primo
contributo. Non devi essere un esperto. Se qualcosa non è chiaro, chiedi su
[Discord](https://discord.gg/GjhnUsBtw) e qualcuno sarà felice di darti una mano.

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

Ti serviranno [Node.js 22+](https://nodejs.org/) e npm. Per il server multigiocatore
ti servirà anche [Docker](https://www.docker.com/) per eseguire Postgres.

```bash
# 1. Fai il fork del repository su GitHub, poi clona il tuo fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Installa le dipendenze
npm ci

# 3. Avvia il client offline (non servono server né database)
npm run dev          # apri l'URL che stampa (di solito http://localhost:5173)
```

Questo basta per giocare al mondo offline e lavorare sulla maggior parte delle cose.
Per eseguire l'intero stack online:

```bash
npm run db:up        # avvia Postgres 16 in Docker (DB di sviluppo sulla porta 5433)
npm run server       # compila ed esegue il server di gioco autoritativo su :8787
npm run dev          # in un altro terminale; il client fa da proxy verso il server
```

Il [README](../../README.md) contiene la guida completa per ospitare, sviluppare e
giocare, e i file `CLAUDE.md` presenti in tutto il repository documentano le
convenzioni di ogni area.

## Apportare la tua modifica

1. **Crea un branch** a partire da `main`: `feature/<short-slug>` oppure
   `fix/<short-slug>`.
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
- **Non modificare a mano i file generati** come `*.generated.ts`. Rigenerali
  tramite la build.
- **Non committare mai segreti** né un file `.env`, e non abilitare mai
  `ALLOW_DEV_COMMANDS` in un percorso di produzione, perché sblocca i cheat.

## Prima di aprire una pull request

Per favore esegui questi comandi in locale. Sono gli stessi controlli che esegue la CI:

```bash
npm test                    # suite Vitest
npx tsc --noEmit            # typecheck TypeScript (il progetto è strict)
npm run build               # build del client di produzione
```

Se hai modificato il codice del server o headless, esegui anche `npm run build:server`
e `npm run build:env`.

Poi prova la tua modifica sia su desktop sia su mobile, includendo un viewport delle
dimensioni di un telefono in verticale e in orizzontale, se tocca qualcosa che i
giocatori vedono. Le aree di tocco devono restare almeno di 40x40px e gli input dei
moduli almeno a 16px di carattere. Gli standard dell'interfaccia sono documentati in
[`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Aprire la pull request

Pubblica il tuo branch e apri una PR verso `main`. Il
[modello di pull request](../../.github/PULL_REQUEST_TEMPLATE.md) ti guiderà attraverso
una breve checklist. Per favore compilala:

- Descrivi **cosa** è cambiato e **perché**.
- Collega qualsiasi issue correlata (per esempio, "Closes #123").
- Aggiungi **screenshot o una clip per le modifiche all'interfaccia**, su desktop e
  mobile.
- Conferma che i test, il typecheck e la build passano, e che le nuove stringhe
  sono tradotte.

Prima di integrare cerchiamo una CI verde e una checklist completa. Un maintainer
potrebbe suggerirti delle modifiche. È una parte normale e collaborativa del
processo, non un rifiuto. Puntiamo a essere gentili e costruttivi nelle revisioni,
e chiediamo lo stesso a te.

> I messaggi di commit e i titoli delle PR seguono i
> [Conventional Commits](https://www.conventionalcommits.org/) con uno scope dove ha
> senso (`feat(talents): ...`, `fix(net): ...`). È una convenzione che ci piace più
> che un requisito rigido. Messaggi chiari e descrittivi contano più di una
> formattazione perfetta.

<a id="localization"></a>

## Localizzazione

World of ClaudeCraft è distribuito in molte lingue, e lo manteniamo tale man mano
che il gioco cresce. Ogni stringa visibile ai giocatori è tradotta in ogni lingua
supportata.

- Tutto il testo rivolto agli utenti è una chiave `t()` definita in
  [`src/ui/i18n.ts`](../../src/ui/i18n.ts). Aggiungi prima una nuova stringa alla lingua
  `en`, poi fornisci una traduzione reale in ogni altra lingua presente in
  `supportedLanguages`. Niente segnaposto in inglese, e niente `// TODO`.
- Numeri, denaro, date, unità e percentuali passano per i formatter
  (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) anziché per la
  costruzione manuale delle stringhe.
- Il testo rivolto ai giocatori emesso da `src/sim/` o `server/`, che restano
  indipendenti dalla lingua, deve essere ri-localizzato al confine del client nella
  stessa modifica. Il test di controllo
  `npx vitest run tests/localization_fixes.test.ts` lo verifica.

Se la tua modifica aggiunge una stringa e riesci a scriverla solo in alcune lingue,
va bene così. Apri la PR e chiedi aiuto per le altre nella descrizione. Preferiamo di
gran lunga aiutarti a finire piuttosto che vederti rinunciare.

<a id="translating-the-game"></a>

## Tradurre il gioco

Vuoi migliorare una lingua, o aiutare a portare il gioco in una nuova? Non devi
scrivere alcun codice di gioco per farlo:

1. Apri [`src/ui/i18n.ts`](../../src/ui/i18n.ts) e trova la lingua su cui vuoi lavorare.
   Ogni oggetto lingua elenca le stesse chiavi di `en`.
2. Migliora le traduzioni esistenti, o completa quelle che suonano poco naturali.
3. Esegui `npx tsc --noEmit` per confermare che non manchi nulla, poi apri una PR.

Per proporre una lingua completamente nuova, o per discutere di tono e
terminologia, avvia una discussione su [Discord](https://discord.gg/GjhnUsBtw) e ti
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

## Ottenere aiuto

Bloccato, o hai solo voglia di salutare? Unisciti al
[Discord della comunità](https://discord.gg/GjhnUsBtw). Nessuna domanda è troppo
piccola, e i nuovi contributori sono sempre benvenuti.

## Licenza

Contribuendo, accetti che i tuoi contributi siano rilasciati sotto la
[Licenza MIT](../../LICENSE) del progetto, la stessa licenza che copre il progetto.

---

Grazie per aver contribuito a World of ClaudeCraft. Non vediamo l'ora di scoprire
cosa costruirai insieme a noi.
