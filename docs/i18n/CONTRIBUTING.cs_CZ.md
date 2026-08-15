<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · **Čeština** · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# Přispívání do World of ClaudeCraft

Především děkujeme, že jsi tady. World of ClaudeCraft staví komunita lidí, kteří
milují klasická MMO, a každý příspěvek, velký i malý, ho dělá lepším. Oprava
překlepu, překlad hry, hlášení chyby, stavba úplně nového dungeonu: všechno se
počítá a jsi tu vítán.

Tenhle průvodce ti pomůže s nastavením a udělá tvůj první příspěvek hladkým.
Nemusíš být expert. Pokud je něco nejasné, zeptej se na
[Discordu](https://discord.com/invite/worldofclaudecraft) a někdo ti rád pomůže.

Účastí souhlasíš s dodržováním našeho [Kodexu chování](../../CODE_OF_CONDUCT.md).

## Jak můžeš přispět

Místo tu má každý:

- **Kód.** Oprav chybu, přidej funkci nebo zlepši výkon. Issues se štítky
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  a [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  jsou dobrý začátek.
- **Překlady.** Pomoz hráčům po celém světě tím, že vylepšíš nebo doplníš nějaký
  jazyk. Níže viz [Překlad hry](#translating-the-game). Je to jeden z nejjednodušších
  a nejužitečnějších způsobů, jak začít.
- **Hlášení chyb a nápady na funkce.** Otevři [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose).
  Jasné hlášení chyby je opravdový příspěvek.
- **Dokumentace.** Průvodci jako tenhle, README a designové dokumenty v `docs/` se
  dají vždycky vylepšit.
- **Testování hry a zpětná vazba.** Hraj, řekni nám, co ti nesedí, a sdílej nápady
  na Discordu.

## Než začneš

Budeš potřebovat [Node.js 26](https://nodejs.org/) a **pnpm 10.34.x** (přesný pin je v `package.json` u `packageManager`, dnes `pnpm@10.34.5`). Starší hlavní verze Node nejsou otestované. Pro víceuživatelský server se ti navíc bude hodit [Docker](https://www.docker.com/), aby ses rozběhl Postgres.

**Corepack není povinný.** pnpm nainstaluj jednou přes npm, které je součástí Node. Stejný postup platí na macOS, Linuxu i Windows.

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

`npm run <script>` po instalaci přes pnpm stále funguje (Node dodává npm), ale **instalace a aktualizace lockfile musí jít přes pnpm**. Do repozitáře necommituj `package-lock.json`; jediný zdroj pravdy je `pnpm-lock.yaml`.

To stačí na hraní offline světa a na většinu práce. Pro rozběhnutí kompletního
online stacku potřebuješ nejdřív v prostředí heslo k databázi:

```bash
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
pnpm run db:up       # start Postgres 16 in Docker (dev DB on port 5433)
pnpm run server      # build and run the authoritative game server on :8787
pnpm run dev         # in another terminal; the client proxies to the server
```

Pokud plánuješ spouštět kompletní gate popsaný níže, nainstaluj si jednou
prohlížeč, který řídí: `pnpm exec playwright install chromium`.

[README](README.cs_CZ.md) obsahuje kompletního průvodce hostingem, vývojem a hraním
a soubory `CLAUDE.md` po celém repozitáři dokumentují konvence pro každou oblast.

### Nástrojový řetězec TypeScriptu

Kontrola typů běží na TypeScriptu 7, nativním kompilátoru: `npx tsc --noEmit`
funguje přesně jako dřív a kompletní kontrola repozitáře teď zabere pár sekund
místo desítek sekund. Instalace používá oficiální dvojitý alias: balíček
`typescript` se rozřeší na JS API TypeScriptu 6 (přes wrapper
`@typescript/typescript6`), protože `svelte-check` toto API pořád využívá, zatímco
`@typescript/native` dodává binárku `tsc`. Co je dobré vědět:

- **Editory.** VS Code potřebuje rozšíření "TypeScript 7" z marketplace
  (`TypeScriptTeam.native-preview`) pro podporu nativní jazykové služby, dokud
  nedorazí vestavěná podpora; přepíná se nastavením `js/ts.experimental.useTsgo` a
  jeho příkaz "Disable TypeScript 7 Language Server" je posvěcený návrat k tsserveru
  z TypeScriptu 6. IDE od JetBrains detekují nativní server automaticky jen pod
  názvem balíčku `@typescript/native-preview`, takže ho z aliasu
  `@typescript/native` v tomto repozitáři nepřevezmou; jejich přibalená podpora
  TypeScriptu 6 funguje dobře.
- **Užitečné přepínače tsc.** `--checkers N` nastavuje počet paralelních workerů
  kontroly typů (výchozí 4; výsledky jsou při libovolném počtu identické): sniž ho,
  abys omezil paměť na runneru s malými zdroji, zvyš ho na stroji s mnoha jádry a
  v obou případech měř, protože víc není vždycky rychleji. `--singleThreaded` vypíná
  veškerou paralelizaci. Kontrola jednoho souboru na přeskáčku (`npx tsc somefile.ts`)
  skončí chybou, když adresář obsahuje `tsconfig.json`; původní chování vrátíš
  přepínačem `--ignoreConfig`.
- **Lockfile.** Lockfile je `pnpm-lock.yaml` (pnpm 10 / lockfileVersion 9). Aktualizuj ho jen příkazy `pnpm install`, `pnpm add` nebo `pnpm update` z kořene tohoto repozitáře (nikdy neručně). Commitni `pnpm-lock.yaml` společně se změnami v `package.json`. CI instaluje přes `pnpm install --frozen-lockfile`; zastaralý lockfile selže. Nezaváděj druhý lockfile (`package-lock.json` / yarn.lock): dual lockfiles se tiše rozcházejí a jsou zakázané. Šum z peer závislostí volitelných wallet/solana stromů se toleruje přes `.npmrc` (`strict-peer-dependencies=false`); dál to neuvolňuj bez měření.
- **Kdy se k tomu vrátit.** Dvojitý alias slouč zpátky na jedinou závislost
  `typescript` teprve tehdy, až budou platit OBĚ podmínky: vyjde stabilní JS API
  TypeScriptu 7.1 (TypeScript 7.0 nedodává žádné JS API; náhrada se sleduje v issue
  2824 v microsoft/typescript-go) a issue 3063 v sveltejs/language-tools se uzavře
  vydaným `svelte-check`, který ho přijme. Experimentální režimy `--tsgo` ve
  svelte-check jeho závislost na API TypeScriptu 6 neruší a jeho rozpracované načítání
  TypeScriptu 7 (PR 3073 v language-tools) čte alias `@typescript/native`, který tento
  repozitář už používá, takže žádné přejmenování není potřeba.

## Jak provést svou změnu

1. **Vycházej z nejnovější release větve, nikdy z `main`.** Aktivní práce se
   integruje na větvi `release/vX.Y.Z`; `main` za ní zaostává a není základem pro
   příspěvky. Najdi tu nejnovější a odděl se z ní:

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # the newest release branch
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   Vždycky si to vyhledání spusť, místo abys opisoval číslo verze z této příručky:
   release větve se střídají často a ta nejnovější se s každým vydáním posouvá.
   Větve se jmenují `feature/<short-slug>` nebo `fix/<short-slug>`.
2. **Dělej soustředěné commity.** Menší, samostatné změny se posuzují a slučují
   snáz než velké.
3. **Přidej nebo aktualizuj testy** ke každému chování, které měníš v `src/sim/`
   nebo `server/`.
4. **Drž text viditelný pro hráče přeložitelný.** Viz [Lokalizace](#localization)
   a [Překlad hry](#translating-the-game).

### Na co myslet

Tohle jsou nosné pravidla kódové základny. Kompletní podrobnosti žijí v kořenovém
[`CLAUDE.md`](../../CLAUDE.md), ale krátká verze zní:

- **Jádro simulace (`src/sim/`) je zdroj pravdy** a zůstává čisté, bez importů DOM,
  prohlížeče nebo Three.js, takže přesně tentýž kód běží offline, na serveru i
  v headless RL prostředí.
- **Simulace je deterministická.** Běží na pevném ticku 20 Hz a veškerá náhoda
  protéká přes `Rng`, nikdy přes `Math.random`, `Date.now` nebo `performance.now`
  v logice simu. Stejný seed vždycky vytvoří stejný svět.
- **Herní matematika sleduje vzorce MMO klasické éry** (vztek, tabulky zásahů,
  zbroj, XP křivky). Prosím nevymýšlej balanční čísla. Místo toho vzorec odcituj.
- **Nová logika přistává jako vlastní malý otestovaný modul za existující spárou**,
  místo aby se přilepila k některému z velkých koordinačních souborů. Data, která
  čte renderer nebo HUD, procházejí rozhraním `IWorld` (`src/world_api/`) a
  implementují se v obou světech, offline i online; nový systém simulace jde za
  `SimContext`; nový REST endpoint je modul routy, jehož kostru vygeneruješ pomocí
  `pnpm run new:endpoint`.
- **Needituj ručně generované soubory** jako `*.generated.ts`. Regeneruj je přes
  build.
- **Domácí styl textu: nikde žádné dlouhé ani střední pomlčky a žádná emoji**, ani
  v kódu, komentářích, dokumentaci, commit zprávách, textech PR nebo v textech pro
  hráče. Používej čárky, dvojtečky, závorky nebo "až" pro rozsahy. Kontrola před
  pushem projde tvůj diff a při nálezu push zablokuje.
- **Nikdy necommituj tajemství** ani soubor `.env` a nikdy nezapínej
  `ALLOW_DEV_COMMANDS` v produkční cestě, protože to odemyká cheaty.

### Styl kódu

Formátování zajišťuje [Biome](https://biomejs.dev/), nastavený v `biome.json`:
odsazení 2 mezery, řádky na 100 sloupců, jednoduché uvozovky, koncové čárky.
Formátuj jen soubory, kterých ses dotkl (`npx @biomejs/biome check --write <your-file.ts>`),
a zkontroluj je pomocí `pnpm run ci:changed`. CI hlídá jen změněné soubory, takže
prosím nepřeformátovávej zbytek stromu: běh přes celý repozitář vynese dlouho
existující dluh, který není na tobě, abys ho opravoval.

## Než otevřeš pull request

Spusť si gate repozitáře lokálně. Je to tentýž kontrakt, jaký vynucuje CI:

```bash
pnpm run gate
```

Při iterování spouštěj jednu sadu (`npx vitest run tests/sim.test.ts`) a
`pnpm run ci:changed` na formátování; `pnpm test` spustí všechno a mapa sad je
v `tests/CLAUDE.md`. Kompletní `pnpm run gate` pokrývá čerstvost generovaných
artefaktů, sken na malware, formátování změněných souborů, kontrolu konformity
zvukových efektů, celou testovací sadu, regresní průchod ve skutečném prohlížeči,
striktní kontrolu typů a buildy klienta, serveru i headless verze. Vrstvené
kontroly, od spodní vrstvy před pushem výš, popisuje
[`docs/qa-gate.md`](../qa-gate.md).

Potom svou změnu otestuj na desktopu i na mobilu, včetně viewportu velikosti
telefonu na výšku i na šířku, pokud se dotýká čehokoli, co hráči vidí. Dotykové
cíle by měly zůstat aspoň 40x40px a formulářové vstupy aspoň na 16px písma.
Standardy rozhraní jsou zdokumentované v [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Otevření pull requestu

Pushni svou větev a otevři PR **mířící na tutéž nejnovější větev `release/vX.Y.Z`,
ze které jsi vyšel. Nikdy nemiř na `main`**, což je integrační větev pro dobu
vydání, ne základ pro příspěvky. GitHub ti často předvybere `main`, takže před
odesláním základovou větev změň.
[Šablona pull requestu](../../.github/PULL_REQUEST_TEMPLATE.md) tě provede krátkým
kontrolním seznamem. Prosím vyplň ho:

- Popiš, **co** se změnilo a **proč**.
- Odkaž na související issue (například "Closes #123").
- Přidej **screenshoty nebo krátké video u změn rozhraní**, na desktopu i na mobilu.
- Potvrď, že `pnpm run gate` prochází a že nové řetězce pro hráče dodržují níže
  popsanou politiku "nejdřív angličtina" pro přispěvatele.

Na tvém PR spustí CI formátování a linting nad tvými změněnými soubory, kompletní
testovací sadu rozloženou do čtyř paralelních shardů, regresní průchod prohlížečem
a kontrolu typů plus buildy klienta, serveru i headless verze. To odpovídá tomu, co
lokálně spouští `pnpm run gate`, takže zelený gate dobře předpovídá zelený PR.

Zelený běh CI a kompletní kontrolní seznam jsou to, na co se před sloučením díváme.
Správce může navrhnout změny. To je normální, kolegiální součást procesu, ne
odmítnutí. Snažíme se být v review laskaví a konstruktivní a totéž prosíme od tebe.

> Commit zprávy a názvy PR se řídí [Conventional Commits](https://www.conventionalcommits.org/)
> se scopem (`feat(talents): ...`, `fix(net): ...`). Každý commit navíc nese tělo:
> po prázdném řádku jedna až čtyři prosté věty, které říkají, co se změnilo a proč,
> zalomené kolem 72 sloupců. Samotný název nestačí.

<a id="localization"></a>

## Lokalizace

World of ClaudeCraft vychází v mnoha jazycích. Každý řetězec viditelný pro hráče
musí být překladový klíč, přičemž přispěvatelé funkcí obvykle přidávají jen
anglický zdroj.

- Veškerý text viditelný pro uživatele je klíč `t()`. Nový anglický text přidej do
  odpovídajícího doménového modulu pod
  [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) (nové prvky výbavy HUD patří
  do `hud_chrome.ts`) a pak ho vykresli přes `t('dotted.key', values)`. Jen
  angličtina je u PR s novou funkcí přesně správně: ostatní jazyky doplní správce
  před vydáním, takže neupravuješ overlaye v `src/ui/i18n.locales/` a nikdy v nich
  nenecháváš anglický zástupný text ani `// TODO`. Výjimka M16 se týká nové upovídané
  anglické hodnoty, která potřebuje i pět nelatinkových doplnění popsaných
  v [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).
- Čísla, peníze, data, jednotky a procenta procházejí formátovači (`formatNumber`,
  `formatMoney`, `formatDateTime`, `Intl`), ne ručním skládáním řetězců.
- Text pro hráče vycházející z `src/sim/` nebo `server/`, které zůstávají jazykově
  neutrální, se musí ve stejné změně znovu lokalizovat na hranici klienta. Vynucuje
  to ochranný test `npx vitest run tests/localization_fixes.test.ts`.
- Po přidání nebo změně jakéhokoli řetězce spusť `pnpm run i18n:gen` a regenerované
  bundly commitni ve stejné změně. Gate i CI porovnávají commitnuté artefakty
  s čerstvou regenerací, takže zastaralý bundle build shodí.

Takže přidej své řetězce v angličtině a otevři PR; překládat je sám nemusíš. Pokud
chceš pomoct s překlady, přečti si další sekci.

<a id="translating-the-game"></a>

## Překlad hry

Chceš vylepšit nějaký jazyk nebo pomoct dostat hru do nového? Nemusíš k tomu psát
žádný herní kód:

1. Většina překladů pro hráče žije v overlay souborech podle jazyka pod
   [`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) (jeden na jazyk), které
   zrcadlí anglické klíče v [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/).
   Text vycházející ze simulace a ze serveru se překládá v `src/ui/sim_i18n.ts` a
   `src/ui/server_i18n.ts`, texty talentů v modulech `talent_i18n` a administrátorský
   dashboard má vlastní sadu pod `src/admin/i18n.locales/`.
2. Vylepši stávající překlady nebo doplň ty, které se čtou kostrbatě.
3. Spusť `pnpm run i18n:gen`, commitni regenerované bundly spolu se svou úpravou
   overlaye, pak spusť lokalizační sady
   (`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`)
   a otevři PR. Samotná kontrola typů ti neřekne, jestli nějaký klíč chybí, protože
   overlaye jsou záměrně řídké.

Pokud chceš navrhnout úplně nový jazyk nebo probrat tón a terminologii, založ vlákno
na [Discordu](https://discord.com/invite/worldofclaudecraft) a pomůžeme ti ho zapojit.
Rodilí a plynulí mluvčí jsou vítáni obzvlášť. Dobré překlady dělají hru domovem pro
hráče všude na světě.

## Hlášení chyb a žádosti o funkce

Prosím používej [šablony issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose):

- **Hlášení chyby.** Nejdřív prohledej [existující issues](https://github.com/levy-street/world-of-claudecraft/issues),
  aby ses vyhnul duplicitám, a pak uveď kroky k reprodukci, co jsi očekával, co se
  stalo a jaké máš prostředí (offline nebo online, prohlížeč, desktop nebo mobil).
- **Žádost o funkci.** Popiš problém, který se snažíš vyřešit, ne jen řešení.
  Kontext nám pomáhá navrhnout tu správnou věc.
- **Bezpečnostní zranitelnosti.** Prosím neotevírej veřejné issue. Nahlas je
  soukromě podle [SECURITY.md](../../SECURITY.md) a budeme s tebou spolupracovat na
  opravě i na zveřejnění.

## Kde získat pomoc

Zasekl ses nebo chceš jen pozdravit? Přidej se na
[komunitní Discord](https://discord.com/invite/worldofclaudecraft). Žádná otázka není
příliš malá a noví přispěvatelé jsou vždycky vítáni.

## Licence

Přispěním kódu souhlasíš, že tvé kódové příspěvky budou licencované pod
[MIT licencí](../../LICENSE) projektu, tedy toutéž licencí, která kryje projekt.

MIT licence znamená přesně to, co říká: kdokoli smí kód používat, upravovat a šířit
dál, komerčně i nekomerčně. Naše
[Podmínky služby](https://worldofclaudecraft.com/terms) upravují hostovanou hru,
kterou provozujeme na worldofclaudecraft.com (účty, chování, virtuální předměty), a
neomezují práva, která MIT licence dává tobě ani komukoli jinému v tomto kódu.
Názvy a branding "World of ClaudeCraft" a "Levy Street" MIT licence nekryje.

Výjimkou jsou původní kreativní assety (zvukové nahrávky, hudba, grafika a podobná
autorská díla). Pokud přispěješ původním assetem, který jsi vytvořil, můžeš si místo
toho ponechat autorská práva a poskytnout ho pod licencí dle vlastní volby (například
CC BY-NC 4.0), a to za podmínky, že:

- licence, cesty k assetům, které kryje, a tvé uvedení autorství jsou zaznamenané
  v licenční tabulce v [CREDITS.md](../../CREDITS.md) v rámci téhož pull requestu, a
- zahrnuje minimálně trvalé a bezúplatné oprávnění pro Levy Street používat assety
  komerčně ve World of ClaudeCraft, včetně oficiálních vydání a obchodu ve hře.

U assetů uvedených v tabulce v CREDITS.md má tato zaznamenaná licence přednost před
výchozí MIT licencí projektu.

**Mediální assety bez záznamu v CREDITS.md nejsou licencované pod MIT.** Registr se
pořád doplňuje, takže chybějící záznam znamená, že podmínky nejsou zaznamenané, ne
že si asset může kdokoli vzít. Je to záměr: brání to tomu, aby se neregistrovaný
příspěvek ve výchozím stavu rozdal. U kódu to platí obráceně a všechno, co není
v CREDITS.md vyňaté, je pod MIT.

Přesně proto není záznam v registru volitelná papírová práce. Pokud přispěješ
assetem bez řádku v CREDITS.md, nikdo po proudu ho nemůže použít a my nemáme záznam
o tom, co jsi nám poskytl. Sloupec **Redistribution** vyplň také poctivě. Právě on
říká někomu, kdo tento projekt forkne, jestli smí tvůj asset předat dál, a některé
řádky nesou "No, permission required" právě proto, že to nesmí.

---

Děkujeme, že přispíváš do World of ClaudeCraft. Nemůžeme se dočkat, co s námi
postavíš.
