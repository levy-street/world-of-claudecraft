<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Čeština](CONTRIBUTING.cs_CZ.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · **Svenska** · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# Bidra till World of ClaudeCraft

Först och främst, tack för att du är här. World of ClaudeCraft byggs av en
gemenskap av människor som älskar klassiska MMO-spel, och varje bidrag, stort som
litet, gör det bättre. Att rätta ett stavfel, översätta spelet, rapportera en
bugg, bygga en helt ny instans: allt räknas, och du är välkommen här.

Den här guiden hjälper dig att komma igång och göra ditt första bidrag smidigt.
Du behöver inte vara expert. Om något är oklart, fråga på
[Discord](https://discord.com/invite/worldofclaudecraft) så hjälper någon dig gärna.

Genom att delta godkänner du att följa vår [uppförandekod](../../CODE_OF_CONDUCT.md).

## Sätt att bidra

Det finns en plats för alla här:

- **Kod.** Rätta en bugg, lägg till en funktion eller förbättra prestandan. Issues
  märkta
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  och [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  är bra ställen att börja på.
- **Översättningar.** Hjälp spelare runt om i världen genom att förbättra eller
  färdigställa ett språk. Se [Översätta spelet](#translating-the-game) nedan. Det
  är ett av de enklaste och mest verkningsfulla sätten att börja.
- **Buggrapporter och funktionsidéer.** Öppna ett [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose).
  En tydlig buggrapport är ett verkligt bidrag.
- **Dokumentation.** Guider som den här, README-filen och designdokumenten i
  `docs/` kan alltid förbättras.
- **Speltestning och återkoppling.** Spela spelet, berätta vad som känns fel och
  dela idéer på Discord.

## Kom igång

Du behöver [Node.js 26](https://nodejs.org/) och **pnpm 10.34.x** (exakt pin i `package.json` under `packageManager`, idag `pnpm@10.34.5`). Äldre Node-majorversioner är otestade. För multiplayerservern vill du också ha [Docker](https://www.docker.com/) för att köra Postgres.

**Corepack krävs inte.** Installera pnpm en gång med den npm som följer med Node. Samma väg på macOS, Linux och Windows.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Install pnpm once (same command on macOS, Linux, Windows)
#    Match the packageManager pin in package.json (today: 10.34.5).
npm install -g pnpm@10.34.5
pnpm --version   # should print 10.34.5 (or the pin in package.json)

# 3. Install dependencies (uses the global content-addressable store)
pnpm install --frozen-lockfile

# 4. Point git at the repository hooks (once per clone)
git config core.hooksPath .githooks

# 5. Run the offline client (no server or database needed)
pnpm run dev         # open the URL it prints (usually http://localhost:5173)
```

`npm run <script>` fungerar fortfarande efter en pnpm-installation (Node levererar npm), men **installation och lockfiluppdateringar måste gå via pnpm**. Committa inte en `package-lock.json`; den enda sanningen är `pnpm-lock.yaml`.

Det räcker för att spela offlinevärlden och arbeta med det mesta. För att köra
hela onlinestacken behöver du först ett databaslösenord i din miljö:

```bash
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
pnpm run db:up       # start Postgres 16 in Docker (dev DB on port 5433)
pnpm run server      # build and run the authoritative game server on :8787
pnpm run dev         # in another terminal; the client proxies to the server
```

Om du tänker köra hela gaten nedan, installera webbläsaren den styr en gång:
`pnpm exec playwright install chromium`.

[README](../../README.md) innehåller den fullständiga guiden för att köra,
utveckla och spela, och `CLAUDE.md`-filerna runt om i repot dokumenterar
konventionerna för varje område.

### TypeScript-verktygskedjan

Typkontrollen körs på TypeScript 7, den inbyggda kompilatorn: `npx tsc --noEmit`
fungerar precis som förut och en fullständig kontroll av repot tar nu några
sekunder i stället för tiotals sekunder. Installationen använder det officiella
dubbla aliaset: paketet `typescript` löser upp JS-API:et i TypeScript 6 (via
omslaget `@typescript/typescript6`) eftersom `svelte-check` fortfarande använder
det API:et, medan `@typescript/native` tillhandahåller binären `tsc`. Bra att
känna till:

- **Editorer.** VS Code behöver marknadsplatstillägget "TypeScript 7"
  (`TypeScriptTeam.native-preview`) för stöd för den inbyggda språktjänsten till
  dess att det inbyggda stödet levereras; det slås på och av via inställningen
  `js/ts.experimental.useTsgo`, och dess kommando "Disable TypeScript 7 Language
  Server" är den sanktionerade reservvägen tillbaka till tsserver i TypeScript 6.
  JetBrains IDE:er upptäcker den inbyggda servern automatiskt endast under
  paketnamnet `@typescript/native-preview`, så de kommer inte att hitta den via
  det här repots alias `@typescript/native`; deras medföljande stöd för
  TypeScript 6 fungerar bra.
- **Användbara tsc-flaggor.** `--checkers N` anger antalet parallella
  typkontrollarbetare (standard 4; resultaten är identiska oavsett antal): sänk
  det för att begränsa minnet på en resursbegränsad runner, höj det på en maskin
  med många kärnor, och mät i båda fallen, eftersom mer inte alltid är snabbare.
  `--singleThreaded` stänger av all parallellism. Att kontrollera en enskild fil
  ad hoc (`npx tsc somefile.ts`) ger ett fel när katalogen har en
  `tsconfig.json`; skicka med `--ignoreConfig` för det gamla beteendet.
- **Lockfilen.** Lockfilen är `pnpm-lock.yaml` (pnpm 10 / lockfileVersion 9). Uppdatera den bara med `pnpm install`, `pnpm add` eller `pnpm update` från repo-roten (aldrig för hand). Committa `pnpm-lock.yaml` tillsammans med `package.json`-ändringar. CI installerar med `pnpm install --frozen-lockfile`; en inaktuell lockfil misslyckas. Inför inte en andra lockfil (`package-lock.json` / yarn.lock): dubbla lockfiler divergerar tyst och är förbjudna. Peer-dependency-brus från valfria wallet/solana-träd tolereras via `.npmrc` (`strict-peer-dependencies=false`); lätta inte mer utan att mäta.
- **När det bör ses över.** Slå ihop det dubbla aliaset till ett enda
  `typescript`-beroende först när BÅDA gäller: det stabila JS-API:et i
  TypeScript 7.1 har släppts (TypeScript 7.0 levererar inget JS-API alls;
  ersättaren spåras i issue 2824 i microsoft/typescript-go), och issue 3063 i
  sveltejs/language-tools har stängts med en släppt `svelte-check` som använder
  det. svelte-checks experimentella `--tsgo`-lägen tar inte bort dess krav på
  TypeScript 6-API:et, och dess pågående inläsning av TypeScript 7 (PR 3073 i
  language-tools) läser aliaset `@typescript/native` som det här repot redan
  använder, så ingen omdöpning behövs.

## Göra din ändring

1. **Utgå från den senaste release-grenen, och aldrig från `main`.** Aktivt
   arbete integreras på en `release/vX.Y.Z`-gren; `main` ligger efter och är inte
   basen för bidrag. Hitta den nyaste och skapa din gren från den:

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # the newest release branch
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   Kör alltid den uppslagningen i stället för att kopiera ett versionsnummer ur
   den här guiden: release-grenar byts ut ofta, och den nyaste flyttas med varje
   release. Grenar heter `feature/<short-slug>` eller `fix/<short-slug>`.
2. **Gör fokuserade commits.** Mindre, fristående ändringar är lättare att granska
   och slå samman än stora.
3. **Lägg till eller uppdatera tester** för all funktionalitet du ändrar i
   `src/sim/` eller `server/`.
4. **Håll spelarsynlig text översättbar.** Se [Lokalisering](#localization) och
   [Översätta spelet](#translating-the-game).

### Saker att tänka på

Det här är de bärande reglerna i kodbasen. Den fullständiga detaljen finns i
rotens [`CLAUDE.md`](../../CLAUDE.md), men kortversionen:

- **Simuleringskärnan (`src/sim/`) är källan till sanning**, och den förblir ren,
  utan importer från DOM, webbläsare eller Three.js, så att exakt samma kod körs
  offline, på servern och i den huvudlösa RL-miljön.
- **Simuleringen är deterministisk.** Den körs med ett fast 20 Hz-tick, och all
  slumpmässighet går genom `Rng`, aldrig `Math.random`, `Date.now` eller
  `performance.now` i sim-logik. Samma seed ger alltid samma värld.
- **Spelmatematiken följer MMO-formler från den klassiska eran** (raseri,
  träfftabeller, rustning, XP-kurvor). Hitta inte på balansvärden. Hänvisa till
  formeln i stället.
- **Ny logik landar som sin egen lilla, testade modul bakom en befintlig söm**,
  i stället för att läggas till sist i en av de stora koordinatorfilerna. Data som
  renderaren eller HUD:en läser passerar gränssnittet `IWorld`
  (`src/world_api/`) och implementeras i både offlinevärlden och onlinevärlden;
  ett nytt simuleringssystem hamnar bakom `SimContext`; en ny REST-endpoint är en
  ruttmodul som du kan generera med `pnpm run new:endpoint`.
- **Handredigera inte genererade filer** som `*.generated.ts`. Generera om dem via
  bygget.
- **Husets textstil: inga långa tankstreck, korta tankstreck eller emojier**
  någonstans, varken i kod, kommentarer, dokumentation, commit-meddelanden,
  PR-text eller spelarsynlig text. Använd kommatecken, kolon, parenteser eller
  "till" för intervall. En pre-push-kontroll granskar din diff och blockerar
  pushen vid träff.
- **Commita aldrig hemligheter** eller en `.env`-fil, och aktivera aldrig
  `ALLOW_DEV_COMMANDS` i en produktionssökväg, eftersom det låser upp fusk.

### Kodstil

Formateringen sköts av [Biome](https://biomejs.dev/), konfigurerad i
`biome.json`: 2 blanksteg indrag, 100 tecken breda rader, enkla citattecken,
avslutande kommatecken. Formatera bara de filer du rörde
(`npx @biomejs/biome check --write <your-file.ts>`) och kontrollera dem med
`pnpm run ci:changed`. CI granskar bara ändrade filer, så formatera inte om resten
av trädet: en körning över hela repot lyfter fram gammal skuld som inte är din
att åtgärda.

## Innan du öppnar en pull request

Kör repots gate lokalt. Det är samma kontrakt som CI upprätthåller:

```bash
pnpm run gate
```

Medan du itererar, kör en enskild svit (`npx vitest run tests/sim.test.ts`) och
`pnpm run ci:changed` för formatering; `pnpm test` kör allt, och sviternas karta
finns i `tests/CLAUDE.md`. Hela `pnpm run gate` täcker färskheten hos genererade
artefakter, malware-skanningen, formateringen av ändrade filer,
konformanskontrollen för ljudeffekter, hela testsviten, en regressionsomgång i en
riktig webbläsare, den strikta typkontrollen samt byggena för klient, server och
huvudlös miljö. De lagerindelade kontrollerna, från pre-push-golvet och uppåt,
beskrivs i [`docs/qa-gate.md`](../qa-gate.md).

Testa sedan din ändring på både dator och mobil, inklusive en telefonstor vy i
porträtt och landskap, om den rör något spelare ser. Tryckytor bör hållas till
minst 40x40px och formulärfält till minst 16px teckenstorlek. UI-standarderna är
dokumenterade i [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Öppna pull requesten

Pusha din gren och öppna en PR **mot samma senaste `release/vX.Y.Z`-gren som du
utgick från. Rikta den aldrig mot `main`**, som är en integrationsgren vid release
snarare än basen för bidrag. GitHub förväljer ofta `main` åt dig, så byt basgren
innan du skickar in.
[Mallen för pull requests](../../.github/PULL_REQUEST_TEMPLATE.md) leder dig genom
en kort checklista. Fyll i den:

- Beskriv **vad** som ändrades och **varför**.
- Länka eventuellt relaterat issue (till exempel "Closes #123").
- Lägg till **skärmbilder eller ett klipp för UI-ändringar**, på dator och mobil.
- Bekräfta att `pnpm run gate` passerar och att nya spelarsynliga strängar följer
  den engelska-först-policy för bidragsgivare som beskrivs nedan.

På din PR kör CI formatering och lintning över dina ändrade filer, hela testsviten
över fyra parallella shards, en regressionsomgång i webbläsare samt typkontrollen
plus byggena för klient, server och huvudlös miljö. Det motsvarar vad
`pnpm run gate` kör lokalt, så en grön gate är en bra indikator på en grön PR.

En grön CI-körning och en komplett checklista är vad vi letar efter innan vi slår
samman. En underhållare kan föreslå ändringar. Det är en normal, samarbetsinriktad
del av processen, inte ett avslag. Vi strävar efter att vara vänliga och
konstruktiva i granskningen, och vi ber dig om detsamma.

> Commit-meddelanden och PR-titlar följer [Conventional Commits](https://www.conventionalcommits.org/)
> med en scope (`feat(talents): ...`, `fix(net): ...`). Varje commit bär också en
> brödtext: efter en tom rad, en till fyra enkla meningar som säger vad som
> ändrades och varför, radbrutna kring 72 kolumner. En titel på egen hand räcker
> inte.

<a id="localization"></a>

## Lokalisering

World of ClaudeCraft levereras på många språk. Varje spelarsynlig sträng måste
vara en översättningsnyckel, medan den som bidrar med en funktion normalt bara
lägger till den engelska källtexten.

- All text som vänder sig mot användaren är en `t()`-nyckel. Lägg till ny engelsk
  text i motsvarande domänmodul under
  [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) (nya HUD-ramar hamnar i
  `hud_chrome.ts`), och rendera den sedan med `t('dotted.key', values)`. Enbart
  engelska är precis rätt för en funktions-PR: underhållaren fyller i de övriga
  språken vid release, så du redigerar inte överläggen i `src/ui/i18n.locales/`
  och du lämnar aldrig en engelsk platshållare eller en `// TODO` i ett sådant.
  M16-undantaget är ett nytt ordrikt engelskt värde, som också behöver de fem
  icke-latinska ifyllningarna som beskrivs i
  [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).
- Tal, pengar, datum, enheter och procenttal går genom formaterarna
  (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) i stället för manuell
  strängbyggnad.
- Spelarsynlig text som sänds ut från `src/sim/` eller `server/`, som förblir
  språkagnostiska, måste lokaliseras om vid klientgränsen i samma ändring. Skydds-
  testet `npx vitest run tests/localization_fixes.test.ts` upprätthåller detta.
- Efter att du lagt till eller ändrat en sträng, kör `pnpm run i18n:gen` och
  commita de omgenererade buntarna i samma ändring. Både gaten och CI jämför de
  commitade artefakterna mot en färsk omgenerering, så en inaktuell bunt får
  bygget att misslyckas.

Så lägg till dina strängar på engelska och öppna PR:en; du behöver inte översätta
dem själv. Om du vill hjälpa till med översättningar, se nästa avsnitt.

<a id="translating-the-game"></a>

## Översätta spelet

Vill du förbättra ett språk, eller hjälpa till att föra spelet till ett nytt? Du
behöver inte skriva någon spelkod för att göra det:

1. Merparten av de spelarsynliga översättningarna finns i de språkvisa
   överläggsfilerna under
   [`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) (en per språk), som
   speglar de engelska nycklarna i
   [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/). Text som sänds ut av
   simuleringen och servern översätts i `src/ui/sim_i18n.ts` och
   `src/ui/server_i18n.ts`, talangtexter i `talent_i18n`-modulerna, och
   administrationspanelen har sin egen uppsättning under
   `src/admin/i18n.locales/`.
2. Förbättra befintliga översättningar, eller fyll i sådana som låter klumpiga.
3. Kör `pnpm run i18n:gen`, commita de omgenererade buntarna tillsammans med din
   överläggsändring, kör sedan lokaliseringssviterna
   (`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`)
   och öppna en PR. Enbart en typkontroll talar inte om för dig om en nyckel
   saknas, eftersom överläggen medvetet är glesa.

För att föreslå ett helt nytt språk, eller för att diskutera ton och terminologi,
starta en tråd på [Discord](https://discord.com/invite/worldofclaudecraft) så hjälper vi dig att
koppla in det. Modersmåls- och flytande talare är särskilt välkomna. Bra
översättningar får spelet att kännas som hemma för spelare överallt.

## Rapportera buggar och begära funktioner

Använd [issue-mallarna](https://github.com/levy-street/world-of-claudecraft/issues/new/choose):

- **Buggrapport.** Sök bland [befintliga issues](https://github.com/levy-street/world-of-claudecraft/issues)
  först för att undvika dubbletter, och inkludera sedan steg för att återskapa, vad
  du förväntade dig, vad som hände och din miljö (offline eller online, webbläsare,
  dator eller mobil).
- **Funktionsönskemål.** Beskriv problemet du försöker lösa, inte bara lösningen.
  Sammanhang hjälper oss att designa rätt sak.
- **Säkerhetssårbarheter.** Öppna inte ett publikt issue. Rapportera dem privat
  genom att följa [SECURITY.md](../../SECURITY.md), så arbetar vi tillsammans med
  dig kring en åtgärd och kring offentliggörandet.

## Få hjälp

Fastnat, eller vill bara säga hej? Gå med i
[gemenskapens Discord](https://discord.com/invite/worldofclaudecraft). Ingen fråga är för liten, och
nya bidragsgivare är alltid välkomna.

## Licens

Genom att bidra med kod godkänner du att dina kodbidrag licensieras under
projektets [MIT-licens](../../LICENSE), samma licens som täcker projektet.

MIT-licensen betyder precis vad den säger: vem som helst får använda, ändra och
vidaredistribuera koden, kommersiellt eller inte. Våra
[användarvillkor](https://worldofclaudecraft.com/terms) styr det värdbaserade
spelet vi driver på worldofclaudecraft.com (konton, uppförande, virtuella föremål)
och begränsar inte de rättigheter MIT-licensen ger dig eller någon annan i den här
koden. Namnen och varumärkena "World of ClaudeCraft" och "Levy Street" omfattas
inte av MIT-licensen.

Ursprungliga kreativa tillgångar (ljudinspelningar, musik, konst och liknande
upphovsrättsligt skyddade verk) är undantaget. Om du bidrar med en originaltillgång
som du själv har skapat får du i stället behålla upphovsrätten och bidra med den
under en licens du väljer (till exempel CC BY-NC 4.0), förutsatt att:

- licensen, tillgångssökvägarna den täcker och din attribution registreras i
  licenstabellen i [CREDITS.md](../../CREDITS.md) som en del av samma pull
  request, och
- den minst innefattar en evig, royaltyfri rätt för Levy Street att använda
  tillgångarna kommersiellt i World of ClaudeCraft, inklusive officiella releaser
  och butiken i spelet.

För tillgångar som listas i tabellen i CREDITS.md gäller den registrerade licensen
före projektets förvalda MIT-licens.

**Mediatillgångar utan en post i CREDITS.md är inte licensierade under MIT.**
Registret håller fortfarande på att färdigställas, så en saknad post betyder att
villkoren är oregistrerade, inte att tillgången är fri att ta. Det är avsiktligt:
det hindrar att ett oregistrerat bidrag ges bort som standard. För kod gäller det
omvända, och allt som inte är undantaget i CREDITS.md är MIT.

Det är just därför registerposten inte är valfritt pappersarbete. Om du bidrar med
en tillgång utan en rad i CREDITS.md kan ingen längre ned i kedjan använda den, och
vi har ingen dokumentation av vad du beviljat oss. Fyll även i kolumnen
**Redistribution** ärligt. Det är den som talar om för någon som forkar projektet
om de får föra din tillgång vidare, och vissa rader är märkta
"No, permission required" just för att de inte får det.

---

Tack för att du bidrar till World of ClaudeCraft. Vi kan inte vänta på att få se
vad du bygger tillsammans med oss.
