// The Drowned Temple boss encounters (docs/design/dungeon-rework/
// drowned_temple.md): Choirmother Selthe, the Mere Hydra (the showpiece), the
// Tideglass Colossus and Ysolei. One pass per tick over every live Temple
// claim, after the mob AI (called from instances/dungeons.ts updateInstances,
// beside the trash kit), so a pull or a planted cast owns its tick.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { bossEngaged, claimBoss, templeClaims } from './claim';
import { COLOSSUS_ID, HYDRA_TUNING, SELTHE_ID, YSOLEI_ID } from './ids';
import {
  elementWielders,
  hydraHeads,
  startBrineSpit,
  startTideBreath,
  startTorrent,
  startTsunami,
  tickMereHydra,
} from './mere_hydra';
import { startChorus, startSolo, tickSelthe } from './selthe';
import { raiseReflections, startLance, tickColossus } from './tideglass_colossus';
import { startRisingTide, startUndertow, tickYsolei } from './ysolei';

export { HYDRA_REGROWTH_LOG } from './hydra_regrowth';
export * from './ids';
export { elementWielders } from './mere_hydra';
export { floodedHalf } from './ysolei';

/** One tick of every Drowned Temple boss fight. */
export function tickTempleEncounters(ctx: SimContext): void {
  for (const inst of templeClaims(ctx)) {
    const selthe = claimBoss(ctx, inst, SELTHE_ID);
    if (selthe) tickSelthe(ctx, inst, selthe, bossEngaged(selthe));
    tickMereHydra(ctx, inst);
    const colossus = claimBoss(ctx, inst, COLOSSUS_ID);
    if (colossus) tickColossus(ctx, inst, colossus, bossEngaged(colossus));
    const ysolei = claimBoss(ctx, inst, YSOLEI_ID);
    if (ysolei) tickYsolei(ctx, inst, ysolei, bossEngaged(ysolei));
  }
}

const HELP =
  'Mechanics: chorus, solo, duet (Selthe); breath, spit, torrent, tsunami, regrow (the Hydra); reflections, lance (the Colossus); undertow, flood (Ysolei).';

const HYDRA_TRIGGERS = new Set(['breath', 'spit', 'torrent', 'tsunami', 'regrow']);

/** `/dev temple trigger <mechanic>`: fire an engaged boss's mechanic now.
 *  Returns the log line. */
export function templeDevTrigger(ctx: SimContext, inst: InstanceSlot, what: string): string {
  if (what === 'chorus' || what === 'solo' || what === 'duet') {
    const boss = claimBoss(ctx, inst, SELTHE_ID);
    const st = boss?.templeFight;
    if (!boss || st?.kind !== 'selthe') return 'Pull Selthe first.';
    if (what !== 'solo') startChorus(ctx, inst, boss, st);
    if (what !== 'chorus') startSolo(ctx, inst, boss, st);
    return 'Selthe marks her singers.';
  }
  if (HYDRA_TRIGGERS.has(what)) {
    const heads = hydraHeads(ctx, inst);
    const st = heads?.find((h) => h?.templeFight?.kind === 'hydra')?.templeFight;
    if (!heads || st?.kind !== 'hydra') return 'Pull the Mere Hydra first.';
    if (what === 'regrow') {
      // Every fallen head grows back on the next tick (another must live).
      let n = 0;
      st.diedAt.forEach((t, i) => {
        if (t === null) return;
        st.diedAt[i] = ctx.time - HYDRA_TUNING.regrowAfter;
        n++;
      });
      return n > 0 ? 'The fallen heads are growing back.' : 'No head has fallen.';
    }
    const standing = heads.filter((h): h is NonNullable<typeof h> => h !== null && !h.dead);
    // A dev trigger cuts whatever bar is running so the mechanic always shows.
    for (const h of standing) {
      if (h.castingAbility === null || st.tsunami) continue;
      h.castingAbility = null;
      h.castRemaining = 0;
    }
    if (what === 'tsunami') {
      if (st.tsunami) return 'A Tsunami is already rolling.';
      return startTsunami(ctx, inst, standing, st)
        ? 'The Hydra sinks: a Tsunami rises.'
        : 'No head.';
    }
    const [ice, venom, water] = elementWielders(heads);
    if (what === 'spit') {
      if (!venom) return 'No head wields the venom.';
      return startBrineSpit(ctx, inst, venom, st) > 0 ? 'The Hydra spits venom.' : 'No target.';
    }
    if (what === 'torrent') {
      if (!water) return 'No head wields the water.';
      return startTorrent(ctx, inst, water, st) ? 'A head draws a Crushing Torrent.' : 'No target.';
    }
    if (!ice) return 'No head wields the ice.';
    return startTideBreath(ctx, inst, ice, st) ? 'A head draws a Freezing Breath.' : 'No target.';
  }
  if (what === 'reflections' || what === 'lance') {
    const boss = claimBoss(ctx, inst, COLOSSUS_ID);
    const st = boss?.templeFight;
    if (!boss || st?.kind !== 'colossus') return 'Pull the Colossus first.';
    if (what === 'lance') {
      // A dev trigger cuts whatever bar is running so the lance always shows.
      if (boss.castingAbility !== null) {
        boss.castingAbility = null;
        boss.castRemaining = 0;
      }
      return startLance(ctx, inst, boss, st) ? 'The Colossus aims a lance.' : 'No target.';
    }
    const n = raiseReflections(ctx, inst, boss, st);
    return `The prism flares: ${n} reflection${n === 1 ? '' : 's'}.`;
  }
  if (what === 'undertow' || what === 'flood') {
    const boss = claimBoss(ctx, inst, YSOLEI_ID);
    const st = boss?.templeFight;
    if (!boss || st?.kind !== 'ysolei') return 'Pull Ysolei first.';
    if (what === 'flood') {
      if (st.tide) {
        st.tide.timer = Math.min(st.tide.timer, 10.05);
        return 'The tide is about to switch halves.';
      }
      startRisingTide(ctx, inst, boss, st);
      return 'The lagoon floods half the island.';
    }
    if (st.undertow) return 'The Undertow is already running.';
    startUndertow(ctx, inst, boss, st);
    return 'Ysolei draws the Undertow.';
  }
  return HELP;
}
