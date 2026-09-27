// Party combat meters: damage / healing / threat, segmented into encounters.
// An encounter starts on the first party damage/heal event and ends after a
// few seconds with no party combat activity AND no visible mob holding aggro
// on a party member. Finished encounters land in a small history and fold
// into the session "All" segment; the panel pages between them.
//
// "Threat" shows the engaged mob's REAL hate table (entity.threat, classic
// rules: damage x stance modifiers, flat ability threat, split healing
// threat, synced online as the top entries) and marks who the mob is
// actually targeting (aggroTargetId). WHICH mob that is gets resolved live
// every render by threat_subject_core.ts, never read off the encounter's
// latched mainMobId: the latch froze the tab on the first mob of a pull and
// then on its corpse. A mob's hate table is wiped in place the instant it
// dies, so the tab also keeps a per-mob snapshot of the last LIVE table it
// saw (Encounter.threatSnapshotByMob, latched on every hit in onEvent): once
// the subject dies, resolveThreatValues freezes on that snapshot rather than
// recalculating the tab from damage, so a fight's real threat survives the
// kill that just proved it. Only once no snapshot was ever taken (nothing
// live was ever seen on this segment) does the tab fall back to each
// member's damage on the latched mob, and say so in the subtitle, because
// damage under a "Threat" heading reads as hate.
//
// The pet rule differs by TAB, and that split is the point. On damage/healing a
// controlled pet (hunter, warlock, mage) folds into its owner's row, the way a
// real damage meter reports a hunter. On THREAT it gets its own row, because
// the mob's pull-over rule compares each hate-table ENTRY separately: a folded
// owner+pet number is measured against a threshold that is never applied to it,
// which made every pet class read as though it should have pulled and had not.

import type { Keybinds } from '../game/keybinds';
import { CLASSES } from '../sim/data';
import type { Entity, SimEvent } from '../sim/types';
import type { IWorld } from '../world_api';
import { abilityDisplayNameFromSource } from './ability_display_name';
import { classIconUrl } from './class_icon_art';
import { tEntity } from './entity_i18n';
import { esc } from './esc';
import type { HubActionBarSlot } from './hud/practice';
import { HubLessonController, PracticeDpsController, practiceDpsModel } from './hud/practice';
import { formatNumber, type TranslationKey, t } from './i18n';
import { iconDataUrl } from './icons';
import { PlayerActivityTracker } from './meters_activity';
import { AuraUptimeTracker } from './meters_auras';
import {
  type BreakdownEntry,
  type BreakdownGroup,
  type BreakdownRow,
  breakdownKey,
  buildGroupedMeterBreakdown,
  buildMeterBreakdown,
} from './meters_breakdown_view';
import { compareEncounters } from './meters_comparison';
import { buildDeathRecapRows, DeathRecapBuffer, type DeathRecapRecord } from './meters_death_recap';
import { buildAbilityBalanceStats } from './meters_dev_view';
import { exportEncounterAsJson, exportEncounterAsText } from './meters_export';
import { fmtDuration, fmtNum, fmtPercent, fmtPerSecond, fmtPerSecondRow } from './meters_format';
import { MeterFrame } from './meters_frame';
import { METER_FRAME_LIMITS } from './meters_frame_core';
import { buildMeterTabMenu, type MeterMenuRow } from './meters_menu_view';
import { MetersOptionsDialog } from './meters_options_dialog';
import {
  EncounterPhaseManager,
  newPhaseTallySnapshot,
  type PhaseTallySnapshot,
} from './meters_phases';
import { formatChatReport } from './meters_report';
import { buildMeterRows, type MeterPet, type MeterTab } from './meters_rows_view';
import {
  applySettingsClasses,
  DEFAULT_METERS_SETTINGS,
  loadMetersSettings,
  type MetersSettings,
  saveMetersSettings,
} from './meters_settings';
import { buildTimelineRows, EncounterTimeline } from './meters_timeline';
import { PartyPidsCache } from './party_pids_core';
import type { SimpleMenuItem } from './simple_context_menu';
import { specIconUrl } from './spec_icon_art';
import { resolveThreatSubject, resolveThreatValues } from './threat_subject_core';

const ENCOUNTER_END_SECONDS = 5;
const HISTORY_CAP = 8;

export const WOW_CLASS_COLORS: Readonly<Record<string, string>> = {
  warrior: '#c79c6e',
  paladin: '#f58cba',
  hunter: '#abd473',
  rogue: '#fff569',
  priest: '#ffffff',
  shaman: '#0070de',
  mage: '#69ccf0',
  warlock: '#9482c9',
  druid: '#ff7d0a',
};

export function getClassColor(cls: string | null): string {
  if (cls && WOW_CLASS_COLORS[cls]) return WOW_CLASS_COLORS[cls];
  if (cls && (CLASSES as Record<string, { color: number }>)[cls]?.color) {
    const hex = (CLASSES as Record<string, { color: number }>)[cls].color
      .toString(16)
      .padStart(6, '0');
    return `#${hex}`;
  }
  return '#888888';
}

export interface MemberTally {
  pid: number;
  name: string;
  cls: string | null;
  spec: string | null;
  dmg: number;
  heal: number;
  dmgTaken: number;
  absorbed: number;
  interrupts: number;
  deaths: number;
  avoidableDmg?: number;
  hits: number;
  crits: number;
  /** damage per mob entity id (current/previous encounters only) */
  dmgByMob: Map<number, number>;
  /** damage per ability (pet output keyed under the pet's name) */
  dmgByAbility: Map<string, BreakdownEntry>;
  /** healing per ability */
  healByAbility: Map<string, BreakdownEntry>;
  /** damage taken per ability */
  dmgTakenByAbility: Map<string, BreakdownEntry>;
  /** damage taken per mob entity id */
  dmgTakenByMob: Map<number, number>;
  /** interrupts per ability */
  interruptsByAbility: Map<string, BreakdownEntry>;
  /** metrics broken down per boss phase */
  phaseTallies: Map<string, PhaseTallySnapshot>;
}

/** Who a combat event's damage/healing belongs to once pets fold into owners. */
interface Attribution {
  pid: number;
  name: string;
  cls: string | null;
  spec: string | null;
  /** display name of the acting pet, or null when the member acted directly */
  petName: string | null;
}

/**
 * Resolves the icon for a damage meter row.
 * Prefers the character's chosen specialization icon; falls back to the class icon
 * when no specialization is chosen or registered.
 */
export function meterIconUrl(cls: string | null, spec?: string | null): string | null {
  if (!cls) return null;
  if (spec) {
    const sUrl = specIconUrl({
      class: cls as Parameters<typeof specIconUrl>[0]['class'],
      id: spec,
    });
    if (sUrl) return sUrl;
  }
  return classIconUrl(cls);
}

export const SIGNATURE_SPEC_ABILITIES: Record<string, Record<string, string>> = {
  warrior: {
    mortal_strike: 'arms',
    colossus_smash: 'arms',
    sweeping_strikes: 'arms',
    bladestorm: 'arms',
    bloodthirst: 'fury',
    rampage: 'fury',
    raging_blow: 'fury',
    shield_slam: 'prot',
    revenge: 'prot',
    shield_block: 'prot',
    last_stand: 'prot',
  },
  paladin: {
    mercy_lance: 'holy',
    holy_shock: 'holy',
    beacon_of_light: 'holy',
    sunward_disc: 'protection',
    avengers_shield: 'protection',
    shield_of_the_righteous: 'protection',
    final_edict: 'retribution',
    crusader_strike: 'retribution',
    templars_verdict: 'retribution',
    divine_storm: 'retribution',
  },
  hunter: {
    bestial_wrath: 'beast_mastery',
    kill_command: 'beast_mastery',
    cold_focus: 'marksmanship',
    aimed_shot: 'marksmanship',
    rapid_fire: 'marksmanship',
    trueshot: 'marksmanship',
    bloodhook: 'survival',
    wildfire_bomb: 'survival',
    mongoose_bite: 'survival',
  },
  rogue: {
    cold_blood: 'assassination',
    mutilate: 'assassination',
    envenom: 'assassination',
    venomrend: 'assassination',
    blade_flurry: 'combat',
    killing_spree: 'combat',
    redline: 'combat',
    lights_out: 'combat',
    hemorrhage: 'subtlety',
    shadowstrike: 'subtlety',
    shadow_dance: 'subtlety',
    shadow_veil: 'subtlety',
  },
  priest: {
    scouring_mercy: 'discipline',
    penance: 'discipline',
    power_word_shield: 'discipline',
    seraphic_vigil: 'holy',
    holy_word_serenity: 'holy',
    prayer_of_mending: 'holy',
    circle_of_healing: 'holy',
    summon_tithefiend: 'shadow',
    mind_blast: 'shadow',
    shadow_word_pain: 'shadow',
    vampiric_touch: 'shadow',
    shadowform: 'shadow',
  },
  shaman: {
    elemental_mastery: 'elemental',
    lava_burst: 'elemental',
    earth_shock: 'elemental',
    stormstrike: 'enhancement',
    lava_lash: 'enhancement',
    feral_spirit: 'enhancement',
    chain_heal: 'restoration',
    healing_rain: 'restoration',
    rip_tide: 'restoration',
  },
  mage: {
    temporal_mend: 'arcane',
    arcane_blast: 'arcane',
    arcane_barrage: 'arcane',
    pyroblast: 'fire',
    combustion: 'fire',
    fire_blast: 'fire',
    ice_lance: 'frost',
    blizzard: 'frost',
    frozen_orb: 'frost',
  },
  warlock: {
    evil_eye: 'affliction',
    unstable_affliction: 'affliction',
    drain_soul: 'affliction',
    metamorphosis: 'demonology',
    hand_of_guldan: 'demonology',
    call_dreadstalkers: 'demonology',
    conflagrate: 'destruction',
    chaos_bolt: 'destruction',
    immolate: 'destruction',
  },
  druid: {
    moonkin_form: 'balance',
    moonsurge: 'balance',
    sunwake: 'balance',
    starsurge: 'balance',
    starfall: 'balance',
    feral_charge: 'feral',
    shred: 'feral',
    rip: 'feral',
    ferocious_bite: 'feral',
    swiftmend: 'restoration',
    wild_growth: 'restoration',
    lifebloom: 'restoration',
  },
};

export function inferSpecFromAbility(cls: string | null, ability: string | null): string | null {
  if (!cls || !ability) return null;
  const classSpecs = SIGNATURE_SPEC_ABILITIES[cls.toLowerCase()];
  if (!classSpecs) return null;
  const key = ability
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
  return classSpecs[key] ?? null;
}

function addBreakdown(
  map: Map<string, BreakdownEntry>,
  petName: string | null,
  ability: string | null,
  amount: number,
  opts?: {
    crit?: boolean;
    absorbed?: number;
    overheal?: number;
    targetName?: string;
    sourceName?: string;
    abilityId?: string | null;
    interruptedSpell?: string;
  },
): void {
  const key = breakdownKey(petName, ability);
  let entry = map.get(key);
  if (!entry) {
    entry = { ability, petName, amount: 0 };
    Object.defineProperty(entry, 'hits', { value: 0, writable: true, enumerable: false });
    Object.defineProperty(entry, 'crits', { value: 0, writable: true, enumerable: false });
    Object.defineProperty(entry, 'hitTotal', { value: 0, writable: true, enumerable: false });
    Object.defineProperty(entry, 'critTotal', { value: 0, writable: true, enumerable: false });
    Object.defineProperty(entry, 'minHit', { value: undefined, writable: true, enumerable: false });
    Object.defineProperty(entry, 'maxHit', { value: undefined, writable: true, enumerable: false });
    Object.defineProperty(entry, 'overheal', { value: 0, writable: true, enumerable: false });
    Object.defineProperty(entry, 'absorbed', { value: 0, writable: true, enumerable: false });
    Object.defineProperty(entry, 'abilityId', {
      value: opts?.abilityId ?? null,
      writable: true,
      enumerable: false,
    });
    Object.defineProperty(entry, 'targets', {
      value: new Map<string, number>(),
      writable: true,
      enumerable: false,
    });
    Object.defineProperty(entry, 'sources', {
      value: new Map<string, number>(),
      writable: true,
      enumerable: false,
    });
    Object.defineProperty(entry, 'interruptedSpells', {
      value: new Map<string, number>(),
      writable: true,
      enumerable: false,
    });
    map.set(key, entry);
  }

  entry.amount += amount;
  entry.hits = (entry.hits ?? 0) + 1;
  if (opts?.crit) {
    entry.crits = (entry.crits ?? 0) + 1;
    entry.critTotal = (entry.critTotal ?? 0) + amount;
  } else {
    entry.hitTotal = (entry.hitTotal ?? 0) + amount;
  }
  if (amount > 0) {
    if (entry.minHit === undefined || amount < entry.minHit) entry.minHit = amount;
    if (entry.maxHit === undefined || amount > entry.maxHit) entry.maxHit = amount;
  }
  if (opts?.absorbed) entry.absorbed = (entry.absorbed ?? 0) + opts.absorbed;
  if (opts?.overheal) entry.overheal = (entry.overheal ?? 0) + opts.overheal;
  if (opts?.targetName) {
    if (!entry.targets) entry.targets = new Map();
    entry.targets.set(opts.targetName, (entry.targets.get(opts.targetName) ?? 0) + amount);
  }
  if (opts?.sourceName) {
    if (!entry.sources) entry.sources = new Map();
    entry.sources.set(opts.sourceName, (entry.sources.get(opts.sourceName) ?? 0) + amount);
  }
  if (opts?.interruptedSpell) {
    if (!entry.interruptedSpells) entry.interruptedSpells = new Map();
    entry.interruptedSpells.set(
      opts.interruptedSpell,
      (entry.interruptedSpells.get(opts.interruptedSpell) ?? 0) + 1,
    );
  }
}

export interface Encounter {
  label: string;
  /** ms epoch of first activity */
  startedAt: number;
  /** seconds of combat (live encounters: now - startedAt) */
  duration: number;
  tallies: Map<number, MemberTally>;
  /** mob entity id with the most party damage (threat tab subject) */
  mainMobId: number | null;
  mainMobName: string;
  /** template id of the threat-subject mob, so its name localizes at render time */
  mainMobTemplateId: string | null;
  /** maxHp of the biggest mob damaged — used to pick the label */
  biggestMobHp: number;
  /**
   * Each engaged mob's live hate table, latched on every hit while it is
   * still readable. A mob's table is wiped the instant it dies, so without
   * this the Threat tab would fall through to the raw-damage fallback right
   * when a fight's real numbers matter most: at the kill. Current/previous
   * encounters only, exactly like `dmgByMob`.
   */
  threatSnapshotByMob: Map<number, Map<number, number>>;
  /** Latch of recent death recaps for each dead player */
  deathRecaps: Map<number, DeathRecapRecord[]>;
  /** Boss phases tracking */
  phases: EncounterPhaseManager;
  /** Key timeline events */
  timeline: EncounterTimeline;
  /** Damage received per target by player */
  targetDamageReceived: Map<string, Map<number, number>>;
}

function newEncounter(now: number): Encounter {
  return {
    label: 'Combat',
    startedAt: now,
    duration: 0,
    tallies: new Map(),
    mainMobId: null,
    mainMobName: '',
    mainMobTemplateId: null,
    biggestMobHp: -1,
    threatSnapshotByMob: new Map(),
    deathRecaps: new Map(),
    phases: new EncounterPhaseManager(now / 1000),
    timeline: new EncounterTimeline(),
    targetDamageReceived: new Map(),
  };
}

export class MeterData {
  current: Encounter | null = null;
  history: Encounter[] = [];
  allTime: Encounter;
  private lastActivity = 0;
  private settings: MetersSettings;

  constructor(now: number, settings: MetersSettings = { ...DEFAULT_METERS_SETTINGS }) {
    this.settings = { ...settings };
    this.allTime = { ...newEncounter(now), label: 'All (session)' };
  }

  updateSettings(settings: MetersSettings): void {
    this.settings = { ...settings };
  }

  private tally(
    enc: Encounter,
    pid: number,
    name: string,
    cls: string | null,
    partyPids: ReadonlySet<number>,
    spec?: string | null,
  ): MemberTally {
    let t = enc.tallies.get(pid);
    if (t) {
      if (cls && !t.cls) t.cls = cls;
      if (spec && !t.spec) t.spec = spec;
      return t;
    }
    // a reconnect issues the same character a new entity id mid-encounter; find
    // its previous row by name and re-key it instead of starting a duplicate.
    // Only treat a name match as a reconnect when the old pid is no longer a
    // live party member: pet names come from their template/tamed-target name
    // and are not unique, so two live same-named pets must stay separate
    // rows instead of ping-ponging the merge back and forth.
    for (const [oldPid, existing] of enc.tallies) {
      if (existing.name === name && oldPid !== pid && !partyPids.has(oldPid)) {
        enc.tallies.delete(oldPid);
        existing.pid = pid;
        existing.cls = cls ?? existing.cls;
        existing.spec = spec ?? existing.spec;
        enc.tallies.set(pid, existing);
        return existing;
      }
    }
    t = {
      pid,
      name,
      cls,
      spec: spec ?? null,
      dmg: 0,
      heal: 0,
      dmgTaken: 0,
      absorbed: 0,
      interrupts: 0,
      deaths: 0,
      hits: 0,
      crits: 0,
      dmgByMob: new Map(),
      dmgByAbility: new Map(),
      healByAbility: new Map(),
      dmgTakenByAbility: new Map(),
      dmgTakenByMob: new Map(),
      interruptsByAbility: new Map(),
      phaseTallies: new Map(),
    };
    enc.tallies.set(pid, t);
    return t;
  }

  readonly deathRecapBuffer = new DeathRecapBuffer();
  readonly activityTracker = new PlayerActivityTracker();
  readonly auraTracker = new AuraUptimeTracker();

  /**
   * Resolve the row a combat event belongs to. A controlled pet reports its
   * OWNER (folding hunter/warlock/mage pet output into the player's row) and
   * keeps its own name for the breakdown; anything else reports itself.
   */
  private attribute(world: IWorld, sourceId: number, partyPids: ReadonlySet<number>): Attribution {
    const src = world.entities.get(sourceId);
    const ownerId = src?.kind === 'mob' ? (src.ownerId ?? null) : null;
    const owned = ownerId !== null && partyPids.has(ownerId);
    const pid = owned && ownerId !== null ? ownerId : sourceId;
    const petName = owned ? (src?.name ?? null) : null;
    const member = world.partyInfo?.members.find((m) => m.pid === pid);
    const entity = world.entities.get(pid);
    const isPlayer = pid === world.player.id;
    const cls = member?.cls ?? (isPlayer ? world.player.templateId : null);
    let spec: string | null = null;
    if (member?.spec) {
      spec = member.spec;
    } else if (isPlayer && world.talentSpec) {
      spec = world.talentSpec;
    }
    return {
      pid,
      name: member?.name ?? entity?.name ?? `#${pid}`,
      cls,
      spec,
      petName,
    };
  }

  private threatEntryBelongsToParty(
    world: IWorld,
    entityId: number,
    partyPids: ReadonlySet<number>,
  ): boolean {
    if (partyPids.has(entityId)) return true;
    const entity = world.entities.get(entityId);
    return entity?.kind === 'mob' && entity.ownerId !== null && partyPids.has(entity.ownerId);
  }

  private refreshThreatSnapshots(world: IWorld, partyPids: ReadonlySet<number>): void {
    if (!this.current) return;
    for (const entity of world.entities.values()) {
      if (entity.kind !== 'mob' || !entity.threat || entity.threat.size === 0) continue;
      let partyOnTable = false;
      for (const threatEntityId of entity.threat.keys()) {
        if (this.threatEntryBelongsToParty(world, threatEntityId, partyPids)) {
          partyOnTable = true;
          break;
        }
      }
      if (!partyOnTable) continue;
      this.current.threatSnapshotByMob.set(entity.id, new Map(entity.threat));
    }
  }

  /** party membership check is supplied by the caller (self + party pids) */
  onEvent(ev: SimEvent, world: IWorld, partyPids: ReadonlySet<number>, now: number): void {
    const evType = ev.type as string;
    if (
      evType !== 'damage' &&
      evType !== 'heal2' &&
      evType !== 'absorb' &&
      evType !== 'aura' &&
      evType !== 'playerDeath' &&
      evType !== 'castStart' &&
      evType !== 'varkhulCallout' &&
      evType !== 'nythraxisCallout'
    ) {
      return;
    }

    if (ev.type === 'castStart') {
      if (partyPids.has(ev.entityId)) {
        this.activityTracker.recordAction(ev.entityId, now / 1000);
      }
      return;
    }

    if (ev.type === 'nythraxisCallout') {
      if (ev.call === 'boneStormBegins') {
        this.current?.phases.markPhase('Phase 3 (Bone Storm)', now / 1000);
        this.current?.timeline.addEvent({
          timeSec: now / 1000,
          type: 'phase',
          label: 'Phase 3: Bone Storm',
        });
      } else if (ev.call === 'dreadCurseSwap') {
        this.current?.phases.markPhase('Phase 2', now / 1000);
        this.current?.timeline.addEvent({
          timeSec: now / 1000,
          type: 'phase',
          label: 'Phase 2: Dread Curse',
        });
      }
      return;
    }

    if (ev.type === 'varkhulCallout') {
      if (ev.call === 'worldfireBegins') {
        this.current?.phases.markPhase('Phase 2 (Worldfire)', now / 1000);
        this.current?.timeline.addEvent({
          timeSec: now / 1000,
          type: 'phase',
          label: 'Phase 2: Worldfire',
        });
      } else if (ev.call === 'portalsOpening') {
        this.current?.phases.markPhase('Intermission (Portals)', now / 1000);
        this.current?.timeline.addEvent({
          timeSec: now / 1000,
          type: 'phase',
          label: 'Intermission: Portals',
        });
      }
      return;
    }
    // The HoT-application sound cue (Sim.applyAura, cueOnly:true) is audio-only
    // and must not open or keep alive an otherwise-idle encounter segment. Gated
    // on the explicit flag, not amount === 0: a genuine direct heal (applyHeal)
    // can also legitimately land at amount 0 (full HP, fully absorbed) and that
    // real cast should still count as party activity.
    if (ev.type === 'heal2' && ev.cueOnly) return;

    const evRecord = ev as Record<string, unknown>;
    const sourceInParty =
      typeof evRecord.sourceId === 'number'
        ? this.threatEntryBelongsToParty(world, evRecord.sourceId, partyPids)
        : false;
    const targetInParty =
      typeof evRecord.targetId === 'number' ? partyPids.has(evRecord.targetId) : false;
    const pidInParty = 'pid' in ev && typeof ev.pid === 'number' ? partyPids.has(ev.pid) : false;

    if (ev.type === 'damage' || ev.type === 'heal2' || ev.type === 'absorb') {
      if (!sourceInParty && !targetInParty) return;
    } else if (ev.type === 'aura') {
      // Allow all auras to track uptime
      const target = world.entities.get(ev.targetId);
      const targetName = target?.name ?? `#${ev.targetId}`;
      const src = ev.sourceId !== undefined ? world.entities.get(ev.sourceId) : null;
      const srcName = src?.name ?? (ev.sourceId !== undefined ? `#${ev.sourceId}` : undefined);
      const isBuff = partyPids.has(ev.targetId);
      this.auraTracker.recordAura(
        ev.targetId,
        targetName,
        ev.name,
        ev.gained,
        now / 1000,
        isBuff,
        ev.sourceId,
        srcName,
      );

      const isInterrupt =
        ev.gained &&
        ev.auraKind === 'lockout' &&
        ev.sourceId !== undefined &&
        partyPids.has(ev.sourceId);

      if (!isInterrupt) {
        return;
      }
    } else if (ev.type === 'playerDeath') {
      if (!pidInParty) return;
    }

    // A HoT's periodic tick (ev.hot) is passive residual healing, not fresh party
    // activity: left alone it holds the segment open indefinitely (a HoT still
    // ticking down after the kill, or kept rolling by the healer into the next
    // pull, never let the 5s inactivity clock elapse), merging pulls together
    // instead of resetting between them. A lone tick with no segment open must
    // not spawn one either, so residual healing between pulls stays inert; while
    // a segment IS open its healing still tallies, just without touching the
    // clock that closes it.
    const isPassiveHotTick = ev.type === 'heal2' && ev.hot === true;
    if (isPassiveHotTick && !this.current) return;

    // any other party-involved combat keeps the encounter alive (tanking without
    // dealing damage must not end the segment)
    if (!this.current) this.current = newEncounter(now);
    if (!isPassiveHotTick) this.lastActivity = now;
    this.refreshThreatSnapshots(world, partyPids);

    if (ev.type === 'damage') {
      if (sourceInParty && ev.kind === 'hit' && ev.amount > 0) {
        const target = world.entities.get(ev.targetId);
        const countsAsPartyOutput =
          target?.kind === 'mob' || (target?.kind === 'player' && !partyPids.has(ev.targetId));
        if (!countsAsPartyOutput) {
          return;
        }
        const targetName = target?.name ?? `#${ev.targetId}`;
        const who = this.attribute(world, ev.sourceId, partyPids);
        if (!who.spec && who.cls) {
          who.spec =
            inferSpecFromAbility(who.cls, ev.ability) ??
            inferSpecFromAbility(who.cls, ev.abilityId ?? null);
        }
        this.activityTracker.recordAction(who.pid, now / 1000);

        for (const enc of [this.current, this.allTime]) {
          const t = this.tally(enc, who.pid, who.name, who.cls, partyPids, who.spec);
          t.dmg += ev.amount;
          t.hits += 1;
          if (ev.crit) t.crits += 1;
          const currPhase = enc.phases.currentPhase;
          let pt = t.phaseTallies.get(currPhase);
          if (!pt) {
            pt = newPhaseTallySnapshot();
            t.phaseTallies.set(currPhase, pt);
          }
          pt.dmg += ev.amount;

          addBreakdown(t.dmgByAbility, who.petName, ev.ability, ev.amount, {
            crit: ev.crit,
            targetName,
            abilityId: ev.abilityId,
          });

          let tr = enc.targetDamageReceived.get(targetName);
          if (!tr) {
            tr = new Map();
            enc.targetDamageReceived.set(targetName, tr);
          }
          tr.set(who.pid, (tr.get(who.pid) ?? 0) + ev.amount);

          if (enc === this.current) {
            t.dmgByMob.set(ev.targetId, (t.dmgByMob.get(ev.targetId) ?? 0) + ev.amount);
          }
        }
        // Latch the mob's live hate table while it is still readable, so a
        // kill's own hit does not erase the numbers it just proved: `target.threat`
        // is cleared in place on death, so a reference here would go empty right
        // alongside it, and reading it only at death is already too late (the
        // server clears the table before this event is even processed). Never
        // overwrite a real snapshot with an empty read (target already dead, or
        // simply out of combat with nothing on its table yet).
        if (target && target.kind === 'mob') {
          if (target.threat && target.threat.size > 0) {
            this.current.threatSnapshotByMob.set(ev.targetId, new Map(target.threat));
          }
          // encounter label/threat subject: the beefiest mob the party fought
          if (target.maxHp > this.current.biggestMobHp) {
            this.current.biggestMobHp = target.maxHp;
            this.current.label = target.name;
            this.current.mainMobName = target.name;
            this.current.mainMobTemplateId = target.templateId;
            this.current.mainMobId = ev.targetId;
          }
        } else if (target && target.kind === 'player' && !partyPids.has(ev.targetId)) {
          // PvP segments carry the first opponent's literal player name until a mob claims
          // the segment. Threat snapshots and mob IDs are intentionally skipped for players.
          if (this.current.biggestMobHp < 0 && this.current.label === 'Combat') {
            this.current.label = target.name;
          }
        }
      }

      if (targetInParty && ev.kind === 'hit' && (ev.amount > 0 || (ev.absorbed ?? 0) > 0)) {
        const whoTarget = this.attribute(world, ev.targetId, partyPids);
        const targetEntity = world.entities.get(ev.targetId);
        const srcEntity = world.entities.get(ev.sourceId);
        const fallbackName = typeof evRecord.sourceName === 'string' ? evRecord.sourceName : null;
        const sourceName = srcEntity?.name ?? fallbackName ?? `#${ev.sourceId}`;
        const maxHp = targetEntity?.maxHp;
        const hpAfter = targetEntity?.hp;
        const hpBefore =
          hpAfter === undefined
            ? undefined
            : Math.min(maxHp ?? hpAfter + ev.amount, hpAfter + ev.amount);
        const lethal = (hpAfter !== undefined && hpAfter <= 0) || targetEntity?.dead === true;

        this.deathRecapBuffer.push(whoTarget.pid, {
          timestamp: now,
          type: 'damage',
          ability: ev.ability || 'Attack',
          sourceName,
          sourceId: ev.sourceId,
          amount: ev.amount,
          hpBefore,
          hpAfter,
          maxHp,
          lethal,
          abilityId: ev.abilityId,
          school: ev.school,
          crit: ev.crit,
        });

        if (ev.absorbed && ev.absorbed > 0) {
          this.deathRecapBuffer.push(whoTarget.pid, {
            timestamp: now,
            type: 'absorb',
            ability: 'Shield Absorbed',
            sourceName: 'Shield',
            sourceId: 0,
            amount: ev.absorbed,
            hpBefore,
            hpAfter,
            maxHp,
          });
        }

        for (const enc of [this.current, this.allTime]) {
          const t = this.tally(
            enc,
            whoTarget.pid,
            whoTarget.name,
            whoTarget.cls,
            partyPids,
            whoTarget.spec,
          );
          t.dmgTaken += ev.amount;
          if (ev.absorbed) t.absorbed += ev.absorbed;

          const currPhase = enc.phases.currentPhase;
          let pt = t.phaseTallies.get(currPhase);
          if (!pt) {
            pt = newPhaseTallySnapshot();
            t.phaseTallies.set(currPhase, pt);
          }
          pt.dmgTaken += ev.amount;

          addBreakdown(t.dmgTakenByAbility, null, ev.ability, ev.amount, {
            crit: ev.crit,
            sourceName,
            abilityId: ev.abilityId,
          });

          if (enc === this.current) {
            t.dmgTakenByMob.set(ev.sourceId, (t.dmgTakenByMob.get(ev.sourceId) ?? 0) + ev.amount);
          }
        }
      }
    } else if (ev.type === 'heal2' || ev.type === 'absorb') {
      const targetEntity = world.entities.get(ev.targetId);
      const targetName = targetEntity?.name ?? `#${ev.targetId}`;

      if (targetInParty) {
        const hpBefore = targetEntity?.hp;
        const maxHp = targetEntity?.maxHp;
        const hpAfter = Math.min(maxHp ?? (hpBefore ?? 0) + ev.amount, (hpBefore ?? 0) + ev.amount);
        const srcEntity = world.entities.get(ev.sourceId);
        const fallbackName = typeof evRecord.sourceName === 'string' ? evRecord.sourceName : null;
        const sourceName = srcEntity?.name ?? fallbackName ?? `#${ev.sourceId}`;

        const whoTarget = this.attribute(world, ev.targetId, partyPids);
        this.deathRecapBuffer.push(whoTarget.pid, {
          timestamp: now,
          type: ev.type === 'absorb' ? 'absorb' : 'heal',
          ability: ev.ability || (ev.type === 'absorb' ? 'Shield Absorbed' : 'Heal'),
          sourceName,
          sourceId: ev.sourceId,
          amount: ev.amount,
          hpBefore,
          hpAfter,
          maxHp,
          abilityId: typeof evRecord.abilityId === 'string' ? evRecord.abilityId : undefined,
          crit: evRecord.crit === true,
        });
      }

      if (
        sourceInParty &&
        ev.amount > 0 &&
        (ev.type !== 'absorb' || this.settings.includeShieldsInHeal)
      ) {
        const who = this.attribute(world, ev.sourceId, partyPids);
        if (!who.spec && who.cls) {
          who.spec = inferSpecFromAbility(who.cls, ev.ability);
        }
        this.activityTracker.recordAction(who.pid, now / 1000);

        for (const enc of [this.current, this.allTime]) {
          const t = this.tally(enc, who.pid, who.name, who.cls, partyPids, who.spec);
          t.heal += ev.amount;
          t.hits += 1;
          if ('crit' in ev && ev.crit) t.crits += 1;
          if ('absorbed' in ev && ev.absorbed) t.absorbed += ev.absorbed;

          const currPhase = enc.phases.currentPhase;
          let pt = t.phaseTallies.get(currPhase);
          if (!pt) {
            pt = newPhaseTallySnapshot();
            t.phaseTallies.set(currPhase, pt);
          }
          pt.heal += ev.amount;

          addBreakdown(t.healByAbility, who.petName, ev.ability, ev.amount, {
            crit: 'crit' in ev ? ev.crit : false,
            absorbed: 'absorbed' in ev ? ev.absorbed : undefined,
            overheal: 'overheal' in ev ? ev.overheal : undefined,
            targetName,
          });
        }
      }
    } else if (
      ev.type === 'aura' &&
      ev.gained &&
      ev.auraKind === 'lockout' &&
      ev.sourceId !== undefined &&
      partyPids.has(ev.sourceId)
    ) {
      const who = this.attribute(world, ev.sourceId, partyPids);
      if (!who.spec && who.cls) {
        who.spec = inferSpecFromAbility(who.cls, ev.name);
      }
      this.activityTracker.recordAction(who.pid, now / 1000);
      const target = world.entities.get(ev.targetId);
      const interruptedSpell = target?.castingAbility ?? undefined;

      for (const enc of [this.current, this.allTime]) {
        const t = this.tally(enc, who.pid, who.name, who.cls, partyPids, who.spec);
        t.interrupts += 1;
        addBreakdown(t.interruptsByAbility, null, ev.name, 1, {
          interruptedSpell,
          targetName: target?.name,
        });
        enc.timeline.addEvent({
          timeSec: now / 1000,
          type: 'interrupt',
          label: `${who.name}: ${ev.name}`,
          source: who.name,
          target: target?.name,
        });
      }
    } else if (ev.type === 'playerDeath' && ev.pid !== undefined && partyPids.has(ev.pid)) {
      const who = this.attribute(world, ev.pid, partyPids);
      const killer = ev.killerId !== undefined ? world.entities.get(ev.killerId) : null;
      const killerName = killer?.name;
      const killerAbility = ev.killerAbility;

      const recentEvents = this.deathRecapBuffer.getRecentEvents(ev.pid);
      const recap: DeathRecapRecord = {
        pid: ev.pid,
        playerName: who.name,
        deathTime: now,
        killerName,
        killerAbility,
        events: recentEvents,
      };

      for (const enc of [this.current, this.allTime]) {
        const t = this.tally(enc, who.pid, who.name, who.cls, partyPids, who.spec);
        t.deaths += 1;
        let list = enc.deathRecaps.get(ev.pid);
        if (!list) {
          list = [];
          enc.deathRecaps.set(ev.pid, list);
        }
        list.push(recap);

        const currPhase = enc.phases.currentPhase;
        let pt = t.phaseTallies.get(currPhase);
        if (!pt) {
          pt = newPhaseTallySnapshot();
          t.phaseTallies.set(currPhase, pt);
        }
        pt.deaths += 1;

        enc.timeline.addEvent({
          timeSec: now / 1000,
          type: 'death',
          label: who.name,
          source: killerName
            ? `${killerName} (${killerAbility ?? 'Attack'})`
            : (killerAbility ?? 'Environment'),
        });
      }
    }
  }

  resetCurrent(): void {
    this.current = null;
    this.deathRecapBuffer.clearAll();
    this.activityTracker.clear();
    this.auraTracker.clear();
  }

  resetAll(now: number): void {
    this.current = null;
    this.history = [];
    this.allTime = { ...newEncounter(now), label: 'All (session)' };
    this.deathRecapBuffer.clearAll();
    this.activityTracker.clear();
    this.auraTracker.clear();
  }

  markPhase(name: string, nowSec: number): void {
    if (!this.current) return;
    this.current.phases.markPhase(name, nowSec);
    this.current.timeline.addEvent({
      timeSec: nowSec,
      type: 'phase',
      label: `Phase: ${name}`,
    });
  }

  /** advance clocks + close the encounter once combat has clearly ended */
  update(world: IWorld, partyPids: ReadonlySet<number>, now: number): void {
    if (!this.current) return;
    this.current.duration = Math.max(1, (now - this.current.startedAt) / 1000);
    if ((now - this.lastActivity) / 1000 < ENCOUNTER_END_SECONDS) return;
    // quiet for a while — but a mob still chasing a member keeps it open
    for (const e of world.entities.values()) {
      if (
        e.kind === 'mob' &&
        !e.dead &&
        e.aggroTargetId !== null &&
        partyPids.has(e.aggroTargetId)
      ) {
        return;
      }
    }
    this.endEncounter();
  }

  // Takes no clock: a closed segment's duration ends at the LAST ACTIVITY, not
  // at the moment the idle sweep noticed, so the trailing quiet window never
  // inflates it. (The parameter was vestigial and unread; dropping it is what
  // the changed-files lint gate wanted once this file was touched.)
  endEncounter(): void {
    const enc = this.current;
    if (!enc) return;
    this.current = null;
    if (enc.tallies.size === 0) return; // nothing measured — drop it
    enc.duration = Math.max(1, (this.lastActivity - enc.startedAt) / 1000);
    enc.phases.close(enc.startedAt / 1000 + enc.duration);
    this.history.unshift(enc);
    if (this.history.length > HISTORY_CAP) this.history.pop();
    this.allTime.duration += enc.duration;
  }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

// The three meters; the canonical union lives with the row model core.
type Tab = MeterTab;

const TAB_LABEL_KEY: Record<Tab, TranslationKey> = {
  dmg: 'hud.meters.damage',
  heal: 'hud.meters.healing',
  dmgTaken: 'hud.meters.damageTaken',
  interrupts: 'hud.meters.interrupts',
  deaths: 'hud.meters.deaths',
  threat: 'hud.meters.threat',
};
const TAB_SHORT_LABEL_KEY: Record<Tab, TranslationKey> = {
  dmg: 'hud.meters.damageShort',
  heal: 'hud.meters.healingShort',
  dmgTaken: 'hud.meters.damageTakenShort',
  interrupts: 'hud.meters.interruptsShort',
  deaths: 'hud.meters.deathsShort',
  threat: 'hud.meters.threat',
};
const ALL_TABS: readonly Tab[] = ['dmg', 'heal', 'dmgTaken', 'interrupts', 'deaths', 'threat'];
/** Hud's shared tooltip painter plus the browser surfaces the frames need. */
export interface MetersDeps {
  attachTooltip: (el: HTMLElement, html: () => string) => void;
  /** Live UI zoom factor; the frame controller divides by it for author px. */
  uiScale?: () => number;
  /** Mobile-touch probe: the stylesheet owns panel placement there. */
  isMobileLayout?: () => boolean;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  sendChat?: (line: string) => void;
  /** Hud's shared right-click menu, injected so meters.ts never imports Hud. */
  openMenu?: (
    items: readonly SimpleMenuItem[],
    x: number,
    y: number,
    onSelect: (act: string) => void,
  ) => void;
  /** The hub practice coach's own deps (src/ui/hud/practice/hub_lesson_controller.ts):
   *  present only on the host document that carries #hub-lesson-coach (the
   *  game shells; absent on a bare test rig or a document without that
   *  strip). Meters constructs the controller itself, mirroring the
   *  practice DPS tracker below, so this stays the ONE seam a caller wires
   *  rather than a second construction site. */
  keybinds?: Keybinds;
  actionBarSlots?(): readonly HubActionBarSlot[];
  tooltipVisibleFor?(el: HTMLElement): boolean;
  actionButtonForSlot?(slot: number): HTMLElement | null;
  worldToScreen?(x: number, y: number, z: number): { x: number; y: number; behind: boolean };
}

/** A live controlled pet, resolved from the world for the threat tab. */
type Pet = MeterPet;

/**
 * One pooled bar. Rows are reused across renders (never rebuilt from
 * innerHTML) so the tooltip can be attached ONCE per node: rebuilding the row
 * under the cursor at the 4Hz render cadence would drop the hover and make the
 * breakdown flicker. The tooltip closure reads `pid`/`name` LIVE off this
 * record instead of capturing them.
 */
interface MeterRowNodes {
  el: HTMLElement;
  rank: HTMLElement;
  icon: HTMLElement;
  fill: HTMLElement;
  label: HTMLElement;
  num: HTMLElement;
  pid: number;
  name: string;
  /** pet name when this bar is a pet's own hate row, else null */
  petName: string | null;
  /** the entity whose hate this bar represents (member pid, or the pet's) */
  threatPid: number;
  abilityKey?: string | null;
  targetName?: string | null;
}

/** What a panel needs from its owner: the shared data and the live world. */
interface PanelHost {
  world: IWorld;
  data: MeterData;
  sendChat?(line: string): void;
  /** Live pets per owner, scanned once per render by the owner. */
  petsByOwner(): Map<number, Pet[]>;
  /** Self plus every party member, for deciding which mobs the group is on. */
  partyPids(): ReadonlySet<number>;
  attachTooltip(el: HTMLElement, html: () => string): void;
  /** Fired by a detached panel's close button. */
  onDock(tab: DetachableTab): void;
  /** Whether `tab` currently has its own window. */
  isDetached(tab: MeterTab): boolean;
  /** Open the tab's right-click menu at a viewport point. */
  openTabMenu(rows: MeterMenuRow[], x: number, y: number): void;
  openMenu?(
    items: readonly SimpleMenuItem[],
    x: number,
    y: number,
    onSelect: (act: string) => void,
  ): void;
  onNewWindow?(): void;
  mainWindowRect?(): { left: number; top: number; width: number; height: number } | null;
  resetCurrent(): void;
  resetAll(): void;
  getSettings?(): MetersSettings;
  updateSettings?(s: MetersSettings): void;
}

export interface PanelSpec {
  root: HTMLElement;
  /** null = the tabbed damage window; a tab = a detached single-meter window. */
  lockedTab: DetachableTab | null;
  /** localStorage key this panel's box persists under. Detached windows only:
   *  the tabbed window's box lives on its damageMeter registry row instead. */
  frameStorageKey?: string;
}

/**
 * One meter panel: the bar list plus its own segment paging, tooltip pool and
 * movable/resizable frame. Instance-parameterized so the tabbed damage window
 * and each detached Threat / Healing window are the SAME painter over the one
 * shared MeterData, rather than three drifting copies.
 */
export type MeterViewMode =
  | 'overview'
  | 'player_breakdown'
  | 'ability_detail'
  | 'death_recap'
  | 'comparison'
  | 'timeline'
  | 'balance_dev'
  | 'target_players';

export class MetersPanel {
  // Single source of truth for panel state:
  private selectedMetric: MeterTab;
  private selectedSegment = 0;
  private selectedPlayer: { pid: number; name: string; cls?: string } | null = null;
  private lastRender = 0;

  private viewMode: MeterViewMode = 'overview';
  private selectedAbility: { key: string; name: string; petName: string | null } | null = null;
  private selectedDeadPlayer: { pid: number; name: string } | null = null;
  private selectedPhase: string | null = null;
  private compareSegmentA = 0;
  private compareSegmentB = 1;
  private selectedTarget: string | null = null;

  get currentViewMode(): MeterViewMode {
    return this.viewMode;
  }

  get tab(): MeterTab {
    return this.selectedMetric;
  }
  set tab(val: MeterTab) {
    this.selectedMetric = val;
  }

  get viewIdx(): number {
    return this.selectedSegment;
  }
  set viewIdx(val: number) {
    this.selectedSegment = val;
  }

  get selectedPid(): number | null {
    return this.selectedPlayer ? this.selectedPlayer.pid : null;
  }
  set selectedPid(val: number | null) {
    if (val === null) {
      this.selectedPlayer = null;
      if (this.viewMode === 'player_breakdown' || this.viewMode === 'ability_detail') {
        this.viewMode = 'overview';
      }
    } else {
      const { enc } = this.viewedEncounter();
      const tally = enc?.tallies.get(val);
      this.selectedPlayer = tally
        ? { pid: val, name: tally.name, cls: tally.cls ?? undefined }
        : { pid: val, name: '' };
      this.viewMode = 'player_breakdown';
    }
  }

  private readonly root: HTMLElement;
  private readonly rowsEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly modeTrigger: HTMLElement;
  private readonly backTrigger: HTMLElement;
  private readonly segTrigger: HTMLElement;
  private rowPool: MeterRowNodes[] = [];
  private frame: MeterFrame | null = null;
  private settings: MetersSettings;
  private optionsDialog: MetersOptionsDialog | null = null;
  private readonly deps?: MetersDeps;
  /** Resolved ONCE at construction (static children of `root`, never
   *  rebuilt): tabButtonElement/historyArrowElement used to re-query on
   *  every call, which the hub practice coach (hub_lesson_controller.ts)
   *  was doing every 250ms while a lesson is active. */
  private readonly tabButtonEls: Partial<Record<Tab, HTMLElement>> = {};
  private readonly historyArrowEl: HTMLElement;

  constructor(
    private readonly spec: PanelSpec,
    private readonly host: PanelHost,
    deps?: MetersDeps,
  ) {
    this.deps = deps;
    this.settings = host.getSettings ? host.getSettings() : loadMetersSettings(deps?.storage);
    applySettingsClasses(spec.root, this.settings);
    this.selectedMetric = spec.lockedTab ?? 'dmg';
    this.root = spec.root;
    this.rowsEl = this.root.querySelector('.mt-rows') as HTMLElement;
    this.titleEl = this.root.querySelector('.mt-view') as HTMLElement;
    this.subEl = this.root.querySelector('.mt-sub') as HTMLElement;
    this.hintEl = this.root.querySelector('.mt-hint') as HTMLElement;

    // Reposition .mt-view inside .panel-title to form a single, compact 22px header bar
    const titleBar = this.root.querySelector('.panel-title') as HTMLElement | null;
    if (titleBar && this.titleEl && this.titleEl.parentElement === this.root) {
      const controlsSpan = titleBar.querySelector('span:last-child');
      if (controlsSpan) {
        controlsSpan.before(this.titleEl);
      } else {
        titleBar.appendChild(this.titleEl);
      }
    }

    // Build the triggers inside this.titleEl (.mt-view):
    // 1. Mode trigger (left): shows metric name, clickable to choose metric
    let modeTrigger = this.titleEl.querySelector('.mt-mode-trigger') as HTMLElement | null;
    if (!modeTrigger) {
      modeTrigger = document.createElement('button');
      modeTrigger.setAttribute('type', 'button');
      modeTrigger.className = 'mt-mode-trigger mt-mode-btn';
      this.titleEl.appendChild(modeTrigger);
    }
    this.modeTrigger = modeTrigger;
    this.modeTrigger.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const rect = this.modeTrigger.getBoundingClientRect();
      this.openModeMenu(rect.left, rect.bottom + 2);
    });

    // 2. Back button trigger (left, shown during player breakdown): "‹ Stephami - Daño"
    let backTrigger = this.titleEl.querySelector('.mt-back-btn') as HTMLElement | null;
    if (!backTrigger) {
      backTrigger = document.createElement('button');
      backTrigger.setAttribute('type', 'button');
      backTrigger.className = 'x-btn mt-back-btn';
      this.titleEl.appendChild(backTrigger);
    }
    this.backTrigger = backTrigger;
    this.backTrigger.style.display = 'none';
    this.backTrigger.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.navigateBack();
    });

    // 3. Segment trigger (right): shows segment name, clickable to choose segment
    let segTrigger = this.titleEl.querySelector('.mt-seg-trigger') as HTMLElement | null;
    if (!segTrigger) {
      segTrigger = document.createElement('button');
      segTrigger.setAttribute('type', 'button');
      segTrigger.className = 'mt-seg-trigger';
      this.titleEl.appendChild(segTrigger);
    }
    this.segTrigger = segTrigger;
    this.segTrigger.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const rect = this.segTrigger.getBoundingClientRect();
      this.openEncounterMenu(rect.left, rect.bottom + 2);
    });

    // Clicking anywhere else on titleEl (e.g. titleEl.click() in tests) opens the segment menu
    this.titleEl.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement | null;
      if (target?.closest('.mt-mode-trigger') || target?.closest('.mt-back-btn')) return;
      ev.stopPropagation();
      const rect = this.titleEl.getBoundingClientRect();
      this.openEncounterMenu(rect.left, rect.bottom + 2);
    });

    // Wire any .mt-mode-btn present in the panel:
    this.root.querySelectorAll('.mt-mode-btn').forEach((btn) => {
      if (btn !== this.modeTrigger) {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const rect = (btn as HTMLElement).getBoundingClientRect();
          this.openModeMenu(rect.left, rect.bottom + 2);
        });
      }
    });

    // Right-clicking anywhere on the panel opens the mode selection menu
    this.root.addEventListener('contextmenu', (ev) => {
      const target = ev.target as HTMLElement | null;
      if (target?.closest('.mt-seg-trigger')) return;
      if (target?.closest('.mt-reset')) return;
      if (target?.closest('.mt-settings')) return;
      if (target?.closest('.mt-tab')) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.openModeMenu(ev.clientX, ev.clientY);
    });

    if (!spec.lockedTab) {
      for (const tab of ALL_TABS) {
        const tabButton = this.root.querySelector(
          `.mt-tab[data-tab="${tab}"]`,
        ) as HTMLElement | null;
        if (!tabButton) continue;
        this.tabButtonEls[tab] = tabButton;
        tabButton.textContent = t(TAB_SHORT_LABEL_KEY[tab]);
        tabButton.addEventListener('click', () => {
          this.selectedMetric = tab;
          this.selectedPlayer = null;
          this.refreshTabs();
          this.render(true);
        });
        // Right-clicking a tab NAME offers that meter's own window: "Separate"
        // while it is docked, "Regroup" once it has one. Damage is the home
        // meter and yields no rows, so its right-click is left alone rather
        // than opening an inert menu.
        tabButton.addEventListener('contextmenu', (ev) => {
          const rows = buildMeterTabMenu({
            tab,
            detached: host.isDetached(tab),
            detachable: DETACHABLE,
          });
          if (rows.length === 0) return;
          ev.preventDefault();
          ev.stopPropagation();
          host.openTabMenu(rows, ev.clientX, ev.clientY);
        });
      }
      this.refreshTabs();
    } else {
      const label = this.root.querySelector('.mt-title-label') as HTMLElement | null;
      if (label) label.textContent = t(TAB_LABEL_KEY[spec.lockedTab]);
    }

    const newWin = this.root.querySelector('.mt-new-window') as HTMLElement | null;
    if (newWin) {
      newWin.setAttribute('title', t('hud.meters.newWindow'));
      newWin.setAttribute('aria-label', t('hud.meters.newWindow'));
      newWin.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.host.onNewWindow?.();
      });
    }

    const prev = this.root.querySelector('.mt-prev') as HTMLElement | null;
    const next = this.root.querySelector('.mt-next') as HTMLElement | null;
    const close = this.root.querySelector('.mt-close') as HTMLElement | null;
    const reset = this.root.querySelector('.mt-reset') as HTMLElement | null;
    this.historyArrowEl = prev as HTMLElement;
    if (prev) {
      prev.setAttribute('title', t('hud.meters.olderSegment'));
      prev.addEventListener('click', () => this.page(1));
    }
    if (next) {
      next.setAttribute('title', t('hud.meters.newerSegment'));
      next.addEventListener('click', () => this.page(-1));
    }
    const closeKey: TranslationKey = spec.lockedTab ? 'hudChrome.meters.dock' : 'hud.meters.close';
    if (close) {
      close.setAttribute('title', t(closeKey));
      close.setAttribute('aria-label', t(closeKey));
      close.addEventListener('click', () => {
        if (spec.lockedTab) host.onDock(spec.lockedTab);
        else this.setOpen(false);
      });
    }
    if (reset) {
      reset.setAttribute('title', t('hud.meters.resetHint'));
      reset.setAttribute('aria-label', t('hud.meters.reset'));
      reset.addEventListener('click', (ev) => {
        if (ev.shiftKey) host.resetAll();
        else host.resetCurrent();
      });
      reset.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const open = host.openMenu;
        if (open) {
          open(
            [
              { act: 'current', label: t('hud.meters.resetFight') },
              { act: 'all', label: t('hud.meters.resetAll') },
            ],
            ev.clientX,
            ev.clientY,
            (act) => {
              if (act === 'all') host.resetAll();
              else host.resetCurrent();
            },
          );
        } else {
          host.resetAll();
        }
      });
    }

    const settingsBtn = this.root.querySelector('.mt-settings') as HTMLElement | null;
    if (settingsBtn) {
      settingsBtn.setAttribute('title', t('hudChrome.meters.settingsTitle'));
      settingsBtn.setAttribute('aria-label', t('hudChrome.meters.settingsTitle'));
      settingsBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.openOptionsDialog();
      });
      settingsBtn.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const rect = settingsBtn.getBoundingClientRect();
        this.openSettingsMenu(rect.left, rect.bottom + 2);
      });
    }

    // The panel title doubles as the move handle (the chat box uses its tab
    // strip the same way); a press on any button inside it stays that button's.
    // DETACHED windows only: the tabbed damage window is a movable HUD frame
    // (HUD_FRAME_SPECS 'damageMeter'), so the Unlock Interface registry owns
    // its drag, resize, hide and persistence instead of a private MeterFrame.
    const title = this.root.querySelector('.panel-title') as HTMLElement | null;
    if (
      title &&
      spec.lockedTab &&
      spec.frameStorageKey &&
      deps?.storage &&
      deps.uiScale &&
      deps.isMobileLayout
    ) {
      this.frame = new MeterFrame(
        {
          el: this.root,
          handles: [this.root],
          storageKey: spec.frameStorageKey,
          fallbackSize: { w: METERS_DEFAULT_WIDTH, h: METERS_DEFAULT_HEIGHT },
          // Only detached windows reach here, and they carry little chrome.
          limits: METER_FRAME_LIMITS,
          externalSnapTargets: () => {
            const mainRect = host.mainWindowRect?.();
            if (!mainRect) return [];
            return [{ id: 'main-meters-window', geo: mainRect }];
          },
        },
        {
          document,
          window,
          storage: deps.storage,
          isMobileLayout: deps.isMobileLayout,
          uiScale: deps.uiScale,
        },
      );
      this.frame.init();
    }
  }

  getFrame(): MeterFrame | null {
    return this.frame;
  }

  private openEncounterMenu(x: number, y: number): void {
    const open = this.host.openMenu;
    if (!open) return;
    const h = this.host.data.history;
    const items: SimpleMenuItem[] = [];

    const currentEnc = this.host.data.current ?? h[0] ?? null;
    let currentLabel = this.host.data.current
      ? t('hud.meters.current')
      : currentEnc
        ? t('hud.meters.lastFight')
        : t('hud.meters.current');
    if (currentEnc && currentEnc.tallies.size > 0) {
      const name = currentEnc.mainMobTemplateId
        ? tEntity({ kind: 'mob', id: currentEnc.mainMobTemplateId, field: 'name' })
        : currentEnc.mainMobName || currentEnc.label;
      currentLabel += ` (${name}, ${fmtDuration(currentEnc.duration)})`;
    }
    items.push({
      act: '0',
      label: this.viewIdx === 0 ? `* ${currentLabel}` : currentLabel,
    });

    for (let i = 0; i < h.length; i++) {
      const idx = i + 1;
      const enc = h[i];
      const name = enc.mainMobTemplateId
        ? tEntity({ kind: 'mob', id: enc.mainMobTemplateId, field: 'name' })
        : enc.mainMobName || enc.label;
      const baseLabel = `${t('hud.meters.fightIndex', { index: idx })}: ${name} (${fmtDuration(enc.duration)})`;
      items.push({
        act: String(idx),
        label: this.viewIdx === idx ? `* ${baseLabel}` : baseLabel,
      });
    }

    const allIdx = h.length + 1;
    const allEnc = this.host.data.allTime;
    const allLabel = `${t('hud.meters.allSession')} (${fmtDuration(allEnc.duration)})`;
    items.push({
      act: String(allIdx),
      label: this.viewIdx === allIdx ? `* ${allLabel}` : allLabel,
    });

    open(items, x, y, (act) => {
      const idx = Number.parseInt(act, 10);
      if (!Number.isNaN(idx)) {
        this.viewIdx = idx;
        this.selectedPid = null;
        this.viewMode = 'overview';
        this.selectedPhase = null;
        this.render(true);
      }
    });
  }

  navigateBack(): void {
    if (this.viewMode === 'ability_detail') {
      this.viewMode = 'player_breakdown';
      this.selectedAbility = null;
    } else if (this.viewMode === 'target_players') {
      this.viewMode = this.selectedAbility ? 'ability_detail' : 'overview';
      this.selectedTarget = null;
    } else if (this.viewMode === 'death_recap') {
      this.viewMode = 'overview';
      this.selectedDeadPlayer = null;
    } else if (this.viewMode === 'player_breakdown') {
      this.viewMode = 'overview';
      this.selectedPlayer = null;
    } else {
      this.viewMode = 'overview';
      this.selectedPlayer = null;
      this.selectedAbility = null;
      this.selectedDeadPlayer = null;
      this.selectedTarget = null;
    }
    this.render(true);
  }

  showDeathRecap(pid: number, name?: string): void {
    this.selectedDeadPlayer = { pid, name: name ?? '' };
    this.viewMode = 'death_recap';
    this.render(true);
  }

  showAbilityDetail(abilityKey: string, petName: string | null = null, name?: string): void {
    this.selectedAbility = {
      key: abilityKey,
      name: name ?? abilityDisplayNameFromSource(abilityKey),
      petName,
    };
    this.viewMode = 'ability_detail';
    this.render(true);
  }

  showTimeline(): void {
    this.viewMode = 'timeline';
    this.render(true);
  }

  showComparison(segA = 0, segB = 1): void {
    this.compareSegmentA = segA;
    this.compareSegmentB = segB;
    this.viewMode = 'comparison';
    this.render(true);
  }

  showBalanceDev(): void {
    this.viewMode = 'balance_dev';
    this.render(true);
  }

  showTargetPlayers(targetName: string): void {
    this.selectedTarget = targetName;
    this.viewMode = 'target_players';
    this.render(true);
  }

  copyToClipboardOrLog(content: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(content).catch(() => {
        // clipboard unavailable
      });
    }
  }

  exportText(): string {
    const { enc } = this.viewedEncounter();
    return enc ? exportEncounterAsText(enc) : '';
  }

  exportJson(): string {
    const { enc } = this.viewedEncounter();
    return enc ? exportEncounterAsJson(enc) : '{}';
  }

  reportToChat(): void {
    const { enc, viewName } = this.viewedEncounter();
    if (!enc) return;
    const text = formatChatReport(enc, this.tab, viewName, 5);
    if (this.host.sendChat) {
      this.host.sendChat(text);
    }
    this.copyToClipboardOrLog(text);
    const prevSub = this.subEl.textContent;
    this.subEl.textContent = t('hudChrome.meters.reportSent');
    setTimeout(() => {
      if (this.subEl.textContent === t('hudChrome.meters.reportSent')) {
        this.subEl.textContent = prevSub;
      }
    }, 2000);
  }

  relocalize(): void {
    if (this.spec.lockedTab) {
      const label = this.root.querySelector('.mt-title-label') as HTMLElement | null;
      if (label) label.textContent = t(TAB_LABEL_KEY[this.spec.lockedTab]);
    }
    const newWin = this.root.querySelector('.mt-new-window') as HTMLElement | null;
    if (newWin) {
      newWin.setAttribute('title', t('hud.meters.newWindow'));
      newWin.setAttribute('aria-label', t('hud.meters.newWindow'));
    }
    const prev = this.root.querySelector('.mt-prev') as HTMLElement | null;
    if (prev) prev.setAttribute('title', t('hud.meters.olderSegment'));
    const next = this.root.querySelector('.mt-next') as HTMLElement | null;
    if (next) next.setAttribute('title', t('hud.meters.newerSegment'));
    const close = this.root.querySelector('.mt-close') as HTMLElement | null;
    if (close) {
      const closeKey: TranslationKey = this.spec.lockedTab
        ? 'hudChrome.meters.dock'
        : 'hud.meters.close';
      close.setAttribute('title', t(closeKey));
      close.setAttribute('aria-label', t(closeKey));
    }
    const reset = this.root.querySelector('.mt-reset') as HTMLElement | null;
    if (reset) {
      reset.setAttribute('title', t('hud.meters.resetHint'));
      reset.setAttribute('aria-label', t('hud.meters.reset'));
    }
    const settingsBtn = this.root.querySelector('.mt-settings') as HTMLElement | null;
    if (settingsBtn) {
      settingsBtn.setAttribute('title', t('hudChrome.meters.settingsTitle'));
      settingsBtn.setAttribute('aria-label', t('hudChrome.meters.settingsTitle'));
    }
    this.optionsDialog?.relocalize();
    this.refreshTabs();
    this.render(true);
  }

  setSettings(s: MetersSettings): void {
    this.settings = { ...s };
    applySettingsClasses(this.root, this.settings);
    this.render(true);
  }

  openOptionsDialog(): void {
    if (!this.optionsDialog) {
      this.optionsDialog = new MetersOptionsDialog({
        getSettings: () => (this.host.getSettings ? this.host.getSettings() : this.settings),
        onSettingsChanged: (s) => {
          if (this.host.updateSettings) {
            this.host.updateSettings(s);
          } else {
            this.setSettings(s);
            saveMetersSettings(this.settings, this.deps?.storage);
          }
        },
        storage: this.deps?.storage,
      });
    }
    this.optionsDialog.open();
  }

  openSettingsMenu(x: number, y: number): void {
    const open = this.host.openMenu;
    if (!open) return;
    const s = { ...this.settings };
    const items: SimpleMenuItem[] = [
      {
        act: 'density',
        label:
          s.density === 'compact'
            ? `* ${t('hudChrome.meters.densityCompact')}`
            : t('hudChrome.meters.densityStandard'),
      },
      {
        act: 'opacity',
        label:
          s.opacity === 'glass'
            ? `* ${t('hudChrome.meters.bgGlass')}`
            : s.opacity === 'solid'
              ? `* ${t('hudChrome.meters.bgSolid')}`
              : `* ${t('hudChrome.meters.bgMinimal')}`,
      },
      {
        act: 'numbers',
        label:
          s.numberFormat === 'detailed'
            ? `* ${t('hudChrome.meters.numDetailed')}`
            : t('hudChrome.meters.numCompact'),
      },
      {
        act: 'raid_totals',
        label: s.showRaidTotals
          ? `* ${t('hudChrome.meters.raidTotalsOn')}`
          : t('hudChrome.meters.raidTotalsOff'),
      },
    ];

    open(items, x, y, (act) => {
      if (act === 'density') {
        s.density = s.density === 'compact' ? 'standard' : 'compact';
      } else if (act === 'opacity') {
        s.opacity = s.opacity === 'glass' ? 'solid' : s.opacity === 'solid' ? 'minimal' : 'glass';
      } else if (act === 'numbers') {
        s.numberFormat = s.numberFormat === 'detailed' ? 'compact' : 'detailed';
      } else if (act === 'raid_totals') {
        s.showRaidTotals = !s.showRaidTotals;
      }
      if (this.host.updateSettings) {
        this.host.updateSettings(s);
      } else {
        this.setSettings(s);
        saveMetersSettings(this.settings, this.deps?.storage);
      }
    });
  }

  private formatVal(v: number): string {
    if (this.settings.numberFormat === 'detailed') {
      return formatNumber(Math.round(v), { maximumFractionDigits: 0 });
    }
    return fmtNum(v);
  }

  openModeMenu(x: number, y: number): void {
    const open = this.host.openMenu;
    if (!open) return;
    const items: SimpleMenuItem[] = ALL_TABS.map((tab) => {
      const isCurrent = this.tab === tab;
      const label = t(TAB_LABEL_KEY[tab]);
      return {
        act: tab,
        label: isCurrent ? `* ${label}` : label,
      };
    });
    open(items, x, y, (act) => {
      if (ALL_TABS.includes(act as Tab)) {
        this.tab = act as Tab;
        this.selectedPid = null;
        this.refreshTabs();
        this.render(true);
      }
    });
  }

  getSelectedPid(): number | null {
    return this.selectedPid;
  }

  selectPlayer(pid: number | null): void {
    this.selectedPid = pid;
    this.render(true);
  }

  get element(): HTMLElement {
    return this.root;
  }

  get isOpen(): boolean {
    // A framed panel lays out as a column, an unframed one as a plain block;
    // either value means open, and only 'none' / '' mean closed.
    const { display } = this.root.style;
    return display === 'block' || display === 'flex';
  }

  restoreSavedLayout(): void {
    this.frame?.restoreSavedLayout();
  }

  reapplyFrame(): void {
    this.frame?.refresh();
  }

  setOpen(on: boolean): void {
    this.root.style.display = on ? (this.isFramed ? 'flex' : 'block') : 'none';
    if (!this.spec.lockedTab) document.body.classList.toggle('meters-open', on);
    if (on) {
      // A box saved at another viewport must be re-clamped before it paints.
      this.frame?.refresh();
      this.render(true);
    }
  }

  /** Whether a custom box applies: a detached window's own MeterFrame, or the
   *  tabbed window's registry mover (which reports through setRegistryFramed
   *  since its display flip must be inline; see the mt-framed CSS comment). */
  private get isFramed(): boolean {
    return this.registryFramed || this.frame?.isFramed === true;
  }

  private registryFramed = false;

  /** The damageMeter registry row's onPositioned arm: while a custom position
   *  applies, an OPEN panel lays out as the fixed-height scrolling column. */
  setRegistryFramed(active: boolean): void {
    this.registryFramed = active;
    if (this.isOpen) this.root.style.display = active ? 'flex' : 'block';
  }

  /** Switch the tabbed window's meter (used when a tab pops out). */
  showTab(tab: Tab): void {
    if (this.spec.lockedTab) return;
    this.tab = tab;
    this.selectedPid = null;
    this.refreshTabs();
    this.render(true);
  }

  get activeTab(): Tab {
    return this.tab;
  }

  /** This panel's tab button for `tab`, or null on a locked (detached) panel,
   *  which has no tab strip to click at all. Read by the hub practice coach
   *  (hub_lesson_controller.ts) to glow the button its "switch tabs" step
   *  names, never by anything on a per-frame path. */
  tabButtonElement(tab: Tab): HTMLElement | null {
    if (this.spec.lockedTab) return null;
    return this.tabButtonEls[tab] ?? null;
  }

  /** The "older segment" paging arrow: what a player presses to look back at
   *  a run that just finished. Read by the hub practice coach's inspect-run
   *  step, same non-hot-path caveat as tabButtonElement. */
  get historyArrowElement(): HTMLElement | null {
    return this.historyArrowEl;
  }

  /** Identity of the encounter segment currently displayed on this panel, and
   *  whether it is the live "current" one: the hub practice coach's
   *  history-inspection check needs BOTH (a click that pages to the wrong
   *  fight, the all-time roll-up, or back onto the still-live segment must
   *  not count as "inspecting that finished run"). Not on a per-frame path. */
  viewedEncounterInfo(): { startedAt: number; isCurrent: boolean } | null {
    const { enc } = this.viewedEncounter();
    if (!enc) return null;
    return { startedAt: enc.startedAt, isCurrent: enc === this.host.data.current };
  }

  /** The bar for `pid`'s OWN row (never a pet's) if one is currently laid
   *  out and visible on this panel's tab, else null. Read by the hub
   *  practice coach's read-row step; not on a per-frame path. */
  rowElementForPid(pid: number): HTMLElement | null {
    for (const row of this.rowPool) {
      if (row.el.style.display === 'none') continue;
      if (row.pid === pid && row.petName === null) return row.el;
    }
    return null;
  }

  /** Drop this panel's custom box, returning it to the stylesheet anchor. */
  resetFrame(): void {
    this.frame?.reset();
  }

  private page(dir: number): void {
    const max = this.host.data.history.length + 1; // + all-time slot
    this.viewIdx = Math.max(0, Math.min(max, this.viewIdx + dir));
    this.selectedPid = null;
    this.render(true);
  }

  private refreshTabs(): void {
    this.root.querySelectorAll('.mt-tab').forEach((el) => {
      el.classList.toggle('on', (el as HTMLElement).dataset.tab === this.tab);
      el.classList.toggle('is-on', (el as HTMLElement).dataset.tab === this.tab);
    });
  }

  /** Called on the hud frame; repaints at ~4Hz while open. */
  update(now: number): void {
    if (!this.isOpen || now - this.lastRender < 250) return;
    this.render();
  }

  private viewedEncounter(): { enc: Encounter | null; viewName: string } {
    const h = this.host.data.history;
    if (this.viewIdx === h.length + 1 || (this.viewIdx > 0 && h.length === 0)) {
      return { enc: this.host.data.allTime, viewName: t('hud.meters.allSession') };
    }
    if (this.viewIdx === 0) {
      const enc = this.host.data.current ?? h[0] ?? null;
      return {
        enc,
        viewName: this.host.data.current
          ? t('hud.meters.current')
          : enc
            ? t('hud.meters.lastFight')
            : t('hud.meters.current'),
      };
    }
    return {
      enc: h[this.viewIdx - 1] ?? null,
      viewName: t('hud.meters.fightIndex', { index: this.viewIdx }),
    };
  }

  render(force = false): void {
    if (!this.isOpen && !force) return;
    this.lastRender = performance.now();
    const { enc, viewName } = this.viewedEncounter();
    const metricLabel = t(TAB_LABEL_KEY[this.tab]);

    if (!enc || enc.tallies.size === 0) {
      this.selectedPlayer = null;
      this.viewMode = 'overview';
      this.backTrigger.style.display = 'none';
      this.modeTrigger.style.display = '';
      this.segTrigger.style.display = '';
      this.modeTrigger.innerHTML = `<span class="mt-title-text">${metricLabel}</span> <span class="mt-arrow">▾</span>`;
      this.segTrigger.innerHTML = `<span class="mt-title-text">${viewName}</span> <span class="mt-arrow">▾</span>`;
      this.subEl.textContent = t('hud.meters.noCombat');

      let emptyEl = this.rowsEl.querySelector('.mt-empty') as HTMLElement | null;
      if (!emptyEl) {
        emptyEl = document.createElement('div');
        emptyEl.className = 'mt-empty';
        this.rowsEl.appendChild(emptyEl);
      }
      emptyEl.textContent = t('hud.meters.noCombat');
      emptyEl.style.display = 'flex';

      const showHint = this.viewIdx === 0 && this.tab !== 'threat';
      this.hintEl.textContent = showHint ? t('hudChrome.meters.autoShowHint') : '';
      this.hintEl.style.display = showHint ? 'block' : 'none';
      for (const row of this.rowPool) row.el.style.display = 'none';
      return;
    }

    const emptyEl = this.rowsEl.querySelector('.mt-empty') as HTMLElement | null;
    if (emptyEl) emptyEl.style.display = 'none';

    this.hintEl.textContent = '';
    this.hintEl.style.display = 'none';

    if (this.viewMode === 'comparison') {
      this.renderComparisonView(viewName);
      return;
    }
    if (this.viewMode === 'timeline') {
      this.renderTimelineView(enc, viewName);
      return;
    }
    if (this.viewMode === 'balance_dev') {
      this.renderBalanceView(enc, viewName);
      return;
    }
    if (this.viewMode === 'death_recap' && this.selectedDeadPlayer) {
      this.renderDeathRecap(enc, viewName);
      return;
    }
    if (this.viewMode === 'ability_detail' && this.selectedPlayer && this.selectedAbility) {
      this.renderAbilityDetail(enc, viewName);
      return;
    }
    if (this.viewMode === 'target_players' && this.selectedTarget) {
      this.renderTargetPlayersView(enc, viewName);
      return;
    }
    if (this.selectedPlayer !== null) {
      const tally = enc.tallies.get(this.selectedPlayer.pid);
      if (tally) {
        this.renderPlayerBreakdown(enc, tally, viewName);
        return;
      }
      this.selectedPlayer = null;
      this.viewMode = 'overview';
    }

    this.renderOverview(enc, viewName, metricLabel);
  }

  private renderOverview(enc: Encounter, viewName: string, metricLabel: string): void {
    this.backTrigger.style.display = 'none';
    this.modeTrigger.style.display = '';
    this.segTrigger.style.display = '';
    this.modeTrigger.innerHTML = `<span class="mt-title-text">${metricLabel}</span> <span class="mt-arrow">▾</span>`;
    const segText = this.selectedPhase ? `${viewName} [${this.selectedPhase}]` : viewName;
    this.segTrigger.innerHTML = `<span class="mt-title-text">${segText}</span> <span class="mt-arrow">▾</span>`;

    const isThreat = this.tab === 'threat';
    const petsByOwner = isThreat ? this.host.petsByOwner() : null;
    const { mob, liveThreat, frozen } = this.threatSubject(enc, petsByOwner);
    const aggroPid = mob && !mob.dead ? mob.aggroTargetId : null;
    const subjectName = mob
      ? tEntity({ kind: 'mob', id: mob.templateId, field: 'name' })
      : enc.mainMobTemplateId
        ? tEntity({ kind: 'mob', id: enc.mainMobTemplateId, field: 'name' })
        : enc.mainMobName;
    const encounterLabel =
      enc.label === 'Combat' || enc.label === 'All (session)'
        ? viewName
        : enc.mainMobTemplateId
          ? tEntity({ kind: 'mob', id: enc.mainMobTemplateId, field: 'name' })
          : enc.mainMobName || enc.label; // PvP segments carry the opponent's name as the label
    // Say plainly when the bars are the damage fallback rather than hate: the
    // numbers are honest, but under a "Threat" heading they read as hate and a
    // player acts on them. A FROZEN read is real hate too, just no longer
    // live (the subject died or left mid-segment), so it gets its own line
    // rather than reading like the damage fallback.

    let talliesIterable = enc.tallies.values();
    if (this.selectedPhase) {
      const filteredTallies: MemberTally[] = [];
      for (const t of enc.tallies.values()) {
        const pt = t.phaseTallies.get(this.selectedPhase);
        if (pt) {
          filteredTallies.push({
            ...t,
            dmg: pt.dmg,
            heal: pt.heal,
            dmgTaken: pt.dmgTaken,
          });
        }
      }
      talliesIterable = filteredTallies.values();
    }

    const rows = buildMeterRows({
      tallies: talliesIterable,
      tab: this.tab,
      liveThreat,
      petsByOwner,
      mainMobId: enc.mainMobId,
      aggroPid,
    });

    const totalGroupAmount = rows.reduce((sum, r) => sum + r.value, 0);
    let summaryText = t('hud.meters.segmentSummary', {
      label: encounterLabel,
      duration: fmtDuration(enc.duration),
    });
    if (totalGroupAmount > 0) {
      const dur = Math.max(1, enc.duration);
      if (this.tab === 'interrupts' || this.tab === 'deaths') {
        summaryText = `${encounterLabel} - ${fmtDuration(enc.duration)} (Total: ${this.formatVal(totalGroupAmount)})`;
      } else {
        const rate = totalGroupAmount / dur;
        summaryText = `${encounterLabel} - ${fmtDuration(enc.duration)} (Total: ${this.formatVal(totalGroupAmount)}, ${fmtPerSecond(rate)})`;
      }
      if (this.settings.showRaidTotals && !isThreat) {
        if (this.tab === 'heal') {
          const totalRaidDmg = [...enc.tallies.values()].reduce((sum, t) => sum + t.dmg, 0);
          summaryText += ` · Group: ${fmtPerSecond(totalRaidDmg / dur)} DPS`;
        } else if (this.tab === 'dmg') {
          const totalRaidHeal = [...enc.tallies.values()].reduce((sum, t) => sum + t.heal, 0);
          summaryText += ` · Group: ${fmtPerSecond(totalRaidHeal / dur)} HPS`;
        }
      }
    }
    if (this.selectedPhase) {
      summaryText += ` [Phase: ${this.selectedPhase}]`;
    }
    this.subEl.textContent = isThreat
      ? liveThreat
        ? frozen
          ? t('hudChrome.meters.threatFrozen', { name: subjectName })
          : t('hud.meters.target', { name: subjectName })
        : subjectName
          ? t('hudChrome.meters.threatFallback', { name: subjectName })
          : t('hud.meters.noTargetEngaged')
      : summaryText;

    let displayRows = rows;
    if (this.settings.maxVisibleRows > 0 && rows.length > this.settings.maxVisibleRows) {
      const max = this.settings.maxVisibleRows;
      const topRows = rows.slice(0, max);
      if (this.settings.alwaysShowMe) {
        const myPid = this.host.world.player?.id;
        const alreadyInTop = topRows.some((r) => r.tally.pid === myPid);
        if (!alreadyInTop && myPid !== undefined) {
          const myRow = rows.find((r) => r.tally.pid === myPid);
          if (myRow) {
            displayRows = [...topRows.slice(0, max - 1), myRow];
          } else {
            displayRows = topRows;
          }
        } else {
          displayRows = topRows;
        }
      } else {
        displayRows = topRows;
      }
    }

    this.syncRowPool(displayRows.length);
    displayRows.forEach(
      ({ rank, tally, petName, threatPid, value, fill, percent, hasAggro }, i) => {
        const row = this.rowPool[i];
        row.pid = tally.pid;
        row.name = tally.name;
        row.petName = petName;
        row.threatPid = threatPid;
        row.abilityKey = undefined;
        row.targetName = undefined;
        row.el.style.display = 'block';
        row.fill.style.width = `${Math.max(4, fill * 100)}%`;
        const hex = getClassColor(tally.cls);
        row.fill.style.background = `linear-gradient(90deg, ${hex}dd 0%, ${hex}88 100%)`;
        row.rank.textContent = this.settings.showRank ? `${rank}.` : '';
        row.label.textContent = petName ?? tally.name;
        if (!petName && tally.pid) {
          if (!tally.spec) {
            if (tally.pid === this.host.world.player.id && this.host.world.talentSpec) {
              tally.spec = this.host.world.talentSpec;
            } else {
              const member = this.host.world.partyInfo?.members.find((m) => m.pid === tally.pid);
              if (member?.spec) tally.spec = member.spec;
            }
          }
        }
        const iconUrl = petName
          ? null
          : tally.cls && this.settings.showClassIcon
            ? meterIconUrl(tally.cls, tally.spec)
            : null;
        if (iconUrl) {
          row.icon.style.backgroundImage = `url("${iconUrl}")`;
          row.icon.style.display = 'block';
          row.el.classList.add('has-icon');
        } else {
          row.icon.style.display = 'none';
          row.el.classList.remove('has-icon');
        }
        if (isThreat) {
          row.num.textContent = this.formatVal(value);
        } else if (this.tab === 'interrupts' || this.tab === 'deaths') {
          const pct = this.settings.showPercent
            ? ` <span class="mt-val-pct">${fmtPercent(percent)}</span>`
            : '';
          row.num.innerHTML = `<span class="mt-val-amount">${this.formatVal(value)}</span>${pct}`;
        } else {
          const rate = value / Math.max(1, enc.duration);
          if (this.settings.numberFormat === 'damage_dps') {
            const dps = this.settings.showDps
              ? ` <span class="mt-val-sep">|</span> <span class="mt-val-rate">${fmtNum(rate)}</span>`
              : '';
            const pct = this.settings.showPercent
              ? ` <span class="mt-val-pct">${fmtPercent(percent)}</span>`
              : '';
            row.num.innerHTML = `<span class="mt-val-amount">${this.formatVal(value)}</span>${dps}${pct}`;
          } else {
            const dps = this.settings.showDps
              ? ` <span class="mt-val-rate">${fmtPerSecond(rate)}</span>`
              : '';
            const pct = this.settings.showPercent
              ? ` <span class="mt-val-pct">${fmtPercent(percent)}</span>`
              : '';
            row.num.innerHTML = `<span class="mt-val-amount">${this.formatVal(value)}</span>${dps}${pct}`;
          }
        }
        row.el.classList.toggle('aggro', hasAggro);
        const isPinned =
          this.settings.alwaysShowMe &&
          tally.pid === this.host.world.player?.id &&
          i === displayRows.length - 1 &&
          rows.length > displayRows.length;
        row.el.classList.toggle('mt-row-pinned', isPinned);
      },
    );
    for (let i = displayRows.length; i < this.rowPool.length; i++) {
      this.rowPool[i].el.style.display = 'none';
    }
  }

  private renderPlayerBreakdown(enc: Encounter, tally: MemberTally, viewName: string): void {
    const metricLabel = t(TAB_LABEL_KEY[this.tab]);
    this.modeTrigger.style.display = 'none';
    this.backTrigger.style.display = 'inline-flex';
    this.backTrigger.innerHTML = `<span class="mt-back-arrow">‹</span> <span class="mt-back-text">${esc(tally.name)} - ${esc(metricLabel)}</span>`;
    this.segTrigger.style.display = '';
    this.segTrigger.innerHTML = `<span class="mt-title-text">${viewName}</span> <span class="mt-arrow">▾</span>`;

    let source: Map<string, BreakdownEntry>;
    if (this.tab === 'heal') source = tally.healByAbility;
    else if (this.tab === 'dmgTaken') source = tally.dmgTakenByAbility;
    else if (this.tab === 'interrupts') source = tally.interruptsByAbility;
    else source = tally.dmgByAbility;

    const entries = [...source.values()];
    const model = buildMeterBreakdown(
      entries,
      this.tab === 'interrupts' || this.tab === 'deaths' ? 1 : enc.duration,
    );

    const hitCount = tally.hits || 0;
    const critCount = tally.crits || 0;
    const critPct = hitCount > 0 ? Math.round((critCount / hitCount) * 100) : 0;
    const activity = this.host.data.activityTracker.calculateActivity(
      tally.pid,
      enc.startedAt / 1000,
      enc.duration,
    );
    this.subEl.textContent = `${t('hud.meters.hits', { count: hitCount })} | ${t('hud.meters.criticals', { count: critCount })} (${critPct}%) | Actividad: ${activity.activityPercent}%`;

    const hex = getClassColor(tally.cls);

    this.syncRowPool(model.rows.length);
    model.rows.forEach((r, i) => {
      const row = this.rowPool[i];
      row.pid = tally.pid;
      const abilityName = r.ability
        ? abilityDisplayNameFromSource(r.ability)
        : t('hudChrome.meters.melee');
      const label = r.petName ? `${r.petName}: ${abilityName}` : abilityName;
      row.name = label;
      row.petName = r.petName;
      row.abilityKey = r.ability;
      row.targetName = undefined;
      row.threatPid = -1;
      row.el.style.display = 'block';
      row.el.classList.remove('aggro');
      row.fill.style.width = `${Math.max(4, r.fill * 100)}%`;
      row.fill.style.background = `linear-gradient(90deg, ${hex}cc 0%, ${hex}66 100%)`;
      row.rank.textContent = `${i + 1}.`;
      row.label.textContent = label;

      let iconUrl: string | null = null;
      try {
        iconUrl = iconDataUrl('ability', r.ability ?? 'attack', 16);
      } catch {
        iconUrl = null;
      }
      if (iconUrl) {
        row.icon.style.backgroundImage = `url("${iconUrl}")`;
        row.icon.style.display = 'block';
        row.el.classList.add('has-icon');
      } else {
        row.icon.style.display = 'none';
        row.el.classList.remove('has-icon');
      }

      if (this.tab === 'interrupts' || this.tab === 'deaths') {
        row.num.innerHTML = `<span class="mt-val-amount">${fmtNum(r.amount)}</span> <span class="mt-val-pct">${fmtPercent(r.share)}</span>`;
      } else {
        row.num.innerHTML = `<span class="mt-val-amount">${fmtNum(r.amount)}</span> <span class="mt-val-pct">${fmtPercent(r.share)}</span>`;
      }
    });
    for (let i = model.rows.length; i < this.rowPool.length; i++) {
      this.rowPool[i].el.style.display = 'none';
    }
  }

  private renderAbilityDetail(enc: Encounter, viewName: string): void {
    if (!this.selectedPlayer || !this.selectedAbility) return;
    const tally = enc.tallies.get(this.selectedPlayer.pid);
    if (!tally) return;

    this.modeTrigger.style.display = 'none';
    this.backTrigger.style.display = 'inline-flex';
    this.backTrigger.innerHTML = `<span class="mt-back-arrow">‹</span> <span class="mt-back-text">${esc(this.selectedAbility.name)}</span>`;
    this.segTrigger.style.display = '';
    this.segTrigger.innerHTML = `<span class="mt-title-text">${viewName}</span> <span class="mt-arrow">▾</span>`;

    let source: Map<string, BreakdownEntry>;
    if (this.tab === 'heal') source = tally.healByAbility;
    else if (this.tab === 'dmgTaken') source = tally.dmgTakenByAbility;
    else if (this.tab === 'interrupts') source = tally.interruptsByAbility;
    else source = tally.dmgByAbility;

    const entry = source.get(breakdownKey(this.selectedAbility.petName, this.selectedAbility.key));
    if (!entry) {
      this.subEl.textContent = t('hudChrome.meters.noDetailedData');
      this.syncRowPool(0);
      for (const row of this.rowPool) row.el.style.display = 'none';
      return;
    }

    const hits = entry.hits ?? 1;
    const crits = entry.crits ?? 0;
    const critPct = hits > 0 ? Math.round((crits / hits) * 100) : 0;
    const avg = hits > 0 ? Math.round(entry.amount / hits) : entry.amount;

    if (this.tab === 'heal') {
      const over = entry.overheal ?? 0;
      const eff = Math.max(0, entry.amount - over);
      const overPct = entry.amount > 0 ? Math.round((over / entry.amount) * 100) : 0;
      this.subEl.textContent = `Efectiva: ${fmtNum(eff)} | Sobrecuración: ${fmtNum(over)} (${overPct}%) | Hits: ${hits} (${critPct}% crit)`;
    } else {
      this.subEl.textContent = `Hits: ${hits} | Crits: ${crits} (${critPct}%) | Media: ${fmtNum(avg)} | Mín/Máx: ${fmtNum(entry.minHit ?? avg)} / ${fmtNum(entry.maxHit ?? avg)}`;
    }

    interface DetailRowItem {
      label: string;
      amount: number;
      isTarget?: boolean;
    }
    const items: DetailRowItem[] = [];

    if (this.tab === 'dmgTaken') {
      if (entry.sources && entry.sources.size > 0) {
        for (const [src, amt] of entry.sources) {
          items.push({ label: src, amount: amt, isTarget: false });
        }
      }
    } else if (this.tab === 'interrupts') {
      if (entry.interruptedSpells && entry.interruptedSpells.size > 0) {
        for (const [sp, cnt] of entry.interruptedSpells) {
          items.push({ label: sp, amount: cnt, isTarget: false });
        }
      }
    } else {
      if (entry.targets && entry.targets.size > 0) {
        for (const [tgt, amt] of entry.targets) {
          items.push({ label: tgt, amount: amt, isTarget: true });
        }
      }
    }

    items.sort((a, b) => b.amount - a.amount);
    const maxVal = items.length > 0 ? items[0].amount : 1;
    const totalVal = items.reduce((s, it) => s + it.amount, 0) || entry.amount || 1;

    const hex = getClassColor(tally.cls);
    this.syncRowPool(items.length);
    items.forEach((it, i) => {
      const row = this.rowPool[i];
      row.pid = tally.pid;
      row.name = it.label;
      row.petName = null;
      row.abilityKey = undefined;
      row.targetName = it.isTarget ? it.label : undefined;
      row.threatPid = -1;
      row.el.style.display = 'block';
      row.el.classList.remove('aggro');
      row.fill.style.width = `${Math.max(4, (it.amount / maxVal) * 100)}%`;
      row.fill.style.background = `linear-gradient(90deg, ${hex}cc 0%, ${hex}66 100%)`;
      row.rank.textContent = `${i + 1}.`;
      row.icon.style.display = 'none';
      row.el.classList.remove('has-icon');
      row.label.textContent = it.label;
      const pct = (it.amount / totalVal) * 100;
      row.num.innerHTML = `<span class="mt-val-amount">${fmtNum(it.amount)}</span> <span class="mt-val-pct">${pct.toFixed(1)}%</span>`;
    });
    for (let i = items.length; i < this.rowPool.length; i++) {
      this.rowPool[i].el.style.display = 'none';
    }
  }

  private renderDeathRecap(enc: Encounter, viewName: string): void {
    if (!this.selectedDeadPlayer) return;
    const pid = this.selectedDeadPlayer.pid;

    this.modeTrigger.style.display = 'none';
    this.backTrigger.style.display = 'inline-flex';
    this.backTrigger.innerHTML = `<span class="mt-back-arrow">‹</span> <span class="mt-back-text">Muerte: ${esc(this.selectedDeadPlayer.name)}</span>`;
    this.segTrigger.style.display = '';
    this.segTrigger.innerHTML = `<span class="mt-title-text">${viewName}</span> <span class="mt-arrow">▾</span>`;

    const recaps = enc.deathRecaps.get(pid);
    let record: DeathRecapRecord | undefined =
      recaps && recaps.length > 0 ? recaps[recaps.length - 1] : undefined;
    if (!record) {
      const recent = this.host.data.deathRecapBuffer.getRecentEvents(pid);
      if (recent.length > 0) {
        record = {
          pid,
          playerName: this.selectedDeadPlayer.name,
          deathTime: recent[recent.length - 1].timestamp,
          events: recent,
        };
      }
    }

    if (!record || record.events.length === 0) {
      this.subEl.textContent = t('hudChrome.meters.noDeathEvents');
      this.syncRowPool(0);
      for (const row of this.rowPool) row.el.style.display = 'none';
      return;
    }

    const rows = buildDeathRecapRows(record);
    this.subEl.textContent = record.killerName
      ? t('hudChrome.meters.killedBy', {
          killer: record.killerName,
          ability: record.killerAbility ?? t('hudChrome.meters.lethalHit'),
        })
      : t('hudChrome.meters.recentCombatEvents', { count: rows.length });

    this.syncRowPool(rows.length);
    rows.forEach((r, i) => {
      const row = this.rowPool[i];
      row.pid = pid;
      row.name = `${r.sourceName}: ${r.ability}`;
      row.petName = null;
      row.abilityKey = undefined;
      row.targetName = undefined;
      row.threatPid = -1;
      row.el.style.display = 'block';
      row.icon.style.display = 'none';
      row.el.classList.remove('has-icon');
      row.el.classList.toggle('aggro', r.lethal);

      row.rank.textContent = r.timeRel;
      row.label.textContent = `${r.sourceName} - ${r.ability}`;
      row.num.innerHTML = `<span class="mt-val-amount">${r.amountStr}</span> <span class="mt-val-hp">${r.hpStr}</span>`;

      row.fill.style.width = '100%';
      if (r.lethal) {
        row.fill.style.background = 'linear-gradient(90deg, #c0392bdd 0%, #781e1e88 100%)';
      } else if (r.type === 'heal') {
        row.fill.style.background = 'linear-gradient(90deg, #27ae60aa 0%, #196f3d55 100%)';
      } else if (r.type === 'absorb') {
        row.fill.style.background = 'linear-gradient(90deg, #d4ac0daa 0%, #7d660855 100%)';
      } else {
        row.fill.style.background = 'linear-gradient(90deg, #852222aa 0%, #44111155 100%)';
      }
    });
    for (let i = rows.length; i < this.rowPool.length; i++) {
      this.rowPool[i].el.style.display = 'none';
    }
  }

  private renderComparisonView(viewName: string): void {
    this.modeTrigger.style.display = 'none';
    this.backTrigger.style.display = 'inline-flex';
    this.backTrigger.innerHTML = `<span class="mt-back-arrow">‹</span> <span class="mt-back-text">${esc(t('hudChrome.meters.backComparison'))}</span>`;
    this.segTrigger.style.display = '';
    this.segTrigger.innerHTML = `<span class="mt-title-text">${viewName}</span> <span class="mt-arrow">▾</span>`;

    const h = this.host.data.history;
    const encA = h[this.compareSegmentA] ?? this.host.data.current ?? this.host.data.allTime;
    const encB =
      h[this.compareSegmentB] ??
      (this.host.data.current !== encA ? this.host.data.current : this.host.data.allTime);

    if (!encA || !encB) {
      this.subEl.textContent = t('hudChrome.meters.comparisonNeedTwo');
      this.syncRowPool(0);
      for (const row of this.rowPool) row.el.style.display = 'none';
      return;
    }

    const comp = compareEncounters(encA, encB);
    this.subEl.textContent = `${comp.labelA} (${fmtDuration(comp.durationA)}) vs ${comp.labelB} (${fmtDuration(comp.durationB)})`;

    interface CompDisplayRow {
      label: string;
      valueText: string;
      better: 'A' | 'B' | 'neutral';
    }
    const displayRows: CompDisplayRow[] = [];

    for (const m of comp.metrics) {
      displayRows.push({
        label: m.name,
        valueText: `${m.strA} -> ${m.strB} (${m.diffStr})`,
        better: m.better,
      });
    }

    for (const p of comp.players.slice(0, 5)) {
      const sign = p.dpsDiff > 0 ? '+' : '';
      displayRows.push({
        label: p.name,
        valueText: `${fmtNum(p.dpsA)} -> ${fmtNum(p.dpsB)} DPS (${sign}${fmtNum(p.dpsDiff)})`,
        better: p.dpsDiff > 0 ? 'B' : p.dpsDiff < 0 ? 'A' : 'neutral',
      });
    }

    this.syncRowPool(displayRows.length);
    displayRows.forEach((r, i) => {
      const row = this.rowPool[i];
      row.pid = -1;
      row.name = r.label;
      row.petName = null;
      row.abilityKey = undefined;
      row.targetName = undefined;
      row.threatPid = -1;
      row.el.style.display = 'block';
      row.icon.style.display = 'none';
      row.el.classList.remove('has-icon');
      row.el.classList.remove('aggro');

      row.rank.textContent = `${i + 1}.`;
      row.label.textContent = r.label;
      const diffClass = r.better === 'B' ? 'mt-diff-pos' : r.better === 'A' ? 'mt-diff-neg' : '';
      row.num.innerHTML = `<span class="${diffClass}">${r.valueText}</span>`;

      row.fill.style.width = '100%';
      if (r.better === 'B') {
        row.fill.style.background = 'linear-gradient(90deg, #27ae6088 0%, #196f3d44 100%)';
      } else if (r.better === 'A') {
        row.fill.style.background = 'linear-gradient(90deg, #c0392b88 0%, #781e1e44 100%)';
      } else {
        row.fill.style.background = 'linear-gradient(90deg, #55555588 0%, #33333344 100%)';
      }
    });
    for (let i = displayRows.length; i < this.rowPool.length; i++) {
      this.rowPool[i].el.style.display = 'none';
    }
  }

  private renderTimelineView(enc: Encounter, viewName: string): void {
    this.modeTrigger.style.display = 'none';
    this.backTrigger.style.display = 'inline-flex';
    this.backTrigger.innerHTML = `<span class="mt-back-arrow">‹</span> <span class="mt-back-text">${esc(t('hudChrome.meters.backTimeline'))}</span>`;
    this.segTrigger.style.display = '';
    this.segTrigger.innerHTML = `<span class="mt-title-text">${viewName}</span> <span class="mt-arrow">▾</span>`;

    const events = enc.timeline.getEvents();
    const rows = buildTimelineRows(events, enc.startedAt / 1000);
    this.subEl.textContent = t('hudChrome.meters.timelineCombatEvents', { count: rows.length });

    this.syncRowPool(rows.length);
    rows.forEach((r, i) => {
      const row = this.rowPool[i];
      row.pid = -1;
      row.name = r.label;
      row.petName = null;
      row.abilityKey = undefined;
      row.targetName = undefined;
      row.threatPid = -1;
      row.el.style.display = 'block';
      row.icon.style.display = 'none';
      row.el.classList.remove('has-icon');
      row.el.classList.toggle('aggro', r.type === 'death');

      row.rank.textContent = `[${r.timeFormatted}]`;
      row.label.textContent = `${r.icon} ${r.label}`;
      row.num.textContent = r.detail;

      row.fill.style.width = '100%';
      if (r.type === 'death') {
        row.fill.style.background = 'linear-gradient(90deg, #c0392b88 0%, #781e1e44 100%)';
      } else if (r.type === 'phase') {
        row.fill.style.background = 'linear-gradient(90deg, #8e44ad88 0%, #5b2c6f44 100%)';
      } else if (r.type === 'interrupt') {
        row.fill.style.background = 'linear-gradient(90deg, #2980b988 0%, #1a527644 100%)';
      } else if (r.type === 'dispel') {
        row.fill.style.background = 'linear-gradient(90deg, #16a08588 0%, #0e625144 100%)';
      } else {
        row.fill.style.background = 'linear-gradient(90deg, #55555588 0%, #33333344 100%)';
      }
    });
    for (let i = rows.length; i < this.rowPool.length; i++) {
      this.rowPool[i].el.style.display = 'none';
    }
  }

  private renderBalanceView(enc: Encounter, viewName: string): void {
    this.modeTrigger.style.display = 'none';
    this.backTrigger.style.display = 'inline-flex';
    this.backTrigger.innerHTML = `<span class="mt-back-arrow">‹</span> <span class="mt-back-text">${esc(t('hudChrome.meters.backDev'))}</span>`;
    this.segTrigger.style.display = '';
    this.segTrigger.innerHTML = `<span class="mt-title-text">${viewName}</span> <span class="mt-arrow">▾</span>`;

    const stats = buildAbilityBalanceStats(enc);
    this.subEl.textContent = t('hudChrome.meters.balanceAbilitiesCount', { count: stats.length });

    const maxVal = stats.length > 0 ? stats[0].totalDamage + stats[0].totalHealing : 1;

    this.syncRowPool(stats.length);
    stats.forEach((s, i) => {
      const row = this.rowPool[i];
      const totalAmt = s.totalDamage + s.totalHealing;
      const critPct = Math.round(s.critRate * 100);
      row.pid = -1;
      row.name = s.ability;
      row.petName = null;
      row.abilityKey = undefined;
      row.targetName = undefined;
      row.threatPid = -1;
      row.el.style.display = 'block';
      row.icon.style.display = 'none';
      row.el.classList.remove('has-icon');
      row.el.classList.remove('aggro');

      row.fill.style.width = `${Math.max(4, (totalAmt / maxVal) * 100)}%`;
      row.fill.style.background = 'linear-gradient(90deg, #d3540088 0%, #a0400044 100%)';
      row.rank.textContent = `${i + 1}.`;
      row.label.textContent = s.ability;
      row.num.innerHTML = `<span>${fmtNum(totalAmt)}</span> <span class="mt-val-pct">${critPct}% crit</span>`;
    });
    for (let i = stats.length; i < this.rowPool.length; i++) {
      this.rowPool[i].el.style.display = 'none';
    }
  }

  private renderTargetPlayersView(enc: Encounter, viewName: string): void {
    if (!this.selectedTarget) return;

    this.modeTrigger.style.display = 'none';
    this.backTrigger.style.display = 'inline-flex';
    this.backTrigger.innerHTML = `<span class="mt-back-arrow">‹</span> <span class="mt-back-text">${esc(t('hudChrome.meters.targetSubtitle', { target: this.selectedTarget }))}</span>`;
    this.segTrigger.style.display = '';
    this.segTrigger.innerHTML = `<span class="mt-title-text">${viewName}</span> <span class="mt-arrow">▾</span>`;

    const map = enc.targetDamageReceived.get(this.selectedTarget);
    if (!map || map.size === 0) {
      this.subEl.textContent = t('hudChrome.meters.noTargetData');
      this.syncRowPool(0);
      for (const row of this.rowPool) row.el.style.display = 'none';
      return;
    }

    const entries = [...map.entries()]
      .map(([pid, amt]) => {
        const tally = enc.tallies.get(pid);
        let spec = tally?.spec ?? null;
        if (!spec) {
          if (pid === this.host.world.player.id && this.host.world.talentSpec) {
            spec = this.host.world.talentSpec;
          } else {
            const member = this.host.world.partyInfo?.members.find((m) => m.pid === pid);
            if (member?.spec) spec = member.spec;
          }
        }
        return {
          pid,
          name: tally?.name ?? `#${pid}`,
          cls: tally?.cls ?? null,
          spec,
          amt,
        };
      })
      .sort((a, b) => b.amt - a.amt);

    const total = entries.reduce((s, e) => s + e.amt, 0) || 1;
    const maxVal = entries[0]?.amt || 1;
    this.subEl.textContent = `Daño total al objetivo: ${fmtNum(total)}`;

    this.syncRowPool(entries.length);
    entries.forEach((e, i) => {
      const row = this.rowPool[i];
      row.pid = e.pid;
      row.name = e.name;
      row.petName = null;
      row.abilityKey = undefined;
      row.targetName = undefined;
      row.threatPid = -1;
      row.el.style.display = 'block';
      row.el.classList.remove('aggro');

      const hex = getClassColor(e.cls);
      row.fill.style.width = `${Math.max(4, (e.amt / maxVal) * 100)}%`;
      row.fill.style.background = `linear-gradient(90deg, ${hex}dd 0%, ${hex}88 100%)`;
      row.rank.textContent = `${i + 1}.`;
      row.label.textContent = e.name;
      const iconUrl = e.cls ? meterIconUrl(e.cls, e.spec) : null;
      if (iconUrl) {
        row.icon.style.backgroundImage = `url("${iconUrl}")`;
        row.icon.style.display = 'block';
        row.el.classList.add('has-icon');
      } else {
        row.icon.style.display = 'none';
        row.el.classList.remove('has-icon');
      }
      const pct = (e.amt / total) * 100;
      row.num.innerHTML = `<span class="mt-val-amount">${fmtNum(e.amt)}</span> <span class="mt-val-pct">${pct.toFixed(1)}%</span>`;
    });
    for (let i = entries.length; i < this.rowPool.length; i++) {
      this.rowPool[i].el.style.display = 'none';
    }
  }

  private handleRowClick(row: MeterRowNodes): void {
    if (this.viewMode === 'overview') {
      if (this.tab === 'deaths') {
        if (row.pid > 0) {
          this.showDeathRecap(row.pid, row.name);
        }
      } else if (row.pid > 0) {
        this.selectedPid = row.pid;
        this.render(true);
      }
    } else if (this.viewMode === 'player_breakdown') {
      const abilityKey = row.abilityKey;
      if (abilityKey) {
        this.showAbilityDetail(abilityKey, row.petName, row.name);
      }
    } else if (this.viewMode === 'ability_detail') {
      const targetName = row.targetName;
      if (targetName) {
        this.showTargetPlayers(targetName);
      }
    }
  }

  /** Grow the pooled bars to `count` rows, attaching each row's tooltip once. */
  private syncRowPool(count: number): void {
    while (this.rowPool.length < count) {
      const el = document.createElement('div');
      el.className = 'mt-row ui-card';
      // Focusable so the breakdown is reachable by keyboard, not hover only
      // (attachTooltip shows on focusin and on a mobile long-press).
      el.tabIndex = 0;
      const fill = document.createElement('div');
      fill.className = 'mt-fill';
      const rank = document.createElement('span');
      rank.className = 'mt-rank';
      const icon = document.createElement('span');
      icon.className = 'mt-icon';
      const label = document.createElement('span');
      label.className = 'mt-label';
      const num = document.createElement('span');
      num.className = 'mt-num ui-num';
      el.append(fill, rank, icon, label, num);
      const row: MeterRowNodes = {
        el,
        rank,
        icon,
        fill,
        label,
        num,
        pid: -1,
        name: '',
        petName: null,
        threatPid: -1,
      };
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.handleRowClick(row);
      });
      this.rowPool.push(row);
      this.rowsEl.appendChild(el);
      this.host.attachTooltip(el, () => this.breakdownHtml(row));
    }
  }

  /**
   * The mob the Threat tab is about right now, plus its hate table when it has
   * one. Resolved LIVE from the world rather than read off the encounter's
   * latched `mainMobId`, which is what froze the tab on a corpse mid-fight; the
   * latched id survives only as the last-resort fallback for a finished
   * encounter in the history pages.
   */
  private threatSubject(
    enc: Encounter,
    petsByOwner: Map<number, Pet[]> | null,
  ): { mob: Entity | null; liveThreat: Map<number, number> | null; frozen: boolean } {
    if (this.tab !== 'threat') return { mob: null, liveThreat: null, frozen: false };
    const world = this.host.world;
    const tracked = new Set(this.host.partyPids());
    for (const pets of petsByOwner?.values() ?? []) for (const pet of pets) tracked.add(pet.pid);
    const subjectId = resolveThreatSubject({
      entities: world.entities.values(),
      playerTargetId: world.player.targetId,
      trackedPids: tracked,
      fallbackMobId: enc.mainMobId,
    });
    const mob = subjectId !== null ? (world.entities.get(subjectId) ?? null) : null;
    const frozenSnapshot =
      subjectId !== null ? (enc.threatSnapshotByMob.get(subjectId) ?? null) : null;
    const { values: liveThreat, frozen } = resolveThreatValues(mob, frozenSnapshot);
    return { mob, liveThreat, frozen };
  }

  /**
   * Hover panel for one bar: the per-ability damage/healing split behind it (pet
   * output labeled with the pet that acted). On the threat tab the bars are
   * per-contributor already, so the panel narrows to just that contributor's
   * abilities and says it is showing damage, never hate.
   */
  private breakdownHtml(row: MeterRowNodes): string {
    const { enc } = this.viewedEncounter();
    if (this.viewMode === 'death_recap') {
      return `<div class="tt-title">${esc(row.name)}</div><div class="mt-tt-summary">${esc(row.num.textContent ?? '')}</div>`;
    }
    if (this.viewMode === 'timeline') {
      return `<div class="tt-title">${esc(row.label.textContent ?? '')}</div><div class="mt-tt-summary">${esc(row.num.textContent ?? '')}</div>`;
    }
    if (this.viewMode === 'comparison') {
      return `<div class="tt-title">${esc(row.label.textContent ?? '')}</div><div class="mt-tt-summary">${esc(row.num.textContent ?? '')}</div>`;
    }
    if (this.viewMode === 'balance_dev') {
      return `<div class="tt-title">${esc(row.label.textContent ?? '')}</div><div class="mt-tt-summary">${esc(row.num.textContent ?? '')}</div>`;
    }
    if (this.viewMode === 'target_players') {
      return `<div class="tt-title">${esc(row.name)}</div><div class="mt-tt-summary">${esc(row.num.textContent ?? '')}</div>`;
    }
    if (this.viewMode === 'ability_detail') {
      return `<div class="tt-title">${esc(row.name)}</div><div class="mt-tt-summary">${esc(row.num.textContent ?? '')}</div>`;
    }

    const tally = enc?.tallies.get(row.pid);
    if (!enc || !tally) {
      return `<div class="tt-title">${esc(row.petName ?? row.name)}</div>`;
    }

    if (this.selectedPlayer !== null) {
      const hex = getClassColor(this.selectedPlayer.cls ?? null);
      const title = `<div class="tt-title" style="color:${hex}">${esc(row.name)}</div>`;

      let source: Map<string, BreakdownEntry> | undefined;
      if (this.tab === 'heal') source = tally.healByAbility;
      else if (this.tab === 'dmgTaken') source = tally.dmgTakenByAbility;
      else if (this.tab === 'interrupts') source = tally.interruptsByAbility;
      else source = tally.dmgByAbility;

      const abilityKey = row.abilityKey;
      let entry: BreakdownEntry | undefined;
      if (source) {
        entry = source.get(breakdownKey(row.petName, abilityKey ?? null));
        if (!entry) {
          entry = [...source.values()].find((e) => {
            const aName = e.ability
              ? abilityDisplayNameFromSource(e.ability)
              : t('hudChrome.meters.melee');
            const l = e.petName ? `${e.petName}: ${aName}` : aName;
            return l === row.name;
          });
        }
      }

      const totalAmount = entry ? entry.amount : 0;
      const hits = entry?.hits ?? (entry ? 1 : 0);
      const crits = entry?.crits ?? 0;
      const critPct = hits > 0 ? Math.round((crits / hits) * 100) : 0;
      const avg = hits > 0 ? Math.round(totalAmount / hits) : totalAmount;

      let statRows =
        `<div class="mt-tt-stat"><span>${esc(t(TAB_LABEL_KEY[this.tab]))}:</span><span class="mt-tt-stat-val">${fmtNum(totalAmount)}</span></div>` +
        `<div class="mt-tt-stat"><span>${esc(t('hud.meters.hits', { count: hits }))}</span><span>${esc(t('hud.meters.criticals', { count: crits }))} (${critPct}%)</span></div>` +
        `<div class="mt-tt-stat"><span>Media:</span><span>${fmtNum(avg)}</span></div>`;
      if (entry?.maxHit !== undefined && entry.maxHit > 0) {
        statRows += `<div class="mt-tt-stat"><span>Máx / Mín:</span><span>${fmtNum(entry.maxHit)} / ${fmtNum(entry.minHit ?? entry.maxHit)}</span></div>`;
      }

      return `${title}<div class="mt-tt-summary">${statRows}</div>`;
    }

    const title = `<div class="tt-title">${esc(row.petName ?? tally.name)}</div>`;
    const hitCount = tally.hits || 0;
    const critCount = tally.crits || 0;
    const critPct = hitCount > 0 ? Math.round((critCount / hitCount) * 100) : 0;
    const summaryCard =
      `<div class="mt-tt-summary">` +
      `<div class="mt-tt-stat"><span>${esc(t(TAB_LABEL_KEY[this.tab]))}:</span><span class="mt-tt-stat-val">${esc(row.num.textContent ?? '')}</span></div>` +
      `<div class="mt-tt-stat"><span>${esc(t('hud.meters.hits', { count: hitCount }))}</span><span>${esc(t('hud.meters.criticals', { count: critCount }))} (${critPct}%)</span></div>` +
      `</div>`;

    const isThreat = this.tab === 'threat';
    let source: Map<string, BreakdownEntry>;
    if (this.tab === 'heal') source = tally.healByAbility;
    else if (this.tab === 'dmgTaken') source = tally.dmgTakenByAbility;
    else if (this.tab === 'interrupts') source = tally.interruptsByAbility;
    else source = tally.dmgByAbility;

    // On the threat tab each contributor (the member, and each pet) owns a bar,
    // so the panel behind one bar is that contributor's abilities alone.
    const entries: BreakdownEntry[] = [...source.values()].filter((e) =>
      isThreat ? (e.petName ?? null) === row.petName : true,
    );

    // Threat rows are already per-contributor (one bar each), so their panel
    // stays flat. Interrupts and deaths are simple counts without per-second rates.
    if (isThreat || this.tab === 'interrupts' || this.tab === 'deaths') {
      const model = buildMeterBreakdown(
        entries,
        this.tab === 'interrupts' || this.tab === 'deaths' ? 1 : enc.duration,
      );
      // Always the DAMAGE label here for threat: these entries are the damage that
      // generated the hate, not the hate value on the bar.
      const summary = t('hudChrome.meters.breakdownSummary', {
        tab: t(TAB_LABEL_KEY[isThreat ? 'dmg' : this.tab]),
        value: fmtNum(model.total),
      });
      const body = model.rows.map((r) => this.breakdownRowHtml(r, false)).join('');
      const targetsHtml =
        isThreat || this.tab === 'interrupts' || this.tab === 'deaths'
          ? ''
          : this.breakdownTargetsHtml(entries, enc.duration);
      return `${title}${summaryCard}<div class="mt-tip-sub">${esc(summary)}</div><div class="mt-tip-rows">${body}</div>${targetsHtml}`;
    }

    const grouped = buildGroupedMeterBreakdown(entries, enc.duration);
    const summary = t('hudChrome.meters.breakdownSummary', {
      tab: t(TAB_LABEL_KEY[this.tab]),
      value: fmtPerSecondRow(grouped.total, grouped.perSecond),
    });
    const body = grouped.groups
      .map((g) => {
        const head = this.breakdownGroupHtml(g, tally.name);
        // Nested under their own subtotal, so the ability rows never carry the
        // pet's name a second time.
        const rows = g.rows.map((r) => this.breakdownRowHtml(r, true)).join('');
        return `${head}<div class="mt-tip-group">${rows}</div>`;
      })
      .join('');
    const targetsHtml = this.breakdownTargetsHtml(entries, enc.duration);
    return `${title}${summaryCard}<div class="mt-tip-sub">${esc(summary)}</div><div class="mt-tip-rows">${body}</div>${targetsHtml}`;
  }

  /** A contributor's subtotal line: the member or one of their pets. */
  private breakdownGroupHtml(group: BreakdownGroup, memberName: string): string {
    const value = t('hudChrome.meters.breakdownRow', {
      value: fmtNum(group.amount),
      percent: t('hudChrome.meters.percent', {
        value: formatNumber(Math.round(group.share * 100), {
          maximumFractionDigits: 0,
          useGrouping: false,
        }),
      }),
    });
    return (
      `<div class="mt-tip-row mt-tip-head">` +
      `<span class="mt-tip-bar" style="width:${Math.max(2, group.fill * 100)}%"></span>` +
      `<span class="mt-tip-name">${esc(group.petName ?? memberName)}</span>` +
      `<span class="mt-tip-val">${esc(value)}</span>` +
      `</div>`
    );
  }

  private breakdownRowHtml(row: BreakdownRow, nested: boolean): string {
    const label = breakdownRowLabel(row, nested);
    const value = t('hudChrome.meters.breakdownRow', {
      value: fmtNum(row.amount),
      percent: t('hudChrome.meters.percent', {
        value: formatNumber(Math.round(row.share * 100), {
          maximumFractionDigits: 0,
          useGrouping: false,
        }),
      }),
    });
    let iconHtml = '';
    try {
      const rawKey =
        row.abilityId || (row.ability ? row.ability.toLowerCase().replace(/\s+/g, '_') : 'attack');
      const url = iconDataUrl('ability', rawKey, 16);
      if (url) {
        iconHtml = `<span class="mt-tip-icon" style="background-image:url('${url}')"></span>`;
      }
    } catch {
      iconHtml = '';
    }
    return (
      `<div class="mt-tip-row">` +
      `<span class="mt-tip-bar" style="width:${Math.max(2, row.fill * 100)}%"></span>` +
      iconHtml +
      `<span class="mt-tip-name">${esc(label)}</span>` +
      `<span class="mt-tip-val">${esc(value)}</span>` +
      `</div>`
    );
  }

  private breakdownTargetsHtml(entries: BreakdownEntry[], duration: number): string {
    const targetMap = new Map<string, number>();
    for (const e of entries) {
      if (e.targets && e.targets.size > 0) {
        for (const [name, amt] of e.targets) {
          targetMap.set(name, (targetMap.get(name) ?? 0) + amt);
        }
      }
    }
    if (targetMap.size === 0) return '';

    const sorted = [...targetMap.entries()].sort((a, b) => b[1] - a[1]);
    const maxVal = sorted[0][1] || 1;
    const dur = Math.max(1, duration);

    const rows = sorted
      .slice(0, 5)
      .map(([name, amt]) => {
        const fillPct = Math.max(2, (amt / maxVal) * 100);
        const dps = amt / dur;
        return (
          `<div class="mt-tip-target-row">` +
          `<span class="mt-tip-target-bar" style="width:${fillPct}%"></span>` +
          `<span class="mt-tip-target-name">${esc(name)}</span>` +
          `<span class="mt-tip-target-val">${fmtNum(amt)} <span class="mt-val-sep">|</span> ${fmtNum(dps)}</span>` +
          `</div>`
        );
      })
      .join('');

    return (
      `<div class="mt-tip-targets-section">` +
      `<div class="mt-tip-targets-hdr">${esc(t('hudChrome.meters.targetsHeader'))}</div>` +
      `<div class="mt-tip-targets-rows">${rows}</div>` +
      `</div>`
    );
  }
}

/** Storage keys: one box per panel, plus which meters are popped out. */
/** The meters that can leave the main window; damage is always its home. */
type DetachableTab = 'heal' | 'threat';

function isDetachableTab(tab: MeterTab): tab is DetachableTab {
  return tab === 'heal' || tab === 'threat';
}

// The tabbed window has no key: its box is the damageMeter registry row's
// (woc_hud_frame_meters), and the pre-frames 'woc_meters_frame' key is dead.
const FRAME_KEYS: Record<DetachableTab, string> = {
  heal: 'woc_meters_frame_heal',
  threat: 'woc_meters_frame_threat',
};
const DETACHED_KEY = 'woc_meters_detached';
const METERS_DEFAULT_WIDTH = 240;
const METERS_DEFAULT_HEIGHT = 160;

const DETACHABLE: readonly DetachableTab[] = ['heal', 'threat'];

/**
 * Owns the shared MeterData and the three panels: the tabbed damage window plus
 * the detachable Healing and Threat windows. Every panel is movable and
 * resizable on its own, and each remembers where it was left.
 */
export class Meters {
  readonly data: MeterData;
  private readonly main: MetersPanel;
  private readonly detached = new Map<DetachableTab, MetersPanel>();
  private readonly partyPidsCache = new PartyPidsCache();
  /** Detached windows hidden along with the tabbed one, to restore on reopen. */
  private reopenDetached: DetachableTab[] = [];
  private settings: MetersSettings;
  /**
   * The practice DPS strip (src/ui/hud/practice/): a readout over this SAME
   * encounter ledger for the local player's runs on a training dummy. It lives
   * here rather than on the Hud so the two surfaces share one feed and one
   * per-frame drive; null on a document without the strip (the /play shell).
   */
  private readonly practice: PracticeDpsController | null;
  /**
   * The Eastbrook hub practice coach (src/ui/hud/practice/): guided,
   * step-at-a-time coaching for Drillmaster Hale's damage drill and the
   * optional healing drill, over this SAME encounter ledger (so the coach
   * can never disagree with what the tabs actually show). Lives here for
   * the identical reason `practice` does: one feed, one per-frame drive.
   * Null on a document without the strip (a bare test rig), or when the
   * caller hands over no keybinds to resolve the coach's keycap chips.
   */
  private readonly hubLesson: HubLessonController | null;

  constructor(
    private world: IWorld,
    private deps?: MetersDeps,
  ) {
    this.settings = loadMetersSettings(deps?.storage);
    this.data = new MeterData(performance.now(), this.settings);
    const practiceEl = document.getElementById('practice-body');
    this.practice = practiceEl
      ? new PracticeDpsController({
          element: practiceEl,
          model: () =>
            practiceDpsModel({
              current: this.data.current,
              history: this.data.history,
              playerId: world.player.id,
              targetTemplateId: this.targetTemplateId(),
            }),
          dummyName: (templateId) => tEntity({ kind: 'mob', id: templateId, field: 'name' }),
        })
      : null;
    const hubLessonEl = document.getElementById('hub-lesson-coach');
    this.hubLesson =
      hubLessonEl && deps?.keybinds
        ? new HubLessonController({
            element: hubLessonEl,
            world,
            keybinds: deps.keybinds,
            meters: {
              anyWindowOpen: () => this.anyWindowOpen,
              tabOpen: (tab: MeterTab) => this.tabOpen(tab),
              tabButtonElement: (tab: MeterTab) => this.tabButtonElement(tab),
              historyArrowElement: (tab: MeterTab) => this.historyArrowElement(tab),
              rowElementForPid: (tab: MeterTab, pid: number) => this.rowElementForPid(tab, pid),
              viewedEncounter: (tab: MeterTab) => this.viewedEncounter(tab),
              current: () => this.current(),
              history: () => this.history(),
            },
            storage: deps.storage,
            actionBarSlots: deps.actionBarSlots,
            tooltipVisibleFor: deps.tooltipVisibleFor,
            actionButtonForSlot: deps.actionButtonForSlot,
            worldToScreen: deps.worldToScreen,
          })
        : null;
    const host: PanelHost = {
      world,
      data: this.data,
      sendChat: deps?.sendChat,
      petsByOwner: () => this.livePetsByOwner(),
      partyPids: () => this.partyPids(),
      attachTooltip: (el, html) => deps?.attachTooltip(el, html),
      onDock: (tab) => this.dock(tab),
      isDetached: (tab) => this.isDetached(tab),
      openTabMenu: (rows, x, y) => this.openTabMenu(rows, x, y),
      openMenu: deps?.openMenu,
      onNewWindow: () => this.handleNewWindow(),
      mainWindowRect: () => {
        const el = this.main.element;
        if (!el || el.style.display === 'none') return null;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0
          ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          : null;
      },
      resetCurrent: () => this.resetCurrent(),
      resetAll: () => this.resetAll(),
      getSettings: () => this.settings,
      updateSettings: (s) => this.updateSettings(s),
    };
    this.main = new MetersPanel(
      {
        root: document.querySelector('#meters-window') as HTMLElement,
        lockedTab: null,
      },
      host,
      deps,
    );
    for (const tab of DETACHABLE) {
      const root = document.querySelector(
        tab === 'heal' ? '#heal-window' : '#threat-window',
      ) as HTMLElement | null;
      if (!root) continue;
      this.detached.set(
        tab,
        new MetersPanel({ root, lockedTab: tab, frameStorageKey: FRAME_KEYS[tab] }, host, deps),
      );
    }
    this.restoreDetached();
  }

  resetCurrent(): void {
    this.data.resetCurrent();
    this.render(true);
  }

  resetAll(): void {
    this.data.resetAll(performance.now());
    this.render(true);
  }

  getSettings(): MetersSettings {
    return this.settings;
  }

  updateSettings(settings: MetersSettings): void {
    this.settings = { ...settings };
    this.data.updateSettings(this.settings);
    saveMetersSettings(this.settings, this.deps?.storage);
    this.main.setSettings(this.settings);
    for (const panel of this.detached.values()) {
      panel.setSettings(this.settings);
    }
  }

  relocalize(): void {
    this.main.relocalize();
    for (const panel of this.detached.values()) {
      panel.relocalize();
    }
  }

  toggle(): void {
    const open = !this.main.isOpen;
    this.main.setOpen(open);
    // The keybind clears the whole meters surface, not just the tabbed window: a
    // separated Threat or Healing window is part of that surface, and leaving two
    // panels floating over the HUD is not what "close the meters" means. Which
    // ones were up is remembered so reopening restores that exact arrangement.
    // The PERSISTED set is deliberately left alone: closing the meters is not the
    // player docking a meter, so a reload still comes back to their layout.
    if (open) {
      for (const tab of this.reopenDetached) this.detached.get(tab)?.setOpen(true);
      this.reopenDetached = [];
    } else {
      this.reopenDetached = DETACHABLE.filter((tab) => this.isDetached(tab));
      for (const panel of this.detached.values()) panel.setOpen(false);
    }
  }

  get isOpen(): boolean {
    return this.main.isOpen;
  }

  /** Open `tab` in its own window and hand the main window back to damage. */
  popOut(tab: DetachableTab): void {
    const panel = this.detached.get(tab);
    if (!panel) return;
    const frame = panel.getFrame();
    if (frame && !frame.hasCustomGeometry) {
      const mainRect = this.main.element.getBoundingClientRect();
      if (mainRect.width > 0 && mainRect.height > 0) {
        frame.placeAt({
          left: mainRect.right + 2,
          top: mainRect.top,
          width: mainRect.width,
          height: mainRect.height,
        });
      }
    }
    panel.setOpen(true);
    this.main.showTab('dmg');
    this.persistDetached();
  }

  private handleNewWindow(): void {
    const available = DETACHABLE.filter((tab) => !this.isDetached(tab));
    if (available.length === 0) return;
    if (available.length === 1) {
      this.popOut(available[0]);
      return;
    }
    const open = this.deps?.openMenu;
    if (!open) {
      this.popOut(available[0]);
      return;
    }
    const items = available.map((tab) => ({
      act: tab,
      label: t(TAB_LABEL_KEY[tab]),
    }));
    const rect = this.main.element.getBoundingClientRect();
    open(items, Math.max(10, rect.right - 80), Math.max(10, rect.top + 20), (act) => {
      if (isDetachableTab(act as MeterTab)) {
        this.popOut(act as DetachableTab);
      }
    });
  }

  /** Close a detached window and select its meter back in the main window. */
  dock(tab: DetachableTab): void {
    const panel = this.detached.get(tab);
    if (!panel) return;
    panel.setOpen(false);
    if (this.main.isOpen) this.main.showTab(tab);
    this.persistDetached();
  }

  /** True while `tab` has its own window open. */
  isDetached(tab: MeterTab): boolean {
    return isDetachableTab(tab) ? (this.detached.get(tab)?.isOpen ?? false) : false;
  }

  /** The panel actually SHOWING `tab` right now: its detached window when it
   *  has one open, else the tabbed window when it is open and on that tab,
   *  else null. Read by the hub practice coach (hub_lesson_controller.ts) to
   *  find the row/history-arrow it glows; not on a per-frame path. */
  private panelShowing(tab: MeterTab): MetersPanel | null {
    if (isDetachableTab(tab)) {
      const detached = this.detached.get(tab);
      if (detached?.isOpen) return detached;
    }
    return this.main.isOpen && this.main.activeTab === tab ? this.main : null;
  }

  /** True while ANY meters surface is open, on any tab: the hub coach's
   *  "open a window at all" gate, before it asks for a specific tab. */
  get anyWindowOpen(): boolean {
    if (this.main.isOpen) return true;
    for (const panel of this.detached.values()) if (panel.isOpen) return true;
    return false;
  }

  /** True while a surface showing `tab` is open right now (docked or its own
   *  detached window). */
  tabOpen(tab: MeterTab): boolean {
    return this.panelShowing(tab) !== null;
  }

  /** The main window's tab-switch button for `tab`, only while a click on it
   *  would actually change anything (the main window is open, on a
   *  different tab, and `tab` is not already off in its own detached
   *  window). Null otherwise: nothing to glow. */
  tabButtonElement(tab: MeterTab): HTMLElement | null {
    if (!this.main.isOpen || this.main.activeTab === tab) return null;
    if (this.isDetached(tab)) return null;
    return this.main.tabButtonElement(tab);
  }

  /** The "older segment" arrow of whichever panel is showing `tab`. */
  historyArrowElement(tab: MeterTab): HTMLElement | null {
    return this.panelShowing(tab)?.historyArrowElement ?? null;
  }

  /** The local player's own row on whichever panel is showing `tab`. */
  rowElementForPid(tab: MeterTab, pid: number): HTMLElement | null {
    return this.panelShowing(tab)?.rowElementForPid(pid) ?? null;
  }

  /** Identity of whatever segment is currently displayed on the panel
   *  showing `tab`, or null while no such panel is open. */
  viewedEncounter(tab: MeterTab): { startedAt: number; isCurrent: boolean } | null {
    return this.panelShowing(tab)?.viewedEncounterInfo() ?? null;
  }

  /** The live encounter, or null between fights. HubLessonEncounterLike-shaped
   *  (src/ui/hud/practice/hub_lesson_controller.ts): the hub practice coach's
   *  read of the SAME ledger the tabs render, no second combat ledger. */
  current(): Encounter | null {
    return this.data.current;
  }

  /** Finished encounters, newest first. */
  history(): readonly Encounter[] {
    return this.data.history;
  }

  /**
   * Paint a tab's right-click menu through Hud's shared popup box. Localizing
   * the rows here keeps the pure core (which decides WHICH row) string-free.
   */
  private openTabMenu(rows: MeterMenuRow[], x: number, y: number): void {
    const open = this.deps?.openMenu;
    if (!open || rows.length === 0) return;
    const items = rows.map((row) => ({
      act: row.act,
      label: t(row.act === 'separate' ? 'hudChrome.meters.separate' : 'hudChrome.meters.regroup', {
        meter: t(TAB_LABEL_KEY[row.tab]),
      }),
    }));
    open(items, x, y, (act) => {
      const row = rows.find((candidate) => candidate.act === act);
      if (!row || !isDetachableTab(row.tab)) return;
      if (row.act === 'separate') this.popOut(row.tab);
      else this.dock(row.tab);
    });
  }

  /** Return every panel to its stylesheet anchor (the layout reset path).
   *  The tabbed window's box is the registry's (interfaceUnlock.resetAll
   *  covers it); this resets the two detached windows' own MeterFrames. */
  restoreSavedLayout(): void {
    this.reopenDetached = [];
    for (const panel of this.detached.values()) {
      panel.setOpen(false);
      panel.restoreSavedLayout();
    }
    this.restoreDetached();
  }

  reapplyFrames(): void {
    for (const panel of this.detached.values()) panel.reapplyFrame();
  }

  resetFrames(): void {
    this.main.resetFrame();
    for (const panel of this.detached.values()) panel.resetFrame();
  }

  /** Forwarded from the damageMeter registry row's onPositioned. */
  mainFramed(active: boolean): void {
    this.main.setRegistryFramed(active);
  }

  private restoreDetached(): void {
    let raw: string | null = null;
    try {
      raw = this.deps?.storage?.getItem(DETACHED_KEY) ?? null;
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
    if (!raw) return;
    const open = new Set(raw.split(',').filter(Boolean));
    for (const tab of DETACHABLE) {
      if (open.has(tab)) this.detached.get(tab)?.setOpen(true);
    }
  }

  private persistDetached(): void {
    const open = DETACHABLE.filter((tab) => this.isDetached(tab)).join(',');
    try {
      this.deps?.storage?.setItem(DETACHED_KEY, open);
    } catch {
      // Storage can be unavailable in private browsing modes.
    }
  }

  /** Self, party members, and their pets: rebuilt by the cache only when the
   *  viewer, the member list, or the entity roster changed (party_pids_core.ts). */
  private partyPids(): ReadonlySet<number> {
    return this.partyPidsCache.get(this.world);
  }

  /**
   * Live pets per owner, read from the world rather than the tallies: a pet can
   * hold hate without ever landing a hit (a taunt, or a fresh summon), so the
   * threat tab must see it even when it has no damage recorded.
   */
  private livePetsByOwner(): Map<number, Pet[]> {
    const byOwner = new Map<number, Pet[]>();
    for (const e of this.world.entities.values()) {
      if (e.kind !== 'mob' || e.ownerId === null) continue;
      const pets = byOwner.get(e.ownerId);
      if (pets) pets.push({ pid: e.id, name: e.name });
      else byOwner.set(e.ownerId, [{ pid: e.id, name: e.name }]);
    }
    return byOwner;
  }

  onEvent(ev: SimEvent): void {
    this.data.onEvent(ev, this.world, this.partyPids(), performance.now());
    // The hub lesson's healing track has no mainMobTemplateId field to key
    // off (see hub_lesson_controller.ts header): it taps the raw heal2 event
    // directly, after MeterData has already folded it into the ledger above.
    this.hubLesson?.onEvent(ev);
  }

  /** Template id of the local player's current target, for the practice strip. */
  private targetTemplateId(): string | null {
    const targetId = this.world.player.targetId;
    if (targetId === null) return null;
    return this.world.entities.get(targetId)?.templateId ?? null;
  }

  /** called every hud frame; each open panel renders at ~4Hz */
  update(): void {
    const now = performance.now();
    this.data.update(this.world, this.partyPids(), now);
    this.practice?.update(now);
    this.hubLesson?.update(now);
    this.main.update(now);
    for (const panel of this.detached.values()) panel.update(now);
  }

  /** Tears down the hub practice coach's listeners/glow/world prompt. Meters
   *  is presently constructed once per Hud (a fresh page load separates
   *  sessions), so nothing calls this in production yet; it exists so tests
   *  can construct and discard multiple controllers against a shared DOM
   *  without leaking listeners onto the next instance's elements. */
  dispose(): void {
    this.hubLesson?.dispose();
  }

  render(force = false): void {
    this.main.render(force);
    for (const panel of this.detached.values()) {
      if (panel.isOpen || force) panel.render(force && panel.isOpen);
    }
  }

  getMainPanel(): MetersPanel {
    return this.main;
  }

  exportText(): string {
    return this.main.exportText();
  }

  exportJson(): string {
    return this.main.exportJson();
  }

  getLatestDeathRecap(pid: number): DeathRecapRecord | null {
    for (const enc of [this.data.current, this.data.allTime]) {
      const recaps = enc?.deathRecaps.get(pid);
      if (recaps && recaps.length > 0) {
        return recaps[recaps.length - 1];
      }
    }
    const recent = this.data.deathRecapBuffer.getRecentEvents(pid);
    if (recent.length > 0) {
      const targetEntity = this.world.entities.get(pid);
      return {
        pid,
        playerName: targetEntity?.name ?? `#${pid}`,
        deathTime: recent[recent.length - 1].timestamp,
        events: recent,
      };
    }
    return null;
  }
}

// Row label: the folded tail, or an ability. A row NESTED under a contributor's
// subtotal drops the pet prefix, because the group header above it already names
// the actor; a flat row keeps the "Pet: Ability" form so it stays attributable
// on its own.
function breakdownRowLabel(row: BreakdownRow, nested: boolean): string {
  if (row.folded > 0) {
    return t('hudChrome.meters.breakdownOther', {
      count: formatNumber(row.folded, { maximumFractionDigits: 0, useGrouping: false }),
    });
  }
  const ability = row.ability
    ? abilityDisplayNameFromSource(row.ability)
    : t('hudChrome.meters.melee');
  if (nested) return ability;
  return row.petName ? t('hudChrome.meters.petAbility', { pet: row.petName, ability }) : ability;
}
