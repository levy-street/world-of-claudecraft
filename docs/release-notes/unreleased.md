# Unreleased

- Backgrounded movement v2 sessions stop accruing playtime and daily-reward activity after
  their consumed input frames become stale.
- Clients that predate movement wire v2 are refused at the world handshake with the
  standard "Game and server versions are incompatible" message; update the client to
  reconnect.
