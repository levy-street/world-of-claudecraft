<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Čeština](CONTRIBUTING.cs_CZ.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · **Polski** · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# Współtworzenie World of ClaudeCraft

Na początek dziękujemy, że tu jesteś. World of ClaudeCraft tworzy społeczność
ludzi, którzy kochają klasyczne gry MMO, i każdy wkład, duży czy mały, sprawia, że
gra staje się lepsza. Poprawienie literówki, przetłumaczenie gry, zgłoszenie błędu,
zbudowanie zupełnie nowego lochu: wszystko się liczy, a Ty jesteś tu mile widziany.

Ten przewodnik pomoże Ci się przygotować i sprawić, by Twój pierwszy wkład przebiegł
gładko. Nie musisz być ekspertem. Jeśli coś jest niejasne, zapytaj na
[Discordzie](https://discord.com/invite/worldofclaudecraft), a ktoś chętnie pomoże.

Biorąc udział, zgadzasz się przestrzegać naszego [Kodeksu postępowania](../../CODE_OF_CONDUCT.md).

## Sposoby współtworzenia

Tu jest miejsce dla każdego:

- **Kod.** Popraw błąd, dodaj funkcję lub zwiększ wydajność. Zgłoszenia oznaczone
  etykietami [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  i [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  to dobre miejsce na start.
- **Tłumaczenia.** Pomóż graczom na całym świecie, ulepszając lub uzupełniając
  język. Zobacz [Tłumaczenie gry](#translating-the-game) poniżej. To jeden
  z najłatwiejszych i najbardziej znaczących sposobów na rozpoczęcie.
- **Zgłoszenia błędów i pomysły na funkcje.** Otwórz [zgłoszenie](https://github.com/levy-street/world-of-claudecraft/issues/new/choose).
  Czytelne zgłoszenie błędu to prawdziwy wkład.
- **Dokumentacja.** Przewodniki takie jak ten, plik README oraz dokumenty
  projektowe w katalogu `docs/` zawsze można ulepszyć.
- **Testowanie i opinie.** Zagraj w grę, powiedz nam, co wydaje się nie tak, i
  podziel się pomysłami na Discordzie.

## Pierwsze kroki

Będziesz potrzebować [Node.js 26](https://nodejs.org/) oraz npm, czyli wersji,
których używa CI i obraz produkcyjny. Starsze wersje główne nie są testowane. Do
uruchomienia serwera wieloosobowego przyda się także [Docker](https://www.docker.com/)
do obsługi Postgres.

```bash
# 1. Zrób fork repozytorium na GitHubie, potem sklonuj swój fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Zainstaluj zależności
npm ci

# 3. Wskaż gitowi hooki repozytorium (raz na klon)
git config core.hooksPath .githooks

# 4. Uruchom klienta offline (serwer ani baza danych nie są potrzebne)
npm run dev          # otwórz adres URL, który wypisze (zwykle http://localhost:5173)
```

To wystarczy, by zagrać w świat offline i pracować nad większością rzeczy. Aby
uruchomić pełny stos online, potrzebujesz najpierw hasła do bazy danych w swoim
środowisku:

```bash
cp .env.example .env
# ustaw POSTGRES_PASSWORD i skieruj DATABASE_URL na to samo hasło
npm run db:up        # uruchom Postgres 16 w Dockerze (deweloperska baza na porcie 5433)
npm run server       # zbuduj i uruchom autorytatywny serwer gry na :8787
npm run dev          # w innym terminalu; klient przekazuje żądania do serwera
```

Jeśli zamierzasz uruchamiać pełną bramkę opisaną poniżej, zainstaluj raz
przeglądarkę, którą ona steruje: `npx playwright install chromium`.

[README](../../README.md) zawiera pełny przewodnik po hostowaniu, rozwijaniu i
graniu, a pliki `CLAUDE.md` w całym repozytorium dokumentują konwencje dla każdego
obszaru.

### Łańcuch narzędzi TypeScript

Sprawdzanie typów działa na TypeScript 7, natywnym kompilatorze: `npx tsc --noEmit`
działa dokładnie tak jak wcześniej, a pełne sprawdzenie repozytorium zajmuje teraz
kilka sekund zamiast kilkudziesięciu. Instalacja korzysta z oficjalnego podwójnego
aliasu: pakiet `typescript` rozwiązuje się do API JS TypeScript 6 (przez nakładkę
`@typescript/typescript6`), ponieważ `svelte-check` wciąż korzysta z tego API,
natomiast `@typescript/native` dostarcza binarkę `tsc`. Warto wiedzieć:

- **Edytory.** VS Code potrzebuje rozszerzenia "TypeScript 7" z marketplace
  (`TypeScriptTeam.native-preview`), aby obsłużyć natywną usługę językową, dopóki
  wbudowane wsparcie się nie pojawi; przełącza się je ustawieniem
  `js/ts.experimental.useTsgo`, a jego polecenie "Disable TypeScript 7 Language
  Server" jest przewidzianym powrotem do tsservera z TypeScript 6. IDE JetBrains
  automatycznie wykrywają natywny serwer tylko pod nazwą pakietu
  `@typescript/native-preview`, więc nie znajdą go po aliasie `@typescript/native`
  używanym w tym repozytorium; ich wbudowane wsparcie dla TypeScript 6 działa dobrze.
- **Przydatne flagi tsc.** `--checkers N` ustawia liczbę równoległych procesów
  sprawdzających typy (domyślnie 4; wyniki są identyczne przy każdej wartości):
  zmniejsz ją, by ograniczyć zużycie pamięci na ograniczonym runnerze, zwiększ na
  maszynie z wieloma rdzeniami i w obu przypadkach zmierz efekt, bo więcej nie zawsze
  znaczy szybciej. `--singleThreaded` wyłącza całą równoległość. Doraźne sprawdzenie
  pojedynczego pliku (`npx tsc somefile.ts`) kończy się błędem, gdy katalog zawiera
  `tsconfig.json`; podaj `--ignoreConfig`, aby uzyskać dawne zachowanie.
- **Plik blokady.** Generuj `package-lock.json` ponownie wyłącznie poleceniem
  `npx npm@10 install --package-lock-only`: plik korzysta z semantyki npm 10, a
  nowsze wersje główne npm (w tym npm 11 dołączony do Node 26 używanego przez CI)
  po cichu usuwają zagnieżdżone wpisy opcjonalnych zależności peer pakietu
  `svelte-check`, co rozjeżdża `npm ci` w CI. Zwykłe `npm ci` jest bezpieczne przy
  każdej wersji głównej npm. Po regeneracji sprawdź, czy `npm ci --dry-run` jest
  spójne zarówno pod npm 10, jak i pod npm na Twojej stacji roboczej.
- **Kiedy do tego wrócić.** Zwiń podwójny alias z powrotem do jednej zależności
  `typescript` dopiero wtedy, gdy spełnione będą OBA warunki: stabilne API JS
  TypeScript 7.1 zostanie wydane (TypeScript 7.0 nie zawiera żadnego API JS;
  zamiennik jest śledzony w zgłoszeniu 2824 w microsoft/typescript-go) oraz
  zgłoszenie 3063 w sveltejs/language-tools zostanie zamknięte wraz z wydanym
  `svelte-check`, który je przyjmuje. Eksperymentalne tryby `--tsgo` w svelte-check
  nie znoszą jego wymagania wobec API TypeScript 6, a trwające prace nad
  wczytywaniem TypeScript 7 (PR 3073 w language-tools) czytają alias
  `@typescript/native`, którego to repozytorium już używa, więc żadna zmiana nazwy
  nie jest potrzebna.

## Wprowadzanie zmian

1. **Zaczynaj od najnowszej gałęzi wydania, nigdy od `main`.** Bieżące prace są
   integrowane na gałęzi `release/vX.Y.Z`; `main` jest za nią w tyle i nie jest bazą
   dla wkładów. Znajdź najnowszą i utwórz gałąź na jej podstawie:

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # najnowsza gałąź wydania
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   Zawsze wykonuj to sprawdzenie, zamiast kopiować numer wersji z tego przewodnika:
   gałęzie wydań zmieniają się często, a najnowsza przesuwa się z każdym wydaniem.
   Gałęzie nazywamy `feature/<short-slug>` lub `fix/<short-slug>`.
2. **Twórz skupione commity.** Mniejsze, samodzielne zmiany są łatwiejsze do
   przejrzenia i scalenia niż duże.
3. **Dodaj lub zaktualizuj testy** dla każdego zachowania, które zmieniasz w
   `src/sim/` lub `server/`.
4. **Zadbaj, by tekst widoczny dla gracza był przetłumaczalny.** Zobacz
   [Lokalizacja](#localization) i [Tłumaczenie gry](#translating-the-game).

### O czym warto pamiętać

To są kluczowe reguły bazy kodu. Pełne szczegóły znajdują się w głównym pliku
[`CLAUDE.md`](../../CLAUDE.md), ale w skrócie:

- **Rdzeń symulacji (`src/sim/`) jest źródłem prawdy** i pozostaje czysty, bez
  importów DOM, przeglądarki czy Three.js, dzięki czemu dokładnie ten sam kod
  działa offline, na serwerze i w bezgłowym środowisku RL.
- **Symulacja jest deterministyczna.** Działa w stałym takcie 20 Hz, a cała
  losowość przechodzi przez `Rng`, nigdy przez `Math.random`, `Date.now` ani
  `performance.now` w logice symulacji. To samo ziarno zawsze tworzy ten sam świat.
- **Matematyka rozgrywki podąża za formułami klasycznych gier MMO** (gniew, tabele
  trafień, pancerz, krzywe doświadczenia). Prosimy, nie wymyślaj liczb balansowych.
  Zamiast tego podaj źródło formuły.
- **Nowa logika trafia jako własny mały, przetestowany moduł za istniejącym szwem**,
  zamiast być dopisywana do jednego z dużych plików koordynujących. Dane, które
  czyta renderer albo HUD, przechodzą przez interfejs `IWorld` (`src/world_api/`) i
  są zaimplementowane zarówno w świecie offline, jak i online; nowy system symulacji
  trafia za `SimContext`; nowy endpoint REST to moduł trasy, który wygenerujesz
  poleceniem `npm run new:endpoint`.
- **Nie edytuj ręcznie wygenerowanych plików** takich jak `*.generated.ts`.
  Wygeneruj je ponownie przez proces budowania.
- **Styl redakcyjny projektu: żadnych długich myślników, półpauz ani emoji** w
  żadnym miejscu, ani w kodzie, komentarzach, dokumentacji, komunikatach commitów,
  tekstach PR, ani w treściach widocznych dla graczy. Używaj przecinków, dwukropków,
  nawiasów lub słowa "do" dla zakresów. Kontrola przed wypchnięciem skanuje Twój
  diff i blokuje push w razie trafienia.
- **Nigdy nie commituj sekretów** ani pliku `.env` i nigdy nie włączaj
  `ALLOW_DEV_COMMANDS` na ścieżce produkcyjnej, ponieważ odblokowuje to cheaty.

### Styl kodu

Formatowanie zapewnia [Biome](https://biomejs.dev/), skonfigurowany w `biome.json`:
wcięcie 2 spacji, wiersze po 100 kolumn, pojedyncze cudzysłowy, przecinki końcowe.
Formatuj wyłącznie pliki, których dotknąłeś
(`npx @biomejs/biome check --write <your-file.ts>`), i sprawdzaj je poleceniem
`npm run ci:changed`. CI kontroluje tylko zmienione pliki, więc prosimy, nie
formatuj ponownie reszty drzewa: przebieg na całym repozytorium ujawnia dawny dług,
którego naprawa nie należy do Ciebie.

## Zanim otworzysz pull request

Uruchom bramkę repozytorium lokalnie. To ta sama umowa, którą egzekwuje CI:

```bash
npm run gate
```

W trakcie pracy uruchamiaj pojedynczy zestaw testów
(`npx vitest run tests/sim.test.ts`) oraz `npm run ci:changed` dla formatowania;
`npm test` uruchamia wszystko, a mapa zestawów jest w `tests/CLAUDE.md`. Pełne
`npm run gate` obejmuje aktualność wygenerowanych artefaktów, skan pod kątem
złośliwego kodu, formatowanie zmienionych plików, kontrolę zgodności efektów
dźwiękowych, cały zestaw testów, przebieg regresyjny w prawdziwej przeglądarce,
ścisłe sprawdzenie typów oraz budowy klienta, serwera i wersji bezgłowej.
Warstwowe kontrole, od minimum sprawdzanego przed wypchnięciem w górę, są opisane w
[`docs/qa-gate.md`](../qa-gate.md).

Następnie przetestuj swoją zmianę zarówno na komputerze, jak i na urządzeniu
mobilnym, w tym w obszarze widoku wielkości telefonu w orientacji pionowej i
poziomej, jeśli dotyczy czegokolwiek, co widzą gracze. Cele dotykowe powinny
pozostać przynajmniej 40x40px, a pola formularzy mieć czcionkę co najmniej 16px.
Standardy interfejsu są opisane w [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Otwieranie pull requesta

Wypchnij swoją gałąź i otwórz PR **wycelowany w tę samą najnowszą gałąź
`release/vX.Y.Z`, od której zacząłeś. Nigdy nie celuj w `main`**, która jest gałęzią
integracyjną na czas wydania, a nie bazą dla wkładów. GitHub często wybiera za
Ciebie `main`, więc zmień gałąź bazową przed wysłaniem.
[Szablon pull requesta](../../.github/PULL_REQUEST_TEMPLATE.md) przeprowadzi Cię
przez krótką listę kontrolną. Prosimy, uzupełnij ją:

- Opisz, **co** się zmieniło i **dlaczego**.
- Połącz powiązane zgłoszenie (na przykład „Closes #123”).
- Dodaj **zrzuty ekranu lub klip dla zmian interfejsu**, na komputerze i urządzeniu
  mobilnym.
- Potwierdź, że `npm run gate` przechodzi, a nowe ciągi znaków widoczne dla graczy
  są zgodne z opisaną niżej zasadą „najpierw angielski” dla współtwórców.

W Twoim PR CI uruchamia formatowanie i lintowanie zmienionych plików, pełny zestaw
testów na czterech równoległych fragmentach, przebieg regresyjny w przeglądarce oraz
sprawdzenie typów wraz z budowami klienta, serwera i wersji bezgłowej. Odpowiada to
temu, co lokalnie robi `npm run gate`, więc zielona bramka dobrze zapowiada zielony
PR.

Zielony przebieg CI i kompletna lista kontrolna to to, czego szukamy przed
scaleniem. Opiekun projektu może zaproponować zmiany. To normalna, oparta na
współpracy część procesu, a nie odrzucenie. Staramy się być życzliwi i konstruktywni
w recenzjach i prosimy Cię o to samo.

> Komunikaty commitów i tytuły PR podążają za [Conventional Commits](https://www.conventionalcommits.org/)
> z zakresem (`feat(talents): ...`, `fix(net): ...`). Każdy commit ma też treść: po
> pustym wierszu od jednego do czterech prostych zdań mówiących, co się zmieniło i
> dlaczego, zawijanych mniej więcej na 72 kolumnie. Sam tytuł nie wystarczy.

<a id="localization"></a>

## Lokalizacja

World of ClaudeCraft jest wydawana w wielu językach. Każdy ciąg znaków widoczny dla
gracza musi być kluczem tłumaczenia, przy czym osoby dodające funkcje zwykle dodają
tylko angielskie źródło.

- Cały tekst widoczny dla użytkownika to klucz `t()`. Dodaj nową angielską treść do
  odpowiedniego modułu domenowego w
  [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) (nowe elementy obramowania
  HUD trafiają do `hud_chrome.ts`), a następnie wyświetl ją przez
  `t('dotted.key', values)`. Sam angielski jest dokładnie tym, czego trzeba w PR z
  funkcją: opiekun projektu uzupełnia pozostałe języki przy wydaniu, więc nie
  edytujesz nakładek w `src/ui/i18n.locales/` i nigdy nie zostawiasz w nich
  angielskiego symbolu zastępczego ani `// TODO`. Wyjątek M16 dotyczy nowej,
  rozbudowanej wartości angielskiej, która wymaga także pięciu uzupełnień w pismach
  niełacińskich opisanych w [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).
- Liczby, pieniądze, daty, jednostki i procenty przechodzą przez formatery
  (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`), a nie przez ręczne
  budowanie ciągów znaków.
- Tekst widoczny dla gracza emitowany z `src/sim/` lub `server/`, które pozostają
  niezależne od języka, musi zostać ponownie zlokalizowany na granicy klienta w tej
  samej zmianie. Test strażniczy `npx vitest run tests/localization_fixes.test.ts`
  to egzekwuje.
- Po dodaniu lub zmianie dowolnego ciągu znaków uruchom `npm run i18n:gen` i
  zacommituj wygenerowane na nowo paczki w tej samej zmianie. Bramka i CI porównują
  zacommitowane artefakty ze świeżą regeneracją, więc nieaktualna paczka wywala
  budowę.

Dodaj więc swoje ciągi znaków po angielsku i otwórz PR; nie musisz tłumaczyć ich
samodzielnie. Jeśli chcesz pomóc przy tłumaczeniach, zajrzyj do następnej sekcji.

<a id="translating-the-game"></a>

## Tłumaczenie gry

Chcesz ulepszyć język lub pomóc wprowadzić grę do nowego? Nie musisz pisać żadnego
kodu gry, by to zrobić:

1. Większość tłumaczeń widocznych dla graczy znajduje się w plikach nakładek dla
   poszczególnych języków w
   [`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) (po jednym na wersję
   językową), odzwierciedlających angielskie klucze w
   [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/). Tekst emitowany przez
   symulację i serwer tłumaczy się w `src/ui/sim_i18n.ts` i
   `src/ui/server_i18n.ts`, treści talentów w modułach `talent_i18n`, a panel
   administracyjny ma własny zestaw w `src/admin/i18n.locales/`.
2. Ulepsz istniejące tłumaczenia lub uzupełnij te, które brzmią niezgrabnie.
3. Uruchom `npm run i18n:gen`, zacommituj wygenerowane na nowo paczki razem ze swoją
   zmianą nakładki, następnie uruchom zestawy testów lokalizacji
   (`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`)
   i otwórz PR. Samo sprawdzenie typów nie powie Ci, czy brakuje klucza, ponieważ
   nakładki są celowo niepełne.

Aby zaproponować zupełnie nową wersję językową lub przedyskutować ton i
terminologię, rozpocznij wątek na [Discordzie](https://discord.com/invite/worldofclaudecraft), a
pomożemy Ci wszystko poskładać. Szczególnie mile widziani są rodzimi i biegli
użytkownicy języka. Dobre tłumaczenia sprawiają, że gra staje się dla graczy
wszędzie jak dom.

## Zgłaszanie błędów i propozycje funkcji

Prosimy korzystać z [szablonów zgłoszeń](https://github.com/levy-street/world-of-claudecraft/issues/new/choose):

- **Zgłoszenie błędu.** Najpierw przeszukaj [istniejące zgłoszenia](https://github.com/levy-street/world-of-claudecraft/issues),
  aby uniknąć duplikatów, a następnie dołącz kroki do odtworzenia, czego się
  spodziewałeś, co się stało, oraz swoje środowisko (offline lub online,
  przeglądarka, komputer lub urządzenie mobilne).
- **Propozycja funkcji.** Opisz problem, który próbujesz rozwiązać, a nie tylko
  rozwiązanie. Kontekst pomaga nam zaprojektować właściwą rzecz.
- **Luki bezpieczeństwa.** Prosimy, nie otwieraj publicznego zgłoszenia. Zgłoś je
  prywatnie, postępując zgodnie z [SECURITY.md](../../SECURITY.md), a wspólnie z
  Tobą zajmiemy się poprawką i ujawnieniem.

## Uzyskiwanie pomocy

Utknąłeś albo chcesz się po prostu przywitać? Dołącz do
[społecznościowego Discorda](https://discord.com/invite/worldofclaudecraft). Żadne pytanie nie jest
zbyt małe, a nowi współtwórcy są zawsze mile widziani.

## Licencja

Współtworząc kod, zgadzasz się, że Twój wkład w kod będzie objęty
[Licencją MIT](../../LICENSE) projektu, tą samą licencją, która obejmuje projekt.

Licencja MIT znaczy dokładnie to, co mówi: każdy może używać, modyfikować i
rozpowszechniać kod, komercyjnie lub nie. Nasz
[Regulamin](https://worldofclaudecraft.com/terms) reguluje hostowaną grę, którą
prowadzimy pod adresem worldofclaudecraft.com (konta, zachowanie, przedmioty
wirtualne) i nie ogranicza praw, które Licencja MIT daje Tobie ani komukolwiek
innemu w tym kodzie. Nazwy i znaki „World of ClaudeCraft” oraz „Levy Street” nie są
objęte Licencją MIT.

Wyjątkiem są oryginalne zasoby twórcze (nagrania dźwiękowe, muzyka, grafika i
podobne dzieła autorskie). Jeśli przekazujesz oryginalny zasób, który sam
stworzyłeś, możesz zamiast tego zachować prawa autorskie i udostępnić go na
wybranej przez siebie licencji (na przykład CC BY-NC 4.0), pod warunkiem że:

- licencja, ścieżki zasobów, których dotyczy, oraz Twoje oznaczenie autorstwa
  zostaną zapisane w tabeli licencji w pliku [CREDITS.md](../../CREDITS.md) w
  ramach tego samego pull requesta, oraz
- obejmuje ona co najmniej bezterminowe, wolne od opłat prawo Levy Street do
  komercyjnego wykorzystania zasobów w World of ClaudeCraft, w tym w oficjalnych
  wydaniach i w sklepie w grze.

Dla zasobów wymienionych w tabeli w CREDITS.md zapisana tam licencja ma pierwszeństwo
przed domyślną licencją MIT projektu.

**Zasoby multimedialne bez wpisu w CREDITS.md nie są objęte licencją MIT.** Rejestr
jest wciąż uzupełniany, więc brak wpisu oznacza, że warunki nie zostały zapisane, a
nie że zasób można swobodnie wziąć. Jest to celowe: zapobiega temu, by nieujęty w
rejestrze wkład był domyślnie rozdawany. Z kodem jest odwrotnie i wszystko, co nie
zostało wyłączone w CREDITS.md, jest na licencji MIT.

Właśnie dlatego wpis w rejestrze nie jest opcjonalną papierologią. Jeśli przekażesz
zasób bez wiersza w CREDITS.md, nikt dalej nie będzie mógł go użyć, a my nie mamy
żadnego zapisu tego, co nam przyznałeś. Wypełnij uczciwie także kolumnę
**Redistribution**. To ona mówi osobie forkującej ten projekt, czy może przekazać
Twój zasób dalej, a niektóre wiersze są oznaczone „No, permission required” właśnie
dlatego, że nie może.

---

Dziękujemy za współtworzenie World of ClaudeCraft. Nie możemy się doczekać, by
zobaczyć, co zbudujesz razem z nami.
