# Cosmetics Window and Mount Skins

Status: shipping in v0.42.0. Owner spec captured 2026-09-03 (the store sells mounts as
account-wide skins, never as mount items; players equip cosmetics from one screen).

## Why

Every cosmetic the game sells or awards is account state at the point of sale (the
Season 1 Armory weapon skins, the Combat Mech chromas), but each one was equipped from a
different corner of the interface: weapon skins from an inspect overlay inside the store,
mech chromas from a swatch row on the character sheet, and the first paid mount (the
Cluckwork Mech Bird, PR 3464) arrived as a soulbound reins ITEM materialised into each
character's bags, which made it neither clearly account-wide nor visibly a cosmetic. The
v0.42.0 store adds more paid mounts. Selling those as mount items would keep growing the
reins-in-bags grant path and the Reliquary's mount shelf for content real money buys.

The Cosmetics window is the one place a player manages what their account owns and what
this character wears, and mount SKINS are the model every paid mount uses from now on.

## What ships

### Mount skins (`src/sim/content/mount_skins.ts`)

- A mount skin is a look worn OVER whatever mount the character rides. The ridden mount
  (`Entity.mountKey`, still a reins item the character owns) keeps every gameplay number:
  speed, the melee block, the crit hook. The skin decides only which mount visual the
  renderer draws and which mount audio set plays. Real money buys a look, never a stat,
  the same line the weapon skins hold.
- Ownership is account-wide: `AccountCosmetics.mountSkinIds`, persisted in the
  rollback-safe `account_mount_cosmetics` row (`server/db.ts`), mirrored from the economy
  service's grant ledger on purchase and on every store open exactly like weapon skins.
- The worn skin is per character: `PlayerMeta.mountSkinId` in the character save,
  mirrored to `Entity.mountSkinId` and the identity wire as `msk`, so every client in
  view draws the skinned mount. The server gates `change_mount_skin` on account ownership
  and clears an unowned saved skin at join.
- The skin id doubles as the economy-service SKU item id with kind `skin`, the same family
  as weapon skins, so `server/claudium.ts` widens one allowlist rather than growing a
  fourth. The service catalog (`catalogs/claudium_catalog.season1.json` in the companion
  repo) needs a matching row before Buy lights up; until then the store card renders
  unavailable, the documented two-registry contract in `docs/claudium-store.md`.
- The Cluckwork Mech Bird, Tolliver the Chimeglass and the Bonebound Rickshaw convert from
  catalog mounts to the first three skins. Their reins items, catalog rows, Reliquary
  slots, and the kind `item` store grant path are retired; their GLBs, visual specs
  (`MOUNT_SKIN_VISUAL_SPECS` in `src/render/mount_visuals.ts`), clips, lamps, the
  rickshaw's puller hook, and audio cues stay, now keyed by skin id.
- The renderer resolves the look through one call, `mountVisualSpecFor(mountKey,
  mountSkinId)`, and every mount sound through `mountPresentationKey`. A new skin is a
  VISUALS entry, a `MOUNT_SKIN_VISUAL_SPECS` row, a `MOUNT_SKINS` record, its name and
  description keys, and a service catalog row: never a `MountKey`.

### The Cosmetics window (`src/ui/hud/cosmetics/`)

A window on the shared shell with three tabs on the shared tab-strip family. Every row
carries a scope badge: Account (shared by every character) or Character (this one only).

- **Mounts**: one card per mount skin. Not owned: available in the WOC Store. Owned:
  Wear. Worn on this character: Take off. Wearing goes through
  `IWorldCosmetics.changeMountSkin`.
- **Skins**: the owned Season 1 Armory weapon skins grouped by weapon type, with Apply
  (enabled only while a weapon of that type is equipped, the sim re-validates) and Detach,
  through the existing `changeWeaponSkin`. The loadout stays account-wide, as shipped.
- **Mech**: the owned Combat Mech chromas with Wear and Take off through the existing
  `changeSkin(index, 'mech')` and `unequipMechChroma`. Ownership is account-wide, the worn
  body is per character, as shipped.

Entry points: the character sheet, the HUD menu beside the Reliquary, and a keybind. The
store keeps selling; it does not equip. Buddies are out of scope: the tab id type stays a
closed union of the three tabs so the future tab is a deliberate addition.

### Not in scope

- A Reliquary shelf for mount skins. Account cosmetics do not score Curator rank
  (`docs/design/reliquary.md`), so the converted mounts simply leave the mount shelf.
- Per-mount skin bindings (a skin that only applies to one base mount). One worn skin
  applies to any ridden mount.
- The two further store mounts named for v0.42.0 that are still in review (the Goblin
  Rocket Sled and the Rallycart RXT, PR #3534). Each lands as a mount skin through the
  recipe above once its mount PR merges. The Bonebound Rickshaw, already on the release
  branch, converted in this change.

## Acceptance

- `npx vitest run tests/mount_skins.test.ts tests/cosmetics_view.test.ts
  tests/cosmetics_window.test.ts` green; `tests/world_api_parity.test.ts`,
  `tests/command_schema.test.ts`, `tests/mounts.test.ts`, `tests/reliquary_content.test.ts`
  moved to the new pins; `node scripts/gate_select.mjs` green.
- Riding any owned mount while wearing a skin draws the skin's body for the rider and for
  every other client in view, and `moveSpeedMult` still reads the ridden mount.
- A `change_mount_skin` for an unowned id is a server no-op; an unowned saved skin is
  cleared at join.
- Purchasing a mount skin SKU (kind `skin`) mirrors into `account_mount_cosmetics` and
  the Cosmetics window's Mounts tab shows it owned on every character of the account.
