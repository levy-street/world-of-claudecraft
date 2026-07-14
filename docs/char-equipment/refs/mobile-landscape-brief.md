# Mobile LANDSCAPE reference (user-supplied image) - the target for body.mobile-touch landscape

A separate landscape design, NOT a scaled desktop. Four zones, left to right:

## Header (full width, compact)
- LEFT: small round portrait chip (reuse portraitChipHtml) + character name (large) with
  "Level N Class" under it (left-aligned; NO centered nameplate banner on mobile landscape).
- RIGHT: 3 coins (gold/silver/copper with counts) + close X.
- Tabs: the reference omits a tab rail; we still need Overview reachable. Keep the tab mechanism
  but compact (small icon tabs tucked into the header or a slim rail under it). Do not lose the
  Overview tab; keep aria wiring.

## Zone 1: LEFT ICON RAIL (equipment slots)
- A single VERTICAL rail of icon-only slot cells down the left edge: top = the bag socket(s)
  (primary socket first), then helmet, neck, shoulder, chest, gloves, ring1, ring2, feet, waist,
  legs, mainhand (order: mirror the reference's flow - bag, head..gloves, rings, boots, weapon at
  bottom; exact order implementer's judgment but weapon at the bottom like the reference).
- NO text labels on the rail (icon-primary); full name/details via tooltip/long-press; keep
  accessible names (aria-label) on every cell.
- Muted dark frames (the restraint language); gold highlight ONLY on selected/highlighted cells.
- Cells >= 40x40 tap targets, evenly spaced, scroll the rail if height-constrained (no clipping).
- All interactions intact (tap = same as click; unequip affordance preserved and keyboard/touch
  accessible).

## Zone 2: CHARACTER STAGE (center-left)
- The dark arch (restrained grey-blue) + character on the stone pedestal, compact.
- Loadout 1-4 buttons in a row directly beneath the stage (muted, active-only gold).

## Zone 3: BAGS (center, widest zone)
- Header row: bag icon + "BAGS" + used/total counter + "+" (open full window) button.
- Below: ONE STACKED SECTION PER REAL CONTAINER (backpack first, then each occupied bag socket),
  each section = the container's bag icon at the left + that container's slot grid (square cells,
  ~6-7 columns, 2+ rows as needed). This REPLACES the selector-button model ON MOBILE LANDSCAPE
  ONLY (desktop keeps the selector). Reuse buildCharBags / the pure core per container; honest
  containers only (no fake third bag if only backpack+1 socket exist - render what exists).
- Cells >= 40px, tooltips/actions same as desktop grid (click parity preserved).

## Zone 4: STATS (right column)
- Attributes, Combat, Defense stacked (two value columns inside each, labels left / numbers right).
- PROGRESSION and SPECIALIZATION side by side in ONE row (two half-width panels), then GATHERING
  full width below.
- Honest data rows (real stats only). Compact typography; everything readable at 844x390 to
  ~932x430 without horizontal page scroll; the whole body may scroll vertically if needed.

## Portrait (body.mobile-touch portrait orientation)
- The reference is landscape-only. For portrait keep a clean stacked single-column flow (header,
  compact stage + icon rail arrangement that fits 390px, bags sections, stats) - implementer's
  judgment, consistent with the same visual language.

## Constraints
- Same restraint visual language as desktop (muted dark iron + subtle gold, navy atmosphere).
- Honest data; tokens/clamp; ten-dash banners; body.mobile-touch gating; >=40px targets; no
  raw hex in TS; ids preserved; sacred flows intact; all tests green; no new assets.
- Verify at 844x390 landscape AND 390x844 portrait via the shot script; nothing clipped.
