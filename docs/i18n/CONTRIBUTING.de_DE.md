<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · **Deutsch** · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# Mitwirken an World of ClaudeCraft

Zuallererst: Danke, dass du hier bist. World of ClaudeCraft wird von einer
Gemeinschaft von Menschen gebaut, die klassische MMOs lieben, und jeder Beitrag,
ob groß oder klein, macht das Spiel besser. Einen Tippfehler beheben, das Spiel
übersetzen, einen Fehler melden, einen ganz neuen Dungeon bauen: Alles zählt, und
du bist hier herzlich willkommen.

Dieser Leitfaden hilft dir bei der Einrichtung und macht deinen ersten Beitrag
ganz unkompliziert. Du musst kein Profi sein. Falls etwas unklar ist, frag einfach
auf [Discord](https://discord.com/invite/worldofclaudecraft) nach, und jemand hilft dir gerne weiter.

Mit deiner Teilnahme erklärst du dich damit einverstanden, unseren
[Verhaltenskodex](../../CODE_OF_CONDUCT.md) einzuhalten.

## Möglichkeiten mitzuwirken

Hier ist für jeden ein Platz:

- **Code.** Behebe einen Fehler, füge eine Funktion hinzu oder verbessere die
  Performance. Issues mit den Labels
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  und [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  sind ein guter Einstieg.
- **Übersetzungen.** Hilf Spielerinnen und Spielern auf der ganzen Welt, indem du
  eine Sprache verbesserst oder vervollständigst. Siehe weiter unten
  [Das Spiel übersetzen](#translating-the-game). Das ist einer der einfachsten und
  wirkungsvollsten Wege, um anzufangen.
- **Fehlermeldungen und Ideen für Funktionen.** Eröffne ein
  [Issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose).
  Eine klare Fehlermeldung ist ein echter Beitrag.
- **Dokumentation.** Leitfäden wie dieser, die README und die Design-Dokumente in
  `docs/` lassen sich immer verbessern.
- **Spieltests und Rückmeldungen.** Spiele das Spiel, sag uns, was sich falsch
  anfühlt, und teile deine Ideen auf Discord.

## Erste Schritte

Du brauchst [Node.js 22+](https://nodejs.org/) und npm. Für den Mehrspieler-Server
solltest du außerdem [Docker](https://www.docker.com/) haben, um Postgres
auszuführen.

```bash
# 1. Forke das Repo auf GitHub und klone anschließend deinen Fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Abhängigkeiten installieren
npm ci

# 3. Starte den Offline-Client (kein Server und keine Datenbank nötig)
npm run dev          # öffne die ausgegebene URL (meist http://localhost:5173)
```

Das reicht aus, um die Offline-Welt zu spielen und an den meisten Dingen zu
arbeiten. Um den vollständigen Online-Stack auszuführen:

```bash
npm run db:up        # starte Postgres 16 in Docker (Entwicklungs-DB auf Port 5433)
npm run server       # baue und starte den autoritativen Spielserver auf :8787
npm run dev          # in einem anderen Terminal; der Client leitet zum Server weiter
```

Die [README](../../README.md) enthält den vollständigen Leitfaden zum Hosten,
Entwickeln und Spielen, und die `CLAUDE.md`-Dateien im gesamten Repo dokumentieren
die Konventionen für jeden Bereich.

## Deine Änderung umsetzen

1. **Erstelle einen Branch** ausgehend von `main`: `feature/<short-slug>` oder
   `fix/<short-slug>`.
2. **Mach fokussierte Commits.** Kleinere, in sich abgeschlossene Änderungen lassen
   sich leichter prüfen und zusammenführen als große.
3. **Ergänze oder aktualisiere Tests** für jedes Verhalten, das du in `src/sim/`
   oder `server/` änderst.
4. **Halte spielersichtbaren Text übersetzbar.** Siehe
   [Lokalisierung](#localization) und [Das Spiel übersetzen](#translating-the-game).

### Worauf du achten solltest

Dies sind die tragenden Regeln der Codebasis. Alle Details findest du in der
[`CLAUDE.md`](../../CLAUDE.md) im Stammverzeichnis, aber kurz gefasst:

- **Der Simulationskern (`src/sim/`) ist die Quelle der Wahrheit**, und er bleibt
  rein, ohne DOM-, Browser- oder Three.js-Importe, sodass exakt derselbe Code
  offline, auf dem Server und in der headless RL-Umgebung läuft.
- **Die Simulation ist deterministisch.** Sie läuft mit einem festen Takt von
  20 Hz, und sämtlicher Zufall läuft über `Rng`, niemals über `Math.random`,
  `Date.now` oder `performance.now` in der Simulationslogik. Derselbe Seed erzeugt
  immer dieselbe Welt.
- **Die Gameplay-Mathematik folgt den klassischen MMO-Formeln** (Wut,
  Treffertabellen, Rüstung, EP-Kurven). Bitte erfinde keine Balancing-Werte. Gib
  stattdessen die Formel an.
- **Bearbeite generierte Dateien nicht von Hand**, etwa `*.generated.ts`. Erzeuge
  sie über den Build-Prozess neu.
- **Committe niemals Geheimnisse** oder eine `.env`-Datei, und aktiviere niemals
  `ALLOW_DEV_COMMANDS` in einem Produktionspfad, da es Cheats freischaltet.

## Bevor du einen Pull Request eröffnest

Bitte führe diese Befehle lokal aus. Es sind dieselben Prüfungen, die auch die CI
durchführt:

```bash
npm test                    # Vitest-Suite
npx tsc --noEmit            # TypeScript-Typprüfung (das Projekt ist strict)
npm run build               # Produktions-Build des Clients
```

Wenn du Server- oder Headless-Code geändert hast, führe außerdem
`npm run build:server` und `npm run build:env` aus.

Teste deine Änderung anschließend sowohl auf dem Desktop als auch auf dem Handy,
einschließlich eines telefongroßen Viewports im Hoch- und Querformat, falls sie
etwas berührt, das Spieler zu sehen bekommen. Touch-Ziele sollten mindestens
40x40px groß bleiben und Formularfelder eine Schriftgröße von mindestens 16px
haben. Die UI-Standards sind in [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md)
dokumentiert.

## Den Pull Request eröffnen

Pushe deinen Branch und eröffne einen PR gegen `main`. Die
[Pull-Request-Vorlage](../../.github/PULL_REQUEST_TEMPLATE.md) führt dich durch eine
kurze Checkliste. Bitte fülle sie aus:

- Beschreibe, **was** sich geändert hat und **warum**.
- Verlinke jedes zugehörige Issue (zum Beispiel "Closes #123").
- Füge bei UI-Änderungen **Screenshots oder einen kurzen Clip** hinzu, auf Desktop
  und Handy.
- Bestätige, dass Tests, Typprüfung und Build durchlaufen und dass neue
  Zeichenketten übersetzt sind.

Ein grüner CI-Lauf und eine vollständige Checkliste sind das, worauf wir vor dem
Zusammenführen achten. Eine Maintainerin oder ein Maintainer schlägt vielleicht
Änderungen vor. Das ist ein normaler, kooperativer Teil des Prozesses und keine
Ablehnung. Wir bemühen uns, im Review freundlich und konstruktiv zu sein, und
bitten dich um dasselbe.

> Commit-Nachrichten und PR-Titel folgen den
> [Conventional Commits](https://www.conventionalcommits.org/) mit einem Scope,
> wo es passt (`feat(talents): ...`, `fix(net): ...`). Es ist eine Konvention, die
> wir mögen, und keine strikte Vorgabe. Klare, aussagekräftige Nachrichten zählen
> mehr als perfekte Formatierung.

<a id="localization"></a>

## Lokalisierung

World of ClaudeCraft erscheint in vielen Sprachen, und wir halten das so, während
das Spiel wächst. Jede spielersichtbare Zeichenkette wird in jede unterstützte
Sprache übersetzt.

- Sämtlicher für Nutzer sichtbarer Text ist ein `t()`-Key, der in
  [`src/ui/i18n.ts`](../../src/ui/i18n.ts) definiert ist. Füge eine neue Zeichenkette
  zuerst zur Sprache `en` hinzu und liefere dann eine echte Übersetzung in jede
  andere Sprache in `supportedLanguages`. Keine englischen Platzhalter und kein
  `// TODO`.
- Zahlen, Geld, Datumsangaben, Einheiten und Prozentwerte laufen über die
  Formatierer (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) statt über
  manuelles Zusammensetzen von Zeichenketten.
- Spielersichtbarer Text, der aus `src/sim/` oder `server/` stammt (die
  sprachneutral bleiben), muss in derselben Änderung an der Client-Grenze neu
  lokalisiert werden. Der Schutztest
  `npx vitest run tests/localization_fixes.test.ts` setzt das durch.

Wenn deine Änderung eine Zeichenkette hinzufügt und du sie nur in einigen Sprachen
schreiben kannst, ist das in Ordnung. Eröffne den PR und bitte in der Beschreibung
um Hilfe für den Rest. Wir helfen dir viel lieber beim Fertigstellen, als dass du
dich zurückhältst.

<a id="translating-the-game"></a>

## Das Spiel übersetzen

Möchtest du eine Sprache verbessern oder helfen, das Spiel in eine neue Sprache zu
bringen? Dafür musst du keinen Spielcode schreiben:

1. Öffne [`src/ui/i18n.ts`](../../src/ui/i18n.ts) und suche die Sprache, an der du
   arbeiten möchtest. Jedes Sprachobjekt führt dieselben Keys wie `en` auf.
2. Verbessere bestehende Übersetzungen oder überarbeite alle, die sich holprig
   lesen.
3. Führe `npx tsc --noEmit` aus, um sicherzustellen, dass nichts fehlt, und
   eröffne dann einen PR.

Um eine ganz neue Sprache vorzuschlagen oder über Tonfall und Terminologie zu
sprechen, starte einen Thread auf [Discord](https://discord.com/invite/worldofclaudecraft), und wir
helfen dir bei der Einrichtung. Muttersprachlerinnen und fließend sprechende
Personen sind besonders willkommen. Gute Übersetzungen lassen das Spiel sich für
Spieler überall wie zu Hause anfühlen.

## Fehler melden und Funktionen vorschlagen

Bitte verwende die
[Issue-Vorlagen](https://github.com/levy-street/world-of-claudecraft/issues/new/choose):

- **Fehlermeldung.** Durchsuche zuerst die
  [vorhandenen Issues](https://github.com/levy-street/world-of-claudecraft/issues),
  um Duplikate zu vermeiden, und gib dann die Schritte zur Reproduktion an, was du
  erwartet hast, was passiert ist und deine Umgebung (offline oder online,
  Browser, Desktop oder Handy).
- **Funktionswunsch.** Beschreibe das Problem, das du lösen willst, nicht nur die
  Lösung. Kontext hilft uns, das Richtige zu entwerfen.

## Hilfe bekommen

Steckst du fest oder möchtest einfach Hallo sagen? Komm in den
[Community-Discord](https://discord.com/invite/worldofclaudecraft). Keine Frage ist zu klein, und
neue Mitwirkende sind immer willkommen.

## Lizenz

Mit deinem Beitrag erklärst du dich damit einverstanden, dass deine Beiträge unter
der [MIT License](../../LICENSE) des Projekts lizenziert werden, derselben Lizenz, die
auch das Projekt abdeckt.

---

Danke, dass du an World of ClaudeCraft mitwirkst. Wir können es kaum erwarten, zu
sehen, was du gemeinsam mit uns baust.
