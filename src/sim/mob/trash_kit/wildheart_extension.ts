// The Wildheart Basin's kit extension (kit_extension.ts): routes the Basin's
// own key block (MobTemplate.trashKit.wildheart) into the shared driver. Every
// key is a cast on the driver's machinery (the Quarry Mark, the War Roar, the
// Toad Hex, the alternating Plant Totem, the Rattling Dread, the Snaring
// Tongue); the upkeep reels the tongue's catch in and crumbles a dread totem
// whose binder has fallen.

import type { TrashKitCast, TrashKitDef } from '../../types';
import type { TrashKitExtension } from './kit_extension';
import { holdLineAim, lockLineAim } from './support';
import { WILDHEART_ROAR_FRENZY, WILDHEART_ROAR_HASTE } from './wildheart_cast_ids';
import {
  dreadReady,
  landDread,
  landHex,
  landMark,
  landRoar,
  landTongue,
  landTotem,
  markTarget,
  pickPastTank,
  roarReady,
  stepReel,
  tongueTarget,
  totemsReady,
} from './wildheart_hunt';
import { livingSummoner } from './wildheart_kit';

/** The Basin's cast keys, in priority order: a roar before anything (it is
 *  once a pull), a totem before a curse, a curse before a throw. */
const WILDHEART_CAST_KEYS = ['roar', 'totems', 'hex', 'dread', 'mark', 'tongue'] as const;
type WildheartCastKey = (typeof WILDHEART_CAST_KEYS)[number];

function isWildheartKey(key: string): key is WildheartCastKey {
  return (WILDHEART_CAST_KEYS as readonly string[]).includes(key);
}

const NO = { ok: false, target: null };

export const WILDHEART_KIT_EXTENSION: TrashKitExtension = {
  castKeys: WILDHEART_CAST_KEYS,
  castDef(kit: TrashKitDef, key: string): TrashKitCast | undefined {
    return isWildheartKey(key) ? kit.wildheart?.[key] : undefined;
  },
  // The spear, the totem's dread and the tongue: dodge them or deal with the
  // caster; a silence never stops them.
  isPhysical: (key) => key === 'mark' || key === 'dread' || key === 'tongue',
  ready(ctx, inst, mob, kit, key, st, players) {
    switch (key) {
      case 'roar':
        return roarReady(mob, kit, st) ? { ok: true, target: null } : NO;
      case 'totems':
        return totemsReady(ctx, mob, kit) ? { ok: true, target: null } : NO;
      case 'hex': {
        const def = kit.wildheart?.hex;
        const target = def ? pickPastTank(players, mob, def.range, st.casts) : null;
        return target ? { ok: true, target } : NO;
      }
      case 'dread':
        return dreadReady(mob, kit, players) ? { ok: true, target: null } : NO;
      case 'mark': {
        const target = markTarget(ctx, inst, mob, kit, st, players);
        return target ? { ok: true, target } : NO;
      }
      case 'tongue': {
        const target = tongueTarget(mob, kit, st, players);
        return target ? { ok: true, target } : NO;
      }
    }
    return NO;
  },
  started(_ctx, _inst, mob, key, st, target) {
    // The roar is once a pull, kicked or not.
    if (key === 'roar') {
      st.wildheart ??= {};
      st.wildheart.roared = true;
    }
    if (key === 'tongue') lockLineAim(mob, st, target);
  },
  hold(mob, key, st) {
    if (key !== 'tongue') return false;
    holdLineAim(mob, st);
    return true;
  },
  broken(_ctx, _mob, key, _targetId, st) {
    // A broken tongue lets go of the lane it locked.
    if (key === 'tongue') st.aim = undefined;
  },
  land(ctx, inst, mob, kit, key, targetId, players, st) {
    switch (key) {
      case 'roar':
        landRoar(ctx, inst, mob, kit);
        return;
      case 'totems':
        landTotem(ctx, inst, mob, kit, st);
        return;
      case 'hex':
        landHex(ctx, inst, mob, kit, targetId);
        return;
      case 'dread':
        landDread(ctx, inst, mob, kit, players);
        return;
      case 'mark':
        landMark(ctx, inst, mob, kit, targetId);
        return;
      case 'tongue':
        landTongue(ctx, mob, kit, targetId, st, players);
        return;
    }
  },
  step(ctx, inst, mob, kit, st) {
    const w = kit.wildheart;
    if (!w) return false;
    // A dread totem never outlives its binder (the healing totem's rule).
    if (w.dread && mob.summonedAdd && !livingSummoner(ctx, inst, mob)) {
      ctx.handleDeath(mob, null);
      return true;
    }
    if (w.tongue) stepReel(ctx, mob, kit, st);
    return false;
  },
  endPull(_ctx, _inst, mob) {
    // An evade or a reset ends the frenzy a War Roar left; a pull that only
    // paused (a fear, a flee) keeps it.
    if (mob.inCombat && mob.aiState !== 'evade') return;
    if (mob.auras.some((a) => a.id === WILDHEART_ROAR_FRENZY || a.id === WILDHEART_ROAR_HASTE))
      mob.auras = mob.auras.filter(
        (a) => a.id !== WILDHEART_ROAR_FRENZY && a.id !== WILDHEART_ROAR_HASTE,
      );
  },
};
