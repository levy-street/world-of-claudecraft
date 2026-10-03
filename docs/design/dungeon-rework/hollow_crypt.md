# The Hollow Crypt: rework design (pilot)

Status: design only, for owner approval. Shared rules, toolkit and system ids
(G1 to G9) are in `README.md` in this folder.

At a glance: levels 7 to 10 (normal), level 20 entry on heroic (mobs at 22). Four
bosses (Sexton Marrow, Rimeweb, Cantor Ilvane, Morthen the Gravecaller), nine
mandatory trash pulls, one branch that splits and rejoins, about 15 minutes for a
good group. Every boss drops its own loot on both difficulties.

## 1. Current state audit (release/v0.45.0)

| Aspect | Today | Source |
|---|---|---|
| Entrance | Portal at the chapel ruin in Eastbrook Vale, `doorPos` (80, 90) | `DUNGEON_DEFS.hollow_crypt`, `src/sim/content/dungeons.ts` |
| Interior | Shared `crypt` nave: one room z -19 to 112, pillar rows at x +-14, sarcophagi at x +-19, raised dais at z 96 (r 9.5). The Sunken Bastion uses the SAME layout | `CRYPT_LAYOUT`, `src/sim/dungeon_layout.ts` |
| Trash | 13 spawns in pairs up one corridor: Crypt Shambler (L7 to 8, Onrush charge), Hollow Acolyte (L8, no kit), Bonechill Widow (L8 to 9, no kit) | `CRYPT_SPAWN_LIST` |
| Bosses | Sexton Marrow (L9 miniboss, plain stats plus Onrush) and Morthen the Gravecaller (L10, one untelegraphed `aoePulse` Shadow Pulse 12 to 18 every 10 s) | `DUNGEON_MOBS` |
| Health | Morthen: (230 + 32 x 10) x 2.3 elite = about 1,265 hp; he dies in roughly 20 s | `createMob` in `src/sim/entity.ts` |
| Heroic | Stat transform only: level 22, health x3.8, damage x20, armor x1.3; no new mechanics | `HEROIC_DUNGEON_TUNING.hollow_crypt` |
| Loot | Marrow: two greens at 40 percent. Morthen: guaranteed green trio plus bonus group, heroic epics, Bastion Sigil trinket, mount chance, finale gold | `dungeons.ts`, `HEROIC_BOSS_LOOT` in `heroic_loot.ts` |
| Skipping | Pairs spaced beyond social range; no gates; `bossChainPull` off | `CRYPT_SPAWN_LIST` comment |
| Finder | Marrow listed with zero mechanics; Morthen with `shadow_pulse` | `HOLLOW_CRYPT_ENCOUNTERS` |
| Deeds and Reliquary | `dgn_hollow_crypt`, `dgn_hollow_crypt_heroic`, `dgn_morthen_flawless`, `dgn_morthen_trio`; pages `conquerors_hollow_crypt` and `_heroic`, every relic sourced from Morthen | `deeds.ts`, `reliquary.ts` |
| Quests | Brother Aldric's chain: `q_whispers`, `q_names_of_the_dead` (the sexton's burial ledger), `q_silence_the_call`, `q_rite` (Blessed Tallow for the binding rite that unseals the crypt), `q_hollow` (kill Morthen; class weapon rewards) | `src/sim/content/zone1.ts` |

What works: a clear, lore-rich story (the Gravecaller sect, the sexton's ledger,
the tallow rite), a friendly first dungeon length, a real finale gold ladder.
What is weak: one corridor, two bosses with almost no mechanics, trivially
skippable, loot concentrated on the last boss, heroic is only bigger numbers,
and the fights are over before any mechanic matters.

## 2. Theme and story hook

Under the chapel of Eastbrook Vale lie the burial works of the old parish: the
undercroft where the Vale laid its dead, the sexton's own graveyard cavern, the
collapsed catacombs the frost spiders took, the choir chapel, and at the bottom
the nave where the Gravecallers once held their rites. Morthen has woken all of it.

The dungeon tells Brother Aldric's story in space: the sexton whose ledger the
player already gathered is the first boss (still digging); the widows the player
fought upstairs have a mother below; the choir that sang the dead to rest now
sings them awake; and the binding rite the player prepared (`q_rite`, Blessed
Tallow) becomes the Remembrance Candles that break Morthen's own rite. No quest
changes are required; optional follow-ups are listed in section 11.

**Position:** unchanged. The entrance stays at the chapel ruin (80, 90), which
the whole quest chain points at. Only the interior is replaced, under a new
interior key, so no world-map, portal or quest change is needed.

## 3. Route map

**Open air (owner direction, 2026-09-29).** The Crypt is not an enclosed
dungeon: it is a ruined abbey and necropolis on a crag at dusk, every nave
roofless, every terrace an authored surface of the open field
(`src/sim/content/hollow_crypt_layout.ts`, `HOLLOW_CRYPT_FIELD`; engine in
`src/sim/instances/authored_field/`). Terraces end in crags that drop into a
misted void; the edges are the walls. The precedent is Wildheart Basin and the
Buried Hoard valley. Instance-local yards, z forward, floor heights in
parentheses; about 230 by 390 yd.

```
 z 233  ( ring 24 )  THE RITE RING: roofless ritual circle, r 28, four candle
          |          pillars, altar, the soul column.   Boss 4: Morthen
          |          [Unquiet Ward: seals while Morthen is engaged]
 z 168  THE BONE STAIR: spiral path up the crag (5 to 24)
          |          [Bone Stair Gate: s1 on the Stair Landing]
 z 150  CHOIR LOFT (5), balcony, Bone Organ.   Boss 3: Cantor Ilvane
 z 112  CHOIR RUIN (0), roofless nave with pews
          |          [Choir Door: q1 + q2 + Ilvane]
          |          [Twin Seals: p1 + drake + p2 + Marrow + Rimeweb; seal during Ilvane]
 z 20   PROCESSIONAL (0), candle pillars, p1, p2, the Ossuary Drake flying overhead
   west                                                  east
   SEXTON'S YARD (2) graveyard, w1 w3 w4, w2 flock   WIDOW'S GALLERY (-6) frost
   ramp up to the BELL YARD (8)                         ravine, e1 e3; RIM WALK (0) e2
   [Bone Barrier: w1 to w4; seals during Marrow]        [Frost-Web Curtain: e1 to e3;
   Boss 1: Marrow under the fallen bell tower            seals during Rimeweb]
   back down the ramp and the west causeway             GREAT WEB (-6) Boss 2: Rimeweb
                                                        [Webbed Causeway: Rimeweb]
          |          [Undercroft Grille: c1 + c2 + c3 + c4]
 z -80  CLOISTER (0), ossuary monument, c1, c2 patrol loop, c3 east arcade, c4 grille
 z -116 THE CHAPEL STAIR down from the entry landing (20): the first vista
```

The order is: Cloister, then BOTH wings in either order (west: Yard, Bell Yard
and Marrow, back down the yard ramp and over the west causeway; east: Gallery,
Rim Walk, Great Web and Rimeweb, back over the Webbed Causeway), the Processional,
the Choir and Ilvane, the Bone Stair, the Rite Ring and Morthen.

**One stair, one meaning (third pass, 2026-09-30).** The first build had a Bridge
of Bone that assembled out of the mist on Marrow's death, a white bone stair from
the Processional up to the Bell Yard. A playtest read it as the way on, but it only
led back into an arena already cleared, so it is gone: no gate reveals a hidden
walkway, and the only stair the crypt builds for the route is the Bone Stair, the
real, continuous way from the Stair Landing (5) up to the Rite Ring (24), closed
until its guard (s1) dies (`tests/hollow_crypt_stair_route.test.ts`).

**Landmarks and sight lines.** From the entry landing the whole necropolis lies
below: the cloister, the processional, the leaning bell tower against the moon
on the west, the frost ravine glittering on the east, and at the far end the
soul column rising from the Rite Ring, visible from every terrace. The finale is
seen from the first step.

**Gates and seals (no skipping, G7).** Gate state is derived every tick from the
claim roster (`src/sim/instances/dungeon_gates.ts`): a gate is closed until its
packs and bosses are dead, sealed while its `sealWhileEngaged` boss is alive and
engaged, open otherwise. A wipe clears the seal and never re-closes a cleared
gate, so a corpse run always has a path. `bossChainPull` stays on. Kinds:
portcullis, bone barrier, frost-web curtain, warded arch, rite ward.

## 4. Trash (owner direction, 2026-09-29)

The trash does NOT teach the next boss. It is simple, readable pack play in the
style of classic five-man trash: an add summon you must stop, interruptible
casts, a frontal cone, a leap, an on-death burst. Engine:
`src/sim/mob/trash_kit/` (`MobTemplate.trashKit`, cast bars, zero-rng targets);
templates: `src/sim/content/hollow_crypt_trash.ts`; floor telegraphs:
`src/render/hollow_crypt/crypt_trash_fx.ts` (every graphics tier).

| Mob (level) | Look | Mechanic (normal numbers) | Answer |
|---|---|---|---|
| Ossuary Warrior (8 to 9, elite) | KayKit skeleton warrior | Grave Cleave: 1.6 s bar, then 16 to 24 physical in a 110 degree, 8 yd frontal cone, every 10 s | Only the tank stands in front |
| Gravecaller Adept (8, elite) | KayKit skeleton mage | Casts from range; Grave Bolt: 2.5 s interruptible shadow bar at a hashed random player, 26 to 34, every 9 s | Kick it |
| Ossuary Cutthroat (8, elite) | KayKit skeleton rogue | Rending Leap: every 14 s leaps onto the farthest mana user 8 to 30 yd away, 5 bleed every 2 s for 8 s, fixates 4 s | Peel it off the healer, taunt it back |
| Gravecaller Necromancer (9, elite) | KayKit necromancer | Raise Bones: 3 s interruptible channel raising a Bone Minion (two alive at most), every 15 s | Kick it, or kill the minion fast |
| Bone Minion (8) | KayKit minion | Left alive 8 s it grows into an elite Bone Brute; on death a Bone Burst: 1.8 s ring fuse, 12 to 18 within 3.5 yd | Burn it, then step out of its ring |
| Bone Brute (9, elite) | KayKit skeleton golem | A heavy hitter | Do not let minions grow |
| Chapel Gargoyle (9, elite) | A great, heavy stone gargoyle (about 4.5 yd crouched, twice a player): ram and swept horns, ember eyes, cracked weathered stone, ribbed stone wings | Waits as a statue on a whole arcade arch, cracks free and dives in when its pack is pulled (a shockwave where it lands); rakes with its talons; Stone Shriek: 2 s interruptible bar, 2.5 s stun within 10 yd, every 16 s (violet sonic rings, a shockwave on the stun) | Kick it or step out of the ring |
| Crow Caller (8, elite) | Hooded Gravecaller | Casts from range; Murder Call: 3 s interruptible bar summoning 4 Carrion Crows (a whole flock must fit under 6 alive), every 18 s | Kick it |
| Carrion Crow (7) | New crow | Weak fast fliers in flocks | Area damage |
| Ossuary Drake (10, elite) | A colossal skeletal wyvern: head about 10 yd up, wings about 34 yd across, a soul fire caged in its ribs; it walks on its wing knuckles and fights with its jaws, never its claws | Flies the Processional at 22 yd (two downbeats and a long glide), cries and glides down when pulled; bites; Barrowflame Breath (2 s bar while it draws the fire up, then a torrent of spectral fire over a 70 degree 14 yd cone, 26 to 34 fire, the cone left scorched), Tail Lash (1 s bar, 120 degree 10 yd cone behind it), Wing Gust (1.5 s bar, 10 yd ring, 8 yd knockback) | Tank faces it away, nobody behind, spread from the gust |

Heroic scales every landing through the dungeon's mechanic multiplier; the
lighter casters, the cutthroat and the non-elite crows ride their own factor to
the 500 heroic swing floor (`HEROIC_DUNGEON_TUNING.hollow_crypt`).

**Layout (13 held packs, 4 patrols, every one gated):**

| Pack | Where | Members |
|---|---|---|
| c1 | Chapel Stair foot | 2 Warriors, 1 Adept, 1 Gargoyle on the south arcade |
| c2 (patrol) | Monument loop | 2 Warriors, 1 Cutthroat |
| c3 | East arcade | 1 Adept, 1 Warrior, 2 Gargoyles on the arches |
| c4 | Undercroft Grille | 1 Necromancer, 2 Warriors, 2 Gargoyles on the corner arches |
| p1 | Processional south | 1 Warrior, 1 Cutthroat, 2 Adepts |
| drake (patrol) | Flying the Processional | the Ossuary Drake |
| p2 | Choir approach | 1 Necromancer, 2 Warriors, 1 Adept |
| w1 | Yard, by the causeway | 1 Crow Caller, 4 Crows |
| w2 (patrol) | Circling over the yard | 5 Crows |
| w3 | Yard trench | 1 Necromancer, 1 Warrior, 1 Cutthroat |
| w4 | Bell pit | 1 Crow Caller, 1 Warrior, 3 Crows |
| e1 | Gallery nest | 2 Bonechill Widows, 1 Adept (and the 4 rime egg sacs) |
| e2 | Rim walk | 1 Warrior, 1 Cutthroat, 1 Adept |
| e3 | Web neck | 1 Necromancer, 2 Warriors |
| q1 | Choir nave | 2 Warriors, 1 Necromancer, 1 Adept |
| q2 (patrol) | Nave aisle | 1 Warrior, 1 Cutthroat |
| s1 | Stair Landing | 1 Necromancer, 2 Warriors, 1 Cutthroat |

Count: 62 trash (50 elite, the drake among them) plus summons. Gates: the Grille waits on c1 to c4,
the Bone Barrier on w1 to w4, the Frost-Web Curtain on e1 to e3, the Twin Seals
on p1, the drake and p2 (and both wing bosses), the Choir Door on q1 and q2 (and
Ilvane), the Bone Stair Gate on s1 (`tests/hollow_crypt_route.test.ts`).

**Why this count fits 15 minutes.** About 24,000 trash health at level 8 to 9
(49 elites at about 370 to 600, the drake about 1,040, 12 crows at about 60). At
the planning party DPS of 45 that is about 8.9 minutes single target; the
cleave and area damage a group brings on packs of 3 to 5 (and crows dying to
it in seconds) take it to about 6.5. The four bosses are about 6.3 minutes (70,
80, 80 and 150 s), walking about 2: about 15 minutes. To be measured with the
meters harness before shipping, like the boss health.

## 5. Bosses

Planning health comes from `target fight length x party DPS`. Party DPS is a
planning estimate (45 at level 8, 50 at 9, 55 at 10; three damage dealers at
about 12 to 14 each plus tank and healer output) to be replaced by a measured
value from the meters harness before shipping; the shipped health is set through
`NormalDungeonTuning.healthMultiplierByMob` for `hollow_crypt`. Damage numbers are
normal-mode bases anchored to Morthen's shipped Shadow Pulse (12 to 18 at level
10) and a level-10 cloth wearer of about 190 hp; heroic damage scales through the
existing `mechanicDamageMult` of the heroic transform. Every telegraph rides G1
(instance encounter cues). Every boss is CC- and snare-immune (the `morthen` rule)
and stamps the mechanic spacing lock (`mob/mechanic_spacing.ts`), so no two
mechanics land on one tick.

### 5.1 Boss 1: Sexton Marrow (kept, promoted from miniboss)

- **Id:** `sexton_marrow` (kept). Level 8 (was 9). Planning health about 3,150
  (70 s at 45 DPS).
- **Fantasy:** the parish gravedigger, raised and still digging. He measures
  the living for their graves and rings the burial bell to call the dead up.
- **Model:** new hunched skeletal gravedigger with a long spade and a hooded
  lantern (asset pipeline, Tripo on the KayKit skeleton rig; two-hand attacks use
  only the 2H chop clip). Fallback: current `skel_mage` look with a spade prop.
- **Arena: the Sexton's Yard.** An underground graveyard cavern about 56 by 48
  yd; soft earth floor, crooked headstones along the walls (no collision in the
  middle), roots hanging from the roof, the Burial Bell (a 3 m bronze bell on a
  chain in a shaft) above a stone bell pit at the north end.
- **Core gimmick: graves you place, dead you raise.**
  - *Measured for the Grave:* every 14 s (first at 8 s) Marrow marks a random
    non-tank player: a 3 yd ring follows them for 4 s. When it ends, an Open Grave
    (3 yd pit) opens where the player STANDS and deals 18 to 24 physical to anyone
    inside it. Graves persist for the fight (cap 8; the oldest collapses). Standing
    in a grave: Grave Dirt, 4 shadow per second and 40 percent slow. (G4)
  - *Burial Toll:* at 66 and 33 percent health Marrow walks to the bell pit and
    rings the bell (3 s cast bar, immune while ringing): 10 to 14 shadow to
    everyone, and every Open Grave raises one Restless Bones (the shipped
    `restless_bones` template, level 7, non-elite). (`summonAdds`-style thresholds,
    spawn points taken from the live graves.)
- **Counterplay:** the marked player walks to the room's edge or into a chosen
  "grave corner" before the fuse ends, so the raised dead come from one place the
  tank can collect. Graves under the melee turn the Toll into chaos.
- **Role checks:** tank gathers each raised wave; healer covers the Toll burst
  and any Grave Dirt; damage dealers place their graves well and clean up adds.
- **Heroic extras:**
  1. *Gravedigger's Blow* (the P1 tank-stack sketch of
     `docs/prd/dungeon-mechanic-primitives.md`): every 3rd melee applies +12
     percent damage taken for 12 s, up to 5 stacks; plus *Earthbound*: while Marrow
     stands in an Open Grave his attacks are 25 percent faster. The tank must keep
     him off the graves.
  2. *Unquiet Earth:* a player who stays in an Open Grave for 2 s raises a
     Restless Bones from it on the spot, between Tolls.

### 5.2 Boss 2: Rimeweb, Mother of the Bonechill (new)

- **Id:** `rimeweb` (new). Level 9, spider family. Planning health about 3,750
  (75 s at 50 DPS).
- **Fantasy:** the frost spider matriarch whose brood crept up into the chapel
  yard. Her silk is rime-cold and she keeps her prey alive.
- **Model:** reuse the Broodmother Vysska spider GLB from the Buried Hoard nest
  room, rime-white material, larger scale; fallback the Bonechill Widow rig at
  about 2x.
- **Arena: the Great Web.** A collapsed catacomb cathedral about 50 yd across:
  the lower floor, a raised rim walkway reached by a ramp, and the hero piece, a
  colossal rime-white web strung between two broken columns at the north wall.
  Egg sacs cluster along the side walls.
- **Core gimmick: rescue the cocooned.**
  - *Silk Shroud:* every 20 s (first at 12 s), a 1.5 s cast wraps a random non-tank
    player in a Silk Cocoon: the victim is stunned and takes 5 frost per second.
    The cocoon is an attackable object with health equal to 12 percent of
    Rimeweb's (about 450). If it is not broken in 12 s the victim is Drained
    (loses half their current health and pops free) and Rimeweb heals 5 percent.
    (reuse `rift/hoard_cocoon*.ts` behind G1)
  - *Silk Lines:* every 25 s (first at 18 s), three strands fan out from her
    facing (30 degrees apart, 30 yd long, 2 yd wide) after a 1.5 s warning; each
    strip persists 10 s: first contact roots for 2 s, then 50 percent slow.
    (reuse `rift/hoard_silk_snare.ts`)
  - *Bonechill Venom:* her bites stack a frost slow (10 percent per stack, up to
    3, 9 s; the `stackPoison` affix).
  - *Brood Call:* at 50 and 25 percent, 3 Rimeweb Hatchlings drop from the web
    and pounce the healer or a damage dealer (`summonAdds` plus `broodWhelp`).
- **Counterplay:** switch to the cocoon at once, and path to it around the silk.
- **Role checks:** damage dealers switch targets; tank peels hatchlings and faces
  Rimeweb so her lines cross empty floor; healer carries the cocoon victim and the
  venom stacks.
- **Heroic extras:**
  1. *Twin Shroud:* each Silk Shroud cocoons two players; both must be freed.
  2. *Rimebound Egg Sacs:* a Silk Line that crosses a wall egg sac hatches it (2
     hatchlings). The tank must turn her so her lines point away from the walls.

### 5.3 Boss 3: Cantor Ilvane and the Hollow Choir (new)

- **Ids:** `cantor_ilvane` (boss) and `hollow_chorister` (two adds in the arena,
  the same template as the P8 trash). Ilvane level 9, planning health about
  3,000; each Chorister about 750 (together about 80 s at 50 DPS).
- **Fantasy:** the parish cantor who sang the dead to rest. Morthen made her
  choir sing them awake.
- **Model:** new skeletal cantor in a tattered cassock, hymnal in hand (asset
  pipeline, caster clips); Choristers are the `skel_mage` look with hoods.
- **Arena: the Choir Loft.** A tall ossuary chapel. The group enters on the lower
  floor; Ilvane stands on the raised loft terrace (+4 yd), reached by two side
  ramps. Six thick bone-clad pillars stand on the loft (line-of-sight cover); the
  hero piece is the Bone Organ with femur pipes on the back wall; a rear window
  looks down into the Rite Nave.
- **Core gimmick: interrupt it or hide from it.**
  - *Dirge of the Hollow:* every 12 s (first at 6 s), a 2.5 s interruptible cast
    (shadow school). On completion: 28 to 36 shadow to every player within 40 yd
    who has LINE OF SIGHT to Ilvane, and Hushed (4 s silence). Counters: an
    interrupt, a stun (breaks the cast), or a pillar between you and her. (G6)
  - *Harmony:* the two Choristers stand at the loft balustrade channeling on her;
    each living Chorister reduces her damage taken by 30 percent and her Dirge
    cast time to 2.0 s. Choristers cast a weak Discord bolt.
  - *Crescendo:* below 30 percent, the Dirge comes every 8 s.
- **Counterplay:** kill the Choristers first; rotate interrupts; anyone without
  an interrupt steps behind a pillar at the cast bar.
- **Role checks:** damage dealers and tank interrupt and kill in order; healer
  plays line of sight (a silenced healer is the real danger). At levels 8 to 9
  some groups have no interrupt yet (warrior Pummel at 8 and mage Counterspell at
  4 are the early ones), so the uninterrupted Dirge costs about a fifth of a cloth
  wearer's health, never a wipe on normal.
- **Heroic extras:**
  1. *Encore:* a Chorister killed more than 10 s before its partner rises again
     at half health (once each). Kill them together.
  2. *Unbroken Verse:* every third Dirge cannot be interrupted (shield motif on the
     cast bar) and silences for 6 s: pillars only.

### 5.4 Boss 4: Morthen the Gravecaller (kept, rebuilt)

- **Id:** `morthen` (kept). Level 10. Planning health about 6,600 (120 s of
  damage at 55 DPS, plus the immune phase: about 150 s total).
- **Fantasy:** the Gravecaller at the bottom of the Vale, holding the rite that
  calls every name in the ledger out of the earth.
- **Model:** keep `skel_boss`; phase 3 adds a great bone scythe (reuse the Bonelord
  Xarreth scythe asset, `docs/design/bone-reaper/`).
- **Arena: the Rite Nave.** A circular nave about 40 yd in radius. A raised dais
  (10 yd) holds the altar and the Ledger of Names on a lectern (hero piece, ties
  to the shipped `morthen_grimoire`). Four Remembrance Candles (3 m tallow pillars)
  stand at north, east, south and west on the floor ring, 24 yd from the center;
  four sarcophagus alcoves sit in the walls between them. A bone rose window above
  pours the soul-light column seen from the Choir Loft.
- **Core gimmick: a three-act rite you must break.**
  - **Phase 1, The Calling (100 to 65 percent).**
    - *Shadow Pulse* (kept name, now telegraphed): every 12 s a 2 s cast, then 16
      to 22 shadow within 12 yd. Melee steps out at the bar. (`bigCast`)
    - *Gravecall:* every 15 s (first at 6 s) a Bound Soul (non-elite, level 8,
      about 70 hp, slow walker, can be rooted, slowed, feared or stunned) rises
      from the next alcove in clockwise order and walks to Morthen. On arrival he
      is Gorged on the Dead: +10 percent damage and he heals 3 percent, stacking
      for the fight. (G5)
  - **Phase 2, the Rite of the Unquiet (at 65 percent).** Morthen climbs to the
    altar inside the Unquiet Ward (immune) and channels; the four candles gutter
    out. Grave Chill pulses 4 shadow per second on everyone, rising by 1 every 5 s.
    Two Unmade Sentinels (elite, level 9) climb the dais steps. Any player can
    relight a candle with a 2 s channel, broken by damage taken from an enemy (the
    Grave Chill ticks never break it) (G3). Each lit candle cracks the ward by a
    quarter; the fourth shatters it: the Rite Broken, Morthen stunned for 8 s and
    taking 25 percent more damage during it. (G2)
  - **Phase 3, Last Rites (at 35 percent).** Gravecall stops. *Reap the Unquiet:*
    every 14 s a 2 s cast, then a 90 degree, 12 yd frontal sweep for 45 to 55
    shadow (`breathCone`); the tank takes it facing away from the group. Shadow
    Pulse every 9 s.
- **Counterplay:** kill or control every soul before it arrives; in phase 2 the
  tank holds the Sentinels on the dais while the others spread to the candles;
  in phase 3 nobody but the tank stands in front.
- **Role checks:** everyone intercepts (class crowd control pays off); tank holds
  adds away from the runners and later faces the Reap; healer rides the rising
  Grave Chill; damage dealers relight fast and burn the 8 s window.
- **Heroic extras:**
  1. *Name the Dead:* in phase 2 the Ledger names the candles in an order (the
     next one glows). Lighting the wrong candle snuffs the last lit one and deals
     30 shadow to the lighter.
  2. *Grasp of the Grave:* in every phase, every 16 s two random players get a 1.5
     s, 4 yd ring; hands erupt: 3 s root and 20 shadow. Not persistent (unlike
     Marrow's graves); in phase 3 a rooted player in front of the Reap dies.

Unique core per boss: placed graves that become adds (Marrow), rescue the
cocooned (Rimeweb), interrupt or break line of sight (Ilvane), intercept walkers
then break the rite with the room's candles (Morthen). No core repeats.

## 6. Pacing to 15 minutes

| Segment | Content | Time |
|---|---|---|
| Cloister | c1, c2, c3, c4 | 3 min |
| Processional | p1, the drake, p2 | 2 min |
| West wing | w1 to w4, Marrow (70 s) | 3 min |
| East wing | e1 to e3, Rimeweb (80 s) | 3 min |
| Choir and Loft | q1, q2, Ilvane (80 s) | 2 min |
| Stair and Ring | s1, Morthen (150 s) | 3 min |
| Total | 17 pulls, 4 bosses | about 15 min |

## 7. Environment art direction

Open air at dusk turning to night. The render lives in `src/render/hollow_crypt/`
(its `CLAUDE.md` owns the performance and prewarm contract).

- **Sky and light.** Own sky dome (a huge low moon, moving cloud bands, stars),
  fog state `hollowCrypt` (cold blue, far), the moon as the key light, warm
  tallow point lights only at candles and lanterns (carrier budget), violet and
  soul green reserved for the enemy's magic and the finale.
- **Palette:** bone ivory and grave-earth umber stone, tallow amber for the only
  warm light, Gravecaller violet and soul green for the enemy, rime white-blue
  only in the east wing. Telegraph colors stay brighter than any of these.
- **Per space:**
  - Entry landing and Chapel Stair: a broken chapel on the crag top, the first
    vista over the whole necropolis.
  - Cloister: roofless arcades, the ossuary monument, a worn rosette cut in the
    floor, sarcophagi, candle clusters.
  - Sexton's Yard and Bell Yard: crooked headstones, open graves, dead trees,
    lanterns, the collapsed bell tower as the west skyline hero, bone dust.
  - Widow's Gallery, Rim Walk, Great Web: a frost ravine, silk sheets, web
    columns, egg clusters, the Great Web hanging over the chasm, frost glitter.
  - Choir ruin and Loft: roofless nave, pews, choir pillars, the Bone Organ,
    a tracery window framing the Rite Ring beyond.
  - Bone Stair: a spiral path up the crag, wisp rivers flowing up it.
  - Rite Ring: the roofless ritual circle, engraved glyph rings, four
    Remembrance Candles on pillars, altar, the soul column visible from afar.
- **Signature moments.** First vista; bell tower against the moon; the light
  column seen from every terrace; layered ground mist and chasm mist; soul-wisp
  rivers flowing toward the ring; gate reveals (a barrier crumbles, a web
  curtain parts, a ward fades) over
  `GATE_REVEAL_SECONDS`.
- **Blender kit.** `docs/design/dungeon-rework/kit/build_hollow_crypt_kit.py`
  (shared helpers `hckit.py`) bakes about fifty `Kit_*` pieces into
  `public/models/props/hollow_crypt_kit.glb` via
  `scripts/assets/hollow_crypt_kit/build.mjs` (meshopt, vertex colors, three
  material slots: lit stone, emissive glow, translucent silk).
- **Performance and fairness.** Every producer is built once per slot and
  attached through the compile gate; particles are one draw, mist puffs one
  instanced draw; density sheds with the effects tier (cosmetic only, never a
  telegraph, a cast bar or a mob).
- **Readability:** arena floors stay dark and flat; the rite glyphs sit on the
  floor ladder's `ground` rung under every telegraph; no floor mark reads as a
  grave ring or the Reap wedge.

## 8. Loot

Item levels follow `primaryStatBudget` in `src/sim/item_budget.ts`:
`round(itemLevel x qualityMult x slotMult x 0.7)`, item level = source level plus
the quality bump (uncommon +1, rare +3, epic +6). Normal source level is the boss
level; heroic epics read source 25 (item level 31). Weapon DPS follows
`weaponDpsBudget` (x1.15 for two-handers). Class archetypes: Heavy (warrior,
paladin, shaman), Agile (rogue, hunter), Caster (mage, priest, warlock, druid).

### 8.1 Normal (one guaranteed piece per boss plus a rare chase row)

| Boss | Item (id) | Slot, type | Quality, ilvl | Stats (budget) | Chance |
|---|---|---|---|---|---|
| Marrow (8) | Quilted Trousers (`quilted_trousers`, shipped) | legs, cloth | uncommon | shipped | 0.25 group |
| | Oiled Leather Boots (`oiled_boots`, shipped) | feet, leather | uncommon | shipped | 0.25 group |
| | Gravedirt Treads (`gravedirt_treads`) | feet, mail, Heavy | uncommon, 9 | str 1, sta 1 (2) | 0.25 group |
| | Bellrope Girdle (`bellrope_girdle`) | waist, cloth, Caster | uncommon, 9 | int 1, spi 1, sta 1 (2) | 0.25 group |
| | Sexton's Spadehaft (`sextons_spadehaft`) | two-hand, Heavy | rare, 11 | str 5, sta 3 (8); 30 to 46, speed 3.3 (11.5 DPS) | 0.10 |
| Rimeweb (9) | Rimesilk Mantle (`rimesilk_mantle`) | shoulder, cloth, Caster | uncommon, 10 | int 2, spi 1, sta 1 (3) | 0.34 group |
| | Bonechill Carapace Vest (`bonechill_carapace_vest`) | chest, mail, Heavy | uncommon, 10 | str 2, sta 2 (4) | 0.33 group |
| | Rimeweb Hunter's Leggings (`rimeweb_hunters_leggings`) | legs, leather, Agile | uncommon, 10 | agi 2, sta 1 (3) | 0.33 group |
| | Rimeweb Fang (`rimeweb_fang`) | dagger, Agile | rare, 12 | agi 4, sta 3 (7); 14 to 21, speed 1.7 (10.3 DPS) | 0.10 |
| Ilvane (9) | Cantor's Cassock (`cantors_cassock`) | chest, cloth, Caster | uncommon, 10 | int 3, spi 1, sta 1 (4) | 0.34 group |
| | Choirward Leggings (`choirward_leggings`) | legs, mail, Heavy | uncommon, 10 | str 2, sta 1 (3) | 0.33 group |
| | Chorister's Gloves (`choristers_gloves`) | gloves, leather, Agile | uncommon, 10 | agi 2, sta 1 (3) | 0.33 group |
| | Cantor's Hymnal (`cantors_hymnal`) | held off-hand, Caster | rare, 12 | int 3, spi 2, sta 2 (5) | 0.10 |
| Morthen (10) | Cryptbone Greaves (`cryptbone_greaves`, shipped) | legs, mail | uncommon | shipped | 0.34 group |
| | Gravecaller's Vestments (`gravecallers_vestments`) | chest, cloth, Caster | uncommon, 11 | int 3, spi 1, sta 1 (4) | 0.33 group |
| | Unquiet Stalker's Hood (`unquiet_stalkers_hood`) | helmet, leather, Agile | uncommon, 11 | agi 3, sta 1 (4) | 0.33 group |
| | Bonus group (shipped, unchanged): Greyjaw Hide Boots 0.25, Gravewoven Bag 0.20, Cryptbone Helm 0.18, Cryptbone Pauldrons 0.18 | | | | |

Caster pieces carry the free stamina baseline of the stamina model on top of their
line (`src/sim/item_budget.ts`, a third of the line budget in parentheses).
Quilted Trousers and Oiled Leather Boots leave Morthen's normal table (they move
to Marrow); shipped pieces keep the item level they shipped at
(`src/sim/item_level.ts`, the rework's preserved source levels). Armor values follow the slot weighting of the shipped mid-tier pieces
(`items.ts` Inventory 2.0 comment) and are set at authoring. Money: each non-final
boss pays a small base (Marrow 800c, Rimeweb 1000c, Ilvane 1000c); Morthen keeps the
finale ladder of `docs/design/dungeon-gold.md` (2500c normal, 100000c heroic).

### 8.2 Heroic (one equipment item per boss, `weightedLootGroup`)

| Boss | Partition (weights) |
|---|---|
| Marrow | Sexton's Burial Spade (`sextons_burial_spade`, new epic two-hand, Heavy, ilvl 31: str 17, sta 12, 50 to 75 at speed 3.4, the five-man heroic weapon rating) 0.30; Cryptplate Helm (shipped, moved from Morthen) 0.30; Quilted Trousers 0.15; Oiled Leather Boots 0.15; Heroic Sexton's Spadehaft (generated) 0.10 |
| Rimeweb | Rimesilk Hood (`rimesilk_hood`, new epic cloth helmet, Caster, ilvl 31: int 11, spi 7, sta 6, the five-man armor rating) 0.35; Bonechill Striders (shipped, moved) 0.25; Bonechill Cord (shipped, moved) 0.25; Heroic Rimeweb Fang (generated) 0.15 |
| Ilvane | Shadowpulse Handwraps (shipped, moved) 0.50; Choirward Leggings 0.35; Heroic Cantor's Hymnal (generated) 0.15. Vigil Taper deferred to the encounter pass (it needs a new trinket effect kind) |
| Morthen | Morthen's Cryptforged Hauberk, Shadowpulse Slippers, Lunarward Cinch, Bastion Sigil 0.18 each; Cryptbone Greaves, Greyjaw Hide Boots, Cryptbone Helm, Cryptbone Pauldrons 0.07 each (the shipped Reliquary page keeps paying on Heroic). Unchanged outside the partition: Gravewoven Bag 0.20, the Stormfeather Griffin reins chance, the heroic farm pattern rows, heroic finale gold, Heroic Marks |

**Vigil Taper (trinket, new effect kind `vigil`).** Spirit 13 (the five-man heroic
trinket budget, as Bastion Sigil's 13 stamina). Use (2 min cooldown): light the
taper; for 12 s, while you stand still you regain 2 percent of your maximum mana
every 2 s (12 percent if you never move); moving snuffs it. No passive. No shipped
trinket restores mana (the 18 in `content/trinkets.ts` cover retaliate, anchor,
hourglass, wellspring, bleed, tally, stormjar, echo, gamble, blink, sprint,
defiance, brand, temper, kindling orb, pierce, lantern and heart nova), and it
rewards the healer who plays Ilvane's pillars well.

### 8.3 Class coverage (normal)

| Archetype | Marrow | Rimeweb | Ilvane | Morthen |
|---|---|---|---|---|
| Heavy | Gravedirt Treads, Spadehaft | Carapace Vest | Choirward Leggings | Cryptbone Greaves |
| Agile | Oiled Leather Boots | Hunter's Leggings, Rimeweb Fang | Chorister's Gloves | Unquiet Stalker's Hood |
| Caster | Quilted Trousers, Bellrope Girdle | Rimesilk Mantle | Cantor's Cassock, Hymnal | Gravecaller's Vestments |

Heroic covers the same three archetypes on every boss (Heavy, Agile and Caster
epics in each partition, the trinket on Ilvane, Bastion Sigil on Morthen).

## 9. Deeds and Reliquary

- **Deeds** (appended at the end of `DEEDS`, `manual` triggers granted by the
  encounter modules, cosmetic only):
  - `dgn_marrow_tidy`: "A Tidy Churchyard": defeat Sexton Marrow with no more than
    four Open Graves at his second Burial Toll.
  - `dgn_rimeweb_rescue`: "Nobody Left Hanging": defeat Rimeweb without any player
    being Drained.
  - `dgn_ilvane_hush`: "Hush Now": defeat Cantor Ilvane without any Dirge of the
    Hollow landing on a player.
  - `dgn_morthen_candles`: "By Candlelight": relight all four Remembrance Candles
    within 20 s of the Rite of the Unquiet.
  - The shipped `dgn_hollow_crypt`, `_heroic`, `dgn_morthen_flawless` and
    `dgn_morthen_trio` stay as they are.
- **Reliquary:** the shipped pages stay (append-only). The rare chase items
  (Sexton's Spadehaft, Rimeweb Fang, Cantor's Hymnal) and the new heroic epics
  (Sexton's Burial Spade, Rimesilk Hood, Vigil Taper) need relic slots, and every
  moved relic needs a per-boss source hint instead of `fromBoss('morthen')`.
  Whether they extend the shipped pages or go on a new appended page is a
  maintainer decision (section 12).

## 10. Naming originality verdicts (searched 2026-09-29)

| Name | Search | Verdict |
|---|---|---|
| Rimeweb (boss, item prefix) | exact token, plus game wikis | Clear: no game use found |
| Ilvane | exact token, plus game wikis | Clear |
| Rimesilk | exact token | Clear |
| Widowsilk | exact token | REJECTED: Path of Exile base type "Widowsilk Robe"; replaced by Rimesilk |
| Choirward | exact token | Clear |
| Candlewright | exact token | Clear |
| Spadehaft, Gravedirt, Bellrope Girdle | exact phrases | Clear |
| Vigil Taper | exact phrase | Clear. "Vigil Candle" avoided: WoW ships several candle trinkets |
| Measured for the Grave | exact phrase | Clear |
| Burial Toll, Dirge of the Hollow | exact phrases | Clear |
| Soul Tithe | exact phrase | REJECTED: WoW warlock conduit and a Magic card; the stack is "Gorged on the Dead" |
| Rite of Unmaking | exact phrase | REJECTED as too close to FFXIV's "The Unmaking" trial; the phase is "Rite of the Unquiet" |
| Hollow Chorister, Hollow Gravedigger, Ossuary Sentinel, Bound Soul, Unmade Sentinel, Cantor's Cassock, Chorister's Gloves, Remembrance Candle, Reap the Unquiet, Grasp of the Grave, Name the Dead, Silk Shroud, Silk Lines, Harmony, Encore, Crescendo, Unbroken Verse, Twin Shroud, Earthbound, Unquiet Earth, Gravecall, the deed names | generic English | Shared vocabulary, no coined token |
| Sexton Marrow, Morthen, Grave Chill, Bonechill, Gravecaller, Restless Bones | shipped | Already in the game |
| Ossuary Drake, Chapel Gargoyle, Ossuary Cutthroat, Gravecaller Adept | exact phrases, plus game wikis | Clear (Wynncraft's "Ossuary Dragonkin" is a different name) |
| Barrowflame Breath (was Bonechill Breath; the owner asked for fire) | exact phrase and the coined token "Barrowflame", plus game wikis (searched 2026-09-30) | Clear: no game use found. "Cryptfire" REJECTED (a Sol's RNG aura name); "Ghostflame" avoided (Elden Ring) |
| Stone Shriek, Murder Call | exact phrases, plus Wowhead | Clear |
| Ossuary Warrior, Gravecaller Necromancer, Bone Minion, Bone Brute, Crow Caller, Carrion Crow, Grave Cleave, Grave Bolt, Raise Bones, Bone Burst, Rending Leap, Tail Lash, Wing Gust | generic English | Shared vocabulary, no coined token. "Wing Buffet" avoided (a signature dragon ability name elsewhere) |

## 11. Optional quest follow-ups (not required)

- Brother Aldric could hand out a short "Lay the Choir to Rest" kill quest for
  Cantor Ilvane and a "Mother of the Bonechill" quest for Rimeweb (zone1 quest
  records, giver `brother_aldric`), so the new bosses carry quest XP like Morthen.

## 12. Implementation checklist (code seams)

Order: Phase 0 engine, then one boss at a time with its tests, then content.

**Engine (README G7 to G9):**
- G9 authored interior: new `src/sim/instances/authored_interior/` (`index.ts`
  barrel plus local `CLAUDE.md`): `AuthoredInteriorDef` data type; height function
  consumed by `world.ts` `groundHeight` (one generic arm keyed by interior); interior
  collider set registered in `colliders.ts`; `DungeonDef.interior` gains
  `'hollow_crypt'` (the Sunken Bastion keeps `'crypt'` untouched). Content:
  `src/sim/content/hollow_crypt_layout.ts` (terraces, walls, props, gates, patrols,
  light zones). Render: `src/render/authored_interior.ts` plus a pure plan core in
  `RENDER_PURE_CORES`, light zones through `interior_light_rig.ts`, prewarm through
  the preparation scheduler. Tests: height continuity on ramps, every spawn and
  gate reachable by `findPath` from the entry, entry clearance
  (`dungeon_entry_clearance` precedent), colliders match render placements.
- G7 gates: `src/sim/instances/dungeon_gates.ts`; `DungeonDef.gates` in `types.ts`;
  per-slot gate ids on the gate-tagged collider grid (`setColliderGateOpen`); open
  rules keyed on `DungeonSpawn.packId` and boss ids; encounter seal while a boss is
  engaged; reset re-closes on instance reset; wire field for `ClientWorld` collision
  mirror (parity pin in `tests/world_api_parity.test.ts` if an `IWorld` member is
  added). Tests: gate closed until its packs die, cannot be pathed through, Twin
  Seals need both wing bosses, seal reopens on wipe, reset re-closes.
- G8 patrols: `src/sim/mob/patrol.ts` sibling routed by the `locomotion.ts`
  dispatcher; `DungeonSpawn.patrol`; zero rng. Test: loop, aggro from patrol, return
  after evade.

**Encounters (one module per boss, `src/sim/encounters/hollow_crypt/`, barrel plus
`CLAUDE.md`, driven through the SimContext seam, never inside `sim.ts` or
`locomotion.ts`):**
- G1 instance cues (generalize `hoardBossCue` so non-rift claims can emit
  sweep/mark cues; the renderer's floor-telegraph painter reused).
- `marrow.ts`: G4 marked persistent hazard (graves), Burial Toll thresholds
  spawning `restless_bones` at grave points, heroic Gravedigger's Blow plus
  Earthbound, Unquiet Earth.
- `rimeweb.ts`: cocoon objects (port of `hoard_cocoon`), silk lines (port of
  `hoard_silk_snare`), Brood Call, heroic Twin Shroud and egg-sac hatch on line
  contact (`broodEgg`).
- `ilvane.ts`: G6 LOS-gated interruptible nova (register the cast id in
  `SCRIPTED_INTERRUPTIBLE_CHANNELS` or as an ability), Harmony damage reduction per
  living Chorister, Crescendo, heroic Encore and Unbroken Verse.
- `morthen.ts`: G2 phase driver, G5 walker souls and Gorged on the Dead stacks, G3
  candle interactables (per-claim state, channel broken by enemy damage only),
  Rite Broken stun and vulnerability, Reap the Unquiet via `breathCone`, heroic Name
  the Dead and Grasp of the Grave.
- Every mechanic: rng only through `ctx.rng` in fixed draw order, entity-id
  ordering for area membership, reset on evade and wipe (`encounters/encounter_wipe.ts`
  precedent), mechanic spacing lock stamped on the four bosses.
- Tests per boss: `tests/hollow_crypt_<boss>.test.ts` (normal kit, heroic extras
  only on heroic claims, reset on wipe, deed grant conditions), plus
  `tests/architecture.test.ts` and `tests/localization_fixes.test.ts` green.

**Content data:**
- `src/sim/content/dungeons.ts`: new mob templates (`rimeweb`, `rimeweb_hatchling`,
  `rimeweb_spinner`, `cantor_ilvane`, `hollow_chorister`, `hollow_gravedigger`,
  `ossuary_sentinel`, `candlewright_acolyte`, `bound_soul`, `unmade_sentinel`),
  rewritten `CRYPT_SPAWN_LIST` with `packId` and `patrol` per placement,
  `DUNGEON_DEFS.hollow_crypt` with `interior: 'hollow_crypt'`, `gates`,
  `bossChainPull: true`. Camps untouched (instance spawns are not overworld camps).
- `dungeon_difficulty.ts`: a `NORMAL_DUNGEON_TUNING` row for `hollow_crypt` with
  `healthMultiplierByMob` from the measured party DPS; heroic row keeps level 22
  and gains per-mob overrides where the heroic floors test needs them
  (`tests/heroic_difficulty_floors.test.ts`).
- Loot: per-boss `loot[]` in `dungeons.ts`; `HEROIC_BOSS_LOOT` rows for
  `sexton_marrow`, `rimeweb`, `cantor_ilvane`, `morthen`; new items in `items.ts`
  (normal) and `heroic_loot.ts` (`sextons_burial_spade`, `rimesilk_hood`);
  `vigil_taper` in `content/trinkets.ts` plus the `vigil` kind in
  `src/sim/combat/trinkets.ts`. Check that no generated `heroic_<id>` variant
  disappears when a base item leaves a table (`tests/shipped_item_ids.test.ts`
  re-mint, additions only). Update `tests/heroic_loot_budget.test.ts`,
  `tests/heroic_finale_gold.test.ts`, `tests/item_level.test.ts`.
- Finder: `HOLLOW_CRYPT_ENCOUNTERS` lists the four bosses with mechanic ids, plus a
  separate heroic array with the heroic extras (`dungeon_finder.ts`), with the
  finder mechanic labels in the i18n catalog.
- Deeds, Reliquary, wiki, i18n, item art: README section 8, applied to every name
  in section 10 and every item in section 8.
- Parity: re-record `heroic_five_man_clear` and any scenario that walks the crypt
  (`tests/parity/scenarios.ts`) with `UPDATE_PARITY=1`, reviewing the diff.
- Reviewers to dispatch at the end: `architecture-reviewer`,
  `content-obligations-reviewer`, `cross-platform-sync` (gates on the wire),
  `render-performance-reviewer` (kit, lights), `test-coverage-auditor`, then `/qa`.

## 13. Decisions for the owner and maintainer

1. Approve four bosses (Marrow, Rimeweb, Ilvane, Morthen) for a level 7 to 10
   dungeon, or cut to three (drop Rimeweb or merge the wings).
2. Approve the names in section 10 (Rimeweb, Cantor Ilvane, Candlewright, Vigil
   Taper, the item names).
3. Heroic loot volume: four equipment items per heroic clear instead of one (the
   per-boss cadence of `instance-loot-budgets.md`), and moving four shipped heroic
   epics from Morthen to the new bosses.
4. Reliquary: extend the shipped Hollow Crypt pages or append new pages.
5. Build order: engine Phase 0 (authored interior, gates, patrols) before any boss,
   accepting 3 to 4 weeks before the new dungeon is playable in graybox.
6. Optional: the two Brother Aldric follow-up quests (section 11).
