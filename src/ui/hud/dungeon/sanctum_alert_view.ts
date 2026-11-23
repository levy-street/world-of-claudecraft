// The Gravewyrm Sanctum's encounter alert: the pure, DOM-free view core. It
// tells the local player what a boss mechanic asks of them right now, read off
// what the sim already mirrors (encounters/gravewyrm_sanctum, the id contract in
// boss_ids.ts): the bosses' cast bars (`castingAbility`, `castTargetId`, a
// locked `facing`), the auras on the player and on the bodies round them, and
// the encounter objects whose template id carries their state (the seal
// chains, the lake plates, the Plunging Fire, the landing shadow, the Soulfire
// Trench lane). No IWorld member of its own.
//
// Priority (the first that applies wins): in the quench-water; on the plate
// Plunging Fire is about to burn; inside the landing shadow; carrying the
// Wyrm's Eye; a lane (Chain Flail, Threshold Charge, Soulfire Trench) on or
// under you; a Strain ring; inside Grave Inferno; inside Shuddering Stomp; in
// the Grave Breath cone; in the Maul Arc; behind him for the Tail Sweep; your
// Bonewalker in meltwater (the tank); your target in meltwater; cracked ice
// under you during Korzul's fight; Korzul in the air; then the Lockbound
// readout on a targeted Korgath; then, below every boss alert, the trash
// debuffs (the trash mechanics pass, mob/trash_kit/sanctum_cast_ids.ts): a
// Goadsmith's brand burning on you, then Creeping Rime at 3 or 4 stacks (the
// next Rime Breath freezes you); last, a hint: an Ice Slab the Ogre
// Sledge-Hauler just threw down near you is solid cover (it blocks line of
// sight), shown for its first SLAB_HINT_SECONDS. Every bar is the threat's own
// time left (the caster's bar or the mark; the hint's own seconds). The
// painter is the shared encounter alert's (encounter_alert_painter.ts).

import { GRAVEWYRM_SANCTUM_MOBS } from '../../../sim/content/gravewyrm_sanctum';
import { SEAL_PILLARS } from '../../../sim/content/gravewyrm_sanctum_layout';
import {
  BONEWALKER_ID,
  KORGATH_BELLOW,
  KORGATH_CHAIN_FLAIL,
  KORGATH_ID,
  KORGATH_LOCKBOUND,
  KORGATH_MAUL_ARC,
  KORGATH_REACH,
  KORGATH_STOMP,
  KORGATH_STRAIN,
  KORGATH_THRESHOLD_CHARGE,
  KORGATH_TUNING,
  KORZUL_AIRBORNE,
  KORZUL_CRASHING_DESCENT,
  KORZUL_GRAVE_BREATH,
  KORZUL_GRAVE_INFERNO,
  KORZUL_ID,
  KORZUL_PLUNGING_FIRE,
  KORZUL_REACH,
  KORZUL_TAIL_SWEEP,
  KORZUL_TUNING,
  KORZUL_WYRMS_EYE,
  plateOf,
  SANCTUM_LANDING_SHADOW,
  SANCTUM_PLUNGING_FIRE,
  SANCTUM_QUENCH_WATER,
  SANCTUM_TRENCH_LANE,
  SEAL_TOOLS,
  sealChainOf,
  VELKHAR_GRASP,
  VELKHAR_ID,
  VELKHAR_SOULFIRE_TRENCH,
  VELKHAR_TUNING,
} from '../../../sim/encounters/gravewyrm_sanctum/ids';
import {
  SANCTUM_BRANDED,
  SANCTUM_CREEPING_RIME,
} from '../../../sim/mob/trash_kit/sanctum_cast_ids';
import { formatNumber, t } from '../../i18n';
import type { EncounterAlertHidden, EncounterAlertLive } from './encounter_alert_view';

export type SanctumAlertKind =
  | 'quench'
  | 'plunge'
  | 'descent'
  | 'eye'
  | 'eye-cracked'
  | 'flail'
  | 'charge'
  | 'trench'
  | 'strain'
  | 'inferno'
  | 'stomp'
  | 'breath'
  | 'maul'
  | 'tail'
  | 'meltwater'
  | 'meltwater-target'
  | 'cracked'
  | 'flight'
  | 'lockbound'
  | 'branded'
  | 'rime'
  | 'slab';

/** Every kind class the painter toggles (the CSS keys on them). */
export const SANCTUM_ALERT_KINDS: readonly SanctumAlertKind[] = [
  'quench',
  'plunge',
  'descent',
  'eye',
  'eye-cracked',
  'flail',
  'charge',
  'trench',
  'strain',
  'inferno',
  'stomp',
  'breath',
  'maul',
  'tail',
  'meltwater',
  'meltwater-target',
  'cracked',
  'flight',
  'lockbound',
  'branded',
  'rime',
  'slab',
];

export type SanctumAlertLive = Omit<EncounterAlertLive, 'kind'> & { kind: SanctumAlertKind };
export type SanctumAlertView = SanctumAlertLive | EncounterAlertHidden;

const HIDDEN: EncounterAlertHidden = { visible: false };

/** Extra yards past a strike's stated reach a warning still fires at (the
 *  bosses' bodies are wide; a warning errs toward telling). */
const REACH_MARGIN = 2;

/** Creeping Rime's stack count that freezes (the Rime Whelp's
 *  freezeStack.maxStacks), and the count the alert starts warning at: two
 *  short of it, so at 3 or 4 the next breath or two means Iced Over. */
export const RIME_FREEZE_STACKS =
  GRAVEWYRM_SANCTUM_MOBS.rime_whelp?.trashKit?.cone?.freezeStack?.maxStacks ?? 5;
export const RIME_WARN_STACKS = RIME_FREEZE_STACKS - 2;

/** An Ice Slab's cover hint: shown this long after the slab is first seen,
 *  while the player stands within SLAB_HINT_RANGE of it. */
export const SLAB_HINT_SECONDS = 5;
export const SLAB_HINT_RANGE = 25;

interface AlertAura {
  id: string;
  remaining?: number;
  duration?: number;
  value?: number;
  stacks?: number;
}

/** A body the alert reads (a boss, a Bonewalker, a Sanctum encounter object). */
export interface SanctumAlertEntity {
  id?: number;
  kind?: string;
  templateId?: string;
  dead?: boolean;
  pos?: { x: number; z: number };
  facing?: number;
  scale?: number;
  auras?: readonly AlertAura[];
  castingAbility?: string | null;
  castTargetId?: number | null;
  castRemaining?: number;
  castTotal?: number;
  aggroTargetId?: number | null;
  inCombat?: boolean;
}

/** The Sanctum bodies the alert reads that are not the player. */
export interface SanctumAlertScene {
  korgath: SanctumAlertEntity | null;
  velkhar: SanctumAlertEntity | null;
  korzul: SanctumAlertEntity | null;
  /** The seal chain objects (any state). */
  chains: readonly SanctumAlertEntity[];
  /** The lake's plate objects (any state). */
  plates: readonly SanctumAlertEntity[];
  /** Plunging Fire warnings, landing shadows and Soulfire Trench lanes. */
  fires: readonly SanctumAlertEntity[];
  shadows: readonly SanctumAlertEntity[];
  trenches: readonly SanctumAlertEntity[];
  bonewalkers: readonly SanctumAlertEntity[];
  /** The standing Ice Slabs, and (same order) the clock each was first seen
   *  at (the scene scan's `now`). */
  slabs: readonly SanctumAlertEntity[];
  slabBorn: readonly number[];
}

export interface SanctumAlertInput {
  selfId: number;
  selfPos: { x: number; z: number };
  auras: readonly AlertAura[];
  targetId: number | null | undefined;
  entity: (id: number) => SanctumAlertEntity | null | undefined;
  scene: SanctumAlertScene;
  /** The caller's clock in seconds (the same one the scene scan stamps the
   *  slabs with); without it the slab hint never shows. */
  now?: number;
}

export const EMPTY_SANCTUM_SCENE: SanctumAlertScene = {
  korgath: null,
  velkhar: null,
  korzul: null,
  chains: [],
  plates: [],
  fires: [],
  shadows: [],
  trenches: [],
  bonewalkers: [],
  slabs: [],
  slabBorn: [],
};

// ---- small pure geometry ------------------------------------------------------

function auraOf(auras: readonly AlertAura[] | undefined, id: string): AlertAura | null {
  if (!auras) return null;
  for (const a of auras) if (a.id === id) return a;
  return null;
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Is `p` within `range` of `from` and inside the `arcDeg` cone along `yaw`
 *  (yaw 0 = +Z, the sim's facing convention)? */
export function inArc(
  from: { x: number; z: number },
  yaw: number,
  p: { x: number; z: number },
  range: number,
  arcDeg: number,
): boolean {
  const dx = p.x - from.x;
  const dz = p.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d > range) return false;
  if (d < 1e-6) return true;
  const cos = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d;
  return cos >= Math.cos(((arcDeg / 2) * Math.PI) / 180) - 1e-9;
}

/** Is `p` inside the lane that runs `length` yards from `from` along `yaw`,
 *  `halfWidth` either side? */
export function inLaneAt(
  from: { x: number; z: number },
  yaw: number,
  length: number,
  halfWidth: number,
  p: { x: number; z: number },
): boolean {
  const dx = p.x - from.x;
  const dz = p.z - from.z;
  const along = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  const side = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  return along >= -1 && along <= length && Math.abs(side) <= halfWidth;
}

/** The plate under `p`: the nearest plate centre, when `p` stands within its
 *  radius (plus a little, the seams), else null (the shelf, or off the lake). */
export function plateUnder(
  plates: readonly SanctumAlertEntity[],
  p: { x: number; z: number },
): SanctumAlertEntity | null {
  let best: SanctumAlertEntity | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const plate of plates) {
    if (!plate.pos || !plate.templateId || plateOf(plate.templateId) === null) continue;
    const d = dist(plate.pos, p);
    if (d < bestD - 1e-9) {
      best = plate;
      bestD = d;
    }
  }
  if (!best) return null;
  const r = best.scale && best.scale > 0 ? best.scale : 8;
  return bestD <= r * 1.25 ? best : null;
}

/** The world position of an intact chain's seal pillar: its chain object sits
 *  on the pillar's shackle spot, so the instance offset is the object's world
 *  position less the layout's local shackle spot. */
function pillarOf(chain: SanctumAlertEntity): { x: number; z: number } | null {
  const c = chain.templateId ? sealChainOf(chain.templateId) : null;
  if (!c || !chain.pos) return null;
  const pillar = SEAL_PILLARS[SEAL_TOOLS.indexOf(c.tool)];
  if (!pillar) return null;
  return {
    x: chain.pos.x - pillar.shackle.x + pillar.x,
    z: chain.pos.z - pillar.shackle.z + pillar.z,
  };
}

function casting(e: SanctumAlertEntity | null, id: string): e is SanctumAlertEntity {
  return !!e && !e.dead && e.castingAbility === id;
}

function barShare(e: SanctumAlertEntity): number | null {
  if (!e.castTotal || e.castTotal <= 0 || e.castRemaining === undefined) return null;
  return Math.max(0, Math.min(1, e.castRemaining / e.castTotal));
}

function markShare(a: AlertAura): number | null {
  if (!a.duration || a.duration <= 0 || a.remaining === undefined) return null;
  return Math.max(0, Math.min(1, a.remaining / a.duration));
}

/** The panel title per kind (the two Eye kinds and the two meltwater kinds
 *  share theirs). */
function titleOf(kind: SanctumAlertKind): string {
  switch (kind) {
    case 'quench':
      return t('hudChrome.sanctumAlert.quenchTitle');
    case 'plunge':
      return t('hudChrome.sanctumAlert.plungeTitle');
    case 'descent':
      return t('hudChrome.sanctumAlert.descentTitle');
    case 'eye':
    case 'eye-cracked':
      return t('hudChrome.sanctumAlert.eyeTitle');
    case 'flail':
      return t('hudChrome.sanctumAlert.flailTitle');
    case 'charge':
      return t('hudChrome.sanctumAlert.chargeTitle');
    case 'trench':
      return t('hudChrome.sanctumAlert.trenchTitle');
    case 'strain':
      return t('hudChrome.sanctumAlert.strainTitle');
    case 'inferno':
      return t('hudChrome.sanctumAlert.infernoTitle');
    case 'stomp':
      return t('hudChrome.sanctumAlert.stompTitle');
    case 'breath':
      return t('hudChrome.sanctumAlert.breathTitle');
    case 'maul':
      return t('hudChrome.sanctumAlert.maulTitle');
    case 'tail':
      return t('hudChrome.sanctumAlert.tailTitle');
    case 'meltwater':
    case 'meltwater-target':
      return t('hudChrome.sanctumAlert.meltwaterTitle');
    case 'cracked':
      return t('hudChrome.sanctumAlert.crackedTitle');
    case 'flight':
      return t('hudChrome.sanctumAlert.flightTitle');
    case 'lockbound':
      return t('hudChrome.sanctumAlert.lockboundTitle');
    case 'branded':
      return t('hudChrome.sanctumAlert.brandedTitle');
    case 'rime':
      return t('hudChrome.sanctumAlert.rimeTitle');
    case 'slab':
      return t('hudChrome.sanctumAlert.slabTitle');
  }
}

function live(
  kind: SanctumAlertKind,
  line: string,
  progress: number | null,
  seconds: number | null,
): SanctumAlertLive {
  const title = titleOf(kind);
  return {
    visible: true,
    kind,
    title,
    line,
    hint: '',
    key: '',
    progress,
    progressAria:
      seconds === null
        ? ''
        : t('hudChrome.sanctumAlert.timeAria', {
            seconds: formatNumber(Math.max(0, Math.ceil(seconds)), { maximumFractionDigits: 0 }),
          }),
    pressable: false,
    buttonAria: title,
  };
}

function fromBar(
  kind: SanctumAlertKind,
  line: string,
  caster: SanctumAlertEntity,
): SanctumAlertLive {
  return live(kind, line, barShare(caster), caster.castRemaining ?? null);
}

// ---- the view -------------------------------------------------------------------

export function buildSanctumAlertView(input: SanctumAlertInput): SanctumAlertView {
  const { scene, selfPos: me, selfId } = input;
  const korgath = scene.korgath && !scene.korgath.dead ? scene.korgath : null;
  const velkhar = scene.velkhar && !scene.velkhar.dead ? scene.velkhar : null;
  const korzul = scene.korzul && !scene.korzul.dead ? scene.korzul : null;

  // 1. In a broken plate's water.
  const quench = auraOf(input.auras, SANCTUM_QUENCH_WATER);
  if (quench) return live('quench', t('hudChrome.sanctumAlert.quenchLine'), null, null);

  // 2. On the plate a Plunging Fire is about to burn (its fire object covers
  //    the whole plate; the bar is Korzul's when he is the one pouring it).
  const myPlate = plateUnder(scene.plates, me);
  for (const fire of scene.fires) {
    if (!fire.pos) continue;
    const onIt = myPlate?.pos
      ? dist(myPlate.pos, fire.pos) < 1
      : dist(fire.pos, me) <= (fire.scale ?? 8);
    if (!onIt) continue;
    const bar =
      korzul && korzul.castingAbility === KORZUL_PLUNGING_FIRE && korzul.castTargetId === fire.id
        ? korzul
        : null;
    return live(
      'plunge',
      t('hudChrome.sanctumAlert.plungeLine'),
      bar ? barShare(bar) : null,
      bar?.castRemaining ?? null,
    );
  }

  // 3. Inside the landing shadow of a Crashing Descent.
  for (const shadow of scene.shadows) {
    if (!shadow.pos || dist(shadow.pos, me) > (shadow.scale ?? KORZUL_TUNING.descentRadius))
      continue;
    const bar = casting(korzul, KORZUL_CRASHING_DESCENT) ? korzul : null;
    return live(
      'descent',
      t('hudChrome.sanctumAlert.descentLine'),
      bar ? barShare(bar) : null,
      bar?.castRemaining ?? null,
    );
  }

  // 4. Carrying the Wyrm's Eye: the plate under you burns when it ends.
  const eye = auraOf(input.auras, KORZUL_WYRMS_EYE);
  if (eye) {
    const st = myPlate?.templateId ? plateOf(myPlate.templateId)?.state : undefined;
    const bad = st === 'cracked' || st === 'broken';
    return live(
      bad ? 'eye-cracked' : 'eye',
      bad ? t('hudChrome.sanctumAlert.eyeCrackedLine') : t('hudChrome.sanctumAlert.eyeLine'),
      markShare(eye),
      eye.remaining ?? null,
    );
  }

  // 5. The lanes: aimed at you, or you stand in one.
  if (korgath && korgath.pos) {
    const lanes = [
      [KORGATH_CHAIN_FLAIL, 'flail', KORGATH_REACH.flail, KORGATH_TUNING.flailHalfWidth],
      [KORGATH_THRESHOLD_CHARGE, 'charge', KORGATH_REACH.charge, KORGATH_TUNING.chargeHalfWidth],
    ] as const;
    for (const [id, kind, length, half] of lanes) {
      if (korgath.castingAbility !== id) continue;
      const mine = korgath.castTargetId === selfId;
      if (mine || inLaneAt(korgath.pos, korgath.facing ?? 0, length, half + 1, me))
        return fromBar(
          kind,
          kind === 'flail'
            ? t('hudChrome.sanctumAlert.flailLine')
            : t('hudChrome.sanctumAlert.chargeLine'),
          korgath,
        );
    }
  }
  if (velkhar) {
    let lane: SanctumAlertEntity | null = null;
    for (const tr of scene.trenches) {
      if (!tr.pos) continue;
      if (
        inLaneAt(
          tr.pos,
          tr.facing ?? 0,
          tr.scale ?? VELKHAR_TUNING.trenchLength,
          VELKHAR_TUNING.trenchWidth / 2 + 1,
          me,
        )
      ) {
        lane = tr;
        break;
      }
    }
    const aimed = velkhar.castingAbility === VELKHAR_SOULFIRE_TRENCH;
    if ((aimed && velkhar.castTargetId === selfId) || (aimed && lane))
      return fromBar('trench', t('hudChrome.sanctumAlert.trenchLine'), velkhar);
  }

  // 6. Strain: a ring round each pillar whose chain still holds.
  if (casting(korgath, KORGATH_STRAIN)) {
    for (const chain of scene.chains) {
      const c = chain.templateId ? sealChainOf(chain.templateId) : null;
      if (!c || c.state !== 'intact') continue;
      const pillar = pillarOf(chain);
      if (pillar && dist(pillar, me) <= KORGATH_TUNING.strainRadius + REACH_MARGIN)
        return fromBar('strain', t('hudChrome.sanctumAlert.strainLine'), korgath);
    }
  }

  // 7. Grave Inferno's channel round Korzul.
  if (
    casting(korzul, KORZUL_GRAVE_INFERNO) &&
    korzul.pos &&
    dist(korzul.pos, me) <= KORZUL_TUNING.infernoRadius + REACH_MARGIN
  )
    return fromBar('inferno', t('hudChrome.sanctumAlert.infernoLine'), korzul);

  // 8. Shuddering Stomp round Korgath.
  if (
    casting(korgath, KORGATH_STOMP) &&
    korgath.pos &&
    dist(korgath.pos, me) <= KORGATH_REACH.stomp + REACH_MARGIN
  )
    return fromBar('stomp', t('hudChrome.sanctumAlert.stompLine'), korgath);

  // 9. Grave Breath's cone (the tank it is aimed along takes none of it).
  if (
    casting(korzul, KORZUL_GRAVE_BREATH) &&
    korzul.pos &&
    korzul.aggroTargetId !== selfId &&
    inArc(
      korzul.pos,
      korzul.facing ?? 0,
      me,
      KORZUL_REACH.breath + REACH_MARGIN,
      KORZUL_TUNING.breathArcDeg,
    )
  )
    return fromBar('breath', t('hudChrome.sanctumAlert.breathLine'), korzul);

  // 10. Maul Arc in front of Korgath (the tank faces it away; everyone else
  //     steps behind him).
  if (
    casting(korgath, KORGATH_MAUL_ARC) &&
    korgath.pos &&
    korgath.aggroTargetId !== selfId &&
    inArc(
      korgath.pos,
      korgath.facing ?? 0,
      me,
      KORGATH_REACH.maul + REACH_MARGIN,
      KORGATH_TUNING.maulArcDeg,
    )
  )
    return fromBar('maul', t('hudChrome.sanctumAlert.maulLine'), korgath);

  // 11. Tail Sweep behind Korzul.
  if (
    casting(korzul, KORZUL_TAIL_SWEEP) &&
    korzul.pos &&
    inArc(
      korzul.pos,
      (korzul.facing ?? 0) + Math.PI,
      me,
      KORZUL_REACH.tail + REACH_MARGIN,
      KORZUL_TUNING.tailArcDeg,
    )
  )
    return fromBar('tail', t('hudChrome.sanctumAlert.tailLine'), korzul);

  // 12. A Bonewalker in meltwater: the one on you (the tank drags it out), or
  //     the one you are hitting (it rises again if it dies there).
  for (const b of scene.bonewalkers) {
    if (b.dead || b.aggroTargetId !== selfId || !auraOf(b.auras, VELKHAR_GRASP)) continue;
    return live('meltwater', t('hudChrome.sanctumAlert.meltwaterLine'), null, null);
  }
  if (input.targetId !== null && input.targetId !== undefined) {
    const target = input.entity(input.targetId);
    if (
      target &&
      !target.dead &&
      target.templateId === BONEWALKER_ID &&
      auraOf(target.auras, VELKHAR_GRASP)
    )
      return live('meltwater-target', t('hudChrome.sanctumAlert.meltwaterTargetLine'), null, null);
  }

  // 13. Cracked ice under you while Korzul fights: fire there breaks it. The
  //     bar is the plate's refreeze clock (none on heroic Deep Quench).
  if (korzul && korzul.inCombat && myPlate?.templateId) {
    const plate = plateOf(myPlate.templateId);
    if (plate?.state === 'cracked')
      return live(
        'cracked',
        t('hudChrome.sanctumAlert.crackedLine'),
        plate.refreeze,
        plate.refreeze === null ? null : plate.refreeze * KORZUL_TUNING.refreezeSeconds,
      );
  }

  // 14. Korzul in the air: stack on sound ice to choose his landing.
  if (korzul && auraOf(korzul.auras, KORZUL_AIRBORNE))
    return live('flight', t('hudChrome.sanctumAlert.flightLine'), null, null);

  // 15. The Lockbound readout on a targeted Korgath.
  if (korgath && input.targetId !== null && input.targetId !== undefined) {
    const target = input.entity(input.targetId);
    const lock = target === korgath || target?.templateId === KORGATH_ID;
    const aura = lock ? auraOf(korgath.auras, KORGATH_LOCKBOUND) : null;
    if (aura && (aura.value ?? 0) > 0) {
      const pct = Math.round((aura.value ?? 0) * 100);
      const chains = Math.round((aura.value ?? 0) / KORGATH_TUNING.lockboundPerChain);
      return live(
        'lockbound',
        t('hudChrome.sanctumAlert.lockboundLine', {
          chains: formatNumber(chains, { maximumFractionDigits: 0 }),
          pct: formatNumber(pct, { maximumFractionDigits: 0 }),
        }),
        null,
        null,
      );
    }
  }

  // 16. A Goadsmith's brand burning on you: a meltwater pool puts it out.
  const brand = auraOf(input.auras, SANCTUM_BRANDED);
  if (brand)
    return live(
      'branded',
      t('hudChrome.sanctumAlert.brandedLine'),
      markShare(brand),
      brand.remaining ?? null,
    );

  // 17. Creeping Rime one or two stacks from freezing you solid.
  const rime = auraOf(input.auras, SANCTUM_CREEPING_RIME);
  if (rime && (rime.stacks ?? 0) >= RIME_WARN_STACKS)
    return live(
      'rime',
      t('hudChrome.sanctumAlert.rimeLine', {
        stacks: formatNumber(rime.stacks ?? 0, { maximumFractionDigits: 0 }),
        max: formatNumber(RIME_FREEZE_STACKS, { maximumFractionDigits: 0 }),
      }),
      markShare(rime),
      rime.remaining ?? null,
    );

  // 18. An Ice Slab just thrown down near you: it is cover from the casters.
  const now = input.now;
  if (now !== undefined) {
    for (let i = 0; i < scene.slabs.length; i++) {
      const slab = scene.slabs[i];
      const age = now - (scene.slabBorn[i] ?? now);
      if (slab.dead || !slab.pos || age < 0 || age > SLAB_HINT_SECONDS) continue;
      if (dist(slab.pos, me) > SLAB_HINT_RANGE) continue;
      return live(
        'slab',
        t('hudChrome.sanctumAlert.slabLine'),
        1 - age / SLAB_HINT_SECONDS,
        SLAB_HINT_SECONDS - age,
      );
    }
  }
  return HIDDEN;
}

/** Bellow is unavoidable (no alert): exported so the tests pin that the
 *  alert stays quiet for it. */
export const SANCTUM_ALERT_SILENT_CASTS: readonly string[] = [KORGATH_BELLOW];
