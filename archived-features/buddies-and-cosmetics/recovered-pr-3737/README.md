# Recovered original buddy PR history

Original implementation by [PoorInfz](https://github.com/PoorInfz), from
[PR #3737](https://github.com/levy-street/world-of-claudecraft/pull/3737).

GitHub records the last buddy-feature tip before the September 17 force push as
`f96cd0b19c7e3aff7fc0deb853e612746a706c7e`. This branch preserves that exact tip
and every ancestor, including the earlier pre-force tips `9570c0653b` and
`ba52de2c47`. Original commit authorship is unchanged.

The recovered late commits introduce a fifth Buddy bag socket with inventory
capacity based on whistle quality, item-based summon controls, and The Mummy.
The active account collection and Cosmetics-only equip design supersedes those
mechanics. The active roster remains Tug, Crystal Lich, and Forgemaw.

- `the_mummy.glb` is the exact original model. It is archived, not shipped.
- `f96cd0b19c.patch.txt` preserves the Buddy bag, Mummy definitions, render mapping,
  UI, network, persistence, and tests. Binary content is omitted from this text
  patch; the model is supplied separately. No Mummy icon existed in the original.
- `9279c64283.patch.txt` preserves the preceding merge repair and Phoenix art
  tooling context. Do not apply either patch blindly to the current codebase.

Mummy source facts: epic buddy, undead family, 0.85 model height, BUDDY_CLIPS,
original baked texture without tint, and no acquisition source. Use the preserved
commit as the source of truth when restoring this content.

Original Mummy SHA-256: `e6488d2a5f6c818367d91259511220215540cd959d60e8f75d8eff585589d358`.
