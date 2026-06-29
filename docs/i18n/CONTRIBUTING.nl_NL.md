<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · **Nederlands** · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# Bijdragen aan World of ClaudeCraft

Allereerst bedankt dat je hier bent. World of ClaudeCraft wordt gebouwd door een
gemeenschap van mensen die houden van klassieke MMO's, en elke bijdrage, groot of
klein, maakt het beter. Een typefout verbeteren, het spel vertalen, een bug
melden, een hele nieuwe dungeon bouwen: het telt allemaal mee, en je bent hier
welkom.

Deze gids helpt je op weg en zorgt ervoor dat je eerste bijdrage soepel verloopt.
Je hoeft geen expert te zijn. Als iets onduidelijk is, vraag het dan op
[Discord](https://discord.gg/GjhnUsBtw) en iemand helpt je graag verder.

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

Je hebt [Node.js 22+](https://nodejs.org/) en npm nodig. Voor de multiplayerserver
wil je ook [Docker](https://www.docker.com/) om Postgres te draaien.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Install dependencies
npm ci

# 3. Run the offline client (no server or database needed)
npm run dev          # open the URL it prints (usually http://localhost:5173)
```

Dat is genoeg om de offline wereld te spelen en aan de meeste dingen te werken. Om
de volledige online stack te draaien:

```bash
npm run db:up        # start Postgres 16 in Docker (dev DB on port 5433)
npm run server       # build and run the authoritative game server on :8787
npm run dev          # in another terminal; the client proxies to the server
```

De [README](../../README.md) bevat de volledige host-, ontwikkel- en speelgids, en
de `CLAUDE.md`-bestanden door de hele repo documenteren de conventies voor elk
onderdeel.

## Je wijziging maken

1. **Maak een branch** vanaf `main`: `feature/<short-slug>` of `fix/<short-slug>`.
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
- **Bewerk gegenereerde bestanden niet met de hand**, zoals `*.generated.ts`.
  Genereer ze opnieuw via de build.
- **Commit nooit geheimen** of een `.env`-bestand, en schakel `ALLOW_DEV_COMMANDS`
  nooit in op een productiepad, want dat ontgrendelt cheats.

## Voordat je een pull request opent

Voer deze lokaal uit. Het zijn dezelfde checks die CI uitvoert:

```bash
npm test                    # Vitest suite
npx tsc --noEmit            # TypeScript typecheck (the project is strict)
npm run security:gate       # malicious-code release gate (high-severity signatures; also asserted by npm test)
npm run build               # production client build
```

Als je server- of headless-code hebt gewijzigd, voer dan ook `npm run build:server`
en `npm run build:env` uit.

Test je wijziging vervolgens op zowel desktop als mobiel, inclusief een
telefoon-formaat viewport in portret en landschap, als hij iets raakt dat spelers
zien. Touch-targets moeten minstens 40x40px blijven en formulierinvoer minstens
16px lettergrootte. De UI-standaarden zijn gedocumenteerd in
[`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## De pull request openen

Push je branch en open een PR tegen `main`. De
[pull request-sjabloon](../../.github/PULL_REQUEST_TEMPLATE.md) leidt je door een
korte checklist. Vul die alsjeblieft in:

- Beschrijf **wat** er is gewijzigd en **waarom**.
- Link een gerelateerd issue (bijvoorbeeld "Closes #123").
- Voeg **screenshots of een clip toe voor UI-wijzigingen**, op desktop en mobiel.
- Bevestig dat tests, typecheck en de build slagen, en dat nieuwe strings zijn
  vertaald.

Een groene CI-run en een volledige checklist zijn waar we naar kijken voordat we
mergen. Een maintainer kan wijzigingen voorstellen. Dat is een normaal,
samenwerkend onderdeel van het proces, geen afwijzing. We streven ernaar om
vriendelijk en opbouwend te zijn in een review, en we vragen hetzelfde van jou.

> Commitberichten en PR-titels volgen [Conventional Commits](https://www.conventionalcommits.org/)
> met een scope waar dat past (`feat(talents): ...`, `fix(net): ...`). Het is een
> conventie die we fijn vinden, geen strikte vereiste. Duidelijke, beschrijvende
> berichten zijn belangrijker dan perfecte opmaak.

<a id="localization"></a>

## Lokalisatie

World of ClaudeCraft wordt in veel talen uitgebracht, en dat houden we zo terwijl
het spel groeit. Elke voor spelers zichtbare string wordt vertaald naar elke
ondersteunde locale.

- Alle voor gebruikers zichtbare tekst is een `t()`-sleutel die is gedefinieerd in
  [`src/ui/i18n.ts`](../../src/ui/i18n.ts). Voeg een nieuwe string eerst toe aan de
  `en`-locale en lever vervolgens een echte vertaling in elke andere locale in
  `supportedLanguages`. Geen Engelse placeholders, en geen `// TODO`.
- Getallen, geld, datums, eenheden en percentages gaan via de formatters
  (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) in plaats van handmatig
  strings op te bouwen.
- Voor spelers zichtbare tekst die wordt uitgezonden vanuit `src/sim/` of
  `server/`, die taalonafhankelijk blijven, moet in dezelfde wijziging opnieuw
  worden gelokaliseerd aan de clientgrens. De guard-test
  `npx vitest run tests/localization_fixes.test.ts` dwingt dit af.

Als je wijziging een string toevoegt en je hem maar in sommige talen kunt
schrijven, is dat oké. Open de PR en vraag in de beschrijving om hulp met de rest.
We helpen je veel liever om het af te maken dan dat je je inhoudt.

<a id="translating-the-game"></a>

## De game vertalen

Wil je een taal verbeteren, of helpen het spel naar een nieuwe taal te brengen? Je
hoeft daarvoor geen gamecode te schrijven:

1. Open [`src/ui/i18n.ts`](../../src/ui/i18n.ts) en zoek de locale waaraan je wilt
   werken. Elk locale-object bevat dezelfde sleutels als `en`.
2. Verbeter bestaande vertalingen, of vul de vertalingen aan die onhandig lezen.
3. Voer `npx tsc --noEmit` uit om te bevestigen dat er niets ontbreekt, en open
   dan een PR.

Om een gloednieuwe locale voor te stellen, of om over toon en terminologie te
overleggen, start een thread op [Discord](https://discord.gg/GjhnUsBtw) en we
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

## Hulp krijgen

Loop je vast, of wil je gewoon even hallo zeggen? Sluit je aan bij de
[community-Discord](https://discord.gg/GjhnUsBtw). Geen vraag is te klein, en
nieuwe bijdragers zijn altijd welkom.

## Licentie

Door bij te dragen, ga je ermee akkoord dat je bijdragen worden gelicentieerd
onder de [MIT-licentie](../../LICENSE) van het project, dezelfde licentie die het
project dekt.

---

Bedankt dat je bijdraagt aan World of ClaudeCraft. We kunnen niet wachten om te
zien wat je samen met ons bouwt.
