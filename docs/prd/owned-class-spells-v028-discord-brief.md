# Hunter, Shaman, and Priest direction brief

## Discord message

Quick update on the Hunter, Shaman, and Priest direction after #2163.

#2163 restores the passive power floor. The next phase gives every specialization a clearer identity
and rotation through spec-specific abilities and Talents 2.0, while keeping action counts and targeting
mobile-friendly.

### Hunter

- **Packlord:** command the primary pet to build Focus and Pack Ferocity. As Ferocity rises, the pet
  becomes larger, redder, and visibly harder to control. At three stages, Pack Command changes into
  Unleash Beast. The pet claps and cleaves nearby enemies, enters a short frenzy, then calms and returns
  to zero Ferocity.
- **Coldsight:** create safe firing windows, use movement deliberately, and commit to powerful ranged
  attacks when correctly positioned.
- **Fieldcraft:** a melee-led bleed specialization. Bloodhook carries the Hunter into melee and applies
  a bleed, followed by wound management, traps, explosives, and controlled disengagement.

### Shaman

- **Thundercall:** build Thunder through the normal casting rotation, then spend it on strong elemental
  payoffs.
- **Warspirit:** cycle melee weapon attacks into Galeheart procs. It can adopt Stonebound as an explicit
  off-tank posture with clear damage and mobility tradeoffs.
- **Spiritmend:** Healing Wave creates stored Mending Currents on allies. Tidecall enlarges those currents
  instantly, while Cascading Mend consumes every current it reaches for one large burst of healing.

### Priest

- **Doctrine:** deal damage to produce clean healing for a marked ally while shields stabilize incoming
  pressure. Direct healing remains available when there is no enemy target.
- **Benison:** deliver large group healing and place visible angelic protection over selected allies.
- **Vespers:** bind enemies through an Effigy, spread ritual pressure through the link, build
  Gloomtithe, and spend it on an autonomous spirit.

The talent framework remains:

- Level 5: movement
- Level 8: defense and survivability
- Level 11: crowd control
- Level 14: kit management or amplification
- Level 17: major cooldown or power spike
- Level 20: build-defining capstone

Most talents modify existing actions instead of adding more buttons. The first review should focus on
specialization identity, rotations, spell ownership, utility, and mobile action count. Final values and
proc rates can then be tuned collaboratively through PBE feedback.

There is also a responsive design prototype covering all nine specializations. It lets us step through
their rotations, compare shared and spec-exclusive actions, and inspect all six talent rows. It is a
review tool rather than game code, so the class PRDs remain authoritative.

The implementation should remain split into shared specialization infrastructure followed by separate
Hunter, Shaman, and Priest PRs. Gameplay work begins after approval, rather than expanding #1980 or
#2163 into another combined redesign.

## What Pack Ferocity means

Pack Ferocity is a three-stage, Packlord-only buff and state on the Hunter. It is not another resource
bar and it is not a talent. The active pet reads and visually reflects the Hunter's current stacks.

- A successful Pack Command pet strike grants 20 Focus and one Ferocity stage.
- A missing pet, invalid target, or unsuccessful strike grants no Focus or Ferocity.
- Normal pet attacks may maintain the active window, but they do not build stages automatically.
- The Hunter buff UI shows the authoritative stack count. The pet reinforces it by becoming
  progressively larger and redder.
- At three stages, the existing Pack Command slot changes into Unleash Beast. No extra rotation button
  is added.
- Unleash Beast performs the immediate single-target hit and area clap, starts a short cleaving frenzy,
  and prevents Ferocity from rebuilding during that frenzy.
- When the frenzy ends, the pet returns to its normal size and color and Ferocity resets to zero.

The fixed design contract is that Ferocity builds toward and unlocks Unleash Beast. Whether every stack
also provides a direct pet-damage increase, and the exact strength and duration of that increase, should
remain a PBE tuning decision. In the simulation it should be one authoritative stacked state on the
Hunter. Pet scale, tint, and effects derive from that state so offline and online combat cannot
disagree.

## Responsive prototype access

The prototype is implemented as a standalone static page at:

`prototypes/talents-v028/index.html`

It currently exists only in the local `feature/v028-owned-class-spells` worktree. It has not been
committed, pushed, deployed, or given a public URL yet.

To open it locally from the worktree root:

```sh
open prototypes/talents-v028/index.html
```

No dependency installation or game server is required. Once the design branch is committed and pushed,
another contributor can check out that branch and open the same file. A single clickable link for
Discord will require a static deployment or PR preview as a separate publishing step.

The prototype contains:

- Hunter, Shaman, and Priest class switching
- All nine specialization directions
- Step-through and autoplay rotation explanations
- Shared and specialization-exclusive action lists
- Six talent rows and 54 total talent choices
- Responsive desktop and mobile layouts
