# Unreleased

- Backgrounded movement v2 sessions stop accruing playtime and daily-reward activity after
  their consumed input frames become stale.
- Clients that never offered movement wire v2 are refused at the world handshake with the
  standard "Game and server versions are incompatible" message; update the client to
  reconnect. Clients from 0.41.x keep working: they already offer the capability, and the
  `hello` frame still echoes the negotiated version they pick their send path from.
