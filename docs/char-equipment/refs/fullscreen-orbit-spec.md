# Full-screen orbiting Character Equipment redesign (user's detailed spec)

The user gave a precise desktop redesign spec. Implement it faithfully. REUSE the components we
already built (beveled framed slot cells, stone arch niche, chunky stone pedestal, the stat panels,
the bags grid, the 3D preview) - this is a LAYOUT rework, not a from-scratch rebuild.

## FULL-SCREEN CONTAINER (override the centered-card sizing)
The char window must become a LARGE resizeable desktop interface, NOT a small centered card.
Target sizing (user): width ~80vw, height ~80dvh, large, resizeable, usable 1280px-1920px, no wasted
side margins. Use the user's intent: `position: fixed; width: 80vw; height: 80dvh; max-width: none;
max-height: none; box-sizing: border-box;` and CENTER it (so margins are symmetric/minimal) - do NOT
leave big empty side margins. Keep it RESIZEABLE (the existing resize grip) and keep the Hud
open/close mechanism working (open state stays `#char-window.style.display === 'block'`; the frame
still mounts on the inner container). NOTE: this DEPARTS from the packet's earlier "centered
.window.panel" locked decision - that is intentional per the user's explicit new directive.
BEFORE editing, inspect the char CSS for and OVERRIDE/REMOVE anything keeping it a narrow centered
container: max-width, fixed width, margin:auto, aspect-ratio, transform:scale(), max-height,
restrictive parent flex alignment.

## TOP HEADER (~72-80px, full width)
- Left: Equipment tab + Overview tab (keep our tab glyphs + active underline).
- Center: character name + "Level N Class" (our nameplate banner).
- Right: currency (3 coins gold/silver/copper) + close X.

## MAIN GRID (below header, full remaining width + height)
grid-template-columns: minmax(620px, 58fr) minmax(480px, 42fr); gap: 16px;
- LEFT column: (1) equipment stage (upper), (2) bag inventory (below it).
- RIGHT column: one tall statistics panel (Attributes, Combat, Defense, Progression, Specialization,
  Gathering).
Do NOT leave unused empty margins on either side.

## EQUIPMENT STAGE = RADIAL / ORBITING layout (the key change)
- `position: relative`. Character frame (our #char-model-preview inside the stone arch + on the stone
  pedestal) CENTERED: left 50%, top 50%, translate(-50%,-50%), width ~44%, height ~72% of the stage.
- Slots placed with ABSOLUTE positioning at FIXED PERCENTAGE anchors, orbiting the character. Build a
  DATA-DRIVEN ANCHOR MAP (slot id -> {left/right, top}) - do NOT hand-write 12 components. Reuse the
  existing beveled slot-cell component/builder; just position each via the anchor map.
- Do NOT use: a horizontal equipment toolbar, a vertical list, a compact centered rectangle, random
  placement, or a flex row for all slots.

### Anchor map (map the user's positions to our REAL 11 slots; honest data = NO off-hand/trinket):
Top-center: BAG socket (user labels "Bag / Trinket"; we use the real bag socket) at left 50%, top 2%.
LEFT side:
- Head=helmet:     left 8%,  top 12%
- Neck=neck:       left 5%,  top 28%
- Shoulders=shoulder: left 3%, top 44%
- Chest=chest:     left 3%,  top 60%
- Gloves=gloves:   left 6%,  top 76%
- Finger 1=ring1:  left 14%, top 88%
RIGHT side:
- Main Hand=mainhand: right 8%, top 12%
- (Off Hand: NO real slot - leave this anchor UNUSED; do not fake a slot. Keep the orbit balanced by
   spacing the remaining right slots so there is no jarring gap - e.g. place waist a bit higher.)
- Waist=waist:     right 3%, top ~40% (adjust up from 44% to fill the off-hand gap gracefully)
- Legs=legs:       right 3%, top 60%
- Feet=feet:       right 6%, top 76%
- Finger 2=ring2:  right 14%, top 88%
(If the user later wants a decorative disabled Off Hand slot for exact symmetry, add it at right 5%,
top 28% - but default is honest: no fake slot.)

### Slot presentation on the stage (icon-primary, minimal labels):
- Use the SLOT ICON as the primary visual (our beveled framed cells + empty-slot glyph / item icon +
  rarity border). Empty slots = muted embossed glyph. Equipped = item icon + rarity border. Selected/
  highlighted = restrained gold glow (we have this).
- Show only a SHORT uppercase slot label where there is room; HIDE the item-name text from the stage.
- Full slot name + equipped item name + rarity + details go in the HOVER TOOLTIP (we already have
  tooltips via deps.attachTooltip/itemTooltip) or a selected-item panel. Keep tooltips working.

## LOADOUT BUTTONS 1-4
Centered UNDER the character pedestal (our #char-skin-row "1 2 3 4"). NOT attached to the bag panel.

## BAG PANEL (below the equipment stage, FULL left-column width)
- Header: bag icon + "BAGS", capacity "1 / 16", plus button far right.
- Grid: responsive, fill available width, 8 columns on wide desktop, 6 when required, SQUARE slots.
- Do NOT restrict the bag panel to the character-frame width - it spans the full left column.

## RIGHT STATISTICS PANEL (full right-column width, one tall panel)
- Sections: Attributes, Combat, Defense, Progression, Specialization, Gathering (our real content;
  honest data - Combat = attackPower/dps/critChance/critRating/hasteRating/spellPower, Defense =
  armor/dodge; do NOT add fake Melee/Ranged/Block/Parry/Resistance rows).
- Two value columns where appropriate: labels left, numbers aligned, thin dividers, GREEN for
  beneficial modified stats (if a cheap real above-base signal exists; else skip green).
- Compact enough that all major sections are visible without excessive scrolling at 1440x900+.

## RESPONSIVE
- Below ~1150px: stats panel slightly wider vs equipment; reduce slot size + label visibility; do NOT
  collapse to mobile yet.
- At the mobile breakpoint: a SEPARATE landscape layout, not a scaled-down desktop (handle mobile
  separately; this task is desktop-first).

## IMPLEMENTATION REQUIREMENTS (from the user)
- Preserve ALL equipment interactions + state, drag-and-drop, tooltips. REUSE the existing slot
  component. Data-driven anchor map. Use CSS clamp() for slot sizes, typography, gaps, padding. Normal
  DOM + CSS (no canvas positioning for slots; the 3D model preview canvas stays as the center frame).
  No random placement. No transform:scale().

## HARD CONSTRAINTS (still hold)
- HONEST DATA (real 11 slots, real stat rows; no off-hand/trinket/fake stats). PURE CLIENT (no
  sim/net/server/world_api; pedestal.ts render is already done, leave it unless re-tuning). NO new
  asset files. #char-model-preview + #char-skin-row ids preserved; drag-rotate intact. Sacred unequip
  flows intact (never delete a sacred assertion). Tokens only (+ clamp for sizes); ten-dash CSS
  banners; no raw hex/px/color in painter TS. No em/en dashes/emojis. Keep ALL existing tests green
  (update selectors for the new markup; never delete assertions; keep behavior/content assertions:
  slots present, panel order, unequip works, bags, tabs). Register new CSS banners in css_corpus.
- Verify with screenshots at 1600x740, 1280x800, and a 1440x900 (all-sections-visible) shot; compare
  to the full reference. Also a partial-equip check for empty-slot glyphs.
