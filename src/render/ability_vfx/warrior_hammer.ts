import { WARRIOR_CONTROL_AUDIO } from '../../warrior_control_audio';
import type { AbilityVfxRibbons } from './ribbons';
import type { SequencerHost } from './sequencer';

const source = { x: 0, y: 0, z: 0 };
const target = { x: 0, y: 0, z: 0 };

/** Flight owns the object and wake only. The damage event owns collision,
 * and the existing control painter owns the actual stun duration. */
export function launchWarriorHammer(
  host: SequencerHost,
  ribbons: AbilityVfxRibbons,
  casterId: number,
  targetId: number,
  tier: number,
  playAudio = true,
): void {
  const at = host.anchorOf(casterId, 0.62, source);
  if (!at) return;
  ribbons.spawnTrailStyled(casterId, targetId, 0xa5bfd1, 0.2, {
    speed: 26,
    style: 'warHammer',
    headSize: 1.3,
    coreHex: 0xe4f2ff,
    accentHex: 0xc0a269,
    coils: false,
    jagTrail: false,
    forkEvery: 0,
    tracer: false,
    delay: 0,
    aimX: 0,
    aimY: 0,
    aimZ: 0,
    groundY: null,
  });
  if (playAudio)
    host.abilityAudio?.('release', 'physical', 0.9, at.x, at.y, at.z, {
      lite: tier > 0,
      abilityId: 'storm_bolt',
      sample: WARRIOR_CONTROL_AUDIO.storm_bolt.release,
      archetype: 'bolt',
    });
}

/** A blunt steel collision, with a compressed dark dust body and directional
 * metal splinters. No blood, radial ground ring or second caster animation. */
export function drawWarriorHammerContact(
  host: SequencerHost,
  casterId: number,
  targetId: number,
  outcome: 0 | 1 | 2,
  tier: number,
  playAudio = true,
): boolean {
  if (!outcome || casterId === targetId) return true;
  const at = host.anchorOf(targetId, 0.68, target);
  const from = host.anchorOf(casterId, 0.62, source);
  if (!at || !from) return true;
  const direction = Math.atan2(at.x - from.x, at.z - from.z);
  const dx = Math.sin(direction),
    dz = Math.cos(direction);
  host.flipbookAt(at.x, at.y, at.z, 3.1, 0xd2e6f5, 'contact_crush', 1.35, 0.22);
  if (outcome === 1) {
    host.bakedAt?.('shout_dust', at.x, at.y, at.z, 2.8, 0x576172, 0xc2ac8a, 0.32, 0, 0, direction);
    host.fragmentsAt?.(
      'metal_splinter',
      at.x,
      at.y,
      at.z,
      0xc8bba0,
      tier === 0 ? 14 : 6,
      1.1,
      dx,
      dz,
      0.3,
    );
    host.contact?.(casterId, targetId, 'physical', 0.95, 'storm_bolt', 0);
  }
  if (tier === 0) host.burstAt(at.x, at.y, at.z, 0xf1d29b, 16, 0.95, 'sparks', 0.23);
  if (outcome === 1 && playAudio)
    host.abilityAudio?.('impact', 'physical', 0.95, at.x, at.y, at.z, {
      lite: tier > 0,
      abilityId: 'storm_bolt',
      sample: WARRIOR_CONTROL_AUDIO.storm_bolt.impacts[0],
    });
  host.pulseLight(targetId, 'physical', 0.85, 0.055, 2.5);
  host.countPrimitive('storm_bolt', 1 + (outcome === 1 ? 2 : 0) + (tier === 0 ? 1 : 0));
  return true;
}
