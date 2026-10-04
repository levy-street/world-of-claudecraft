import { TurretOwnShotLedger } from './turret_own_shot_core';

/**
 * The page's one own-shot ledger: the seat HUD's aim marks a shot on the click, the
 * render and the fire sound play it and latch its `fired` entry. They are built by
 * different coordinators with no handle in common, and a page seats one player.
 */
export const turretOwnShots = new TurretOwnShotLedger();
