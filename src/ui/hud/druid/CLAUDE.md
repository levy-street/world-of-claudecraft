# Druid resource HUD

The Moonwing Tidewheel mounts on the HUD root in an independent class-resource seat,
in the Eclipse layout: the window gem on a 108 by 90 plate (86 by 72 on touch) with
the five Suntide and five Moontide orbs around it (the payoffs are usable from 3; each
point past 3 adds 20% to the strike). It reads replicated entity auras and the current
specialization only, and shows for a Moongrove druid in Moonwing Form (the only state
in which the sim runs the two banks).
`tide_orbs_view.ts` owns visibility and bounded counts in a reused state object. The
painter writes through the shared `PainterHostWriters` facet. The meter factory owns
one-time DOM construction and tooltip registration.

The layout is always horizontal: `tideTopBank` picks the bank on top (the one being
charged, which is the favored spell's school; with no window open, the one charged
last; before any window, the fuller one, Sun on a tie) and `tidePlace` puts it in an
arc of full-size orbs above the gem and the other as five small beads hugging the
gem's lower edge.
The orbs are placed by CSS angle and radius (`--tide-a`, `--tide-r`, `--tide-rr`) around
a center a little below the plate's (`--tide-cy`), so a swap glides each orb between
the two arcs; the gem is the frame's last child, painting over orbs passing behind it.
A filled orb glows in its school's color; a bank at 3 or more breathes so the ready
payoff reads at a glance. The gem shows the spell the open window favors, in that
spell's color, not the window's: Skyfall (moon) during Sunrise, Wildbolt (sun) during
Moonrise; its ring drains with the window.

The meter also owns the screen-edge overlay (`#druid-tide-edge`), in the favored color:
a faint attunement tint while a window is open (fading over its last 2 sec), a faint
flash when a bank reaches 3 and a strong one when it reaches 5 (the
`.druid-tide-edge-max` child). The values were tuned by the owner in a live preview.
It shows only under the `tidewheel-edge-glow` body class (Options > Moonwing Tidewheel
Screen Glow, on by default, mirrored by `game/interface_body_classes.ts`), never in
forced colors, and the flashes are off under reduced motion.
Never hide counts or the window through a graphics preset: the orb glow scales with
`--fx-shadow`, the state classes do not.
