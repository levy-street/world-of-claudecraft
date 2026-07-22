# Vespers: Effigy, Echo, and Tithefiend Design

Status: owner design direction, pre-approval and pre-implementation
Owner: Ryze
Target: `release/v0.28.0`, PBE Wave B
Parent design: [Priest v0.28.0 Class Design](priest-v028-class-design.md)

## Specialization gate

Effigy, Gloomtithe, Tithefiend, and the Vespers echo riders belong only to Vespers. Selecting
Doctrine or Benison removes every link, bank, guardian, and exclusive action before the new
specialization kit is resolved.

## Outcome

Vespers binds one enemy as a voodoo Effigy, spreads decay across other enemies, and makes the
Effigy's suffering echo through those links. The pain builds Gloomtithe, which is spent to manifest
a temporary Tithefiend for pressure and Mana recovery.

The combat identity is: bind one victim, spread its suffering, then manifest the accumulated pain
as a shade.

## Priest class symmetry

- Doctrine links an enemy's damage to one protected ally for healing.
- Benison answers several allies directly through large prayers.
- Vespers links one enemy's suffering to other enemies for damage.

Vespers therefore shares the Priest's spiritual-link vocabulary without becoming a second healing
specialization.

## Design goals

- Make sympathetic voodoo magic more important than generic damage-over-time maintenance.
- Give the player one primary enemy link and one visible five-stack payoff bank.
- Turn single-target pressure into controlled multi-target echoes without rapid target switching.
- Keep Tithefiend autonomous and temporary, with no pet bar or commands.
- Preserve Mana as the only resource bar.
- Distinguish Vespers from Warlock curses, demons, and broad passive damage-over-time pressure.

## Non-goals

- Corpse raising, skeletons, or a necromancer army.
- Fel demons, permanent pets, or Warlock-style demon control.
- Several Effigies or Gloomtithe banks before capstone modification.
- Ground-marker spam or narrow facing requirements.
- Echoes that recursively trigger more echoes, decay ticks, or procs.
- A short bank timer that punishes movement or target loss.

## Required kit

| Action or state | Starting PBE behavior |
|---|---|
| Dirge of Decay | Canonical Shadow damage-over-time action. Marks enemies as eligible echo links. |
| Mindfracture | Direct mind attack. On a Dirge-afflicted target, establishes or moves the primary Effigy and adds Gloomtithe. |
| Litany of Woe | Existing channel or repeated Shadow pressure. Extends the single-target decay loop without creating another bank. |
| Effigy | One enemy link per Priest, shown as an attached spectral doll, mask, or woven binding. |
| Gloomtithe | Five-stack Priest aura built from Effigy decay ticks and Mindfracture. It is not a resource bar. |
| Tithefiend | One autonomous temporary guardian. Consumes Gloomtithe, attacks the Effigy, echoes suffering, and returns Mana. |
| Gloamveil | Canonical Shadow form and mastery presentation. |

Existing spell ranks, costs, ranges, and baseline effects on `release/v0.28.0` remain canonical
unless the approved Vespers PRD explicitly changes them.

## Effigy contract

- Vespers may have one primary Effigy before capstone modification.
- Mindfracture establishes the Effigy only when its target carries the Priest's Dirge of Decay.
- Mindfracture on another valid hexed target moves the Effigy after the impact succeeds.
- Failed, missed, cancelled, or invalid actions do not create or move the link.
- The Effigy is an attached state and visual, not an entity with health, collision, or AI.
- The target frame, world presentation, and aura state identify the primary victim clearly.

When the Effigy dies, the link transfers to another enemy carrying the Priest's Dirge. Selection is
deterministic under the shared target-ordering rules. If no eligible target exists, the link clears
and Gloomtithe receives a generous grace period so ordinary target death does not erase the bank
immediately.

## Suffering-echo contract

- Mindfracture and Tithefiend strikes against the Effigy are the starting echo triggers.
- Each eligible hit echoes 30% of its final damage to up to three other enemies carrying the
  Priest's Dirge of Decay.
- The Effigy remains the full-damage primary target.
- Echo targets are selected deterministically.
- An echo is secondary damage and cannot trigger another echo, Gloomtithe, Tithefiend effect, or
  owner proc unless an approved talent explicitly says so.
- Dirge ticks do not echo by default. They establish links and build Gloomtithe on the Effigy.

This preserves a clear single-target rotation while making prior hex placement matter against a
group.

## Gloomtithe contract

- Each Dirge of Decay tick on the Effigy grants one Gloomtithe stack.
- A successful Mindfracture against the Effigy grants one stack.
- The bank holds up to five stacks and uses a Priest aura rather than another resource bar.
- The bank has no short expiry while an eligible Effigy exists.
- At five stacks, Tithefiend receives a persistent action glow.
- Overflow cannot create hidden stacks or delayed procs.

Exact tick eligibility and duplicate-event suppression require deterministic tests before PBE.

## Tithefiend contract

- Summon Tithefiend consumes all current Gloomtithe after a valid summon succeeds.
- More stacks produce a longer-lived or harder-hitting fiend under a monotonic tuning table.
- The fiend attacks the Effigy, or a deterministic eligible fallback if the Effigy becomes invalid.
- Each fiend strike returns a small amount of Mana and creates a smaller suffering echo.
- The fiend is fire-and-forget. It has no action bar, commands, persistence, or player-controlled
  movement.
- The summon uses the approved shared guardian primitive rather than the Hunter pet system.
- Expiry, death, respec, disconnect, and target loss clean up the guardian and its visual state.

The starting PBE decision is whether to summon early for immediate Mana and pressure or wait for a
five-stack manifestation.

## Visual language

- Spectral dolls, woven bindings, ritual masks, pins, smoke, and shadow creatures.
- The Effigy is attached above or around its target and never requires a ground marker.
- Dirge-linked secondary enemies receive a smaller matching thread or sigil.
- Gloomtithe uses five persistent aura stages and a full-bank Tithefiend glow.
- Reduced-motion mode retains static Effigy, link, stack, and summon-ready markers.
- Color is never the only distinction between primary Effigy and secondary links.

## Mobile contract

- Mindfracture establishes or moves the Effigy through ordinary enemy targeting.
- Echoes find linked targets automatically and deterministically.
- The bank has a generous duration and no sub-second reaction requirement.
- Tithefiend is one tap and requires no follow-up pet input.
- The required rotation uses no precision ground placement.

## Dependencies

- Canonical Dirge of Decay, Mindfracture, Litany of Woe, and Gloamveil behavior.
- Owner-scoped Effigy and Dirge-link state in offline, online, and headless simulation.
- Deterministic echo selection and non-recursive secondary-damage rules.
- The approved guardian-summon primitive for Tithefiend.
- Tier-independent target, aura, action-bar, link, and guardian cues.

PR #1980 remains source material for decay, Gloomtithe, and shared proc or bank primitives. The
current implementation target is `release/v0.28.0`, which remains canonical.

## Balance knobs

- Effigy transfer rules and target cap.
- Echo percentage, eligible triggers, and maximum linked enemies.
- Gloomtithe maximum, build rate, and grace duration after target loss.
- Tithefiend damage, duration, attack cadence, echo strength, and Mana return.
- Dirge duration, spread pressure, and multi-target setup cost.

## PBE acceptance criteria

- The player can identify the Effigy, linked enemies, Gloomtithe count, and summon readiness without
  combat logs.
- Exactly one Effigy exists before capstone modification.
- Invalid actions cannot establish, move, or duplicate the Effigy.
- Echoes select targets deterministically and never recurse.
- Target death transfers the Effigy predictably or preserves the bank through its grace period.
- Tithefiend consumes the intended bank once and requires no pet controls.
- Guardian expiry, death, respec, disconnect, and reconnect cannot strand state.
- Mobile and reduced-motion players retain every actionable cue.
- PBE validates single-target damage, linked-target scaling, Mana return, burst, host parity, and
  PvP counterplay.
