# Authoritative runtime routing

This directory owns the gateway boundary between a network session and an
authoritative simulation runtime.

- The default runtime mode remains `inline` and must preserve existing bytes.
- The gateway owns sockets, character leases, route epochs, and backpressure.
- A runtime owns simulation state and emits only through its assigned route epoch.
- Never split contiguous overworld combat by coordinates.
- Worker isolation is limited to portal-isolated instance claims until a complete
  deterministic live-transfer envelope exists.
- Handoff is prepare, commit, or abort. Source authority remains active until a
  target acknowledges preparation and the gateway commits a newer route epoch.
- Late output from an old epoch is rejected.
- Keep contracts free of WebSocket, database, and concrete GameServer imports.
