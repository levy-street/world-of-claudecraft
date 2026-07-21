<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · **Svenska** · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

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

Du behöver [Node.js 22+](https://nodejs.org/) och npm. För flerspelarservern vill
du även ha [Docker](https://www.docker.com/) för att köra Postgres.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Install dependencies
npm ci

# 3. Run the offline client (no server or database needed)
npm run dev          # open the URL it prints (usually http://localhost:5173)
```

Det räcker för att spela offlinevärlden och arbeta med det mesta. För att köra
hela onlinestacken:

```bash
npm run db:up        # start Postgres 16 in Docker (dev DB on port 5433)
npm run server       # build and run the authoritative game server on :8787
npm run dev          # in another terminal; the client proxies to the server
```

[README](../../README.md) innehåller den fullständiga guiden för att köra,
utveckla och spela, och `CLAUDE.md`-filerna runt om i repot dokumenterar
konventionerna för varje område.

## Göra din ändring

1. **Skapa en gren** från `main`: `feature/<short-slug>` eller `fix/<short-slug>`.
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
- **Handredigera inte genererade filer** som `*.generated.ts`. Generera om dem via
  bygget.
- **Commita aldrig hemligheter** eller en `.env`-fil, och aktivera aldrig
  `ALLOW_DEV_COMMANDS` i en produktionssökväg, eftersom det låser upp fusk.

## Innan du öppnar en pull request

Kör de här lokalt. Det är samma kontroller som CI kör:

```bash
npm test                    # Vitest suite
npx tsc --noEmit            # TypeScript typecheck (the project is strict)
npm run security:gate       # malicious-code release gate (high-severity signatures; also asserted by npm test)
npm run build               # production client build
```

Om du ändrade server- eller huvudlös kod, kör även `npm run build:server` och
`npm run build:env`.

Testa sedan din ändring på både dator och mobil, inklusive en telefonstor vy i
porträtt och landskap, om den rör något spelare ser. Tryckytor bör hållas till
minst 40x40px och formulärfält till minst 16px teckenstorlek. UI-standarderna är
dokumenterade i [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Öppna pull requesten

Pusha din gren och öppna en PR mot `main`.
[Mallen för pull requests](../../.github/PULL_REQUEST_TEMPLATE.md) leder dig genom
en kort checklista. Fyll i den:

- Beskriv **vad** som ändrades och **varför**.
- Länka eventuellt relaterat issue (till exempel "Closes #123").
- Lägg till **skärmbilder eller ett klipp för UI-ändringar**, på dator och mobil.
- Bekräfta att tester, typkontroll och bygget passerar, och att nya strängar är
  översatta.

En grön CI-körning och en komplett checklista är vad vi letar efter innan vi slår
samman. En underhållare kan föreslå ändringar. Det är en normal, samarbetsinriktad
del av processen, inte ett avslag. Vi strävar efter att vara vänliga och
konstruktiva i granskningen, och vi ber dig om detsamma.

> Commit-meddelanden och PR-titlar följer [Conventional Commits](https://www.conventionalcommits.org/)
> med en scope där det passar (`feat(talents): ...`, `fix(net): ...`). Det är en
> konvention vi gillar snarare än ett strikt krav. Tydliga, beskrivande
> meddelanden betyder mer än perfekt formatering.

<a id="localization"></a>

## Lokalisering

World of ClaudeCraft levereras på många språk, och vi håller det så medan spelet
växer. Varje spelarsynlig sträng översätts till varje språk som stöds.

- All text som vänder sig mot användaren är en `t()`-nyckel definierad i
  [`src/ui/i18n.ts`](../../src/ui/i18n.ts). Lägg först till en ny sträng i
  `en`-språket, och tillhandahåll sedan en verklig översättning i alla andra språk
  i `supportedLanguages`. Inga engelska platshållare, och inga `// TODO`.
- Tal, pengar, datum, enheter och procenttal går genom formaterarna
  (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) i stället för manuell
  strängbyggnad.
- Spelarsynlig text som sänds ut från `src/sim/` eller `server/`, som förblir
  språkagnostiska, måste lokaliseras om vid klientgränsen i samma ändring. Skydds-
  testet `npx vitest run tests/localization_fixes.test.ts` upprätthåller detta.

Om din ändring lägger till en sträng och du bara kan skriva den på vissa språk är
det okej. Öppna PR:en och be om hjälp med resten i beskrivningen. Vi hjälper dig
hellre att slutföra än att du håller tillbaka.

<a id="translating-the-game"></a>

## Översätta spelet

Vill du förbättra ett språk, eller hjälpa till att föra spelet till ett nytt? Du
behöver inte skriva någon spelkod för att göra det:

1. Öppna [`src/ui/i18n.ts`](../../src/ui/i18n.ts) och hitta språket du vill arbeta
   med. Varje språkobjekt listar samma nycklar som `en`.
2. Förbättra befintliga översättningar, eller fyll i sådana som låter klumpiga.
3. Kör `npx tsc --noEmit` för att bekräfta att inget saknas, och öppna sedan en PR.

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

## Få hjälp

Fastnat, eller vill bara säga hej? Gå med i
[gemenskapens Discord](https://discord.com/invite/worldofclaudecraft). Ingen fråga är för liten, och
nya bidragsgivare är alltid välkomna.

## Licens

Genom att bidra godkänner du att dina bidrag licensieras under projektets
[MIT-licens](../../LICENSE), samma licens som täcker projektet.

---

Tack för att du bidrar till World of ClaudeCraft. Vi kan inte vänta på att få se
vad du bygger tillsammans med oss.
