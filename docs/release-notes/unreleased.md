# Unreleased

- Tank threat: Faithwarden's Oathward now increases threat by 100% (was 40%) and Ironguard's
  Recompense by 110% (was 80%), so raid tanks hold the boss against the current DPS
  packages (live 0.42/0.43 parses: the paladin sat at 234 generated threat/s against the
  warrior's 330; see docs/design/tank-threat-v044.md).
- Backgrounded movement v2 sessions stop accruing playtime and daily-reward activity after
  their consumed input frames become stale.
- Native shells (iOS and Android) apply an auto-downloaded OTA bundle the moment the
  updater stages it instead of reloading the stale bundle on download completion, and
  pick up a bundle staged before the app's JavaScript booted, so a player no longer
  meets the "Game and server versions are incompatible" screen until they force-quit.
