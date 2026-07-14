# Character window AAA visual-fidelity brief (from the user's reference mockup)

Target: rebuild the char window (`#char-window`, key C) to look ALMOST 1:1 to the approved mockup.
Decision (user, this session): "Ornate look, HONEST data." Match the mockup's FRAME, LAYOUT, and
STYLING exactly, but keep panels/slots backed by REAL sim data (do NOT add fake stats or slots).

## Overall aesthetic
Premium dark-fantasy "AAA RPG" character sheet: deep navy/charcoal background panels with a rich
GOLD ornate border frame, decorative corner ornaments, gold hairline dividers with a small central
diamond ornament, gold uppercase section headers, subtle inner glows. Think ornate, not flat. The
current build is too plain/utilitarian; this pass makes it ornate and cohesive.

## Top chrome (the frame)
- Ornate gold outer border around the whole window, with corner filigree/brackets.
- TAB RAIL top-left: two tabs. "EQUIPMENT" (a small bag/satchel glyph before the label) and
  "OVERVIEW" (a small person/bust glyph). Gold text; the ACTIVE tab has a gold underline with a
  small diamond ornament centered under it. (We already have tabs + icons infra; add the glyphs.)
- TITLE BANNER centered at top: character name LARGE (e.g. "Tetser") on one line, "Level N Class"
  (e.g. "Level 2 Rogue") smaller directly below, both centered, in a subtly decorative plate/banner
  shape (a shaped gold-edged nameplate, not just plain centered text). NOTE: today the name is the
  window title (left) and level/class is the subtitle; for this look the NAME + LEVEL/CLASS read as
  a centered banner. Keep them as the frame title/subtitle but re-style/position to centered banner.
- TOP-RIGHT: three separate coins with counts, gold then silver then copper (e.g. gold 1, silver 59,
  copper 0), each a small round coin glyph + number. Then an ornate CLOSE (X) button in a gold-edged
  square. (Reuse the real money value; the mockup shows the 3 denominations broken out.)
- A full-width gold divider (with a central diamond ornament) separates the chrome from the body.

## Equipment tab body: TWO-COLUMN layout (this is the big structural change)
Currently the stat panels STACK BELOW the paperdoll. The mockup is a two-column desktop layout:
- LEFT COLUMN (roughly 55-60% width):
  - PAPERDOLL at top: the character model centered inside an ARCHED gold niche/alcove (a tall
    rounded-top arch frame behind the model), standing on the 3D stone pedestal (already built in
    Phase 2b). Flanking the arch:
      - LEFT slot column (labels to the LEFT of each cell): HEAD, NECK, SHOULDERS, CHEST, GLOVES.
      - RIGHT slot column (labels to the RIGHT of each cell): MAIN HAND, WAIST, LEGS, BOOTS(feet),
        RING 1, RING 2.  (NOTE the mockup's right column is MAIN HAND/OFF HAND/LEGS/BOOTS/RING 1,
        but we keep the REAL slots: mainhand, waist, legs, feet, ring1, ring2 - no off hand. Map
        BOOTS=feet. Keep waist + ring2 as real reachable slots. Do NOT add an Off Hand slot.)
      - TOP-CENTER above the arch: the equipped-bag socket cell(s). The mockup labels the top slot
        "BAG / TRINKET"; we keep it as the real bag socket(s) (no trinket). Label it per our real
        model (the existing bag-socket cells). Keep the 4 bag sockets we have, laid as a compact
        row above the arch (the mockup shows one prominent top slot; keep our 4 but style them as
        the ornate top row).
      - BELOW the arch: the "1 2 3 4" row (our existing skin/set selector, `#char-skin-row`) styled
        as 4 ornate numbered buttons, first active with a gold border.
  - BAGS PANEL below the paperdoll: an ornate framed sub-panel. Header row: a bag glyph + "BAGS"
    (gold), the "used / total" counter right-aligned (e.g. "1 / 16"), and a gold "+" button. Then
    the ornate bag grid (rows of ornate square cells; the standalone bags look, but ornate).
- RIGHT COLUMN (roughly 40-45% width): the SIX stat panels stacked vertically, each an ornate
  sub-panel with a small gold ICON + gold uppercase HEADER + a hairline divider, then the rows:
    - ATTRIBUTES (two sub-columns): keep our real cells - str/agi/sta/int/spi | armor/attackPower/
      dps/critChance/dodge. (Mockup left: Strength/Agility/Stamina/Intellect/Spirit; right: Armor/
      Attack Power/Damage per sec/Crit Chance/Dodge - matches ours.) Above-base values may render in
      GREEN like the mockup (Agility/Crit green) if a cheap real signal exists; otherwise skip green.
    - COMBAT: keep our REAL cells (attackPower, dps, critChance, critRating, hasteRating, spellPower).
      Do NOT build the mockup's Melee/Ranged split or Hit rows (honest-data decision).
    - DEFENSE: keep our REAL cells (armor, dodge). Do NOT add Block/Parry/Resistance (honest-data).
    - PROGRESSION: Total XP + Virtual Level, then the gold XP bar with "cur / max XP" label. (Matches
      the mockup: "Total XP 616 / Virtual Level 2", bar, "616 / 1,200 XP".)
    - SPECIALIZATION: "Specialization: <name or 'No specialization chosen'>" + a gold CHOOSE/CHANGE
      button (matches mockup).
    - GATHERING: Mining/Logging | Herbalism (matches mockup).

## Slot cells (ornate)
Each equip slot cell: ornate square with GOLD CORNER BRACKETS, dark inset, the slot-type glyph when
empty (helmet/neck/shoulder/etc. silhouette) or the item icon + rarity border when filled, and the
slot NAME label OUTSIDE the cell (left col = label left, right col = label right). Filled slots show
a colored rarity glow (green = uncommon, etc., our existing quality tokens). Keep all existing
unequip affordances (corner-x, right-click, drag).

## Colors / tokens
Use existing tokens (--gold*, --panel-*, --color-border-*, --radius-*, quality tokens). If the ornate
gold gradients/filigree need new tokens, add them to src/styles/tokens.css under the existing gold
group. NO raw hex/px/color in painter TS; CSS colors via tokens. Investigate the EXISTING frame
grammar (components.css ~9045+, the "character + talents + crafting AAA frame" banner) and any
existing AAA/ornate styling in the repo (there was a prior UI AAA redesign) and BUILD ON IT rather
than inventing a parallel system.

## Hard constraints (unchanged from the packet)
- HONEST DATA: no new stats, no fake zeros, no Off Hand / Trinket / Block / Parry / Resistance / Hit.
  Keep the real six-panel content + the real 11 slots.
- PURE CLIENT: nothing under src/sim, src/net, server, src/world_api. No wire/DB.
- #char-window root stays `.window.panel`; #char-model-preview / #char-skin-row ids preserved.
- Sacred unequip flows keep working (corner-x, right-click, drag). Never delete a sacred assertion.
- Tokens only, ten-dash CSS banners, no raw hex/px/color in TS.
- No em/en dashes or emojis anywhere.
- Keep ALL existing char/frame/bags/panels tests green; update selectors for markup changes, never
  delete assertions.
- Mobile must not break (full mobile polish is a later round; the right column stacks on mobile).
- i18n: reuse existing keys; any new label is a t() key in hud_chrome.ts with M16 fills.

## Verification
Screenshot via `node scripts/char_equipment_shot.mjs` (reuse warm :5173 if up). Desktop 1600x740 +
1280x800. The orchestrator compares each render to the mockup and gives targeted corrections.
