<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Čeština](CONTRIBUTING.cs_CZ.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · **Dansk**

</div>

# Bidrag til World of ClaudeCraft

Først og fremmest tak, fordi du er her. World of ClaudeCraft er bygget af et
fællesskab af mennesker, der elsker klassiske MMO'er, og hvert bidrag, stort
eller lille, gør spillet bedre. At rette en tastefejl, oversætte spillet,
rapportere en fejl, bygge et helt nyt dungeon: det tæller alt sammen, og du er
velkommen her.

Denne guide hjælper dig med at komme i gang og gøre dit første bidrag nemt. Du
behøver ikke at være ekspert. Hvis noget er uklart, så spørg på
[Discord](https://discord.com/invite/worldofclaudecraft), og der er nogen, der gerne hjælper.

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

Du skal bruge [Node.js 26](https://nodejs.org/) og **pnpm 10.34.x** (præcis pin står i `package.json` under `packageManager`, i dag `pnpm@10.34.5`). Ældre Node-majorversioner er ikke testet. Til multiplayer-serveren bør du også have [Docker](https://www.docker.com/) til at køre Postgres.

**Corepack er ikke påkrævet.** Installer pnpm én gang med den npm, der følger med Node. Samme fremgangsmåde på macOS, Linux og Windows.

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

`npm run <script>` virker stadig efter en pnpm-installation (Node leverer npm), men **installation og lockfile-opdateringer skal gå gennem pnpm**. Commit ikke en `package-lock.json`; den eneste sandhedskilde er `pnpm-lock.yaml`.

Det er nok til at spille offline-verdenen og arbejde på de fleste ting. For at
køre hele online-stacken skal du først have et databasekodeord i dit miljø:

```bash
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
pnpm run db:up       # start Postgres 16 in Docker (dev DB on port 5433)
pnpm run server      # build and run the authoritative game server on :8787
pnpm run dev         # in another terminal; the client proxies to the server
```

Hvis du planlægger at køre hele gaten nedenfor, så installér den browser, den
styrer, én gang: `pnpm exec playwright install chromium`.

[README](../../README.md) indeholder den fulde guide til at hoste, udvikle og
spille, og `CLAUDE.md`-filerne rundt omkring i repoet dokumenterer
konventionerne for hvert område.

### TypeScript-værktøjskæde

Typetjek kører på TypeScript 7, den native compiler: `npx tsc --noEmit` virker
præcis som før, og et fuldt tjek af repoet tager nu få sekunder i stedet for
titalls sekunder. Installationen er det officielle dobbelte alias:
`typescript`-pakken slår op i JS-API'et fra TypeScript 6 (via
`@typescript/typescript6`-wrapperen), fordi `svelte-check` stadig bruger det
API, mens `@typescript/native` leverer `tsc`-binæren. Ting, du bør vide:

- **Editorer.** VS Code kræver marketplace-udvidelsen "TypeScript 7"
  (`TypeScriptTeam.native-preview`) for understøttelse af den native
  language service, indtil den indbyggede understøttelse udkommer; den slås til
  og fra via indstillingen `js/ts.experimental.useTsgo`, og kommandoen "Disable
  TypeScript 7 Language Server" er den sanktionerede tilbagefaldsvej til
  tsserver fra TypeScript 6. JetBrains-IDE'er registrerer kun den native server
  automatisk under pakkenavnet `@typescript/native-preview`, så de opdager den
  ikke via dette repos `@typescript/native`-alias; deres medfølgende
  TypeScript 6-understøttelse fungerer fint.
- **Nyttige tsc-flag.** `--checkers N` angiver antallet af parallelle
  typetjek-workers (standard 4; resultaterne er identiske uanset antal): sænk
  det for at begrænse hukommelsen på en presset runner, hæv det på en maskine
  med mange kerner, og mål begge veje, for mere er ikke altid hurtigere.
  `--singleThreaded` slår al parallelitet fra. Et ad hoc-tjek af en enkelt fil
  (`npx tsc somefile.ts`) fejler, når mappen indeholder en `tsconfig.json`;
  angiv `--ignoreConfig` for den gamle adfærd.
- **Lockfil.** Lockfilen er `pnpm-lock.yaml` (pnpm 10 / lockfileVersion 9). Opdater den kun med `pnpm install`, `pnpm add` eller `pnpm update` fra repo-roden (redigér den aldrig i hånden). Commit `pnpm-lock.yaml` sammen med `package.json`-ændringer. CI installerer med `pnpm install --frozen-lockfile`; en forældet lockfil fejler lukket. Indfør ikke en anden lockfil (`package-lock.json` / yarn.lock): duale lockfiler divergerer stille og er forbudt. Peer-dependency-støj fra valgfrie wallet/solana-træer tolereres via `.npmrc` (`strict-peer-dependencies=false`); løsn det ikke yderligere uden at måle.
- **Hvornår det skal tages op igen.** Slå det dobbelte alias sammen til én
  enkelt `typescript`-afhængighed, når BEGGE gælder: det stabile JS-API i
  TypeScript 7.1 er udkommet (TypeScript 7.0 leverer slet intet JS-API;
  erstatningen spores i microsoft/typescript-go issue 2824), og
  sveltejs/language-tools issue 3063 er lukket med en udgivet `svelte-check`,
  der tager det i brug. svelte-checks eksperimentelle `--tsgo`-tilstande
  ophæver ikke kravet om TypeScript 6-API'et, og dens igangværende indlæsning af
  TypeScript 7 (language-tools PR 3073) læser det `@typescript/native`-alias,
  dette repo allerede bruger, så en omdøbning er ikke nødvendig.

## Sådan laver du din ændring

1. **Start fra den nyeste release-branch, og aldrig fra `main`.** Aktivt arbejde
   integreres på en `release/vX.Y.Z`-branch; `main` halter bagefter og er ikke
   basis for bidrag. Find den nyeste, og lav din branch ud fra den:

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # the newest release branch
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   Kør altid det opslag i stedet for at kopiere et versionsnummer fra denne
   vejledning: release-branches udskiftes ofte, og den nyeste flytter sig med
   hver udgivelse. Branches hedder `feature/<short-slug>` eller
   `fix/<short-slug>`.
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
- **Ny logik lander som sit eget lille, testede modul bag en eksisterende
  grænseflade** i stedet for at blive hægtet på en af de store
  koordinatorfiler. Data, som rendereren eller HUD'en læser, går over
  `IWorld`-grænsefladen (`src/world_api/`) og implementeres i både offline- og
  online-verdenen; et nyt simuleringssystem lander bag `SimContext`; et nyt
  REST-endpoint er et rutemodul, du kan stilladsere med `pnpm run new:endpoint`.
- **Rediger ikke genererede filer i hånden** såsom `*.generated.ts`. Generér dem
  igen gennem build'et.
- **Husstil for tekst: ingen lange tankestreger, korte tankestreger eller
  emojis** nogen steder, hverken i kode, kommentarer, dokumentation,
  commit-beskeder, PR-tekst eller tekst, spillerne ser. Brug kommaer, koloner,
  parenteser eller "til" for intervaller. Et pre-push-tjek scanner din diff og
  blokerer pushet ved et hit.
- **Commit aldrig hemmeligheder** eller en `.env`-fil, og aktivér aldrig
  `ALLOW_DEV_COMMANDS` i en produktionssti, da det låser snyd op.

### Kodestil

Formateringen står [Biome](https://biomejs.dev/) for, konfigureret i
`biome.json`: 2 mellemrums indrykning, linjer på 100 kolonner, enkelte
anførselstegn, afsluttende kommaer. Formatér kun de filer, du har rørt
(`npx @biomejs/biome check --write <your-file.ts>`), og tjek dem med
`pnpm run ci:changed`. CI kontrollerer kun ændrede filer, så lad være med at
omformatere resten af træet: en kørsel på tværs af hele repoet trækker
mangeårig gæld frem, som ikke er din at rette.

## Før du åbner en pull request

Kør repositoriets gate lokalt. Det er den samme kontrakt, som CI håndhæver:

```bash
pnpm run gate
```

Mens du itererer, kan du køre en enkelt suite (`npx vitest run tests/sim.test.ts`)
og `pnpm run ci:changed` for formateringen; `pnpm test` kører det hele, og kortet
over suiterne findes i `tests/CLAUDE.md`. Hele `pnpm run gate` dækker friskheden
af genererede artefakter, malware-scanningen, formateringen af ændrede filer,
konformitetstjekket af lydeffekter, hele testsuiten, en regressionsrunde i en
rigtig browser, det strenge typetjek samt client-, server- og headless-build'ene.
De lagdelte tjek, fra pre-push-gulvet og opefter, er beskrevet i
[`docs/qa-gate.md`](../qa-gate.md).

Test derefter din ændring på både desktop og mobil, herunder en
telefonstørrelse-viewport i både stående og liggende format, hvis den berører
noget, spillerne ser. Berøringsmål bør forblive på mindst 40x40px og
formularinput på mindst 16px skrifttype. UI-standarderne er dokumenteret i
[`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Åbn pull requesten

Push din branch og åbn en PR **mod den samme nyeste `release/vX.Y.Z`-branch, som
du startede fra. Sigt aldrig mod `main`**, som er en integrationsbranch til
release-tid snarere end basis for bidrag. GitHub forudvælger ofte `main` for dig,
så skift basisbranch, før du indsender.
[Pull request-skabelonen](../../.github/PULL_REQUEST_TEMPLATE.md) guider dig
gennem en kort tjekliste. Udfyld den venligst:

- Beskriv **hvad** der blev ændret, og **hvorfor**.
- Link et eventuelt relateret issue (for eksempel "Closes #123").
- Tilføj **skærmbilleder eller et klip for UI-ændringer**, på desktop og mobil.
- Bekræft, at `pnpm run gate` består, og at nye spillervendte strenge følger
  politikken om engelsk først for bidragydere nedenfor.

På din PR kører CI formatering og linting over dine ændrede filer, hele
testsuiten fordelt på fire parallelle shards, en regressionsrunde i browseren
samt typetjekket plus client-, server- og headless-build'ene. Det svarer til det,
`pnpm run gate` kører lokalt, så en grøn gate er en god forudsigelse af en grøn
PR.

En grøn CI-kørsel og en komplet tjekliste er, hvad vi kigger efter, før vi
merger. En maintainer kan foreslå ændringer. Det er en normal, samarbejdende del
af processen, ikke en afvisning. Vi sigter efter at være venlige og
konstruktive i gennemgangen, og vi beder om det samme af dig.

> Commit-beskeder og PR-titler følger [Conventional Commits](https://www.conventionalcommits.org/)
> med et scope (`feat(talents): ...`, `fix(net): ...`). Hver commit bærer også en
> body: efter en tom linje en til fire enkle sætninger, der fortæller, hvad der
> blev ændret og hvorfor, ombrudt omkring 72 kolonner. En titel alene er ikke nok.

<a id="localization"></a>

## Lokalisering

World of ClaudeCraft udgives på mange sprog. Hver spillersynlig streng skal være
en oversættelsesnøgle, mens bidragydere til funktioner normalt kun tilføjer den
engelske kilde.

- Al brugervendt tekst er en `t()`-nøgle. Tilføj ny engelsk tekst til det
  tilsvarende domænemodul under
  [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) (ny HUD-ramme hører til i
  `hud_chrome.ts`), og render den derefter med `t('dotted.key', values)`. Kun
  engelsk er præcis det rigtige for en feature-PR: maintaineren udfylder de
  øvrige lokaliteter ved release, så du redigerer ikke overlayene i
  `src/ui/i18n.locales/`, og du efterlader aldrig en engelsk pladsholder eller en
  `// TODO` i et af dem. M16-undtagelsen er en ny ordrig engelsk værdi, som også
  kræver de fem ikke-latinske udfyldninger, der er beskrevet i
  [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).
- Tal, penge, datoer, enheder og procenter går gennem formaterne
  (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) i stedet for manuel
  strengbygning.
- Spillervendt tekst, der udsendes fra `src/sim/` eller `server/`, som forbliver
  sprogagnostiske, skal lokaliseres igen ved klientgrænsen i samme ændring.
  Guard-testen `npx vitest run tests/localization_fixes.test.ts` håndhæver dette.
- Efter du har tilføjet eller ændret en streng, så kør `pnpm run i18n:gen`, og
  commit de regenererede bundles i samme ændring. Både gaten og CI sammenligner
  de committede artefakter med en frisk regenerering, så en forældet bundle får
  build'et til at fejle.

Så tilføj dine strenge på engelsk, og åbn PR'en; du behøver ikke selv at oversætte
dem. Hvis du gerne vil hjælpe med oversættelser, så se næste afsnit.

<a id="translating-the-game"></a>

## Oversæt spillet

Vil du forbedre et sprog eller hjælpe med at bringe spillet til et nyt? Du behøver
ikke at skrive nogen spilkode for at gøre det:

1. De fleste spillervendte oversættelser bor i overlay-filerne pr. sprog under
   [`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) (en pr. lokalitet), som
   spejler de engelske nøgler i
   [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/). Tekst, der udsendes af
   simuleringen og serveren, oversættes i `src/ui/sim_i18n.ts` og
   `src/ui/server_i18n.ts`, talenttekst i `talent_i18n`-modulerne, og
   admin-dashboardet har sit eget sæt under `src/admin/i18n.locales/`.
2. Forbedr eksisterende oversættelser, eller udfyld dem, der læses akavet.
3. Kør `pnpm run i18n:gen`, commit de regenererede bundles sammen med din
   overlay-ændring, kør derefter lokaliseringssuiterne
   (`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`)
   og åbn en PR. Et typetjek alene fortæller dig ikke, om en nøgle mangler, da
   overlayene bevidst er sparsomme.

For at foreslå en helt ny lokalitet eller for at drøfte tone og terminologi kan
du starte en tråd på [Discord](https://discord.com/invite/worldofclaudecraft), så hjælper vi dig
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
- **Sikkerhedssårbarheder.** Åbn venligst ikke et offentligt issue. Rapportér dem
  privat ved at følge [SECURITY.md](../../SECURITY.md), så arbejder vi sammen med
  dig om en rettelse og om offentliggørelsen.

## Få hjælp

Sidder du fast, eller vil du bare sige hej? Tilslut dig
[fællesskabets Discord](https://discord.com/invite/worldofclaudecraft). Intet spørgsmål er for
lille, og nye bidragydere er altid velkomne.

## Licens

Ved at bidrage med kode accepterer du, at dine kodebidrag licenseres under
projektets [MIT-licens](../../LICENSE), den samme licens, der dækker projektet.

MIT-licensen betyder præcis, hvad den siger: enhver må bruge, ændre og
videredistribuere koden, kommercielt eller ej. Vores
[servicevilkår](https://worldofclaudecraft.com/terms) gælder for det hostede
spil, vi driver på worldofclaudecraft.com (konti, adfærd, virtuelle genstande),
og de begrænser ikke de rettigheder, MIT-licensen giver dig eller andre i denne
kode. Navnene og brandingen "World of ClaudeCraft" og "Levy Street" er ikke
dækket af MIT-licensen.

Originale kreative assets (lydoptagelser, musik, kunst og lignende ophavsretligt
beskyttede værker) er undtagelsen. Hvis du bidrager med et originalt asset, du
selv har skabt, må du i stedet beholde ophavsretten og bidrage med det under en
licens efter eget valg (for eksempel CC BY-NC 4.0), forudsat at:

- licensen, de asset-stier den dækker, og din kreditering er noteret i
  licenstabellen i [CREDITS.md](../../CREDITS.md) som en del af den samme pull
  request, og
- den som minimum indeholder en evigtgyldig, royaltyfri tilladelse til Levy
  Street til at bruge assetsene kommercielt i World of ClaudeCraft, herunder i
  officielle udgivelser og i in-game-butikken.

For assets, der står i tabellen i CREDITS.md, går den noterede licens forud for
projektets MIT-standardlicens.

**Medie-assets uden en post i CREDITS.md er ikke licenseret under MIT.**
Registret er stadig ved at blive gjort færdigt, så en manglende post betyder, at
vilkårene ikke er noteret, ikke at assetet er frit at tage. Det er med vilje: det
forhindrer, at et uregistreret bidrag gives væk som standard. For kode er det
omvendt, og alt, der ikke er undtaget i CREDITS.md, er MIT.

Netop derfor er posten i registret ikke valgfrit papirarbejde. Hvis du bidrager
med et asset uden en række i CREDITS.md, kan ingen længere nede i kæden bruge
det, og vi har ingen registrering af, hvad du har givet os lov til. Udfyld også
kolonnen **Redistribution** ærligt. Det er den, der fortæller nogen, som forker
dette projekt, om de må give dit asset videre, og nogle rækker er markeret med
"No, permission required" netop, fordi det ikke er tilladt.

---

Tak, fordi du bidrager til World of ClaudeCraft. Vi kan ikke vente med at se,
hvad du bygger sammen med os.
