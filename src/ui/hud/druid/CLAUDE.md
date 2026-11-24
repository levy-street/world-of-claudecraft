# Druid resource HUD

The Moonwing Tidewheel strip mounts on the HUD root in an independent class-resource
seat: three Suntide orbs, the window gem, three Moontide orbs, on the warlock resource
strip's footprint (300 by 48). It reads replicated entity auras and the current
specialization only, and shows for a Moongrove druid in Moonwing Form (the only state
in which the sim runs the two banks).
`tide_orbs_view.ts` owns visibility and bounded counts in a reused state object. The
painter writes through the shared `PainterHostWriters` facet. The meter factory owns
one-time DOM construction and tooltip registration.

A filled orb glows in its school's color; a full bank breathes so the payoff reads at
a glance; the gem takes the open window's color and its ring drains with the window.
Never hide counts or the window through a graphics preset: the glow scales with
`--fx-shadow`, the state classes do not.
