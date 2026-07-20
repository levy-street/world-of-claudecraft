# Shaman Spiritmend v0.28.0 PRD

Status: Levy-approved owner design direction, pre-implementation
Owner: Ryze
Target: `release/v0.28.0`, PBE Wave A
Approval: Levy, confirmed 2026-07-20
Parent design: [Shaman v0.28.0 Class Design](../design/shaman-v028-class-design.md)

## Specialization gate

Lifespring Weapon, Mending Currents, Tidecall, and Cascading Mend belong only to Spiritmend.
Cascading Mend retains the shipped `chain_heal` id and the core Chain Heal role; it is granted by
the specialization rather than by a talent or Mending Waters morph. Selecting Thundercall or
Warspirit removes every owned pool and exclusive action before the new specialization kit is
resolved.

## Outcome

Spiritmend prepares healing as visible Mending Current pools. Mending Waters creates and enlarges
those pools, Tidecall boosts one ally, and Cascading Mend consumes the Mending Current on every ally
it reaches to release more than the remaining healing immediately.

## Design goals

- Give Spiritmend a unique prepare-and-collapse healing rhythm.
- Keep Chain Heal as the specialization's baseline multi-target payoff rather than a talent morph.
- Make Mending Waters, Tidecall, Cascading Mend, and Lifespring Weapon the complete core kit.
- Let Mending Currents provide efficient healing over time before they are consumed.
- Make Cascading Mend a large prepared burst without making it fail on unprepared allies.
- Preserve Mana as the only resource bar.
- Keep the loop functional in solo, one-target, party, and raid healing.

## Non-goals

- Damage-to-healing gameplay that copies Doctrine.
- A separate healing-current resource bar.
- Unlimited pre-pull healing storage.
- Mandatory ground placement or rapid party-target switching.
- Cascading Mend that only functions when every target has been prepared.
- Multiple independent healing-over-time effects to maintain on each ally.
- A talent that replaces Mending Waters with Chain Heal and makes the baseline loop optional.

## Player experience

Mending Waters places a visible current around an ally. Further preparation makes that current
larger. The Tidecall action saves or prepares one target without a cast. The Shaman may
allow the pools to heal efficiently over time, or cast Cascading Mend to collapse every Mending Current along
its bounce path into one immediate group recovery event.

The decision is whether to preserve efficient healing, enlarge the pools for expected damage, or
consume them now before an ally dies.

## Required kit

| Action or state | Starting PBE behavior |
|---|---|
| Mana | Canonical Shaman healing resource. |
| Mending Waters | Canonical cast-time heal. Creates or enlarges a 12-second Mending Current pool. |
| Mending Current pool | One stored healing-over-time pool per ally per Shaman, capped relative to maximum health. |
| Tidecall | One instant Spiritmend action. Heals immediately, adds to the target's pool, and refreshes it. |
| Cascading Mend (`chain_heal`) | Retained Chain Heal signature with its canonical initial heal and two bounces. Consumes every Mending Current reached for a proposed 125% of its remaining amount. |
| Lifespring Weapon | Spiritmend-only enhancement that increases Mending Current deposits. |

Tidecall is the player-facing action name. Mending Current is the pool it creates or enlarges.

## Mending Current-pool contract

- Mending Waters creates a 12-second pool on its target.
- The starting deposit is a tunable percentage of Mending Waters' calculated healing before
  overheal.
- Recasting Mending Waters adds to the remaining pool and refreshes the duration.
- Each ally holds at most one pool from each Spiritmend Shaman.
- The pool heals every 3 seconds by removing healing from its remaining stored amount.
- The starting cap is 30% of the target's maximum health.
- Contributions beyond the cap are discarded and cannot be recovered later.
- Expiry removes any remaining amount without a final hidden burst.
- Death, leaving the world, respec, or invalid ownership removes the pool cleanly.

Using calculated healing before overheal permits preparation before expected damage. The cap,
duration, and Mana costs prevent unlimited preloading.

## Tidecall contract

- Tidecall is instant and targets one friendly ally.
- It performs an immediate heal, adds a tunable amount to that ally's pool, and refreshes the
  12-second duration.
- It creates a pool if the ally does not already have one.
- The proposed starting model is two charges with a 12-second recharge per charge.
- Lifespring Weapon increases the amount deposited, not the charge count.
- Invalid or failed casts consume no charge or Mana.
- The action and party frame show when the pool is at its cap.

PBE may change the direct heal, contribution, charge count, or recharge. The instant must remain a
pool-building tool rather than a separate unrelated emergency heal.

## Cascading Mend consumption contract

Cascading Mend preserves its canonical bounce selection and normal healing:

1. Resolve the initial target under the existing Cascading Mend rules.
2. Apply the canonical Cascading Mend amount.
3. If that ally has this Shaman's Mending Current, consume its entire remaining pool.
4. Immediately heal the ally for 125% of the consumed amount.
5. Repeat the normal heal and Mending Current check independently for every bounce target.

Additional rules:

- Cascading Mend consumes Mending Currents from every ally it reaches, including the initial target.
- An ally without Mending Current receives the canonical Cascading Mend amount.
- Consumed Mending Currents are removed even when the additional burst overheals.
- Consumption does not change bounce ordering, radius, falloff, or maximum jumps.
- Consumption cannot trigger another Cascading Mend, recreate Mending Current, or recursively create healing
  events.
- Pools belonging to another Shaman are not consumed.

The proposed 125% multiplier is intentionally greater than the remaining healing. It rewards
preparation and accepting the risk of spending efficient healing early.

## Single-target and emergency behavior

- Mending Waters and Mending Current remain complete healing tools when only one ally is injured.
- Cascading Mend can consume a single prepared target even when no bounce target exists.
- The healer is never required to damage enemies to sustain baseline healing.
- Tidecall charges provide mobile emergency healing without removing cast-time healing decisions.
- Cascading Mend without preparation remains useful and cannot become a dead signature.

## Presentation and accessibility

- The party frame shows Mending Current duration and relative pool size.
- The ally receives a water-current effect that grows through a small number of readable tiers.
- Pool size is never communicated through visual scale or color alone.
- Tidecall shows charges, recharge, and capped-target state on its action.
- Cascading Mend shows which reached allies consumed a pool through a distinct burst cue.
- Reduced-motion mode retains static party-frame, aura, action, and consumption cues.
- Mobile players can prepare and consume through ordinary ally targeting without ground input.

## Shared talent integration

- Movement choices may support mobile Mending Waters or Mending Current access without making every heal
  instant.
- Defensive choices may strengthen shields or self-preservation without increasing stored healing.
- Kit talents may alter deposit efficiency, Tidecall charges, or Mana recovery.
- Major cooldowns and capstones may expand preparation or consumption, but must reuse Mending Current and
  Cascading Mend rather than adding another healing system.

The exact 18 class-wide choices are defined in the parent Shaman design.

## Implementation dependencies

- Canonical Mending Waters and bouncing Cascading Mend from `release/v0.28.0`.
- One authoritative owner-scoped healing pool per Shaman and ally pair.
- Deterministic ticking, addition, cap, refresh, expiry, and full consumption.
- Cascading Mend hooks that preserve canonical bounce selection and consume each reached pool once.
- Party-frame, aura, action-bar, and ally presentation for pool size and consumption.
- Offline, online, and headless parity for every stored and consumed value.

Returning Current is replaced by this Mending Current design. PR #1980 remains source material for generic
bank, consume, cleanup, observation, and cue primitives only. Implementation targets and reconciles
against `release/v0.28.0`.

## Balance knobs

- Mending Waters deposit percentage and Mana efficiency.
- Mending Current duration, tick interval, tick distribution, and maximum-health cap.
- Tidecall direct heal, deposit, charge count, recharge, and Mana cost.
- Lifespring deposit multiplier.
- Cascading Mend consumption multiplier, normal healing, bounce falloff, radius, and target count.
- Pre-pull preparation, overhealing, and multi-Shaman interaction.

## PBE acceptance criteria

- Mending Waters creates and enlarges exactly one visible Mending Current pool per ally.
- Mending Current ticks reduce the same remaining amount that Cascading Mend may consume.
- The instant action creates or enlarges the pool without exceeding its cap.
- Cascading Mend consumes the pool on every ally it reaches, not only its initial target.
- Every consumed pool grants exactly the configured immediate multiplier once.
- Allies without a pool receive canonical Cascading Mend behavior.
- One Shaman cannot consume another Shaman's pools.
- Invalid casts, death, respec, disconnect, and reconnect cannot duplicate or strand healing.
- The loop remains effective with one injured ally and without offensive spellcasting.
- Mobile and reduced-motion players can read pool size, Mending Current readiness, and consumption.
- PBE validates Mana efficiency, preloading caps, burst healing, overhealing risk, host parity, and
  PvP survivability.
