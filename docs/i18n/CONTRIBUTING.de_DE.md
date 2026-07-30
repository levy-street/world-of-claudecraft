<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · **Deutsch** · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Čeština](CONTRIBUTING.cs_CZ.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

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

Du brauchst [Node.js 26](https://nodejs.org/) und npm, also die Versionen, die
auch die CI und das Produktions-Image verwenden. Ältere Hauptversionen sind nicht
getestet. Für den Mehrspieler-Server solltest du außerdem
[Docker](https://www.docker.com/) haben, um Postgres auszuführen.

```bash
# 1. Forke das Repo auf GitHub und klone anschließend deinen Fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Abhängigkeiten installieren
npm ci

# 3. Git auf die Repository-Hooks zeigen lassen (einmal pro Clone)
git config core.hooksPath .githooks

# 4. Starte den Offline-Client (kein Server und keine Datenbank nötig)
npm run dev          # öffne die ausgegebene URL (meist http://localhost:5173)
```

Das reicht aus, um die Offline-Welt zu spielen und an den meisten Dingen zu
arbeiten. Um den vollständigen Online-Stack auszuführen, brauchst du zuerst ein
Datenbank-Passwort in deiner Umgebung:

```bash
cp .env.example .env
# setze POSTGRES_PASSWORD und richte DATABASE_URL auf dasselbe Passwort aus
npm run db:up        # starte Postgres 16 in Docker (Entwicklungs-DB auf Port 5433)
npm run server       # baue und starte den autoritativen Spielserver auf :8787
npm run dev          # in einem anderen Terminal; der Client leitet zum Server weiter
```

Wenn du das vollständige Gate weiter unten ausführen möchtest, installiere einmalig
den Browser, den es steuert: `npx playwright install chromium`.

Die [README](../../README.md) enthält den vollständigen Leitfaden zum Hosten,
Entwickeln und Spielen, und die `CLAUDE.md`-Dateien im gesamten Repo dokumentieren
die Konventionen für jeden Bereich.

### TypeScript-Toolchain

Die Typprüfung läuft auf TypeScript 7, dem nativen Compiler: `npx tsc --noEmit`
funktioniert genau wie zuvor, und eine vollständige Repo-Prüfung dauert jetzt
wenige Sekunden statt Dutzender Sekunden. Die Installation nutzt den offiziellen
Doppel-Alias: Das Paket `typescript` löst die JS-API von TypeScript 6 auf (über den
Wrapper `@typescript/typescript6`), weil `svelte-check` diese API weiterhin
benötigt, während `@typescript/native` die `tsc`-Binary bereitstellt. Wichtig zu
wissen:

- **Editoren.** VS Code benötigt die Marketplace-Erweiterung "TypeScript 7"
  (`TypeScriptTeam.native-preview`) für die native Sprachdienst-Unterstützung, bis
  die eingebaute Unterstützung erscheint; sie lässt sich über die Einstellung
  `js/ts.experimental.useTsgo` umschalten, und ihr Befehl "Disable TypeScript 7
  Language Server" ist der vorgesehene Rückfallweg auf den tsserver von
  TypeScript 6. JetBrains-IDEs erkennen den nativen Server nur unter dem Paketnamen
  `@typescript/native-preview` automatisch, greifen ihn also nicht über den Alias
  `@typescript/native` dieses Repos auf; ihre mitgelieferte Unterstützung für
  TypeScript 6 funktioniert einwandfrei.
- **Nützliche tsc-Flags.** `--checkers N` legt die Anzahl paralleler
  Typprüfer-Worker fest (Standard 4; die Ergebnisse sind bei jeder Anzahl
  identisch): Verringere sie, um den Speicherbedarf auf einem knappen Runner zu
  begrenzen, erhöhe sie auf einer Maschine mit vielen Kernen, und miss in beiden
  Fällen nach, denn mehr ist nicht immer schneller. `--singleThreaded` deaktiviert
  jede Parallelität. Eine einzelne Datei ad hoc zu prüfen (`npx tsc somefile.ts`)
  schlägt fehl, wenn das Verzeichnis eine `tsconfig.json` enthält; übergib
  `--ignoreConfig` für das alte Verhalten.
- **Lockfile.** Erzeuge `package-lock.json` ausschließlich mit
  `npx npm@10 install --package-lock-only` neu: Die Datei nutzt npm-10-Semantik, und
  neuere npm-Hauptversionen (einschließlich npm 11, das mit Node 26 in der CI
  mitgeliefert wird) verwerfen stillschweigend die verschachtelten
  Optional-Peer-Einträge von `svelte-check`, was `npm ci` in der CI aus dem Tritt
  bringt. Ein einfaches `npm ci` ist unter jeder npm-Hauptversion sicher. Prüfe nach
  dem Neuerzeugen, dass `npm ci --dry-run` sowohl unter npm 10 als auch unter dem npm
  deiner Arbeitsumgebung synchron ist.
- **Wann das neu zu bewerten ist.** Führe den Doppel-Alias erst dann wieder zu einer
  einzigen `typescript`-Abhängigkeit zusammen, wenn BEIDES gilt: Die stabile
  JS-API von TypeScript 7.1 ist erschienen (TypeScript 7.0 liefert überhaupt keine
  JS-API; der Ersatz wird in microsoft/typescript-go Issue 2824 verfolgt), und
  sveltejs/language-tools Issue 3063 wurde mit einem veröffentlichten
  `svelte-check` geschlossen, das sie übernimmt. Die experimentellen
  `--tsgo`-Modi von svelte-check heben seine Anforderung an die TypeScript-6-API
  nicht auf, und sein in Arbeit befindliches Laden von TypeScript 7
  (language-tools PR 3073) liest den Alias `@typescript/native`, den dieses Repo
  ohnehin schon verwendet, ein Umbenennen ist also nicht nötig.

## Deine Änderung umsetzen

1. **Beginne beim neuesten Release-Branch und niemals bei `main`.** Die aktive
   Arbeit wird auf einem `release/vX.Y.Z`-Branch integriert; `main` hinkt hinterher
   und ist nicht die Basis für Beiträge. Suche den neuesten und zweige davon ab:

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # der neueste Release-Branch
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   Führe diese Suche immer aus, statt eine Versionsnummer aus diesem Leitfaden zu
   übernehmen: Release-Branches wechseln häufig, und der neueste verschiebt sich mit
   jedem Release. Branches heißen `feature/<short-slug>` oder `fix/<short-slug>`.
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
- **Neue Logik landet als eigenes kleines, getestetes Modul hinter einer bestehenden
  Naht**, statt an eine der großen Koordinator-Dateien angehängt zu werden. Daten,
  die der Renderer oder das HUD liest, überqueren die `IWorld`-Schnittstelle
  (`src/world_api/`) und werden sowohl in der Offline- als auch in der Online-Welt
  implementiert; ein neues Simulationssystem liegt hinter `SimContext`; ein neuer
  REST-Endpunkt ist ein Routen-Modul, das du mit `npm run new:endpoint` aufsetzen
  kannst.
- **Bearbeite generierte Dateien nicht von Hand**, etwa `*.generated.ts`. Erzeuge
  sie über den Build-Prozess neu.
- **Hausstil für Texte: keine Geviertstriche, Halbgeviertstriche oder Emojis**,
  nirgendwo, weder im Code, in Kommentaren, in der Dokumentation, in
  Commit-Nachrichten, in PR-Texten noch in spielersichtbaren Texten. Verwende
  Kommas, Doppelpunkte, Klammern oder "bis" für Bereiche. Eine Prüfung vor dem Push
  durchsucht deinen Diff und blockiert den Push bei einem Treffer.
- **Committe niemals Geheimnisse** oder eine `.env`-Datei, und aktiviere niemals
  `ALLOW_DEV_COMMANDS` in einem Produktionspfad, da es Cheats freischaltet.

### Code-Stil

Für die Formatierung sorgt [Biome](https://biomejs.dev/), konfiguriert in
`biome.json`: 2 Leerzeichen Einrückung, 100 Zeichen Zeilenlänge, einfache
Anführungszeichen, abschließende Kommas. Formatiere nur die Dateien, die du
angefasst hast (`npx @biomejs/biome check --write <your-file.ts>`), und prüfe sie
mit `npm run ci:changed`. Die CI prüft ausschließlich geänderte Dateien, formatiere
also bitte nicht den restlichen Baum um: Ein repoweiter Lauf legt Altlasten offen,
die nicht deine Aufgabe sind.

## Bevor du einen Pull Request eröffnest

Führe das Repository-Gate lokal aus. Es ist derselbe Vertrag, den auch die CI
durchsetzt:

```bash
npm run gate
```

Während der Arbeit kannst du eine einzelne Suite ausführen
(`npx vitest run tests/sim.test.ts`) und `npm run ci:changed` für die Formatierung;
`npm test` führt alles aus, und die Übersicht der Suites steht in
`tests/CLAUDE.md`. Das vollständige `npm run gate` deckt die Aktualität der
generierten Artefakte ab, den Malware-Scan, die Formatierung geänderter Dateien,
die Konformitätsprüfung der Soundeffekte, die gesamte Testsuite, einen
Regressionsdurchlauf im echten Browser, die strikte Typprüfung sowie die Builds für
Client, Server und Headless. Die geschichteten Prüfungen, angefangen beim
Mindestmaß vor dem Push, sind in [`docs/qa-gate.md`](../qa-gate.md) beschrieben.

Teste deine Änderung anschließend sowohl auf dem Desktop als auch auf dem Handy,
einschließlich eines telefongroßen Viewports im Hoch- und Querformat, falls sie
etwas berührt, das Spieler zu sehen bekommen. Touch-Ziele sollten mindestens
40x40px groß bleiben und Formularfelder eine Schriftgröße von mindestens 16px
haben. Die UI-Standards sind in [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md)
dokumentiert.

## Den Pull Request eröffnen

Pushe deinen Branch und eröffne einen PR **gegen denselben neuesten
`release/vX.Y.Z`-Branch, von dem du ausgegangen bist. Ziele niemals auf `main`**,
das ein Integrationsbranch für Releases ist und nicht die Basis für Beiträge.
GitHub wählt oft `main` für dich vor, ändere den Basis-Branch also, bevor du
absendest. Die
[Pull-Request-Vorlage](../../.github/PULL_REQUEST_TEMPLATE.md) führt dich durch eine
kurze Checkliste. Bitte fülle sie aus:

- Beschreibe, **was** sich geändert hat und **warum**.
- Verlinke jedes zugehörige Issue (zum Beispiel "Closes #123").
- Füge bei UI-Änderungen **Screenshots oder einen kurzen Clip** hinzu, auf Desktop
  und Handy.
- Bestätige, dass `npm run gate` durchläuft und dass neue spielersichtbare
  Zeichenketten der unten beschriebenen English-First-Richtlinie für Mitwirkende
  folgen.

Bei deinem PR führt die CI Formatierung und Linting über deine geänderten Dateien
aus, die vollständige Testsuite über vier parallele Shards, einen
Browser-Regressionsdurchlauf sowie die Typprüfung und die Builds für Client, Server
und Headless. Das entspricht dem, was `npm run gate` lokal ausführt, ein grünes
Gate sagt also gut voraus, dass auch der PR grün wird.

Ein grüner CI-Lauf und eine vollständige Checkliste sind das, worauf wir vor dem
Zusammenführen achten. Eine Maintainerin oder ein Maintainer schlägt vielleicht
Änderungen vor. Das ist ein normaler, kooperativer Teil des Prozesses und keine
Ablehnung. Wir bemühen uns, im Review freundlich und konstruktiv zu sein, und
bitten dich um dasselbe.

> Commit-Nachrichten und PR-Titel folgen den
> [Conventional Commits](https://www.conventionalcommits.org/) mit einem Scope
> (`feat(talents): ...`, `fix(net): ...`). Jeder Commit trägt außerdem einen Body:
> nach einer Leerzeile ein bis vier schlichte Sätze, die sagen, was sich geändert hat
> und warum, umbrochen bei etwa 72 Spalten. Ein Titel allein reicht nicht.

<a id="localization"></a>

## Lokalisierung

World of ClaudeCraft erscheint in vielen Sprachen. Jede spielersichtbare
Zeichenkette muss ein Übersetzungs-Key sein, während Mitwirkende an Funktionen
normalerweise nur die englische Quelle hinzufügen.

- Sämtlicher für Nutzer sichtbarer Text ist ein `t()`-Key. Füge neue englische
  Texte dem passenden Modul pro Domäne unter
  [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) hinzu (neue HUD-Elemente
  gehören in `hud_chrome.ts`) und rendere sie dann mit `t('dotted.key', values)`.
  Nur Englisch ist für einen Feature-PR genau richtig: Die Maintainer füllen die
  übrigen Sprachen zum Release, du bearbeitest also die Overlays unter
  `src/ui/i18n.locales/` nicht und hinterlässt dort nie einen englischen Platzhalter
  oder ein `// TODO`. Die Ausnahme M16 ist ein neuer, wortreicher englischer Wert,
  der zusätzlich die fünf nicht-lateinischen Füllungen benötigt, die in
  [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md) beschrieben sind.
- Zahlen, Geld, Datumsangaben, Einheiten und Prozentwerte laufen über die
  Formatierer (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) statt über
  manuelles Zusammensetzen von Zeichenketten.
- Spielersichtbarer Text, der aus `src/sim/` oder `server/` stammt (die
  sprachneutral bleiben), muss in derselben Änderung an der Client-Grenze neu
  lokalisiert werden. Der Schutztest
  `npx vitest run tests/localization_fixes.test.ts` setzt das durch.
- Führe nach dem Hinzufügen oder Ändern einer Zeichenkette `npm run i18n:gen` aus
  und committe die neu erzeugten Bundles in derselben Änderung. Das Gate und die CI
  vergleichen die committeten Artefakte mit einer frischen Neuerzeugung, ein
  veraltetes Bundle lässt den Build also fehlschlagen.

Füge deine Zeichenketten also auf Englisch hinzu und eröffne den PR; du musst sie
nicht selbst übersetzen. Wenn du bei den Übersetzungen helfen möchtest, lies den
nächsten Abschnitt.

<a id="translating-the-game"></a>

## Das Spiel übersetzen

Möchtest du eine Sprache verbessern oder helfen, das Spiel in eine neue Sprache zu
bringen? Dafür musst du keinen Spielcode schreiben:

1. Die meisten spielersichtbaren Übersetzungen liegen in den Overlay-Dateien pro
   Sprache unter [`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) (eine pro
   Locale), die die englischen Keys in
   [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) spiegeln. Text, den die
   Simulation und der Server ausgeben, wird in `src/ui/sim_i18n.ts` und
   `src/ui/server_i18n.ts` übersetzt, Talent-Texte in den `talent_i18n`-Modulen, und
   das Admin-Dashboard hat einen eigenen Satz unter `src/admin/i18n.locales/`.
2. Verbessere bestehende Übersetzungen oder überarbeite alle, die sich holprig
   lesen.
3. Führe `npm run i18n:gen` aus, committe die neu erzeugten Bundles zusammen mit
   deiner Overlay-Änderung, führe dann die Lokalisierungs-Suites aus
   (`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`)
   und eröffne einen PR. Eine reine Typprüfung sagt dir nicht, ob ein Key fehlt,
   denn die Overlays sind bewusst lückenhaft.

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
- **Sicherheitslücken.** Bitte eröffne dafür kein öffentliches Issue. Melde sie
  vertraulich, indem du [SECURITY.md](../../SECURITY.md) folgst, und wir arbeiten
  mit dir an einer Behebung und an der Offenlegung.

## Hilfe bekommen

Steckst du fest oder möchtest einfach Hallo sagen? Komm in den
[Community-Discord](https://discord.com/invite/worldofclaudecraft). Keine Frage ist zu klein, und
neue Mitwirkende sind immer willkommen.

## Lizenz

Mit deinem Beitrag erklärst du dich damit einverstanden, dass deine Code-Beiträge
unter der [MIT License](../../LICENSE) des Projekts lizenziert werden, derselben
Lizenz, die auch das Projekt abdeckt.

Die MIT License meint genau das, was sie sagt: Jede und jeder darf den Code
verwenden, verändern und weiterverbreiten, kommerziell oder nicht. Unsere
[Nutzungsbedingungen](https://worldofclaudecraft.com/terms) regeln das von uns
betriebene gehostete Spiel auf worldofclaudecraft.com (Accounts, Verhalten,
virtuelle Gegenstände) und schränken die Rechte nicht ein, die die MIT License dir
oder anderen an diesem Code gibt. Die Namen und das Branding "World of ClaudeCraft"
und "Levy Street" sind nicht von der MIT License abgedeckt.

Originale kreative Assets (Tonaufnahmen, Musik, Grafik und ähnliche geschaffene
Werke) sind die Ausnahme. Wenn du ein originales, von dir erstelltes Asset
beisteuerst, darfst du stattdessen das Urheberrecht behalten und es unter einer
Lizenz deiner Wahl beisteuern (zum Beispiel CC BY-NC 4.0), vorausgesetzt:

- die Lizenz, die von ihr abgedeckten Asset-Pfade und deine Namensnennung werden im
  Rahmen desselben Pull Requests in der Lizenztabelle in
  [CREDITS.md](../../CREDITS.md) festgehalten, und
- sie enthält mindestens eine dauerhafte, lizenzgebührenfreie Erlaubnis für Levy
  Street, die Assets kommerziell in World of ClaudeCraft zu verwenden,
  einschließlich offizieller Releases und des In-Game-Shops.

Für Assets, die in der Tabelle in CREDITS.md aufgeführt sind, hat die dort
festgehaltene Lizenz Vorrang vor der standardmäßigen MIT-Lizenz des Projekts.

**Medien-Assets ohne Eintrag in CREDITS.md sind nicht unter MIT lizenziert.** Das
Register wird noch vervollständigt, ein fehlender Eintrag bedeutet also, dass die
Bedingungen nicht erfasst sind, und nicht, dass das Asset frei verwendbar ist. Das
ist Absicht: Es verhindert, dass ein nicht registrierter Beitrag standardmäßig
verschenkt wird. Bei Code ist es umgekehrt, und alles, was nicht in CREDITS.md
ausgenommen ist, steht unter MIT.

Genau deshalb ist der Registereintrag kein optionaler Papierkram. Wenn du ein Asset
ohne Zeile in CREDITS.md beisteuerst, kann es niemand weiter unten in der Kette
verwenden, und wir haben keinen Nachweis darüber, was du uns eingeräumt hast.
Trage auch die Spalte **Redistribution** ehrlich ein. Sie sagt jemandem, der dieses
Projekt forkt, ob er dein Asset weitergeben darf, und manche Zeilen sind genau
deshalb mit "No, permission required" markiert, weil das nicht erlaubt ist.

---

Danke, dass du an World of ClaudeCraft mitwirkst. Wir können es kaum erwarten, zu
sehen, was du gemeinsam mit uns baust.
