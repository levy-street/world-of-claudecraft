# Unreleased

- Backgrounded movement v2 sessions stop accruing playtime and daily-reward activity after
  their consumed input frames become stale.
- Native shells (iOS and Android) apply an auto-downloaded OTA bundle the moment the
  updater stages it instead of reloading the stale bundle on download completion, and
  pick up a bundle staged before the app's JavaScript booted, so a player no longer
  meets the "Game and server versions are incompatible" screen until they force-quit.
