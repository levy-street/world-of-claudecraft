# Procedural Icon System — Design Spec for World of Claudecraft

Everything below is implementable without further design decisions. Sources read: `/Users/reubenhorne/Documents/code/levy-street/world-of-claudecraft/src/sim/data.ts`, `src/sim/types.ts`, `src/ui/hud.ts`, `index.html`.

---

## 1. Architecture

### 1.1 Files (many small files, sim stays DOM-free)

```
src/ui/icons/
  index.ts       — public API: iconDataUrl(), iconCanvas(), itemIconHtml(), auraIconId(); cache (~120 lines)
  compose.ts     — the layer compositor (bg → fx-under → primitives → fx-over → bevel) (~150 lines)
  palettes.ts    — PALETTES + BACKGROUNDS tables (data only) (~80 lines)
  primitives.ts  — the ~40 painter functions (split into primitives2.ts if >800 lines)
  fx.ts          — glow/sparkle/crack/drips/motion/arcs painters (~90 lines)
  recipes.ts     — ICON_RECIPES table: iconId → recipe (data only, the tables in §4)
```

The **sim layer carries only a string** (`iconId`); all drawing lives in `src/ui/`. Recipes are keyed by iconId; ability iconIds equal the ability id 1:1, items name shared recipes.

### 1.2 Schema changes

`src/sim/types.ts`:
```ts
// AbilityDef: REPLACE
icon: string; iconColor: string;
// WITH
iconId: string;            // key into the UI icon recipe table; for abilities, always === id

// ItemDef: ADD
iconId: string;
// ItemDef.quality: EXTEND
quality?: 'poor' | 'common' | 'uncommon' | 'rare' | 'epic';
```
`src/sim/data.ts`: every ability gets `iconId: '<its own id>'` (delete `icon`/`iconColor`); every item gets `iconId` per the table in §4.2.

### 1.3 Public API (`src/ui/icons/index.ts`)

```ts
export interface IconPalette { base: string; light: string; dark: string; glow: string; accent: string }
export type PaletteName = keyof typeof PALETTES;
export type BgName = keyof typeof BACKGROUNDS;
export type PrimitiveName = keyof typeof PRIMITIVES;   // painter registry
export type FxName = 'glow' | 'sparkle' | 'crack' | 'drips' | 'motion' | 'arcs';

export interface PrimitivePlacement {
  p: PrimitiveName;
  x?: number; y?: number;   // offset in the 100×100 logical space (default 0,0 = centered)
  s?: number;               // scale (default 1)
  rot?: number;             // radians (default 0)
  pal?: PaletteName;        // palette override for this primitive only
}
export interface IconRecipe {
  bg: BgName;
  pal: PaletteName;                 // default palette for primitives & fx
  prims: PrimitivePlacement[];      // drawn in order (1–2 typical)
  fx?: FxName[];                    // glow draws UNDER prims; the rest draw OVER
}

const MASTER_SIZE = 96;             // one master canvas per iconId; CSS scales it down
const canvasCache = new Map<string, HTMLCanvasElement>();
const urlCache = new Map<string, string>();

export function iconCanvas(iconId: string): HTMLCanvasElement;   // compose + cache (key: iconId)
export function iconDataUrl(iconId: string): string;             // canvas.toDataURL() memoized
export function itemIconHtml(item: ItemDef): string;             // moved out of hud.ts (see §6)
export function auraIconId(aura: { id: string; kind: AuraKind }): string;  // §5.1
```

Rules:
- **Single 96 px master per iconId** rendered once, lazily, then reused at every display size via `background-size: cover` (46 px action buttons, 34 px spellbook, 28 px items/buffs). 96 px is crisp at 46 px on 2× retina. No size parameter in the cache key — one canvas + one dataURL per id (~110 icons ≈ 4 MB transient canvases, dataURLs ~15 KB each).
- Unknown iconId → fallback recipe `{ bg:'junk', pal:'silverWhite', prims:[{p:'sigil_rune'}] }` plus a dev-only `console.warn` (guard with `import.meta.env.DEV`), warned once per id.
- Deterministic output: the only randomness is the background speck noise; seed it with `mulberry32(stringHash(iconId))` so the same id always produces a byte-identical dataURL (test-friendly).
- Pure/no mutation: compose builds a fresh canvas; caches are append-only maps.

### 1.4 How hud.ts consumes it

CSS `background-image` everywhere (no `<img>` churn, no text labels):
- **Action bar**: the existing `.icon-label` span becomes the icon surface — `ab.label.style.backgroundImage = url(iconDataUrl(def.iconId))`. Cache the last-set iconId per slot to avoid re-assigning style every frame.
- **Spellbook / bags / vendor / loot / char / quest-reward rows**: all already funnel through `itemIcon()` or the `.spell-icon` div — swap initials for `style="background-image:url(...)"`.
- **Buff bar / target debuffs**: `renderAuras` sets `d.style.backgroundImage` from `auraIconId(aura)`.
- State tinting (unusable / out-of-range / locked) moves from text-color to CSS `filter` on the icon surface (exact filters in §6).

---

## 2. Style guide — "painted classic-MMO icon" look

### 2.1 Compositor pipeline (every icon, in order)

Logical space is **100×100** (ctx scaled from 96 px device canvas; `translate(50,50)` before primitives so painters draw centered, radius ≤ 36).

1. **Rounded-rect clip**, corner radius 12 (of 100).
2. **Background radial gradient** — center at (35,30) (top-left light source), radius 85: stops `0 → c0`, `0.55 → c1`, `1 → c2` from the BACKGROUNDS table.
3. **Vignette**: radial gradient transparent→`rgba(0,0,0,0.45)` from r 55→r 85.
4. **Speck noise**: 40 seeded 1×1 px rects, alternating `rgba(255,255,255,.04)` / `rgba(0,0,0,.06)` — kills the "flat CSS gradient" look.
5. **Under-fx**: `glow` if listed.
6. **Primitives** in recipe order, each with `ctx.shadowColor='rgba(0,0,0,.6)'; shadowBlur=3; shadowOffsetX=1; shadowOffsetY=2` (the painted drop-shadow), then shadow reset.
7. **Over-fx**: sparkle / crack / drips / motion / arcs.
8. **Bevel frame** (baked into the canvas; quality border stays in CSS *outside* it):
   - outer stroke: rounded rect inset 1, `#000`, 2 px;
   - top+left inner edge: rounded-rect arc segment, `rgba(255,255,255,0.28)`, 1.5 px;
   - bottom+right inner edge: `rgba(0,0,0,0.55)`, 1.5 px;
   - 1 px inner rim stroke in the bg's `c0` at 22 % alpha (warm halo).

### 2.2 BACKGROUNDS table (gradient stops c0/c1/c2)

| key | c0 | c1 | c2 | used for |
|---|---|---|---|---|
| fire | #ffb45e | #b23410 | #38100a | fire school |
| frost | #bfe8ff | #1d5e9e | #0a1d38 | frost school |
| arcane | #e8b8ff | #6e34a0 | #1e0a33 | arcane school |
| shadow | #9a70c0 | #41245c | #100618 | shadow school |
| holy | #fff3c0 | #c89018 | #43300a | holy school |
| nature | #c0e890 | #357a2a | #0c230d | nature school |
| storm | #a8c8e8 | #3a5a80 | #101c2c | lightning/wind/daze (physical-blue) |
| steel | #c8d4dc | #5a6878 | #181d24 | physical, metal weapons/armor |
| fury | #ff9468 | #a02818 | #2e0a06 | warrior/aggressive physical |
| blood | #d86858 | #7e1810 | #260604 | bleeds, life-cost |
| earth | #d8a868 | #74481e | #20120a | earth/beast physical |
| leather | #d0a06a | #6e4824 | #1e1208 | leather gear, hides |
| cloth | #c8b8e8 | #564878 | #181226 | cloth gear |
| wood | #c89858 | #6a4520 | #1c1006 | staves, crates, hafts |
| food | #f0c070 | #8a5424 | #281406 | food items |
| drink | #a0d8f0 | #2a6890 | #0a2030 | drink items |
| junk | #a8a8a0 | #4e4e48 | #141412 | gray junk |
| treasure | #ffd970 | #a07818 | #2e2206 | coin/money |
| parchment | #f0e0b0 | #907040 | #2a200c | scrolls (future) |

### 2.3 PALETTES table `{base, light, dark, glow, accent}`

| name | base | light | dark | glow | accent |
|---|---|---|---|---|---|
| steel | #aebdc8 | #eef4f8 | #4e5a66 | #cfe4ff | #2b333c |
| gold | #e8b33a | #ffe9a8 | #8a5f12 | #ffd97a | #5c3e08 |
| blood | #c0392b | #ff8a70 | #5e120c | #ff5533 | #2e0805 |
| bone | #e8e0cc | #fffaf0 | #8f8468 | #fff8d8 | #4a4334 |
| ember | #ff7a1a | #ffd9a0 | #8a2a08 | #ffb45e | #401004 |
| ice | #9fd8ff | #eafaff | #2a6ea8 | #c8f0ff | #123c5e |
| venom | #7ad94a | #d8ffb0 | #2a6e18 | #a8ff70 | #0d330a |
| arcanePink | #c66ee8 | #f0c8ff | #5e2a78 | #e0a0ff | #2a0e38 |
| shadowPurple | #8a5fb0 | #cdaae8 | #38204e | #b48ad0 | #150a20 |
| holyGold | #ffe080 | #fff7d0 | #a8761a | #fff0b0 | #5e3f08 |
| leafGreen | #5fb544 | #c4f0a0 | #225e18 | #9fe070 | #0d2e0a |
| sky | #6fb6ff | #d4ecff | #1f5a9e | #a0d4ff | #0c2c50 |
| earthBrown | #a8703c | #e0b070 | #5a3414 | #d89a50 | #2a1608 |
| silverWhite | #e8eef2 | #ffffff | #8a98a4 | #f0f8ff | #3c4650 |
| leather | #b98a52 | #e8c48e | #6a4520 | #d8aa6a | #33200c |
| cloth | #b0a4d8 | #e0d8f4 | #5a4e84 | #d0c4f0 | #2a2444 |
| pink | #f0a8c0 | #ffe0ec | #a05878 | #ffd0e0 | #4e2030 |

### 2.4 Placement shorthand used in §4 tables

`@c` = centered (default) · `@tl/@tr/@bl/@br` = corner badge `(±13,±13, s 0.45)` · `@big` = `(0,0, s 1.15)` drawn first at 35 % alpha (backdrop motif). Implement as constants in recipes.ts.

---

## 3. Painter vocabulary

Signature: `(ctx: CanvasRenderingContext2D, pal: IconPalette) => void`, ctx pre-translated to icon center, pre-rotated/scaled per placement. All shapes fit r ≤ 36. Use linear/radial gradients from `pal.light → pal.base → pal.dark` with the light source top-left; every solid mass gets a `pal.light` edge-highlight stroke or sheen arc.

**40 core primitives** (+3 forward-looking):

| # | name | geometry (100×100 space, centered) |
|---|---|---|
| 1 | sword | rotate −45°: blade quad (−3,−30)→(3,18) tapering to tip (0,−34), center ridge line `light`; crossguard rect (−10,16)–(10,20) `accent`; grip (−2.5,20)–(2.5,30) `dark`; pommel circle r4 at (0,32) |
| 2 | dagger | sword at 0.72 scale, broader taper, swept guard arcs |
| 3 | staff | rotate 30°: shaft round-rect w5, y −32…32 `base`; orb r8 at top, radial `glow→base`, white glint dot |
| 4 | mace | handle w5 y 0…30 `dark`; flanged head circle r13 at (0,−12) with 6 rim studs r3 `light` |
| 5 | axe | haft rotate 35° length 56; crescent head (two arcs) top-left, edge stroked `light` |
| 6 | bow *(future)* | arc (−6,−30)→(−6,30) bulging to x 18, 4 px; straight string `light` 1.5 px |
| 7 | arrow | shaft 2.5 px (−22,22)→(18,−18); tip triangle `light`; two fletch quads at tail `accent` |
| 8 | shield | heater path (0,−26)(20,−18)(16,10)(0,26)(−16,10)(−20,−18); vertical gradient; rim stroke `accent` 3 px; boss circle r5 `light` |
| 9 | bolt | comet: head circle r9 at (10,−10) radial `light→base`; tapering bezier tail to (−26,26) fading alpha; 2 trail dots |
| 10 | flame | 3 nested bezier tongues (w30×h52 outer `base`, 0.6× `light`, 0.3× `glow`), inner two with `globalCompositeOperation='lighter'` |
| 11 | snowflake | 6 spokes r26 at 60°, two side-ticks each at r14 (±30°), round caps 3 px `light`; center hex r4 |
| 12 | skull | cranium circle r16 at (0,−6); jaw round-rect (−9,6)–(9,18); sockets r4.5 at (±6.5,−7) `dark`; nose tri; 3 teeth lines |
| 13 | fist | knuckle mass round-rect (−14,−10)–(14,12), 4 finger-bump arcs on top, thumb wedge right |
| 14 | hand | open palm: round-rect palm + 4 upward finger capsules + thumb capsule |
| 15 | boot | shaft (−8,−22)→(6,4), foot to (18,16), flat `dark` sole strip, 3 lace ticks |
| 16 | chestplate | torso path: shoulders (±20,−16), waist in to (±12,20); neck V notch; center seam; two pec arcs |
| 17 | trousers | waistband rect (−16,−20)–(16,−12); two legs tapering to (±10,26); seam highlights |
| 18 | pelt | rough pentagon hide with 4 corner leg-stubs, jagged bottom edge, fur ticks along top |
| 19 | potion | flask body r14 at (0,6); neck (−4,−18)–(4,−6); cork `accent`; liquid fills lower 60 % `base` with `light` surface ellipse; white glass-glint arc |
| 20 | droplet | teardrop from (0,−20) bulging to r13 at (0,8); radial `light` top-left; glint ellipse |
| 21 | bread | loaf ellipse (−20,−6)–(20,14); 3 diagonal score lines `dark`; top sheen `light` |
| 22 | meat | drumstick: meat circle r14 at (−6,2) with sheen; bone shaft to (18,−14) in bone-white + double knob |
| 23 | scroll *(future)* | rolled rect (−16,−12)–(16,12) slight rotate; curl cylinders top/bottom; 3 rune squiggles `dark` |
| 24 | gem | brilliant-cut hexagon outline, crown facet triangles, gradient + 2 white glints |
| 25 | coin | circle r16; inner rim ring 3 px `dark`; embossed `light` arc top-left; tiny center sigil |
| 26 | paw | main pad rounded-tri r10 at (0,6); 4 toe ellipses r4.5 arced above |
| 27 | fang | curved canine bezier crescent (−4,−20)→(2,20), thick root, `light` tip gradient, root cap |
| 28 | web | 6 spokes to r30; 3 concentric sagging chord rings at r10/19/28, 1.5 px `light` |
| 29 | bone | shaft rotate 40°, len 44 w6 `base`; double-circle condyles r6 each end `light` |
| 30 | candle | column (−6,−2)–(6,22) `base` with drip blobs on top edge; wick; mini flame (#10 at 0.35×, ember palette) at (0,−12) |
| 31 | crate | front square (−16,−10)–(16,18) + top parallelogram; 2 plank lines; diagonal cross slats; nail dots |
| 32 | sigil_rune | circle stroke r20 3 px; angular M-rune zigzag inside 3.5 px `glow` with glow shadow |
| 33 | heart | classic heart path w30, radial sheen, white glint |
| 34 | sunburst | core circle r7 `light`; 8 tapering triangle rays len 22 alternating long/short, composite 'lighter', `glow` |
| 35 | moon | crescent: circle r17 `light` minus offset circle (7,−4) r15 (path subtraction) |
| 36 | lightning | jagged polygon (6,−28)(−8,2)(0,2)(−6,28)(12,−4)(2,−4); fill `light`, shadowBlur 6 `glow` |
| 37 | leaf | pointed ellipse rotate −30°, mid-vein curve + 3 side veins `dark`, gradient base→light |
| 38 | claw_slash | 3 parallel bezier crescents, sharp ends, rotate −20°, 9 px apart; fill `light`, edge `dark` |
| 39 | eye | almond (two arcs) 34×18; sclera `light`; iris r6.5 `base`; pupil r3 `dark`; glint dot |
| 40 | cross | flared plus: vertical bar (−5,−22)–(5,16), horizontal (−16,−9)–(16,−1), flared ends, `light` + glow shadow |
| 41 | wing | 4 feather capsules fanning upper-left from (12,8), decreasing length, `light` tips |
| 42 | sheep_head | woolly circle r16 of 8 arc-bumps `light`; face ellipse lower-center `accent`; ear capsules; 2 eye dots |
| 43 | tendrils | 3 wavy vines rising from (−14,28)(0,30)(14,28), 3 px `base`, curling tips `light`, 2 leaf nubs each |
| — | ring *(future)* | torus ellipse w/ gem — reserved name |

**FX painters** (`fx.ts`):
- `glow` *(under)*: radial `pal.glow` α0.55→0, r30 at center.
- `sparkle`: three 4-point stars (thin diamond crosses) at (−18,−14,s5),(16,−20,s4),(20,12,s3), `pal.light`, composite 'lighter'.
- `crack`: 2 jagged 4-segment polylines from center outward, 2 px `pal.dark`.
- `drips`: 3 droplets (#20 at 0.22×) at (−10,18),(0,24),(10,16), `pal.base`.
- `motion`: 3 parallel speed-lines top-left→bottom-right behind the last primitive, `pal.light` α0.4.
- `arcs`: 3 concentric arc strokes r18/26/34, 70° span opening up-right, `pal.light`, α 0.8/0.55/0.3.

---

## 4. Complete assignment table

### 4.1 Abilities (all 67) — `iconId` = ability id; recipe columns: bg · prims · pal · fx

**Warrior**
| ability | bg | prims | pal | fx |
|---|---|---|---|---|
| heroic_strike | fury | sword | steel | glow |
| battle_shout | fury | fist | gold | arcs |
| demoralizing_shout | shadow | fist | steel | arcs |
| charge | fury | boot, sword@br | steel | motion |
| rend | blood | claw_slash | blood | drips |
| thunder_clap | storm | lightning | sky | arcs |
| hamstring | blood | boot, claw_slash@tr | blood | — |
| bloodrage | blood | heart | blood | drips, glow |
| overpower | fury | sword, sunburst@tl | gold | — |

**Mage**
| fireball | fire | bolt, flame@br | ember | glow |
|---|---|---|---|---|
| frost_armor | frost | chestplate, snowflake@tr | ice | — |
| arcane_intellect | arcane | eye | arcanePink | sparkle |
| frostbolt | frost | bolt, snowflake@br | ice | motion |
| conjure_water | arcane | potion(pal sky) | sky | sparkle |
| fire_blast | fire | flame, sunburst@big | ember | glow |
| arcane_missiles | arcane | bolt(−12,−12,0.55), bolt(0,0,0.65), bolt(12,12,0.75) | arcanePink | glow |
| polymorph | arcane | sheep_head | pink | sparkle |
| frost_nova | frost | snowflake | ice | arcs, glow |

**Rogue**
| sinister_strike | steel | dagger | steel | glow |
|---|---|---|---|---|
| eviscerate | blood | claw_slash | blood | drips |
| backstab | shadow | dagger(rot π·0.85), motion | steel | motion |
| gouge | fury | eye, claw_slash@br | blood | — |
| evasion | storm | shield | sky | motion |
| slice_and_dice | blood | dagger(−7,0,0.85,rot −0.5), dagger(7,0,0.85,rot 0.5) | steel | motion |
| sprint | earth | boot | leather | motion |

**Paladin**
| seal_of_righteousness | holy | sigil_rune, sunburst@big | holyGold | glow |
|---|---|---|---|---|
| holy_light | holy | sunburst | holyGold | glow, sparkle |
| devotion_aura | holy | shield, sunburst@tl | holyGold | — |
| judgement | holy | mace, sunburst@big | gold | glow |
| blessing_of_might | holy | fist, sunburst@tl | gold | — |
| divine_protection | holy | shield | silverWhite | glow |
| hammer_of_justice | holy | mace | gold | arcs |
| lay_on_hands | holy | hand, sunburst@big | holyGold | sparkle, glow |

**Hunter**
| raptor_strike | earth | claw_slash | blood | — |
|---|---|---|---|---|
| aspect_of_the_hawk | storm | wing | sky | glow |
| serpent_sting | nature | fang | venom | drips |
| arcane_shot | arcane | arrow | arcanePink | glow, sparkle |
| concussive_shot | storm | arrow | sky | arcs |
| mongoose_bite | earth | fang, claw_slash@br | steel | motion |
| wing_clip | earth | wing, claw_slash@br | blood | — |

**Priest**
| smite | holy | bolt, sunburst@tl | holyGold | glow |
|---|---|---|---|---|
| lesser_heal | holy | cross | silverWhite | glow |
| power_word_fortitude | holy | shield, cross@tl | gold | — |
| shadow_word_pain | shadow | skull, claw_slash@br | shadowPurple | — |
| power_word_shield | holy | shield | silverWhite | sparkle, glow |
| renew | holy | heart(pal leafGreen) | leafGreen | sparkle |
| mind_blast | shadow | eye | shadowPurple | arcs, glow |

**Shaman**
| lightning_bolt | storm | lightning | sky | glow |
|---|---|---|---|---|
| rockbiter_weapon | earth | fist | earthBrown | crack |
| healing_wave | frost | droplet | sky | arcs, sparkle |
| earth_shock | earth | lightning(pal earthBrown) | earthBrown | crack |
| lightning_shield | storm | shield, lightning@c(0,0,0.6) | sky | glow |
| flame_shock | fire | flame | ember | arcs |

**Warlock**
| shadow_bolt | shadow | bolt | shadowPurple | glow |
|---|---|---|---|---|
| demon_skin | shadow | chestplate(pal venom) | venom | — |
| immolate | fire | flame | ember | crack, glow |
| corruption | shadow | skull | shadowPurple | drips |
| life_tap | blood | heart, droplet@br(pal shadowPurple) | shadowPurple | — |
| curse_of_agony | shadow | skull | shadowPurple | arcs |
| drain_life | shadow | droplet(pal blood) | blood | motion, drips |

**Druid**
| wrath | nature | bolt, leaf@br | leafGreen | glow |
|---|---|---|---|---|
| healing_touch | nature | hand, leaf@tl | leafGreen | sparkle |
| mark_of_the_wild | nature | paw | leafGreen | sparkle |
| moonfire | arcane | moon(pal silverWhite) | silverWhite | glow, sparkle |
| rejuvenation | nature | leaf | leafGreen | sparkle, glow |
| thorns | nature | leaf, claw_slash@br | leafGreen | — |
| entangling_roots | nature | tendrils | leafGreen | — |
| bear_form | earth | paw(pal earthBrown) | earthBrown | claw via claw_slash@br |

### 4.2 Items (all 39) — `iconId` column is what goes in data.ts (shared recipes where visuals match)

| item id | iconId | bg | prims | pal | fx |
|---|---|---|---|---|---|
| worn_sword | sword_plain | steel | sword | steel | — |
| gnarled_staff | staff_wood | wood | staff(pal earthBrown) | earthBrown | — |
| rusty_dagger | dagger_rusty | steel | dagger(pal earthBrown) | earthBrown | — |
| training_mace | mace_wood | wood | mace(pal earthBrown) | earthBrown | — |
| rusty_hatchet | axe_rusty | steel | axe(pal earthBrown) | earthBrown | — |
| recruit_tunic | tunic_leather | leather | chestplate(pal leather) | leather | — |
| apprentice_robe | robe_cloth | cloth | chestplate(pal cloth) | cloth | — |
| footpad_jerkin | jerkin_dark | leather | chestplate(pal earthBrown) | earthBrown | — |
| redbrook_blade | sword_fine | steel | sword, sunburst@tl | steel | glow |
| apprentice_staff | staff_arcane | arcane | staff, gem@br | arcanePink | sparkle |
| keen_dirk | dagger_keen | steel | dagger | steel | motion |
| militia_vest | vest_chain | steel | chestplate(pal steel) | steel | — |
| woven_robe | robe_arcane | cloth | chestplate, sigil_rune@br | arcanePink | — |
| shadow_jerkin | jerkin_shadow | shadow | chestplate(pal shadowPurple) | shadowPurple | — |
| oiled_boots | boots_leather | leather | boot | leather | glow |
| quilted_trousers | trousers_cloth | cloth | trousers | cloth | — |
| greyjaw_pelt_cloak | legs_pelt | leather | trousers, paw@br | earthBrown | — |
| baked_bread | bread | food | bread | gold | — |
| spring_water | water_flask | drink | potion(pal sky) | sky | — |
| roasted_boar | meat_roast | food | meat | ember | — |
| conjured_water | water_conjured | arcane | potion(pal sky) | sky | sparkle |
| gravecaller_blade | sword_grave | shadow | sword, skull@br | steel | glow |
| widowfang_dirk | dagger_widow | frost | dagger, web@tl | ice | — |
| gravecaller_staff | staff_grave | shadow | staff, skull@br | shadowPurple | glow |
| boar_hide | hide_boar | leather | pelt | earthBrown | — |
| gravecaller_sigil | sigil_grave | shadow | sigil_rune | shadowPurple | glow |
| blessed_wax | wax_blessed | holy | droplet(pal holyGold) | holyGold | sparkle |
| ghostly_essence | essence_ghost | shadow | flame(pal silverWhite) | silverWhite | sparkle |
| webwood_silk | silk_web | shadow | web | silverWhite | — |
| supply_crate | crate | wood | crate | earthBrown | — |
| greyjaw_fang | fang_grey | earth | fang(pal bone) | bone | — |
| wolf_fang | fang_cracked | junk | fang(pal bone) | bone | crack |
| bandit_bandana | bandana_red | junk | pelt(pal blood) | blood | — |
| tough_jerky | jerky | food | meat(pal earthBrown) | earthBrown | — |
| mudfin_scale | scale_murloc | junk | droplet(pal venom) | venom | — |
| tallow_candle | candle | junk | candle | gold | — |
| spider_leg | leg_spider | junk | claw_slash(0,0,0.9, pal shadowPurple) | shadowPurple | — |
| bone_fragments | bones | junk | bone(−6,−4,0.8), bone(8,6,0.7,rot 1.2) | bone | crack |
| linen_scrap | scrap_linen | junk | pelt(pal silverWhite) | silverWhite | — |

### 4.3 Misc icons

| iconId | bg | prims | pal | fx | used by |
|---|---|---|---|---|---|
| coin_gold | treasure | coin | gold | sparkle | loot-window money row (replaces the `$` div, hud.ts:886) |
| slot_empty | junk | *(none)* | silverWhite | — | empty equip slot (hud.ts:1059) — bg+bevel only, extra-dark vignette |

---

## 5. Buffs/debuffs & quality borders

### 5.1 Aura mini-icons (28 px)

`Aura.id` is always the ability id that applied it (see types.ts:37), so:

```ts
export function auraIconId(a: { id: string; kind: AuraKind }): string {
  return ABILITIES[a.id] ? a.id : `aura_${a.kind}`;
}
```

Generic fallback recipes `aura_<kind>` (covers future mob-applied auras — add all 20 to recipes.ts):

| kind | bg | prims | pal | · | kind | bg | prims | pal |
|---|---|---|---|---|---|---|---|---|
| dot | shadow | skull + drips fx | shadowPurple | | buff_ap | fury | fist | gold |
| hot | nature | heart + sparkle fx | leafGreen | | buff_armor | steel | shield | steel |
| slow | frost | boot, snowflake@tr | ice | | buff_int | arcane | eye | arcanePink |
| stun | storm | sunburst | gold | | buff_dodge | storm | shield + motion fx | sky |
| root | nature | tendrils | leafGreen | | buff_speed | earth | boot + motion fx | leather |
| incapacitate | storm | eye | sky | | buff_haste | storm | lightning | sky |
| polymorph | arcane | sheep_head | pink | | absorb | holy | shield + glow fx | silverWhite |
| attackspeed | storm | axe, snowflake@br | ice | | imbue | holy | sword, sunburst@tl | holyGold |
| buff_sta | blood | heart | blood | | buff_allstats | arcane | gem | arcanePink |
| thorns | nature | leaf, claw_slash@br | leafGreen | | form_bear | earth | paw | earthBrown |

In `renderAuras` (hud.ts:364-383): drop the 2-letter `textContent`; set `d.style.backgroundImage`; the existing red-tinted `.buff.debuff` CSS background is replaced by a **2 px border color**: buffs `#3a6ea8`, debuffs `#c0392b` (icon art now carries the identity). Keep the `.dur` child untouched.

### 5.2 Item quality borders (CSS, around the baked bevel)

```css
.item-icon { background-size: cover; background-position: center; }
.q-poor     { border-color:#9d9d9d !important; }
.q-common   { border-color:#e8e8e8 !important; }
.q-uncommon { border-color:#1eff00 !important; }
.q-rare     { border-color:#0070dd !important; }
.q-epic     { border-color:#a335ee !important; box-shadow:0 0 6px #a335ee66; }
```

Add a shared constant (DRY — three call sites currently hardcode partial maps and **silently show rare items as white**, hud.ts:133, 988, 1058):

```ts
export const QUALITY_COLOR: Record<string, string> = {
  poor:'#9d9d9d', common:'#ffffff', uncommon:'#1eff00', rare:'#0070dd', epic:'#a335ee',
};
```
Use it in `itemTooltip`, `renderBags`, `renderChar`, and quest reward rows.

---

## 6. Exact integration edits

1. **types.ts** — AbilityDef: `icon`/`iconColor` → `iconId: string`; ItemDef: add `iconId: string`, extend quality union with `'epic'`.
2. **data.ts** — mechanical: each ability `iconId: '<ability id>'`; each item `iconId` per §4.2 table.
3. **hud.ts:98-102** `itemIcon()` → delete; import `itemIconHtml` from icons:
   `return `<div class="item-icon q-${item.quality ?? 'common'}" style="background-image:url(${iconDataUrl(item.iconId)})"></div>`;`
4. **hud.ts:315-316** (action bar update): replace `ab.label.textContent/style.color` with a per-slot cached
   `if (ab.lastIcon !== a.iconId) { ab.lastIcon = a.iconId; ab.label.style.backgroundImage = `url(${iconDataUrl(a.iconId)})`; }`
   and on empty slots clear `backgroundImage` + `lastIcon`.
5. **hud.ts:375** (renderAuras) per §5.1.
6. **hud.ts:886** loot money row → `coin_gold` icon. **hud.ts:1059** empty slot → `slot_empty`.
7. **hud.ts:1089** spellbook → `<div class="spell-icon" style="background-image:url(${iconDataUrl(def.iconId)});${locked ? 'filter:grayscale(1) brightness(0.5)' : ''}"></div>`.
8. **index.html CSS**:
   - `.icon-label { position:absolute; inset:2px; border-radius:4px; background-size:cover; background-position:center; }`
   - replace lines 143-144 (`.unusable/.oor` color rules) with classic-MMO-style tints:
     `.action-btn.unusable .icon-label { filter: grayscale(.6) brightness(.55) sepia(.4) hue-rotate(190deg) saturate(2.2); }` (blue = no resource)
     `.action-btn.oor .icon-label { filter: grayscale(.4) brightness(.7) sepia(1) hue-rotate(-45deg) saturate(3); }` (red = out of range)
   - `.spell-icon`, `.item-icon`, `.buff`: add `background-size:cover; background-position:center;` and delete their `font-*`/text styles; add `.q-rare`/`.q-epic` from §5.2; replace `.buff.debuff` background rule with border colors from §5.1.
9. **Tests** (vitest, AAA): (a) every `ABILITIES[*].iconId` and `ITEMS[*].iconId` plus all `aura_*` ids resolve to a recipe (table-completeness, pure data — runs in node without DOM); (b) recipe schema validation (bg/pal/prim names exist); (c) jsdom/browser test: `iconDataUrl('fireball') === iconDataUrl('fireball')` (cache) and two calls across fresh modules produce identical strings (seeded determinism).
10. **Out of scope but same module later**: portrait emoji glyphs (`FAMILY_GLYPH`/`CLASS_GLYPH`, hud.ts:13-19) can be replaced with `paw/skull/web/...` primitives over class-color backgrounds — recipes named `portrait_<family>`/`portrait_<class>`; the gold `!`/`?` quest text markers stay as text (classic).

Sizing summary: one 96 px master per iconId; displayed at 46/34/28 px via `background-size:cover`. New content only ever adds a row to `recipes.ts` (and at most a new primitive painter), never new rendering code.