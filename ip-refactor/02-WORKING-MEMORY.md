# 02 — Shared working memory (live integration log)

> Fresh log, seeded at START (nothing renamed yet). Forward-looking only; NOT the source of
> truth. **The authoritative current contract is the code + the gates:** the LOCKED `NAME-MAP.md`
> (every old -> new string), `tests/ip_scrub.test.ts` (the verbatim-name scanner + its worklist),
> `tests/parity` (behavior unchanged), `tests/i18n_resolved_equivalence.test.ts` (the SHA gate).
> Read those for exact names/ids. This file is the running summary + the append-only registries.
>
> Read order each session: `README.md` (goal, surface map, scope) + `00-SHARED-CONVENTIONS.md`
> (rules, regen sequence, prime directive) + the LOCKED `NAME-MAP.md` FIRST. Do not re-derive
> what those hold.

## Status board (execution order: gate -> map -> tracks -> finale)
| ID | Title | Track | Mode | Status | Branch @ commit |
|----|-------|-------|------|--------|-----------------|
| G0 | De-IP gate + verbatim-name scanner | Spine | plain | done-on-track (2026-07-02; scanner RED by design: 142 baseline violations; all behavior gates green) | feature/ip-pivot @ G0 commit |
| G1 | Generate + lock the NAME-MAP | Spine | ULTRACODE | done-on-track (2026-07-02; 588 map rows, 603 names adversarially screened, 2 skeptic refutations fixed; scanner arms the full map: 812 RED baseline; old-column 100% hit-verified; AWAITING OPERATOR LOCK) | feature/ip-pivot @ G1 commit |
| V1 | Ability / spell rename | Vocab | plain | not-started | — |
| V2 | Talent + spec/tree rename | Vocab | plain | not-started | — |
| C1 | Creatures + coined family-id sweep | Creatures | ULTRACODE | not-started | — |
| C2 | Warlock demon-pet re-theme + pet-id sweep | Creatures | ULTRACODE | not-started | — |
| W1 | Item / set / augment rename | World | plain | not-started | — |
| W2 | Mob mechanic / aura name rename | World | plain | not-started | — |
| T1 | De-brand comments / docs / realm copy | Text | plain | done-on-track (track/ip-text @ dc407244, 2026-07-02, Fable 5 session) | track/ip-text |
| Z1 | Integrate + regen + scanner-zero + release-fill handoff | Finale | plain | not-started | — |

Status values: `not-started` -> `in-progress (<who>)` -> `done-on-track (<branch> @ <sha>)` ->
`merged (<integration-sha>)`.

## NAME-MAP lock state (owned by G1) — the #1 cross-slice contract
- [x] G1 has filled every Coverage-checklist row in `NAME-MAP.md` (2026-07-02).
- [x] Operator has reviewed and flipped `NAME-MAP.md` STATUS to **LOCKED** (2026-07-02).
  Decisions at lock: all former generic-keep? rows decided (5 keeps: Sap, Smite, Claw, Dash,
  Rip; Wolf Form and Blessed Tallow keep their text); Mogger cluster KEPT as parody with the
  operator-authorized removal of 'Mogger' from the scanner HARDCODED_VERBATIM (same commit);
  Tunnel Rat Digger renamed (Deeprock Digger); Brandt greeting reworded; tier sets renamed
  (Barrowlord/Nightfang/Mournweave/Bonewrought/Direfang/Wraithfire/Galecall); realm word =
  "World"; ~35 SEO-mined names adopted (Semrush-verified + adversarially screened) incl.
  pairing cascades - see the map's lock header for the list.
- [x] Post-lock operator amendment (2026-07-02, final): ~22 new-name refinements from the
  operator's workbook margin notes (Quaking Slam, Bewitch, Icebind, Mending Waters, Menace,
  Lunar Tempest, specs Fieldcraft/Thundercall/Warspirit, unified X's-Guise aspects, ...);
  three operator suggestions declined for IP (Guardian, Ironeye, Thunderlord). Old/armed
  columns untouched - scanner baseline stays 920. Map final and frozen from here.
- Until both are checked, NO V/C/W/T slice may start. Append-only after LOCK; a slice needing a
  missing string STOPS and appends a request row here for the operator, never invents a name.

## OPERATOR RULING - parity goldens under rename (2026-07-02, Phase 4)
V1 and W1 independently proved the goldens' per-checkpoint `events` digests fold event TEXT
(display names embedded), so ANY display rename shifts them while every state hash, RNG
draw-order fingerprint, draw count and nextId stays byte-identical. Operator extended the
C1/C2 golden exception to ALL rename slices: re-mint with UPDATE_PARITY=1, then
`node ip-refactor/golden_token_inspector.mjs <worktree>` MUST pass before commit; the four
hardcoded old names in tests/parity/coverage.test.ts update to their new names (authorized
gate-text edit). Integrator re-mints on the merged tree in Phase 5; Z1 inspector-verifies the
final goldens. Map amendment #2 in the same ruling: Quaking Blow / Armor Shear / Oath of Iron
/ Seething Fury (+ pairings) and polymorph critter sheep -> toad.

## Scanner worklist registry (owned by G0) — the verbatim names still present
> G0 seeds this from the RED baseline (the names `tests/ip_scrub.test.ts` currently flags). Each
> track ticks the entries it clears. Z1 requires the whole list ticked (scanner fully green).

Seeded by G0 on 2026-07-02 from the RED baseline: **142 violations** across the armed
denylist (`npx vitest run tests/ip_scrub.test.ts`). Counts are baseline occurrence counts over
BOTH English layers (sim content `.name` fields + the resolved-en table's name/title fields).
Rows are per (denylist entry x owning slice), disambiguated by the FIELD each hit lands in:
ability-name fields are V1's, talent/spec-tree fields are V2's, mob mechanic/aura `.name`
fields (`mobs.<id>.mortalStrike/petSpell/stomp/purgeOnHit.name`) are W2's - so a shared name
(Mortal Strike, Fireball, Judgement, ...) appears once per owner and each track ticks only its
own row. A track's row is cleared when the scanner reports zero hits for that entry in that
track's fields.

**v0.19.0 additions screening (G0, 2026-07-02):** `git diff release/v0.18.0..release/v0.19.0
-- src/sim/content/ src/ui/i18n.catalog/` is EMPTY (that release changed CI tooling only), so
there are ZERO "v0.19.0 additions - need NAME-MAP rows". Nothing extra for G1.

The NAME-MAP is still PROPOSED/DRAFT, so this seed = the hardcoded verbatim-WoW list + the
map's sample rows. G1's LOCK finalizes the `old`-column source; any row it adds/flips arms or
disarms in the scanner automatically (the scanner re-parses the map at each run), so THE
BASELINE COUNT WILL GROW at G1 lock (verbatim ability names like Battle Shout, Hamstring,
Overpower, Frost Nova, Arcane Intellect, Holy Light, Arcane Shot, Frost Shock, Faerie Fire,
... are in the tree today but unarmed until their map rows exist).

| denylist entry | owning slice | baseline hits | cleared? |
|---|---|---|---|
| Heroic Strike (ability-name fields) | V1 | 2 | [ ] |
| Mortal Strike (ability-name fields) | V1 | 2 | [ ] |
| Sinister Strike (ability-name fields) | V1 | 2 | [ ] |
| Sunder Armor (ability-name fields) | V1 | 2 | [ ] |
| Thunder Clap (ability-name fields) | V1 | 2 | [ ] |
| Bloodthirst (ability-name fields) | V1 | 2 | [ ] |
| Shield Slam (ability-name fields) | V1 | 2 | [ ] |
| Fireball (ability-name fields) | V1 | 2 | [ ] |
| Frostbolt (ability-name fields) | V1 | 2 | [ ] |
| Pyroblast | V1 | 2 | [ ] |
| Arcane Missiles (ability-name fields) | V1 | 2 | [ ] |
| Polymorph (ability-name fields) | V1 | 2 | [ ] |
| Ice Barrier (ability-name fields) | V1 | 2 | [ ] |
| Eviscerate (ability-name fields) | V1 | 2 | [ ] |
| Slice and Dice | V1 | 2 | [ ] |
| Judgement (ability-name fields) | V1 | 2 | [ ] |
| Hammer of Justice | V1 | 2 | [ ] |
| Lay on Hands (ability-name fields) | V1 | 2 | [ ] |
| Consecration | V1 | 2 | [ ] |
| Mind Blast (ability-name fields) | V1 | 2 | [ ] |
| Arcane (tree, whole-value) | V2 | 1 | [ ] |
| Fire (tree, whole-value) | V2 | 1 | [ ] |
| Frost (tree, whole-value) | V2 | 1 | [ ] |
| Holy (tree, whole-value) | V2 | 2 | [ ] |
| Blessing of Sanctuary | V2 | 1 | [ ] |
| Ardent Defender | V2 | 1 | [ ] |
| Improved Fireball | V2 | 1 | [ ] |
| Heroic Strike (talent-name fields) | V2 | 1 | [ ] |
| Mortal Strike (talent-name fields) | V2 | 1 | [ ] |
| Sinister Strike (talent-name fields) | V2 | 1 | [ ] |
| Sunder Armor (talent-name fields) | V2 | 1 | [ ] |
| Thunder Clap (talent-name fields) | V2 | 2 | [ ] |
| Bloodthirst (talent-name fields) | V2 | 1 | [ ] |
| Shield Slam (talent-name fields) | V2 | 1 | [ ] |
| Fireball (talent-name fields) | V2 | 1 | [ ] |
| Frostbolt (talent-name fields) | V2 | 1 | [ ] |
| Arcane Missiles (talent-name fields) | V2 | 1 | [ ] |
| Polymorph (talent-name fields) | V2 | 1 | [ ] |
| Ice Barrier (talent-name fields) | V2 | 1 | [ ] |
| Eviscerate (talent-name fields) | V2 | 1 | [ ] |
| Judgement (talent-name fields) | V2 | 2 | [ ] |
| Lay on Hands (talent-name fields) | V2 | 1 | [ ] |
| Murloc | C1 | 2 | [ ] |
| murloc (prose, word-boundary) | C1 | 6 | [ ] |
| Slimy Murloc Scale | C1 | 2 | [ ] |
| candle-headed (prose) | C1 | 2 | [ ] |
| Tallow Candle | C1 | 2 | [ ] |
| Tallow Candle (prose) | C1 | 0 (belt-and-braces) | [ ] |
| Bristleback | C1 | 4 | [ ] |
| Bristleback Maul | C1 | 2 | [ ] |
| Bristleback Hides | C1 | 2 | [ ] |
| bristleback (prose, word-boundary) | C1 | 0 (belt-and-braces) | [ ] |
| Drakonid | C1 | 2 | [ ] |
| Sanctum Drakonid | C1 | 2 | [ ] |
| Mogger | C1 | 13 | n/a - operator KEEP (parody); scanner entry removed at lock |
| Imp | C2 | 4 | [ ] |
| Voidwalker | C2 | 4 | [ ] |
| Succubus | C2 | 4 | [ ] |
| Felhunter | C2 | 4 | [ ] |
| Felguard | C2 | 4 | [ ] |
| Infernal | C2 | 4 | [ ] |
| Doomguard | C2 | 4 | [ ] |
| Shadowmeld | W1 | 2 | [ ] |
| Shadowmeld Tunic | W1 | 2 | [ ] |
| Lightwell | W1 | 2 | [ ] |
| Mortal Strike (mob `mortalStrike.name` aura field) | W2 | 1 | [ ] |
| War Stomp (mob `stomp.name` aura field) | W2 | 1 | [ ] |
| Devour Magic (mob `purgeOnHit.name` aura field) | W2 | 1 | [ ] |
| Mind Blast (mob `petSpell.name` aura field) | W2 | 1 | [ ] |

## Generated-artifact touch log (the ONLY parallel conflict surface)
> Every rename slice regenerates these. The integrator resolves conflicts by RE-RUNNING the
> generators (`i18n:gen` + `i18n:hash --write` + `wiki:content`), never a hand-merge. Log which
> slice last regenerated so the integrator knows to re-run.

| artifact | last regenerated by |
|---|---|
| `src/ui/i18n.resolved.generated/*` | T1 (2026-07-02, realm->world copy swap) |
| `src/ui/i18n.resolved.sha256` | T1 (2026-07-02, re-baselined via `i18n:hash --write`) |
| `src/guide/content.generated.ts` | T1 ran `wiki:content` 2026-07-02; output byte-identical (no guide string moved) |

## Decisions & gotchas (honor across all sessions)
- **T1 done-on-track (2026-07-02) — Z1 reword-staleness note (realm->world copy swap, operator
  word "World"):** English source reworded for the realm-as-server copy; the 20 non-English
  overlays (and inline en_CA blocks) keep the OLD word and CI stays green. Z1/maintainer must
  re-fill locales for: `mode.*` (serverAria/serverLabel/onlineDesc/onlineAria), `auth.*`
  (enterRealm/realmList/loadingRealms/changeRealm/realm/noAccountPrompt), `stats.title`/
  `stats.realmName`, `comingSoon.featureComingSoon`, `highscores.desc`, `seo.description`/
  `seo.officialBody`, shell `loading.connectingRealm`, shell `realm.*` (noRealms/loading/down/
  popTipMedium/popTipOffline/selectedRealm), shell `serverUnavailable.*` (title/eyebrow/heading),
  `game.leaderboard.realmCol`/`globalSubtitle`, hud `tips.joinChannels`, `bugReport.realm`,
  guide `faq.a3`/`community.heading`/`onlineBody`, card `realmSubtitle`/`shareText`, admin
  `bugReports.colRealm`/`ipAssociations.colRealm`. Also stale: the non-en dicts (incl. en_CA)
  embedded in `public/server-unavailable.html`, and the translated READMEs `docs/i18n/README.*.md`
  (still carry "vanilla" framing + old WoW spell-name examples — re-translate at release).
- **T1 residual dev-channel franchise refs deliberately left (hand to Z1's doc pass):**
  `docs/hud-ux-and-accessibility/research-brief.md` + `phase-*.md` + its `README.md` (research
  citations to third-party WoW/Blizzard sources; URLs can't be reworded), `docs/performance-feel-audit.md`
  ("like WoW" in quoted player feedback), test-file comments in `tests/chat_timestamp.test.ts`,
  `tests/fct_painter.test.ts`, `tests/trivial_mob_passive.test.ts` (dev-channel, outside T1's
  `src/` comment scope), `AGENTS.md` "Vanilla DOM UI" (generic tech term, not franchise), and
  `src/ui/icons.ts` `'blizzard'` icon keyword (generic weather noun in a matcher, not a name).
- **Reword-staleness trap (Z1 + release):** rewording an existing English key does NOT flip its
  20 locale rows to `pending`; CI stays green while every non-English overlay renders the OLD
  (WoW) name. Do NOT try to fix overlays in a track (contributor rule: English only). Z1 writes
  the maintainer a reconciliation note (diff `i18n.resolved.generated/en.ts` merge-base vs HEAD;
  re-fill every locale whose value did not also change) for the release-tier fill.
- **Coined-id sweep is the ONLY id change.** C1 (family `murloc`/`kobold`) and C2 (warlock pet
  ids) rename ids atomically; a parity golden may shift by EXACTLY the renamed token (inspector
  verifies). Every other slice freezes every id and leaves all goldens byte-identical.
- **Two English copies for abilities/items** (sim record + catalog) must stay byte-identical or
  `i18n_resolved_equivalence` reds. Talent names must equal an ability name or carry a title
  override (V2).
- **S3 co-location:** W2 (mob mechanic names) and C1 (quest prose) update `src/ui/sim_i18n.ts` in
  the SAME slice as the emit-literal edit, then run the S3 guard.
- **Residuals OUTSIDE the scanner's net (G0 coverage review, 2026-07-02) — Z1's doc pass must
  sweep these by hand:** the resolved table's `guide` section carries player-visible prose
  mentioning "murloc" and "imp" (`i18n.resolved.generated/en.ts` guide entries), and UI strings
  carry a verbatim "Righteous Fury" and a lowercase "judgement" (stat/tooltip copy). The scanner
  prose-scan is deliberately scoped to quest/greeting + entity fields (per the G0 brief), so
  these will NOT redden `ip_scrub`; scanner-green does not equal zero-residual for them. These
  regenerate from source via `i18n:gen`, so the V-track renames may clear some automatically —
  Z1 verifies by hand either way. Owner: T1/Z1.
- **The C2 pet denylist arms all 7 roster names** (incl. the generic-fantasy Imp / Succubus /
  Infernal) because the operator decision is to re-theme the WHOLE set. If that decision changes
  at NAME-MAP lock, those three are hardcoded in the scanner and need a deliberate edit there,
  not just a map flip (documented in the test header).

## REQUEST ROWS: Talents 2.0 flip, 51 granted-ability names (2026-07-07, pending operator sign-off)

The flip PR (choice rows) grants 51 abilities ported from the fun-pass
branch, all carrying verbatim WoW names. 9 resolve by existing locked rows
(Last Prayer, Bristleguard, Stilled Mind, Lifesap, Eleventh Hour,
Contingency, Racing Mind, Shadeslip, Silent Treatment). The remaining 42
need new rows; proposals below follow house style (grim grounded
dark-fantasy, existing family vocabulary: Guise aspects, Hex curses,
Grave/Wraith/Dread/Ward/Dirge families, Dirt Nap-register humor for rogue).
Implemented provisionally in the flip branch; every row is operator-vetoable
before the flip PR opens.

| old | proposed | family/rationale |
|---|---|---|
| Aspect of the Wild | Wildfang Guise | unified-aspects Guise family; Wildfang = feral spec |
| Avatar | Colossus | grounded, no franchise tie |
| Avenging Wrath | Wrathwing | wings visual; Wrath is a keep word |
| Berserk | Red Haze | grim, grounded |
| Bladestorm | Steel Cyclone | pairs with Bladed Gyre (whirlwind) |
| Blink | Flickerstep | mage teleport, Shadeslip register |
| Bloodlust | War Drums | classic alternative, grounded |
| Chain Lightning | Forked Lightning | natural phrase |
| Chaos Bolt | Ruinbolt | Ruination spec family |
| Cloak of Shadows | Shadecloak | Shade family |
| Cone of Cold | Frostsweep | descriptive |
| Counter Shot | Hushing Shot | interrupt flavor, Rattling Shot register |
| Counterspell | Spellbreak | descriptive |
| Curse of Exhaustion | Leaden Hex | Deepened Hex family |
| Death Coil | Grave Coil | Grave family |
| Deep Freeze | Deadfrost | grim |
| Divine Shield | Lightward | Ward family (Thunder Ward, Oathward) |
| Earthbind | Gripping Earth | descriptive |
| Evocation | Aetherwell | Aethermancy spec family |
| Frenzied Regeneration | Savage Mending | descriptive |
| Frost Trap | Rime Snare | Deep Rime family |
| Ghostly Strike | Wraith Strike | Wraithborn family |
| Hammer of Wrath | Tolling Hammer | knell/execute flavor |
| Healing Stream | Springwell | grounded |
| Heroic Leap | Warleap | descriptive |
| Holy Wrath | Saint's Ire | grim liturgical |
| Howl of Terror | Dread Howl | Dread family (demonology) |
| Ice Block | Cold Coffin | Dirt Nap register |
| Kick | Boot | Eye Jab/Dirt Nap register |
| Mend Pet | Patch Up | plain register |
| Meteor | Skystone | grounded |
| Mind Sear | Thoughtburn | descriptive |
| Multi-Shot | Splitshot | descriptive |
| Prayer of Healing | Choirmend | Pale Choir faction family |
| Psychic Scream | Terror Shriek | descriptive |
| Rallying Cry | Muster | ties to the Fenbridge Muster quest |
| Rebuke | Reproach | liturgical register |
| Shield Wall | Bulwark | Ironguard family |
| Skull Bash | Headbutt | plain register |
| Spell Lock | Gag Order | Silent Treatment family |
| Tranquility | Gladesong | Groveheart family |

RATIFICATION REQUESTS (already shipped in #1543, invented under time
pressure before this process was found; veto = rename in a follow-up):
| old | shipped | note |
|---|---|---|
| Feral Charge (ability) | Primal Surge | map's Path of Fangs is the choice-row name, kept reserved |
| Shadowform (ability) | Gloamveil Form | derived from locked Gloamveil (mastery); avoids exact display dup |
| Pummel | Jawcrack | missed in the first batch; warrior interrupt, Eye Jab register |
| Moonfury (row option) | Moonspite | balance druid row; Moongrove register |
| Shatter (row option) | Coldsnap Break | map's Brittlebreak is taken by the frost mastery |
| Aura Mastery (row option + new active) | Radiant Swell | paladin row-quality pass; the WoW-named passive option became a coined active (aura_surge); veto = rename in a follow-up |

RATIFICATION REQUESTS (warrior Blaine1705 talent port, 2026-07-09):
| old | shipped | note |
|---|---|---|
| Double Charge | Twin Onrush | warrior row option; pairs with Onrush ability |
| Pursuit | Hot Pursuit | warrior row option and kill-speed aura |
| Crushing Charge | Crushing Onrush | warrior row option; pairs with Onrush ability |
| Second Wind | Rallying Breath | warrior row option; avoids verbatim talent name |
| Die by the Sword | Swordguard | warrior row option and granted defensive cooldown |
| Victory Rush | Triumph Rush | warrior row option and granted kill-window strike |
| Piercing Howl | Razor Howl | warrior row option and granted AoE slow |
| Storm Bolt | Stormthrow | warrior row option and granted ranged stun |
| Anger Management | Rage Discipline | warrior row option; resource passive |
| Recklessness | Reckless Vow | warrior row option and granted offensive cooldown |
| Bloodbath | Red Harvest | warrior row option and kill-stack aura |
| Colossal Might | Giant's Momentum | warrior row option; rage-spend cooldown refund |
| Sanguine Aura | Red Banner | warrior row option and granted party damage cooldown |
