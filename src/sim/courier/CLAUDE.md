# Courier simulation

The courier owns bounded personal-bank transport state on PlayerMeta. The public
surface is index.ts. Actions select whole stacks by exact canonical identity;
they never accept item grants from a client. Flight uses fixed simulation time
and visits one nearest static banker anchor. No RNG, pathfinding or realm scan.

Cargo is owned inventory in CharacterState. Logout freezes it; expiry prevents
new dispatches but does not destroy or strand existing deliveries. Loads refuse
oversized custody rather than truncate items. Existing container movement owns
capacity, instance payloads and material provenance. The host exchange callback
must reserve audit admission before either bank mutation and record both phases.

Wire readers gate heavy snapshots by courier revision and bank revision while
ready; position is a separate scalar projection. Tests live in courier.test.ts.
