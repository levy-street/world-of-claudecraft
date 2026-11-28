// The Guardian of the Heat's Wellspring Brand (the owner's call of 2026-11-27;
// docs/design/raid/smith_heart.md 7.4): the testers found a lull where the
// guardian casts or lands no swing for a while, Cinder Grip falls off and the
// swap pressure goes with it. So, on its own clock (HEAT_DIFFICULTY `brand`),
// the guardian hurls a brand of the first flame at its current tank, whatever
// it is doing: meleeing, on Basalt Fist's bar, or with its tank out of reach.
//
//   The tell   `lead` seconds out: the tank buster marker on the tank
//              (tank_buster.ts, so only that tank's HUD shows the hit and its
//              countdown, with the buster's sound) and the gathering cue on
//              the guardian (its hand gathers the fire).
//   The brand  Fire to the tank (HEAT_TUNING brandMin to brandMax times the
//              tier's damageMult) and the mark: `taken` more Fire and other
//              magic damage for `seconds` (a `spellvuln`, undispellable; the
//              swap debuff the tank swap alert counts at one brand).
//   Hidden     never while the guardian is sunk, under or rising (an
//              overflow): its clock stands still and a tell under way is
//              taken back, told again once it has risen.
//
// The tank is the guardian's own target (`aggroTargetId`) on the Hearth's
// floor; with none, the brand waits for one. Deterministic: no pick (the
// target is the threat table's), one damage roll per brand. `src/sim`-pure.

import { DT, type Entity } from '../../types';
import { HEAT_AURAS, HEAT_CUES, HEAT_NAMES, HEAT_TUNING as T } from './heat_ids';
import { beamCue, cueOnBoss, fireHit, type HeatScope, roll } from './heat_scope';
import { endTankBuster, warnTankBuster } from './tank_buster';

/** After an overflow, a tell taken back is told again this long after the
 *  guardian has risen (its brand `lead` later still). */
export const BRAND_AFTER_RISE = 1;

/** The guardian's tank: its target, a living player on the Hearth's floor. */
export function brandTank(s: HeatScope): Entity | null {
  const id = s.boss.aggroTargetId;
  if (id === null) return null;
  for (const p of s.players) if (p.id === id && !p.dead) return p;
  return null;
}

function untell(s: HeatScope): void {
  const id = s.st.brandTold;
  if (id === null) return;
  endTankBuster(s.ctx.entities.get(id), 'brand');
  s.st.brandTold = null;
}

/** The brand lands on `tank`: its Fire, its mark, its beam. */
export function landBrand(s: HeatScope, tank: Entity): void {
  const b = s.rules.brand;
  beamCue(s, s.boss.id, tank.id, HEAT_CUES.brand);
  fireHit(s, tank, roll(s, T.brandMin, T.brandMax), HEAT_NAMES.brand);
  s.st.brands++;
  if (tank.dead) return;
  s.ctx.applyAura(tank, {
    id: HEAT_AURAS.brand,
    name: HEAT_NAMES.brand,
    kind: 'spellvuln',
    remaining: b.seconds,
    duration: b.seconds,
    value: b.taken,
    value2: b.every,
    value3: T.brandSwap,
    sourceId: s.boss.id,
    school: 'fire',
    undispellable: true,
  });
}

/** One tick of Wellspring Brand. Runs every tick of the fight, after the
 *  overflow's own stages have moved (so a guardian under or rising never
 *  hurls one). The threshold that begins an overflow is watched later in the
 *  pass, so a brand due on that very tick still lands (the guardian was
 *  present at the tick's start); a tell begun then is taken back the next. */
export function stepBrand(s: HeatScope): void {
  const st = s.st;
  const b = s.rules.brand;
  if (st.stage !== 'fight') {
    // Hidden: the clock stands still; a tell under way is taken back.
    if (st.brandTold !== null) {
      untell(s);
      st.brandTimer = Math.max(st.brandTimer, b.lead + BRAND_AFTER_RISE);
    }
    return;
  }
  st.brandTimer = Math.max(0, st.brandTimer - DT);
  const tank = brandTank(s);
  if (st.brandTimer > b.lead + 1e-9) return;
  if (!tank) {
    // No tank to brand (its target is no living player on the Hearth's
    // floor: a pet, or nobody): the tell waits for one, the whole lead still
    // to run.
    untell(s);
    st.brandTimer = b.lead;
    return;
  }
  if (st.brandTold !== tank.id) {
    // Told now, or told again on the new tank (a taunt during the lead):
    // the gathering cue only once a brand.
    const fresh = st.brandTold === null;
    untell(s);
    if (st.brandTimer > 1e-9) {
      warnTankBuster(tank, s.boss, 'brand', st.brandTimer);
      if (fresh) cueOnBoss(s, HEAT_CUES.brandGather);
      st.brandTold = tank.id;
    }
  }
  if (st.brandTimer > 1e-9) return;
  untell(s);
  landBrand(s, tank);
  st.brandTimer = b.every;
}

/** The fight is over: no tell left on anyone. */
export function clearBrand(s: Pick<HeatScope, 'ctx' | 'st'>): void {
  const id = s.st.brandTold;
  if (id !== null) endTankBuster(s.ctx.entities.get(id), 'brand');
  s.st.brandTold = null;
}
