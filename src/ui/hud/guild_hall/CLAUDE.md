# Lantern Hall's guild window

The window the Highwatch adventurers' guild residents open (`src/sim/highwatch_guild.ts` emits
`guildHallOpen` with the resident's tab). Two tabs: the week's three dungeon contracts
(`src/sim/guild_contracts.ts`) and the quartermaster's cosmetics for Lantern Seals
(`src/sim/guild_quartermaster.ts`): title feats, account-wide weapon appearances and the
Lantern Hall Destrier's reins.

- `guild_hall_view.ts` is the pure view core for the window and the contract board: every
  string through `t()`, numbers through `formatNumber`, the reset countdown through
  `formatList` of Intl unit words. Each notice carries its boss's portrait URL (the dungeon
  finder's prerendered stills, `FINDER_PORTRAIT_DIR`), the week's counter (a contract pays
  once a week, so it is out of one) and the reward line; the board carries the week's tally.
- `guild_quartermaster_view.ts` is the pure view core for the counter: the stock as item cards
  (the art by name: a title's Book of Deeds crest id, the reins' item id, the appearance's
  Armory skin id; price; owned / ready / short, read from the deeds, the held mounts and the
  account's skin ledger), the selected card's detail (its `stage`: a title's nameplate split
  by `titledNameDecoration`, or the 3D subject for the horse or an appearance; the summary,
  the price against the bags, the buy action and why it is disabled) and each card's hover
  lines. A title never gets a model or a GL context.
- `guild_offer_stage_controller.ts` is the live 3D stage for the horse and the appearances. It builds no
  renderer: an appearance mounts Hud's ONE shared character turntable through the injected
  `tryOnWeaponSkin` (Hud.mountCharPreview with a try-on skin, the subject built by
  `src/ui/self_preview_subject.ts`), and the horse mounts the mount-skin inspect rig
  (`render/mount_preview.ts`), built when the horse is staged and disposed the moment it is
  not (another card, the contracts tab, the window closed).
- Both cores are tested directly by `tests/guild_hall_view.test.ts` and registered in
  `UI_PURE_CORES` (`tests/architecture.test.ts`).
- `guild_hall_window.ts` is the thin painter (the weekly emissary window's shape): open,
  close, focus return, the tab switch, the selected stock card, a signature-gated slow-band
  repaint plus a minute tick for the clock, the hover cards through the injected
  `attachTooltip` (Hud's shared tooltip), and the buy click through `IWorld.buyGuildCosmetic`.
  It resolves the art the cores name (`iconDataUrl` for a crest, `itemImageUrl` for the seal
  and the reins, `armorySkinArt` for an appearance) and drops the stage into the detail's
  `[data-gh-stage-slot]` after each rebuild.
- Styles live in `src/styles/components.css` under `#guild-hall-window` (the
  `lantern hall guild window` banner), every color a `--gh-*` token in `tokens.css`; the
  phone's compact board is in `hud.mobile.css` beside the weekly window's rules. The root
  element is in `index.html` and `play.html`.
- Reads the world only through IWorld members (`guildContracts`, `inventory`, `deedsEarned`,
  `ownedMounts`, `accountCosmetics`, `weeklyQuestResetAtMs`, `player`). Never imports the Hud
  class.
