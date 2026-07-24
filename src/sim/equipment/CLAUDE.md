# Equipment resolution

This directory owns pure conversion from item definitions and exact item
instances into gameplay-ready equipment values and powers.

- `resolved_item.ts` is the single stat and weapon merge path.
- Definition, legacy rolled, procedural, and later enchant sources are merged
  here, never ad hoc in consumers.
- Keep modules simulation-pure and deterministic.
- Do not import UI, render, network, server, DOM, wall-clock, or random APIs.
- Never mutate definitions or payloads.
- All new consumers must receive the exact `ItemInstancePayload` for the item
  they present or equip.
- Stable persisted affix and power identifiers are append-only.
