# Dungeon finale gold

The money a dungeon's final boss drops, on both difficulties. This is the
design anchor for the values authored on the finale money entries (the
`LootEntry.heroicCopper` bases live in `src/sim/content/dungeon_difficulty.ts`
as `HEROIC_FINALE_COPPER` and `NYTHRAXIS_HEROIC_COPPER`); the whole ladder is
pinned by `tests/heroic_finale_gold.test.ts`.

## The two rules

1. **Normal mode is the anti-farm line.** Normal instances have no lockout
   and most finales can be skip-pulled, so a finale's normal-mode payout is
   priced to make repeat pops not worth the clear time: roughly 1g to 2g at
   the endgame five-mans, less below. History: Korzul (Gravewyrm Sanctum)
   shipped at a 50000c base (3g to 7g rolled) and Zulgar (Wildheart Basin)
   at 55000c, an order of magnitude over their sibling bosses, and both
   became the game's dominant repeat gold farms (the zero-downtime
   instance-reset exploit itself was closed separately, issue #1600). Both
   now sit at 15000c.
2. **Heroic rewards the legitimate clear.** Every heroic dungeon has a
   per-dungeon daily lockout (`awardHeroicMarks` in
   `src/sim/instances/dungeons.ts` stamps it on the whole claim), so the
   heroic finale pays a raised base through `LootEntry.heroicCopper`:
   five-mans 100000c (10g nominal), the Nythraxis raid 200000c (20g). The
   loot roller substitutes the heroic base for the normal one on the same
   single rng draw when the kill carries a live heroic claim.

## The ladder

All money rolls the roller's 0.6x to 1.4x band around the base.

| Dungeon | Finale | Normal base | Heroic base |
|---|---|---|---|
| Hollow Crypt | Morthen | 2500c | 100000c |
| Sunken Bastion | Vael the Mistcaller | 5000c | 100000c |
| Drowned Temple | Ysolei | 6000c | 100000c |
| Gravewyrm Sanctum | Korzul the Gravewyrm | 15000c | 100000c |
| Wildheart Basin | Zulgar, Voice of the Basin | 15000c | 100000c |
| Nythraxis raid | Nythraxis, Scourge of Thornpeak | 150000c | 200000c |
| Ignivar raid (dev tier), Inner Crucible | Varkhul, Forgefather of the Last Flame | 150000c | 200000c |
| Ignivar raid (dev tier), arena | Ignivar, Herald of the Last Flame | 150000c | 200000c |

The heroic base is deliberately flat across the five-mans (they all tune to
level 22; the clear effort is comparable) rather than a multiple of the
normal base (which is priced by farmability, not effort).

## The daily ceiling

The lockout is per dungeon, so a group clearing every heroic each day mints
5 x 100000c + 200000c = 700000c nominal (70g), rolling 42g to 98g, split by
the party's currency strategy (default looter-takes-all; fair-split shares
it evenly). That is the intended faucet: bounded, group-wide, and earned
through the hardest content, versus the old unbounded normal-mode finale
farming this ladder replaced.

## Changing a value

Edit the content entry (and the shared heroic base constants where they
apply), update the pinned ladder in `tests/heroic_finale_gold.test.ts` and
the boss-specific suites (`tests/gravewyrm_boss_gold.test.ts`,
`tests/wildheart.test.ts`), and update this table in the same change. A new
heroic dungeon's finale takes a `heroicCopper` on its single money entry, a
row in the test ladder, and a row here.
