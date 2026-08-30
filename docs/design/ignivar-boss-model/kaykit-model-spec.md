# Ignivar KayKit model specification

## Approved visual contract

Ignivar must read as a native member of the same low-poly character family as
the game's KayKit players, enlarged to raid-boss scale. Preserve exactly three
crown prongs, one chest furnace, a square forge gauntlet on his right arm, a
molten-stone left arm, and two compact shoulder vents. Use connected, faceted
forms and a restrained charcoal, bronze, and orange palette. Avoid HIFI anatomy,
micro-detail, floating armor, and toy studs.

The approved reconstruction input is `ignivar-kaykit-input-v2.png`. It was
generated from the earlier Ignivar identity reference and an in-game screenshot
with the following production prompt:

```text
Redesign Ignivar into a much simpler native KayKit-style 3D game boss. Match the
in-game player's chunky head-to-body ratio, simple silhouette, flat faceted
surfaces, oversized hands and boots, and low-poly production style. Keep exactly
three crown prongs, one bold chest furnace, one oversized square forge gauntlet,
one chunky molten-stone arm, two short shoulder vents, and the charcoal/bronze/
orange palette. Use large connected forms, 3,000-5,000-triangle visual
complexity, no small engravings or realistic anatomy, a simple angular stone
mask with glowing slit eyes, an integrated crown/helmet, integrated vents and
breastplate furnace, and animation-friendly humanoid limbs. Front orthographic
neutral A-pose, even studio light, no cape, weapon, text, UI, or environment.
Avoid PBR micro-detail, ornate MMORPG armor, LEGO studs, floating pieces, pasted
boxes, long limbs, tiny hands, smoke, dramatic posing, and perspective distortion.
```

## Animation contract

- `ForgeIdle`: planted stance derived from one stable KayKit pose.
- `ForgeCast`: the same planted full-body pose; only the chest pitches subtly as
  the furnace VFX charges. Hands, wrists, and arms remain fixed.
- `ForgeSlam`: the proven one-arm KayKit punch drives the right forge gauntlet;
  the left magma arm is pinned and never competes for the read.

The shipping mesh uses the exact KayKit `Rig_Medium` skeleton and native movement,
hit, death, and locomotion clips. Custom boss clips are authored locally and do
not use a generic remote spellcasting animation.
