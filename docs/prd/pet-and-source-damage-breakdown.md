# PRD: Pet-attributed damage and per-source breakdown in the meters

| | |
|---|---|
| **Status** | Draft, pending owner sign-off (do not build until approved) |
| **Owner** | ryan-foo |
| **Created** | 2026-07-15 |
| **Scope** | Client-only (`src/ui/meters.ts` + a new pure view module + i18n + tests). No sim, server, or `IWorld` change. |
| **Related** | `src/ui/meters.ts` (`MeterData` / `Meters`), the `damage` `SimEvent` (`src/sim/types.ts`), `attachTooltip` (`src/ui/hud.ts`), `abilityDisplayNameFromSource` (`src/ui/hud.ts`) |

---

## 1. Summary

Make the damage meter behave like Recount for pets and per-ability sources:

1. **Pet damage counts under its owner.** A hunter/warlock/mage pet's damage folds into the owning player's meter total instead of showing as its own separate row.
2. **Hovering a player's meter row shows a per-source breakdown.** For example, hovering "Swifter" (a hunter) shows `Auto Shot 42%`, `Fell Shot 30%`, ..., and `Pet 28%` as its own category, sorted by contribution. Mages read the same way (`Rimelance`, `Frostbolt`, ...).

The breakdown feeds entirely from the combat log (the `damage` `SimEvent`, which already carries `sourceId`, `ability`, and `amount`). No new sim data is needed.

## 2. Goals

- Attribute a party pet's damage to its owner's row (owner total includes pet damage).
- On hover (desktop) and long-press (mobile), show a player's damage broken down by source: each of their abilities by name, their auto-attack, and a single aggregated **Pet** category, each with its share of that player's total.
- Keep it purely client-side and encounter-segmented like the existing meter (current / history / all-session views all get the breakdown).
- Localize every new label; no raw English in the tooltip.

## 3. Non-goals

- No change to the sim, the server, the wire protocol, or `IWorld`. The meter already consumes `damage` events that both `Sim` and `ClientWorld` deliver.
- No per-pet-ability breakdown in v1 (pet hits carry `ability: null`, so pet damage aggregates to one "Pet" line; see Future work).
- No change to the threat tab's semantics (threat reads the live mob hate table, not cumulative damage; see Edge cases).
- No new persisted state, no new setting.

## 4. Current state (grounded)

- **The meter data model** lives in `src/ui/meters.ts`: `MeterData` segments combat into `Encounter`s, each holding `tallies: Map<pid, MemberTally>`. `MemberTally` today is `{ pid, name, cls, dmg, heal, dmgByMob }` with no per-source detail.
- **`onEvent(ev, world, partyPids, now)`** tallies a `damage` event only when `partyPids.has(ev.sourceId)` and the target is a mob. `partyPids()` (built in `Meters`) is `self + party member pids + their pet entity ids` (it already walks the roster adding any `mob` with `ownerId` in the party set).
- **Consequence today:** a pet's `sourceId` (the pet entity id) IS in `partyPids`, so its damage is tallied, but under a tally keyed by the pet's own entity id (labelled with the pet's name). The pet therefore appears as a **separate row**, not merged into the owner. This is the row the owner sees "stolen" from their DPS.
- **The `damage` `SimEvent`** (`src/sim/types.ts`) is `{ type:'damage', sourceId, targetId, amount, crit, school, ability: string | null, kind }`. `ability` is the ability **NAME** string (e.g. `'Fell Shot'`, `'Rimelance'`), or `null` for auto-attacks and pet hits (both melee `mobSwing` and ranged `petRangedAttack` pass `null`). Pet damage events are world-visible (no `pid`), so the online client receives them for in-range pets.
- **Ability-name resolution** already exists on the client: `abilityDisplayNameFromSource(name)` in `hud.ts` maps a damage event's ability name to a localized display name (looks it up in `ABILITIES`, falls back to `localizeSimAuraName` for mob mechanic names), and `combatAbilityName(null)` returns the localized `hud.combat.attack` ("Attack") for a white hit.
- **A reusable hover tooltip** exists: `Hud.attachTooltip(el, () => html)` handles desktop hover, keyboard focus, viewport clamping, and mobile long-press, and is used by the stat, item, and mob-hover tooltips. `meters.ts` does not currently have access to it.

## 5. Design

### 5.1 Attribute damage to the owner, record the source

In `MeterData.onEvent`, when a `damage` hit is counted, compute the **attributed pid** and a **source key**:

- Resolve `src = world.entities.get(ev.sourceId)`.
- `isPet = src?.ownerId != null && partyPids.has(src.ownerId)`.
- `attributedPid = isPet ? src.ownerId : ev.sourceId`. Tally the amount under `attributedPid` (so the pet's damage joins the owner's `dmg` total and the owner's row).
- `sourceKey`:
  - `isPet` -> the `PET` sentinel (all pet damage aggregates to one category in v1).
  - else `ev.ability` (the ability name) when non-null -> that name.
  - else the `AUTO` sentinel (the player's own white hit).

Add one field to `MemberTally`:

```ts
export interface MemberTally {
  pid: number; name: string; cls: string | null;
  dmg: number; heal: number;
  dmgByMob: Map<number, number>;
  bySource: Map<string, number>; // NEW: sourceKey -> summed damage
}
```

`bySource` accumulates in every encounter the tally is written to (`current` and `allTime`), the same loop `dmg` already uses, so the breakdown is available for the current, historical, and all-session views. `PET` and `AUTO` are reserved constant keys that cannot collide with a real ability name (namespaced, e.g. `"\0pet"` / `"\0auto"`, resolved to labels at render time only).

The top-level meter total is unchanged in formula (`t.dmg` per attributed pid); the only visible change is that pets no longer occupy their own bar and the owner's bar grows to include them, which is the intended Recount behavior.

### 5.2 The breakdown as a pure view module

Add `src/ui/meters_breakdown_view.ts` (a `*_view` pure core, DOM- and i18n-free at its boundary, registered in the `UI_PURE_CORES` allowlist). It turns a `MemberTally` plus injected resolvers into a sorted, allocation-simple render model:

```ts
export interface BreakdownRow { label: string; amount: number; pct: number; kind: 'ability' | 'auto' | 'pet'; }
export interface BreakdownDeps {
  resolveAbilityName: (name: string) => string; // abilityDisplayNameFromSource
  autoLabel: string;                             // t('hud.combat.attack')
  petLabel: string;                              // t('hud.meters.petDamage')
}
export function buildDamageBreakdown(tally: MemberTally, deps: BreakdownDeps): BreakdownRow[];
```

It sums `bySource`, maps each key to a label (`PET`->petLabel, `AUTO`->autoLabel, else `resolveAbilityName(key)`), computes `pct = amount / total`, sorts descending, and returns the rows. The Vitest drives it directly against a hand-built tally (both a hunter-with-pet case and a mage case), with no DOM.

A tiny sibling `renderBreakdownHtml(rows, t)` (or an inline builder in `meters.ts`) produces the tooltip markup: a small table `| source | amount | pct |`, every label through `esc()`, numbers through `formatNumber`/the meter's `fmtPerSecondRow` helper, percents through `formatNumber({ style:'percent' })`. No raw hex/px (tokens/classes only), matching the painter no-magic-values rule.

### 5.3 Wiring the hover tooltip into the meter rows

`meters.ts` must not import `Hud`. Inject the tooltip binder and the two client-only resolvers through the `Meters` constructor `deps` (the same way the panel already receives `world`):

```ts
interface MetersDeps {
  attachTooltip: (el: HTMLElement, html: () => string) => void; // from Hud
  resolveAbilityName: (name: string) => string;                 // abilityDisplayNameFromSource
}
```

`main.ts` (which already knows both `Hud` and the meter) passes `hud.attachTooltip.bind(hud)` and `abilityDisplayNameFromSource`. In the render loop, after appending each `.mt-row`, call `deps.attachTooltip(row, () => this.breakdownHtml(tally))`. The tooltip is only attached on the **damage** tab (heal/threat tabs keep their current behavior; see Edge cases). Because `attachTooltip` already handles focus and long-press, the breakdown is keyboard- and touch-reachable for free; the row also gets `tabindex="0"` and an `aria-label` summarizing the top source so the contract in `src/ui/CLAUDE.md` (HUD-chrome WCAG 2.2 AA) holds.

### 5.4 i18n

Reuse `hud.combat.attack` for the auto-attack label. Add the minimal new keys to the meters catalog (`src/ui/i18n.catalog/hud.ts`, `hud.meters.*`): `petDamage` ("Pet"), and a tooltip heading `breakdownTitle` ("Damage by source"). These are player-visible chrome; wordy values get their five non-Latin fills in the same change per the M16 gate. No sim/server strings are added, so the S3 guard is untouched.

## 6. Edge cases and decisions

- **Online interest scoping.** The online client only receives events for in-range entities (~120 yd), so a distant party member's pet damage may not arrive, exactly as their own damage already may not. The breakdown reflects what the meter saw, consistent with today's per-player totals. No change.
- **Threat tab.** Threat reads the live mob hate table, not cumulative damage, so a per-source breakdown there would be misleading. v1 attaches the breakdown to the **damage tab only**. (A future healing breakdown is possible but out of scope; `heal2` events do not currently carry an ability field.)
- **DoT ticks and channels** already emit `damage` with the source ability name, so they bucket under that ability automatically.
- **Mob mechanic names as an ability label** (e.g. a boss reflect) resolve through `abilityDisplayNameFromSource`'s `localizeSimAuraName` fallback, same as the combat log; they never appear under a party member unless the party member was the source.
- **Pet with a named spell** (warlock imp firebolt) still emits `ability: null` today, so it aggregates under **Pet**; naming pet spells is the Future-work hook, not a v1 requirement.
- **Determinism / perf.** Purely additive client bookkeeping: one `Map.set` per counted hit and a tooltip built lazily on hover (never per frame), so the per-frame HUD budget is untouched.

## 7. Testing

- `tests/meters.test.ts` (extend): a hunter tally where pet damage is attributed to the owner (owner `dmg` includes pet damage, no separate pet row), and `bySource` holds `Auto`, `Fell Shot`, and `Pet` buckets with the expected sums.
- `tests/meters_breakdown_view.test.ts` (new, pure): `buildDamageBreakdown` returns rows sorted descending with correct percents summing to ~100%, the `PET`/`AUTO` sentinels map to their injected labels, and a mage case (`Rimelance` + `Frostbolt` + auto) renders with no pet row.
- Guard: the new `*_view` is registered in `UI_PURE_CORES` (`tests/architecture.test.ts`), and the i18n gates (`localization_coverage`, `i18n_completeness`) stay green with the new keys + non-Latin fills.

## 8. Acceptance criteria

- A hunter fighting with a pet shows one meter row for the hunter whose total includes the pet's damage (no separate pet row).
- Hovering (or focusing, or long-pressing) that row shows a breakdown listing the hunter's abilities by localized name, the auto-attack, and a single **Pet** line, each with its percent of the hunter's total, sorted by contribution.
- A mage shows the same breakdown of its own abilities with no Pet line.
- Desktop hover, keyboard focus, and mobile long-press all reveal the breakdown; screen readers get a summarizing `aria-label`.
- No sim/server/`IWorld`/parity change; `npm run gate` green.

## 9. Future work (out of scope)

- Per-pet-ability rows under the Pet category (requires the sim to set `ability` on pet damage, e.g. from the pet's `petSpell.name` / a synthetic pet auto-shot id).
- An always-open expandable detail pane (click-to-pin) in addition to the hover tooltip.
- A healing-by-source breakdown once `heal2` carries an ability field.
