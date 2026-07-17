# Sound Effects: design, catalog and integration

Sampled sound effects for World of ClaudeCraft, played through a lightweight Web
Audio engine. Natural world and character cues can be produced with the
**ElevenLabs Sound Effects API** (`POST /v1/sound-generation`); UI/event cues use
deterministic local FFmpeg synthesis. This document is the human-readable
catalog. The authoritative machine list (prompts, durations, loop flags, and
generator ownership) lives in `scripts/sfx/sfx_prompts.mjs`.

## Goals
- **Immersive world layer:** footsteps that change with surface (grass / dirt /
  stone / wood / snow / water), swimming, jumping/landing, weapon swings &
  material-aware impacts, per-school spell cast/projectile/impact, per-family
  creature vocalizations, and ambient loops (wind, water, campfire, forge,
  dungeon, weather).
- **Correct spatial / proximal audio:** every world sound is positioned in 3D, so
  *other* players' and creatures' footsteps and combat attenuate with distance and
  pan with direction relative to the camera. Personal UI events (level-up, loot,
  quest, coin) stay non-positional.
- **Extreme efficiency:** one decoded buffer per published track (shared), a hard concurrency
  cap, distance culling that reuses the renderer's own range gate, per-entity
  footstep throttling, pooled looping sources, and zero per-frame allocation in
  the hot path.

## Authoring policy
World, combat, creature, ambience, and personal UI cues all live in the sampled
catalog. `src/game/audio.ts` remains a compatibility facade for its established
method names, but routes reachable UI calls through `sfx.playUi()` so every sound
is visible, previewable, replaceable, and masterable in the SFX Studio. The
deterministic `scripts/gen_ui_sfx.mjs` generator supplies the initial UI masters;
ElevenLabs remains the optional generator for natural world and character audio.

---

## Asset standard

Every file in `public/audio/sfx` conforms to one standard, applied by the
generation and Studio conform paths and enforced by `scripts/sfx_conform.mjs`
(`npm run sfx:check`). `scripts/gen_sfx.mjs` post-processes each generated clip
through it before writing, so a regenerated clip already meets the standard.

- **Container and codec:** MP3 (LAME) only. WebKit `decodeAudioData` (every iOS
  browser is WebKit, plus desktop Safari) has no Ogg Vorbis support, so OGG is
  ruled out; AAC in m4a is a possible future efficiency option and is out of
  scope. Lossless masters (`.wav`/`.flac`/`.aiff`) are accepted as sources and
  transcoded on conform.
- **Sample rate:** 44.1 kHz.
- **Bitrate:** 192 kbps for MP3 masters. A lossy source below 112 kbps is
  rejected (re-encoding cannot restore it); a hand-authored MP3 above the
  192 kbps ceiling is re-encoded down to it.
- **Loudness:** clips under 1 s normalize to a -6 dBFS true peak; clips at or
  above 1 s normalize to -14 LUFS integrated, and the LUFS branch verifies the
  real post-encode true peak against the same -6 dBFS ceiling on every attempt
  (MP3 encoding can push a clip's true peak above whatever the pre-encode
  limiter saw). Peak safety is the binding constraint: a wide-crest-factor clip
  that cannot reach -14 LUFS without breaching the ceiling ships as the best
  peak-safe result, under the nominal target and marked `peakLimited`
  (`conformSfxAudio` in `scripts/sfx/conform_audio.mjs`). `npm run sfx:check`
  accepts that peak-constrained shortfall and hard-fails an over-target LUFS
  or a true-peak overshoot (`classify` in `scripts/sfx/sfx_conform_rules.mjs`).
  On top of the asset ceiling, the engine caps per-play gain at 1.0 under a
  0.85 master, so runtime gain staging cannot clip a conformed clip.
- **Channels (mono/stereo policy per playback path):** mono, except global
  ambience beds. `playAt` positions a clip through an equalpower `PannerNode` that
  downmixes to mono before panning, and `playUi` sums to the mono master, so for
  a positional or personal cue a second channel is decoded into the shared
  `AudioBuffer` and then discarded; on the iOS Capacitor build (WKWebView) that
  decoded buffer memory is the binding constraint. Global ambience beds flagged
  `stereo: true` in `scripts/sfx/sfx_prompts.mjs` keep both channels because their
  L/R width is audible and they never pass through a panner. Water is one such
  global bed. Campfire and forge loops are positioned point sources, so they are
  mono. Sustained spell casts (`cast_*`) are positional and therefore mono. The policy is
  data-driven from that per-entry flag, never a hardcoded key list.
- **Naming:** snake_case `category_subject_variant`, and the filename equals the
  manifest key at `public/audio/sfx/<key>.mp3`. Ordered takes use `<key>_<n>.mp3`
  (contiguous from `_1`); dynamic creature variants use
  `mob_<family>_<subfamily>_<action>_<n>.mp3`. The category prefixes in use are
  `foot_`, `move_`, `melee_`, `impact_`, `combat_`, `player_`, `cast_`, `proj_`,
  `wand_`, `spell_`, `heal_`, `buff_`/`debuff_`, `mob_`, `amb_`, `lockpick_`,
  `quest_`, and `ui_`.

`npm run sfx:check` reports the loudness, format, and bitrate rules as hard
failures. The channel and naming rules are advisory by default (they print but do
not change the exit code), so the shipped world clips, which predate the mono
policy, do not break the gate before the one-time re-process. Pass
`npm run sfx:check -- --strict` to promote them to failures, and
`npm run sfx:conform` (`--fix`) to conform loudness and downmix in a single pass.

A third advisory category flags a `custom: true` key whose measured LUFS lands
suspiciously close to the generated-content target (`TARGET_LUFS`, -14): the
fingerprint of a key that was loudness-targeted before `custom: true` was set on
it and never re-derived from a pristine source since. It is advisory, not a hard
failure, because an author's own hot mix can coincidentally land there too and
this checker has no access to the external master-store source to tell the two
apart; verify by ear or against the source before treating a hit as a defect.

---

## Architecture

### `src/game/sfx.ts` — `Sfx` (singleton `sfx`)
A decoupled 3D engine with **its own `AudioContext` + `AudioListener`** (siblings:
`audio`/`music`/`voice`). Driven by the `sfxVolume` setting (wired alongside
`audio.setVolume` in `main.ts`). API:
- `init()` — gated on the same user gesture as `audio.init()` (`enterWorld`);
  preloads the startup working set and lazily deduplicates fetch/decode work for
  contextual cues.
- `setListener(x,y,z, fx,fy,fz)` — called once per frame by the renderer with the
  camera position + forward vector.
- `playAt(key, x,y,z, opts?)` — one-shot positional clip via a `PannerNode`
  (equalpower, linear rolloff, hard `maxDistance` cutoff). Random ±6% rate / ±2dB
  gain jitter so repeats (footsteps, swings) never machine-gun. Caller rate and
  jitter multiply the per-key authored playback rate from the manifest.
- `playUi(key, opts?)` — non-positional one-shot straight to the master bus.
- `loop(id, key, target, x?,y?,z?)` / `unloop(id, fade)` are pooled looping
  sources for ambience and sustained casts, cross-faded by gain and started at
  the per-key authored playback rate.
- Concurrency cap (`MAX_VOICES`), buffer cache, and a per-key cooldown protect the
  frame budget. Unknown keys / missing files are silent no-ops.

### Renderer integration (movement) — `src/render/renderer.ts`
Render must not import `game/`, so the renderer holds an injected
`SpatialAudioSink` interface (declared in `src/render/audio_sink.ts`); `main.ts`
wires the real `sfx` into it. In the existing per-entity `sync()` loop (~L1166–1338,
which already computes interpolated position, `loco.speed/moving`, `swimming`,
`airborne`, and squared distance `d2` to the player):
- **Footsteps:** a per-`EntityView` distance accumulator (`stepAccum += speed*dt`)
  fires `sink.footstep(x,y,z, surface, running, self)` each stride. Surface =
  `zoneBiomeAt(z)` (vale→grass, marsh→dirt, peaks→stone) → water if wading →
  dock decks→wood → dungeon→stone → snow if weather is snowing. Suppressed while airborne /
  swimming / dead and gated by `d2 < SFX_RANGE_SQ`.
- **Jump / land / splash / swim:** per-view edge detection on `airborne` and
  `swimming` transitions fires `sink.movement('jump'|'land'|'splash'|'swim', …)`.
- **Listener:** after the camera is positioned (~L1583), `sink.setListener(camPos,
  forward)`.

### Combat / event integration — `src/ui/hud.ts`
`handleEvents()` (~L2991–3279) already iterates drained `SimEvent`s with live
entity positions. It imports the `sfx` singleton (precedent: it already imports
`game/audio`) and, per event, plays positional clips at the relevant entity:
- `damage` → attacker **swing** (by weapon class of source) + target **impact** (by
  school for spells, by target material for physical: flesh / metal / leather /
  bone); `kind:'miss'|'dodge'` → whiff/dodge; `kind:'parry'` → parry; `crit` →
  overlay `combat_crit`. Player-as-target physical → `player_hurt`.
- `castStart` → per-school sustained `cast_*` loop at the caster, stopped on
  `castStop`/`death`. `spellfx{fx:'projectile'}` → `proj_<school>`; `fx:'nova'` →
  `spell_nova`. `heal2`/`heal` → `heal_impact`. `aura{gained}` →
  `buff_apply`/`debuff_apply`.
- `death` → creature **family death** (mob) or `player_death`. Mob **aggro**
  vocalization fires the first time a mob deals damage (no aggro SimEvent exists).
- Personal UI events keep the stable `audio.*` call surface while the facade
  resolves those calls to typed sampled `ui_*` keys.

### Surface & family mapping
- **Surface** (footsteps): `vale→grass`, `marsh→dirt`, `peaks→stone`, dock deck
  footprints→`wood`, dungeon→`stone`, wading (`y≤WATER_LEVEL-0.3` & not deep)→`water`,
  deep→`swim`, weather snow→`snow`. Source: the pure render audio resolver,
  `zoneBiomeAt`, `groundHeight`, and `WATER_LEVEL` from `src/sim/world.ts`.
- **Creature family** (vocalizations): `MOBS[templateId].family` maps to one of
  `beast`, `boar`, `spider`, `mudfin`, `burrower`, `humanoid`, `undead`, `troll`,
  `ogre`, `elemental`, `dragonkin`, or `demon`, with a
  `wild_boar`/`elder_bristleback` to **boar** templateId override.
- **Weapon class** (swings) & **material** (impacts) derive from the source/target
  player class or mob family (plate: warrior/paladin → metal; leather: rogue/hunter/
  shaman; cloth: mage/priest/warlock/druid; undead → bone; else flesh).

---

## Catalog

`spatial` = positioned 3D; `loop` = seamless looping (ElevenLabs `loop:true`).
Keys map to `public/audio/sfx/<key>.mp3`; the independently generated manifest
`src/game/sfx_manifest.generated.ts` carries a content hash, immutable URL,
preload class, spatial flag, byte count, resolved runtime gain, and playback rate.
An entry may declare ordered variants. Their files use
`public/audio/sfx/<key>_<number>.mp3`, and accepted one-shots cycle through the
ordered tracks. A persistent loop chooses one track when it starts and keeps it
until that loop stops.

### Movement & footsteps (spatial one-shots, pitch-randomized in code)
| key | dur | prompt summary |
|---|---|---|
| `foot_grass` | 0.5 | single soft footstep on grass and leaves, light boot, close, dry |
| `foot_dirt` | 0.5 | single footstep on wet mud and dirt, soft squelch, close |
| `foot_stone` | 0.5 | single boot step on stone and gravel, gritty scrape, close |
| `foot_wood` | 0.5 | single boot step on hollow wooden planks, dull creak, close |
| `foot_snow` | 0.5 | single boot step crunching fresh snow, soft compression |
| `foot_water` | 0.6 | single footstep wading in shallow water, splashy, close |
| `move_jump` | 0.5 | quick light gear/leather exertion and fabric rustle, a person leaping up |
| `move_land` | 0.6 | a person landing from a jump, boots thud with armor and gear settle |
| `move_splash` | 0.8 | a body plunging into water, big splash |
| `move_swim` | 0.7 | one slow swimming stroke through water, gentle churn |

### Melee swings (spatial one-shots)
| key | dur | prompt summary |
|---|---|---|
| `melee_swing_blade` | 0.5 | a sword slicing fast through the air, sharp metallic whoosh |
| `melee_swing_heavy` | 0.6 | a heavy two-handed axe swung hard, deep powerful whoosh |
| `melee_swing_light` | 0.4 | a small dagger slashing quickly, light fast whoosh |
| `melee_unarmed` | 0.4 | a fist or claw swiping through air, dull quick whoosh |
| `melee_bow` | 0.5 | a bowstring releasing and an arrow zipping away fast |

### Physical impacts & defenses (spatial)
| key | dur | prompt summary |
|---|---|---|
| `impact_flesh` | 0.4 | a blade striking flesh, wet meaty thud |
| `impact_metal` | 0.4 | a weapon clanging hard against steel plate armor, bright ring |
| `impact_leather` | 0.4 | a weapon striking leather armor and hide, dull padded thud |
| `impact_bone` | 0.4 | a weapon cracking dry bone, sharp brittle crack |
| `combat_block` | 0.4 | a shield blocking a heavy blow, metallic clank |
| `combat_parry` | 0.4 | two blades clashing and sliding, metallic parry ring |
| `combat_dodge` | 0.4 | a fast whoosh of a missed attack swinging past, whiff |
| `combat_crit` | 0.6 | a brutal devastating critical strike, heavy bone-crunching impact with a sharp ring |
| `player_hurt` | 0.6 | a human warrior grunting in sudden pain from a hit |
| `player_death` | 1.2 | a human warrior's final pained death cry collapsing to the ground |

### Spell casts (spatial, looping while channeling)
| key | dur | loop | prompt summary |
|---|---|---|---|
| `cast_fire` | 2.0 | ✓ | a building roaring fire being conjured, crackling flames gathering |
| `cast_frost` | 2.0 | ✓ | ice crystals forming and crackling, a cold frosty shimmer building |
| `cast_arcane` | 2.0 | ✓ | an ethereal arcane energy humming and shimmering, magical resonance |
| `cast_shadow` | 2.0 | ✓ | dark shadow magic whispering, an ominous low void hum |
| `cast_holy` | 2.0 | ✓ | a holy golden light building, soft angelic choir shimmer |
| `cast_nature` | 2.0 | ✓ | earthy nature magic growing, rustling leaves and a low primal hum |

### Spell projectiles (spatial one-shots)
| key | dur | prompt summary |
|---|---|---|
| `proj_fire` | 0.6 | a fireball launching and whooshing through the air, roaring flame |
| `proj_frost` | 0.6 | a frostbolt streaking through air, icy crystalline zip |
| `proj_arcane` | 0.5 | an arcane missile zapping through the air, magical electric zip |
| `proj_shadow` | 0.6 | a shadow bolt flying, dark whooshing void streak |
| `proj_holy` | 0.5 | a bolt of holy light streaking, bright shimmering zip |
| `proj_nature` | 0.5 | a glob of nature energy flying, organic whoosh |

### Spell impacts (spatial one-shots)
| key | dur | prompt summary |
|---|---|---|
| `impact_fire` | 0.8 | a fireball exploding, fiery burst and crackling flames |
| `impact_frost` | 0.7 | ice shattering and freezing on impact, crystalline crack |
| `impact_arcane` | 0.6 | an arcane burst exploding, sparkly magical detonation |
| `impact_shadow` | 0.7 | a shadow spell imploding darkly, ominous magical burst |
| `impact_holy` | 0.7 | a radiant burst of holy light, shimmering divine impact |
| `impact_nature` | 0.7 | an earthy nature impact, wet splat of poison and vines |
| `spell_nova` | 0.9 | an expanding magical nova shockwave bursting outward in all directions |

### Heals & auras (spatial / proximal)
| key | dur | prompt summary |
|---|---|---|
| `heal_impact` | 0.8 | a gentle healing spell washing over someone, soft restorative chime and glow |
| `buff_apply` | 0.7 | an empowering positive magical buff settling on a hero, uplifting shimmer |
| `debuff_apply` | 0.7 | an ominous dark curse settling on a target, sickly negative whoosh |

### Creature vocalizations (spatial)
Per family: `mob_<family>_aggro` (alerted, entering combat), `mob_<family>_attack`
(lunging strike vocalization), `mob_<family>_death` (slain). Hurt reuses a
pitched-up `attack`. Families: `beast`, `boar`, `spider`, `mudfin`, `burrower`,
`humanoid`, `undead`, `troll`, `ogre`, `elemental`, `dragonkin`, `demon`.

| family | aggro / attack / death prompt summary |
|---|---|
| `beast` | a wolf — snarling alert growl / vicious biting snarl / dying yelp and whimper |
| `boar` | a wild boar — angry snorting squeal / charging grunt / dying squeal |
| `spider` | a giant spider — hissing chitter alert / lunging hiss / shriveling death hiss |
| `mudfin` | a mudfin fish creature: warbling gurgle cry / croaking attack gurgle / gurgling death rattle |
| `burrower` | an insectoid burrower: scraping alert / chittering strike / collapsing shell rattle |
| `humanoid` | a bandit man — angry war shout / grunting strike / pained death cry |
| `undead` | a skeleton — rattling bone groan alert / hollow moaning strike / clattering collapse |
| `troll` | a troll — guttural roaring alert / savage grunt strike / heavy groaning death |
| `ogre` | a huge ogre — deep bellowing roar / heavy grunting smash / ground-shaking death groan |
| `elemental` | an elemental — crackling energy hum alert / surging energy burst / dissipating crackle |
| `dragonkin` | a dragonkin — fierce roaring alert with wing flap / snapping bite roar / dying roar collapse |
| `demon` | a demon — sinister hissing snarl / shrieking demonic strike / agonized demonic death wail |

### Idle vocalizations (spatial, ambient bark)
`mob_<family>_idle` (one per family, `reptile` included, 13 total), plus a
subfamily-specific `mob_<family>_<subfamily>_idle` for the wolf aliases (see
`SUBFAMILY_ALIAS` in `src/ui/combat_sfx.ts`; a matching `mob_undead_skeleton_*`
set exists on disk but is not currently wired to any live template, an
inherited gap this feature did not introduce). Unlike the reactive
aggro/attack/death/hurt vocalizations (fired directly off sim combat events),
idle barks are presentation-only ambience: a shared periodic sweep
(`Hud.sweepMobIdleBarks`, throttled to `MOB_IDLE_CHECK_INTERVAL_MS` from
`update()`, never per-mob-per-frame) considers every non-combat, unowned,
non-dummy, unmuted mob within `MOB_IDLE_SCAN_RADIUS` of the player and rolls
each one independently
against `MOB_IDLE_BASE_CHANCE`, damped by how many same-family mobs are
clustered nearby (`idleDensityFactor`, `src/ui/mob_idle_sfx.ts`) so a dense
pack does not all bark in the same sweep. A per-entity cooldown
(`MOB_IDLE_PER_ENTITY_COOLDOWN_MS`) additionally rate-limits one mob's own
repeats, stamped only when `sfx.playAt` reports the sound actually played
(not merely attempted), so losing the shared per-key playback cooldown
(`MOB_IDLE_KEY_COOLDOWN_S`, the backstop against two mobs barking the
identical clip at once) does not silently bench a mob for the full
per-entity window. Plays at `MOB_IDLE_GAIN`, a dedicated lower bucket
distinct from the combat layer's `COMBAT_GAIN`. Timing is client-local and
non-deterministic across players by design (presentation-only, same category
as footstep variant choice, not gameplay-affecting).

### Ambient loops
| key | loop | spatial | prompt summary |
|---|---|---|---|
| `amb_wind_vale` | ✓ | global | gentle pleasant breeze through a green forest valley, soft wind and distant leaves |
| `amb_wind_marsh` | ✓ | global | eerie damp marshland wind, low mournful breeze with distant frogs and insects |
| `amb_wind_peaks` | ✓ | global | cold howling mountain wind across high rocky peaks, bleak and gusty |
| `amb_birds` | ✓ | global | calm daytime forest ambience with gentle birdsong |
| `amb_water` | yes | global | gentle lake water lapping at the shore, soft flowing ripples |
| `amb_campfire` | ✓ | point | a crackling campfire, popping embers and flames |
| `amb_forge` | ✓ | point | a blacksmith forge, roaring furnace with rhythmic hammer strikes on an anvil |
| `amb_dungeon` | ✓ | global | a dark stone dungeon interior, dripping water echoes and a low ominous drone |
| `amb_rain` | ✓ | global | steady rainfall pattering with occasional distant thunder |
| `amb_snow` | ✓ | global | a soft muffled snowy wind, quiet and cold |

### Interface and personal event cues

These cues are non-positional, preload at startup, and keep the existing
`GameAudio` method surface. They are sampled assets, so they use the same Studio
editing, mastering, caching, and playback limits as the world catalog.

The Interface and Feedback Sounds toggle (the `interfaceSfx` setting, wired to
`audio.setFeedbackEnabled` in `src/game/audio.ts`) silences the notification
cues (coin, loot, level-up, quest, whisper, transformation, death, error) and
the spatial avoid cues (miss/dodge/resist/parry), which the HUD gates via
`audio.feedbackEnabled`: they report an outcome, not a world impact. Affordance
and gameplay-timing cues (click, bag transitions, ready check, duel lifecycle,
Fiesta) and every world/spatial sound ignore the toggle.

| keys | purpose |
|---|---|
| `ui_click`, `ui_error` | basic interaction and invalid-action feedback |
| `ui_bag_open`, `ui_bag_close` | inventory transitions |
| `ui_coin`, `ui_loot_item` | currency and item rewards |
| `ui_quest_accept`, `ui_quest_done`, `ui_level_up` | progression feedback |
| `ui_achievement` | Book of Deeds unlock chime |
| `ui_whisper`, `ui_sheep`, `ui_death` | message, transformation, and defeat events |
| `ui_duel_challenge`, `ui_duel_countdown`, `ui_duel_start`, `ui_duel_end` | duel lifecycle |
| `ui_fiesta_word_0` through `ui_fiesta_word_3` | escalating Fiesta takedown tiers |
| `ui_fiesta_score_mine`, `ui_fiesta_score_other` | team score feedback |
| `ui_fiesta_wave`, `ui_fiesta_augment`, `ui_fiesta_down`, `ui_fiesta_revive` | Fiesta round and player-state feedback |

---

## Generation
`ELEVENLABS_API_KEY=... node scripts/gen_sfx.mjs [--force]` reads
`scripts/sfx/sfx_prompts.mjs`, calls `POST /v1/sound-generation` per clip
(`duration_seconds`, `prompt_influence` 0.4, `loop` per entry,
`output_format=mp3_44100_128`), passes each response through the shared conform
step (44.1 kHz, 192 kbps, downmixed to mono unless the entry is `stereo: true`;
see Asset standard), writes `public/audio/sfx/<key>.mp3`, and emits the sampled
files. `node scripts/build_sfx_manifest.mjs` independently emits
`src/game/sfx_manifest.generated.ts` with URLs of the form
`/audio/sfx/<key>.mp3?v=<content-hash>`. Generation is idempotent
(skips existing; `--force` to regenerate). Offline-only; the key is never read at
runtime. Exact versioned SFX URLs receive immutable production caching; unhashed
or stale URLs must revalidate.

`npm run sfx:ui -- --force` rebuilds the deterministic sampled UI cues
locally with FFmpeg. Their fixed synthesis parameters and noise seeds make the
assets repeatable for a given FFmpeg build. The shared production conform step
then emits 44.1 kHz, 192 kbps MP3s using the same short-true-peak and sustained-LUFS
branches as every other catalog cue. Run
`npm run sfx:manifest` after any direct asset generation or replacement.

For the complete authoring and artifact workflow, see the
[SFX Studio tutorial](../sfx-studio-tutorial.md). For editing, run
`npm run sfx:studio`. The loopback-only Studio inventories the
catalog, previews associated animations and environments, validates uploads,
supports non-destructive slicing and seam crossfades, fades, reverse, multi-band
EQ, compression, two-pass EBU R128 normalization, limiter and encoded-file QA.
Audio Publish bakes that authoring work and transactionally publishes the
verified MP3 and tracked render recipe, then regenerates the manifest for the
new content hash. Apply Playback Mix writes only the checked-in gain and speed
maps and regenerates the manifest. It does not render, conform, resample, or
otherwise change the audio bytes.
Runtime loop cues cannot bypass seam processing, and one-shots cannot be
reclassified as loops.

### Production export

The Studio toolbar's Export All action downloads a deterministic production ZIP
from every published SFX master and the applied playback profile. Export is
blocked while saved playback changes are unapplied or saved audio drafts differ
from their publication baselines. Local uploads, previews, version history,
music, and NPC voice lines are not part of this SFX artifact.

The artifact stores audio as immutable
`audio/sfx/blobs/<full-sha256>.mp3` files and includes a stable
`audio/sfx/runtime-pack.json`, authoring maps, integrity metadata, and an
installer. Run `node install.mjs <production-static-root>` after extracting the
ZIP. The installer verifies and copies every blob first, then atomically replaces
the stable runtime manifest. Production can set `SFX_PACK_DIR` to a persistent
overlay's `audio/sfx` directory. Docker Compose maps `EASTBROOK_SFX_DIR` for this
purpose, so a container rebuild does not discard an installed pack.

The client accepts a pack only when its compiled catalog hash matches, every
fixed key is present, and any extra keys match the constrained mob-subfamily
grammar. A malformed, incomplete, external-URL, or incompatible pack is rejected
as a whole and playback uses the compiled generated manifest. New event routing
or a new fixed SFX key still requires a normal game code deployment.

### Runtime mix and speed

Cross-clip balance is separate from asset mastering. Trim, slices, fades, seam
construction, reverse, EQ, dynamics, loudness, and encoding remain baked in the
published asset. The reversible playback controls live in two plain-data files:

- `scripts/sfx/sfx_gain_map.json` stores category baseline dB plus per-key
  fine-tune dB. The layers add, and the resolved value must stay at or below
  0 dB.
- `scripts/sfx/sfx_speed_map.json` stores the playback rate for each adjusted
  key.

Manifest generation resolves both maps into a linear `gain` multiplier and a
`playbackRate` for every key. At playback, `src/game/sfx.ts` applies the gain to
the cue's `GainNode` and the rate to its `AudioBufferSourceNode`. One-shot caller
rate and pitch jitter layer on top. This uses Web Audio resampling, so speed and
pitch move together. The maps stay independent of rendering and any separate
conform process, so applying either one never changes the source or published
audio hash.

Studio audition A is the untouched source bypass. B previews the live authoring
graph with runtime mix and speed, while C applies the same runtime values to the
exact rendered master. This keeps comparisons honest without putting playback
decisions into rendered bytes.

Model and environment cues use real game assets in the context viewer. Personal
UI cues use cue-specific representative interface mocks, clearly labeled as
non-positional authoring context rather than pretending an unrelated model is
the live HUD. The Studio inventories published masters without silently changing
them. Existing cues keep their current balance until an author listens and
applies a reviewed playback-map change; audio mastering remains a separate
publish. Every new Studio exact render and publish ends in the shared 44.1 kHz,
192 kbps production conform pass. Positional and one-shot masters are encoded mono
at the source under the Asset standard, so the runtime stereo-to-mono fold after
decode is a no-op for them; that fold still protects any stereo asset (a
not-yet-re-processed clip, or a bespoke upload) from wasting positional buffer
memory.

## Efficiency budget
- One decoded `AudioBuffer` per loaded clip, shared across all sources. Only the
  startup set is eager; contextual assets are loaded once on demand.
- `MAX_VOICES` concurrent one-shots; over-cap plays are dropped (oldest-wins).
- Footsteps gated by `d2 < SFX_RANGE_SQ` (reuses the renderer's per-entity squared
  distance) and a per-entity stride accumulator — no timers, no per-frame alloc.
- Ambience/cast loops are a small pool of persistent sources, cross-faded by gain.
- Listener updated once per frame; panners use cheap `equalpower` + linear rolloff
  with a hard `maxDistance` so far sounds cost nothing.
