# Courier simulation

The courier owns bounded personal-bank transport state on PlayerMeta. The public
surface is index.ts. Actions select whole stacks by exact canonical identity;
they never accept item grants from a client. Flight uses fixed simulation time
and visits one nearest static banker anchor. courierLegPlan(distance) fixes each
leg: run, hops, takeoff, cruise, descent and skid, at most 300 ticks (fifteen
seconds); long routes cruise faster rather than run late. Saved travelTicks,
legDistance and legStartX/Z preserve the remaining duration on reconnect; old saves
restart from the saved position. The return target is a point just in front of
the current owner and follows them without extending its deadline. Death and
private instances pause return travel. travelTicks plus legTicks (derived, wired
separately) drive the renderer's hop, lift and skid schedule (courierLegSegmentAt);
travelDistance remains for older pose readers. No RNG, pathfinding or realm scan.

A ready courier walks to courierFollowPoint (left of and behind the owner). An
empty dispatch request dismisses a ready, empty courier and needs no membership.

Cargo is owned inventory in CharacterState. Logout freezes it; expiry prevents
new dispatches but does not destroy or strand existing deliveries. Loads refuse
oversized custody rather than truncate items. Existing container movement owns
bank capacity, instance payloads and material provenance. Returning cargo goes
into bag overflow when full, then the courier state is cleared until summoned.
The host exchange callback
must reserve audit admission before either bank mutation and record both phases.

Wire readers gate heavy snapshots by courier revision and bank revision while
ready; position is a separate scalar projection. Tests live in courier.test.ts.
