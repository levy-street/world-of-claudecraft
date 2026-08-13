import * as THREE from 'three';
import {
  PALADIN_BASTION_SWEEP_DURATION,
  PALADIN_BASTION_SWEEP_IMPACT_TIME,
} from './characters/paladin_bastion_sweep_clip';
import { SPIN_ATTACK_VISUAL_DURATION } from './characters/weapon_attack_style_core';

export { PALADIN_BASTION_SWEEP_DURATION, PALADIN_BASTION_SWEEP_IMPACT_TIME };

export type PaladinSpellVfxSprite =
  | 'glowSoft'
  | 'glowCore'
  | 'flash'
  | 'sparkle'
  | 'sparkBurst'
  | 'star'
  | 'magicRune'
  | 'trace'
  | 'slash'
  | 'ring';

export interface PaladinSpellVfxParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: number;
  size: number;
  lifetime: number;
  gravity?: number;
  sprite: PaladinSpellVfxSprite;
  rotation?: number;
  tag: string;
}

export type PaladinSpellVfxAnchor = (
  entityId: number,
  heightFraction: number,
) => THREE.Vector3 | null;
export type PaladinSpellVfxEmitter = (particle: PaladinSpellVfxParticle) => void;

export interface HolyShockFxConfig {
  mode: 'heal' | 'damage';
  sourceId: number;
  targetId: number;
  duration?: number;
  scale?: number;
  primaryColor?: number;
  secondaryColor?: number;
}

export interface DawnfallFxConfig {
  casterId: number;
  radius: number;
  duration?: number;
  bladeCount?: number;
  rotationDirection?: 1 | -1;
  impactTime?: number;
  primaryColor?: number;
  secondaryColor?: number;
}

export interface SunwardDiscFxConfig {
  sourceId: number;
  targetId: number;
  hopIndex: number;
  totalHits?: number;
  /** Production waits for the authoritative projectile-arrival event. The
   * standalone preview leaves this false and uses the authored travel time. */
  awaitImpact?: boolean;
}

export interface BastionSweepFxConfig {
  sourceId: number;
  radius: number;
  halfAngle: number;
  facing: number;
}

interface ActiveHolyShock extends Required<HolyShockFxConfig> {
  elapsed: number;
  linkEmitted: boolean;
  impactEmitted: boolean;
  afterglowTimer: number;
}

interface ActiveDawnfall extends Required<DawnfallFxConfig> {
  elapsed: number;
  crescentEmitted: boolean;
  bladesEmitted: boolean;
  impactEmitted: boolean;
  afterglowEmitted: boolean;
}

interface ActiveDawnfallTarget {
  targetId: number;
  elapsed: number;
  impactEmitted: boolean;
}

interface ActiveSunwardDisc {
  sourceId: number;
  targetId: number;
  hopIndex: number;
  totalHits: number;
  origin: THREE.Vector3 | null;
  travelTime: number;
  elapsed: number;
  trailTimer: number;
  launched: boolean;
  impactEmitted: boolean;
  awaitImpact: boolean;
  impactElapsed: number | null;
}

interface ActiveBastionSweep extends BastionSweepFxConfig {
  elapsed: number;
  impactEmitted: boolean;
}

const WHITE_GOLD = 0xffffdf;
const DAWN_GOLD = 0xffd04a;
export const PALADIN_HOLY_SHOCK_DURATION = 0.55;
export const PALADIN_HOLY_SHOCK_LINK_TIME = 0.06;
export const PALADIN_HOLY_SHOCK_IMPACT_TIME = 0.12;
export const PALADIN_DAWNFALL_DURATION = 0.9;
export const PALADIN_DAWNFALL_IMPACT_TIME = 0.34;
export const PALADIN_DAWNFALL_IMPACT_NORMALIZED =
  PALADIN_DAWNFALL_IMPACT_TIME / SPIN_ATTACK_VISUAL_DURATION;
export const PALADIN_SUNWARD_LAUNCH_DELAY = 0.04;
export const PALADIN_SUNWARD_PROJECTILE_SPEED = 26;

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function emit(
  output: PaladinSpellVfxEmitter,
  tag: string,
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  color: number,
  size: number,
  lifetime: number,
  sprite: PaladinSpellVfxSprite,
  gravity = 0,
  rotation = Math.random() * Math.PI * 2,
): void {
  output({
    tag,
    position,
    velocity,
    color,
    size,
    lifetime,
    sprite,
    gravity,
    rotation,
  });
}

function crossed(previous: number, current: number, threshold: number): boolean {
  return previous < threshold && current >= threshold;
}

/**
 * Owns the short render-only timelines for Solar Invocation and Dawnfall.
 * It emits into the shared particle pool, so no per-cast geometry, material,
 * texture, light, or scene node survives after its authored lifetime.
 */
export class PaladinSpellVfxController {
  readonly dawnfallImpactTime = PALADIN_DAWNFALL_IMPACT_TIME;
  readonly dawnfallDuration = PALADIN_DAWNFALL_DURATION;

  private readonly holyShocks: ActiveHolyShock[] = [];
  private readonly dawnfalls: ActiveDawnfall[] = [];
  private readonly dawnfallTargets: ActiveDawnfallTarget[] = [];
  private readonly sunwardDiscs: ActiveSunwardDisc[] = [];
  private readonly bastionSweeps: ActiveBastionSweep[] = [];

  constructor(
    private readonly anchor: PaladinSpellVfxAnchor,
    private readonly output: PaladinSpellVfxEmitter,
  ) {}

  get activeEffectCount(): number {
    return (
      this.holyShocks.length +
      this.dawnfalls.length +
      this.dawnfallTargets.length +
      this.sunwardDiscs.length +
      this.bastionSweeps.length
    );
  }

  holyShock(config: HolyShockFxConfig): void {
    const effect: ActiveHolyShock = {
      ...config,
      duration: config.duration ?? PALADIN_HOLY_SHOCK_DURATION,
      scale: config.scale ?? 1,
      primaryColor: config.primaryColor ?? WHITE_GOLD,
      secondaryColor: config.secondaryColor ?? DAWN_GOLD,
      elapsed: 0,
      linkEmitted: false,
      impactEmitted: false,
      afterglowTimer: 0,
    };
    this.holyShocks.push(effect);
    this.emitHolyCasterFlash(effect);
  }

  dawnfall(config: DawnfallFxConfig): void {
    const effect: ActiveDawnfall = {
      ...config,
      radius: Math.max(0.5, config.radius),
      duration: config.duration ?? PALADIN_DAWNFALL_DURATION,
      bladeCount: Math.max(3, Math.round(config.bladeCount ?? 6)),
      rotationDirection: config.rotationDirection ?? 1,
      impactTime: config.impactTime ?? PALADIN_DAWNFALL_IMPACT_TIME,
      primaryColor: config.primaryColor ?? WHITE_GOLD,
      secondaryColor: config.secondaryColor ?? DAWN_GOLD,
      elapsed: 0,
      crescentEmitted: false,
      bladesEmitted: false,
      impactEmitted: false,
      afterglowEmitted: false,
    };
    this.dawnfalls.push(effect);
    this.emitDawnGather(effect);
  }

  dawnfallTarget(targetId: number): void {
    this.dawnfallTargets.push({ targetId, elapsed: 0, impactEmitted: false });
  }

  sunwardDisc(config: SunwardDiscFxConfig): void {
    const source = this.anchor(config.sourceId, 0.58);
    const target = this.anchor(config.targetId, 0.56);
    const distance =
      source && target ? source.distanceTo(target) : PALADIN_SUNWARD_PROJECTILE_SPEED;
    const effect: ActiveSunwardDisc = {
      sourceId: config.sourceId,
      targetId: config.targetId,
      hopIndex: Math.max(0, Math.round(config.hopIndex)),
      totalHits: Math.max(1, Math.round(config.totalHits ?? 3)),
      origin: source?.clone() ?? null,
      travelTime: Math.max(0.05, distance / PALADIN_SUNWARD_PROJECTILE_SPEED),
      elapsed: 0,
      trailTimer: 0,
      launched: false,
      impactEmitted: false,
      awaitImpact: config.awaitImpact === true,
      impactElapsed: null,
    };
    this.sunwardDiscs.push(effect);
    if (effect.hopIndex === 0) {
      this.emitSunwardFormation(effect);
    } else {
      effect.launched = true;
      this.emitSunwardLaunch(effect);
    }
  }

  sunwardDiscImpact(sourceId: number, targetId: number, hopIndex: number, totalHits = 3): void {
    const effect = [...this.sunwardDiscs]
      .reverse()
      .find(
        (candidate) =>
          candidate.sourceId === sourceId &&
          candidate.targetId === targetId &&
          candidate.hopIndex === hopIndex &&
          !candidate.impactEmitted,
      );
    if (effect) {
      effect.impactEmitted = true;
      effect.impactElapsed = effect.elapsed;
      this.emitSunwardImpact(effect);
      return;
    }
    // A late-joining renderer can miss the launch event but still receives the
    // authoritative impact. Preserve the hit read without inventing a flight.
    this.emitSunwardImpact({
      sourceId,
      targetId,
      hopIndex,
      totalHits,
      origin: null,
      travelTime: 0,
      elapsed: 0,
      trailTimer: 0,
      launched: true,
      impactEmitted: true,
      awaitImpact: true,
      impactElapsed: 0,
    });
  }

  bastionSweep(config: BastionSweepFxConfig): void {
    this.bastionSweeps.push({
      sourceId: config.sourceId,
      radius: Math.max(0.5, config.radius),
      halfAngle: Math.min(Math.PI, Math.max(0.1, config.halfAngle)),
      facing: config.facing,
      elapsed: 0,
      impactEmitted: false,
    });
    this.emitBastionAnticipation(config.sourceId);
  }

  bastionSweepTarget(targetId: number): void {
    this.emitBastionTargetImpact(targetId);
  }

  clear(): void {
    this.holyShocks.length = 0;
    this.dawnfalls.length = 0;
    this.dawnfallTargets.length = 0;
    this.sunwardDiscs.length = 0;
    this.bastionSweeps.length = 0;
  }

  update(dt: number): void {
    const step = Math.max(0, dt);
    for (let index = this.holyShocks.length - 1; index >= 0; index--) {
      const effect = this.holyShocks[index];
      const previous = effect.elapsed;
      effect.elapsed += step;
      if (!effect.linkEmitted && crossed(previous, effect.elapsed, PALADIN_HOLY_SHOCK_LINK_TIME)) {
        effect.linkEmitted = true;
        this.emitHolyLink(effect);
      }
      if (
        !effect.impactEmitted &&
        crossed(previous, effect.elapsed, PALADIN_HOLY_SHOCK_IMPACT_TIME)
      ) {
        effect.impactEmitted = true;
        this.emitHolyImpact(effect);
      }
      if (effect.impactEmitted && effect.elapsed < effect.duration) {
        effect.afterglowTimer += step;
        while (effect.afterglowTimer >= 0.07) {
          effect.afterglowTimer -= 0.07;
          this.emitHolyAfterglow(effect);
        }
      }
      if (effect.elapsed >= effect.duration) this.holyShocks.splice(index, 1);
    }

    for (let index = this.dawnfalls.length - 1; index >= 0; index--) {
      const effect = this.dawnfalls[index];
      const previous = effect.elapsed;
      effect.elapsed += step;
      if (!effect.crescentEmitted && crossed(previous, effect.elapsed, 0.18)) {
        effect.crescentEmitted = true;
        this.emitDawnCrescent(effect);
      }
      if (!effect.bladesEmitted && crossed(previous, effect.elapsed, 0.26)) {
        effect.bladesEmitted = true;
        this.emitDawnBlades(effect);
      }
      if (!effect.impactEmitted && crossed(previous, effect.elapsed, effect.impactTime)) {
        effect.impactEmitted = true;
        this.emitDawnImpact(effect);
      }
      if (!effect.afterglowEmitted && crossed(previous, effect.elapsed, 0.45)) {
        effect.afterglowEmitted = true;
        this.emitDawnAfterglow(effect);
      }
      if (effect.elapsed >= effect.duration) this.dawnfalls.splice(index, 1);
    }

    for (let index = this.dawnfallTargets.length - 1; index >= 0; index--) {
      const effect = this.dawnfallTargets[index];
      const previous = effect.elapsed;
      effect.elapsed += step;
      if (
        !effect.impactEmitted &&
        crossed(previous, effect.elapsed, PALADIN_DAWNFALL_IMPACT_TIME)
      ) {
        effect.impactEmitted = true;
        this.emitDawnTargetImpact(effect.targetId);
      }
      if (effect.elapsed >= 0.62) this.dawnfallTargets.splice(index, 1);
    }

    for (let index = this.sunwardDiscs.length - 1; index >= 0; index--) {
      const effect = this.sunwardDiscs[index];
      const previous = effect.elapsed;
      effect.elapsed += step;
      const launchTime = effect.hopIndex === 0 ? PALADIN_SUNWARD_LAUNCH_DELAY : 0;
      const impactTime = launchTime + effect.travelTime;
      if (!effect.launched && crossed(previous, effect.elapsed, launchTime)) {
        effect.launched = true;
        this.emitSunwardLaunch(effect);
      }
      if (effect.launched && !effect.impactEmitted) {
        effect.trailTimer += step;
        while (effect.trailTimer >= 0.03) {
          effect.trailTimer -= 0.03;
          const progress = Math.min(
            1,
            Math.max(0, (effect.elapsed - launchTime) / effect.travelTime),
          );
          this.emitSunwardFlight(effect, progress);
        }
      }
      if (
        !effect.awaitImpact &&
        !effect.impactEmitted &&
        crossed(previous, effect.elapsed, impactTime)
      ) {
        effect.impactEmitted = true;
        effect.impactElapsed = effect.elapsed;
        this.emitSunwardImpact(effect);
      }
      if (
        (effect.impactElapsed !== null && effect.elapsed >= effect.impactElapsed + 0.2) ||
        (effect.awaitImpact && effect.elapsed >= 3.2)
      ) {
        this.sunwardDiscs.splice(index, 1);
      }
    }

    for (let index = this.bastionSweeps.length - 1; index >= 0; index--) {
      const effect = this.bastionSweeps[index];
      const previous = effect.elapsed;
      effect.elapsed += step;
      if (
        !effect.impactEmitted &&
        crossed(previous, effect.elapsed, PALADIN_BASTION_SWEEP_IMPACT_TIME)
      ) {
        effect.impactEmitted = true;
        this.emitBastionArc(effect);
      }
      if (effect.elapsed >= PALADIN_BASTION_SWEEP_DURATION) {
        this.bastionSweeps.splice(index, 1);
      }
    }
  }

  private emitHolyCasterFlash(effect: ActiveHolyShock): void {
    const source = this.anchor(effect.sourceId, 0.68);
    if (!source) return;
    const hand = source.clone().add(new THREE.Vector3(0.22, 0.05, 0));
    emit(
      this.output,
      'holy-caster-flash',
      hand.clone(),
      new THREE.Vector3(),
      effect.primaryColor,
      0.82 * effect.scale,
      0.11,
      'flash',
    );
    emit(
      this.output,
      'holy-caster-core',
      hand.clone(),
      new THREE.Vector3(),
      effect.primaryColor,
      0.42 * effect.scale,
      0.13,
      'glowCore',
    );
    emit(
      this.output,
      'holy-caster-rune',
      hand.clone().add(new THREE.Vector3(0, 0, -0.08)),
      new THREE.Vector3(),
      effect.secondaryColor,
      0.72 * effect.scale,
      0.1,
      'magicRune',
    );
    for (let index = 0; index < 6; index++) {
      const angle = (index / 6) * Math.PI * 2;
      const radial = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0).multiplyScalar(0.38);
      emit(
        this.output,
        'holy-caster-ray',
        hand.clone().add(radial),
        radial.clone().multiplyScalar(-7),
        index % 2 === 0 ? effect.primaryColor : effect.secondaryColor,
        0.2 * effect.scale,
        0.1,
        'trace',
        0,
        angle,
      );
    }
  }

  private emitHolyLink(effect: ActiveHolyShock): void {
    const source = this.anchor(effect.sourceId, 0.68);
    const target = this.anchor(effect.targetId, 0.56);
    if (!source || !target) return;
    const delta = target.clone().sub(source);
    const horizontalLength = Math.hypot(delta.x, delta.z);
    const side = new THREE.Vector3(-delta.z, 0, delta.x).normalize();
    const steps = Math.min(18, Math.max(9, Math.ceil(horizontalLength / 1.2)));
    for (let index = 0; index <= steps; index++) {
      const progress = index / steps;
      const curve = Math.sin(progress * Math.PI);
      const at = source
        .clone()
        .lerp(target, progress)
        .addScaledVector(side, curve * 0.13 * effect.scale);
      at.y += curve * Math.min(0.55, 0.16 + horizontalLength * 0.025);
      const taper = 1 - progress * 0.35;
      if (index % 2 === 0) {
        emit(
          this.output,
          'holy-link',
          at.clone(),
          delta.clone().normalize().multiplyScalar(0.8),
          effect.secondaryColor,
          0.26 * taper * effect.scale,
          0.14,
          'glowSoft',
        );
      }
      emit(
        this.output,
        'holy-link-core',
        at,
        delta.clone().normalize(),
        effect.primaryColor,
        0.52 * taper * effect.scale,
        0.12,
        'trace',
        0,
        Math.PI * 0.5 + Math.atan2(delta.z, delta.x) * 0.25,
      );
    }
  }

  private emitHolyImpact(effect: ActiveHolyShock): void {
    const target = this.anchor(effect.targetId, 0.62);
    if (!target) return;
    const ground = this.anchor(effect.targetId, 0.08) ?? target;
    const tag = effect.mode === 'heal' ? 'holy-heal-impact' : 'holy-damage-impact';
    emit(
      this.output,
      tag,
      target.clone(),
      new THREE.Vector3(0, 0.2, 0),
      effect.primaryColor,
      (effect.mode === 'damage' ? 2 : 1.7) * effect.scale,
      effect.mode === 'damage' ? 0.2 : 0.24,
      effect.mode === 'damage' ? 'star' : 'flash',
    );
    emit(
      this.output,
      `${tag}-ring`,
      ground.clone().add(new THREE.Vector3(0, 0.03, 0)),
      new THREE.Vector3(0, 0.25, 0),
      effect.secondaryColor,
      1.5 * effect.scale,
      0.32,
      'ring',
    );
    for (let index = 0; index < 7; index++) {
      const height = 0.15 + index * 0.31;
      emit(
        this.output,
        `${tag}-ray`,
        target.clone().add(new THREE.Vector3(0, height, 0)),
        new THREE.Vector3(0, effect.mode === 'damage' ? -3.8 : 0.7, 0),
        index % 3 === 0 ? effect.primaryColor : effect.secondaryColor,
        (0.46 - index * 0.022) * effect.scale,
        0.18,
        index % 2 === 0 ? 'trace' : 'glowCore',
        0,
        0,
      );
    }
    const sparkCount = effect.mode === 'damage' ? 9 : 6;
    for (let index = 0; index < sparkCount; index++) {
      const angle = (index / sparkCount) * Math.PI * 2 + randomBetween(-0.15, 0.15);
      const speed = effect.mode === 'damage' ? randomBetween(3.2, 5.2) : randomBetween(0.6, 1.4);
      emit(
        this.output,
        `${tag}-spark`,
        target.clone().add(new THREE.Vector3(0, randomBetween(-0.1, 0.25), 0)),
        new THREE.Vector3(
          Math.cos(angle) * speed,
          effect.mode === 'damage' ? randomBetween(1.4, 3.4) : randomBetween(1.3, 2.2),
          Math.sin(angle) * speed,
        ),
        index % 3 === 0 ? effect.primaryColor : effect.secondaryColor,
        randomBetween(0.17, 0.28) * effect.scale,
        effect.mode === 'damage' ? 0.3 : 0.4,
        index % 2 === 0 ? 'sparkBurst' : 'sparkle',
        effect.mode === 'damage' ? 5 : 1.4,
      );
    }
    if (effect.mode === 'heal') this.emitHolyHealHalo(effect, target);
    else this.emitHolyDamageCrack(effect, ground);
  }

  private emitHolyHealHalo(effect: ActiveHolyShock, target: THREE.Vector3): void {
    emit(
      this.output,
      'holy-heal-halo',
      target.clone().add(new THREE.Vector3(0, 1.35 * effect.scale, 0)),
      new THREE.Vector3(0, 0.4, 0),
      effect.secondaryColor,
      1 * effect.scale,
      0.38,
      'ring',
    );
    emit(
      this.output,
      'holy-heal-symbol',
      target.clone().add(new THREE.Vector3(0, 0.65, 0)),
      new THREE.Vector3(0, 1.1, 0),
      effect.primaryColor,
      0.9 * effect.scale,
      0.32,
      'magicRune',
    );
  }

  private emitHolyDamageCrack(effect: ActiveHolyShock, target: THREE.Vector3): void {
    for (let index = 0; index < 5; index++) {
      const angle = (index / 5) * Math.PI * 2 + 0.22;
      const distance = 0.22 + (index % 2) * 0.1;
      emit(
        this.output,
        'holy-damage-crack',
        target
          .clone()
          .add(new THREE.Vector3(Math.cos(angle) * distance, 0.03, Math.sin(angle) * distance)),
        new THREE.Vector3(Math.cos(angle) * 0.7, 0.05, Math.sin(angle) * 0.7),
        index % 2 === 0 ? effect.primaryColor : effect.secondaryColor,
        0.5 * effect.scale,
        0.3,
        'slash',
        0,
        angle,
      );
    }
  }

  private emitHolyAfterglow(effect: ActiveHolyShock): void {
    const target = this.anchor(effect.targetId, effect.mode === 'heal' ? 0.32 : 0.42);
    if (!target) return;
    const angle = Math.random() * Math.PI * 2;
    const radius = effect.mode === 'heal' ? 0.34 : 0.48;
    emit(
      this.output,
      effect.mode === 'heal' ? 'holy-heal-afterglow' : 'holy-damage-afterglow',
      target
        .clone()
        .add(
          new THREE.Vector3(
            Math.cos(angle) * radius,
            randomBetween(-0.12, 0.25),
            Math.sin(angle) * radius,
          ),
        ),
      new THREE.Vector3(
        effect.mode === 'damage' ? Math.cos(angle) * 0.8 : 0,
        randomBetween(0.8, 1.6),
        effect.mode === 'damage' ? Math.sin(angle) * 0.8 : 0,
      ),
      Math.random() < 0.35 ? effect.primaryColor : effect.secondaryColor,
      randomBetween(0.12, 0.22) * effect.scale,
      0.28,
      'sparkle',
      0.6,
    );
  }

  private emitDawnGather(effect: ActiveDawnfall): void {
    const origin = this.anchor(effect.casterId, 0.08);
    const weapon = this.anchor(effect.casterId, 0.66);
    if (!origin || !weapon) return;
    emit(
      this.output,
      'dawn-weapon-glow',
      weapon.clone().add(new THREE.Vector3(0.28, 0, 0)),
      new THREE.Vector3(),
      effect.primaryColor,
      0.95,
      0.2,
      'glowCore',
    );
    const runeSegments = 20;
    for (let index = 0; index < runeSegments; index++) {
      const angle = (index / runeSegments) * Math.PI * 2;
      const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      emit(
        this.output,
        'dawn-rune',
        origin.clone().addScaledVector(radial, 0.9),
        radial.clone().multiplyScalar(-1.1),
        index % 4 === 0 ? effect.primaryColor : effect.secondaryColor,
        index % 4 === 0 ? 0.28 : 0.18,
        0.2,
        index % 3 === 0 ? 'magicRune' : 'ring',
        0,
        angle,
      );
    }
    for (let index = 0; index < 7; index++) {
      const angle = (index / 7) * Math.PI * 2 + 0.18;
      const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      emit(
        this.output,
        'dawn-converging-ray',
        weapon.clone().addScaledVector(radial, 0.72),
        radial.clone().multiplyScalar(-4.2),
        index % 2 === 0 ? effect.primaryColor : effect.secondaryColor,
        0.24,
        0.18,
        'trace',
        0,
        angle,
      );
    }
  }

  private emitDawnCrescent(effect: ActiveDawnfall): void {
    const origin = this.anchor(effect.casterId, 0.62);
    if (!origin) return;
    const segmentCount = 30;
    for (let index = 0; index < segmentCount; index++) {
      const progress = index / Math.max(1, segmentCount - 1);
      const angle = effect.rotationDirection * (progress * Math.PI * 1.86 - Math.PI * 0.85);
      const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(
        effect.rotationDirection,
      );
      emit(
        this.output,
        'dawn-crescent',
        origin.clone().addScaledVector(radial, 1.15),
        tangent.multiplyScalar(3.2).addScaledVector(radial, 0.7),
        index % 4 === 0 ? effect.primaryColor : effect.secondaryColor,
        index % 4 === 0 ? 0.82 : 0.62,
        0.28 - progress * 0.08,
        'slash',
        0,
        angle + Math.PI * 0.5,
      );
    }
  }

  private emitDawnBlades(effect: ActiveDawnfall): void {
    const origin = this.anchor(effect.casterId, 0.48);
    if (!origin) return;
    const launchDistance = Math.max(0.2, effect.radius - 0.85);
    for (let index = 0; index < effect.bladeCount; index++) {
      const angle =
        effect.rotationDirection * ((index / effect.bladeCount) * Math.PI * 2 + 0.24) +
        randomBetween(-0.08, 0.08);
      const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(
        effect.rotationDirection * 1.3,
      );
      const position = origin
        .clone()
        .addScaledVector(radial, 0.85)
        .add(new THREE.Vector3(0, (index % 3) * 0.18, 0));
      const velocity = radial
        .clone()
        .multiplyScalar(launchDistance / 0.31)
        .add(tangent)
        .setY(randomBetween(0.15, 0.65));
      for (let layer = 0; layer < 2; layer++) {
        emit(
          this.output,
          'dawn-blade',
          position.clone().addScaledVector(radial, layer * -0.08),
          velocity.clone().multiplyScalar(1 - layer * 0.12),
          layer === 0 ? effect.primaryColor : effect.secondaryColor,
          layer === 0 ? 0.88 : 1.16,
          layer === 0 ? 0.31 : 0.34,
          'slash',
          0.6,
          angle + Math.PI * 0.5,
        );
      }
    }
  }

  private emitDawnImpact(effect: ActiveDawnfall): void {
    const origin = this.anchor(effect.casterId, 0.08);
    if (!origin) return;
    emit(
      this.output,
      'dawn-central-impact',
      origin.clone().add(new THREE.Vector3(0, 0.72, 0)),
      new THREE.Vector3(0, 0.35, 0),
      effect.primaryColor,
      2.4,
      0.22,
      'flash',
    );
    const ringCount = 52;
    const lifetime = 0.24;
    const speed = Math.max(2, (effect.radius - 0.25) / lifetime);
    for (let index = 0; index < ringCount; index++) {
      const angle = (index / ringCount) * Math.PI * 2;
      const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      emit(
        this.output,
        'dawn-shockwave',
        origin.clone().addScaledVector(radial, 0.25),
        radial.clone().multiplyScalar(speed).setY(0.08),
        index % 5 === 0 ? effect.primaryColor : effect.secondaryColor,
        index % 5 === 0 ? 0.5 : 0.34,
        lifetime,
        'trace',
        0,
        angle + Math.PI * 0.5,
      );
    }
    for (let index = 0; index < 10; index++) {
      const angle = (index / 10) * Math.PI * 2;
      const distance = randomBetween(0.35, 1.35);
      emit(
        this.output,
        'dawn-rising-light',
        origin
          .clone()
          .add(new THREE.Vector3(Math.cos(angle) * distance, 0.2, Math.sin(angle) * distance)),
        new THREE.Vector3(Math.cos(angle) * 0.5, randomBetween(2.2, 4), Math.sin(angle) * 0.5),
        index % 3 === 0 ? effect.primaryColor : effect.secondaryColor,
        randomBetween(0.2, 0.34),
        0.34,
        index % 2 === 0 ? 'trace' : 'sparkle',
        1.1,
      );
    }
  }

  private emitDawnAfterglow(effect: ActiveDawnfall): void {
    const origin = this.anchor(effect.casterId, 0.08);
    if (!origin) return;
    const fragments = Math.max(6, effect.bladeCount + 2);
    for (let index = 0; index < fragments; index++) {
      const angle = (index / fragments) * Math.PI * 2 + randomBetween(-0.2, 0.2);
      const distance = randomBetween(0.7, Math.min(effect.radius, 2.8));
      emit(
        this.output,
        'dawn-afterglow',
        origin
          .clone()
          .add(
            new THREE.Vector3(
              Math.cos(angle) * distance,
              randomBetween(0.1, 0.45),
              Math.sin(angle) * distance,
            ),
          ),
        new THREE.Vector3(
          randomBetween(-0.25, 0.25),
          randomBetween(0.8, 1.7),
          randomBetween(-0.25, 0.25),
        ),
        index % 4 === 0 ? effect.primaryColor : effect.secondaryColor,
        randomBetween(0.13, 0.24),
        0.36,
        'sparkle',
        0.7,
      );
    }
    emit(
      this.output,
      'dawn-afterglow-ring',
      origin.clone().add(new THREE.Vector3(0, 0.05, 0)),
      new THREE.Vector3(),
      effect.secondaryColor,
      Math.min(2.4, effect.radius * 0.38),
      0.25,
      'ring',
    );
  }

  private emitDawnTargetImpact(targetId: number): void {
    const target = this.anchor(targetId, 0.62);
    if (!target) return;
    emit(
      this.output,
      'dawn-target-impact',
      target.clone(),
      new THREE.Vector3(0, 0.3, 0),
      WHITE_GOLD,
      1.3,
      0.2,
      'star',
    );
    emit(
      this.output,
      'dawn-target-slash',
      target.clone().add(new THREE.Vector3(0, 0.35, 0)),
      new THREE.Vector3(0, 1.4, 0),
      DAWN_GOLD,
      1,
      0.24,
      'slash',
      0,
      -0.65,
    );
    emit(
      this.output,
      'dawn-target-cross',
      target.clone().add(new THREE.Vector3(0, 0.15, 0)),
      new THREE.Vector3(0, 0.8, 0),
      WHITE_GOLD,
      0.58,
      0.22,
      'magicRune',
    );
  }

  private emitBastionAnticipation(sourceId: number): void {
    const source = this.anchor(sourceId, 0.58);
    if (!source) return;
    for (let index = 0; index < 5; index++) {
      const angle = (index / 5) * Math.PI * 2;
      const radial = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
      emit(
        this.output,
        'bastion-shield-charge',
        source.clone().addScaledVector(radial, 0.42),
        radial.clone().multiplyScalar(-1.2),
        index % 2 === 0 ? WHITE_GOLD : DAWN_GOLD,
        0.22,
        0.18,
        index % 2 === 0 ? 'trace' : 'sparkle',
        0,
        angle,
      );
    }
  }

  private emitBastionArc(effect: ActiveBastionSweep): void {
    const source = this.anchor(effect.sourceId, 0.08);
    if (!source) return;
    const segments = 28;
    for (let index = 0; index < segments; index++) {
      const progress = index / Math.max(1, segments - 1);
      const angle = effect.facing - effect.halfAngle + progress * effect.halfAngle * 2;
      const radial = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
      const tangent = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
      const leading = source
        .clone()
        .addScaledVector(radial, effect.radius)
        .add(new THREE.Vector3(0, 0.62, 0));
      emit(
        this.output,
        'bastion-leading-edge',
        leading,
        tangent
          .clone()
          .multiplyScalar(2.2)
          .add(new THREE.Vector3(0, 0.15, 0)),
        WHITE_GOLD,
        index % 4 === 0 ? 1.34 : 1.08,
        0.22,
        'slash',
        0,
        angle + Math.PI * 0.5,
      );
      emit(
        this.output,
        'bastion-golden-trail',
        source
          .clone()
          .addScaledVector(radial, effect.radius * 0.78)
          .add(new THREE.Vector3(0, 0.54, 0)),
        tangent.clone().multiplyScalar(1.35),
        DAWN_GOLD,
        index % 3 === 0 ? 1.28 : 1.02,
        0.29,
        'glowSoft',
        0,
        angle,
      );
      emit(
        this.output,
        'bastion-radiant-wall',
        source
          .clone()
          .addScaledVector(radial, effect.radius * 0.42)
          .add(new THREE.Vector3(0, 0.58, 0)),
        tangent.clone().multiplyScalar(0.9),
        index % 2 === 0 ? WHITE_GOLD : DAWN_GOLD,
        index % 3 === 0 ? 1.72 : 1.42,
        0.24,
        'glowCore',
        0,
        angle,
      );
      emit(
        this.output,
        'bastion-ground-wave',
        source.clone().addScaledVector(radial, effect.radius * 0.92),
        radial.clone().multiplyScalar(1.8).setY(0.08),
        index % 5 === 0 ? WHITE_GOLD : DAWN_GOLD,
        0.28,
        0.25,
        'trace',
        0,
        angle + Math.PI * 0.5,
      );
      if (index % 4 === 0) {
        emit(
          this.output,
          'bastion-shield-segment',
          source
            .clone()
            .addScaledVector(radial, effect.radius * 0.62)
            .add(new THREE.Vector3(0, 0.68, 0)),
          radial.clone().multiplyScalar(0.7),
          WHITE_GOLD,
          0.68,
          0.24,
          'magicRune',
          0,
          angle,
        );
      }
    }
    emit(
      this.output,
      'bastion-center-rune',
      source
        .clone()
        .add(new THREE.Vector3(Math.sin(effect.facing) * 1.3, 0.72, Math.cos(effect.facing) * 1.3)),
      new THREE.Vector3(0, 0.2, 0),
      WHITE_GOLD,
      1.18,
      0.22,
      'magicRune',
      0,
      effect.facing,
    );
  }

  private emitBastionTargetImpact(targetId: number): void {
    const target = this.anchor(targetId, 0.58);
    if (!target) return;
    emit(
      this.output,
      'bastion-target-flash',
      target.clone(),
      new THREE.Vector3(0, 0.25, 0),
      WHITE_GOLD,
      1.34,
      0.18,
      'flash',
    );
    emit(
      this.output,
      'bastion-target-rune',
      target.clone().add(new THREE.Vector3(0, 0.06, 0)),
      new THREE.Vector3(0, 0.15, 0),
      DAWN_GOLD,
      0.84,
      0.2,
      'magicRune',
    );
    for (let index = 0; index < 6; index++) {
      const angle = (index / 6) * Math.PI * 2;
      emit(
        this.output,
        'bastion-target-spark',
        target.clone(),
        new THREE.Vector3(Math.cos(angle) * 2.2, 1 + (index % 3) * 0.35, Math.sin(angle) * 2.2),
        index % 2 === 0 ? WHITE_GOLD : DAWN_GOLD,
        0.2,
        0.24,
        'sparkle',
        2.2,
        angle,
      );
    }
  }

  private emitSunwardFormation(effect: ActiveSunwardDisc): void {
    const source = effect.origin ?? this.anchor(effect.sourceId, 0.62);
    if (!source) return;
    const shieldArm = source.clone().add(new THREE.Vector3(-0.28, 0.04, 0));
    emit(
      this.output,
      'sunward-caster-sigil',
      shieldArm.clone(),
      new THREE.Vector3(),
      WHITE_GOLD,
      1.15,
      0.16,
      'magicRune',
      0,
      0.2,
    );
    emit(
      this.output,
      'sunward-caster-halo',
      shieldArm.clone(),
      new THREE.Vector3(),
      DAWN_GOLD,
      1.5,
      0.18,
      'ring',
      0,
      -0.25,
    );
    for (let index = 0; index < 6; index++) {
      const angle = (index / 6) * Math.PI * 2;
      const radial = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
      emit(
        this.output,
        'sunward-launch-ray',
        shieldArm.clone().addScaledVector(radial, 0.48),
        radial.clone().multiplyScalar(1.8),
        index % 2 === 0 ? WHITE_GOLD : DAWN_GOLD,
        0.22,
        0.12,
        'trace',
        0,
        angle,
      );
    }
  }

  private emitSunwardLaunch(effect: ActiveSunwardDisc): void {
    const source = effect.origin ?? this.anchor(effect.sourceId, 0.58);
    const target = this.anchor(effect.targetId, 0.56);
    if (!source || !target) return;
    emit(
      this.output,
      'sunward-disc-core',
      source.clone(),
      new THREE.Vector3(),
      WHITE_GOLD,
      1.18,
      0.07,
      'glowCore',
    );
    emit(
      this.output,
      'sunward-disc-halo',
      source.clone(),
      new THREE.Vector3(),
      DAWN_GOLD,
      1.92,
      0.07,
      'ring',
      0,
      effect.hopIndex * 0.85,
    );
  }

  private emitSunwardFlight(effect: ActiveSunwardDisc, progress: number): void {
    const source = effect.origin ?? this.anchor(effect.sourceId, 0.58);
    const target = this.anchor(effect.targetId, 0.56);
    if (!source || !target) return;
    const position = source.clone().lerp(target, progress);
    const direction = target.clone().sub(source).normalize();
    emit(
      this.output,
      'sunward-disc-core',
      position.clone(),
      direction.clone().multiplyScalar(0.7),
      WHITE_GOLD,
      1.18,
      0.07,
      'glowCore',
    );
    emit(
      this.output,
      'sunward-disc-rune',
      position.clone(),
      direction.clone().multiplyScalar(0.7),
      WHITE_GOLD,
      1.12,
      0.07,
      'magicRune',
      0,
      progress * Math.PI * 2 + effect.hopIndex * 0.7,
    );
    emit(
      this.output,
      'sunward-disc-flight-halo',
      position.clone(),
      direction.clone().multiplyScalar(0.45),
      DAWN_GOLD,
      1.92,
      0.075,
      'ring',
      0,
      -progress * Math.PI * 1.5,
    );
    emit(
      this.output,
      'sunward-disc-trail',
      position.clone().addScaledVector(direction, -0.16),
      direction.clone().multiplyScalar(-0.6),
      WHITE_GOLD,
      0.46,
      0.11,
      'glowSoft',
    );
  }

  private emitSunwardImpact(effect: ActiveSunwardDisc): void {
    const target = this.anchor(effect.targetId, 0.58);
    if (!target) return;
    const ground = this.anchor(effect.targetId, 0.08) ?? target;
    const final = effect.hopIndex >= effect.totalHits - 1;
    const scale = final ? 1.35 : 1;
    emit(
      this.output,
      final ? 'sunward-impact-final' : 'sunward-impact',
      target.clone(),
      new THREE.Vector3(0, 0.3, 0),
      WHITE_GOLD,
      1.45 * scale,
      0.18,
      'flash',
    );
    emit(
      this.output,
      'sunward-downward-ray',
      target.clone().add(new THREE.Vector3(0, 1.55 * scale, 0)),
      new THREE.Vector3(0, -5.4, 0),
      WHITE_GOLD,
      0.5 * scale,
      0.22,
      'trace',
      0,
      0,
    );
    emit(
      this.output,
      'sunward-impact-rune',
      target.clone().add(new THREE.Vector3(0, 0.04, 0)),
      new THREE.Vector3(0, 0.2, 0),
      DAWN_GOLD,
      0.92 * scale,
      0.2,
      'magicRune',
      0,
      effect.hopIndex * 0.65,
    );
    emit(
      this.output,
      'sunward-impact-ring',
      ground.clone().add(new THREE.Vector3(0, 0.02, 0)),
      new THREE.Vector3(0, 0.15, 0),
      DAWN_GOLD,
      1.25 * scale,
      0.24,
      'ring',
    );
    const fragments = final ? 10 : 4;
    for (let index = 0; index < fragments; index++) {
      const angle = (index / fragments) * Math.PI * 2 + effect.hopIndex * 0.19;
      const speed = (final ? 3.8 : 2.2) + (index % 3) * 0.35;
      emit(
        this.output,
        final ? 'sunward-fragment' : 'sunward-impact-spark',
        target.clone(),
        new THREE.Vector3(
          Math.cos(angle) * speed,
          1.2 + (index % 4) * 0.45,
          Math.sin(angle) * speed,
        ),
        index % 3 === 0 ? WHITE_GOLD : DAWN_GOLD,
        (final ? 0.28 : 0.18) + (index % 2) * 0.05,
        final ? 0.34 : 0.24,
        final ? 'sparkBurst' : 'sparkle',
        final ? 4.5 : 2.5,
        angle,
      );
    }
  }
}
