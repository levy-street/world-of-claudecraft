import { ritualPathPoint } from './ritual_choreography_core';
import type { SeqSlot, SequencerHost } from './sequencer';

const source = { x: 0, y: 0, z: 0 },
  point = { x: 0, y: 0, z: 0 };

export function ritualRelease(host: SequencerHost, slot: SeqSlot): void {
  const at = host.anchorOf(slot.casterId, 0.65, source);
  if (!at) return;
  host.glowPulse(slot.casterId, slot.accent, 0.18, false);
  host.presentationMoment?.(slot.abilityId, 'release', slot.casterId);
  host.abilityAudio?.('release', slot.spec.palette, slot.power, at.x, at.y, at.z, {
    lite: slot.tier > 0,
    archetype: slot.spec.archetype,
    abilityId: slot.abilityId,
  });
}
export function ritualImpact(host: SequencerHost, slot: SeqSlot): void {
  const p = slot.spec.ritual!;
  slot.motifLoops = 1;
  slot.motifTimer = slot.t;
  slot.lingerUntil = slot.t + p.beats[p.beats.length - 1] + p.duration;
  ritualBeat(host, slot, 0);
  host.presentationMoment?.(slot.abilityId, 'impact', slot.casterId);
  host.abilityAudio?.('impact', slot.spec.palette, slot.power, slot.ix, slot.iy, slot.iz, {
    lite: slot.tier > 0,
    archetype: slot.spec.archetype,
    abilityId: slot.abilityId,
  });
}
export function ritualFollowThrough(host: SequencerHost, slot: SeqSlot): void {
  const p = slot.spec.ritual!;
  while (slot.motifLoops < p.beats.length && slot.t - slot.motifTimer >= p.beats[slot.motifLoops])
    ritualBeat(host, slot, slot.motifLoops++);
}
function ritualBeat(host: SequencerHost, slot: SeqSlot, beat: number): void {
  const p = slot.spec.ritual!;
  const at = host.anchorOf(slot.casterId, 0, source);
  const x = p.anchor === 'caster' && at ? at.x : slot.ix;
  const z = p.anchor === 'caster' && at ? at.z : slot.iz;
  const gy = host.groundYAt(x, z);
  const y = p.shape === 'trap' ? gy + 0.035 : gy;
  const facing =
    at && Math.hypot(x - at.x, z - at.z) > 0.1
      ? Math.atan2(x - at.x, z - at.z)
      : (host.facingAt?.(slot.casterId) ?? 0);
  const dx = Math.sin(facing),
    dz = Math.cos(facing);
  const authoredStrands =
    p.shape === 'bone' ? 0 : p.shape === 'ward' ? 2 : p.shape === 'feather' ? 3 : p.strands;
  const n = slot.tier > 0 ? Math.min(2, authoredStrands) : authoredStrands;
  let count = 0;
  for (let k = 0; k < n; k++) {
    const tint =
      p.shape === 'ward' || p.shape === 'feather' ? slot.color : k % 2 ? slot.accent : slot.color;
    if (p.shape === 'water') {
      const a = k * 2.39996 + p.twist;
      host.waterVolume?.(
        { x: x + Math.cos(a) * p.radius, y: gy + 0.1, z: z + Math.sin(a) * p.radius },
        { x: x + Math.cos(a) * 0.12, y: gy + p.height * 0.68, z: z + Math.sin(a) * 0.12 },
        tint,
        slot.accent,
        p.width * 2,
        p.duration,
      );
    } else {
      host.pathRibbon(tint, p.width * (k % 2 ? 0.55 : 1), p.duration, (pts) => {
        for (let j = 0; j < pts.length; j++) {
          ritualPathPoint(p, j / (pts.length - 1), k, beat, point);
          const px = x + dz * point.x + dx * point.z,
            pz = z - dx * point.x + dz * point.z;
          pts[j].set(
            px,
            p.shape === 'trap' ? host.groundYAt(px, pz) + 0.035 + point.y : y + point.y,
            pz,
          );
        }
        return pts.length;
      });
    }
    count++;
  }
  if (beat === 0) {
    if (slot.abilityId === 'valkyrs_calling_impact') {
      host.bakedAt?.('smoke', x, gy + 0.4, z, 7.5, 0xe4c79b, 0xfff4d9, 0.55, 0, 0, facing);
      host.fragmentsAt?.('stone_chip', x, gy + 0.15, z, 0xc5b89b, 12, 1.8, dx, dz, 0.55);
      host.shakeAt(x, gy, z, 0.3);
      count += 3;
    }
    if (['bone', 'ward', 'feather', 'growth'].includes(p.shape)) {
      host.crestAt?.(
        x,
        gy,
        z,
        p.radius,
        p.height,
        slot.color,
        slot.accent,
        p.shape === 'growth'
          ? 'nature'
          : p.shape === 'bone'
            ? 'bone'
            : p.shape === 'ward'
              ? 'ward'
              : 'feather',
        facing,
        p.duration,
      );
      count++;
    }
    if (p.shape === 'bone' || p.shape === 'ward' || p.shape === 'trap' || p.shape === 'ash') {
      host.fragmentsAt?.(
        p.shape === 'bone' ? 'metal_splinter' : p.shape === 'trap' ? 'ice_shard' : 'stone_chip',
        x,
        gy + 0.55,
        z,
        slot.color,
        slot.tier > 0 ? 3 : 7,
        slot.power * 0.45,
        dx,
        dz,
        p.duration,
      );
      count++;
    }
    if (p.shape === 'growth' || p.shape === 'feather') {
      host.detailAt?.(
        x,
        gy + 0.7,
        z,
        p.radius * 0.8,
        slot.color,
        slot.accent,
        p.shape === 'growth' ? 'nature' : 'light',
        0,
        p.duration,
      );
      count++;
    }
    if (p.shape === 'ash' || p.shape === 'veil' || p.shape === 'stitch') {
      host.bakedAt?.(
        'smoke',
        x,
        gy + 0.8,
        z,
        p.radius * 1.3,
        slot.color,
        slot.accent,
        p.duration,
        0,
        0,
        p.twist,
      );
      count++;
    }
    host.worldLightAt?.(x, gy + 0.8, z, slot.spec.palette, Math.min(0.8, slot.power * 0.5), 0.2);
    host.glowPulse(p.anchor === 'caster' ? slot.casterId : slot.targetId, slot.accent, 0.2, false);
    count += 2;
  }
  host.countPrimitive(slot.abilityId, count);
}
