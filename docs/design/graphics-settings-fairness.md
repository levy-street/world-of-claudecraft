# Graphics and performance settings are gameplay-neutral

Status: principle adopted and FULLY enforced. The HUD effect tiers shipped in
frontend-modernization v0.16.0 (P14a + the 2026-06-26 fairness re-audit), and the one
remaining wire-fidelity gap (negative-value stat-sap auras reading as buffs online) was
closed in commit `a15c910c` (see "Resolved" below). No graphics or performance preset can
hide actionable information.

## The principle

A player's graphics / performance preset must never give them a competitive ADVANTAGE or a
DISADVANTAGE. The simulation is identical for every client (the server is authoritative; the
client is a renderer), so two players on different presets must have the same information to
act on. A graphics tier may shed COSMETIC richness; it must never change ACTIONABLE
information.

ACTIONABLE (must be identical across every tier; never tiered):
- Your own debuffs. You must see a DoT, curse, CC, or move-out mechanic to react, and there
  is no self-dispel, so the aura icon is the only read.
- Party / raid member HP. A healer reacts to it directly.
- The target / boss cast bar. Interrupt timing depends on it.
- Target HP at a usable granularity (execute thresholds, is-it-dead).
- Enemy / aggro positions a player acts on.

COSMETIC (may be tiered down on lower presets):
- Floating combat text volume and lifetime (the live-floater cap and how long each number
  lingers). The damage itself is server-resolved and the HP bars and combat log carry the
  numbers too. NOTE: the numbers themselves are NOT dropped. Refusing non-crit damage numbers
  on low used to hide the player's own hits on their target, their primary combat feedback, so
  low still spawns every floater and sheds cost only through the bounded pool.
- Minimap redraw smoothness. It is a coarse overview; the 3D world and nameplates carry the
  same signal at full rate.
- Buff-icon overflow when the bar is full. A buff is active whether or not its icon is on
  screen, so hiding a buff icon removes no actionable information.
- Portrait and HP-bar redraw smoothness within human reaction tolerance (about 200 ms).

The test for any new tier knob: if a knob hides or delays something a player READS AND REACTS
TO, it is not allowed. If it only reduces visual richness or redraw smoothness, it is fine.

## Current implementation (frontend-modernization v0.16.0)

The HUD effect tier is the player's STATIC graphics preset (`data-fx-level`, resolved by
`src/game/ui_effects_profile.ts`), never the FPS auto-governor. Per-element knobs live in
`src/game/ui_tier_knobs.ts`. Only the `low` tier sheds; medium / high / ultra are
byte-equivalent to pre-tiering.

What each knob does, and why it is gameplay-neutral:

- FCT (floating combat text), `src/ui/fct_painter.ts`: on low, caps live floaters
  (`fctMaxConcurrent`) and shortens their lifetime (`fctTtlScale`), so a burst sheds sooner.
  Every floater is still spawned on every tier, including the player's own non-crit hits, so no
  damage number is ever hidden. The only crit knob left is the CSS crit-emphasis gate
  (`[data-fx-level="low"] .fct.crit`), which keeps the number and drops only the scale/pop.
  Cosmetic: server-authoritative damage is unchanged and the HP bars and combat log also carry
  the numbers.
- Minimap, `src/ui/minimap_painter.ts` + the hud cadence gate: on low, redraws at about 4 Hz
  instead of 10 Hz. Cosmetic: the minimap never draws enemy players (only PvE aggro mobs and
  allies), and the same aggro signal is full-rate in the 3D world and on nameplates.
- Auras, `src/ui/auras_painter.ts`: on low, the visible-count cap is DEBUFF-PRIORITY. The
  player buff bar (`createAurasView('all')`) interleaves buffs and debuffs in sim-application
  order; the cap sheds BUFF overflow only (`if (!s.isDebuff && rendered >= cap) continue`), so
  a debuff is never culled. Full tiers are byte-identical (cap is +Infinity). The aura strip
  also coarsens its repaint cadence to about 4 Hz on low (at the human reaction floor and the
  same rate the party frames run at on every tier).
- Target frame, hud + `unit_frame_painter.ts`: on low, the target frame BODY (HP / level /
  portrait) refreshes at about 10 Hz; a target SWAP bypasses the throttle
  (`nonSelfRepaintDue`), and the cast bar is painted OUTSIDE the throttle (full rate, so
  interrupt timing is never degraded). Cosmetic: 100 ms is below the reaction loop and target
  HP is a coarse read.
- Party frames: deliberately NOT tiered. Party-member HP is a healer's only actionable signal,
  so it stays on the 4 Hz mediumHud band for EVERY tier. (An earlier draft throttled it to
  2 Hz on low; the re-audit removed that. The perf win was illusory anyway, because
  `updatePartyFrames` already short-circuits an unchanged party via its HP-bearing signature.)

### The 2026-06-26 fairness re-audit

A senior re-audit (a five-dimension adversarial review plus a coverage reviewer) found that the
original P14a, while correct and spec-compliant, had drafted two gameplay-relevant sheds. Both
were fixed:

1. The aura cap was a flat first-N cap that could hide a player debuff past slot 8 on low while
   every other tier showed it. Now debuff-priority (never culls a debuff).
2. The party-frame 2 Hz throttle delayed a healer's HP reaction on the preset large-raid players
   pick. Removed; party HP is full-rate on every tier.

Commits on `feature/frontend-modernization-v016`: `8aba739d` (aura debuff-priority cap),
`ae619faf` (party full-rate + the `nonSelfRepaintDue` swap-bypass), `82721b18` (minimap token
cache), `119b47fa` (FCT drop-kind uniformity test), `4915b6b7` (docs).

## Enforcing guards

- `tests/auras_painter.test.ts`: a debuff past the buff cap still renders; an all-debuff bar
  exceeds the cap; the cap is byte-identical on full tiers.
- `tests/ui_tier_knobs.test.ts`: the LOW shed constants are literal-pinned; a `Hud.fxTier()`
  source-scan proves the knobs read the static `data-fx-level` stamp and never the FPS
  governor; a source-scan pins that party frames are not tiered.
- `tests/architecture.test.ts`: `ui_tier_knobs.ts` is a registered UI_PURE_CORE (no governor,
  DOM, or render import).
- `scripts/perf_tour.mjs` per-tier run: `hudHotDomWrites` pinned across tiers (byte-equivalence)
  and the FCT cap engaging per tier.
- `tests/snapshots.test.ts`: a real Sim aura to `wireEntity` to `ClientWorld` round trip pins that
  a negative-value `buff_*` stat-sap carries its value over the wire (so `isAuraDebuff` agrees
  online and offline), while positive buffs, absorb shields, and negative-value non-buff auras
  (a fear angle) stay sparse and decode to 0 (no other online behavior changes); an old-server
  wire with no value decodes to 0 (backward compatible).
- `tests/auras_painter.test.ts`: a wire-faithful negative-value `buff_*` sap, driven through the
  real `createAurasView` into the low painter, renders past the buff budget (the view to painter
  cap path for the sap).
- `tests/auras_view.test.ts`: `isAuraDebuff` classifies a negative-value `buff_*` sap identically
  for the Sim aura and its `ClientWorld` mirror.

## Resolved: negative-value stat-sap auras now classify as debuffs in both worlds

The one residual gap (it predated P14a) is closed as of commit `a15c910c`. A negative-value
`buff_*` stat-sap aura (an attack-power or intellect drain that rides a `buff_*` kind with a
negative value) used to be classified as a debuff by `src/ui/auras_view.ts` `isAuraDebuff` only
OFFLINE: the online wire did not send the aura value (`WireAura` omitted it and the client decode
hardcoded `value: 0`), so `isAuraDebuff`'s `value < 0` branch never fired online. The sap read as
a buff, and on the LOW preset it could ride the buff budget and be hidden past the debuff-priority
cap. The same gap also made the debuff BORDER on such a sap offline-only.

The fix gives the UI the input it was missing, keeping the classification in the UI (the wire only
carries the data):

- `server/game.ts`: `WireAura` gained an optional `value`, emitted SPARSELY by the aura serializer
  for exactly the case the classification reads it, `a.value < 0 && a.kind.startsWith('buff_')`,
  sent raw so the sign survives the wire. Positive buffs, absorb shields, and negative-value
  non-buff auras (a fear's random facing angle) stay off the wire.
- `src/net/online.ts`: the aura decode reads `a.value ?? 0` (was hardcoded `0`), so a missing
  value still decodes to `0` (an old server, or any sparse case) and the field is backward
  compatible in both directions.
- `src/ui/auras_view.ts` and `src/ui/auras_painter.ts`: doc-only updates; the `value < 0` branch
  now fires identically in both worlds, so the debuff-priority cap can never hide such a sap.

Every other allowlisted debuff KIND (dot, stun, silence, sunder, and the rest of
`DEBUFF_AURA_KINDS`) was already value-independent and classified correctly online, because the
kind is on the wire. With this change the graphics-fairness invariant is fully enforced: no
graphics or performance preset can hide any actionable information.
