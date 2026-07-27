# Procedural loot content

This directory is data-only and simulation-pure.

- Stable base, affix, pool, rarity, and name IDs are persisted identifiers.
- Never rename or reuse a shipped ID. Add an alias or migration instead.
- Content may import simulation types and pure constants only.
- Do not import UI, render, network, server, DOM, wall-clock, or random APIs.
- Every numeric roll is final when generated and remains unchanged by later
  table tuning.
- Every authored record must pass `validateProceduralLootContent`.
- Visual keys identify reusable base art. They never contain an item UID, seed,
  generated name, affix, or roll.
- English strings in this directory are source catalog strings. Persisted item
  instances store stable token IDs, not composed English names or prose.
