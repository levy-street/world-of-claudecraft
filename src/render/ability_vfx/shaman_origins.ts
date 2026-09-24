interface Point {
  x: number;
  y: number;
  z: number;
}
interface OriginHost {
  anchorOf(id: number, height: number, out: Point): Point | null;
  handPoint?(id: number, hand: 0 | 1, out: Point): Point | null;
  weaponPoint?(id: number, hand: 0 | 1, out: Point): boolean;
  isWeaponHand?(id: number, hand: 0 | 1): boolean;
  groundYAt(x: number, z: number): number;
  facingAt?(id: number): number | null;
}

type OriginKind = 'hand' | 'weapon' | 'ground' | 'body';
const ORIGINS: Readonly<Record<string, OriginKind>> = {
  lightning_bolt: 'hand',
  chain_lightning: 'hand',
  flame_shock: 'hand',
  frost_shock: 'hand',
  healing_wave: 'hand',
  chain_heal: 'hand',
  tidecall: 'hand',
  earth_shock: 'ground',
  earthbind: 'ground',
  earthquake: 'ground',
  stoneward: 'ground',
  stormstrike: 'weapon',
  stormstrike_earth: 'weapon',
  stormstrike_wind: 'weapon',
  rockbiter_weapon: 'weapon',
  flametongue_weapon: 'weapon',
  galeheart_weapon: 'weapon',
  lifespring_weapon: 'weapon',
  unleash_weapon: 'weapon',
  unleash_weapon_fire: 'weapon',
  unleash_weapon_earth: 'weapon',
  unleash_weapon_wind: 'weapon',
  unleash_weapon_water: 'weapon',
  lightning_shield: 'body',
  elemental_mastery: 'body',
  elemental_trance: 'body',
  bloodlust: 'body',
  ghost_wolf: 'ground',
  ancestor_return: 'ground',
  primal_exaltation: 'body',
  primal_exaltation_storm: 'body',
  primal_exaltation_earth: 'body',
  primal_exaltation_fire: 'body',
  primal_exaltation_wind: 'body',
  primal_exaltation_water: 'body',
};

export function shamanOriginKind(abilityId: string): OriginKind | null {
  return Object.hasOwn(ORIGINS, abilityId) ? ORIGINS[abilityId] : null;
}

/** Writes caller-owned scratch. Relay ownership is explicit: another Shaman
 * recipient is still a struck body, never a second spellcaster. */
export function sampleShamanOrigin(
  host: OriginHost,
  abilityId: string,
  sourceId: number,
  out: Point,
  relay = false,
): boolean {
  const kind = shamanOriginKind(abilityId);
  if (!kind) return false;
  if (relay || kind === 'body') return host.anchorOf(sourceId, 0.5, out) !== null;
  if (kind === 'ground') {
    if (!host.anchorOf(sourceId, 0, out)) return false;
    out.y = host.groundYAt(out.x, out.z) + 0.04;
    return true;
  }
  if (kind === 'weapon' && host.isWeaponHand?.(sourceId, 0) && host.weaponPoint?.(sourceId, 0, out))
    return true;
  if (host.handPoint?.(sourceId, 0, out) || host.handPoint?.(sourceId, 1, out)) return true;
  // A rig without hand bones still gets a low, visibly lateral release.
  // Never silently restore the legacy .62 torso/head projectile origin.
  if (!host.anchorOf(sourceId, 0.33, out)) return false;
  const yaw = host.facingAt?.(sourceId) ?? 0;
  out.x += Math.cos(yaw) * 0.42 + Math.sin(yaw) * 0.18;
  out.z += -Math.sin(yaw) * 0.42 + Math.cos(yaw) * 0.18;
  return true;
}
