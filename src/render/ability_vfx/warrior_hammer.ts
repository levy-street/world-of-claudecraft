import { WARRIOR_CONTROL_AUDIO } from '../../warrior_control_audio';
import type { AbilityVfxRibbons } from './ribbons';
import type { SequencerHost } from './sequencer';
import { warriorCrushContact } from './warrior_crush_contact';
import { warriorImpactFan } from './warrior_impact_fan';

const source = { x: 0, y: 0, z: 0 };
const target = { x: 0, y: 0, z: 0 };
const impact = { x: 0, y: 0, z: 0 };

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
  ribbons.spawnTrailStyled(casterId, targetId, 0x78cce9, 0.32, {
    speed: 26,
    style: 'warHammer',
    // Compensate for the painter's atlas gutter, retaining the visible size.
    headSize: 2.1 * (70 / 64),
    coreHex: 0xe4f2ff,
    accentHex: 0x81cce1,
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

/** A blunt surface collision, with a short compression catch and directional
 * metal splinters. No blood, floating dust body or second caster animation. */
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
  let primitives = 1;
  impact.x = at.x;
  impact.y = at.y;
  impact.z = at.z;
  if (outcome === 1) {
    primitives = warriorCrushContact(
      host,
      targetId,
      at,
      0.68,
      direction,
      10.2,
      tier,
      impact,
      0.085,
      1.3,
      'warrior_storm_flash',
    );
    if (
      host.bakedAt?.(
        'warrior_crush',
        impact.x,
        impact.y,
        impact.z,
        16.4,
        0x8ed7ef,
        0xe4f7ff,
        0.26,
        0,
        0,
        direction,
        false,
        0.08,
        1.75,
      ) !== false &&
      host.bakedAt
    )
      primitives++;
    primitives += warriorImpactFan(host, impact, direction, 0.08, 3.8, 0x74b9d9);
    host.fragmentsAt?.(
      'metal_splinter',
      impact.x,
      impact.y,
      impact.z,
      0xc8d5df,
      tier === 0 ? 14 : 6,
      1.6,
      dx,
      dz,
      0.3,
      true,
    );
    host.contact?.(casterId, targetId, 'physical-crush', 1.85, 'storm_bolt', 0);
    host.shakeAt(impact.x, impact.y, impact.z, 0.32, true);
    primitives++;
  } else host.flipbookAt(at.x, at.y, at.z, 3.1, 0xd2e6f5, 'contact_crush', 1.35, 0.12);
  if (tier === 0)
    host.burstAt(impact.x, impact.y, impact.z, 0xe1ebf2, 16, 0.95, 'sparks', 0.13, 0.018);
  if (outcome === 1 && playAudio)
    host.abilityAudio?.('impact', 'physical', 0.95, impact.x, impact.y, impact.z, {
      lite: tier > 0,
      abilityId: 'storm_bolt',
      sample: WARRIOR_CONTROL_AUDIO.storm_bolt.impacts[0],
    });
  host.pulseLight(targetId, 'frost', outcome === 1 ? 3.6 : 0.85, outcome === 1 ? 0.18 : 0.055, 6);
  host.countPrimitive('storm_bolt', primitives + (tier === 0 ? 1 : 0));
  return true;
}
