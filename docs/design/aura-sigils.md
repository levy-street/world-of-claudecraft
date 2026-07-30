# Aura sigils

A world-space marker for the persistent, mutually-exclusive self-buffs the sim
already models: paladin auras, warrior stances, warrior shouts, hunter aspects.

Today those buffs are legible only as an icon in the buff bar. Two paladins side
by side look identical whether one is running Steadfast Aura and the other
Requital Aura, or neither is running anything. The sigil puts that state on the
character, where the rest of the party can read it at a glance — the same job the
rotating rune circle does in the ARPGs this convention comes from.

## What it is

A ground rune disc plus two flanking crescents, drawn under the character running
the buff. The disc turns slowly, the crescents counter-turn, and the whole thing
breathes at about 1.6 rad/s. It fades in over 0.3s and out over 0.24s, so
swapping auras reads as a change rather than a pop.

## What it is not

It is not a sim change. There is no new aura kind, no new ability, no wire field,
no `IWorld` member, and no balance implication. `ALL_DELTA_KEYS` is untouched and
the parity goldens are unchanged. Turning the feature off draws nothing and
changes no behaviour.

## How the state is derived

`auraSigilStateForAuras(entityId, auras, out?)` in `src/render/aura_sigil_visual.ts`
scans the entity's mirrored aura list and returns the first aura that is both

1. in `SIGIL_AURA_IDS`, and
2. sourced by that same entity (`aura.sourceId === entityId`).

Rule 2 is the one worth calling out. Steadfast Aura and Iron Bellow are `party:
true` buffs — every party member carries the aura object. Without the source
check, a five-person group would sprout five identical rings for one paladin's
aura. The ring marks the caster; the beneficiaries just get the stat.

`out` is a caller-owned scratch object. The renderer passes a per-instance one so
a steady frame allocates nothing, matching the pattern `auras_view.ts` and
`mage_barrier_visual.ts` already use.

## Colour

The palette is keyed on the aura's own `school`, not on its id:

| school | used by |
|---|---|
| `holy` | Steadfast Aura, Requital Aura |
| `physical` | Battle / Guarded / Berserker Stance, Iron Bellow |
| `nature` | Harrier's, Marten's, Courser's Guise |

Fire, frost, arcane and shadow palettes are defined and unused, so an aura added
to any existing exclusive group is coloured correctly without editing this file.

## Keeping the id set honest

`src/render` may not value-import from `src/sim` (`tests/architecture.test.ts`),
so `SIGIL_AURA_IDS` is a literal set rather than a lookup over `CLASSES`.

To stop that literal from drifting, `tests/aura_sigil.test.ts` parses
`src/sim/content/classes.ts`, collects every ability carrying an
`exclusiveGroup`, and asserts set equality with `SIGIL_AURA_IDS`. Adding a fourth
warrior stance or a third paladin aura fails that test until the renderer knows
about it.

## Settings

Three entries, all presentation-only:

| key | type | default |
|---|---|---|
| `showAuraSigils` | bool | on |
| `auraSigilOpacity` | 0 – 1 | 0.65 |
| `auraSigilScale` | 0.5 – 1.5 | 1 |

The default opacity is below full deliberately: a raid stacked with paladins and
warriors should not wash out the floor. All three apply live from the options
window; `main.ts` pushes them onto the renderer the same way the nameplate flags
already do.

## Cost

One `THREE.Group` per character actively running one of the nine buffs, built
lazily on first use and disposed when the aura drops or the entity leaves.
Geometry (`RingGeometry` ×2, a `TorusGeometry` arc) is module-level and shared
across every sigil in the scene; only the three materials are per-instance.
Characters with no such buff allocate nothing at all.
