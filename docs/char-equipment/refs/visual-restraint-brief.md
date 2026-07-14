# Visual restraint pass (user compared side-by-side and confirmed: make it look like the reference)

The orbit LAYOUT is right; the FINISH is wrong. The user's diff list (confirmed): too much gold/glow,
arch too light/narrow, slots crammed/overlapping the arch, top row overloaded, background flat black,
loadout row too bright. Fix each precisely. "Right skeleton, wrong finish - color temperature,
restraint, and spacing."

## 1. SLOT FRAMES: mute them (highest impact)
- DEFAULT (empty or equipped, unselected): dark GUNMETAL/STONE frame - a dark desaturated bevel
  (near-black steel/stone tones), with only SUBTLE gold CORNER ACCENTS (small gold corner ticks, not
  a full gold border). NO outer glow. Empty glyphs: muted, embossed, dark grey-gold (low contrast,
  recessed feel) - not bright gold.
- EQUIPPED (unselected): item icon visible, rarity conveyed by a THIN inner border only - NOT a
  saturated full-cell fill/halo. The purple/green/red must stop dominating; the reference's equipped
  slots stay dark with the icon readable.
- SELECTED/HIGHLIGHTED only (e.g. hover/focus/drag-target, or the reference's Chest/Main Hand): a
  restrained warm gold border + soft glow. This is the ONLY place glow appears.
- Keep the beveled/rivet construction but darken it: the metal reads dark iron with gold trim, not
  solid bright gold.

## 2. ARCH: dark weathered grey-blue stone, wider
- Recolor the arch stone from light beige/tan to DARK weathered GREY-BLUE (cool, desaturated,
  low-contrast against the navy background - it should blend/recede, not pop).
- Make the arch WIDER (a wider, rounder opening like the reference; less tall-and-narrow ladder).
- Soften the block segmentation: subtle mortar lines, not high-contrast dominoes.
- Interior: keep/strengthen the cool blue-navy atmospheric depth behind the character.

## 3. BACKGROUND: deep navy gradient atmosphere
- The whole stage (and window body behind panels) gets the deep NAVY-BLUE gradient (dark navy,
  subtly lighter behind the character, vignetted edges) - kill the flat black so the dark arch and
  dark slots sit IN atmosphere.

## 4. SPACING: slots OFF the arch, bigger, even
- Slots must sit clearly OUTSIDE the arch with generous breathing room (no overlap with the arch
  edge). Increase slot size somewhat (reference slots are larger) and keep the even half-sine arc.
  Widen the stage padding as needed; nothing clips 1280-1920.

## 5. TOP ROW: calm it down
- Reference has ONE centered bag slot up top. We have 4 real sockets (honest data - keep all 4
  functional) but present them CALMLY: a compact centered row of 4 SMALLER muted sockets above the
  arch (styled like the muted slot frames, no glow), clearly separated from helmet (upper-left) and
  main hand (upper-right), which sit lower per the arc, flanking the arch - NOT one crowded strip.

## 6. LOADOUT 1-4: muted
- Below the pedestal, INSIDE the stage bottom like the reference, but muted: dark frames, gold text,
  only the ACTIVE one gets the gold border emphasis (no bright yellow blocks).

## Constraints (unchanged)
- Honest data (real 11 slots + 4 sockets; no fake off-hand/trinket). Pure client. No new assets.
- ids preserved (#char-model-preview, #char-skin-row); drag-rotate + all unequip flows intact
  (sacred assertions never deleted).
- Tokens only (adjust/add dark-iron / stone-blue / navy tokens under existing groups); clamp() for
  sizes; ten-dash banners; no raw hex/px/color in TS; no em/en dashes/emojis.
- Desktop rules stay body:not(.mobile-touch)-scoped; do not regress the new mobile layout.
- All existing tests stay green (selector updates only); css_corpus registration for new banners.
- Iterate by screenshot vs the reference until the side-by-side reads the same: muted dark slots
  with subtle gold, dark grey-blue arch in navy atmosphere, even spacious orbit, calm top row,
  quiet loadout row.
