# Priest v0.29.0 Class Design

Status: owner-approved implementation, PBE validation pending
Owner: Ryze
Target: v0.29.0, PBE Wave B

## Purpose

Priest should support three distinct relationships between damage, healing, and spiritual power:

- Doctrine links one protected ally to the Priest's offense, redirecting enemy damage into clean,
  controlled healing.
- Benison answers group damage immediately through the largest direct prayers and visible guardian
  angels.
- Vespers binds enemies through voodoo effigies, making one victim's suffering echo through the
  others before manifesting it as a Tithefiend.

The class should retain a shared vocabulary of prayers, wards, direct healing, fear, and mental
magic while each specialization changes the player's central decision.

## Design principles

### Mobile responsiveness is a hard requirement

- Prefer changing Scouring Hymn, wards, prayers, direct heals, Dirge of Decay, and Mindfracture over
  adding new actions.
- No specialization adds a new resource bar. Doctrine marks, angels, and Gloomtithe use auras and
  character-anchored cues.
- A specialization may add at most one required rotational button beyond its signature and
  selected talent grants.
- Damage-to-healing links, angel protection, and Gloomtithe spending must have generous windows
  and must not demand rapid target switching.
- Every marked ally, armed angel, banked shade, and proc state needs a tier-independent cue that
  remains clear with reduced motion.
- Targeting should favor a selected ally, current enemy, or deterministic fallback. Precise ground
  placement is not part of the required healing rotation.
- The healer must be operable with a small party-frame and action-bar layout on touch devices.

### Class-wide talent rows

- Levels 5, 8, 11, 14, 17, and 20 follow movement, defense, control, kit amplification, major
  cooldown, and capstone themes.
- Every option must benefit Doctrine, Benison, and Vespers.
- Damage-only and healing-only primary effects require explicit cross-role fallbacks.
- The specialization's defining loop belongs in automatic passives, signatures, and masteries.

## Doctrine

### Fantasy

Doctrine prevents damage with wards, then converts offensive pressure into controlled healing.
It is a true damage-and-healing hybrid rather than a conventional healer with a stronger shield.

### Core loop

1. Psalm of Warding places Doctrine on the chosen ally.
2. Scouring Hymn and offensive Scouring Mercy heal the ally carrying Doctrine.
3. If no ally is marked, converted healing goes to the lowest-health eligible ally at reduced
   effectiveness.
4. Scouring Mercy may instead target an ally to provide a direct, clean heal.
5. Direct heals remain available for emergencies and for encounters where no enemy can be safely
   attacked.
6. The major cooldown expands the conversion window or allows more than one marked ally.

### Player decision

The player chooses who receives converted healing and whether the next global is better spent on
damage, another ward, or an immediate direct heal.

### Signature

Scouring Mercy replaces Anointing as Doctrine's signature. The same action damages an enemy or
directly heals an ally. Offensive Scouring Mercy participates in Doctrine conversion, while friendly
Scouring Mercy is the clean-healing fallback. Anointing remains available as shared major-cooldown
design space.

### Guardrails

- Damage healing must not smart-heal the whole party at full value with no targeting decision.
- Converted healing cannot recursively trigger itself.
- A marked ally must be unmistakable on the party frame and character.
- The spec must retain a viable direct-healing fallback when no enemy can be attacked.
- Damage conversion, direct Scouring Mercy healing, and shields must produce separate readable events.

## Benison

### Fantasy

Benison delivers the largest immediate group heals and places guardian angels over selected allies
before danger arrives. Its strength is committing to a visible prayer and seeing the party recover
at once.

### Core loop

1. Solemn Prayer and Urgent Prayer provide large single-target triage.
2. Choirmend is the primary large group cast.
3. Sunburst Canticle provides immediate group recovery while movement prevents a longer prayer.
4. Seraphic Vigil is placed over one selected ally and triggers or amplifies recovery when that
   ally becomes unsafe.
5. Choir of Deliverance is the major group-healing cooldown.

### Player decision

The player chooses whether the group can wait for a large cast, needs Sunburst Canticle immediately, or
requires a Seraphic Vigil on one endangered ally.

### Presentation and implementation boundary

- An angel is a character-anchored aura and VFX, not an autonomous guardian entity.
- The angel must be obvious above the protected ally and on the party frame.
- Limit simultaneous angels so target choice remains meaningful and the screen remains readable.
- Overhealing should not create unlimited stored healing.
- Reduced-motion mode retains a static halo, wings, or other armed-state marker.
- Benison does not build or consume stored healing pools. Its group recovery is immediate and
  distinct from Spiritmend Mending Currents.

## Vespers

### Fantasy

Vespers uses sympathetic voodoo magic. It binds one enemy as an Effigy, layers decay across other
enemies, and makes the Effigy's suffering echo through those links before manifesting the banked
pain as a Tithefiend.

### Core loop

1. Dirge of Decay hexes enemies with a long, visible decay effect.
2. Mindfracture binds one hexed enemy as the primary Effigy.
3. Approved direct mind damage and Tithefiend strikes against the Effigy echo partially to other
   enemies carrying the Priest's Dirge.
4. Effigy decay ticks and Mindfracture build Gloomtithe, up to five aura stacks.
5. Summon Tithefiend consumes Gloomtithe and attacks the Effigy as an autonomous temporary shade.
6. More Gloomtithe produces a stronger or longer-lived fiend, and each fiend strike creates a
   smaller suffering echo and returns some Mana.
7. If the Effigy dies, the link transfers deterministically to another hexed enemy when possible.

### Player decision

The player chooses whether to spread Dirge for group echoes, concentrate on the Effigy, summon the
Tithefiend early for Mana and pressure, or continue banking for a stronger manifestation.

### Visual language

- Effigies, ritual markings, masks, spectral smoke, woven hexes, and shadow creatures.
- Avoid corpse animation, skeleton armies, and other necromancer territory.
- Avoid fel fire, permanent demons, and other Warlock territory.
- The Effigy is an attached spectral doll, mask, or woven binding, not another combat entity.
- Only one primary Effigy and one five-stack Gloomtithe aura are required before capstone changes.
- Gloomtithe and the Tithefiend payoff must remain readable on a small screen.

The detailed Effigy, echo, and Tithefiend proposal lives in
`docs/design/priest-shadow-voodoo.md`.

## Baseline action cleanup

The class rows improve a small baseline kit instead of selling essential utility back to the
player:

- Veilstep is the shared movement action.
- Terror Canticle is the shared area-control action.
- Scouring Mercy is Doctrine's signature, replacing Anointing in the signature slot.
- Choirmend is part of Benison's specialization kit.
- Summon Tithefiend is Vespers' signature payoff.
- Anointing moves to the level 17 major-prayer row.

Scouring Hymn, the direct prayers, Psalm of Warding, Dirge of Decay, Mindfracture, and Litany of
Woe remain the starting shared backbone. The redesigned exclusive kit is:

| Specialization | Exclusive actions and states |
|---|---|
| Doctrine | Scouring Mercy and the Doctrine ally link |
| Benison | Choirmend, Sunburst Canticle, Seraphic Vigil, and attached angel state |
| Vespers | Effigy, Gloomtithe, Tithefiend, Gloamveil, and suffering echoes |

Every specialization action is gated to its owning specialization. Selecting another
specialization, clearing the specialization, or loading a different build removes it from the
known kit and action bar.

## Priest Talents 2.0 grid

These are player-facing names and starting PBE values. Each row offers three different jobs while
adding at most one possible action.

### Level 5: movement

| Choice | Starting effect | Player reason to choose it |
|---|---|---|
| Sheltering Step | Psalm of Warding grants its target 40% movement speed for 3 seconds. | Moves an endangered ally through an action already used for protection. |
| Veil Unbound | Veilstep removes roots and movement slows, then grants 50% movement speed for 3 seconds. | A reliable personal escape. |
| Processional Grace | Veilstep allows the Priest to cast while moving for 4 seconds. | Preserves damage or healing through forced movement. |

This row adds no action. It asks whether movement belongs to the protected ally, the Priest's
escape, or the next casting window.

### Level 8: defense and survivability

| Choice | Starting effect | Player reason to choose it |
|---|---|---|
| Last Prayer | Grants an instant self-heal for 30% of maximum health with a 90-second cooldown. | Direct recovery after a dangerous hit. |
| Shattered Psalm | When Psalm of Warding is fully consumed, it heals its target for 12% of maximum health. | Rewards preparing the correct ally before damage. |
| Wounded Halo | Taking at least 15% of maximum health from one hit creates an absorb equal to 15% of maximum health for 10 seconds. This can occur once every 20 seconds. | Automatic protection against unpredictable burst. |

Last Prayer is the only new action in this row.

### Level 11: crowd control

| Choice | Starting effect | Player reason to choose it |
|---|---|---|
| Hushword | Grants a 30-yard silence for 4 seconds with a 30-second cooldown. | Stops one dangerous cast on demand. |
| Lingering Dread | Terror Canticle's cooldown is reduced by 30%. Enemies remain 50% slowed for 4 seconds after its fear ends. | Controls a group for longer without another action. |
| Binding Psalm | An enemy that fully consumes Psalm of Warding is rooted for 2 seconds. This can affect each enemy once every 12 seconds. | Turns protection into pursuit control. |

Hushword is the only new action in this row.

### Level 14: kit management and amplification

| Choice | Starting effect | Player reason to choose it |
|---|---|---|
| Stilled Mind | Grants a 90-second active. The next Priest spell costs no Mana and cannot be interrupted. | Protects one important cast and creates a visible efficiency window. |
| Measured Faith | Every third Mana-spending Priest spell makes the next Priest spell used within 10 seconds cost 50% less Mana. | A predictable resource rhythm with no new action. |
| Living Covenant | Doctrine conversion restores Psalm of Warding absorb equal to 20% of the converted heal, capped at its original absorb. Benison Choirmend overhealing becomes an absorb capped at 10% of the ally's maximum health. Vespers Mindfracture echoes extend Dirge of Decay on linked secondary enemies by 1 second, up to 6 seconds. | Commits to the selected specialization's central link. |

Stilled Mind is the only new action in this row.

### Level 17: major prayer

The selected choice occupies one major-prayer action slot, so this row always adds exactly one
button rather than three.

| Choice | Starting effect | Player reason to choose it |
|---|---|---|
| Anointing | Anoints the Priest or an ally, increasing damage, healing, and casting speed by 20% for 15 seconds. Proposed 120-second cooldown. | A concentrated throughput window. |
| Martyr's Aegis | Reduces one ally's incoming damage by 40% for 8 seconds. Proposed 120-second cooldown. | Saves one ally from a planned lethal window. |
| Choir of Deliverance | Channels for 6 seconds and heals nearby party members every 2 seconds. Proposed 180-second cooldown. | Answers sustained group damage. |

### Level 20: build-defining capstone

| Choice | Starting effect | Player reason to choose it |
|---|---|---|
| Twin Covenant | Doctrine supports two marked allies at 70% conversion each. Benison gains two Seraphic Vigil charges and may maintain two vigils. Vespers supports two Effigies while retaining one shared Gloomtithe bank. | Expands the number of relationships the specialization manages. |
| Second Verse | Doctrine healing from offensive Scouring Mercy repeats for 40% after 2 seconds. Benison Choirmend and Sunburst Canticle healing repeat for 40%. Vespers eligible Effigy echoes repeat once for 40% after 2 seconds. Repeats cannot trigger further effects. | Adds a delayed second impact to the specialization payoff. |
| Incarnate Spirit | A fully consumed Doctrine shield manifests a spectral Scouring Mercy heal for 40% of the shield. A triggered Benison Seraphic Vigil splashes 40% of its heal to up to three nearby allies. A five-stack Vespers Tithefiend gains 50% damage and duration. | Makes the selected specialization's spiritual manifestation define the build. |

No capstone adds another action or resource bar.

## Relationship to existing work

- Retain Doctrine, Benison, and Vespers as the specialization identities extracted from PR #1980.
- Reuse the approved shared proc, bank, cleanup, observation, and cue primitives.
- Keep Tithefiend dependent on the separate guardian-summon primitive.
- Implement Holy angels as attached aura presentation, not through the guardian system.
- Keep specialization mechanics in the Priest class PR and shared infrastructure in its own PR.

## Acceptance criteria

- Doctrine can heal through damage while retaining a functional no-enemy healing fallback.
- Benison has the strongest immediate group-healing identity and a clear, limited angel decision.
- Vespers has one readable Effigy, linked decay targets, a five-stack Gloomtithe bank, and a
  distinct Tithefiend payoff.
- No shared talent option is dead for a specialization or role.
- The six rows contain exactly 18 choices and add at most one possible action per row.
- Every specialization-only action disappears immediately when its owning specialization is no
  longer selected.
- Required rotations fit a mobile action layout and use generous targeting and reaction windows.
- PBE Wave B validates mana sustainability, shield and angel visibility, damage-healing safety,
  guardian cleanup, and party-frame usability.
