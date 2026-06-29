// Systematic spell-balance framework (analytical layer). For every caster class
// and damaging spell, at a reference level-20 character, it computes the metrics a
// designer needs to compare spells objectively:
//   - spamDPS: damage per second if you spam ONLY this spell (cast time + cooldown
//     + GCD + crit + Spell Power, with any rider DoT kept up). The single most
//     useful "is this spell pulling its weight" number.
//   - dpsPerMana: damage per mana spent (sustain / efficiency).
//   - effCast: the effective time the spell occupies (max(castTime, GCD), or the
//     cooldown if longer than the cast for a CD-gated nuke).
// It then flags spells whose spamDPS deviates from their class median by > THRESH,
// which is how we catch outliers like a too-weak Pyroblast.
//
// Run: npx tsx scripts/balance_report.mjs   (no server needed)

import { abilitiesKnownAt } from '../src/sim/content/classes.ts';
import { Sim } from '../src/sim/sim.ts';
import { channelTickBonus, directHitBonus, dotTickBonus } from '../src/sim/spell_scaling.ts';
import { GCD, MAX_LEVEL } from '../src/sim/types.ts';

const SPELL_CRIT_MULT = 1.5; // sim: spell crit deals 1.5x
const THRESH = 0.25; // flag spells > 25% off the class median spamDPS

function refChar(cls) {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer(cls, 'Ref');
  sim.setPlayerLevel(MAX_LEVEL, pid);
  sim.tick();
  return sim.entities.get(pid);
}

function spellCrit(int) {
  return Math.min(1, 0.05 + int * 0.0008);
}

// One spell -> { spamDPS, dpsPerMana, effCast, breakdown } at the reference char.
function analyze(p, k) {
  const def = k.def;
  const crit = spellCrit(p.stats.int);
  const critFactor = 1 + crit * (SPELL_CRIT_MULT - 1); // expected multiplier on a hit
  const sp = def.scalesWith === 'ranged' ? p.rangedPower : p.spellPower;

  let directPerCast = 0; // single-cast direct/aoe damage (incl SP), pre-crit
  let dotDPS = 0; // sustained DoT dps (incl SP), pre-crit (DoTs here don't crit)
  let channelTotal = 0; // total channel damage over its duration (incl SP)
  let channelDur = 0;

  for (const eff of k.effects) {
    if (eff.type === 'directDamage') {
      const base = (eff.min + eff.max) / 2;
      if (def.channel) {
        // per-tick hit over the channel
        const perTick = base + channelTickBonus(sp, def);
        channelTotal += perTick * def.channel.ticks;
        channelDur = def.channel.duration;
      } else {
        directPerCast += base + directHitBonus(sp, def, k.castTime, false);
      }
    } else if (eff.type === 'aoeDamage' || eff.type === 'aoeRoot') {
      const base = (eff.min + eff.max) / 2;
      directPerCast += base + directHitBonus(sp, def, k.castTime, true);
    } else if (eff.type === 'drainTick') {
      const perTick = (eff.min + eff.max) / 2 + channelTickBonus(sp, def);
      channelTotal += perTick * (def.channel?.ticks ?? 1);
      channelDur = def.channel?.duration ?? 1;
    } else if (eff.type === 'dot') {
      const ticks = eff.duration / eff.interval;
      const perTick = eff.total / ticks + dotTickBonus(sp, def, eff.duration, eff.interval);
      dotDPS += (perTick * ticks) / eff.duration;
    }
  }

  // Effective occupancy: a CD-gated nuke is throttled to its cooldown if that
  // exceeds its cast; otherwise cast time floored at the GCD.
  const castOcc = Math.max(k.castTime || 0, GCD);
  const effCast = def.cooldown > castOcc ? def.cooldown : castOcc;

  let spamDPS;
  if (channelDur > 0) {
    // a channel: total over its duration, crit on the ticks, plus any rider dot
    spamDPS = (channelTotal * critFactor) / Math.max(channelDur, effCast) + dotDPS;
  } else {
    // a nuke: direct (crit) amortized over its occupancy, dot kept up alongside
    spamDPS = (directPerCast * critFactor) / effCast + dotDPS;
  }

  const damagePerCast = directPerCast + channelTotal + dotDPS * (channelDur || effCast);
  const dpsPerMana = def.cost > 0 ? damagePerCast / def.cost : Infinity;
  return { spamDPS, dpsPerMana, effCast, cost: def.cost };
}

const CASTERS = ['mage', 'warlock', 'priest', 'shaman', 'druid', 'paladin'];
const DMG = new Set(['directDamage', 'aoeDamage', 'aoeRoot', 'dot', 'drainTick']);

for (const cls of CASTERS) {
  const p = refChar(cls);
  const rows = [];
  for (const k of abilitiesKnownAt(cls, MAX_LEVEL)) {
    if (cls !== k.def.class) continue;
    if (!k.effects.some((e) => DMG.has(e.type))) continue;
    if (k.def.school === 'physical') continue; // caster spell focus
    const m = analyze(p, k);
    rows.push({ id: k.def.id, ...m });
  }
  if (!rows.length) continue;
  rows.sort((a, b) => b.spamDPS - a.spamDPS);
  const median = [...rows].sort((a, b) => a.spamDPS - b.spamDPS)[Math.floor(rows.length / 2)]
    .spamDPS;
  console.log(
    `\n=== ${cls.toUpperCase()}  (SP ${p.spellPower}, int ${p.stats.int}, median spamDPS ${median.toFixed(1)}) ===`,
  );
  for (const r of rows) {
    const dev = (r.spamDPS - median) / median;
    const flag = Math.abs(dev) > THRESH ? (dev < 0 ? '  <-- WEAK' : '  <-- strong') : '';
    console.log(
      `  ${r.id.padEnd(18)} spamDPS ${r.spamDPS.toFixed(1).padStart(6)}  ` +
        `effCast ${r.effCast.toFixed(1)}s  dps/mana ${(r.dpsPerMana === Infinity ? 'inf' : r.dpsPerMana.toFixed(2)).padStart(6)}` +
        `  (${(dev * 100).toFixed(0)}%)${flag}`,
    );
  }
}
