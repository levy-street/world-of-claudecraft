# Priest resource HUD

The Shadow charge medallion mounts on the HUD root in an independent class-resource
seat, with a liquid orb and five tithe gems. It reads replicated entity auras and the
current specialization only.
`shadow_charge_view.ts` owns resource visibility and bounded counts in a reused
state object. The painter writes through the shared `PainterHostWriters` facet.
The meter factory owns one-time DOM construction and tooltip registration.

Spendable Gloomtithe and accumulated Tithe Bomb progress are separate meters.
Never hide their counts or readiness through a graphics preset. Labels and
tooltips come from the class-resource composition module's localized callbacks.
