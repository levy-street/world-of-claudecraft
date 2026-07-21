# World of ClaudeCraft — v0.7 Release Notes

**Release:** v0.7
**Date:** 2026-06-16
**Previous release:** v0.6.0

This is a large release — **362 commits across ~104 merged pull requests** since
v0.6.0. The headline themes are a brand-new 5-player dungeon, a full character-art
overhaul, a deep suite of reactive enemy-AI behaviours, dozens of new chat commands,
a complete first-class mobile/touch control layer, full localization of the entire
game (UI, sim text, server messages, and the admin dashboard) across all supported
locales, and a broad security/server-integrity hardening pass.

---

## ✨ Highlights

- **New dungeon: The Drowned Temple** — a portal-reached, 5-player group instance.
- **Character art overhaul** — KayKit full-pack models, merged animation sets, and
  per-player skins; **chroma/skin selection** with an in-game character-sheet preview;
  new Druid **Cat Form** visual; Warlock **Imp** and **Voidwalker** demon pets.
- **Living enemies** — a whole suite of reactive mob behaviours: frenzy, fleeing,
  self-healing, cleave, pack rage, poison/armor-shred/wound debuffs, and a **War Stomp**
  boss mechanic.
- **Full mobile/touch support** — floating joystick, jump/autorun/jump buttons, a
  configurable "More" tray, pinch-to-zoom, haptics, left-handed layout, safe-area
  (notch) handling, and dedicated accessibility settings.
- **Localized everywhere** — the game, server messages, sim event text, and the entire
  admin dashboard are translated across all supported locales; the README is translated
  into 12 languages.
- **Dozens of new chat/slash commands** — social commands plus a large family of
  self-only "readout" commands for nearly every character/world system.
- **Security & integrity hardening** — stored-XSS prevention, WebSocket handshake
  hardening, auth-throttle correctness, atomic character caps, fairer tap/loot rights,
  and a chat profanity filter with moderation tooling.

---

## 🗺️ New Content & World

- **The Drowned Temple** — a new portal-reached, 5-player dungeon (#390).
- **Per-zone procedural soundtrack** — the procedural music system was expanded with
  distinct themes per zone (#361).
- **3D ground quest objects** — quest "sparkle" pickup objects now use real 3D models
  instead of flat markers (#360).

## 🧙 Characters, Classes & Pets

- **Chroma / skin selection** (#403) — a 1–4 chroma picker in online character
  creation (matching offline creation), persisted into the initial online character
  state and returned in character summaries so existing characters preview correctly.
  Adds an in-game character-model preview to the character sheet with centered chroma
  buttons, plus a shared `IWorld.changeSkin` action and online WS command so live skin
  changes update the local player and sync through snapshots.
- **KayKit full-pack character models** with merged animation sets and per-player
  skins (#396).
- **Druid Cat Form** now has a dedicated visual model (#298).
- **Warlock demon pets** — summonable **Imp** and **Voidwalker** (#348).
- **Class quality-of-life updates** (#392) and additional **class pet & combat updates**.
- **Weapon attachment** rendering fix so weapons mount correctly to the new rigs.
- **Wild boar** model rebuilt and optimized, with a stabilized brow/face rig
  (#170, plus follow-up asset fixes).

## ⚔️ Enemy AI & Combat Mechanics

A major pass on making mobs feel alive and reactive:

- **War Stomp boss mechanic** — periodic stun slam (#305).
- **Enraged mobs** frenzy faster, not just harder, as they're worn down (#300).
- **Desperate mobs** self-heal once when first wounded low (#303).
- **Melee mobs cleave** nearby players on each swing (#306).
- **Pack mobs frenzy** when a packmate is slain (wolves, etc.) (#309).
- **Venomous mobs** apply an on-hit poison DoT (#310).
- **Mortal Strike mobs** leave a healing-reduction wound on hit (#311).
- **Corrosive mobs** shred armor on hit via **Acid Spit** (#313).
- **Cowardly mobs** flee at low HP and call for help (#297).
- **Trivial low-level mobs** go passive and stop auto-aggroing higher-level players (#299).
- **Pathing fix** — chasing mobs now slide around camp props instead of pinning on
  them (#242).

## 💬 Chat & Slash Commands

### Social & utility commands
- `/help` — lists available chat commands (#228), with clarified general help text.
- `/roll` — random rolls for loot disputes (#225).
- `/afk` and `/dnd` — away status with whisper auto-replies (#226).
- `/r` — reply to your last whisper (#230).
- `/follow` — auto-trail another player (#229).
- `/inspect` — cross-player level/class/health readout (#265).
- `/join world` and `/join lfg` — global chat channels (#267).
- `/played` — total session time played (#232).
- `/where` — current zone, level range, and coordinates (#246).
- **Target-friendly commands** — target-nearest / cycle-friendly targeting (#247, #133).

### Self-only "readout" commands
A large family of commands that report your own state without affecting the world —
useful for accessibility, theory-crafting, and headless/RL inspection:

- Character & progression: `/stats`, `/xp`, `/gold`, `/gear`, `/abilities`,
  `/session`, `/played`.
- Combat & state: `/combat`, `/casting`, `/cooldowns`, `/buffs`, `/combo`,
  `/queued`, `/attack`, `/speed`, `/overpower`, `/form`, `/falling`, `/manaregen`,
  `/savedmana`, `/potion`, `/consumable`.
- Targeting & awareness: `/target`, `/targetbuffs`, `/range`, `/consider`,
  `/threat`, `/nearby`.
- World & social: `/zones`, `/pois`, `/graveyard`, `/dungeons`, `/completed`,
  `/quest`, `/party`, `/pet`, `/pettaunt`, `/arena`, `/listings` (World Market),
  `/buyback`, `/bags`.

(PRs #246–#296 and related.)

## 📱 Mobile & Touch Controls

A complete first-class touch layer for phones and tablets:

- **Floating move joystick** that springs to your thumb (#314).
- **On-screen buttons** — Jump (#315), Autorun (#318), Bags & Character (#321),
  Leaderboard/Ranks (#322), Emotes (#338), and nameplates toggle (#324).
- **Pinch-to-zoom** for the touch camera (#326).
- **Long-press an action-bar slot** to peek its tooltip without casting (#328).
- **Music toggle** in the More tray (#329).
- **Left-handed layout** that mirrors the joysticks (#331).
- **Idle joystick fade** so controls obscure less of the world (#332).
- **Haptic feedback** with a Haptics toggle (#333).
- **"More" tray** — height capped so it can't overflow short phones (#335), with
  Interact/"Use" promoted to the primary touch row (#347).
- **Accessibility settings** — Touch Controls Opacity (#342) and Touch Look Speed
  slider for the camera joystick (#344).
- **Safe-area / notch handling** — keeps the top-right HUD (#352), touch chat box
  (#353), and community/social rail (#354) clear of device notches.
- **Reliability** — stabilized joystick pointers (#140), touch controls hidden before
  world entry (#376), improved mobile shell entry, and a shared browser resolver for
  the mobile screenshot tooling.

## 🖥️ UI / UX

- **Emote wheel** and **camera collision** (#377 and related).
- **Draggable modal windows.**
- **Guild leave confirmation** dialog (#374).
- **Escape key** now closes the game menu (#373).
- **Bags window** anchored in the bottom HUD gap (#366).
- **Smoother automatic camera and nameplate motion**; smoother orbit and
  click-to-move turns.
- **Click-to-move** polish — the click-move button can now become a camera drag (#238).
- **Home header** — removed the redundant language selector from the nav.

## 🌍 Localization (i18n)

The entire player- and operator-facing surface is now translated:

- **Full game localization** across all supported locales (#380) — HUD, abilities,
  items/commerce, quests, world surfaces, and the home shell.
- **Talent names** localized with canonical terminology, consolidated into single
  override tables (#392 / refactor).
- **Server-sent system messages** and **sim event text** localized via the client
  matcher, with an **S3 sim-emit drift guard** test to prevent English from leaking
  through (`tests/localization_fixes.test.ts`).
- **Admin dashboard** fully localized across all supported locales — including the
  online-players Zone column, class labels, moderation/operator error messages,
  currency suffixes, relative times, and chart tooltips (#380 and follow-ups).
- **README translated into 12 languages**, with tech-stack badges and language nav
  (#380 docs).
- **Many correctness fixes** — cross-language leaks, copied-English values, stripped
  strings, French/Spanish talent terminology, restored diacritics, `{playerName}`
  interpolation in quest narratives, `/who` dead+dungeon status, disconnect strings,
  and locale-selector clipping on mobile.

## ⚡ Performance

- **Browser performance doctor** — in-app diagnostics for performance issues (#339).
- **Browser & mobile "performance feel"** improvements (#238); see
  `docs/performance-feel-audit.md`.

## 🔒 Security, Moderation & Server Integrity

Hardened as part of the release integrity pass (#372) and related work:

- **Chat profanity filter** with admin-managed lists and slur enforcement (#343).
- **Moderation tooling** — admin chat mute (#325) and auto-reporting of suspicious /
  abusive registrations (#325).
- **Stored XSS prevention** — untrusted player names are now escaped.
- **WebSocket hardening** — bounded handshake buffer; client input sent during the
  auth handshake is no longer dropped (#367 and related).
- **Auth throttle correctness** — backstop eviction no longer wipes live lockout
  counters; throttle eviction completes under floods (#375, #251, #218 follow-up).
- **Atomic character cap** enforcement; reject renaming a character while it's online;
  close play sessions correctly after fast disconnects; scope orphan play-session
  cleanup to the current realm.
- **Fairer combat/loot** — require real damage to claim mob tap rights; stop a
  stealthed player from shielding visible allies from aggro; clear opponent debuffs
  when a duel ends so DoTs can't kill the loser; re-validate trade/duel availability
  when an invite is accepted; confirm friend/ignore membership before reporting removal.
- **Dependency hygiene** — updated the audited `form-data` dependency; indexed
  registration-metadata checks for faster abuse detection.

## 🤖 Reinforcement Learning / Headless Env

- **Full class kit** now exposed in the RL action/observation space.
- **Target-distance observation** normalized on the same scale as nearby mobs, with a
  derived observation index and test coverage.

## 🌐 Community

- **MediaWiki community/fandom site** added with deterministic seed generation (#378).

## 📚 Documentation & Branding

- **Canonical brand casing** — standardized on **"World of ClaudeCraft"** across UI,
  docs, and SEO copy; removed remaining external brand references from dev comments
  and docs.
- **UI/UX, mobile & accessibility standards** documented (`docs/`).
- **Project docs** — `CLAUDE.md` made the canonical source referenced by `GEMINI.md`
  and `AGENTS.md`; root `CLAUDE.md` targets Claude Code Opus 4.8; fixed stale facts in
  subdirectory `CLAUDE.md` files; mandated full localization of all player-facing
  strings.

## 🐛 Additional Fixes (sim core & misc)

- Casts now complete at the tick boundary for deterministic timing (#sim).
- Toggling a buff off no longer re-arms its cooldown.
- Keep default keybinds for actions missing from older saved data.
- Restore focus after quest windows close; prevent quest-text / mobile-window overflow.
- Hardened chat, loot, combat, and headless input paths.
- Type reconciliation across v0.7 candidate integrations; unblocked fresh installs and
  test imports.

---

## ⬆️ Upgrade Notes

- **Determinism & i18n invariants are unchanged.** All new sim behaviour (mob AI, casts,
  duels) runs through the shared deterministic core; all new player-facing strings go
  through `t()` / the client localization matcher.
- **Mobile:** new touch controls and accessibility settings are available immediately;
  no migration required.
- **Operators:** the admin dashboard is now localized — verify your operator locale.
  Moderation gains chat mute, the profanity filter (admin-managed lists), and automatic
  suspicious-registration reports.
- **Reminder:** bump `package.json` `version` to `0.7.0` and tag the release (`v0.7.0`)
  to match prior release conventions.

---

*Generated from the `v0.6.0..release/v0.7` commit range. PR numbers reference the merged
pull requests; some changes landed as direct commits and are grouped by theme above.*
