# The Smith's Heart aura art (2026-11-19)

The owner's ask of 2026-11-19: the raid's debuffs (and the bosses' own auras) show no icon of
their own. Every Smith's Heart aura but one fell back to the generic kind glyph
(`aura_<kind>`, `src/ui/aura_icon_view.ts` `resolveAuraIconId`): Hammer's Weight drew the stock
`aura_expose` hammer, a mark drew `aura_vulnerability`, and the fights' own markers
(`internal_cd`) all drew one shared glyph. The one exception, the Heat guardian's stacking
burn, already rides the mob `mob_stack_poison` painting.

The census: every aura id in the five fights' `*_AURAS` maps
(`src/sim/encounters/smith_heart/*_ids.ts`) and the wind kernel's three (`src/sim/wind_drift.ts`),
84 in all, each traced to the entity it is put on and rendered through its live tooltip.

Style reference: `public/ui/auras/stomp_stun.webp` (the house aura style: one painted subject
on a dark ground, a strong rim light, the element's glow; the earth slam suits the raid's
stone). Shipping: 128 px opaque WebP under `public/ui/auras/`, the provenance gate
`tests/aura_image_art.test.ts`.

## How it shipped

- **72 paintings cover 90 aura ids.** 72 ids own a painting; 18 more share one (the four
  gale portals, the three wind throws, the final fight's repeats of the Quench's cold and
  ice and the Breath's lightning, the guardians' slumbers). The two left unpainted are
  listed at the end.
- **Generated in ChatGPT** (OpenAI built-in image generation) in one conversation. The
  first message attached the style reference (upscaled to 512 px) with the house style
  brief; every message then gave one icon's number, name, what it does in the fight, the
  painting subject and its element palette (Hammer ochre-gold, Breath storm cyan, Quench ice
  blue, Heat white-gold on black basalt, the final boss all four), square, no text, no
  border. The exact prompts are in `accepted-aura-art.json`.
- **Two outputs were rejected and redone:** Encased in Rime first repeated the previous
  icon's flames instead of a figure frozen in ice, and Narrow Shelter first came back as a
  collage of earlier icons. `generation-report.json` records both.
- **The owner approved all 72** on 2026-11-19 in an HTML audit showing each icon at 128 px,
  40 px and 28 px with its number, name, what it does and the ids it covers.
- **Small:** each shipping WebP is 128 px, encoded with sharp (lanczos3, quality stepping
  down from 76 until the file is at most 6 KB), about 5.6 KB on average and 394 KB for all
  72. The full-size sources stay in the gitignored `tmp/imagegen/smith-heart-auras-2026-11-19/`.
- **Wiring:** `src/ui/smith_heart_aura_art.ts` holds the painted ids (folded into
  `AURA_FILE_IMAGE_IDS` in `src/ui/icons.ts`) and the shared aliases (folded into
  `RUNTIME_AURA_ICON_SOURCE_IDS` in `src/ui/aura_icon_view.ts`), so every aura surface paints
  the same icon. `mob_dormant` shares the Dormant painting: the raid's Hammer Vein Warders
  are the only mobs that wear it. Provenance rows live in `public/ui/auras/mapping.json`.
- **Pins:** `tests/smith_heart_aura_art.test.ts` (live ids, resolution, the 6 KB budget,
  and the census: a new raid aura fails it until it is painted, shares a painting, or is
  listed as unpainted with a reason), `tests/aura_image_art.test.ts` (files, mapping and
  manifest in parity) and `tests/aura_icon_view.test.ts` (the shared aliases).

## Tier 1: on the players (45 paintings, 55 auras)

| # | Aura id(s) | Name | What it does | Painting |
|---|---|---|---|---|
| 1 | `heart_hammers_weight` | Hammer's Weight | Tank: 100% more physical damage taken (swap) | A colossal stone hammer crushing down on a cracked steel pauldron, ochre-gold light in the cracks |
| 2 | `heart_wake_mark` | Wake the Stone | A pillar bursts out of the floor where you stand | A jagged stone pillar erupting from a cracked quarry floor out of a glowing ochre circle |
| 3 | `heart_falling_rock_mark` | Falling Rock | A rock falls on you; share it with 3 or more | A huge boulder plunging from above onto a glowing gold soak ring |
| 4 | `heart_mountains_rush_mark` | Mountain's Rush | The Guardian charges through where you stand | A stone giant's shoulder charging down a glowing red lane, rubble flying |
| 5 | `heart_resonance` | Resonance | You ring every second, hurting allies near you | A ringing amber crystal sending gold sound rings outward |
| 6 | `heart_quarry_collapse` | Quarry Collapse (Mythic) | Stacking raid-wide blows until the Cursed Pillar breaks | A cavern ceiling breaking apart, slabs falling in layers |
| 7 | `heart_breath_anchor`, `heart_breath_stone_charge` | Anchored in Calm (buff) | Thessaly's calm: no wind can move you | A planted boot in a still mint circle, the wind curving round it |
| 8 | `heart_breath_calm_spent` | Calm Spent | You cannot be anchored again for a while | The mint ward circle cracked and guttering, wind breaking through |
| 9 | `heart_breath_pinned` | Pressed to the Rim | Pinned against the rim's wall by the wind | A figure pinned flat against a cliff wall by howling wind |
| 10 | `heart_breath_drawn_lightning`, `heart_final_drawn` | Drawn Lightning | Lightning strikes follow you / arcs to allies | A cyan lightning bolt drawn down into a raised gauntlet |
| 11 | `heart_breath_sky_mark`, `heart_final_sky_mark` | Sky Strike | Lightning strikes where you stood | A storm cloud over a glowing cyan target, a bolt forming |
| 12 | `heart_breath_cradled` | Thunder's Cradle | Lifted and held in the storm, then the discharge | A body held in a cradle of lightning arcs inside a storm cloud |
| 13 | `heart_breath_portal_a`, `_b`, `_c`, `_d` | Portal A to D | A portal opens where you stand | A swirling teal wind portal opening on stone |
| 14 | `heart_breath_laden` | Gale-Laden | You carry the Knotted Gale; throw it into the void | Gauntlets straining to hold a heavy knot of storm wind |
| 15 | `heart_breath_roar_thrown`, `heart_breath_gale_tossed`, `heart_breath_blow_thrown` | Thrown, Tossed | Flung by the wind; you cannot move until set down | A figure tumbling through the air in a violent gust |
| 16 | `heart_breath_wind_battered`, `heart_breath_squall_ward` | Wind-Battered | Tank stacks: each Bellows Blow throws you further | A dented shield hammered by blasts of wind |
| 17 | `heart_breath_thunder_laden` | Thunder-Laden | Tank stacks: more magic damage, bolts leap to you | A chestplate crackling with cyan lightning |
| 18 | `heart_breath_blow_mark` | Bellows Blow | The Guardian's blow throws you off the Cornice | A great stone maw blasting a cone of wind straight out |
| 19 | `heart_breath_riding_gale` | Riding the Gale | Carried over the void to a floating isle | A figure riding a ribbon of wind over a void toward a floating isle |
| 20 | `heart_breath_windworn` (retired) | Windworn (Mythic) | No Gale Path will carry you for a while | A tattered cloak shredded and frayed by the wind |
| 21 | `wind_drift` | Bellows Wind | The wind carries you the way it blows | Sand and wind streaks sweeping hard in one direction over slate |
| 22 | `wind_draw` | Indrawn Breath | The guardian pulls you toward its maw | Wind streaks spiralling inward into a dark vortex mouth |
| 23 | `wind_blast` | Summit Roar | The roar's blast drives you away | A shockwave of wind exploding out of a roaring maw |
| 24 | `heart_quench_cold`, `heart_final_cold` (retired) | Quenching Cold | Your cold bar; at full you freeze | Frost creeping up a gauntlet's fingers, a deep blue glow |
| 25 | `heart_quench_warmth` | Huddled Warmth (buff) | Huddling with the raid warms you | Three small golden flames huddled in a ring amid blue frost |
| 26 | `heart_quench_frozen`, `heart_final_frozen` (retired) | Encased in Rime | Frozen solid; you take double damage | A figure locked in a faceted block of lake ice |
| 27 | `heart_quench_brittle` | Frost-Brittle | More damage taken after a shatter | An ice-coated shoulder plate cracking into shards |
| 28 | `heart_quench_splashed` | Rime Splash | An ally's shattering ice splashed you | A burst of shattering ice shards flying outward |
| 29 | `heart_quench_trapped`, `heart_final_under_ice` | Under the Ice | Fallen through the ice into freezing water | A hand reaching up out of black water through broken lake ice |
| 30 | `heart_quench_slash_mark`, `heart_final_blade_mark` | Crossing Blade | A blade flies across the lake through you | A great floating ice sword flying along a glowing line |
| 31 | `heart_quench_rime`, `heart_quench_rime_slow` | Living Rime | A crust of rime eats your healing and slows you | Living frost crust growing over a golden heart of healing light |
| 32 | `heart_quench_tempered` | Rime-Tempered | Tank stacks: cold held high, more frost damage | A steel tower shield sheathed in stacked layers of ice |
| 33 | `heart_heat_scorched` | Flare-Scorched | More magic damage taken | A scorched, smoking armour plate seared by white-gold flare |
| 34 | `heart_heat_kindling` | Kindling Mark | You will trail fire | A white-gold fire rune kindling on basalt, sparks rising |
| 35 | `heart_heat_trailing` | Cinder Trail | You leave burning patches behind you | A trail of burning cinder footprints across dark basalt |
| 36 | `heart_heat_hunted` | Hunted | A Rolling Cinder hunts you | A rolling ball of molten fire bearing down |
| 37 | `heart_final_shaken` | Vein-Shaken (Heroic) | Quarter changes hit you three times as hard | A shockwave cracking the ground in four vein colours |
| 38 | `heart_final_numbing` | Numbing Frost (Mythic) | 75% slower | Boots frozen to the floor in pale crystal |
| 39 | `heart_final_ember_mark` | Ember Mark (Heroic) | Embers fall at your feet and smoulder | Embers raining down into a smouldering marked pool |
| 40 | `heart_final_shell` | Stone Shell | A shell that absorbs your healing | A figure encased in a granite shell, ochre light in the cracks |
| 41 | `heart_final_crushed`, `heart_final_anvil_mark` | Crushed | The next Anvil hits you three times over | A great stone anvil looming overhead, its crushing shadow |
| 42 | `heart_final_coal` | Bursting Coal | The coal bursts on your allies; leave the group | A cracked glowing coal about to burst, fire leaking |
| 43 | `heart_final_tethered` | Wind-Tethered | The Splinter of the Breath hunts you | A crackling wind tether binding a figure to a storm-stone beast |
| 44 | `heart_final_ring_chill` | Quenching Ring | 50% slower: you crossed a ring of frost | A ring of frost freezing the feet that cross it |
| 45 | `heart_final_plunge` | Falling (Mythic) | Falling with the collapsing floor | A figure falling into a dark abyss among breaking floor stones |

## Tier 2: on the bosses and adds (27 paintings, 35 auras)

| # | Aura id(s) | Name | Painting |
|---|---|---|---|
| 46 | `heart_memory_of_stone` | Memory of Stone | A glowing ochre stone tablet carved with a fallen silhouette |
| 47 | `heart_council_enraged` | Enraged | A stone giant's face roaring, its cracks blazing red-molten |
| 48 | `heart_narrow_shelter` | Narrow Shelter | One stone pillar, three figures crouched in its strip of shadow from a gold blast |
| 49 | `heart_bond_of_the_stone` | Bond of the Stone | Two stone hands bound by a braided gold tether of light |
| 50 | `heart_rush_shattered`, `heart_rush_exposed` | Shattered Charge | A stone giant reeling from a shattered crimson-magenta pillar |
| 51 | `heart_council_intro`, `heart_breath_intro`, `heart_quench_intro`, `heart_heat_intro`, `mob_dormant` | Dormant | A stone giant asleep in a spur of rock, a faint light inside |
| 52 | `heart_breath_storm_unbound` | Storm Unbound | A body of lightning tearing free of its stone |
| 53 | `heart_breath_swelling_storm`, `heart_breath_gale_cocoon`, `heart_breath_cocoon_hold` | Swelling Storm | A storm cloud swelling, rings of pressure, lightning |
| 54 | `heart_breath_gale_bulwark`, `heart_breath_bulwark_hold` (retired) | Gale Bulwark | A vortex shield of wind and stone |
| 55 | `heart_quench_blades_awake` | The Blades Awake | Four great ice swords rising out of a frozen lake |
| 56 | `heart_quench_deepening` | Deepening Cold | Icicles growing over a deepening blue frost |
| 57 | `heart_heat_state` | The First Flame | A white-gold flame burning in a basalt heart |
| 58 | `heart_heat_crust` | Cooling Crust | A molten ball cooling into a hard dark crust |
| 59 | `heart_final_state`, `heart_final_phase` | The Masterless Strength | A four-coloured crystal heart blazing in a stone chest |
| 60 | `heart_final_root` (retired) | Taking Root | Stone roots driving from giant feet into the floor |
| 61 | `heart_final_unbound` | Heart Unbound | The heart crystal overflowing in four colours in a central ring |
| 62 to 65 | `heart_final_overload_hammer`, `_breath`, `_quench`, `_heat` | Overload | A vein brimming with its element's light (one per vein) |
| 66 | `heart_final_shield`, `heart_final_rising` | Gathered Strength | A dome of four-coloured light shielding a giant |
| 67 | `heart_final_fury` | Masterless Fury | A crowned stone head roaring four-coloured fire |
| 68 | `heart_final_hidden` | Unmade Anvil | An anvil-shaped floor breaking into falling quarters |
| 69 to 72 | `heart_final_poured_hammer`, `_breath`, `_quench`, `_heat` | Poured Strength | An element poured into the giant (one per vein) |

Not painted: `heart_endless_song` (rides a pillar object, never on a frame) and
`stackpoison_heart_heat_guardian` (already painted, `mob_stack_poison`).

## Amended after the Breath's isle rework

The Guardian of the Breath's isles became a phase at half health
(`src/sim/encounters/smith_heart/breath_isles.ts`), which removed the Gale Bulwark, its
hold and Windworn. Their two paintings (rows 20 and 54) left the shipping set with their
mapping and manifest rows, so 70 paintings ship. The phase's four new unit auras share
paintings already in the set, which brings the shared aliases to 21 and the ids covered
to 91:

- `heart_breath_gale_cocoon` and `heart_breath_cocoon_hold` (the guardian, untouchable
  while Skyrend Nova gathers, held where it began) wear Swelling Storm (row 53).
- `heart_breath_squall_ward` (the Squall Shieldbearer's frontal ward) wears Wind-Battered
  (row 16), the shield in the wind.
- `heart_breath_stone_charge` (a Stillstone's shared Still the Gale channel) wears Anchored
  in Calm (row 7), Thessaly's calm stilling the wind.

## Amended after the final boss rework

The Masterless Strength's rework (`src/sim/encounters/smith_heart/final.ts` and its
quarter modules) took away Taking Root and the final fight's own cold and freeze, so the
Taking Root painting (row 60) left the shipping set with its mapping and manifest rows,
and `heart_final_cold` and `heart_final_frozen` no longer share rows 24 and 26. That
leaves 69 paintings. The rework's three new player marks share paintings already in the
set, which brings the shared aliases to 22 and keeps the ids covered at 91:

- `heart_final_sky_mark` (Sky Strike, lightning falls where the marked player stands)
  wears the Breath's Sky Strike (row 11).
- `heart_final_blade_mark` (Crossing Blade, the line runs through the marked player)
  wears the Quench's Crossing Blade (row 30).
- `heart_final_anvil_mark` (Weight of the Anvil, its circle follows the marked player)
  wears Crushed (row 41), the anvil looming overhead.
