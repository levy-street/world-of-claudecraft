<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · **Polski** · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# Współtworzenie World of ClaudeCraft

Na początek dziękujemy, że tu jesteś. World of ClaudeCraft tworzy społeczność
ludzi, którzy kochają klasyczne gry MMO, i każdy wkład, duży czy mały, sprawia, że
gra staje się lepsza. Poprawienie literówki, przetłumaczenie gry, zgłoszenie błędu,
zbudowanie zupełnie nowego lochu: wszystko się liczy, a Ty jesteś tu mile widziany.

Ten przewodnik pomoże Ci się przygotować i sprawić, by Twój pierwszy wkład przebiegł
gładko. Nie musisz być ekspertem. Jeśli coś jest niejasne, zapytaj na
[Discordzie](https://discord.gg/GjhnUsBtw), a ktoś chętnie pomoże.

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

Będziesz potrzebować [Node.js 22+](https://nodejs.org/) oraz npm. Do uruchomienia
serwera wieloosobowego przyda się także [Docker](https://www.docker.com/) do
obsługi Postgres.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Install dependencies
npm ci

# 3. Run the offline client (no server or database needed)
npm run dev          # open the URL it prints (usually http://localhost:5173)
```

To wystarczy, by zagrać w świat offline i pracować nad większością rzeczy. Aby
uruchomić pełny stos online:

```bash
npm run db:up        # start Postgres 16 in Docker (dev DB on port 5433)
npm run server       # build and run the authoritative game server on :8787
npm run dev          # in another terminal; the client proxies to the server
```

[README](../../README.md) zawiera pełny przewodnik po hostowaniu, rozwijaniu i
graniu, a pliki `CLAUDE.md` w całym repozytorium dokumentują konwencje dla każdego
obszaru.

## Wprowadzanie zmian

1. **Utwórz gałąź** na bazie `main`: `feature/<short-slug>` lub `fix/<short-slug>`.
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
- **Nie edytuj ręcznie wygenerowanych plików** takich jak `*.generated.ts`.
  Wygeneruj je ponownie przez proces budowania.
- **Nigdy nie commituj sekretów** ani pliku `.env` i nigdy nie włączaj
  `ALLOW_DEV_COMMANDS` na ścieżce produkcyjnej, ponieważ odblokowuje to cheaty.

## Zanim otworzysz pull request

Uruchom te polecenia lokalnie. To te same kontrole, które wykonuje CI:

```bash
npm test                    # Vitest suite
npx tsc --noEmit            # TypeScript typecheck (the project is strict)
npm run security:gate       # malicious-code release gate (high-severity signatures; also asserted by npm test)
npm run build               # production client build
```

Jeśli zmieniłeś kod serwera lub bezgłowy, uruchom też `npm run build:server` i
`npm run build:env`.

Następnie przetestuj swoją zmianę zarówno na komputerze, jak i na urządzeniu
mobilnym, w tym w obszarze widoku wielkości telefonu w orientacji pionowej i
poziomej, jeśli dotyczy czegokolwiek, co widzą gracze. Cele dotykowe powinny
pozostać przynajmniej 40x40px, a pola formularzy mieć czcionkę co najmniej 16px.
Standardy interfejsu są opisane w [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Otwieranie pull requesta

Wypchnij swoją gałąź i otwórz PR względem `main`.
[Szablon pull requesta](../../.github/PULL_REQUEST_TEMPLATE.md) przeprowadzi Cię
przez krótką listę kontrolną. Prosimy, uzupełnij ją:

- Opisz, **co** się zmieniło i **dlaczego**.
- Połącz powiązane zgłoszenie (na przykład „Closes #123”).
- Dodaj **zrzuty ekranu lub klip dla zmian interfejsu**, na komputerze i urządzeniu
  mobilnym.
- Potwierdź, że testy, sprawdzenie typów i budowa przechodzą, oraz że nowe ciągi
  znaków są przetłumaczone.

Zielony przebieg CI i kompletna lista kontrolna to to, czego szukamy przed
scaleniem. Opiekun projektu może zaproponować zmiany. To normalna, oparta na
współpracy część procesu, a nie odrzucenie. Staramy się być życzliwi i konstruktywni
w recenzjach i prosimy Cię o to samo.

> Komunikaty commitów i tytuły PR podążają za [Conventional Commits](https://www.conventionalcommits.org/)
> z zakresem tam, gdzie pasuje (`feat(talents): ...`, `fix(net): ...`). To
> konwencja, którą lubimy, a nie ścisły wymóg. Czytelne, opisowe komunikaty mają
> większe znaczenie niż idealne formatowanie.

<a id="localization"></a>

## Lokalizacja

World of ClaudeCraft jest dostępna w wielu językach i utrzymujemy to w miarę
rozwoju gry. Każdy ciąg znaków widoczny dla gracza jest tłumaczony na każdą
obsługiwaną wersję językową.

- Cały tekst widoczny dla użytkownika to klucz `t()` zdefiniowany w
  [`src/ui/i18n.ts`](../../src/ui/i18n.ts). Dodaj nowy ciąg najpierw do języka
  `en`, a następnie podaj prawdziwe tłumaczenie w każdym innym języku w
  `supportedLanguages`. Żadnych angielskich symboli zastępczych ani `// TODO`.
- Liczby, pieniądze, daty, jednostki i procenty przechodzą przez formatery
  (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`), a nie przez ręczne
  budowanie ciągów znaków.
- Tekst widoczny dla gracza emitowany z `src/sim/` lub `server/`, które pozostają
  niezależne od języka, musi zostać ponownie zlokalizowany na granicy klienta w tej
  samej zmianie. Test strażniczy `npx vitest run tests/localization_fixes.test.ts`
  to egzekwuje.

Jeśli Twoja zmiana dodaje ciąg znaków, a potrafisz napisać go tylko w niektórych
językach, to w porządku. Otwórz PR i poproś o pomoc z resztą w opisie. Wolimy pomóc
Ci dokończyć, niż żebyś się wstrzymywał.

<a id="translating-the-game"></a>

## Tłumaczenie gry

Chcesz ulepszyć język lub pomóc wprowadzić grę do nowego? Nie musisz pisać żadnego
kodu gry, by to zrobić:

1. Otwórz [`src/ui/i18n.ts`](../../src/ui/i18n.ts) i znajdź wersję językową, nad
   którą chcesz pracować. Każdy obiekt wersji językowej zawiera te same klucze co
   `en`.
2. Ulepsz istniejące tłumaczenia lub uzupełnij te, które brzmią niezgrabnie.
3. Uruchom `npx tsc --noEmit`, aby potwierdzić, że niczego nie brakuje, a następnie
   otwórz PR.

Aby zaproponować zupełnie nową wersję językową lub przedyskutować ton i
terminologię, rozpocznij wątek na [Discordzie](https://discord.gg/GjhnUsBtw), a
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

## Uzyskiwanie pomocy

Utknąłeś albo chcesz się po prostu przywitać? Dołącz do
[społecznościowego Discorda](https://discord.gg/GjhnUsBtw). Żadne pytanie nie jest
zbyt małe, a nowi współtwórcy są zawsze mile widziani.

## Licencja

Współtworząc, zgadzasz się, że Twój wkład będzie objęty licencją projektu
[MIT License](../../LICENSE), tą samą licencją, która obejmuje projekt.

---

Dziękujemy za współtworzenie World of ClaudeCraft. Nie możemy się doczekać, by
zobaczyć, co zbudujesz razem z nami.
