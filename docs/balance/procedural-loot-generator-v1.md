# Procedural Loot Generator v1 Baseline

Date: 2026-07-24

Branch: `feature/procedural-loot`

Generator payload version: 1

World seed: `13371337`

## Reproduce

```powershell
npx tsx scripts/procedural_loot_simulate.ts `
  --pool initial_world `
  --table initial_world `
  --level 18 `
  --count 100000 `
  --seed 13371337

npx tsx scripts/procedural_loot_simulate.ts `
  --pool initial_rare `
  --table initial_rare `
  --level 18 `
  --count 100000 `
  --seed 13371337

npx tsx scripts/procedural_loot_simulate.ts `
  --pool initial_dungeon_boss `
  --table initial_dungeon_boss `
  --level 20 `
  --count 100000 `
  --seed 13371337
```

The runner emits versioned JSON to standard output. Repeating a command with
identical options produces byte-equivalent report data.

## Rarity results

| Source | Common | Magic | Rare | Epic | Legendary |
| --- | ---: | ---: | ---: | ---: | ---: |
| Initial world | 69.976% | 24.498% | 5.020% | 0.485% | 0.021% |
| Initial rare | 0% | 60.108% | 35.921% | 3.757% | 0.214% |
| Initial dungeon boss | 0% | 24.908% | 60.991% | 13.069% | 1.032% |

All three 100,000-roll runs had:

- zero duplicate UIDs
- zero duplicate affix families
- zero final values outside persisted ranges
- 1,267 Legendary instances generated through normal source tables

Legendary probability is live only after the generic equipment-effect runtime
passed the independent 32-million-event contribution campaign with fingerprint
`bde27c6a`. The rates remain conservative: 0.02% in the world, 0.2% from rare
sources, and 1% from dungeon bosses.

## Density and budget results

| Source | Total affix slots | Average affix budget | Average item affix budget | Maximum item affix budget |
| --- | ---: | ---: | ---: | ---: |
| Initial world | 54,513 | 3.854261 | 2.101073 | 36.32 |
| Initial rare | 224,929 | 4.046679 | 9.102156 | 39.4 |
| Initial dungeon boss | 302,039 | 4.395651 | 13.276581 | 41.29 |

### Initial world affix counts

| Affixes | Items |
| ---: | ---: |
| 0 | 69,976 |
| 1 | 13,474 |
| 2 | 11,024 |
| 3 | 3,337 |
| 4 | 1,965 |
| 5 | 224 |

### Initial rare affix counts

| Affixes | Items |
| ---: | ---: |
| 1 | 33,178 |
| 2 | 26,930 |
| 3 | 23,364 |
| 4 | 14,841 |
| 5 | 1,687 |

### Initial dungeon-boss affix counts

| Affixes | Items |
| ---: | ---: |
| 1 | 13,853 |
| 2 | 11,055 |
| 3 | 40,203 |
| 4 | 28,978 |
| 5 | 5,911 |

The 5-affix rows come only from Epic items. Legendary items remain in their
3-to-4 band. Common, Magic, and Rare remain inside their intended 0, 1-to-2,
and 3-to-4 bands.

## Base distribution

Unbiased source pools were even within sampling noise:

- Initial world four-base range: 24.734% to 25.133%
- Initial rare four-base range: 24.864% to 25.210%
- Initial dungeon six-base range: 16.456% to 16.792%

The automated smart-loot matrix separately simulates 10,000 drops for each of
the nine classes. It requires a majority of usable items while retaining a
material off-class share for group and trade interest.

## Interpretation

The generated rarity frequencies match the authored source tables to within
the deterministic test envelopes. Family exclusion and UID invariants held
across 300,000 reported items.

These measurements validate generation and distribution only. They do not yet
prove combat balance. Final budget costs remain provisional until the resolved
stat path, representative class builds, time-to-kill, healing, resource, PvP,
and legendary contribution simulations are wired and reviewed.

## Automated evidence

`tests/procedural_loot_distribution.test.ts` currently runs:

- a 50,000-drop rarity envelope
- nine 10,000-drop class smart-loot samples
- a repeated 5,000-drop reproduction check
- a pinned 10,000-drop digest

That suite covers 155,000 generated drops per run. The generator invariant
suite separately checks 1,152 exact base, rarity, and seed scenarios.
