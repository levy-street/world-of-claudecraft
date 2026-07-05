# Sound Effects — design, catalog & integration

Generated spatial sound effects for World of ClaudeCraft, produced with the
**ElevenLabs Sound Effects API** (`POST /v1/sound-generation`) and played through
a new lightweight 3D Web Audio engine. This document is the human-readable
catalog; the authoritative machine list (prompts, durations, loop flags) lives in
`scripts/sfx/sfx_prompts.mjs` and is consumed by `scripts/gen_sfx.mjs`.

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
- **Extreme efficiency:** one decoded buffer per clip (shared), a hard concurrency
  cap, distance culling that reuses the renderer's own range gate, per-entity
  footstep throttling, pooled looping sources, and zero per-frame allocation in
  the hot path.

## What we DON'T regenerate
The existing procedural WebAudio blips in `src/game/audio.ts` (UI click, coin,
level-up fanfare, quest accept/done, bag open/close, error, whisper, duel/arena
stingers) are crisp, zero-weight, and non-positional — they stay. Generated assets
are spent only on the immersive world/combat/creature layer below.

---

## Architecture

### `src/game/sfx.ts` — `Sfx` (singleton `sfx`)
A decoupled 3D engine with **its own `AudioContext` + `AudioListener`** (siblings:
`audio`/`music`/`voice`). Driven by the `sfxVolume` setting (wired alongside
`audio.setVolume` in `main.ts`). API:
- `init()` — gated on the same user gesture as `audio.init()` (`enterWorld`);
  preloads + decodes every clip in the manifest into a shared buffer cache.
- `setListener(x,y,z, fx,fy,fz)` — called once per frame by the renderer with the
  camera position + forward vector.
- `playAt(key, x,y,z, opts?)` — one-shot positional clip via a `PannerNode`
  (equalpower, linear rolloff, hard `maxDistance` cutoff). Random ±6% rate / ±2dB
  gain jitter so repeats (footsteps, swings) never machine-gun.
- `playUi(key, opts?)` — non-positional one-shot straight to the master bus.
- `loopAt(key, id, x,y,z)` / `loopGlobal(key, id)` / `stopLoop(id, fade)` /
  `setLoopTarget(...)` — pooled looping sources for ambience & sustained casts,
  cross-faded.
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
  dungeon→wood/stone → snow if weather is snowing. Suppressed while airborne /
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
- Personal UI events keep their existing procedural `audio.*` blips (unchanged).

### Surface & family mapping
- **Surface** (footsteps): `vale→grass`, `marsh→dirt`, `peaks→stone`, dungeon
  (`x>DUNGEON_X_THRESHOLD`)→`wood`, wading (`y≤WATER_LEVEL-0.3` & not deep)→`water`,
  deep→`swim`, weather snow→`snow`. Source: `zoneBiomeAt`, `groundHeight`,
  `WATER_LEVEL` from `src/sim/world.ts`.
- **Creature family** (vocalizations): `MOBS[templateId].family` ∈ {beast,
  humanoid, murloc, spider, kobold, undead, troll, ogre, elemental, dragonkin,
  demon}, with a `wild_boar`/`elder_bristleback` → **boar** templateId override.
- **Weapon class** (swings) & **material** (impacts) derive from the source/target
  player class or mob family (plate: warrior/paladin → metal; leather: rogue/hunter/
  shaman; cloth: mage/priest/warlock/druid; undead → bone; else flesh).

---

## Catalog

`spatial` = positioned 3D; `loop` = seamless looping (ElevenLabs `loop:true`).
Keys map to `public/audio/sfx/<key>.mp3`; the manifest
`src/game/sfx_manifest.generated.ts` is emitted by the generator.

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
pitched-up `attack`. Families: `beast`, `boar`, `spider`, `murloc`, `kobold`,
`humanoid`, `undead`, `troll`, `ogre`, `elemental`, `dragonkin`, `demon`.

| family | aggro / attack / death prompt summary |
|---|---|
| `beast` | a wolf — snarling alert growl / vicious biting snarl / dying yelp and whimper |
| `boar` | a wild boar — angry snorting squeal / charging grunt / dying squeal |
| `spider` | a giant spider — hissing chitter alert / lunging hiss / shriveling death hiss |
| `murloc` | a murloc fish-man — warbling gurgle cry / croaking attack gurgle / gurgling death rattle |
| `kobold` | a small kobold — startled yipping bark / snarling bite / squealing death |
| `humanoid` | a bandit man — angry war shout / grunting strike / pained death cry |
| `undead` | a skeleton — rattling bone groan alert / hollow moaning strike / clattering collapse |
| `troll` | a troll — guttural roaring alert / savage grunt strike / heavy groaning death |
| `ogre` | a huge ogre — deep bellowing roar / heavy grunting smash / ground-shaking death groan |
| `elemental` | an elemental — crackling energy hum alert / surging energy burst / dissipating crackle |
| `dragonkin` | a dragonkin — fierce roaring alert with wing flap / snapping bite roar / dying roar collapse |
| `demon` | a demon — sinister hissing snarl / shrieking demonic strike / agonized demonic death wail |

### Ambient loops
| key | loop | spatial | prompt summary |
|---|---|---|---|
| `amb_wind_vale` | ✓ | global | gentle pleasant breeze through a green forest valley, soft wind and distant leaves |
| `amb_wind_marsh` | ✓ | global | eerie damp marshland wind, low mournful breeze with distant frogs and insects |
| `amb_wind_peaks` | ✓ | global | cold howling mountain wind across high rocky peaks, bleak and gusty |
| `amb_birds` | ✓ | global | calm daytime forest ambience with gentle birdsong |
| `amb_water` | ✓ | point | gentle lake water lapping at the shore, soft flowing ripples |
| `amb_campfire` | ✓ | point | a crackling campfire, popping embers and flames |
| `amb_forge` | ✓ | point | a blacksmith forge, roaring furnace with rhythmic hammer strikes on an anvil |
| `amb_dungeon` | ✓ | global | a dark stone dungeon interior, dripping water echoes and a low ominous drone |
| `amb_rain` | ✓ | global | steady rainfall pattering with occasional distant thunder |
| `amb_snow` | ✓ | global | a soft muffled snowy wind, quiet and cold |

---

## Generation
`ELEVENLABS_API_KEY=… node scripts/gen_sfx.mjs [--force]` — reads
`scripts/sfx/sfx_prompts.mjs`, calls `POST /v1/sound-generation` per clip
(`duration_seconds`, `prompt_influence` 0.4, `loop` per entry,
`output_format=mp3_44100_128`), writes `public/audio/sfx/<key>.mp3`, and emits
`src/game/sfx_manifest.generated.ts` (key → `/audio/sfx/<key>.mp3`). Idempotent
(skips existing; `--force` to regenerate). Offline-only; the key is never read at
runtime. Served from `public/` via plain `/audio/sfx/...` paths (no media-manifest
hashing), matching the voice-over assets.

## Efficiency budget
- One decoded `AudioBuffer` per clip, shared across all sources.
- `MAX_VOICES` concurrent one-shots; over-cap plays are dropped (oldest-wins).
- Footsteps gated by `d2 < SFX_RANGE_SQ` (reuses the renderer's per-entity squared
  distance) and a per-entity stride accumulator — no timers, no per-frame alloc.
- Ambience/cast loops are a small pool of persistent sources, cross-faded by gain.
- Listener updated once per frame; panners use cheap `equalpower` + linear rolloff
  with a hard `maxDistance` so far sounds cost nothing.
