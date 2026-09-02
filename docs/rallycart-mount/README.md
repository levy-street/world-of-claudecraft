# Rallycart RXT: the whole handoff, in one folder

Everything needed to pick up the Rallycart RXT mount cold. Written 2026-08-16.

## Read in this order

1. **`HANDOFF.md`** is the authoritative document. Twelve sections: workflow
   rules, where the work is, tooling, the rig contract, what was borrowed, how
   the rider is affixed, the systems built, what a model re-rip costs, seven
   traps, what is not done, and the verification commands.
2. **`WIRING_AND_AUDIO.md`** is the detail underneath it: the wiring table, the
   tuned numbers, the audio design. Still current.
3. **`tooling/`** holds the two avian handoffs, copied in from
   `/home/jbibbs/` because they live outside the repo and would not survive a
   clone. Read them for the Tripo to Blender to glTF pipeline and for the
   environment traps.
4. **`reference/`** holds the borrowed code from the other mounts. See below.

## Two things to know before you touch anything

- **The work is committed** as `2c0f0e1cb5` on `feature/rallycart-mount`, one commit
  on top of `feature/goblin-rocket-sled`. It has NOT been pushed, so it still
  lives only in this worktree's `.git`. Push it before trusting it.
- **The gate has never run on this branch.** `node scripts/gate_select.mjs` has
  not been executed here. Do not describe the change as gated.

## Why `reference/` exists

The Rallycart borrows from five other mounts, and **not one of them is merged.**
Each lives on its own feature branch. A reader following a reference would
otherwise have to check out four more branches to see what the text is talking
about.

So the borrowed code is copied into `reference/<mount>/`, at its original
repo-relative path, with the exact source commit recorded in
`reference/PROVENANCE.txt`. Each mount folder also carries a
`WIRING_EXCERPTS.md`: that branch's records grepped out of every shared
registry a mount must be registered in, since copying a 3200 line manifest per
mount would bury the three lines that matter.

`reference/` ignores itself. It contains a `.gitignore` holding `*`, so none of
the copied code can be committed into this branch by accident, and biome skips
it because `biome.json` sets `vcs.useIgnoreFile`. It is also outside the
`tsconfig.json` include list, so `tsc` will not type check it.

Rebuild it any time one of the source branches moves:

```bash
bash docs/rallycart-mount/refresh_reference.sh
```

## The map

```
docs/rallycart-mount/
  README.md                  this file
  HANDOFF.md                 the authoritative pickup document
  WIRING_AND_AUDIO.md        wiring table, tuned numbers, audio design
  refresh_reference.sh       rebuilds reference/ from the mount branches
  tooling/
    avian-mount-handoff.md           the pipeline, in full
    avian-mount-handoff-session2.md  the environment traps
  reference/                 generated, self ignoring
    PROVENANCE.txt                   which commit each copy came from
    terrorspark-groundshaker-tank/   feature/tank-mount-sfx
    goblin-rocket-sled/              feature/goblin-rocket-sled (this branch's base)
    viridian-valestrider-avian/      feature/avian-mount
    rickshaw/                        feature/rickshaw-mount
    wooden-toy-train/                feature/wooden-toy-train
```

Not copied here: the Blender source of truth, which stays at `E:\rallycart_work\`
on the Windows side, and the original mesh `E:\Rallycart+RXT.glb`. Never modify
the original.
