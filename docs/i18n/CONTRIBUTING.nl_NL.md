<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Čeština](CONTRIBUTING.cs_CZ.md) · **Nederlands** · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# Bijdragen aan World of ClaudeCraft

Allereerst bedankt dat je hier bent. World of ClaudeCraft wordt gebouwd door een
gemeenschap van mensen die houden van klassieke MMO's, en elke bijdrage, groot of
klein, maakt het beter. Een typefout verbeteren, het spel vertalen, een bug
melden, een hele nieuwe dungeon bouwen: het telt allemaal mee, en je bent hier
welkom.

Deze gids helpt je op weg en zorgt ervoor dat je eerste bijdrage soepel verloopt.
Je hoeft geen expert te zijn. Als iets onduidelijk is, vraag het dan op
[Discord](https://discord.com/invite/worldofclaudecraft) en iemand helpt je graag verder.

Door deel te nemen, ga je akkoord met onze [Gedragscode](../../CODE_OF_CONDUCT.md).

## Manieren om bij te dragen

Er is hier voor iedereen een plek:

- **Code.** Los een bug op, voeg een functie toe of verbeter de prestaties.
  Issues met het label
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  en [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  zijn goede plekken om te beginnen.
- **Vertalingen.** Help spelers over de hele wereld door een taal te verbeteren of
  te voltooien. Zie [De game vertalen](#translating-the-game) hieronder. Dit is een
  van de gemakkelijkste en meest impactvolle manieren om te beginnen.
- **Bugmeldingen en ideeën voor functies.** Open een [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose).
  Een duidelijke bugmelding is een echte bijdrage.
- **Documentatie.** Gidsen zoals deze, de README en de ontwerpdocumenten in
  `docs/` kunnen altijd beter.
- **Playtesten en feedback.** Speel het spel, vertel ons wat niet goed voelt en
  deel ideeën op Discord.

## Aan de slag

Je hebt [Node.js 26](https://nodejs.org/) en npm nodig, de versies die CI en de
productie-image gebruiken. Oudere majors zijn niet getest. Voor de
multiplayerserver wil je ook [Docker](https://www.docker.com/) om Postgres te
draaien.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Install dependencies
npm ci

# 3. Point git at the repository hooks (once per clone)
git config core.hooksPath .githooks

# 4. Run the offline client (no server or database needed)
npm run dev          # open the URL it prints (usually http://localhost:5173)
```

Dat is genoeg om de offline wereld te spelen en aan de meeste dingen te werken. Om
de volledige online stack te draaien heb je eerst een databasewachtwoord in je
omgeving nodig:

```bash
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # start Postgres 16 in Docker (dev DB on port 5433)
npm run server       # build and run the authoritative game server on :8787
npm run dev          # in another terminal; the client proxies to the server
```

Als je van plan bent de volledige gate hieronder te draaien, installeer dan
eenmalig de browser die hij aanstuurt: `npx playwright install chromium`.

De [README](../../README.md) bevat de volledige host-, ontwikkel- en speelgids, en
de `CLAUDE.md`-bestanden door de hele repo documenteren de conventies voor elk
onderdeel.

### TypeScript-toolchain

De typecontrole draait op TypeScript 7, de native compiler: `npx tsc --noEmit`
werkt precies zoals voorheen en een volledige repocontrole duurt nu een paar
seconden in plaats van tientallen seconden. De installatie is de officiële dubbele
alias: het `typescript`-pakket resolveert de JS-API van TypeScript 6 (via de
`@typescript/typescript6`-wrapper) omdat `svelte-check` die API nog steeds
gebruikt, terwijl `@typescript/native` het `tsc`-binary levert. Dingen om te weten:

- **Editors.** VS Code heeft de marketplace-extensie "TypeScript 7"
  (`TypeScriptTeam.native-preview`) nodig voor ondersteuning van de native
  language service totdat de ingebouwde ondersteuning uitkomt; hij wordt
  omgeschakeld via de instelling `js/ts.experimental.useTsgo`, en het commando
  "Disable TypeScript 7 Language Server" is de gesanctioneerde terugval naar de
  tsserver van TypeScript 6. JetBrains-IDE's detecteren de native server alleen
  automatisch onder de pakketnaam `@typescript/native-preview`, dus ze pikken hem
  niet op uit de `@typescript/native`-alias van deze repo; hun meegeleverde
  TypeScript 6-ondersteuning werkt prima.
- **Nuttige tsc-vlaggen.** `--checkers N` stelt het aantal parallelle
  typecontrole-workers in (standaard 4; de resultaten zijn bij elk aantal
  identiek): verlaag het om het geheugen op een beperkte runner af te toppen,
  verhoog het op een machine met veel cores, en meet in beide gevallen, want meer
  is niet altijd sneller. `--singleThreaded` schakelt alle parallellisme uit. Een
  enkel bestand ad hoc controleren (`npx tsc somefile.ts`) geeft een fout wanneer
  de map een `tsconfig.json` bevat; geef `--ignoreConfig` mee voor het oude gedrag.
- **Lockfile.** Genereer `package-lock.json` alleen opnieuw met
  `npx npm@10 install --package-lock-only`: het bestand gebruikt npm-10-semantiek,
  en nieuwere npm-majors (inclusief de npm 11 die de Node 26 van CI meelevert)
  laten stilzwijgend de geneste optional-peer-entries van `svelte-check` vallen,
  wat `npm ci` in CI uit sync brengt. Een gewone `npm ci` is veilig onder elke
  npm-major. Bevestig na het opnieuw genereren dat `npm ci --dry-run` in sync is
  onder zowel npm 10 als de npm van je werkstation.
- **Wanneer dit te herzien.** Breng de dubbele alias terug naar één enkele
  `typescript`-dependency zodra BEIDE gelden: de stabiele JS-API van TypeScript
  7.1 is uitgebracht (TypeScript 7.0 levert helemaal geen JS-API; de vervanging
  wordt gevolgd in issue 2824 van microsoft/typescript-go), en issue 3063 van
  sveltejs/language-tools is gesloten met een uitgebrachte `svelte-check` die hem
  overneemt. De experimentele `--tsgo`-modi van svelte-check heffen de vereiste
  van de TypeScript 6-API niet op, en het lopende laden van TypeScript 7 (PR 3073
  van language-tools) leest de `@typescript/native`-alias die deze repo al
  gebruikt, dus een hernoeming is niet nodig.

## Je wijziging maken

1. **Begin bij de nieuwste release-branch, en nooit bij `main`.** Actief werk wordt
   geïntegreerd op een `release/vX.Y.Z`-branch; `main` loopt daarachteraan en is
   niet de basis voor bijdragen. Zoek de nieuwste op en maak daarvan je branch:

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # the newest release branch
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   Voer die zoekopdracht altijd uit in plaats van een versienummer uit deze gids te
   kopiëren: release-branches wisselen vaak, en de nieuwste schuift met elke release
   mee. Branches heten `feature/<short-slug>` of `fix/<short-slug>`.
2. **Maak gerichte commits.** Kleinere, op zichzelf staande wijzigingen zijn
   gemakkelijker te reviewen en te mergen dan grote.
3. **Voeg tests toe of werk ze bij** voor elk gedrag dat je wijzigt in `src/sim/`
   of `server/`.
4. **Houd voor spelers zichtbare tekst vertaalbaar.** Zie [Lokalisatie](#localization)
   en [De game vertalen](#translating-the-game).

### Dingen om in gedachten te houden

Dit zijn de dragende regels van de codebase. De volledige details staan in de
root [`CLAUDE.md`](../../CLAUDE.md), maar de korte versie:

- **De simulatiekern (`src/sim/`) is de bron van waarheid**, en hij blijft puur,
  zonder DOM-, browser- of Three.js-imports, zodat exact dezelfde code offline, op
  de server en in de headless RL-omgeving draait.
- **De simulatie is deterministisch.** Hij draait op een vaste 20 Hz-tick, en alle
  willekeur gaat via `Rng`, nooit `Math.random`, `Date.now` of `performance.now`
  in sim-logica. Dezelfde seed levert altijd dezelfde wereld op.
- **De gameplaywiskunde volgt MMO-formules uit het klassieke tijdperk** (rage,
  hit-tabellen, armor, XP-curves). Verzin alsjeblieft geen balansgetallen. Citeer
  in plaats daarvan de formule.
- **Nieuwe logica landt als een eigen kleine, geteste module achter een bestaande
  naad**, in plaats van te worden aangeplakt aan een van de grote
  coördinatorbestanden. Data die de renderer of de HUD leest, gaat over de
  `IWorld`-interface (`src/world_api/`) en wordt in zowel de offline als de online
  wereld geïmplementeerd; een nieuw simulatiesysteem gaat achter `SimContext`; een
  nieuw REST-endpoint is een route-module die je kunt opzetten met
  `npm run new:endpoint`.
- **Bewerk gegenereerde bestanden niet met de hand**, zoals `*.generated.ts`.
  Genereer ze opnieuw via de build.
- **Huisstijl voor tekst: geen kastlijntjes, gedachtestreepjes of emoji's** waar
  dan ook, niet in code, commentaar, documentatie, commitberichten, PR-tekst of
  tekst voor spelers. Gebruik komma's, dubbele punten, haakjes of "tot" voor
  bereiken. Een pre-push-controle scant je diff en blokkeert de push bij een
  treffer.
- **Commit nooit geheimen** of een `.env`-bestand, en schakel `ALLOW_DEV_COMMANDS`
  nooit in op een productiepad, want dat ontgrendelt cheats.

### Codestijl

De opmaak wordt verzorgd door [Biome](https://biomejs.dev/), geconfigureerd in
`biome.json`: 2 spaties inspringen, regels van 100 kolommen, enkele aanhalingstekens,
trailing komma's. Formatteer alleen de bestanden die je hebt aangeraakt
(`npx @biomejs/biome check --write <your-file.ts>`) en controleer ze met
`npm run ci:changed`. CI toetst alleen gewijzigde bestanden, dus formatteer
alsjeblieft niet de rest van de boom: een repo-brede run brengt langbestaande
schuld naar boven die niet aan jou is om op te lossen.

## Voordat je een pull request opent

Voer de gate van de repository lokaal uit. Het is hetzelfde contract dat CI
afdwingt:

```bash
npm run gate
```

Tijdens het itereren draai je één suite (`npx vitest run tests/sim.test.ts`) en
`npm run ci:changed` voor de opmaak; `npm test` draait alles, en de suitekaart
staat in `tests/CLAUDE.md`. De volledige `npm run gate` dekt de actualiteit van
gegenereerde artefacten, de malwarescan, de opmaak van gewijzigde bestanden, de
conformiteitscontrole van geluidseffecten, de hele testsuite, een regressieronde
in een echte browser, de strikte typecheck en de client-, server- en
headless-builds. De gelaagde controles, vanaf de pre-push-ondergrens omhoog, staan
beschreven in [`docs/qa-gate.md`](../qa-gate.md).

Test je wijziging vervolgens op zowel desktop als mobiel, inclusief een
telefoon-formaat viewport in portret en landschap, als hij iets raakt dat spelers
zien. Touch-targets moeten minstens 40x40px blijven en formulierinvoer minstens
16px lettergrootte. De UI-standaarden zijn gedocumenteerd in
[`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## De pull request openen

Push je branch en open een PR **die dezelfde nieuwste `release/vX.Y.Z`-branch als
doel heeft waarvan je bent uitgegaan. Richt nooit op `main`**, want dat is een
integratiebranch voor releasetijd en niet de basis voor bijdragen. GitHub
preselecteert vaak `main` voor je, dus wijzig de basisbranch voordat je hem
indient. Het [pull request-sjabloon](../../.github/PULL_REQUEST_TEMPLATE.md) leidt
je door een korte checklist. Vul die alsjeblieft in:

- Beschrijf **wat** er is gewijzigd en **waarom**.
- Link een gerelateerd issue (bijvoorbeeld "Closes #123").
- Voeg **screenshots of een clip toe voor UI-wijzigingen**, op desktop en mobiel.
- Bevestig dat `npm run gate` slaagt en dat nieuwe strings voor spelers het
  Engels-eerst-beleid voor bijdragers hieronder volgen.

Op je PR draait CI opmaak en linting over je gewijzigde bestanden, de volledige
testsuite over vier parallelle shards, een regressieronde in de browser, en de
typecheck plus de client-, server- en headless-builds. Dat komt overeen met wat
`npm run gate` lokaal draait, dus een groene gate is een goede voorspeller van een
groene PR.

Een groene CI-run en een volledige checklist zijn waar we naar kijken voordat we
mergen. Een maintainer kan wijzigingen voorstellen. Dat is een normaal,
samenwerkend onderdeel van het proces, geen afwijzing. We streven ernaar om
vriendelijk en opbouwend te zijn in een review, en we vragen hetzelfde van jou.

> Commitberichten en PR-titels volgen [Conventional Commits](https://www.conventionalcommits.org/)
> met een scope (`feat(talents): ...`, `fix(net): ...`). Elke commit draagt ook een
> body: na een lege regel één tot vier eenvoudige zinnen die zeggen wat er is
> gewijzigd en waarom, afgebroken rond 72 kolommen. Een titel alleen is niet genoeg.

<a id="localization"></a>

## Lokalisatie

World of ClaudeCraft wordt in veel talen uitgebracht. Elke voor spelers zichtbare
string moet een vertaalsleutel zijn, terwijl bijdragers van functies normaal
gesproken alleen de Engelse bron toevoegen.

- Alle voor gebruikers zichtbare tekst is een `t()`-sleutel. Voeg nieuwe Engelse
  tekst toe aan de bijbehorende module per domein onder
  [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) (nieuwe HUD-omlijsting gaat
  in `hud_chrome.ts`) en render hem vervolgens met `t('dotted.key', values)`.
  Alleen Engels is precies goed voor een feature-PR: de maintainer vult de andere
  locales bij de release, dus je bewerkt de overlays in `src/ui/i18n.locales/` niet
  en je laat daar nooit een Engelse placeholder of een `// TODO` achter. De
  M16-uitzondering is een nieuwe woordrijke Engelse waarde, die ook de vijf
  niet-Latijnse invullingen nodig heeft die beschreven staan in
  [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).
- Getallen, geld, datums, eenheden en percentages gaan via de formatters
  (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) in plaats van handmatig
  strings op te bouwen.
- Voor spelers zichtbare tekst die wordt uitgezonden vanuit `src/sim/` of
  `server/`, die taalonafhankelijk blijven, moet in dezelfde wijziging opnieuw
  worden gelokaliseerd aan de clientgrens. De guard-test
  `npx vitest run tests/localization_fixes.test.ts` dwingt dit af.
- Voer na het toevoegen of wijzigen van een string `npm run i18n:gen` uit en commit
  de opnieuw gegenereerde bundles in dezelfde wijziging. De gate en CI vergelijken
  beide de gecommitte artefacten met een verse hergeneratie, dus een verouderde
  bundle laat de build falen.

Voeg je strings dus in het Engels toe en open de PR; je hoeft ze niet zelf te
vertalen. Als je wilt helpen met vertalingen, zie dan de volgende sectie.

<a id="translating-the-game"></a>

## De game vertalen

Wil je een taal verbeteren, of helpen het spel naar een nieuwe taal te brengen? Je
hoeft daarvoor geen gamecode te schrijven:

1. De meeste vertalingen voor spelers staan in de overlaybestanden per taal onder
   [`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) (één per locale), die de
   Engelse sleutels in
   [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) spiegelen. Tekst die de
   simulatie en de server uitzenden, wordt vertaald in `src/ui/sim_i18n.ts` en
   `src/ui/server_i18n.ts`, talenttekst in de `talent_i18n`-modules, en het
   admin-dashboard heeft zijn eigen set onder `src/admin/i18n.locales/`.
2. Verbeter bestaande vertalingen, of vul de vertalingen aan die onhandig lezen.
3. Voer `npm run i18n:gen` uit, commit de opnieuw gegenereerde bundles samen met je
   overlaywijziging, draai daarna de lokalisatiesuites
   (`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`)
   en open een PR. Een typecontrole alleen vertelt je niet of een sleutel ontbreekt,
   omdat de overlays bewust dun zijn.

Om een gloednieuwe locale voor te stellen, of om over toon en terminologie te
overleggen, start een thread op [Discord](https://discord.com/invite/worldofclaudecraft) en we
helpen je hem aan te sluiten. Moedertaalsprekers en vloeiende sprekers zijn
bijzonder welkom. Goede vertalingen laten het spel voor spelers overal als thuis
voelen.

## Bugs melden en functies aanvragen

Gebruik alsjeblieft de [issue-sjablonen](https://github.com/levy-street/world-of-claudecraft/issues/new/choose):

- **Bugmelding.** Doorzoek eerst [bestaande issues](https://github.com/levy-street/world-of-claudecraft/issues)
  om duplicaten te voorkomen, en vermeld dan de stappen om het te reproduceren, wat
  je verwachtte, wat er gebeurde en je omgeving (offline of online, browser,
  desktop of mobiel).
- **Functieverzoek.** Beschrijf het probleem dat je probeert op te lossen, niet
  alleen de oplossing. Context helpt ons het juiste te ontwerpen.
- **Beveiligingskwetsbaarheden.** Open hiervoor alsjeblieft geen openbaar issue.
  Meld ze privé door [SECURITY.md](../../SECURITY.md) te volgen, dan werken we met
  je samen aan een oplossing en aan de openbaarmaking.

## Hulp krijgen

Loop je vast, of wil je gewoon even hallo zeggen? Sluit je aan bij de
[community-Discord](https://discord.com/invite/worldofclaudecraft). Geen vraag is te klein, en
nieuwe bijdragers zijn altijd welkom.

## Licentie

Door code bij te dragen, ga je ermee akkoord dat je codebijdragen worden
gelicentieerd onder de [MIT-licentie](../../LICENSE) van het project, dezelfde
licentie die het project dekt.

De MIT-licentie bedoelt wat ze zegt: iedereen mag de code gebruiken, aanpassen en
herdistribueren, commercieel of niet. Onze
[Servicevoorwaarden](https://worldofclaudecraft.com/terms) gelden voor het gehoste
spel dat we draaien op worldofclaudecraft.com (accounts, gedrag, virtuele items)
en beperken niet de rechten die de MIT-licentie jou of wie dan ook op deze code
geeft. De namen en de merkuitstraling "World of ClaudeCraft" en "Levy Street"
vallen niet onder de MIT-licentie.

Originele creatieve assets (geluidsopnamen, muziek, kunst en vergelijkbare
auteursrechtelijke werken) zijn de uitzondering. Als je een originele asset
bijdraagt die je zelf hebt gemaakt, mag je in plaats daarvan het auteursrecht
behouden en hem bijdragen onder een licentie naar keuze (bijvoorbeeld CC BY-NC
4.0), mits:

- de licentie, de assetpaden die zij dekt en jouw naamsvermelding worden
  vastgelegd in de licentietabel in [CREDITS.md](../../CREDITS.md) als onderdeel
  van dezelfde pull request, en
- zij minstens een eeuwigdurende, royaltyvrije toestemming aan Levy Street bevat
  om de assets commercieel te gebruiken in World of ClaudeCraft, inclusief
  officiële releases en de in-game store.

Voor assets die in de tabel in CREDITS.md staan, gaat die vastgelegde licentie
voor op de standaard MIT-licentie van het project.

**Media-assets zonder vermelding in CREDITS.md vallen niet onder MIT.** Het
register wordt nog aangevuld, dus een ontbrekende vermelding betekent dat de
voorwaarden niet zijn vastgelegd, niet dat de asset vrij te nemen is. Dat is
bewust zo: het voorkomt dat een niet-geregistreerde bijdrage standaard wordt
weggegeven. Voor code geldt het omgekeerde, en alles wat niet is uitgezonderd in
CREDITS.md is MIT.

Precies daarom is de vermelding in het register geen optioneel papierwerk. Als je
een asset bijdraagt zonder een regel in CREDITS.md, kan niemand verderop hem
gebruiken en hebben we geen enkele vastlegging van wat je ons hebt verleend. Vul
ook de kolom **Redistribution** eerlijk in. Die vertelt iemand die dit project
forkt of hij jouw asset mag doorgeven, en sommige regels zijn gemarkeerd met
"No, permission required" juist omdat dat niet mag.

---

Bedankt dat je bijdraagt aan World of ClaudeCraft. We kunnen niet wachten om te
zien wat je samen met ons bouwt.
