import { warriorControlReleaseSample } from '../../warrior_control_audio';
import { meleeContactHeight, meleeImpactProfile } from '../melee_impact_core';
import { drawDirtToss } from './action_contact';
import { drawBloodhook } from './bloodhook';
import { drawBreachmaker } from './breachmaker';
import { furyBeat } from './fury_choreography';
import { drawIronguard } from './ironguard';
import {
  physicalBeatTime,
  physicalContactSheet,
  physicalPathPoint,
} from './physical_choreography_core';
import { physicalContact } from './physical_contact';
import type { SeqSlot, SequencerHost } from './sequencer';
import { drawReapingArc, drawWarriorAreaContact, isWarriorAreaInstant } from './warrior_area';
import { drawWarriorBlade } from './warrior_blades';
import { drawWarriorControlAttempt, drawWarriorControlSuccess } from './warrior_control';
import { drawFuriousMending } from './warrior_fury_feedback';
import { drawWarriorGoad } from './warrior_goad';
import { drawWarriorGuardCast } from './warrior_guard_cast';
import { drawWarriorGyre } from './warrior_gyre';
import { drawWarriorRushArrival, drawWarriorRushWake } from './warrior_mobility';
import { drawWarriorPowerCast, warriorPowerRelease } from './warrior_power_cast';
import { drawWarriorReadinessCast } from './warrior_readiness_cast';
import { drawWarriorShield } from './warrior_shield';
import { drawWarriorShout } from './warrior_shouts';

const origin = { x: 0, y: 0, z: 0 };
const point = { x: 0, y: 0, z: 0 };
const destination = { x: 0, y: 0, z: 0 };

/** Follow displayed movement; only an actual arrival earns the contact. A
 * stopped, interrupted or vanished charge leaves its wake and ends quietly. */
export function physicalTravel(host: SequencerHost, slot: SeqSlot, dt: number): boolean {
  const from = host.anchorOf(slot.casterId, 0, origin);
  const retreat = slot.spec.physical?.shape === 'retreat';
  const to = retreat ? from : host.anchorOf(slot.targetId, 0, destination);
  if (!from || !to || slot.t > 3.2) {
    slot.active = false;
    return false;
  }
  const moved = Math.hypot(from.x - slot.sourceX, from.z - slot.sourceZ);
  const remaining = Math.hypot(to.x - from.x, to.z - from.z);
  if (Math.hypot(from.x - slot.ix, from.z - slot.iz) < 0.01) slot.afterglowTimer += dt;
  else slot.afterglowTimer = 0;
  slot.ix = from.x;
  slot.iz = from.z;
  if (slot.t > 0.35 && slot.afterglowTimer > 0.25) {
    slot.active = false;
    return false;
  }
  const arrived = retreat
    ? slot.t > 0.3 && moved > 1 && from.y - host.groundYAt(from.x, from.z) < 0.12
    : slot.t > 0.08 && moved > 0.2 && remaining < 2.5;
  if (arrived && slot.abilityId !== 'bloodhook') {
    slot.ix = from.x;
    slot.iy = from.y + 0.25;
    slot.iz = from.z;
    return true;
  }
  // The Studio's anchor-only sync has dt=0. Do not consume the launch before
  // time advances: the initial chain would otherwise collapse inside its owner.
  if (slot.t <= 0) return false;
  slot.dotTimer -= dt;
  if (slot.dotTimer <= 0 && (moved > 0.15 || slot.abilityId === 'bloodhook')) {
    slot.dotTimer = slot.abilityId === 'bloodhook' ? 0.035 : 0.105;
    if (slot.abilityId === 'bloodhook') drawBloodhook(host, slot, from, to);
    const direction = retreat
      ? Math.atan2(from.x - slot.sourceX, from.z - slot.sourceZ)
      : Math.atan2(to.x - from.x, to.z - from.z);
    if (drawWarriorRushWake(host, slot, from, direction)) return false;
    const side = slot.motifLoops++ % 2 ? 0.23 : -0.23;
    const x = from.x + Math.cos(direction) * side;
    const z = from.z - Math.sin(direction) * side;
    host.bakedAt?.(
      'smoke',
      x,
      host.groundYAt(x, z) + 0.15,
      z,
      0.75,
      0x8f8b80,
      0xc2b8a1,
      0.55,
      0,
      0,
      direction,
    );
    host.fragmentsAt?.(
      'stone_chip',
      x,
      from.y + 0.1,
      z,
      0x998d79,
      2,
      0.3,
      -Math.sin(direction),
      -Math.cos(direction),
      0.23,
    );
    host.countPrimitive(slot.abilityId, 2);
  }
  return false;
}

/** Physical effects own their complete visual composition. They reuse the
 * existing ribbon, baked smoke, solid-fragment and particle pools. */
export function physicalRelease(host: SequencerHost, slot: SeqSlot): void {
  if (slot.physicalSecondary) return;
  const p = slot.spec.physical!;
  const at = host.anchorOf(slot.casterId, 0.6, origin);
  if (!at) return;
  warriorPowerRelease(host, slot);
  if (p.weapon !== undefined) {
    const duration = physicalBeatTime(p, p.beats.length - 1) + 0.3;
    if (p.weapon === 'both' || p.weapon === 0)
      host.weaponTrail?.(slot.casterId, 0, slot.accent, p.width * 0.85, duration);
    if (p.weapon === 'both' || p.weapon === 1)
      host.weaponTrail?.(slot.casterId, 1, slot.accent, p.width * 0.75, duration);
  }
  host.presentationMoment?.(slot.abilityId, 'release', slot.casterId);
  host.abilityAudio?.('release', slot.spec.palette, p.weight, at.x, at.y, at.z, {
    lite: slot.tier > 0,
    archetype: slot.spec.archetype,
    abilityId: slot.abilityId,
    sample: warriorControlReleaseSample(slot.abilityId),
  });
}

export function physicalImpact(host: SequencerHost, slot: SeqSlot): void {
  const p = slot.spec.physical!;
  if (slot.abilityId === 'pummel' || slot.abilityId === 'sunder_armor') {
    if (!slot.physicalSecondary) drawWarriorControlAttempt(host, slot, 0);
    if (slot.componentOutcomes === 1)
      drawWarriorControlSuccess(host, slot.abilityId, slot.casterId, slot.targetId, slot.tier);
    slot.lingerUntil = slot.t + 0.23;
    slot.motifLoops = p.beats.length;
    return;
  }
  if (slot.physicalSecondary && isWarriorAreaInstant(slot.abilityId)) {
    const outcome = (slot.componentOutcomes === undefined ? 1 : slot.componentOutcomes & 3) as
      | 0
      | 1
      | 2;
    drawWarriorAreaContact(host, slot.abilityId, slot.casterId, slot.targetId, outcome, slot.tier);
    slot.lingerUntil = slot.t + 0.21;
    slot.motifLoops = p.beats.length;
    return;
  }
  if (slot.physicalSecondary && drawWarriorShout(host, slot, 0)) {
    slot.lingerUntil = slot.t;
    slot.motifLoops = p.beats.length;
    return;
  }
  if (
    slot.physicalSecondary &&
    slot.abilityId !== 'raging_gale' &&
    slot.abilityId !== 'red_harvest'
  ) {
    const outcome = slot.componentOutcomes === undefined ? 1 : slot.componentOutcomes & 3;
    const profile = meleeImpactProfile(slot.abilityId);
    const at = host.anchorOf(
      slot.targetId,
      profile ? meleeContactHeight(profile, 0) : 0.55,
      destination,
    );
    const x = at?.x ?? slot.ix,
      y = at?.y ?? slot.iy,
      z = at?.z ?? slot.iz;
    if (outcome === 2) host.flipbookAt(x, y, z, 2.3, 0xd3e2eb, 'contact_crush', 1.45, 0.2);
    else if (outcome === 1)
      host.burstAt(x, y, z, slot.color, 5, 0.45, p.material === 'blood' ? 'blood' : 'sparks', 0.23);
    if (outcome) host.countPrimitive(slot.abilityId, 1);
    slot.lingerUntil = slot.t + 0.2;
    slot.motifLoops = p.beats.length;
    return;
  }
  slot.lingerUntil = slot.t + physicalBeatTime(p, p.beats.length - 1) + 0.23;
  slot.motifLoops = 1;
  slot.motifTimer = slot.t;
  if (slot.abilityId === 'raging_gale' || slot.abilityId === 'red_harvest') {
    // Keep later contacts on their authored clock even if a frame crosses
    // the first contact late. The native clip and retained audio share it.
    slot.motifTimer = slot.impactAt;
    furyBeat(host, slot, 0);
    return;
  }
  if (slot.abilityId === 'blind') drawDirtToss(host, slot);
  else physicalBeat(host, slot, 0);
  host.presentationMoment?.(slot.abilityId, 'impact', slot.casterId);
  host.abilityAudio?.('impact', slot.spec.palette, p.weight, slot.ix, slot.iy, slot.iz, {
    lite: slot.tier > 0,
    finisher: slot.spec.finisher,
    archetype: slot.spec.archetype,
    abilityId: slot.abilityId,
  });
}

export function physicalFollowThrough(host: SequencerHost, slot: SeqSlot): void {
  const p = slot.spec.physical!;
  while (
    slot.motifLoops < p.beats.length &&
    slot.t >= slot.motifTimer + physicalBeatTime(p, slot.motifLoops)
  ) {
    physicalBeat(host, slot, slot.motifLoops++);
  }
}

function physicalBeat(host: SequencerHost, slot: SeqSlot, beat: number): void {
  if (drawWarriorReadinessCast(host, slot, beat)) return;
  if (drawWarriorControlAttempt(host, slot, beat)) return;
  if (drawWarriorRushArrival(host, slot, beat)) return;
  if (drawFuriousMending(host, slot, beat)) return;
  if (drawWarriorGyre(host, slot, beat)) return;
  if (drawWarriorGoad(host, slot, beat)) return;
  if (drawWarriorPowerCast(host, slot, beat)) return;
  if (drawWarriorGuardCast(host, slot, beat)) return;
  if (drawWarriorShout(host, slot, beat)) return;
  if (furyBeat(host, slot, beat)) return;
  if (drawWarriorShield(host, slot, beat)) return;
  if (drawWarriorBlade(host, slot, beat)) return;
  if (drawReapingArc(host, slot, beat)) return;
  if (drawIronguard(host, slot, beat)) return;
  if (drawBreachmaker(host, slot, beat)) return;
  const authored = slot.spec.physical!;
  const p =
    authored.shape === 'rush' || authored.shape === 'retreat'
      ? {
          ...authored,
          shape: slot.abilityId === 'intervene' ? ('shield' as const) : ('breath' as const),
          reach: 1.6,
          lift: slot.abilityId === 'intervene' ? 0.6 : 0.3,
        }
      : authored;
  const caster = host.anchorOf(slot.casterId, 0, origin);
  if (!caster && p.shape !== 'fault') return;
  const cx = caster?.x ?? slot.ix,
    cy = caster?.y ?? slot.iy,
    cz = caster?.z ?? slot.iz;
  const profile = meleeImpactProfile(slot.abilityId);
  const recipient =
    profile && slot.targetId !== slot.casterId
      ? host.anchorOf(slot.targetId, meleeContactHeight(profile, beat), destination)
      : null;
  if (recipient) {
    slot.ix = recipient.x;
    slot.iz = recipient.z;
  }
  let dx = slot.ix - cx,
    dz = slot.iz - cz;
  const distance = Math.hypot(dx, dz);
  if (distance > 0.1) {
    dx /= distance;
    dz /= distance;
  } else {
    const facing = host.facingAt?.(slot.casterId) ?? 0;
    dx = Math.sin(facing);
    dz = Math.cos(facing);
  }
  const ground = p.shape === 'fault';
  const body =
    p.shape === 'shield' ||
    p.shape === 'parry' ||
    p.shape === 'breath' ||
    p.shape === 'inward' ||
    p.shape === 'restore' ||
    p.shape === 'quiet' ||
    p.shape === 'spin';
  const x = ground || p.anchor === 'target' ? slot.ix : cx;
  const z = ground || p.anchor === 'target' ? slot.iz : cz;
  const y = host.groundYAt(x, z);
  const remaining = 1 + (beat / (p.beats.length + 2)) * 0.3;
  const strands = slot.tier > 0 ? 1 : p.shape === 'quiet' ? 1 : 3;
  let count = 0;
  for (let index = 0; index < strands; index++) {
    // Keep the full bright core when peripheral strips are shed under load.
    const strand = slot.tier > 0 ? 1 : index;
    const color = strand === 1 ? slot.accent : slot.color;
    const thickness = p.width * (strand === 1 ? (ground ? 1 : 3.4) : 0.65) * remaining;
    // Sparse broken ground forks are not a closed AoE boundary. Real gameplay
    // radius telegraphs remain owned by the renderer's event.radius path.
    const turn = ground ? (strand - 1) * 1.35 + beat * 1.17 : 0;
    const fx = dx * Math.cos(turn) + dz * Math.sin(turn);
    const fz = dz * Math.cos(turn) - dx * Math.sin(turn);
    host.pathRibbon(
      color,
      thickness,
      0.23,
      (pts) => {
        for (let j = 0; j < pts.length; j++) {
          if (p.shape === 'dart') {
            const u = j / (pts.length - 1);
            pts[j].set(
              cx + (slot.ix - cx) * u,
              cy + p.lift + (slot.iy - cy - p.lift) * u,
              cz + (slot.iz - cz) * u,
            );
            continue;
          }
          const u = j / (pts.length - 1);
          const sweep = p.shape === 'spin' || p.shape === 'cut' || p.shape === 'reap';
          physicalPathPoint(
            p,
            sweep && strand !== 1 ? 0.15 * strand + u * 0.48 : u,
            beat,
            strand,
            point,
          );
          const px = x + fz * point.x + fx * point.z;
          const pz = z - fx * point.x + fz * point.z;
          pts[j].set(px, ground ? host.groundYAt(px, pz) + 0.045 : y + point.y, pz);
        }
        return pts.length;
      },
      !ground,
    );
    count++;
  }
  // A recovery sweep is not another damage component. Keep its weapon arc,
  // but do not stamp a second wound or replay target hitstop/audio.
  if (profile && beat >= profile.contacts) {
    host.countPrimitive(slot.abilityId, count);
    return;
  }
  const hitX = recipient?.x ?? (body ? cx + dx * 0.5 : slot.ix);
  const hitZ = recipient?.z ?? (body ? cz + dz * 0.5 : slot.iz);
  const gy = host.groundYAt(hitX, hitZ);
  const hitY = recipient?.y ?? (ground ? gy + 0.12 : body ? cy + p.lift : gy + p.lift);
  count += physicalContact(host, slot, beat, hitX, hitY, hitZ);
  if (p.shape === 'fault') {
    const branches = slot.tier > 0 ? 1 : 3;
    for (let branch = 0; branch < branches; branch++) {
      const a = branch * 2.1 + beat * 1.2 + 0.3;
      const r = 0.45 + beat * 0.7 + branch * 0.35;
      const px = hitX + Math.sin(a) * r,
        pz = hitZ + Math.cos(a) * r;
      const h = host.groundYAt(px, pz);
      host.fragmentsAt?.(
        'stone_chip',
        px,
        h + 0.12,
        pz,
        0x8f8070,
        4 + branch,
        p.weight,
        Math.sin(a),
        Math.cos(a),
        0.23,
      );
      host.bakedAt?.(
        'smoke',
        px,
        h + 0.45,
        pz,
        (1.3 + branch * 0.25) * p.weight,
        0x918475,
        0xafa18a,
        0.23,
        branch * 0.025,
        0,
        a,
      );
      host.decalXZ(px, pz, 0.6 + branch * 0.25, 0x625447, 'crack', 0.23);
      count += 3;
    }
  } else if (p.material === 'air') {
    const steps = slot.tier > 0 ? 1 : 3;
    for (let k = 0; k < steps; k++) {
      const travel = 0.6 + k * p.reach * 0.22;
      const side = Math.sin(k * 2.7 + beat) * 0.18;
      const px = cx + dx * travel + dz * side;
      const pz = cz + dz * travel - dx * side;
      const py =
        p.shape === 'rush' ? host.groundYAt(px, pz) + 0.15 : cy + p.lift + k * p.tilt * 0.2;
      host.bakedAt?.(
        'smoke',
        px,
        py,
        pz,
        (0.45 + k * 0.24) * p.weight,
        0x9aa6aa,
        0xd1d5ce,
        0.2,
        k * 0.035,
        0,
        k * 0.7 + beat,
      );
      count++;
    }
  } else if (p.material === 'venom') {
    host.waterVolume?.(
      { x: hitX + 0.15, y: hitY + 0.25, z: hitZ },
      { x: hitX - 0.1, y: Math.max(gy + 0.08, hitY - 0.55), z: hitZ + 0.08 },
      slot.color,
      slot.accent,
      p.shape === 'venom' ? 0.065 : 0.025,
      0.23,
    );
    host.burstAt(hitX, hitY, hitZ, slot.color, Math.round(p.particles ?? 4), 0.23, 'embers', 0.23);
    count += 2;
  } else if (p.shape === 'inward' || p.shape === 'restore') {
    if (p.material === 'stone') {
      host.fragmentsAt?.('stone_chip', cx, cy + 0.3, cz, 0xa69883, 5, 0.45, -dx, -dz, 0.23);
      count++;
    }
    host.glowPulse(slot.casterId, slot.color, 0.25 + p.weight * 0.2, false);
    count++;
  } else if (p.shape !== 'quiet') {
    if (p.material === 'steel' && slot.tier === 0) {
      host.fragmentsAt?.(
        'metal_splinter',
        hitX,
        hitY,
        hitZ,
        0xa8b0ac,
        Math.round(3 + p.weight * 3),
        0.5 + p.weight * 0.4,
        dx,
        dz,
        0.23,
      );
      count++;
    }
    const particles = Math.round((p.particles ?? 8) * (slot.tier > 0 ? 0.5 : 1) * p.weight);
    if (particles > 0) {
      host.burstAt(
        hitX,
        hitY,
        hitZ,
        p.material === 'blood' ? 0x8d1923 : 0xd8bb89,
        particles,
        0.45 + p.weight * 0.2,
        p.material === 'blood' ? 'blood' : 'sparks',
        0.23,
      );
      count++;
    }
    if (p.shape === 'plunge' && slot.tier === 0) {
      host.bakedAt?.(
        'smoke',
        hitX,
        gy + 0.25,
        hitZ,
        1.3 * p.weight,
        0x86796c,
        0xbaa791,
        0.23,
        0.05,
        0,
        p.tilt,
      );
      host.fragmentsAt?.('stone_chip', hitX, gy + 0.08, hitZ, 0x8d7b67, 5, 0.75, dx, dz, 0.23);
      count += 2;
    }
  }
  if (p.weight >= 0.45 && p.shape !== 'quiet') {
    if ((beat > 0 || profile) && slot.targetId !== slot.casterId && slot.abilityId !== 'intervene')
      host.contact?.(
        slot.casterId,
        slot.targetId,
        p.material === 'venom'
          ? 'physical-venom'
          : physicalContactSheet(p) === 'contact_crush'
            ? 'physical-crush'
            : physicalContactSheet(p) === 'contact_pierce'
              ? 'physical-pierce'
              : 'physical',
        Math.max(p.weight, profile?.force ?? 0) * remaining,
        slot.abilityId,
        beat,
      );
    if (slot.targetId !== slot.casterId)
      host.glowPulse(slot.targetId, slot.accent, 0.18 * remaining, false);
    host.pulseLight(slot.targetId, slot.spec.palette, p.weight * 0.85 * remaining, 0.09, 3);
    if (slot.tier === 0) host.shakeAt(hitX, hitY, hitZ, Math.min(0.26, p.weight * 0.12));
    count += 2;
  }
  host.countPrimitive(slot.abilityId, count);
}
