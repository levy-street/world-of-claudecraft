# Boss ability art (2026-11-28): census and plan

The owner's ask of 2026-11-28: every boss ability in the Adventure Journal (Shift+J) gets
its own painted icon that shows what the ability does, in place of the shared procedural
glyphs, and the same icon shows in the journal's ability rows, the death recap's hit rows
and the boss cast bar.

This is **phase 1: the census and the plan.** No image has been generated. Phase 2 (the
paintings and the wiring) starts on the owner's OK of the HTML audit.

## Files

- `census.json`: one row per journal ability (every catalog page, both tiers, a Heroic-only
  ability included once): instance, boss, mechanic id, name, a plain line of what it does
  (the first sentence of its live journal summary), the current `iconId`, the sim damage
  labels it hits under (`hits`) and the bodies that deal them (the page's bodies plus
  `hitSources`, the death recap's index), the cast ids its cast bar shows, and the decision.
- `planned-boss-ability-art.json`: the same shape as the aura batch's
  `docs/achievements/smith-heart-aura-art-2026-11-19/accepted-aura-art.json`, with
  `status: "planned"` and no hashes yet: `reused` lists each painting taken as is, and
  `assets` holds one entry per NEW painting with the abilities it covers, its subject,
  palette, references and the exact prompt.
- The approval page (outside the repo): `E:/woc/entregas/raid_corazon/iconos_habilidades/plan.html`,
  grouped by instance and boss, each row with its icon today, the reused painting at 128 px
  and 40 px or the planned subject, and the plain description.

## How the census was taken

Every source in `JOURNAL_INSTANCES` (`src/ui/hud/journal/journal_catalog.ts`) was walked
through `source.view(boss, tier)` for Normal and Heroic, the same walk
`buildJournalHitIndex` (`src/ui/hud/journal/journal_hit_icons.ts`) makes, with text resolved
through the English catalog and the page's own value formatting (`pageValues`). Cast ids
come from each data-as-code page's `castId`; the shipped raid guide
(`src/ui/raid_boss_guide_view.ts`, Nythraxis and the Crucible) declares none, so its casts
were read off the encounters' `castingAbility` writes (`src/sim/encounters/nythraxis.ts`,
`ignivar.ts`, `varkhul.ts`): Deathless Rage; Searing Torrent, Rain of Cinders, Revolving
Inferno, Forge Wave, Apocalypse (the Ashcaller's), Judgment of the Forge; Forgefather's
Sweep, Tempering Ray, Cinder Orbs, Shared Pyre, Anvil's Decree, and the Forge Legion's
`crucible_quake` and `cinder_recalibrate`.

## Counts

- **278 journal ability rows** across the five dungeons, Nythraxis, the Crucible and the
  Smith's Heart (259 distinct procedural icon ids today).
- **48 rows REUSE 43 paintings already in the game.** A painting is reused only when its
  original brief depicts that very mechanic (the Smith's Heart aura of the same mechanic,
  the Nythraxis curse and Soul Rend auras). A painting a later aura merely borrowed is
  not reused for a different ability: Squall Ward and Stillstone get their own.
- **230 rows need NEW art: 221 new paintings.** A new painting is shared only where the
  journal shows the same ability more than once (the drakes' Barrowflame Breath, Tail Lash
  and Wing Gust; Forge-Fury on all five Smith's Heart bosses; Basalt Fist and Leaping Bolt
  coming back in the final fight).
- **Five new icon ids** split abilities that share one glyph today although they are
  different things: `dgn_temple_score` (The Score, now on Chorus's glyph),
  `dgn_wildheart_idol_wakes` (The Idol Wakes, on Spirit of the Hunt's),
  `dgn_wildheart_idols_breath` (Idol's Breath, on Wildheart Pulse's),
  `dgn_wildheart_hunters_ambush` (Hunter's Ambush, on Hunting Spear's) and
  `dgn_heart_soft_enrage_heat` (Ignazhar's Soft Enrage, on the Hammer's).

## Notes for the owner's review

- `raid_nythraxis_deathless_rage` reuses `nythraxis_deathless_stun.webp`, painted as
  "Deathless Rage Interrupted" (the wardstone beams cracking the crown): the ability's own
  answer rather than the rage itself.
- `raid_nythraxis_crown_endures` reuses `nythraxis_final_stand.webp` (a crowned deathless
  warlord in a haste frenzy, no live aura wears it today) for the hard enrage.
- `dgn_heart_grieving_fury` reuses Memory of Stone (the survivor's buff once the fallen
  one's soul lands), so it does not repeat Masterless Fury's roaring head.
- `dgn_heart_wellkeeper` reuses Kindling Mark (the mark the Wellkeepers put on players) and
  `dgn_heart_splinter_heat` reuses Bursting Coal (the coal its Splinter makes players carry).
- 52 rows deal no damage under their own label and show no cast bar (passives, add rules,
  floor rules): their icon shows in the journal only.
- Hammer's Weight has a cast bar and deals its blow through `heavySwing` under its own name
  (`src/sim/encounters/smith_heart/council_wrath.ts`), yet its journal row lists no `hits`,
  so the death recap shows that blow with no journal icon today. Phase 2 adds the label.

## Phase 2 wiring plan (module-first)

One pure resolver decides which painting a journal icon id wears; every surface already
draws journal icons through `iconDataUrl('ability', iconId)`, so two of the three surfaces
need one hook and nothing else.

1. **`src/ui/boss_ability_art.ts`** (new, pure: no DOM, a `UI_PURE_CORES` row):
   `BOSS_ABILITY_IMAGE_IDS` (the icon ids painted under `public/ui/boss-abilities/`),
   `BOSS_ABILITY_REUSED_ART` (icon id to an existing `/ui/auras/*.webp`, the `reused` list of
   `planned-boss-ability-art.json`) and `bossAbilityImageUrl(iconId): string | null`.
   Shipping files: 128 px opaque WebP, at most 6 KB, encoded exactly like the aura batch
   (sharp, lanczos3, quality stepping down from 76), provenance rows in a new
   `public/ui/boss-abilities/mapping.json`.
2. **`src/ui/icons.ts` `staticIconUrl`**, the `kind === 'ability'` arm: after
   `abilityImageUrl(id)`, `bossAbilityImageUrl(id)`. That one line paints:
   - the journal's ability rows and opened ability (`journal_page_html.ts`, both
     `iconDataUrl('ability', mechanic.iconId, ...)` calls);
   - the death recap's hit rows (`death_recap_dialog.ts` draws `card.iconId`, which
     `death_recap_view.ts` takes from `deathRecapJournalIcon`, the journal hit index).
   Procedural recipes stay as the fallback (`hasExplicitAbilityIcon` still holds for every
   id, so `tests/boss_journal_view.test.ts` keeps passing); the five split ids get a recipe
   and their page rows move to the new id.
3. **The boss cast bar** (`#tf-castbar`, painted by `src/ui/cast_bar_painter.ts`): its
   markup already carries an empty, hidden `<span class="ui-cast-icon">` (styled in
   `src/styles/library.css`). Today no code fills it.
   - **`src/ui/hud/journal/journal_cast_icons.ts`** (new, pure, the sibling of
     `journal_hit_icons.ts`): one index of (caster mob template, cast id) to the journal
     `iconId`, built from the same catalog walk, so a player ability or a trash mob with the
     same cast name never borrows a boss icon. It needs the cast ids on the view: the
     page def's `castId` passed through `buildJournalPhases` onto `JournalMechanic`
     (a `castIds` field), and a `casts` field on the raid guide's `MechanicDefinition`
     carrying the ids listed above. Casts by adds (the Ashcaller, Crucible Wardens, Cinder
     Artificers, the final fight's Splinters) resolve through `hitSources`.
   - **`CastBarPainter`**: an optional `icon` element and `resolveCastIcon` option; the
     paint input gains the caster's `templateId`; the icon is written through the host's
     elided writers (a no-op frame stays free) as a `background-image` from `iconDataUrl`,
     and the span's `hidden` toggles with it. The player bar passes no resolver, so it is
     unchanged.
   - **`hud.ts`** only passes `target.templateId` into the existing input object and the
     option to the constructor, kept within the monolith ceiling
     (`tests/monolith_budget.test.ts`); the icon is cosmetic and never hides the bar or its
     label.
   - The overhead nameplate cast bars (`src/render/nameplate_*`) stay text only: out of
     scope.

### Tests that pin it (phase 2)

- `tests/boss_ability_art.test.ts` (new, modelled on `tests/smith_heart_aura_art.test.ts`):
  every journal icon id resolves to a painting (the census: a new journal ability fails
  until it is painted, reuses one, or is listed as unpainted with a reason), every file
  exists and is at most 6 KB at 128 px, `mapping.json` and the manifest agree, and each
  reused id points at the file named in `planned-boss-ability-art.json`.
- `tests/journal_cast_icons.test.ts` (new): every journal cast id resolves for its caster,
  a same-named cast by a body that is not on the page resolves to null, and no
  (caster, cast) pair maps to two icons.
- `tests/cast_bar_painter.test.ts` (existing): the icon slot paints, clears on hide and
  costs no write on an unchanged frame.
- `tests/journal_hit_icons.test.ts` and `tests/death_recap.test.ts` (existing): Hammer's
  Weight's new `hits` label, and a recap row drawing the painted URL.
- `tests/architecture.test.ts`: the two new pure cores in `UI_PURE_CORES`.

## Phase 2: the Smith's Heart (shipped 2026-11-28)

The owner narrowed phase 2 to **the Smith's Heart only**: the five dungeons, Nythraxis and
the Crucible keep their procedural glyphs (their rows in `census.json` and
`planned-boss-ability-art.json` stay a plan).

- **105 journal ability rows, 94 icons:** 59 new paintings (65 rows) and 35 reused raid aura
  paintings (40 rows). Forge-Fury shares one painting across the five bosses; Basalt Fist
  and Leaping Bolt share theirs with the final fight; the final fight's Wake the Stone, Sky
  Strike, Crossing Blade, Groaning Ice and Drawn Lightning wear the earlier bosses' marks.
- **Four planned reuses were re-judged and painted new** (each reason is in
  `generation-report.json` `reuseRejudged`): Grieving Fury (Memory of Stone is a memorial
  tablet, not the survivor's grief and haste), Wellkeepers (Kindling Mark is the mark they
  cast, not the two adds), Splinter of the Heat (Bursting Coal is the Live Coal debuff, not
  the Splinter and its Cinder Trail) and Quenching Cold (the debuff's flat hand-authored
  snowflake is off the painted style; the journal gets a painted ice snowflake, never a
  gauntlet, which read as a hand in the 2026-11-25 playtest).
- **Ignazhar's Soft Enrage has its own id**, `dgn_heart_soft_enrage_heat` (a recipe in
  `src/ui/icons.ts` and its own painting), apart from the Hammer council's.
- **Hammer's Weight's row lists its blow** (`hits: [COUNCIL_NAMES.weight]`), so the death
  recap draws it with the journal icon; `tests/journal_hit_icons.test.ts` now scans
  `heavySwing` calls too.
- **Generated** through the owner's ChatGPT image generation in the Codex CLI (`codex exec`,
  one session per image, the style reference `public/ui/auras/stomp_stun.webp` upscaled to
  512px attached to each). Every output was reviewed full size and at 40px; 6 outputs (5
  icons) were rejected and redone, recorded in `generation-report.json`. The exact accepted
  prompts, subjects, palettes and hashes are in `accepted-boss-ability-art.json`; full-size
  sources stay in the gitignored `tmp/imagegen/boss-ability-art-2026-11-28/`.
- **Shipping:** 128px opaque WebP under `public/ui/boss-abilities/`, encoded with sharp
  (cover, lanczos3, flattened on black, quality stepping down from 76 until at most 6144
  bytes), provenance rows in `public/ui/boss-abilities/mapping.json`.

### Wiring as built

- `src/ui/boss_ability_art.ts` (a `UI_PURE_CORES` row): `BOSS_ABILITY_IMAGE_IDS`,
  `BOSS_ABILITY_REUSED_ART` and `bossAbilityImageUrl`; `src/ui/icons.ts` `staticIconUrl`
  asks it after `abilityImageUrl`, which paints the journal rows and the death recap.
- `src/ui/hud/journal/journal_cast_icons.ts`: the (caster template, cast id) index over the
  journal catalog, read from the mechanic views' new `castId` and the page's bodies,
  `hitSources` and a new `castSources` (the Breath page names its isle casters, the Gale
  Mender and the Gust Herald). `journalCastArtUrl` answers painted art only, so every other
  journal's casts leave the bar's icon slot hidden, as before.
- `src/ui/target_cast_bar.ts`: the target cast bar instance lifted out of `hud.ts` (its
  element refs, options and reused paint input), which passes the caster's `templateId`;
  `CastBarPainter` gained the optional `icon` element and `resolveCastIcon` option, reruns
  the resolve only when (caster, cast) changes, and writes the slot through the elided
  writers. `hud.ts` dropped 33 lines and its monolith ceiling with them.
- The nameplate cast bars stay text only.

### Pins

`tests/boss_ability_art.test.ts` (census, files, budget, distinct bytes, mapping and
manifest parity), `tests/journal_cast_icons.test.ts` (the cast index and the target cast
bar), `tests/cast_bar_painter.test.ts` (the icon slot), `tests/journal_hit_icons.test.ts`
(Hammer's Weight) and the `tests/architecture.test.ts` pure-core rows.

The owner's approval page (outside the repo):
`E:/woc/entregas/raid_corazon/iconos_habilidades/corazon.html`, with in-game captures in
`capturas/` beside it.
