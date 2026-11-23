# Loot quality

`types.ts` owns the bounded permanent descriptor. `core.ts` is data-import-free
budget and allocation math; `index.ts` resolves static source levels and Rift shells.
Ordinary copies omit the descriptor. Only reward producers may roll it, once, where a
copy first enters the world: enemies through `loot/enemy_quality.ts`, every other
earned source (crafts, quest rewards, caches, chests, the hoard parcel) through
`loot/fresh_quality_grant.ts`. Vendors and transfers never roll.
Never bake these bonuses into `rolled.stats`, which owns enchants and Rift gems.
Random allocation covers only the final two item levels. Earlier levels scale
proportionally, while weapon, armor and throughput lanes remain separate.
`rift.ts` resolves an upgrade-monotone primary path from permanent weights.
