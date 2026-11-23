# Unreleased

- Materials Vault: ten upgrades instead of five, each adding 100 per material (up to
  1000), priced 2g, 4g, 7g, 12g, 20g, 32g, 50g, 75g, 110g, 160g (472g total). Existing
  upgrades keep their count, so a vault with five upgrades now holds 500 of each material.
- Bank bag sockets now cost 75g, 100g, 125g, 150g (was 100g, 200g, 350g, 500g).
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
- Buddies are managed through Cosmetics, with no whistles or other companion items.
  Tug, the Warhorse unlocks directly for 10,000 Honor at either Warfare quartermaster.
  Crystal Lich and Forgemaw remain boss rewards; Flicker and Glimmer remain the reward
  for five completed referrals. Sapling and the other retired companions are unavailable.
  Dismissing a companion in Cosmetics now keeps it dismissed after logging back in.
