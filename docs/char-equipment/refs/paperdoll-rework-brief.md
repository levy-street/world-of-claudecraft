# Paperdoll rework brief (user said: "nail this part especially. now the equipment is badly shaped")

The user gave a CLOSE-UP of the mockup's paperdoll. This is the centerpiece and must look almost 1:1.
Current problem: our slot cells are dark squares with THIN BRIGHT-YELLOW L-corner brackets (reads
cheap/unfinished), the arch is a thin gold OUTLINE, and the pedestal is a small flat disc. The
mockup has substantial FRAMED metal slot cells, a carved STONE dungeon arch, and a chunky STONE
pedestal. Fix all three.

## 1. SLOT CELLS (the "badly shaped equipment" - TOP priority)
Each equip slot + bag socket cell must be an ORNATE BEVELED METAL FRAME, not thin corner brackets:
- Shape: rounded-corner square, generous size, all cells equal.
- Border/frame: a GOLD-BROWN METALLIC bevel ~4-6px, embossed 3D look - lighter warm gold on the
  top/left edge, darker brown on the bottom/right edge (use a border-image gradient or layered
  box-shadows / linear-gradient border to fake the bevel). It reads like a cast-metal picture frame.
- Corner RIVETS: a small round gold stud at each of the 4 corners of the frame (small radial-gradient
  dots, or ::before/::after + box-shadow). Subtle but present.
- Interior: a DARK charcoal/black INSET (recessed) with a soft inner shadow (inset box-shadow) so the
  glyph/item sits in a recessed well.
- EMPTY state: a clean, centered, GOLD/TAN slot-type SILHOUETTE glyph (helm, pendant-on-chain,
  pauldrons, breastplate, gauntlet, sword, belt, legs, boots, ring; pouch for bag socket). Larger and
  clearer than now; warm gold/tan color, centered, not tiny.
- FILLED state: the item icon fills the recessed well, with the rarity-colored border/glow we already
  have, PLUS a warm GOLD outer highlight/glow on the frame (the mockup's equipped slots glow gold).
- Labels stay OUTSIDE the cell (left column label to the left, right column label to the right),
  gold/tan uppercase.
- Keep all unequip affordances (corner-x, right-click, drag) and the ids. Remove the thin yellow
  L-bracket look entirely - replace with this framed look.

## 2. STONE ARCH NICHE (around the model)
Replace the thin gold outline arch with a CARVED STONE ARCHWAY (dungeon alcove):
- A grey weathered STONE masonry arch (horseshoe / rounded-top) framing the model, made of visible
  stone BLOCK segments (fake the masonry with an inline SVG arch OR layered CSS gradients + segment
  lines + inset shadows; NO new asset file - inline SVG data-uri or an inline <svg> is fine, it is
  code not an asset). Weathered grey stone with subtle darker mortar lines between blocks.
- Interior (behind the character): darker, with a subtle COOL BLUE atmospheric glow (radial gradient)
  so the character reads against it.
- The arch sits above/around the pedestal like a dungeon niche. It must NOT cover the model or the
  3D preview canvas (#char-model-preview) - it frames behind/around it.
- Keep the model centered inside; the model preview canvas stays on top and interactive
  (drag-rotate still works).

## 3. STONE PEDESTAL (pedestal.ts, the 3D procedural mesh from Phase 2b)
The mockup's pedestal is a CHUNKY round STONE DAIS - a short wide cylinder with a STEPPED/TIERED top
edge and stone-block texturing, grey weathered stone, the character standing centered on top. Ours is
a small thin dark disc. Improve src/render/characters/pedestal.ts:
- Wider radius + more height, a stepped/tiered top rim (2-3 tiers), stone-grey material with subtle
  value variation so it reads as carved stone (procedural, no new textures/assets).
- MUST NOT change the model's framing/size (Phase 2b invariant: pedestal never touches the camera;
  the model stays the same size/position). The pedestal sits under the feet and may extend below frame.
- Keep captureCloseup hiding it, disposal complete, default-off elsewhere.
- Verify via screenshot the pedestal reads as a chunky stone dais and the model framing is unchanged.

## Layout (match the mockup arrangement)
Left column top-to-bottom: HEAD(helmet), NECK(neck), SHOULDERS(shoulder), CHEST(chest), GLOVES(gloves).
Top-center above the arch: the bag socket(s) (mockup labels it BAG/TRINKET; we keep our real bag
sockets - keep the 4 but present the top row cleanly, or the primary one prominent; keep our model).
Right column: MAIN HAND(mainhand), then our real slots WAIST/LEGS/FEET(BOOTS)/RING1/RING2. (Mockup's
right is MAIN HAND/OFF HAND/LEGS/BOOTS/RING1 - we keep honest slots: no off hand; keep waist + ring2.)
Below the arch: the "1 2 3 4" skin/set row as rounded gold-edged buttons, first active.
Symmetric composition around the arched niche.

## Background
Deep NAVY-BLUE gradient (darker top, subtle glow), matching the mockup's atmosphere.

## Hard constraints (unchanged)
- HONEST DATA / real 11 slots (no off hand, no trinket slot; keep waist + ring2). PURE CLIENT
  EXCEPT pedestal.ts (render) which is in scope for the pedestal improvement (Phase 2b precedent).
  NO new asset files (inline SVG/CSS/procedural only; media manifest unchanged).
- #char-window pristine; #char-model-preview + #char-skin-row ids preserved; drag-rotate intact.
- Sacred unequip flows intact (never delete a sacred assertion).
- Tokens only for colors (add gold-brown / stone / navy tokens under the existing groups if needed);
  no raw hex/px/color in painter TS; ten-dash CSS banners. No em/en dashes or emojis.
- Keep all existing tests green (char*, all 15 *_frame, architecture incl. RENDER purity for
  pedestal.ts, css_corpus/value_validity/styles_extraction/per_entry_css_wiring, preview_appearance
  + pedestal tests). Update selectors, never delete assertions. Register new CSS banners in css_corpus.
- Verify with node scripts/char_equipment_shot.mjs; the orchestrator compares to the close-up mockup.
  Also do a PARTIAL-equip check (temp, not committed) to see empty slot frames + glyphs clearly.
