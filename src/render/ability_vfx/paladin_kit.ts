import type { PrewarmResumeUnit } from '../prewarm_resume';
import { BastionRite } from './bastion_rite';
import { BastionSweep } from './bastion_sweep';
import { BeaconOfLight } from './beacon_of_light';
import type { CrestPrewarmHost } from './crest_prewarm';
import { DawnsEmbrace } from './dawns_embrace';
import { HallowedWall } from './hallowed_wall';
import { LifeCovenant } from './life_covenant';
import { MercyLance } from './mercy_lance';
import { OathChain } from './oath_chain';
import type { PaladinKitContext } from './paladin_kit_context';
import { RadiantChorus } from './radiant_chorus';
import { SacredForm } from './sacred_form';
import { SacredGoad } from './sacred_goad';
import { SolarInvocation } from './solar_invocation';
import { SunwardDisc } from './sunward_disc';
import { VeilboundMarch } from './veilbound_march';
import { VowkeeperStrike } from './vowkeeper_strike';

/** The per-frame state of one entity the kit reads (paladin_presence.ts). */
export interface PaladinKitEntity {
  id: number;
  dead: boolean;
  castingAbility: string | null;
  castRemaining: number;
  castTotal: number;
  castTargetId: number | null;
  auras: ReadonlyArray<{
    id: string;
    kind: string;
    remaining: number;
    duration: number;
    value?: number;
    value2?: number;
    sourceId?: number;
  }>;
}

export type KitOutcome = 'damage' | 'absorb' | 'none';

interface KitPart {
  preparation: { units(host: CrestPrewarmHost): PrewarmResumeUnit[] };
  update(dt: number, reduced: boolean): void;
  clear(): void;
  dispose(): void;
}

/**
 * The Paladin abilities reworked as one kit, each its own authored, prewarmed
 * effect. The painter routes their casts and hits here; the renderer's
 * entity pass feeds their channels and held auras through presence(), and
 * every heal passes through healed().
 */
/** Seconds after a heal in which a Beacon of Light copy is taken to follow it. */
const BEACON_COPY_WINDOW = 0.5;
const LAST_HEAL_CAP = 256;

export class PaladinKit {
  readonly mercyLance: MercyLance;
  readonly dawnsEmbrace: DawnsEmbrace;
  readonly radiantChorus: RadiantChorus;
  readonly beaconOfLight: BeaconOfLight;
  readonly sacredForm: SacredForm;
  readonly solarInvocation: SolarInvocation;
  readonly lifeCovenant: LifeCovenant;
  readonly hallowedWall: HallowedWall;
  readonly bastionRite: BastionRite;
  readonly vowkeeperStrike: VowkeeperStrike;
  readonly sacredGoad: SacredGoad;
  readonly sunwardDisc: SunwardDisc;
  readonly bastionSweep: BastionSweep;
  readonly oathChain: OathChain;
  readonly veilboundMarch: VeilboundMarch;
  /** Who was marching veiled last frame. */
  private readonly marching = new Set<number>();
  /** The largest Hallowed Wall absorb seen per Paladin while it stands. */
  private readonly wallPeak = new Map<number, number>();
  /** The largest vow-ward absorb seen on each Paladin while it holds. */
  private readonly wardPeak = new Map<number, number>();
  private readonly parts: readonly KitPart[];
  /** The last ally each Paladin healed, and when: a beacon's copy flows from it. */
  private readonly lastHeal = new Map<number, { target: number; at: number }>();
  private time = 0;
  private healSweep = 0;

  constructor(ctx: PaladinKitContext) {
    this.mercyLance = new MercyLance(ctx);
    this.dawnsEmbrace = new DawnsEmbrace(ctx);
    this.radiantChorus = new RadiantChorus(ctx);
    this.beaconOfLight = new BeaconOfLight(ctx);
    this.sacredForm = new SacredForm(ctx);
    this.solarInvocation = new SolarInvocation(ctx);
    this.lifeCovenant = new LifeCovenant(ctx);
    this.hallowedWall = new HallowedWall(ctx);
    this.bastionRite = new BastionRite(ctx);
    this.vowkeeperStrike = new VowkeeperStrike(ctx);
    this.sacredGoad = new SacredGoad(ctx);
    this.sunwardDisc = new SunwardDisc(ctx);
    this.bastionSweep = new BastionSweep(ctx);
    this.oathChain = new OathChain(ctx);
    this.veilboundMarch = new VeilboundMarch(ctx);
    this.parts = [
      this.mercyLance,
      this.dawnsEmbrace,
      this.radiantChorus,
      this.beaconOfLight,
      this.sacredForm,
      this.solarInvocation,
      this.lifeCovenant,
      this.hallowedWall,
      this.bastionRite,
      this.vowkeeperStrike,
      this.sacredGoad,
      this.sunwardDisc,
      this.bastionSweep,
      this.oathChain,
      this.veilboundMarch,
    ];
  }

  /** Every part's prewarm units, for the Paladin kit and the full prewarm. */
  units(host: CrestPrewarmHost): PrewarmResumeUnit[] {
    return this.parts.flatMap((part) => part.preparation.units(host));
  }

  /** Once per entity per frame: live casts and held auras. */
  presence(e: PaladinKitEntity): void {
    if (e.dead) {
      this.marching.delete(e.id);
      return;
    }
    let marching = false,
      ascendedMarch = false,
      warded = false,
      wall = -1,
      absorb = -1;
    for (const aura of e.auras) {
      if (aura.id === 'beacon_of_light') this.beaconOfLight.hold(e.id);
      else if (aura.kind === 'sacred_form') this.sacredForm.hold(e.id);
      else if (aura.id === 'life_covenant' && aura.remaining > 0) this.lifeCovenant.hold(e.id);
      else if (aura.id === 'holy_shield' && aura.remaining > 0) wall = aura.remaining;
      else if (aura.id === 'holy_shield_absorb') absorb = aura.value ?? 0;
      // Sacred Goad's Ascension guard (its 15% damage reduction): a shimmer.
      else if (
        aura.kind === 'buff_dr' &&
        aura.id.startsWith('sacred_challenge') &&
        aura.remaining > 0
      )
        this.sacredGoad.guard(e.id, aura.duration > 0 ? aura.remaining / aura.duration : 1);
      else if (aura.id === 'veilbound_march') {
        marching = true;
        if ((aura.value2 ?? 0) > 0) ascendedMarch = true;
      } else if (aura.id === 'vowkeeper_strike_absorb' && aura.remaining > 0) {
        // Ascension's vow-ward: its share left against the largest seen.
        const value = aura.value ?? 0;
        const peak = Math.max(this.wardPeak.get(e.id) ?? 0, value);
        this.wardPeak.set(e.id, peak);
        warded = true;
        this.vowkeeperStrike.ward(e.id, peak > 0 ? value / peak : 1, aura.remaining);
      } else if (aura.id === 'veilbound_mark' && aura.remaining > 0)
        this.veilboundMarch.mark(e.id, aura.sourceId ?? -1);
      else if (aura.id === 'oath_chain_pull') this.oathChain.hold(e.id, true, 1, aura.sourceId);
      else if (aura.id === 'oath_chain_slow' && aura.remaining > 0)
        this.oathChain.hold(
          e.id,
          false,
          aura.duration > 0 ? aura.remaining / aura.duration : 1,
          aura.sourceId,
        );
      else if (aura.id === 'bastion_rite' && aura.remaining > 0)
        this.bastionRite.hold(e.id, aura.duration > 0 ? aura.remaining / aura.duration : 1);
    }
    if (!warded) this.wardPeak.delete(e.id);
    // The veil's end burst comes from the march's final wave (its hits and its
    // burst cue, painter.ts), never from the aura going, so it lands with the
    // damage numbers.
    if (marching) {
      this.veilboundMarch.march(e.id, ascendedMarch);
      this.marching.add(e.id);
    } else this.marching.delete(e.id);
    if (wall >= 0) {
      // The ward's share left: against the largest absorb seen this wall.
      const peak = Math.max(this.wallPeak.get(e.id) ?? 0, absorb);
      this.wallPeak.set(e.id, peak);
      this.hallowedWall.hold(e.id, absorb > 0 && peak > 0 ? absorb / peak : 0, wall);
    } else this.wallPeak.delete(e.id);
    const progress = e.castTotal > 0 ? 1 - e.castRemaining / e.castTotal : 0;
    switch (e.castingAbility) {
      case 'mercy_lance':
        this.mercyLance.channel(e.id, e.castTargetId, progress);
        break;
      case 'dawns_embrace':
        this.dawnsEmbrace.channel(e.id, e.castTargetId, progress);
        break;
      case 'radiant_chorus':
        this.radiantChorus.channel(e.id, progress);
        break;
    }
  }

  /** `id` casts Hallowed Wall: a wall still standing runs its threat ring out
   * again, and its plates measure the new absorb afresh. */
  hallowedWallCast(id: number): void {
    this.wallPeak.delete(id);
    this.hallowedWall.cast(id);
  }

  /** Every heal landing (`ability` is the display label): the kit's own reactions. */
  healed(sourceId: number, targetId: number, ability: string): void {
    if (ability === 'Beacon of Light') {
      // The copy comes straight after the heal it copies.
      const last = this.lastHeal.get(sourceId);
      const from = last && this.time - last.at < BEACON_COPY_WINDOW ? last.target : sourceId;
      this.beaconOfLight.transfer(from, targetId);
      return;
    }
    // Every heal from every source lands here: the note is mutated in place,
    // and update() drops the ones too old for a beacon's copy to follow.
    const note = this.lastHeal.get(sourceId);
    if (note) {
      note.target = targetId;
      note.at = this.time;
    } else {
      // A burst of healers between sweeps: forget them all rather than grow.
      if (this.lastHeal.size >= LAST_HEAL_CAP) this.lastHeal.clear();
      this.lastHeal.set(sourceId, { target: targetId, at: this.time });
    }
    if (ability === 'Radiant Chorus') this.radiantChorus.reach(sourceId, targetId);
    // Ascension's splash heal: each ally it reaches glints.
    if (ability === 'Solar Invocation') this.solarInvocation.reach(sourceId, targetId);
  }

  update(dt: number, reduced: boolean): void {
    this.time += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (this.lastHeal.size > 0 && this.time >= this.healSweep) {
      this.healSweep = this.time + 1;
      for (const [id, note] of this.lastHeal)
        if (this.time - note.at > BEACON_COPY_WINDOW) this.lastHeal.delete(id);
    }
    for (const part of this.parts) part.update(dt, reduced);
  }

  clear(): void {
    for (const part of this.parts) part.clear();
  }

  dispose(): void {
    const errors: unknown[] = [];
    for (const part of this.parts) {
      try {
        part.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Paladin kit cleanup failed');
  }
}
