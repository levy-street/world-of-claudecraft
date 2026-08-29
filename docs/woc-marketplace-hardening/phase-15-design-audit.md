# 15: the DESIGN.md conformance audit (checklist + disposition)

The written checklist deliverable 1 asks for, produced BEFORE any edit and then
worked top to bottom. Every row carries its disposition: APPLIED (landed in this
pass), DEFERRED (with the reason and the owner), or JUDGED (no change, with the
reason). Nothing is silently dropped.

Surfaces audited: the $WOC Exchange window (browse, listing detail, bid form,
buy now, sell, activity, the quote face, every status state), the trade window's
$WOC arm (compose, both review faces, awaiting payment, paying, quote review,
settled, closed, blocked) and the trade chrome it sits in, the store projection
(`woc_store_view.ts`), plus the marketplace catalog copy and the two capture
rigs. Standards: `DESIGN.md` sections 3, 4.1 to 4.6, 5.1 to 5.4, 6, 8.1, 8.2,
10.1 to 10.7, 11, 12, 13.1 to 13.5, 14; `src/styles/CLAUDE.md` (layer, token and
mobile-coverage contract); `docs/design/tooltip-writing.md`.

Method: seven read-only audit lanes (Exchange chrome, trade arm, content
robustness, tooltip and disclosure copy, mobile, test pins, i18n obligations)
over the merged tree, each returning ranked findings with file:line; then this
checklist; then the edits; then the guard suites and the captures. Live token
facts were verified against `src/styles/tokens.css` and `src/ui/theme.ts` rather
than taken from DESIGN.md prose: the document's `--radius-window`, `--dur-*`,
`--color-ink-*`, `--panel-fill-strong`, `--color-text-secondary` and
`--color-accent-hover` have NOT landed, so this pass composes only tokens that
exist plus `color-mix()` over them (the `hud.css` precedent).

## A. Color and the themed / static split (DESIGN.md 4.1, 4.3, 4.5, 4.6)

- [x] APPLIED. `var(--accent)` is defined NOWHERE (7 reads: 6 in the trade arm,
      1 in the Exchange busy ring). Every read silently resolved to
      `inherit` / `currentColor`, so the money row's accent, the net line, the
      settled line, the selected currency toggle and both spinner arcs shipped
      without their colour. All 7 now read `var(--color-accent)`, the themed
      contrast-repaired derivation.
- [x] APPLIED. New guard so this class cannot recur:
      `tests/css_token_resolution.test.ts` resolves every fallback-free
      `var(--name)` in `src/styles` against everything that declares one (the
      sheets, `theme.ts`'s emitted vars, inline `--name:` setters), with the
      seven pre-existing offenders ratcheted as an exact set.
- [x] APPLIED. Static ink fills under themed text (the parchment-preset
      dark-on-dark class): `#1a1410`, `#12100e` and the `#2a2436 -> #161220`
      purple gradient are gone from the Exchange; control fills are
      `var(--color-bg-dark)`, the listbox surface `var(--panel-base)`, and the
      selected / primary tint is `color-mix(in srgb, var(--color-accent) N%,
      var(--panel-base))`.
- [x] APPLIED. Literal border hexes that re-spelled a token (`#6f5a2a` three
      times, `#463a1c` on themed surfaces) now read `var(--border)` /
      `var(--color-border-default)`.
- [x] APPLIED. Trade-arm literals the section comment already forbade:
      `#887c5c` (three rules) and `#d8b46a` to `var(--color-text-muted)` /
      `var(--gold-dim)`; the host chrome the arm sits inside followed
      (`#1eff00` to `var(--color-text-success)`, `#0c0c12` / `#0d0d14` to
      `var(--color-bg-input)`, `#ffffff14` to a `color-mix` of the text token,
      `#ffd100` to `var(--gold)`).
- [x] APPLIED. Bright accent as chrome (DESIGN.md 4.3's "`#ffd100` stops being
      the colour of chrome"): hover text is parchment with the BORDER moving to
      the accent; the accent stays for selection, the one primary button, the
      consent link and the reserve-met chip.
- [x] APPLIED. The interior no longer outshines the frame: every row separator
      and badge edge moved off `--gold-dim` (brighter than the window's own
      border) onto `var(--color-border-default)`, and the structural boxes onto
      `var(--border)`.
- [x] APPLIED. The listbox shadow's raw `#000000a6` and fixed blur now ride
      `var(--color-art-shadow)` and `var(--fx-shadow)`, so the low tier sheds
      it like every other decorative shadow.
- [ ] DEFERRED (the DESIGN.md chrome retune, WITH evidence). `--panel-border`
      is consumed and declared nowhere, but its 13 consumers are all Dungeon
      Finder borders, so declaring the alias is not a token cleanup: it
      switches on borders that have never painted and grows those chips by
      about 2px, in a window this pass neither owns nor captured. It stays
      UNDECLARED on the exact ratchet in `tests/css_token_resolution.test.ts`
      (which pins the non-declaration), and the retune owes a Dungeon Finder
      before/after (desktop and 900x420) when it lands. An early draft of this
      row declared the alias; the seam review reversed it, and progress.md's
      deferral list is the record this row now matches.
- [x] JUDGED, no change. The accent knob's own retune (`#ffd100` to `#d8a645`),
      `--color-accent-hover`, `--color-text-secondary` / `--color-text-faint`,
      `--panel-fill-strong` and the `--color-ink-*` ramp are DESIGN.md
      foundation work (its rollout 1 and 2) that restyles every window at once;
      a marketplace-local mint would be the parallel token namespace section 14
      forbids. Recorded for that program.
- [x] JUDGED, no change. `.panel` keeps its edge recipe and the untouchable
      quality / class colour families are untouched (the item name still reads
      through `QUALITY_COLOR`).

## B. Typography (5.1, 5.3, 5.4)

- [x] APPLIED. The Exchange had NO base size, so `p` / `td` / `li` / status /
      the pager count all fell to the UA 16px while notes sat at 12px and
      controls at 13px (four sizes, none of them the 14/19 body row). The window
      root now sets 14/19 and the metadata tiers are explicit.
- [x] APPLIED. Section headings had no rule at all (`h3` rendered at 18.7px,
      LARGER than the window title; `h4` was indistinguishable from body): the
      display face at 15/20 for `h3`, the ui face at 13/17 muted for `h4`, both
      with a real margin rhythm.
- [x] APPLIED. Button and tab labels moved off the Cinzel display face (a brand
      face beside Alegreya inputs on the same row) onto the ui face at 14/700,
      the 10.1 button label.
- [x] APPLIED. Sub-12px authored text, both surfaces: the badges (11px), the
      trade arm's money and legal lines (11px / 11.5px), the price label and the
      consent caption all now sit at or above the 12px floor, with the money
      lines at 13px.
- [x] APPLIED. `font-weight: 600` (a cut Alegreya Sans does not ship, so the
      browser faux-bolds or snaps to 700 unpredictably) is now 700 on both item
      name rules.
- [x] APPLIED. Tabular numerals: declared once on each surface root
      (`#woc-market-window`, `.trade-woc-arm`, `.trade-money`) instead of five
      partial copies that missed the quote legs, the rate line, the pager count,
      the strikes line and every trade-arm figure.
- [x] DEFERRED (the shared-primitive program, DESIGN.md rollout 2). `.btn` at
      12.5px in the display face, `.panel-title`'s gold 15px, `.x-btn`'s 12px
      glyph and the 36px-under close target are shared window chrome; restyling
      them from a marketplace section would be the per-component copy 13.4
      forbids. Recorded, unchanged.
- [x] JUDGED, no change. Title case on buttons (5.4) is not enforced anywhere in
      this catalog (`hudChrome` is mixed: "Accept Trade" beside "Place bid"), so
      a marketplace-only sweep would create a new inconsistency; the reword also
      stales every locale row it touches. Recorded for a catalog-wide decision.

## C. Layout, alignment and hierarchy

- [x] APPLIED. The browse table re-flowed every column whenever the countdown or
      a price changed width (auto layout, rebuilt once a SECOND inside the
      anti-snipe window): `table-layout: fixed` with header-cell widths, the
      money and time cells right-aligned and `nowrap`, the seller cell breaking
      rather than widening.
- [x] APPLIED. The detail pane stretched the full grid row and painted at the
      top, so a row picked deep in a 25-row page rendered its bid form off
      screen: it now sticks to the top of the browse pane with its own scroll.
- [x] APPLIED. The estimate line appeared two round trips after the row click
      and pushed the price field and both money buttons down: its slot is
      reserved.
- [x] APPLIED. "No recorded sales for this item yet." was asserted while the
      history request was still out: a loading line now covers `sales === null`.
- [x] APPLIED. Browse loading was invisible (no indicator, no `aria-busy`) and
      an empty-plus-loading state painted a header-only table: the table carries
      `aria-busy` and dims, and the empty pane paints the shared ring.
- [x] APPLIED. The empty and failed browse faces dropped the pager and the sort
      control, dead-ending a player on an empty page past the first: the pager
      renders on every browse face.
- [x] APPLIED. Activity rows were free-flowing flex spans (amounts and statuses
      zig-zagged, controls never lined up): one grid grammar per row (item,
      amount, status, controls) with the failed-payment sentence spanning its
      own row underneath.
- [x] APPLIED. The item icon and its name were independent flex children, so a
      wrapping activity row could break the pair apart: one `.wm-item`
      inline-flex box, and the icon's stacked `margin-right` dropped so every
      context spaces them alike.
- [x] APPLIED. Badges dropped to a second line under the item name because the
      row activator was a block-level flex box: it is inline-flex now, and the
      chips are `nowrap` so a two-word chip cannot break inside itself.
- [x] APPLIED. The detail card had four different internal spacings (0px
      paragraph stack, an 8px form gap, 14/16px around buy now, 20/8px around
      cancel): one flex column with a single gap, the per-button margin hacks
      gone.
- [x] APPLIED. Content padding doubled the window pad (12px shell + 12/16px
      body) and the section carried about forty off-scale spacing literals: the
      body pads once, and the spacing rides `--spacing-*` / `--window-pad` with
      the sanctioned 6px dense-row exception.
- [x] APPLIED. Radii are tokens (`--radius-sm` / `--radius-md`); the off-scale
      6px and 8px chip radii are gone.
- [x] APPLIED. The sell form's inputs stretched to the full 900px body width:
      the sell column and the quote panel cap at a reading width.
- [x] APPLIED. Notices and the busy line sat between the tabs and the body, so
      every toast shifted the rows and the form under the pointer, and the busy
      banner slid the control the player had just pressed away: they moved into
      a footer status bar with a fixed minimum height, beside the rate line;
      only the two standing banners (paused, wallet) remain above the body.
- [x] APPLIED. Activity: empty sections printed a heading over nothing, and the
      strike / suspension notice (the one state that explains every refused
      control) rendered LAST, under up to 150 rows: per-section empty lines, and
      the notice leads the tab.
- [x] JUDGED, no change. The window stays a fitted 960 x 700 rather than
      adopting 8.1's large-window 1280 x 820: the browse table plus a 240 to
      320px detail column reads at this size, the mobile sheet re-pins it
      anyway, and growing it is a product call rather than a conformance fix.
      Recorded in the section comment.
- [x] DEFERRED (behavior, not presentation). Scrolling the freshly rendered
      detail pane into view on a mobile row tap needs a `scrollIntoView` on
      select, which is a behavior change: recorded in progress.md.

## D. Iconography (6)

- [x] APPLIED. The Exchange's item icons were bare `<img>`s while bags, vendor,
      bank and the trade rows frame the same art: both icon classes now carry
      the shared `.item-icon q-<rung>` family, so rarity framing and the dark
      inset are the family's, not a second copy.
- [x] APPLIED. Trade rows now colour the item name by quality like every other
      inventory surface.
- [x] APPLIED. The pager's guillemet text entities became `svgIcon('prev')` /
      `svgIcon('next')`, so the window stops mixing a text glyph with its SVG
      chrome family.
- [x] APPLIED. A new `alert` chrome glyph (outlined triangle, `currentColor`)
      pairs every error and strike line with a shape, closing DESIGN.md 12's
      "errors are icon plus text" on this surface.
- [x] APPLIED. `iconDataUrl('item', id, 28)` composed a 28px procedural master
      for the unknown-id fallback (a 2x upscale, and its own cache key the idle
      warmer never fills): both sites now take the shared default master.
- [x] JUDGED, no change. No emoji anywhere on these surfaces; one lighting
      direction and one icon family per panel now hold.

## E. Component primitives (10.1, 10.2, 10.4, 10.6, 10.7)

- [x] APPLIED. Buttons had no `:active` and hover changed only the text colour:
      the full state set now (hover lifts the fill and moves the border to the
      accent, pressed drops a pixel with the static gold-900 inner edge on its
      guaranteed-dark ground, disabled desaturates and dims while keeping its
      label and the house arrow cursor, focus is the shared outline).
- [x] APPLIED. Disabled buttons wore a BRIGHTER border than enabled ones (the
      gold-dim swap) and the browser's default arrow: reversed onto the muted
      border token plus opacity and saturation.
- [x] APPLIED. Two co-equal gold primaries in one pane (Place bid AND Buy now)
      and one on every settlement row: one primary per face now (Place bid in
      the bid pane, Pay now on a settlement row, Sign on the quote face); Buy
      now takes the standard chrome.
- [x] APPLIED. The primary button was inverted (bright yellow text on a purple
      ink gradient): it is the accent-tinted fill with the accent edge and
      primary text.
- [x] APPLIED. The tab strip was boxed buttons with a filled selected state and
      a doubled underline: the 10.2 strip (transparent tabs, muted labels, hover
      to parchment, the selected one in the accent over a 2px accent underline
      on the strip's own hairline).
- [x] APPLIED. The trade arm's currency switch was a `role="tablist"` named
      after ONE of its two tabs, with no roving tabindex, no `aria-controls` and
      no arrow keys: it is a labelled `role="group"` of two `aria-pressed`
      toggles (the dungeon-finder ruling: a half-built tablist reads worse than
      an honest group), styled as a segmented control whose pressed state
      carries an underline as well as colour, so it survives forced colours. Its
      dead `.active` class (styled nowhere) is gone.
- [x] APPLIED. Every arm button was the same maroon `.btn`, so nothing told the
      buyer which control spends money: one `trade-woc-primary` per face
      (Offer / Pay / Sign) and `trade-woc-quiet` on the ways out, with paired
      actions in one row.
- [x] APPLIED. The shared `.btn` margins fought the arm's flex column (a ragged
      right edge, a 16px-vs-6px rhythm, the tabs pushed 10px down): zeroed
      inside the arm, with the row's gap owning the spacing.
- [x] APPLIED. Badges are the 10.4 grammar at the 12px floor with the
      `--radius-sm` corner, not an 11px pill.
- [x] APPLIED. The arm's flat bronze divider became the 10.6 gold fade.
- [x] APPLIED. Form controls: the Exchange's ~35px inputs and selects are 40px
      on the strong fill with the structural edge and a themed placeholder; the
      trade window's number fields gained the themed focus ring they lacked
      (they were showing the UA blue outline inside a gold-edged window) and a
      placeholder colour.
- [x] APPLIED. The cancel-listing button borrowed a top border as a divider and
      rendered as a lopsided three-sided box: ordinary chrome now, with the
      danger colour on hover only.
- [x] APPLIED. The banners, notices and busy line stopped re-painting the panel
      gradient inside the panel (a panel on a panel) and the error states moved
      off a TEXT token onto the border token that carries the meaning.
- [x] APPLIED. Two identical spinner primitives (`wm-spin` and
      `trade-woc-spin`, declaration for declaration) collapsed into one
      `.woc-spinner`, which also gained `display: inline-block`: inside the
      pressed Pay button it was an inline box, so its size was ignored and the
      transform never applied (a 4px bordered sliver that never spun), and its
      arc was invisible against its own ring.
- [x] APPLIED. The selected browse row painted the panel GRADIENT per cell
      (five restarting gradients, the same colour as the window): one accent
      tint plus an inset accent bar on the first cell.
- [x] APPLIED. Clickable rows had no hover state at all and used the OS hand
      instead of the house cursor.
- [x] APPLIED. The quote face was plain body text at full window width: a
      confirm surface at a reading width, with the total leading its legs.
- [x] JUDGED, no change. The three native `<select>` controls stay native (the
      repo's themed `.ui-dd` dropdown is a wiring change, out of a
      presentation-only pass); only the closed control is restyled. Recorded.

## F. Motion, fairness, accessibility (11, 12, 13.1)

- [x] APPLIED. Reduced motion still drops the spin and keeps the ring, now in
      one place instead of two.
- [x] APPLIED. No layout-shifting open or hover animation was added; the
      transitions are colour and border only, on `--transition-speed`.
- [x] APPLIED. `:empty { display: none }` on the arm's derived lines dropped the
      hint's `role="status"` LIVE REGION out of the accessibility tree between
      announcements (several screen readers never announce a region that
      appears in the same frame as its text): owl spacing replaces it, so an
      empty line costs no height and stays present, and the three asynchronous
      money lines keep their slot so the commit button never moves under a hand.
- [x] APPLIED. Colour independence held and now holds with shapes too: the
      error and strike lines carry the alert glyph, the selected currency toggle
      carries an underline, the selected row an inset bar.
- [x] APPLIED. Focus indication stays the outline mechanism (never a
      box-shadow), and the pager buttons became keyboard-safe: they carried no
      `data-focus-key`, so paging dropped focus to `body` on every rebuild; they
      are keyed now with a two-rung restore ladder (next, then prev when the
      landed page disables next).
- [x] APPLIED. `role="row"` with `aria-selected` outside a grid became
      `aria-current`; the status faces are announced (`role="status"`).
- [x] APPLIED. Fairness: every change here is cosmetic. No tier or theme gates
      an actionable read, no `data-fx-level` branch was added, and the new
      shadow is the only tier-aware value (it sheds decoration, never
      information).
- [x] JUDGED, no change. The tooltip box, the dialog root, the focus trap, Esc
      through `closeAll` and the 50-to-89 z band are unchanged.

## G. Mobile (13.5, and the landscape-only in-game rule)

- [x] APPLIED. Neither money sheet cleared the safe-area insets (both pinned raw
      10px) while `#bags` and every dock use `max(10px, env(...))`: on a
      landscape notch the close button, the pager and the arm's Pay button sat
      in a corner band. Both now inset, re-declaring `transform` as the mobile
      contract requires.
- [x] APPLIED. The trade window's raw-`100vw` max-width under-filled the pinned
      sheet below `uiScale` 1 (about 15 percent of the width lost at the 0.85
      floor): dropped, like `#bags` did for the same reason.
- [x] APPLIED, the blocking mobile defect. Opening a trade also opens the bags,
      and on the touch sheet `#bags` (`z-index: 95 !important`) covered the
      trade window ENTIRELY, arm included: a phone player could not see or reach
      the offer. Presentation-only fix keyed on the open marker the Hud already
      stamps (`data-window-open`): while both are open they split the sheet like
      the vendor and bank docks, and a bags close returns the trade sheet to
      full width on its own.
- [x] APPLIED. `.trade-cols` stacked the two 120px offer wells vertically on a
      landscape-only phone, pushing the arm and the Accept row a screen below
      the fold: side by side now, with shorter wells; the stack is kept for the
      half-width split state.
- [x] APPLIED. The window's Accept / Cancel row is a real row that sticks to the
      sheet's bottom edge, so the commit control cannot sit below the fold.
- [x] APPLIED. The same fact at the TOP edge, found in the fresh captures and
      missed by the first sweep: `.window > .panel-title` is sticky and paints
      over the sheet scrolling beneath it, so a control the browser scrolls to
      the top of the scrollport (focusing a money field does exactly that) came
      to rest UNDER the header. The centre-point hit test could not see it,
      because a control covered down to its middle still answers at its own
      centre. `#trade-window` now carries a `scroll-padding-top` mirroring the
      mobile header floor, and the rig measures the header's live bottom edge
      after every scroll and asserts each control clears it.
- [x] APPLIED. Touch floors the CSS claimed but missed: the sell form's three
      number inputs and two selects, the combobox text input (all about 38px),
      the trade arm's price field (about 26px: it lives in the arm, not in
      `.trade-money`, so the coin floor never reached it), and the bid field's
      missing `box-sizing`. The coin inputs also widened, since three 16px
      digits did not fit their 52px box.
- [x] APPLIED. The arm's money and legal lines stayed at 11px on touch (about
      9.4px at the 0.85 scale floor) while the consent caption was floored to
      16px: the whole set now floors at 14px, and the seller's second-chance
      caption joins the 16px consent group.
- [x] APPLIED. The scrolling tab strip clipped a focused tab's outside ring:
      drawn inside on touch.
- [x] APPLIED. The combobox list cap read raw `40vh` under the `#ui` zoom:
      divided by the scale like every sibling rule.
- [x] APPLIED. The dead `.wm-detail { max-height: none }` override is gone (the
      desktop rule it fought never existed; the new sticky pane needs an honest
      `position: static` reset instead).
- [x] APPLIED. Both rigs now MEASURE what they claim: a window-wide floor sweep
      over every button, link, input, select and consent label on Browse, the
      two detail panes and the Sell tab, plus the trade window's own chrome
      (Accept / Cancel row, coin inputs, close), the coarse-pointer fact the
      floors depend on, and a `BAGS_OVER=1` arm that captures and asserts the
      split state instead of hiding the bags to measure.
- [x] APPLIED, from the seam review. Both money sheets pin their BOTTOM edge and
      divide every safe-area inset by the UI scale (the `#social-window` shape).
      The old form paired a raw inset with a flat 20px height cap, so a top
      inset above 10px pushed the sheet's bottom edge BELOW the viewport, and a
      fixed sheet cannot be scrolled back: the newly sticky commit row, pinned
      to exactly that edge, went out of reach. The raw insets also shrank with
      the zoom, clearing only 37px of a 44px notch at the 0.85 scale floor.
- [x] APPLIED. The sticky row's scroll reserve is derived from the tokens the
      row is built from rather than a bare literal. The first derivation was
      WRONG and the rig caught it inside one run: scroll-padding resolves against
      the SCROLLPORT's bottom edge, and the window's own bottom padding sits
      below the sticky row inside that scrollport, so the band is 12px taller
      than the row. The rig now MEASURES the band and asserts the computed
      reserve covers it, which is a stronger guard than either number.
- [x] APPLIED. Both consent checkboxes reach the 24px floor on DESKTOP too: the
      trade arm's was 18px and the Exchange's was still the 13px UA default, on
      the one control the server will not take money without.
- [x] JUDGED, no change. Insetting the SHARED sheet base for all 24 windows is
      the systemic fix and a maintainer call; this pass insets the two money
      sheets it owns. The store's dead portrait media query stays (out of scope,
      recorded).

## H. Content robustness at the extremes (deliverable 2)

- [x] APPLIED. Truncation: no sink clips silently now. Long item and seller
      names wrap by design inside a fixed-width cell (`overflow-wrap: anywhere`,
      `min-width: 0` on the flex children), the chips never break mid-phrase,
      and the countdown carries the exact end time as a tooltip rather than
      relying on its truncated single unit.
- [x] APPLIED. Width stability: fixed table layout plus `nowrap` on the money
      and time columns plus tabular numerals means a per-second countdown
      rebuild and a landing bid cannot re-flow the table.
- [x] APPLIED. Formatting: every USD amount rides `usdText` (Intl currency),
      every date `formatDateTime`, every duration `durationText` /
      `formatDuration`, and every token figure now rides ONE spelling
      (`woc_tokens_text.ts`): the trade arm printed four fraction digits where
      the Exchange, the bag chip and Claudium printed two, for the same server
      numbers. The Claudium pack labels stopped concatenating ` SOL` / ` USDC` /
      ` WOC` onto a localized number (catalog templates now), the discount
      percent goes through Intl, the sell duration options use the Intl unit
      formatter instead of an English `{hours} hours` template, the ineligible
      count uses a real plural base instead of `item(s)`, and identifiers in
      aria labels stopped being grouped as quantities ("listing 1,234").
- [x] APPLIED. The grep-proof was widened: `tests/usd_text.test.ts` now also
      hunts a ticker glued after an interpolation (` USD` / ` USDC` / ` SOL` /
      ` WOC` / ` $WOC`), with positive controls; `tests/woc_tokens_text.test.ts`
      pins the shared token spelling and that no caller re-spells the digits.
- [x] APPLIED. Icons: crisp at HUD scale (the default master, curated 128px art
      downsampled), framed by the shared quality family, and the deliberate
      placeholder is the family's own fallback rather than a broken square.
- [x] APPLIED. Zero, one and max-page states: the sell picker's empty state
      carries the locked-items note, the Activity sections each say when they
      are empty, the browse empty and failed faces keep their pager, and the
      captures include an empty sell tab, an empty activity tab, a full 25-row
      page and its last page.
- [x] APPLIED. Loading states reserve space (the estimate slot, the derived
      money lines, the footer strip's minimum height) so nothing jumps.

## I. Tooltip and disclosure quality (deliverable 3)

- [x] APPLIED. Resolved values where the wire carries them: the bond note names
      the bond for THIS listing beside the bid it applies to (both server
      figures, already on the row) instead of one unexplained amount; the
      second-chance note resolves the settlement window; the seller's fee is
      RESOLVED from the server's split for the price being typed (the schedule
      is service configuration and is not on the wire, so the note names no
      percentage any more and the figures come from the estimate the same way
      the bid preview's do).
- [x] APPLIED. Vague durations became the live figures, pinned to the server
      constants by `tests/woc_market_copy_figures.test.ts`: the anti-snipe
      window and cap, the Buy Now hold, its per-listing cooldown and its hourly
      cap, and the strike ladder.
- [x] APPLIED. Claims that were not true: the paused banner asserted a cause it
      cannot know and named only bids and payments (the pause refuses listings
      and offers too); the suspension line said "bidding" when a strike blocks
      listing, buying and offers as well. Both reworded, and their `apiError`
      twins with them.
- [x] APPLIED. Every hover surface that needed an explainer got one, through the
      shared tooltip box (hover, focus and touch), never a native `title`: the
      reserve met / not met chips (a bidder's only encounter with a hidden
      reserve), the "Your listing" chip, the "Purchase in progress" chip, the
      countdown cells (exact end time), the settlement deadline, and the strike
      count (what a strike is and the ladder it climbs).
- [x] APPLIED. Copy that spoke in the wrong voice or about the wrong thing: the
      row activator was labelled "Place a bid on X" on every row including
      buy-now-only listings and your own; a buy-now-only listing showed "No bids
      yet" and a starting-bid line for a price that only sorts; the estimate
      never named the amount it converted (and on a buy-now listing converted a
      price the buyer cannot pay, while the fetched buy-now figure was rendered
      nowhere); the variable-token warning ran on the QUOTE faces, where the
      amount is fixed until the quote expires; the fee legs never said what
      "Burned" and "Treasury" mean to a buyer; the bond quote face named no
      item; the Exchange quote face omitted the claim's payment deadline; the
      sale-history rows dropped the date the wire carries; the trade arm told
      the BUYER to change the seller's table; the offer-sent line hard-coded ten
      minutes while the wire carries the real expiry; the "Marketplace terms"
      link did not say it opens a new tab. All fixed.
- [x] APPLIED. The disclosure wall (six consecutive 12px muted paragraphs before
      the money button, stating the forfeit rule three times) is one inset well
      at 13/17, with the forfeit and strike rule stated once.
- [x] APPLIED. The dead `sellSelectAria` and now-unused `sellClearTitle` keys
      are gone (the clear button keeps its accessible name; the family does not
      pair a native title with it).
- [x] APPLIED. The mobile Exchange launcher's visible label was the Browse tab's
      key ("Browse"): it has its own short label now.
- [x] APPLIED. Both tab strips have their own accessible names (the Exchange
      borrowed the window title, the trade arm borrowed one tab's label).
- [x] DEFERRED (16 or a wire change, in progress.md). Copy that still cannot
      resolve a live figure because it is not on `/status`: the sell-empty
      line's quality floor and category switches, the bid form's bond schedule
      for an arbitrary typed bid, and the bond-pending TTL. Each is written
      figure-free rather than wrong, and the pin test records the constants.
- [x] JUDGED, no change. "Marketplace strike" vs "$WOC Exchange" as two names
      for one system stays: "Marketplace terms" names the actual document, and
      the new strike tooltip defines the term where the count renders.

## K. The capture set (deliverable 5)

All of it lives in ONE directory, `docs/screenshots/woc-market/`: 57 `after-`
shots and 22 `before-` shots, every one taken at the LOWEST graphics preset
(the rigs seed `graphicsPreset 1` before the document loads, pinned by
`tests/woc_market_copy_figures.test.ts`), desktop at 1600x1000 and phone in
the landscape-only logical viewports the game actually runs in (the Exchange
rig at 915x412, the trade rig at 900x420, both at device scale 2, so the
files are 1830x824 and 1800x840). The sixteen captures that
predated the step-up are gone, and with them the last shots of the retired 2FA
face: nothing in either window renders a TOTP field any more
(`tests/woc_market_window.test.ts` pins that the painter never mentions one).

What the pairs are for, reading `before-` against `after-` of the same name:

- `mobile-trade-compose-with-bags`: the blocking mobile defect. BEFORE, the
  bags sheet covers the trade window completely (the rig measures
  `tradeW 880, bagsW 880, overlap 880`, and every arm control answers the hit
  test as `div#bags`); AFTER, they split the sheet, `overlap 0`, every control
  top-most at its own centre.
- `mobile-browse`, `mobile-sell`, `mobile-sell-selected`, `mobile-buy-now-consent`,
  `mobile-auction-disclosures`: the touch floors. The before run fails six of
  them (37px and 39px money inputs, a 26px price field); the after run passes
  152 checks with none.
- `desktop-browse` and its three `-stress` twins (the longest sellable name, the
  maximum price, the last page): the table's alignment, the sticky detail pane
  and the pager at the extremes.
- `desktop-sell-empty` / `desktop-activity-empty`: the zero states.
- the `-ru_RU` twins: the wordiest fills, on every face that carries copy.
- the `-stress` trade faces: a 16-character partner name (the cap), a
  7,812,500.25 token figure and a $1,000 price through every settlement face.

## J. Test pins, seams and hygiene

- [x] APPLIED. `WocMarketWindow` had NO behavioral rig (every claim was source
      text; the source suite's header promised a browser-suite arm that did not
      exist). `tests/woc_market_window_rig.test.ts` drives the real window over
      happy-dom with a recording fake client: the open fetch set and first
      paint, the row select chain, paging with its focus ladder, the silent-poll
      blip, tab switching clearing a staged notice, the terms checkbox and the
      typed draft and caret across a rebuild, both scroll keepers, the
      relocalize repaint, the combobox (focus, filter, mousedown commit, clear,
      Escape), the busyGen close guard AND a competing second run, the poll gate
      under a mutation, a classified wallet decline, the platform gate, the
      Activity cancel and the five settlement faces.
- [x] APPLIED. The load-bearing claims moved onto that rig, and the source pins
      that were vacuous or comment-gameable were repaired: the `close()` slice
      ran to end of file, the buy-now-quote slice spanned eight methods, and two
      CSS order pins passed on a lost anchor (`-1 < N`).
- [x] APPLIED. `trade_woc_panel.ts` was a painter in everything but its name, so
      the perf gate's `*_painter.ts` sweep could not see it: renamed to
      `trade_woc_arm_painter.ts` and registered with an exact write allowance.
- [x] APPLIED. The bag's `$WOC` balance chip moved out of the `hud.ts`
      coordinator into `woc_balance_chip.ts` (the ratchet's ceiling followed it
      down), and the shared token spelling landed as a registered pure core.
- [x] APPLIED. Every pin the polish moved was updated in the same change (the
      icon-size pin, the spacing-token regex, the offer-next template, the
      window-button-row selector, the spinner class, the plural base list) and
      the new CSS classes are all styled (the class-coverage guard proves it).
- [x] APPLIED. i18n obligations: English in the catalog only, the five non-Latin
      overlays refilled for every reworded and every new wordy key in the same
      change (35 inserted and 20 replaced per locale, 5 retired), the generated
      bundles regenerated, and the new plural base registered in its pinned
      list.
