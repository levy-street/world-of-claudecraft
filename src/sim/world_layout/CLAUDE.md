# Shared world layout

Pure spatial composition shared by the server, client and headless simulation.
Gameplay definitions remain authoritative in `sim/content/`. An editor export may
change only the explicitly typed spatial fields here; never spread an editor NPC
or camp record over a game definition.

`building.ts` transforms the canonical building record before a town derives its
colliders, sockets, pads and camera rooms. `compose.ts` applies identity-keyed
layout edits without removing newer gameplay records. The compiler lives in the
editor layer; this directory must not import editor, rendering, filesystem or DOM.

Regression coverage: `tests/world_layout.test.ts`.
