# SwordMaster class design

SwordMaster is the tenth playable class. It is a fast melee damage class built around
two one-handed swords, short recovery windows, mobility, and broad weapon arcs. Its
identity is deliberate speed, not reckless rage: the player reads enemy spacing,
repositions quickly, and turns a precise two-blade cadence into area pressure.

## Class contract

| Property | Value |
|---|---|
| Class id | `swordmaster` |
| Display name | SwordMaster |
| Roles | Melee damage |
| Resource | 100 Energy |
| Armor | Leather |
| Weapons | Two one-handed weapons, with a sword in each hand at character creation |
| Restrictions | No shield and no two-handed weapon |
| Attack power | Strength plus Agility |
| Global cooldown | 1.0 sec |
| Base movement | 8% faster than the standard player speed |
| Class color | Azure cyan `#22d3ee` |

Dual wield is permanent class identity. Main-hand and off-hand attacks resolve in a
stable order, and capped area targeting sorts by distance and entity id before any hit
draws from the simulation RNG. Equipment validation applies at the shared rules seam,
so offline, online, headless, and reconnect flows enforce the same restrictions.

## Gameplay pillars

1. Twin blades: core attacks use both equipped one-handed weapons. The main hand lands
   first and the off hand follows with its own weapon profile.
2. Area pressure: Crescent Sweep, Blade Dance, and Blade Cyclone reward controlling the
   distance and facing between several enemies.
3. Tempo: a 1 sec global cooldown, Energy, Quickening, and Duelist Flurry make the class
   feel responsive without bypassing server authority.
4. Mobility: an 8% baseline movement bonus, Fleet Step, Wind Lunge, and Azure Rush let
   the player reposition instead of absorbing every hit.
5. Azure steel: Sword Aura and the Azure Blade specialization give the class a clear
   blue weapon-energy silhouette that remains legible in group combat.

## Level 1 to 20 progression

| Level | Ability | Purpose |
|---:|---|---|
| 1 | Twin Slash | A 30 Energy single-target strike with both weapons. |
| 1 | Crescent Sweep | A 35 Energy frontal sweep against up to 5 enemies within 6 yd. |
| 3 | Fleet Step | A 5 sec, 30% movement burst on a 20 sec cooldown. |
| 5 | Sword Aura | A 2 sec focus that grants 12 Strength and 12 Agility for 5 min. |
| 7 | Wind Lunge | Break roots and move 8 yd forward, off the global cooldown. |
| 9 | Parrying Flow | Gain 20% dodge for 8 sec. |
| 11 | Quickening | Gain 25% melee haste for 12 sec. |
| 14 | Blade Dance | Strike up to 6 nearby enemies with both weapons. |
| 17 | Twin Finisher | Commit both weapons to a heavy two-part finishing strike. |
| 20 | Final talent row | Choose area mastery, paired burst, or unrestricted motion. |

The three specialization signatures are learned through the selected specialization
from level 5:

- Tempest grants Blade Cyclone.
- Duelist grants Duelist Flurry.
- Azure Blade grants Azure Rush.

## Sword Aura

Sword Aura is the class-defining preparation window.

- Cast time: 2 sec.
- Energy cost: 20.
- Cooldown: 120 sec.
- Buff duration: 300 sec.
- Effect: 12 Strength and 12 Agility.
- Presentation: blue energy gathers during the cast, both blades become strongly
  illuminated on activation, and a restrained azure glow remains on both weapons for
  the full buff duration.

The statistic bonus uses the single `buff_str_agi` aura kind. It adds no persisted field
and requires no database migration. Like ordinary combat buffs, Sword Aura is session
state and expires on logout; snapshots still carry it through the existing aura wire shape.

## Specializations

### Tempest

Tempest is the area specialist. Blade Cyclone strikes up to 8 targets within 9 yd with
both weapons. Gathering Storm increases physical ability damage, supporting Crescent
Sweep and Blade Dance without replacing their positioning requirements.

### Duelist

Duelist is the single-target cadence specialist. Duelist Flurry grants 35% attack speed
for 12 sec. Measured Tempo adds melee haste and critical strike chance, rewarding steady
Energy use and precise two-blade attacks.

### Azure Blade

Azure Blade is the mobility and control specialist. Azure Rush breaks roots, moves 12 yd
forward, and slows nearby enemies by 50% for 3 sec. Azure Current improves Agility and
dodge so aggressive repositioning remains the center of the spec.

## Talent rows

Every row is class-wide and contains three mutually exclusive choices.

| Level | Theme | Choices |
|---:|---|---|
| 5 | Mobility | Gale Footwork, Slipstream, Long Stride |
| 8 | Edge | Keen Twins, Wide Crescent, Flowing Edge |
| 11 | Tempo | Relentless Rhythm, Efficient Dance, Inner Current |
| 14 | Flow | Parrying Current, Quicksilver, Azure Tempering |
| 17 | Discipline | Cyclone Edge, Duelist Tempo, Azure Momentum |
| 20 | Mastery | Storm of Steel, Perfect Pair, Unbound Motion |

The rows offer movement, area damage, single-target cadence, defense, and class aura
enhancement without creating a second point-tree system. Allocation, respec, build
strings, loadouts, server validation, and persistence reuse Talents V2 unchanged.

## Presentation contract

- Body rig: the agile rogue rig with a class-specific azure tint.
- Equipment: two visible sword attachments in combat and independent back grips when
  weapons are stowed.
- Animation: dual-wield locomotion and attacks, with spin or flourish clips for the area
  abilities and specialization activations.
- Ability effects: thin procedural cyan blade arcs, a broader cyclone ring for area
  attacks, and an azure flash for Azure Rush movement.
- Icons: twelve authored 128px WebP ability icons plus three authored specialization
  crests, all derived from one project-owned azure atlas.
- Sound: fast attacks use the existing light blade swing family. Impacts continue to use
  the target material cue and Sword Aura uses the shared buff activation cue.

## Balance and validation anchors

SwordMaster trades armor and healing for mobility and sustained area access. Its base
movement bonus is always active, but its strongest movement and haste effects remain
cooldown-bound. Area abilities have explicit radii and target caps, while paired hits
retain independent hit results and deterministic RNG order.

Acceptance coverage must prove:

- creation starts with two actual one-handed swords;
- shields and two-handed weapons are rejected at every equipment boundary;
- both weapons contribute to paired attacks in main-hand then off-hand order;
- area target selection and results are deterministic;
- Sword Aura takes 2 sec to activate and applies both statistics for 300 sec;
- all three specs and all six talent rows are reachable and server-valid;
- save/load, headless, client/server snapshots, and parity traces accept `swordmaster`;
- desktop and mobile selectors expose the tenth class without clipping;
- both blades, Sword Aura, and area effects are visible in a running game.
