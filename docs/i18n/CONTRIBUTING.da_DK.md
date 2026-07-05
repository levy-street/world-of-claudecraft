<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · **Dansk**

</div>

# Bidrag til World of ClaudeCraft

Først og fremmest tak, fordi du er her. World of ClaudeCraft er bygget af et
fællesskab af mennesker, der elsker klassiske MMO'er, og hvert bidrag, stort
eller lille, gør spillet bedre. At rette en tastefejl, oversætte spillet,
rapportere en fejl, bygge et helt nyt dungeon: det tæller alt sammen, og du er
velkommen her.

Denne guide hjælper dig med at komme i gang og gøre dit første bidrag nemt. Du
behøver ikke at være ekspert. Hvis noget er uklart, så spørg på
[Discord](https://discord.gg/GjhnUsBtw), og der er nogen, der gerne hjælper.

Ved at deltage accepterer du at følge vores [adfærdskodeks](../../CODE_OF_CONDUCT.md).

## Måder at bidrage på

Der er plads til alle her:

- **Kode.** Ret en fejl, tilføj en funktion, eller forbedr ydeevnen. Issues med
  mærkaten
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  og [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  er gode steder at starte.
- **Oversættelser.** Hjælp spillere over hele verden ved at forbedre eller
  færdiggøre et sprog. Se [Oversæt spillet](#translating-the-game) nedenfor.
  Dette er en af de nemmeste og mest virkningsfulde måder at komme i gang på.
- **Fejlrapporter og funktionsidéer.** Åbn et [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose).
  En tydelig fejlrapport er et reelt bidrag.
- **Dokumentation.** Guider som denne, README'en og designdokumenterne i
  `docs/` kan altid forbedres.
- **Spiltest og feedback.** Spil spillet, fortæl os, hvad der føles forkert, og
  del idéer på Discord.

## Kom i gang

Du skal bruge [Node.js 22+](https://nodejs.org/) og npm. Til multiplayer-serveren
skal du også bruge [Docker](https://www.docker.com/) til at køre Postgres.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Install dependencies
npm ci

# 3. Run the offline client (no server or database needed)
npm run dev          # open the URL it prints (usually http://localhost:5173)
```

Det er nok til at spille offline-verdenen og arbejde på de fleste ting. For at
køre hele online-stacken:

```bash
npm run db:up        # start Postgres 16 in Docker (dev DB on port 5433)
npm run server       # build and run the authoritative game server on :8787
npm run dev          # in another terminal; the client proxies to the server
```

[README](../../README.md) indeholder den fulde guide til at hoste, udvikle og
spille, og `CLAUDE.md`-filerne rundt omkring i repoet dokumenterer
konventionerne for hvert område.

## Sådan laver du din ændring

1. **Opret en branch** ud fra `main`: `feature/<short-slug>` eller `fix/<short-slug>`.
2. **Lav fokuserede commits.** Mindre, selvstændige ændringer er nemmere at
   gennemgå og merge end store.
3. **Tilføj eller opdater tests** for enhver adfærd, du ændrer i `src/sim/` eller
   `server/`.
4. **Hold spillersynlig tekst oversættelig.** Se [Lokalisering](#localization)
   og [Oversæt spillet](#translating-the-game).

### Ting at huske på

Dette er de bærende regler i kodebasen. Den fulde detalje findes i
[`CLAUDE.md`](../../CLAUDE.md) i roden, men her er den korte version:

- **Simuleringskernen (`src/sim/`) er kilden til sandheden**, og den forbliver
  ren, uden DOM-, browser- eller Three.js-importer, så præcis den samme kode
  kører offline, på serveren og i det headless RL-miljø.
- **Simuleringen er deterministisk.** Den kører med et fast 20 Hz-tick, og al
  tilfældighed går gennem `Rng`, aldrig `Math.random`, `Date.now` eller
  `performance.now` i sim-logik. Det samme seed producerer altid den samme
  verden.
- **Gameplay-matematikken følger MMO-formler fra den klassiske æra** (rage,
  hit-tabeller, rustning, XP-kurver). Lad være med at opfinde balancetal. Henvis
  i stedet til formlen.
- **Rediger ikke genererede filer i hånden** såsom `*.generated.ts`. Generér dem
  igen gennem build'et.
- **Commit aldrig hemmeligheder** eller en `.env`-fil, og aktivér aldrig
  `ALLOW_DEV_COMMANDS` i en produktionssti, da det låser snyd op.

## Før du åbner en pull request

Kør venligst disse lokalt. Det er de samme tjek, som CI kører:

```bash
npm test                    # Vitest suite
npx tsc --noEmit            # TypeScript typecheck (the project is strict)
npm run security:gate       # malicious-code release gate (high-severity signatures; also asserted by npm test)
npm run build               # production client build
```

Hvis du har ændret server- eller headless-kode, så kør også `npm run build:server`
og `npm run build:env`.

Test derefter din ændring på både desktop og mobil, herunder en
telefonstørrelse-viewport i både stående og liggende format, hvis den berører
noget, spillerne ser. Berøringsmål bør forblive på mindst 40x40px og
formularinput på mindst 16px skrifttype. UI-standarderne er dokumenteret i
[`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Åbn pull requesten

Push din branch og åbn en PR mod `main`.
[Pull request-skabelonen](../../.github/PULL_REQUEST_TEMPLATE.md) guider dig
gennem en kort tjekliste. Udfyld den venligst:

- Beskriv **hvad** der blev ændret, og **hvorfor**.
- Link et eventuelt relateret issue (for eksempel "Closes #123").
- Tilføj **skærmbilleder eller et klip for UI-ændringer**, på desktop og mobil.
- Bekræft, at tests, typecheck og build'et består, og at nye strenge er
  oversat.

En grøn CI-kørsel og en komplet tjekliste er, hvad vi kigger efter, før vi
merger. En maintainer kan foreslå ændringer. Det er en normal, samarbejdende del
af processen, ikke en afvisning. Vi sigter efter at være venlige og
konstruktive i gennemgangen, og vi beder om det samme af dig.

> Commit-beskeder og PR-titler følger [Conventional Commits](https://www.conventionalcommits.org/)
> med et scope, hvor det passer (`feat(talents): ...`, `fix(net): ...`). Det er
> en konvention, vi godt kan lide, snarere end et strengt krav. Tydelige,
> beskrivende beskeder betyder mere end perfekt formatering.

<a id="localization"></a>

## Lokalisering

World of ClaudeCraft udgives på mange sprog, og vi holder det sådan, efterhånden
som spillet vokser. Hver spillersynlig streng oversættes til hver understøttet
lokalitet.

- Al brugervendt tekst er en `t()`-nøgle defineret i [`src/ui/i18n.ts`](../../src/ui/i18n.ts).
  Tilføj en ny streng til `en`-lokaliteten først, og angiv derefter en reel
  oversættelse i alle andre lokaliteter i `supportedLanguages`. Ingen engelske
  pladsholdere og ingen `// TODO`.
- Tal, penge, datoer, enheder og procenter går gennem formaterne
  (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) i stedet for manuel
  strengbygning.
- Spillervendt tekst, der udsendes fra `src/sim/` eller `server/`, som forbliver
  sprogagnostiske, skal lokaliseres igen ved klientgrænsen i samme ændring.
  Guard-testen `npx vitest run tests/localization_fixes.test.ts` håndhæver dette.

Hvis din ændring tilføjer en streng, og du kun kan skrive den på nogle sprog, er
det fint. Åbn PR'en og bed om hjælp med resten i beskrivelsen. Vi vil meget
hellere hjælpe dig med at blive færdig end have, at du holder igen.

<a id="translating-the-game"></a>

## Oversæt spillet

Vil du forbedre et sprog eller hjælpe med at bringe spillet til et nyt? Du behøver
ikke at skrive nogen spilkode for at gøre det:

1. Åbn [`src/ui/i18n.ts`](../../src/ui/i18n.ts) og find den lokalitet, du vil
   arbejde på. Hvert lokalitetsobjekt lister de samme nøgler som `en`.
2. Forbedr eksisterende oversættelser, eller udfyld dem, der læses akavet.
3. Kør `npx tsc --noEmit` for at bekræfte, at intet mangler, og åbn derefter en
   PR.

For at foreslå en helt ny lokalitet eller for at drøfte tone og terminologi kan
du starte en tråd på [Discord](https://discord.gg/GjhnUsBtw), så hjælper vi dig
med at koble den op. Indfødte og flydende talere er især velkomne. Gode
oversættelser får spillet til at føles hjemligt for spillere overalt.

## Rapportér fejl og anmod om funktioner

Brug venligst [issue-skabelonerne](https://github.com/levy-street/world-of-claudecraft/issues/new/choose):

- **Fejlrapport.** Søg først i [eksisterende issues](https://github.com/levy-street/world-of-claudecraft/issues)
  for at undgå dubletter, og inkludér derefter trin til at reproducere, hvad du
  forventede, hvad der skete, og dit miljø (offline eller online, browser,
  desktop eller mobil).
- **Funktionsanmodning.** Beskriv det problem, du forsøger at løse, ikke kun
  løsningen. Kontekst hjælper os med at designe det rigtige.

## Få hjælp

Sidder du fast, eller vil du bare sige hej? Tilslut dig
[fællesskabets Discord](https://discord.gg/GjhnUsBtw). Intet spørgsmål er for
lille, og nye bidragydere er altid velkomne.

## Licens

Ved at bidrage accepterer du, at dine bidrag licenseres under projektets
[MIT-licens](../../LICENSE), den samme licens, der dækker projektet.

---

Tak, fordi du bidrager til World of ClaudeCraft. Vi kan ikke vente med at se,
hvad du bygger sammen med os.
