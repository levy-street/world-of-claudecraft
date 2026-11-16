// The Guardian of the Breath's tank swap (docs/design/raid/smith_heart.md
// section 7.2; the owner's brief of 2026-11-16).
//
//   Bellows Blow    the Wind (100 to 50): every 10 s a 1.5 s bar at the tank
//                   (planted; the telegraph under the tank is the throw's
//                   line and length, BREATH_AURAS.blowMark), then a blow of
//                   wind: Nature damage, and a throw straight away from the
//                   guardian that SLIDES (breath_shove.ts 'knock', the Summit
//                   own hold aura `blown`, the hop drawn as the Roar's), its length the tier's
//                   `blowThrow` by the Wind-Battered stacks already on, then
//                   one stack more (`blowStackSeconds`, refreshed by each blow).
//                   Heroic and Mythic: the fifth blow throws 60 yd, off the
//                   Cornice from anywhere on it (the void kills): swap at 3.
//                   Normal: the throw stops `blowLipMargin` in from any lip
//                   (`blowSafe`): it displaces, never kills.
//   Thunder Lash    the Storm (50 to 0): the same bar and cadence, a lash of
//                   lightning at the tank (Nature damage) and a stack of
//                   Thunder-Laden: more magic damage taken per stack (a
//                   `spellvuln`; every hit of the Storm is Nature), and from
//                   the tier's `thunderDraw` stacks every Leaping Bolt leaps
//                   on to them after its path (`drawBolts`, called by
//                   breath_storm.ts landFork: the path itself unchanged).
//   The storm breaks  the Wind's stacks are spent.
//
// The anchored and the Knotted Gale's carrier keep their feet (heldFast):
// the blow lands and stacks, the throw does not. The bars are the lowest of
// the guardian's (a due one waits for a free guardian). Zero rng but the
// damage rolls (the tank's, then each drawn bolt's in player order).

import { SMITH_HEART_FIELD } from '../../content/smith_heart_layout';
import { authoredFieldHeight } from '../../instances/authored_field';
import { DT, type Entity } from '../../types';
import { gapAt, inBreathArena, lipDistance } from './breath_geometry';
import {
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_CUES,
  BREATH_NAMES,
  type BreathDifficultyRules,
  BREATH_TUNING as T,
} from './breath_ids';
import {
  auraOf,
  type BreathScope,
  beginBar,
  dropAura,
  guardianFree,
  livePlayers,
  local,
  putMarker,
  roll,
} from './breath_scope';
import { type BreathShove, beginShove, clearShoves, stepShoves } from './breath_shove';

/** A body's stacks of `aura` (0 without it). */
export function stacksOf(p: Pick<Entity, 'auras'>, aura: string): number {
  const a = p.auras.find((x) => x.id === aura);
  return a ? Math.max(1, a.stacks ?? 1) : 0;
}

/** Bellows Blow's throw (yards) on a tank already carrying `stacks`. Pure. */
export function blowThrow(rules: Pick<BreathDifficultyRules, 'blowThrow'>, stacks: number): number {
  const row = rules.blowThrow;
  return row[Math.max(0, Math.min(row.length - 1, stacks))] ?? 0;
}

/** Is the throw on a tank carrying `stacks` the row's ruinous one (the last
 *  step on a tier that throws off the Cornice)? Pure. */
export function blowRuinous(
  rules: Pick<BreathDifficultyRules, 'blowThrow' | 'blowSafe'>,
  stacks: number,
): boolean {
  return !rules.blowSafe && stacks >= rules.blowThrow.length - 1;
}

/** How far a throw from instance-local (x, z) along the unit (ux, uz) may go
 *  and still stand `margin` in from every lip, at most `yards` (half-yard
 *  steps; 0 when the first step is already too near). Pure over the layout. */
export function safeThrowReach(
  x: number,
  z: number,
  ux: number,
  uz: number,
  yards: number,
  margin: number = T.blowLipMargin,
): number {
  let ok = 0;
  for (let d = 0.5; d <= yards + 1e-9; d += 0.5) {
    const px = x + ux * d;
    const pz = z + uz * d;
    if (!inBreathArena(px, pz) || gapAt(px, pz) || lipDistance(px, pz) < margin) break;
    ok = d;
  }
  return Math.min(ok, yards);
}

/** How far the Cornice's floor runs from instance-local (x, z) along the
 *  unit (ux, uz) before the void (half-yard steps, at most `yards`): where a
 *  throw leaves the floor. Pure over the authored field. */
export function floorReach(x: number, z: number, ux: number, uz: number, yards: number): number {
  let ok = 0;
  for (let d = 0.5; d <= yards + 1e-9; d += 0.5) {
    const h = authoredFieldHeight(SMITH_HEART_FIELD, x + ux * d, z + uz * d);
    if (h <= SMITH_HEART_FIELD.voidHeight + 1) break;
    ok = d;
  }
  return ok;
}

/** The tank the guardian holds now: its aggro target, alive on the Cornice. */
function tankOf(s: BreathScope): Entity | null {
  const id = s.boss.aggroTargetId;
  if (id === null) return null;
  return livePlayers(s).find((p) => p.id === id) ?? null;
}

/** Begin Bellows Blow (the Wind) or Thunder Lash (the Storm) at the tank.
 *  Exported for the dev trigger. */
export function startBlow(s: BreathScope): boolean {
  const t = tankOf(s);
  if (!t) return false;
  if (s.st.half === 'storm') {
    beginBar(s, BREATH_CASTS.thunder, T.thunderCast, t.id);
    s.st.thunderTimer = T.thunderEvery;
    return true;
  }
  const stacks = stacksOf(t, BREATH_AURAS.battered);
  beginBar(s, BREATH_CASTS.blow, T.blowCast, t.id);
  s.st.blowTimer = T.blowEvery;
  // The telegraph's length: the throw, held short of the lip on a safe tier
  // as the landing will hold it (from where the tank stands now).
  let yards = blowThrow(s.rules, stacks);
  if (s.rules.blowSafe) {
    const at = local(s.ctx, s.inst, t);
    const b = s.boss;
    const d = Math.hypot(t.pos.x - b.pos.x, t.pos.z - b.pos.z);
    if (d > 1e-3)
      yards = safeThrowReach(at.x, at.z, (t.pos.x - b.pos.x) / d, (t.pos.z - b.pos.z) / d, yards);
  }
  putMarker(t, BREATH_AURAS.blowMark, BREATH_NAMES.blow, T.blowCast + 0.2, s.boss.id, {
    value: yards,
    value2: blowRuinous(s.rules, stacks) ? 1 : 0,
  });
  return true;
}

/** Add a stack of `aura` to `p` (at most `max`), refreshed for `seconds`;
 *  `vuln` a stack's magic damage taken (0: a plain marker), `info` the
 *  numbers the client reads off it for the stacks it now has. */
function stack(
  s: BreathScope,
  p: Entity,
  aura: string,
  name: string,
  max: number,
  seconds: number,
  vuln: number,
  info: (stacks: number) => { value2: number; value3: number; value?: number },
): number {
  const have = auraOf(p, aura);
  const stacks = Math.min(max, (have ? Math.max(1, have.stacks ?? 1) : 0) + 1);
  const nums = info(stacks);
  const value = vuln > 0 ? vuln * stacks : (nums.value ?? 0);
  if (have) {
    have.stacks = stacks;
    have.remaining = seconds;
    have.duration = seconds;
    have.value = value;
    have.value2 = nums.value2;
    have.value3 = nums.value3;
    s.ctx.emit({ type: 'aura', targetId: p.id, name, gained: true });
    return stacks;
  }
  s.ctx.applyAura(p, {
    id: aura,
    name,
    kind: vuln > 0 ? 'spellvuln' : 'internal_cd',
    remaining: seconds,
    duration: seconds,
    value,
    value2: nums.value2,
    value3: nums.value3,
    stacks,
    sourceId: s.boss.id,
    school: 'nature',
    undispellable: true,
  });
  return stacks;
}

/** Wind-Battered's stack on `p` (the next throw and the swap ride on it). */
function batter(s: BreathScope, p: Entity): number {
  const r = s.rules;
  return stack(
    s,
    p,
    BREATH_AURAS.battered,
    BREATH_NAMES.battered,
    r.blowMax,
    T.blowStackSeconds,
    0,
    (k) => ({
      value: blowThrow(r, k),
      value2: blowRuinous(r, k) ? 1 : 0,
      value3: r.blowSwap,
    }),
  );
}

/** Thunder-Laden's stack on `p`. */
function charge(s: BreathScope, p: Entity): number {
  const r = s.rules;
  return stack(
    s,
    p,
    BREATH_AURAS.thunderLaden,
    BREATH_NAMES.thunderLaden,
    r.thunderMax,
    T.thunderSeconds,
    r.thunderPct,
    () => ({ value2: r.thunderDraw, value3: r.thunderSwap }),
  );
}

/** Bellows Blow lands on the tank: the hit, the throw, the stack. Returns
 *  the yards it was sent (0 for a body that kept its feet), for the tests. */
export function landBlow(s: BreathScope, targetId: number | null): number {
  const t = targetId !== null ? s.ctx.entities.get(targetId) : undefined;
  if (t) dropAura(t, BREATH_AURAS.blowMark);
  if (!t || t.dead || !s.players.includes(t)) return 0;
  const b = s.boss;
  const stacks = stacksOf(t, BREATH_AURAS.battered);
  s.ctx.emit({
    type: 'spellfx',
    sourceId: b.id,
    targetId: t.id,
    school: 'nature',
    fx: 'nova',
    ability: BREATH_CUES.blow,
  });
  s.ctx.dealDamage(
    b,
    t,
    roll(s, T.blowHitMin, T.blowHitMax),
    false,
    'nature',
    BREATH_NAMES.blow,
    'hit',
    true,
  );
  if (t.dead) return 0;
  batter(s, t);
  let dx = t.pos.x - b.pos.x;
  let dz = t.pos.z - b.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) {
    dx = Math.sin(b.facing);
    dz = Math.cos(b.facing);
  } else {
    dx /= d;
    dz /= d;
  }
  let yards = blowThrow(s.rules, stacks);
  const at = local(s.ctx, s.inst, t);
  if (s.rules.blowSafe) yards = safeThrowReach(at.x, at.z, dx, dz, yards);
  else if (blowRuinous(s.rules, stacks))
    // The ruinous throw goes a few yards past the lip and no further: the
    // body leaves the floor late in its slide, slow, and falls by the
    // Cornice where the void counts it (a fast one sails out of its reach).
    yards = Math.min(yards, floorReach(at.x, at.z, dx, dz, yards) + T.blowPastLip);
  const shove = beginShove(
    s,
    t,
    dx,
    dz,
    yards,
    blowRuinous(s.rules, stacks) ? Math.max(T.roarSlide, yards / T.blowPace) : T.roarSlide,
    'knock',
    BREATH_AURAS.blown,
    BREATH_NAMES.blow,
  );
  if (!shove) return 0;
  s.st.blowSlides.push(shove);
  return yards;
}

/** Thunder Lash lands on the tank: the hit and a Thunder-Laden stack.
 *  Returns the stacks (0 when it found nobody). */
export function landThunder(s: BreathScope, targetId: number | null): number {
  const t = targetId !== null ? s.ctx.entities.get(targetId) : undefined;
  if (!t || t.dead || !s.players.includes(t)) return 0;
  const b = s.boss;
  s.ctx.emit({
    type: 'spellfx',
    sourceId: b.id,
    targetId: t.id,
    school: 'nature',
    fx: 'beam',
    ability: BREATH_CUES.thunder,
  });
  s.ctx.dealDamage(
    b,
    t,
    roll(s, T.thunderMin, T.thunderMax),
    false,
    'nature',
    BREATH_NAMES.thunder,
    'hit',
    true,
  );
  if (t.dead) return 0;
  return charge(s, t);
}

/** A Leaping Bolt's path has run: it leaps on to every Thunder-Laden player
 *  at the tier's `thunderDraw` stacks it has not struck (player order), each
 *  leg from the last struck. Returns who (the tests read it). */
export function drawBolts(
  s: BreathScope,
  path: readonly Entity[],
  min: number,
  max: number,
): Entity[] {
  const drawn: Entity[] = [];
  let from: Entity | undefined = path[path.length - 1];
  if (!from) return drawn;
  for (const p of livePlayers(s)) {
    if (path.includes(p)) continue;
    if (stacksOf(p, BREATH_AURAS.thunderLaden) < s.rules.thunderDraw) continue;
    s.ctx.emit({
      type: 'spellfx',
      sourceId: from.id,
      targetId: p.id,
      school: 'nature',
      fx: 'beam',
      ability: BREATH_CUES.thunderDraw,
    });
    s.ctx.dealDamage(s.boss, p, roll(s, min, max), false, 'nature', BREATH_NAMES.fork, 'hit', true);
    drawn.push(p);
    from = p;
  }
  return drawn;
}

/** One tick: the clocks of the half under way, the throws sliding, and the
 *  Wind's stacks spent once the storm breaks. */
export function stepBlow(s: BreathScope): void {
  stepShoves(s, s.st.blowSlides);
  const half = s.st.half;
  if (half === 'wind') s.st.blowTimer -= DT;
  else if (half === 'storm' && !s.st.barrage) s.st.thunderTimer -= DT;
  if (half !== 'wind') for (const p of s.players) dropAura(p, BREATH_AURAS.battered);
}

/** The guardian's swap bar when due and free (the lowest of its bars). */
export function startBlowBars(s: BreathScope): void {
  const due =
    s.st.half === 'wind'
      ? s.st.blowTimer <= 0
      : s.st.half === 'storm' && !s.st.barrage && s.st.thunderTimer <= 0;
  if (!due || !guardianFree(s)) return;
  // No tank on the floor (a rider, a body in the air): look again in a second.
  if (!startBlow(s)) {
    if (s.st.half === 'wind') s.st.blowTimer = 1;
    else s.st.thunderTimer = 1;
  }
}

/** Dev: the guardian's tank carries `n` stacks of the half's swap aura
 *  (each landed as its hit would, without the hit). */
export function setBlowStacksForDev(s: BreathScope, n: number): void {
  const t = tankOf(s);
  if (!t) return;
  const storm = s.st.half === 'storm';
  const aura = storm ? BREATH_AURAS.thunderLaden : BREATH_AURAS.battered;
  dropAura(t, aura);
  for (let i = 0; i < n; i++)
    if (storm) charge(s, t);
    else batter(s, t);
}

/** Every mark of the swap off `bodies`, every throw let go (a reset, the end). */
export function clearBlow(
  s: Pick<BreathScope, 'ctx'>,
  st: { blowSlides: BreathShove[] },
  bodies: readonly Entity[],
): void {
  clearShoves(s, st.blowSlides);
  for (const p of bodies) {
    dropAura(p, BREATH_AURAS.battered);
    dropAura(p, BREATH_AURAS.thunderLaden);
    dropAura(p, BREATH_AURAS.blowMark);
    dropAura(p, BREATH_AURAS.blown);
  }
}
