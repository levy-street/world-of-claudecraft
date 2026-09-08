import { type IronguardShape, ironguardPath } from './ironguard_shapes';
import type { SeqSlot, SequencerHost } from './sequencer';

const origin = { x: 0, y: 0, z: 0 },
  point = { x: 0, y: 0, z: 0 };
const COUNTER_SWEEPS = [
  { from: 0, to: 0.25 },
  { from: 0.25, to: 0.5 },
  { from: 0.5, to: 0.75 },
  { from: 0.75, to: 1 },
] as const;

/** The cast owns the full footprint once. Real damage and worn auras own
 * wounds and control; an empty sweep still has a complete performance. */
export function drawIronguard(host: SequencerHost, slot: SeqSlot, beat: number): boolean {
  const id = slot.abilityId;
  if (id !== 'revenge' && id !== 'thunder_clap' && id !== 'faultline') return false;
  if (slot.physicalSecondary || beat > 0) return true;
  const at = host.anchorOf(slot.casterId, 0, origin);
  if (!at) return true;
  const kind: IronguardShape =
    id === 'revenge' ? 'iron_counter' : id === 'thunder_clap' ? 'iron_quake' : 'iron_fault';
  const angle = host.facingAt?.(slot.casterId) ?? 0,
    sin = Math.sin(angle),
    cos = Math.cos(angle);
  const branches = id === 'revenge' ? 4 : id === 'thunder_clap' ? 12 : 7;
  const duration = id === 'revenge' ? 0.3 : id === 'thunder_clap' ? 0.42 : 0.58;
  for (let branch = 0; branch < branches; branch++) {
    // These paths are also the cold/full-pool fallback. Every setting retains
    // the same 8-yard footprint, sampled against the real ground.
    host.pathRibbon(
      id === 'revenge' ? 0xaecbdf : 0x78919b,
      id === 'revenge' ? 0.2 : 0.15,
      duration,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          ironguardPath(kind, branch, i / (points.length - 1), point);
          const x = at.x + point.x * cos + point.z * sin,
            z = at.z + point.z * cos - point.x * sin;
          points[i].set(x, host.groundYAt(x, z) + point.y, z);
        }
        return points.length;
      },
      true,
      null,
      false,
      1,
      id === 'revenge' ? COUNTER_SWEEPS[branch] : null,
    );
    if (slot.tier === 0 && branch % (id === 'thunder_clap' ? 3 : 2) === 0) {
      ironguardPath(kind, branch, 0.7, point);
      const x = at.x + point.x * cos + point.z * sin,
        z = at.z + point.z * cos - point.x * sin;
      const y = host.groundYAt(x, z) + 0.1;
      host.bakedAt?.(
        'shout_dust',
        x,
        y,
        z,
        id === 'faultline' ? 3.7 : 2.9,
        0x78858a,
        0xb9b9ae,
        duration + 0.1,
        0,
        0,
        angle,
      );
      host.fragmentsAt?.(
        id === 'revenge' ? 'metal_splinter' : 'stone_chip',
        x,
        y,
        z,
        0x9eaaa9,
        9,
        1.1,
        x - at.x,
        z - at.z,
        0.32,
      );
    }
  }
  host.crestAt?.(
    at.x,
    host.groundYAt(at.x, at.z),
    at.z,
    1,
    1,
    id === 'thunder_clap' ? 0x716d68 : 0x637d90,
    0xadd3e8,
    kind,
    angle,
    duration,
  );
  if (id !== 'revenge') {
    host.bakedAt?.('shout_dust', at.x, at.y + 0.12, at.z, 3.5, 0x69757c, 0xc5c5b7, 0.38, 0, 0);
    host.flipbookAt(
      at.x,
      at.y + 0.2,
      at.z,
      id === 'faultline' ? 3.6 : 2.8,
      0xc8e2ed,
      'contact_crush',
      1.4,
      0.18,
    );
  }
  host.countPrimitive(id, branches + 1);
  return true;
}
