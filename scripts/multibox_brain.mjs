// multibox_brain.mjs — the per-tick decision BRAIN, hot-reloaded by multibox.mjs.
//
// ⚡ Edit this file while the multibox is running and the live party changes
//    behavior on the next tick — NO relog, no scatter, journals intact.
//
// It must stay a pure function of `ctx` (all state arrives in ctx; act only via
// bot.cmd / bot.input). Tune the numbers in TUNABLES or change the logic in
// tick() — either way, just save and the running bots adapt.

import { appendFileSync } from 'node:fs';
import { idleFidget } from './multibox_chat.mjs';
const _stamp = () => new Date().toISOString().slice(11, 19);
// leader narration → party log (streams to the 8099 dashboard). Logs only when the
// intent CHANGES *and* at least SAY_THROTTLE_MS have passed — otherwise a state that
// flickers between two values every tick (e.g. hold ↔ attack) spams ~5 lines/sec.
const SAY_THROTTLE_MS = 8000;
function leaderSay(leader, text) {
  if (leader._intent === text) return;            // same intent → never repeat
  const now = Date.now();
  if (now - (leader._intentAt ?? 0) < SAY_THROTTLE_MS) { leader._intent = text; return; } // changed too soon → update silently
  leader._intent = text; leader._intentAt = now;
  const ptag = leader._ptag ? `${leader._ptag} ` : '';
  try { appendFileSync(leader._partyPath ?? 'logs/party.md', `- \`${_stamp()}\` ${ptag}🧭 ${leader.charName}: ${text}\n`); } catch {}
}

export const TUNABLES = {
  follow: 5,            // follower keeps within this many yards of the leader
  spread: 6,            // DELTA-SPLIT: followers hold a stable per-bot offset around the leader (anti-lockstep, see followAnchor)
  pullGrind: 70,        // leader's target-search radius — wide so it engages mobs as it passes them (less walking = fewer dry spells)
  pullTravel: 14,       // while marching: only fight mobs in our path
  lvlFloor: -4,         // ignore mobs more than this many levels below us
  lvlCeil: 3,           // engage mobs up to +3 levels — more XP/kill + bigger target pool (watch deaths; pull back if it spikes)
  anchorMobDist: 80,    // (crypt mode) once arrived, roam/grind mobs within this of the door
  anchorReturn: 45,     // (crypt mode) drift back toward the door if farther than this
  seekCrypt: false,     // false = grind nearest mobs ANYWHERE (safe leveling). true = march to & hold the crypt.
  goHome: true,         // roam toward `home` and grind there (live-relocatable safe zone)
  home: { x: -66, z: 268 }, // ⬅️ Deepfen Snappers (L8-9) — nudged toward the east bank to idle on land, not in the water
  homeRadius: 110,      // grind within this of home — WIDE so they chain multiple camps instead of idling for one to respawn (more kills/min = more XP)
  campRadiusMax: null,  // hard CAP on the grind radius (per-party). Tightens the camp so they hug the centre and don't sprawl toward hazards (lake edge). null = no cap.
  forceLadder: false,   // STAY on the level-gated grind ladder camp; ignore the quest co-locate that yanks HOME to whichever quest camp (stops zone-wide wandering). Quests still get accepted/turned-in opportunistically.
  questTripEvery: 0,    // min ms between giver trips — grind the camp this long before checking the giver again (0 = no limit). Stops running across the zone between every pull.
  maxEngage: 4,         // the tank won't ADVANCE toward more mobs while already holding this many on the party — caps a tight camp from snowballing into a 7-8 pull (stand & fight in place, no kiting)
  deathAvoidCap: 1,     // a camp that wipes the party even ONCE within deathAvoidWindow is flagged too-dense (a healed duo shouldn't be dying) → switch camps, or ladder-fallback once all are flagged. Bouncing between killers spreads deaths so they never re-accumulate; cap=1 flags on first death.
  deathAvoidWindow: 7200000, // a camp stays flagged-deadly this long (2h ≈ whole session) after a death. The duo can't survive the dense L11+ camps, so once one wipes us we AVOID it for good and grind survivable camps — bounds total deaths to ~one brief death-tour, then stable. (Trade-off: lower XP at over-leveled camps; the TRIO is the fast death-free fix — see memory.)
  dieFreely: true,      // NO fleeing/retreat: fight to the death, respawn, pick a new objective. Deaths are
                        //   cheap (graveyard adjacent) and a fleeing bot drops aggro + causes more wipes than it saves.
                        //   true = skip BOTH the low-HP flee AND the death-loop backoff. (fleeHp/tankFleeHp below are then unused.)
  fleeHp: 0.45,         // non-healer DPS disengages and runs AWAY from the mob below this HP frac (only when dieFreely:false)
  tankFleeHp: 0.2,      // the TANK ignores fleeHp and only breaks off at THIS emergency floor — a tank
                        //   that flees at 55% dumps the mob onto the healer and wipes the party (it must hold aggro)
  restHp: 0.55,         // leader rests (regen) below this when no target
  recoverHp: 0.6,       // tank self-heals to THIS between pulls before re-engaging — kept LOW because the off-heal Shims tops the tank up DURING combat, so between-pull resting is mostly wasted idle. Lower = faster pull cadence = more xp/m.
  healCrit: 0.35,       // heal anyone below this FIRST (dying)
  healTank: 0.60,       // then the tank if below this
  healLow: 0.85,        // then the most-hurt member below this (leave the healer free GCDs to reposition)
  lootGrab: 8,          // loot a corpse within this range, mid-fight
  lootWalk: 30,         // leader walks to corpses within this during downtime
  autoEquip: false,     // OFF: keep the gear set manually — don't let bag items override it on relaunch
  pullManaFrac: 0.25,   // tank holds the next pull only if casters are nearly dry (they wand at low mana, so don't over-wait)
  // --- anti-wipe additions ---
  assistOnly: true,     // DPS only fight the leader's target or an add already on us — never run off to pull their own pack
  assistRange: 14,      // a DPS bot picks up an aggroed add within this range; beyond it, regroup instead of chasing/pulling
  healerKite: 6,        // healer back-pedals from any hostile within this many yards before it resumes healing
  healerLeash: 14,      // healer stays within this of the leader (closes the gap before healing unless someone's dying)
  healerStandoff: 10,   // healer edges back from a mob within this (only when comfortably in heal range; heal-range always wins)
  healRange: 30,        // ...but stays within this of the tank so heals reach (heal spells ~40y); closes the gap if further. Caps the standoff back-off so an add can't drag the healer away from the tank.
  pullWhenReady: true,  // the leader holds the NEXT pull until the party is healthy again
  readyHp: 0.45,        // "healthy enough to pull": every alive member at/above this HP frac (kept lenient)
  readyMana: 0.3,       // ...and the healer above this mana fraction
  warlockTapHp: 0.65,   // warlock only Life-Taps (HP→mana) above this HP frac — keeps it out of the healer's danger zone in small groups
  healerDps: true,      // when nobody needs a heal, the priest contributes: Smite when mana's high, else wand (auto-attack) while mana regens
  healerMelee: false,   // OPT-IN (psduo): the "healer" abandons the healer role and plays MELEE DPS — runs into melee on the tank's focus, swings + weaves instants, never self-heals (only an emergency tank-heal). Use only when the tank can self-sustain (paladin) + dieFreely is on.
  healerNukeMana: 0.6,  // a healer only weaves its offensive nuke when mana is ABOVE this — reserves the rest for HEALS (nuking to empty = no heals = dead tank)
  healEmergency: 0.3,   // ...in healerMelee mode, the only heal cast: throw ONE heal on the TANK below this HP frac
  shieldTank: true,     // priest keeps Power Word: Shield rolling on the tank (L6+) to absorb damage preventatively
  shieldEvery: 6500,    // recast PW:Shield on the tank about this often (ms) — ~its 6s cooldown
  shieldMinMana: 0.55,  // ...but only when priest mana is above this — keeps the shield from starving heals + the pull-gate
  waterBrigade: true,   // mage conjures water + casters drink during rest windows to recover mana
  drinkMana: 0.55,      // drink in a lull only while mana is below this fraction (top up, don't over-sit)
  drinkSafeRadius: 30,  // a hostile within this many yards of the leader OR the drinker = NOT a lull → never drink (kills the drink-through-a-pull freeze)
  drinkLeash: 22,       // only drink within follow+this of the leader — a far-behind OOM caster FOLLOWS first (the 144y off-camp freeze)
  waterStock: 6,        // mage conjures up to this many bottles in a lull, then stops (avoids a 3s conjure stalling the next pull)
  tickMs: 110,          // main loop period (ms). ~110 = smooth movement; 50 = server floor; live-tunable
  paused: false,        // flip true + save → party freezes in place (stops attacking, stands still). false → resume. Live, no relog.
  questGrey: 2,         // don't ACCEPT a quest whose minLevel is more than this many levels below us — it's
                        //   trivial backtracking now that the hub spans L1→L20 (turn-ins of held quests still happen)
  autoAbandon: true,    // drop active quests that are NOT in this party's config (un-progressable here: bridge/
                        //   collect-with-no-spot, group/elite) OR have gone grey (minLevel > questGrey below us) —
                        //   keeps the quest log focused on what this party can actually complete. Never drops a READY quest.
  turnInBatch: 2,       // only make a dedicated turn-in trip once this many quests are ready (cuts giver round-trips)
  maxReadyWait: 60000,  // ...but a lone ready quest still gets turned in after this long (ms)
  dumpGear: false,      // flip true + save → each bot dumps money/equip/bags to its journal + a compare table to party.md (then flip back)
};

// is the party safe to start the NEXT pull? Deaths are cheap here — the graveyard is
// adjacent (~1s to rez + rejoin) — so we DON'T wait for every DPS to be topped off.
// We only hold the next pull when the HEALER can't sustain it (dead, in danger, or OOM);
// a dead healer is the one death-mode that actually cascades. Cheap DPS deaths just recover.
function partyReady(bots, T, tank) {
  const alive = bots.filter((b) => b.self && !b.self.dead);
  const healer = alive.find((b) => b.isHealer() && b !== tank) ?? alive.find((b) => b.isHealer());
  if (!healer) return true;                 // no healer (solo / healerless party) → nothing to pace for, always ready to pull
  if (healer.hpFrac() < 0.5) return false;
  const mres = healer.self.mres ?? 0;
  if (mres > 0 && (healer.self.res ?? 0) / mres < T.readyMana) return false;
  return true;
}

// full self/party buff set per class (cast on a refresh cycle, one per tick).
// Each entry is [ability, learnLevel] — a buff is only cast once the bot is high enough
// to actually know it, so a L1 hunter doesn't spam (and log) Aspect of the Hawk (L4) etc.
const CLASS_BUFFS = {
  warrior: [['battle_shout', 1]],
  paladin: [['blessing_of_might', 4], ['devotion_aura', 1], ['righteous_fury', 16]], // righteous_fury = the tank's +threat aura (our paladin tanks)
  hunter: [['aspect_of_the_hawk', 4]],
  rogue: [],
  priest: [['power_word_fortitude', 1]],
  shaman: [['lightning_shield', 8]],
  mage: [['frost_armor', 1], ['arcane_intellect', 1]],
  warlock: [['demon_skin', 1]],
  druid: [['mark_of_the_wild', 1], ['thorns', 6]],
};

// ability → the aura `kind` it applies, so we can tell a buff is ALREADY up (self.auras carries
// `kind`) and skip recasting it. Within a class the kinds are distinct, so this uniquely answers
// "do I still have my Frost Armor?" Most of these last 30 min — recasting every 45s was pure
// wasted GCDs. Auras clear on death, so after a rez they re-cast on their own.
const BUFF_AURA = {
  frost_armor: 'buff_armor', arcane_intellect: 'buff_int', battle_shout: 'buff_ap',
  power_word_fortitude: 'buff_sta', demon_skin: 'buff_armor', mark_of_the_wild: 'buff_armor',
  thorns: 'thorns', aspect_of_the_hawk: 'buff_ap', lightning_shield: 'thorns',
  blessing_of_might: 'buff_ap', devotion_aura: 'buff_armor', righteous_fury: 'righteous_fury',
};

function rangeFor(cls, MELEE) {
  if (cls === 'hunter') return { min: 8, max: 30 };
  if (MELEE.has(cls)) return { min: 0, max: 4 };
  return { min: 0, max: 26 };
}

// the offensive nuke a healer weaves between heals when mana is healthy (else it just wands).
// Class-correct so a shaman/druid healer doesn't try to cast the priest's Smite.
const HEALER_CLASSES = new Set(['priest', 'paladin', 'druid', 'shaman']);
const HEALER_NUKE = { priest: 'smite', shaman: 'lightning_bolt', druid: 'wrath' };

// --- water brigade ---
const MANA_CLASSES = new Set(['mage', 'warlock', 'priest', 'druid', 'shaman', 'paladin']);
const DRINK_IDS = ['conjured_water', 'conjured_water2', 'conjured_water3', 'spring_water', 'meltwater_flask'];
// mana restored per bottle (sim: items.ts / zone3.ts). Drink the BEST water we carry first —
// conjure_water auto-resolves to the highest rank known, so an L10+ mage stocks the 288/672 bottles;
// sipping the 76-mana spring water when a 288 sits in the bag is pure waste.
const DRINK_MANA = { conjured_water3: 672, meltwater_flask: 672, conjured_water2: 288, conjured_water: 76, spring_water: 76 };
const invId = (it) => it.itemId ?? it.id ?? it;
function waterCount(bot) { let n = 0; for (const it of (bot.self?.inv ?? [])) if (DRINK_IDS.includes(invId(it))) n += (it.count ?? 1); return n; }
function bestDrink(bot) { let best = null, bestV = -1; for (const it of (bot.self?.inv ?? [])) { const id = invId(it); const v = DRINK_MANA[id]; if (v != null && v > bestV) { best = id; bestV = v; } } return best; }

// class damage rotation (caller ensured in-range + off-GCD)
export function rotate(bot, target, T = TUNABLES) {
  const res = bot.self.res ?? 0;
  switch (bot.cls) {
    case 'warrior': {
      const t = Date.now(), lv = bot.self.lv ?? 1;
      // In ANY group (incl. tank+HEALER) the tank must hold aggro: HEALING generates threat, so without
      // tank threat the mobs peel onto the healer and kill it (exactly what happened). Only a SOLO warrior
      // skips threat for pure DPS.
      const solo = (bot.self.party?.members?.length ?? 1) <= 1;
      if (!solo && T.dungeonFarm) {
        // DUNGEON TANK THREAT: vs L19-20 ELITES the warrior must OUT-THREAT the healers (whose heals draw
        // aggro), so threat beats damage. Priority: TAUNT anything not on us (peel it back), SUNDER ARMOR
        // (cheap, high-threat staple — spam it), THUNDER CLAP on cd (threat + attack-slow), then HEROIC
        // STRIKE as the rage dump. This is what stops "tanking: Shims/healer" — the warrior holds aggro.
        const peelNow = target && target.aggro != null && target.aggro !== bot.pid;
        // BLOODRAGE (free, +10 rage, 60s cd): the warrior is rage-STARVED when nothing is hitting it (mobs
        // on the healer) — Bloodrage breaks the deadlock so it always has rage to build threat from cold.
        if (lv >= 10 && res < 20 && t - (bot.lastBloodrage ?? 0) > 60000) { bot.cmd({ cmd: 'cast', ability: 'bloodrage' }); bot.lastBloodrage = t; break; }
        // TAUNT (free) the instant the mob is on someone else — forces it back so we take hits → gain rage.
        if (lv >= 10 && peelNow && t - (bot.lastTaunt ?? 0) > 8000) { bot.cmd({ cmd: 'cast', ability: 'taunt' }); bot.lastTaunt = t; break; }
        if (lv >= 6 && res >= 20 && t - (bot.lastTclap ?? 0) > 4000) { bot.cmd({ cmd: 'cast', ability: 'thunder_clap' }); bot.lastTclap = t; break; }
        if (lv >= 10 && res >= 15) { bot.cmd({ cmd: 'cast', ability: 'sunder_armor' }); break; }
        if (res >= 12) { bot.cmd({ cmd: 'cast', ability: 'heroic_strike' }); break; }
        break; // else auto-attack to build rage for the next threat cast
      }
      if (!solo) {
        // MAX-XPM tank rotation vs OUT-LEVELED mobs: threat here is trivial (we out-level the ogres AND the
        // healer is mana-gated = low threat), so GCDs go to DAMAGE, not threat insurance. TAUNT fires ONLY to
        // PEEL — when the current target is actually on someone else (the healer) — so we keep healer
        // protection without burning GCDs to hold aggro we already own. Execute finishes, Rend is a free DoT,
        // Heroic Strike is the rage dump (primary). Sunder/Thunder-Clap dropped from the staple (weak single-
        // target damage); Thunder-Clap kept only as a low-rage filler that still ticks some threat.
        const lowHp = target?.hp != null && target.mhp && target.hp / target.mhp < 0.2;
        const peelNow = target && target.aggro != null && target.aggro !== bot.pid;       // mob is on the healer → rip it back
        const adds = bot.hostiles().filter((m) => !m.dead && bot.dist(m) < 8).length;     // mobs clumped in AoE radius (8y)
        if (lv >= 10 && peelNow && t - (bot.lastTaunt ?? 0) > 8000) { bot.cmd({ cmd: 'cast', ability: 'taunt' }); bot.lastTaunt = t; break; }
        if (lv >= 14 && lowHp && res >= 15) { bot.cmd({ cmd: 'cast', ability: 'execute' }); break; }                          // FINISH fast (XPM)
        // AoE when 2+ ogres are clumped (a multi-pull): Whirlwind (big 30-42 to all, 10s CD) then Thunder
        // Clap (12-14 AoE + threat, 4s CD). Hitting 2-3 at once = far more total damage than one Heroic
        // Strike AND clears the pack faster, which shortens the healer's burst exposure. Single mob → skip
        // (AoE is wasted) and fall through to single-target below.
        if (adds >= 2) {
          if (lv >= 10 && res >= 25 && t - (bot.lastWW ?? 0) > 10000) { bot.cmd({ cmd: 'cast', ability: 'whirlwind' }); bot.lastWW = t; if (T.verbose) bot.journal(`🌀 Whirlwind — ${adds} ogres in range (AoE)`); break; }
          if (lv >= 6 && res >= 20 && t - (bot.lastTclap ?? 0) > 4000) { bot.cmd({ cmd: 'cast', ability: 'thunder_clap' }); bot.lastTclap = t; if (T.verbose) bot.journal(`⚡ Thunder Clap — ${adds} ogres in range (AoE)`); break; }
        }
        if (lv >= 4 && bot.dotTarget !== target?.id && res >= 10) { bot.cmd({ cmd: 'cast', ability: 'rend' }); bot.dotTarget = target?.id; break; } // free DoT once/mob
        if (res >= 10) { bot.cmd({ cmd: 'cast', ability: 'heroic_strike' }); break; }                                         // dump ALL rage → DAMAGE (primary XPM lever)
        // else rage-STARVED (out-leveled ogres deal little dmg back = little rage) → just AUTO-ATTACK to build
        // rage for the next strike. NO Thunder-Clap here: it costs MORE rage (20) than Heroic Strike and its
        // threat/AoE is wasted on a single out-leveled mob — casting it when starved STEALS rage from damage.
        break;
      }
      // SOLO DPS priority — no group means no threat to hold, so KILL FAST (fewer hits taken).
      // Execute finishes sub-20% mobs; Rend is a free DoT (ticks fully in a long solo fight);
      // Thunder Clap is kept ONLY for its attack-speed slow (less incoming damage); Heroic Strike
      // dumps rage into damage. Taunt + Sunder are GONE — pure waste solo (the whole bug).
      const lowHp = target.hp != null && target.mhp && target.hp / target.mhp < 0.2;
      if (lv >= 14 && lowHp && res >= 15) { bot.cmd({ cmd: 'cast', ability: 'execute' }); break; }                       // finisher
      if (lv >= 4 && bot.dotTarget !== target.id && res >= 10) { bot.cmd({ cmd: 'cast', ability: 'rend' }); bot.dotTarget = target.id; break; } // DoT, once per target
      if (lv >= 6 && t - (bot.lastTclap ?? 0) > 6000 && res >= 35) { bot.cmd({ cmd: 'cast', ability: 'thunder_clap' }); bot.lastTclap = t; break; } // attack-slow (survival), spare rage only
      if (res >= 15) bot.cmd({ cmd: 'cast', ability: 'heroic_strike' });                                                 // rage → damage
      break;
    }
    case 'paladin': {
      // paladin TANK rotation (threat + damage). Righteous Fury (the +threat aura) is kept up via
      // CLASS_BUFFS; here we run the active kit, mana-aware. NOTE: against out-leveled grind mobs the
      // tank has mana to BURN, so we SPEND it on damage (Judgement/Consecration/Exorcism on cooldown)
      // and let it dip — unused mana is wasted DPS, and the shaman off-heals so we don't reserve it for
      // survival. (A more conservative seal-hoarding version measured ~0.6 k/m WORSE — keep spending.)
      const t = Date.now(), lv = bot.self.lv ?? 1, mp = res / Math.max(1, bot.self.mres ?? 1);
      const hasSeal = (bot.self.auras ?? []).some((a) => a.kind === 'imbue');
      // 1) SEAL OF RIGHTEOUSNESS up — it buffs every melee swing with holy damage (damage + threat).
      //    Recast whenever it's gone (Judgement consumes it, or it expires at 30s).
      if (!hasSeal && res >= 25) { bot.cmd({ cmd: 'cast', ability: 'seal_of_righteousness' }); break; }
      // 2) JUDGEMENT (L4, 10s cd): instant holy hit that consumes the seal — we re-seal next tick.
      if (lv >= 4 && res >= 30 && t - (bot.lastJudge ?? 0) > 10000) { bot.cmd({ cmd: 'cast', ability: 'judgement' }); bot.lastJudge = t; break; }
      // 3) CONSECRATION (L18, 8s cd): ground AoE holy damage — the paladin's best sustained threat.
      // Consecration is a big AoE THREAT generator — an off-tank paladin in the farm must NOT cast it
      // (it rips aggro off the warrior); only the actual tank, or open-world grinding, uses it.
      if (lv >= 18 && res >= 60 && mp > 0.4 && t - (bot.lastConsec ?? 0) > 8000 && !bot._farmNoThreat) { bot.cmd({ cmd: 'cast', ability: 'consecration' }); bot.lastConsec = t; break; }
      // 4) EXORCISM (L14, 15s cd): single-target holy nuke (mana-gated so it never starves the core).
      if (lv >= 14 && res >= 55 && mp > 0.4 && t - (bot.lastExo ?? 0) > 15000) { bot.cmd({ cmd: 'cast', ability: 'exorcism' }); bot.lastExo = t; break; }
      // else: auto-attack carries it — the Seal procs holy damage on every swing.
      break;
    }
    case 'rogue': if (res >= 45) bot.cmd({ cmd: 'cast', ability: 'sinister_strike' }); break;
    case 'hunter': {
      // Auto Shot is free (fired by the attack command); spend GCDs on Arcane Shot — the best
      // per-GCD burst (instant 24-30 at r2, 6s cd). Serpent Sting's 15s DoT is mostly wasted on
      // fast focus-kills, so only apply it when mana is flush (a free top-up, never at the cost of a shot).
      const t = Date.now(), lv = bot.self.lv ?? 1, mp = res / Math.max(1, bot.self.mres ?? 1);
      if (lv >= 6 && t - (bot.lastArcaneShot ?? 0) > 6000 && res >= 25 && mp > 0.2) { bot.cmd({ cmd: 'cast', ability: 'arcane_shot' }); bot.lastArcaneShot = t; }
      else if (lv >= 4 && bot.dotTarget !== target.id && mp > 0.5 && res >= 15) { bot.cmd({ cmd: 'cast', ability: 'serpent_sting' }); bot.dotTarget = target.id; }
      // L1-5: just free Auto Shot (the attack command) — nothing learned to cast yet
      break;
    }
    case 'mage': {
      // FROST-MAGE rotation (per request): FROSTBOLT is the primary nuke (spam it — L4, 1.5s cast, also
      // slows). FIRE BLAST weaves in instant on its 8s cd (free GCD damage between Frostbolts). Frost Nova +
      // step-back kiting WHEN AGGROED lives in the RANGED-DPS SELF-DEFENSE block. Arcane Explosion is the
      // only PBAoE for a genuine 3+ pack.
      const t = Date.now(), lv = bot.self.lv ?? 1, mp = res / Math.max(1, bot.self.mres ?? 1);
      const packed = lv >= 14 ? bot.hostiles().filter((m) => bot.dist(m) <= 10).length : 0;
      if (lv >= 14 && packed >= 3 && mp > 0.4 && res >= 60) { bot.cmd({ cmd: 'cast', ability: 'arcane_explosion' }); break; }
      // FIRE BLAST: instant, 8s cd — fire it the moment it's up (free GCD damage between Frostbolt casts).
      if (lv >= 6 && t - (bot.lastFireBlast ?? 0) > 8000 && mp > 0.25 && res >= 40) { bot.cmd({ cmd: 'cast', ability: 'fire_blast' }); bot.lastFireBlast = t; break; }
      // FROSTBOLT: the main nuke — spam it (L4, cost 25, slows the target).
      if (res >= 25) bot.cmd({ cmd: 'cast', ability: 'frostbolt' });
      break;
    }
    case 'priest': if (res >= 32) bot.cmd({ cmd: 'cast', ability: 'smite' }); break;
    case 'warlock': {
      const t = Date.now(), lv = bot.self.lv ?? 1, mp = res / Math.max(1, bot.self.mres ?? 1);
      const myId = bot.self?.id ?? bot.pid;
      // 1) PET — keep the Imp summoned: its Firebolt is sustained, free, hands-off DPS (a big chunk
      //    of warlock throughput). The Imp persists, so we only (re)summon when it's actually gone
      //    (scan our owned entities — pets carry `own` = our id). 5s cast + 50 mana, so gate on a
      //    re-summon cooldown so we don't re-issue mid-cast, and only when we can afford it.
      let hasImp = false;
      for (const e of bot.ents.values()) if (e.own === myId && !e.dead) { hasImp = true; break; }
      if (lv >= 1 && !hasImp && res >= 50 && t - (bot.lastSummon ?? 0) > 7000) {
        bot.cmd({ cmd: 'cast', ability: 'summon_imp' }); bot.lastSummon = t; bot.dotTarget = null;
        bot.journal?.('🔮 Summoning my Imp.'); break;
      }
      // 2) Life Tap (L6+) only while comfortably healthy — at lower HP the lock taps itself into the
      //    healer's danger zone (cloth + mob damage). Gate it high so a tap can't drop us past flee.
      if (lv >= 6 && mp < 0.20 && bot.hpFrac() > (TUNABLES.warlockTapHp ?? 0.65)) { bot.cmd({ cmd: 'cast', ability: 'life_tap' }); break; }
      // 3) Drain Life (L10+) for self-sustain when hurt — channels HP back 1:1, easing the single
      //    healer and keeping the cloth caster alive instead of feeding a death (channel, so once).
      if (lv >= 10 && bot.hpFrac() < 0.45 && res >= 35) { bot.cmd({ cmd: 'cast', ability: 'drain_life' }); break; }
      // 4) Level-gated DoT opener applied ONCE per target, then Shadow Bolt as the workhorse nuke.
      //    Higher-level mobs (the mire camps the lock fights at L10+) live long enough that the DoTs
      //    pay; on a fast low-level kill the mob dies mid-opener, so it costs at most one extra cast.
      //    Order by efficiency: Immolate (instant chunk + fire DoT) → Curse of Agony (L8, instant,
      //    cheap shadow DoT) → Corruption (L4 shadow DoT). Each fires only if affordable, else we
      //    fall through to Shadow Bolt and retry the DoT once mana recovers.
      if (bot.dotTarget !== target.id) { bot.dotTarget = target.id; bot.dotStep = 0; }
      const dots = ['immolate'];
      if (lv >= 8) dots.push('curse_of_agony');
      if (lv >= 4) dots.push('corruption');
      const COST = { immolate: 25, curse_of_agony: 25, corruption: 35 };
      const step = bot.dotStep ?? 0;
      if (step < dots.length && res >= COST[dots[step]]) { bot.cmd({ cmd: 'cast', ability: dots[step] }); bot.dotStep = step + 1; break; }
      if (res >= 25) bot.cmd({ cmd: 'cast', ability: 'shadow_bolt' });
      break;
    }
    case 'shaman': {
      // level-aware elemental weave. Shocks are range-20 (shorter than the 26y
      // caster leash), so gate them on distance or the server rejects them.
      const t = Date.now(), lv = bot.self.lv ?? 1, d = bot.dist(target);
      const mp = res / Math.max(1, bot.self.mres ?? 1);
      // STORMSTRIKE (Enhancement signature, L20, melee, 12s cd): the priority button when in melee range —
      // big instant weapon strike + nature-vuln debuff. Fire it on cooldown, then weave shocks + auto-attack.
      if (lv >= 20 && d <= 6 && t - (bot.lastStorm ?? 0) > 12000 && res >= 40) {
        bot.cmd({ cmd: 'cast', ability: 'stormstrike' }); bot.lastStorm = t;
      } else if (lv >= 10 && d <= 19 && bot.dotTarget !== target.id && res >= 35 && mp > 0.3) {
        bot.cmd({ cmd: 'cast', ability: 'flame_shock' }); bot.dotTarget = target.id; // efficient fire DoT, once per target
      } else if (lv >= 4 && d <= 19 && t - (bot.lastShock ?? 0) > 6500 && res >= 30 && mp > 0.25) {
        bot.cmd({ cmd: 'cast', ability: 'earth_shock' }); bot.lastShock = t;           // instant nuke on its own 6s cd
      }
      // ENHANCEMENT = pure MELEE: NO lightning_bolt ever. Stormstrike + instant shocks weave between auto-
      // attacks; the engage() driver already walks Shims into melee range and swings the weapon. Casting LB
      // would root it out of melee and waste mana — explicitly omitted per the enh spec.
      break;
    }
    case 'druid': if (res >= 15) bot.cmd({ cmd: 'cast', ability: 'wrath' }); break;
  }
}

// stuck-aware movement toward a point {x,z}: if we stop making progress (terrain),
// retry with a random escape heading for a moment so nobody wedges and gets left behind
// The Mirefen LAKE — deep water (impassable; the bots would swim straight across it, which looks like a
// bot). Box measured from the sim terrain (scripts/terrain_probe.mjs, seed 20061): deep water sits in
// x∈[28,92], z∈[352,412]. Dry corridors are x≤24 (west shore) and x≥96 (east shore). We route any path
// that would cross the lake AROUND it via the dry WEST shore (gates just outside the box corners).
const LAKE = { x0: 28, x1: 92, z0: 352, z1: 412 };
function segHitsLake(from, to) {
  for (let t = 0; t <= 1; t += 0.08) {
    const x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
    if (x > LAKE.x0 && x < LAKE.x1 && z > LAKE.z0 && z < LAKE.z1) return true;
  }
  return false;
}
function routeAroundLake(from, to) {
  if (!segHitsLake(from, to)) return to;                      // clear shot → go straight
  const nw = { x: 20, z: 418 }, sw = { x: 20, z: 346 };       // dry gates at the lake's west corners
  const nwClear = !segHitsLake(from, nw), swClear = !segHitsLake(from, sw);
  if (to.z > 383) { return nwClear ? nw : (swClear ? sw : { x: 20, z: from.z }); } // dest north → exit NW
  return swClear ? sw : (nwClear ? nw : { x: 20, z: from.z });                       // dest south → exit SW
}
function moveToward(bot, dest) {
  const point = routeAroundLake(bot.pos(), dest);            // detour around the Mirefen lake — no swimming
  const now = Date.now();
  const s = (bot._mv ??= { lastPos: null, lastChk: 0, escUntil: 0, escH: 0, side: 1 });
  const face = bot.faceTo(point);
  if (now - s.lastChk > 1200) {
    // not progressing toward the target → probably an obstacle (a building, a rock). SKIRT around
    // it: veer ~75 deg to one side, alternating sides on each re-block, like a player stepping
    // around it — not a random spin (which reads as a confused bot). True nav-mesh pathing isn't
    // available to the lightweight bot, so this heuristic is the best we can do for collisions.
    if (s.lastPos && Math.hypot(bot.self.x - s.lastPos.x, bot.self.z - s.lastPos.z) < 0.8) {
      s.side = -s.side; s.escH = face + s.side * 1.3; s.escUntil = now + 1400;
    }
    s.lastPos = { x: bot.self.x, z: bot.self.z }; s.lastChk = now;
  }
  bot.input({ f: 1 }, now < s.escUntil ? s.escH : face);
}

// DELTA-SPLIT: a follower holds a STABLE per-pid offset AROUND the leader instead of
// stacking on the leader's exact tile and trailing an identical path. A party that moves
// as one welded blob (every member on the same coordinate, same heading) is an obvious bot
// tell; orbiting a fixed formation slot reads like people walking near each other. Golden-
// angle so two followers spread apart; slow sine drift so it isn't a rigid lattice.
// parked/idle hold — just stand still. (No emotes/hops/idle-fidget: operator wants no posted
// messages or emotes. idleFidget import left unused intentionally.)
function holdIdle(bot) { bot.input({}); }
function followAnchor(bot, point) {
  const pid = bot.pid > 0 ? bot.pid : 1;
  const r = TUNABLES.spread ?? 6;
  // per-bot angle AND independent drift on both axes (different periods/phases per bot) so two
  // followers don't orbit in sync — a rigid, identically-moving formation is the bot tell.
  const ang = (pid * 2.399963) % (Math.PI * 2);
  const rr = r * (0.7 + ((pid * 0.61803) % 1) * 0.9); // per-bot radius: members sit at DIFFERENT distances, not one tight ring
  const dx = Math.sin(Date.now() / 7000 + pid * 1.7) * (r * 0.4);
  const dz = Math.cos(Date.now() / 8300 + pid * 2.3) * (r * 0.4);
  return { x: point.x + Math.cos(ang) * rr + dx, z: point.z + Math.sin(ang) * rr + dz };
}
// STABLE (no time-drift) per-bot slot around a fixed point (camp centre / patrol point). Travelling
// to and holding at a camp, each member parks on its OWN slot instead of stacking on the exact
// centre — three chars welded to one tile is the obvious bot tell. Golden-angle + per-bot radius so
// they fan out into a loose, uneven cluster (the leader takes the centre; followers ring it).
function campAnchor(bot, point, maxR) {
  const pid = bot.pid > 0 ? bot.pid : 1;
  const base = (TUNABLES.spread ?? 6) + 3;
  let r = base * (0.7 + ((pid * 0.61803) % 1) * 1.0); // 0.7–1.7× → staggered distances
  if (maxR != null) r = Math.min(r, maxR * 0.6); // stay WELL inside the camp radius, or the offset itself re-triggers "walk back" → oscillation
  const ang = (pid * 2.399963) % (Math.PI * 2);
  return { x: point.x + Math.cos(ang) * r, z: point.z + Math.sin(ang) * r };
}

function engage(bot, target, MELEE, T = TUNABLES) {
  const r = rangeFor(bot.cls, MELEE), d = bot.dist(target), facing = bot.faceTo(target);
  if (d > r.max) {
    if (bot.cls === 'warrior' && d >= 8 && d <= 25 && Date.now() - (bot.lastCharge ?? 0) > 15000) {
      bot.cmd({ cmd: 'target', id: target.id }); bot.cmd({ cmd: 'cast', ability: 'charge' }); bot.lastCharge = Date.now(); return;
    }
    moveToward(bot, target); return;
  }
  bot.input(r.min && d < r.min ? { b: 1 } : {}, facing);
  if (bot.self.target !== target.id) bot.cmd({ cmd: 'target', id: target.id });
  bot.cmd({ cmd: 'attack' });
  // CAST-LAG LOCK: after we issue a cast, the snapshot takes ~1-2 ticks to show self.cast/gcd, during
  // which offGcd() reads stale-true and we'd re-issue the spell — INTERRUPTING our own cast (the mage
  // never finishing Frostbolt). Don't call rotate again within castLagMs of the last cast we fired.
  if (bot.offGcd() && Date.now() - (bot._castAt ?? 0) > (rotate.castLagMs ?? 320)) { rotate(bot, target, T); bot._castAt = Date.now(); }
}

// PARTY CROSS-BUFFS: keep each caster's party buff rolling on EVERY member (priest -> Power Word:
// Fortitude = +stamina/HP, the survival buff; paladin -> Blessing of Might = +AP). targetType:'friendly'
// so they cast on allies. We can't see another member's auras over the wire, so we refresh on a timer
// (covers a member that just rezzed losing its buffs). Returns true if it cast a buff (caller continues).
const PARTY_BUFFS = { priest: { ability: 'power_word_fortitude', minLv: 1, cost: 30 }, paladin: { ability: 'blessing_of_might', minLv: 4, cost: 25 } };
function partyBuff(bot, ctx, T) {
  const def = PARTY_BUFFS[bot.cls];
  if (!def || (bot.self.lv ?? 1) < def.minLv || !bot.offGcd() || (bot.self.res ?? 0) < def.cost) return false;
  const now = ctx.now;
  bot._buffAt ??= {};
  const members = (bot.self.party?.members ?? []).filter((m) => !m.dead);
  const due = members.find((m) => now - (bot._buffAt[m.pid] ?? 0) > (T.buffEvery ?? 120000));
  if (!due) return false;
  if (bot.self.target !== due.pid) { bot.cmd({ cmd: 'target', id: due.pid }); return true; }   // target ally first
  bot.cmd({ cmd: 'cast', ability: def.ability });
  bot._buffAt[due.pid] = now;
  if (T.verbose) partyLine(ctx.leader, `✨ ${bot.charName} → ${def.ability.replace(/_/g, ' ')} on ${due.name ?? 'pid' + due.pid}`);
  return true;
}

// COLLECTION-QUEST loot: walk an IDLE bot to its nearest un-personally-looted corpse (within
// lootWalk) and loot it — so EACH member gathers its OWN collection drops (boar hides, supply
// crates, etc.), not just whoever happened to stand on the kill. The mid-fight everyone-loots
// block already grabs corpses within lootGrab(8); this mops up the ones that died a bit farther
// off. Returns true if it took a loot action (the caller should `continue`).
function lootSweep(bot, lootQueue, T) {
  bot._looted ??= new Set();
  const corpse = [...lootQueue.entries()].map(([id, c]) => ({ id, ...c }))
    .filter((c) => !bot._looted.has(c.id) && bot.dist(c) < T.lootWalk)
    .sort((x, y) => bot.dist(x) - bot.dist(y))[0];
  if (!corpse) return false;
  if (bot.dist(corpse) > 4) { moveToward(bot, corpse); return true; }
  bot.input({}); bot.cmd({ cmd: 'loot', id: corpse.id }); bot._looted.add(corpse.id);
  const c = lootQueue.get(corpse.id); if (c) (c.by ??= new Set()).add(bot.pid);
  return true;
}

// priest only: keep Power Word: Shield rolling on the tank (L6+, instant, 6s cd, absorbs damage
// so the healer reacts to fewer big hits). Runs every ~shieldEvery ms unless someone's DYING.
function tryShield(bot, tankBot, T) {
  if (bot.cls !== 'priest' || !bot.offGcd() || !T.shieldTank) return false;
  if ((bot.self.lv ?? 1) < 6) return false;                            // PW:S unlocks at L6
  if (!tankBot || !tankBot.self || tankBot.self.dead) return false;
  // Only shield with real mana HEADROOM (above the readyMana pull-gate) — otherwise the 45-mana
  // shield every 6.5s pins the priest at ~30% mana, the leader keeps "letting the party recover",
  // and throughput halves. Heals always take priority; shielding is a spare-mana luxury.
  if ((bot.self.res ?? 0) < 45 || (bot.self.res ?? 0) / Math.max(1, bot.self.mres ?? 1) < (T.shieldMinMana ?? 0.55)) return false;
  const members = (bot.self.party?.members ?? []).filter((m) => !m.dead);
  if (members.some((m) => m.hp / m.mhp < T.healCrit)) return false;    // someone dying → heal them first
  const now = Date.now();
  if (now - (bot.lastShield ?? 0) < (T.shieldEvery ?? 6500)) return false; // ~PW:S cooldown
  bot.lastShield = now;
  bot.cmd({ cmd: 'target', id: tankBot.pid });
  bot.cmd({ cmd: 'cast', ability: 'power_word_shield' });
  if ((bot.shieldLogAt ?? 0) + 30000 < now) { bot.shieldLogAt = now; bot.journal('🛡️ shielding the tank (Power Word: Shield).'); }
  return true;
}

// healer: dying-first triage, then tank, then most-hurt
function tryHeal(bot, tankPid, HEAL_SPELL, T) {
  if (!bot.isHealer() || !bot.offGcd()) return false;
  // CAST-TIME heals (Lesser Heal = 2s): the snapshot's self.cast lags the tick, so spamming `cast`
  // RESTARTS the cast every tick and it never completes (= no heal lands). Hold off re-issuing for the
  // cast duration so it actually finishes. (Cleared early below if the target gets healed/topped.)
  if (bot._healUntil && Date.now() < bot._healUntil) return true;
  const members = (bot.self.party?.members ?? []).filter((m) => !m.dead);
  // who currently has a mob aggroed on them (= who's actually TAKING HITS) — heal them with priority,
  // not just the designated tank, so an add-grabber or a peeled mob doesn't kill a non-tank.
  const aggroSet = new Set(bot.hostiles().filter((m) => !m.dead && m.aggro != null).map((m) => m.aggro));
  const critical = members.filter((m) => m.hp / m.mhp < T.healCrit).sort((a, b) => a.hp / a.mhp - b.hp / b.mhp)[0];
  const aggroHurt = members.filter((m) => aggroSet.has(m.pid) && m.hp / m.mhp < (T.healTank ?? 0.75)).sort((a, b) => a.hp / a.mhp - b.hp / b.mhp)[0];
  const tank = members.find((m) => m.pid === tankPid && m.hp / m.mhp < T.healTank);
  const low = members.filter((m) => m.pid !== tankPid && m.hp / m.mhp < T.healLow).sort((a, b) => a.hp / a.mhp - b.hp / b.mhp)[0]; // exclude tank — renew covers its chip damage, direct-heal only when truly low (OOM fix)
  const target = critical ?? aggroHurt ?? tank ?? low;
  if (!target) return false;
  // Heals are targetType:'friendly' with a cast time. Targeting + casting in the SAME tick races:
  // the cast resolves against our OLD (hostile) target and the server rejects it, so nothing lands.
  // So TARGET the ally first and only CAST once it's confirmed our target (one tick later).
  if (bot.self.target !== target.pid) {
    bot.cmd({ cmd: 'target', id: target.pid });
    // dedupe: the target cmd takes a few ticks to register in the snapshot, so this branch repeats —
    // only journal on an ACTUAL target change, not every re-issue tick (was ~4 identical lines/sec).
    if (T.verbose && bot._lastTgtLog !== target.pid) { bot._lastTgtLog = target.pid; bot.journal(`🎯 targeting ${target.name}(pid${target.pid}) ${Math.round((target.hp / target.mhp) * 100)}% for heal`); }
    return true;
  }
  // RENEW (priest, L8, INSTANT HoT): keep it rolling on the heal target — instant cast (no 2s-cast
  // interrupt problem) + continuous healing the slow direct heal can't match. Re-apply ~every 11s.
  bot._renewAt ??= {};
  // RENEW (instant HoT) is for TOPPING a target that's only chipped. When the target is actually DYING
  // (< healCrit) skip it and land the big direct heal THIS cast — the HoT's slow tick can't outpace burst,
  // and spending the GCD on renew is what let the healer fall full→dead while only HoT'ing itself.
  const _tgtFrac = target.hp / target.mhp;
  if (_tgtFrac >= (T.healCrit ?? 0.35) && bot.cls === 'priest' && (bot.self.lv ?? 1) >= 8 && Date.now() - (bot._renewAt[target.pid] ?? 0) > 11000) {
    bot._renewAt[target.pid] = Date.now();
    bot.cmd({ cmd: 'cast', ability: 'renew' });
    bot.healCount = (bot.healCount || 0) + 1;
    if (T.verbose) bot.journal(`🌿 renew (HoT) → ${target.name} ${Math.round((target.hp / target.mhp) * 100)}%`);
    return true;
  }
  bot.cmd({ cmd: 'cast', ability: HEAL_SPELL[bot.cls] });
  bot._healUntil = Date.now() + (T.healCastMs ?? 2200); // let the cast FINISH; don't re-spam (= interrupt)
  bot.healCount = (bot.healCount || 0) + 1;
  // log on heal-TARGET change (the diagnostic signal: who am I healing and how low) + a heartbeat every 15
  // casts. Per-cast spam was 2500+ lines/run; the transition + pulse keeps the picture without the bloat.
  const whom = target.pid === tankPid ? 'TANK' : target.pid === bot.pid ? 'SELF' : 'ally';
  if (T.verbose && (bot._lastHealPid !== target.pid || bot.healCount % 15 === 0)) {
    bot._lastHealPid = target.pid;
    bot.journal(`🙏 heal → ${target.name ?? 'ally'} ${target.hp}/${target.mhp} (${Math.round((target.hp / target.mhp) * 100)}%) [${whom}] · ${bot.healCount} cast`);
  } else if (!T.verbose && bot.healCount % 12 === 0) bot.journal(`🙏 Tending the party — ${bot.healCount} heals cast.`);
  return true;
}

// ====================== DUNGEON FARM (combat.dungeonFarm) ======================
// A party clears the dungeon single-pull, loots EVERYTHING, and after the FINAL BOSS dies it RESETS the
// instance (leave dungeon -> disband + reform the party = a NEW party id = a FRESH instance -> re-enter)
// and farms it again. Verbose (every boss/overpull/wipe/reset is logged to the party tab), recoverable
// (wipes corpse-run + regroup before re-advancing), and loot-logged. All gated on T.dungeonFarm.
const FARM_FINAL_BOSS = 'korzul';                       // its death triggers the reset (matched on tid/nm)
const FARM_BOSSES = ['korgath', 'velkhar', 'korzul'];   // boss-fight telemetry
function isFarmBoss(e, key) {
  const s = (String(e.tid ?? '') + ' ' + String(e.nm ?? '')).toLowerCase();
  return key ? s.includes(key) : FARM_BOSSES.some((k) => s.includes(k));
}
// append one line to the party log (party.md) from the brain
function partyLine(leader, text) {
  try { appendFileSync(leader._partyPath ?? 'logs/party.md', `- \`${_stamp()}\` ${leader._ptag ? leader._ptag + ' ' : ''}${text}\n`); } catch {}
}
// LOOT ROLLS: the WARRIOR (tank) NEEDs everything; everyone else GREEDs. Reads open rolls off the wire
// (self.lroll) and answers each exactly once, logging the choice to the bot journal + the party tab.
function answerLootRolls(b, leader) {
  const rolls = b.self?.lroll;
  if (!Array.isArray(rolls) || rolls.length === 0) return;
  b._rolled ??= new Set();
  for (const r of rolls) {
    if (b._rolled.has(r.rollId)) continue;
    b._rolled.add(r.rollId);
    const choice = b === leader ? 'need' : 'greed';   // the TANK/leader needs everything (warrior in the 5-man, paladin in the trio); others greed
    b.cmd({ cmd: 'lootRoll', rollId: r.rollId, choice });
    const item = r.itemName ?? r.itemId ?? '?';
    b.journal(`🎲 ${choice.toUpperCase()} on ${item}`);
    partyLine(leader, `🎲 **${b.charName}** rolls **${choice.toUpperCase()}** on ${item}`);
  }
}
// Per-tick farm state machine. Phases: muster -> clear -> loot -> leave -> reform -> muster. MUSTER
// assembles the WHOLE party at the door (defending reactively, healing) and only then enters together —
// so the party never splits on entry. Also detects WIPES and holds the advance until everyone recovers.
// Operator-controlled GUEST players the bots invite but never drive. On the gravewyrm farm this is ryzemage
// (the water source + a 4th DPS: with the mage in the party Korzul dies fast enough that the paladin no longer
// OOMs, and the mage conjures/shares water for the rest windows). Hot-reloadable here so it applies on the next
// muster with NO orchestrator relaunch; the config's combat.guests, when set, overrides it. The operator logs
// ryzemage in and brings it to the Sanctum door — the leader keeps re-inviting until it's a party member, then
// the muster holds (see farmDrive) until it has joined, so it's IN the group before they enter.
const FARM_GUESTS = ['ryzemage'];
const farmGuestList = (T) => (T.guests ?? (T.dungeonFarm ? FARM_GUESTS : []));
// inviteGuests: the leader re-invites each named guest in view that isn't yet a party member (pinvite is
// id-only). The brain NEVER issues a guest's movement/combat (it isn't in ctx.bots) — the operator does; this
// only gets them into the party so they share loot/quest credit and are off-healed.
function inviteGuests(ctx, guests) {
  const { leader, now, state } = ctx;
  if (!guests?.length || !leader?.self) return;
  const memberPids = new Set((leader.self.party?.members ?? []).map((m) => m.pid));
  state._guestInv ??= {};
  for (const g of guests) {
    const ent = [...leader.ents.values()].find((e) => (e.nm ?? '').toLowerCase() === g.toLowerCase());
    if (ent && !memberPids.has(ent.id) && now - (state._guestInv[g] ?? 0) > 5000) {
      leader.cmd({ cmd: 'pinvite', id: ent.id }); state._guestInv[g] = now;
      leaderSay(leader, `inviting ${g} to the party (you control them)`);
    }
  }
}
// guestsMissing: true while any named guest is NOT yet a party member (whether out of view or just not joined).
// Used to hold the muster at the door until the operator's guest has joined, so they enter together.
function guestsMissing(ctx, guests) {
  const { leader } = ctx;
  if (!guests?.length || !leader?.self) return false;
  const memberPids = new Set((leader.self.party?.members ?? []).map((m) => m.pid));
  return guests.some((g) => {
    const ent = [...leader.ents.values()].find((e) => (e.nm ?? '').toLowerCase() === g.toLowerCase());
    return !ent || !memberPids.has(ent.id);
  });
}

function farmAdvancePhase(ctx, T, inDungeon) {
  const { leader, bots, now, state } = ctx;
  const F = (state.farm ??= { phase: 'muster', since: now, bossSeen: false, bossLow: false, prevPartyId: null, runs: 0, wipes: 0, wiping: false });
  const alive = bots.filter((b) => b.self && b.connected);
  const upAlive = alive.filter((b) => !b.self.dead);
  const setPhase = (p, msg) => { if (F.phase !== p) { F.phase = p; F.since = now; F.guestWaitStart = null; if (msg) partyLine(leader, msg); } };
  // --- WIPE detection + recovery (orthogonal to the phase) ---
  if (alive.length > 0 && upAlive.length === 0 && !F.wiping) {
    F.wiping = true; F.wipes += 1;
    partyLine(leader, `💀 **WIPE #${F.wipes}** (phase ${F.phase}, z≈${Math.round(leader.self?.z ?? 0)}, focus ${state._dps?.name ?? '?'}). Corpse-running, then regrouping.`);
  }
  if (F.wiping && alive.length > 0 && alive.every((b) => !b.self.dead && b.hpFrac() > 0.8)) {
    F.wiping = false; partyLine(leader, '🟢 Recovered from the wipe — resuming.');
  }
  // GRACEFUL INSTANCE-BUSY RETRY: when every instance slot is taken, the server emits an error event ("All
  // instances of <X> are busy. Try again soon.") and leaves us OUTSIDE. Detect it and set a party-wide
  // cooldown (state._instBusyUntil); the muster/clear enter logic honors it and WAITS at the door instead of
  // hammering enter_dungeon every 800ms. After the backoff it retries (re-detecting + re-backing-off if still
  // full) until a slot frees. Logged once per backoff so it doesn't spam.
  if (bots.some((b) => (b.events ?? []).some((ev) => ev.type === 'error' && /instances?\b[^]*\bbusy/i.test(ev.text ?? '')))) {
    const back = T.instanceBusyBackoffMs ?? 45000;
    if (!state._instBusyUntil || now > state._instBusyUntil) partyLine(leader, `⏳ All ${ctx.dungeon?.name ?? 'instance'} slots are busy — backing off ${Math.round(back / 1000)}s, then retrying the door.`);
    state._instBusyUntil = now + back;
  }
  // --- final-boss death detection: trigger the reset ONLY on Korzul's ACTUAL death — the entity is dead
  // in view, OR a death EVENT fired for him. The old "seen low + out of view = dead" heuristic fired the
  // reset while he was still alive at ~13% (he just dipped out of view), which would abandon a live boss. ---
  const finalBoss = [...leader.ents.values()].find((e) => e.k === 'mob' && isFarmBoss(e, FARM_FINAL_BOSS));
  if (inDungeon && finalBoss && !finalBoss.dead) F.bossSeen = true;
  const finalDeathEvt = bots.some((o) => (o.events ?? []).some((ev) => ev.type === 'death' && isFarmBoss(o.ents.get(ev.entityId) ?? {}, FARM_FINAL_BOSS)));
  const finalDown = F.bossSeen && ((finalBoss && finalBoss.dead) || finalDeathEvt);
  const inside = (b) => (b.self?.x ?? 0) > 500;
  const out = (b) => (b.self?.x ?? 0) < 500;
  // NOTE: a member orphaned deep in a STALE instance (e.g. swifter soloing the previous run's cleared
  // instance while the rest reform a fresh one) can NOT be fixed by forcing a full reset — it can't reach
  // its exit to leave, so a "force everyone out" recovery just spins (leave->reform->muster->split->leave).
  // Instead the orphan rescues ITSELF in the muster phase below (walk back to the exit, leave, re-enter),
  // and the rest of the party proceeds without waiting on it. No split-detection forced-reset here.
  switch (F.phase) {
    case 'muster': {
      // Start the clear once the LIVING members are inside — do NOT wait for a corpse-running death
      // (it rezzes outside and rejoins via the march-in path), or one death deadlocks the whole party at
      // the entry forever. Need a viable group (>=3 alive inside) so we don't start 1-manning it.
      const livingInside = upAlive.filter(inside);
      // COHESION: count only inside members clustered near the leader (same instance slot). A member orphaned
      // in a STALE instance (far away) is excluded — it gets time to self-rescue (walk to its exit, leave,
      // re-enter) and rejoin, instead of the clear starting with it stranded and re-stranding it in the
      // clear phase (which has no rescue path).
      const leaderIn = inside(leader);
      const grouped = livingInside.filter((o) => o === leader || o.dist(leader.pos()) < 250);
      const viable = leaderIn && grouped.length >= Math.min(3, alive.length);
      const allHome = upAlive.every(inside) && grouped.length === livingInside.length;       // nobody orphaned
      // start once everyone's in and grouped — OR, if an orphan can't rejoin within musterMaxMs, with the
      // grouped majority anyway (better to keep farming as a smaller group than deadlock on a stuck member).
      if (viable && (allHome || now - F.since > (T.musterMaxMs ?? 60000))) {
        F.bossSeen = false; F.bossLow = false; F.wallStuck = false; state.dungeonCx = null; state.dungeonEntryZ = null; state._advZ = null; state._advAt = null; state._maxDepth = null; state._maxDepthAt = null;
        setPhase('clear', allHome ? `⚔️ ${grouped.length} inside and grouped up — clearing single-pull from the entrance.` : `⚔️ ${grouped.length} grouped inside (a straggler is still recovering) — starting the clear.`);
      }
      break;
    }
    case 'clear':
      // KNOCKED OUT: if the party (the tank) ends up OUTSIDE the instance during a clear — wiped/corpse-ran
      // to the graveyard — go back to MUSTER so they re-march to the door and re-enter, instead of frozenly
      // pathing toward the now-unreachable instance interior (the "stuck in the graveyard" bug).
      if (upAlive.length && upAlive.every(out)) { setPhase('muster', '↩️ Knocked out to the graveyard — regrouping at the door to re-enter.'); break; }
      // WALL-STUCK: dungeonAdvance couldn't find the chamber gap (borked instance alignment after a messy
      // reform) — leave and reform for a fresh, cleanly-aligned instance instead of grinding the wall forever.
      if (F.wallStuck) { F.wallStuck = false; state._instBusyUntil = now + (T.wallStuckReenterWaitMs ?? 90000); setPhase('leave', '🧱 Advance wall-stuck — leaving, then WAITING outside ~90s so another party grabs this slot (busy realm reuses the same one), then re-entering for a different instance.'); break; }
      // ABSOLUTE SHALLOW-STUCK BACKSTOP: track max forward depth. If the party never gets past the entrance
      // (maxDepth stays shallow) for absoluteStuckMs, the slot is broken — wall-stuck at the entry with a
      // catastrophic overpull whose constant loot/heal/regroup holds keep RESETTING the dungeonAdvance stuck
      // timer, so the normal wall-stuck reset never fires and they spin forever killing nothing (no loot).
      // This fires regardless of combat/holds. Gated to SHALLOW depth so a deep boss fight (legit long stall
      // at the boss room) is never mistaken for stuck.
      if (inDungeon && leader.self) {
        const depth = (leader.self.z ?? 0) - (state.dungeonEntryZ ?? leader.self.z ?? 0);
        if (depth > (state._maxDepth ?? -1e9) + 3) { state._maxDepth = depth; state._maxDepthAt = now; }
        else if ((state._maxDepth ?? 0) < (T.entryStuckDepth ?? 60) && state._maxDepthAt && now - state._maxDepthAt > (T.absoluteStuckMs ?? 180000)) {
          state._maxDepth = null; state._maxDepthAt = null;
          state._instBusyUntil = now + (T.wallStuckReenterWaitMs ?? 90000);   // wait outside so the busy realm reassigns a different slot
          setPhase('leave', '🧱 No progress past the entrance — leaving + WAITING ~90s so this slot gets reclaimed, then re-entering for a different instance.');
          break;
        }
      }
      if (inDungeon && finalDown) setPhase('loot', `☠️ **Korzul is DOWN!** Looting the Wyrm's Hollow, then resetting the instance.`);
      break;
    case 'loot': {
      const corpsesNear = [...ctx.lootQueue.values()].some((c) => upAlive.some((b) => b.dist(c) < (T.lootWalk ?? 40)));
      if (!corpsesNear || now - F.since > (T.farmLootMs ?? 25000)) setPhase('leave', '🚪 Loot cleared — heading to the exit to reset the instance.');
      break;
    }
    case 'leave':
      // proceed once everyone's out — but TIME-BOUND it: a member that can't reach the exit (deep, can't
      // see it) must not freeze the whole reset. After resetStepMs, reform anyway (it re-enters via muster).
      if ((alive.length && alive.every(out)) || now - F.since > (T.resetStepMs ?? 30000)) {
        F.prevPartyId = leader.self?.party?.id ?? null;
        setPhase('reform', alive.every(out) ? '🔁 Out of the instance — disbanding + reforming (fresh party = fresh instance).' : '⏱️ Leave stalled — reforming anyway to regroup everyone.');
      }
      break;
    case 'reform': {
      const pid0 = leader.self?.party?.id ?? null;
      const memberCount = (leader.self?.party?.members ?? []).length;
      // reformed (new party id, everyone in) -> next run. TIME-BOUND so a stuck reform can't freeze the loop.
      if ((pid0 != null && pid0 !== F.prevPartyId && memberCount >= alive.length) || now - F.since > (T.resetStepMs ?? 30000)) { F.runs += 1; setPhase('muster', `✅ Reforming done — regrouping at the door for farm run #${F.runs + 1}.`); }
      break;
    }
  }
  return F;
}
// Per-bot action during a RESET phase (loot/leave/reform/enter). Returns true if it handled the bot.
function farmDrive(b, ctx, T, F, DOOR, DUNGEON_ID) {
  const { leader, bots, now } = ctx;
  switch (F.phase) {
    case 'loot':
      if (lootSweep(b, ctx.lootQueue, T)) return true;
      if (b.dist(leader.pos()) > (T.follow ?? 5) + 4) moveToward(b, followAnchor(b, leader.pos())); else b.input({});
      return true;
    case 'leave': {
      if ((b.self.x ?? 0) < 500) { const s = campAnchor(b, DOOR, 8); if (b.dist(s) > 1.6) moveToward(b, s); else b.input({}); return true; }  // already out -> spread into a loose cluster near the door, not a stack
      const exit = [...b.ents.values()].find((e) => e.tid === 'dungeon_exit');
      if (exit) { if (b.dist(exit) < 6) { if (now - (b._leaveAt ?? 0) > 1200) { b.cmd({ cmd: 'leave_dungeon' }); b._leaveAt = now; } b.input({}); } else moveToward(b, exit); }
      else moveToward(b, { x: b.self.x ?? 0, z: (b.self.z ?? 0) - 30 });             // exit out of view -> walk back toward the entry (low-z) to find it
      return true;
    }
    case 'reform': {
      const myParty = b.self.party;
      const stillOld = myParty && myParty.id != null && myParty.id === F.prevPartyId;
      if (now - F.since < 2500) {                                                     // sub-step 1: everyone leaves the old party
        if (stillOld && now - (b._pleaveAt ?? 0) > 1000) { b.cmd({ cmd: 'pleave' }); b._pleaveAt = now; }
        const s = campAnchor(b, DOOR, 8); if (b.dist(s) > 1.6) moveToward(b, s); else b.input({}); return true;
      }
      if (b === leader) {                                                             // sub-step 2: leader invites, followers accept
        const members = new Set((b.self.party?.members ?? []).map((m) => m.pid));
        for (const o of bots) if (o !== b && o.connected && o.pid > 0 && !members.has(o.pid)) b.cmd({ cmd: 'pinvite', id: o.pid });
      } else {
        for (const ev of (b.events ?? [])) if (ev.type === 'partyInvite') b.cmd({ cmd: 'paccept' });
        if (now - (b._pacceptAt ?? 0) > 1000) { b.cmd({ cmd: 'paccept' }); b._pacceptAt = now; } // blind retry (no-op without an invite)
      }
      { const s = campAnchor(b, DOOR, 8); if (b.dist(s) > 1.6) moveToward(b, s); else b.input({}); } return true;
    }
    case 'muster': {
      // MUSTER happens INSIDE at the safe entry — never loiter outside (the door is ringed by the Sanctum
      // Approach mobs and a lone bot with no healer in range just dies, the v2 bug). Each bot makes its own
      // way to the door and ZONES IN the instant it's in range; the regroup is inside.
      const partyPids = new Set(bots.map((o) => o.self?.id ?? o.pid));
      if (b.isHealer() && b !== leader) { if (tryHeal(b, leader.pid, ctx.HEAL_SPELL, T)) return true; if (tryShield(b, leader, T)) return true; }
      if ((b.self.x ?? 0) > 500) {
        // ORPHAN SELF-RESCUE: a bot stranded in a STALE instance (the previous run's cleared instance) is
        // FAR from every other inside member (different instance slot = different world position). It can't
        // be teleported to the group, so it walks itself back to the exit (toward the entry at decreasing
        // local-z; the layout is always entry-low-z / boss-high-z), leaves, then re-enters with everyone.
        const otherInside = bots.filter((o) => o !== b && o.self && !o.self.dead && (o.self.x ?? 0) > 500);
        const orphaned = otherInside.length > 0 && otherInside.every((o) => b.dist(o.pos()) > 300);
        if (orphaned) {
          const exit = [...b.ents.values()].find((e) => e.tid === 'dungeon_exit');
          if (exit) { if (b.dist(exit) < 6) { if (now - (b._leaveAt ?? 0) > 1200) { b.cmd({ cmd: 'leave_dungeon' }); b._leaveAt = now; } b.input({}); } else moveToward(b, exit); }
          else moveToward(b, { x: b.self.x ?? 0, z: (b.self.z ?? 0) - 30 });   // head back toward the entry/exit
          return true;
        }
        // INSIDE with the group: fight ONLY what's actually attacking the party (reactive) — do NOT
        // proactively grab nearby mobs, which body-pulls the whole entry pack (overpull). Then hold.
        const threat = b.hostiles().filter((m) => !m.dead && partyPids.has(m.aggro)).sort((x, y) => b.dist(x) - b.dist(y))[0];
        if (threat) { engage(b, threat, ctx.MELEE, T); return true; }
        b.input({}); return true;
      }
      // OUTSIDE: RUN STRAIGHT IN — do NOT stop to fight (no healer out here). Centre lane, then zone in
      // the moment we're within the door's 8y radius. Aggroed mobs leash off the instant we're inside.
      try { b.cmd({ cmd: 'stopattack' }); } catch {}
      if (b.dist(DOOR) < 7) {
        if (ctx.state._instBusyUntil && now < ctx.state._instBusyUntil) { const s = campAnchor(b, DOOR, 8); if (b.dist(s) > 1.6) moveToward(b, s); else b.input({}); return true; }
        // HOLD for the operator-controlled guest (ryzemage) to JOIN before we zone in, so it's in the group for
        // the whole clear. The timer starts only once we're actually ready to enter (door clear, not busy), and
        // caps at guestWaitMs so a no-show operator can't strand the farm outside forever. The leader keeps
        // re-inviting via inviteGuests (tick), so the guest just has to walk into view + accept.
        const guests = farmGuestList(T);
        if (guests.length && guestsMissing(ctx, guests)) {
          F.guestWaitStart ??= now;
          if (now - F.guestWaitStart < (T.guestWaitMs ?? 180000)) { const s = campAnchor(b, DOOR, 8); if (b.dist(s) > 1.6) moveToward(b, s); else b.input({}); return true; }
        }
        if (now - (b._enterAt ?? 0) > 800) { b.cmd({ cmd: 'enter_dungeon', dungeon: DUNGEON_ID }); b._enterAt = now; } b.input({}); return true;
      }
      const STAGE = { x: 0, z: 812 };                                     // centre lane just south of the approach mobs
      const dest = (b.self.z < STAGE.z - 4 || Math.abs(b.self.x ?? 0) > 14) ? STAGE : DOOR;
      moveToward(b, dest); return true;
    }
    case 'clear': {
      // During an active clear, a member KNOCKED OUT rezzes at the OUTSIDE graveyard. March it back to the
      // door and re-enter (same party id -> same in-progress instance) so it rejoins the fight, instead of
      // holding forever (the outside-guard) or stalling the run. INSIDE members return false -> normal combat.
      if ((b.self.x ?? 0) >= 500) return false;
      try { b.cmd({ cmd: 'stopattack' }); } catch {}
      if (b.dist(DOOR) < 7) { if (ctx.state._instBusyUntil && now < ctx.state._instBusyUntil) { const s = campAnchor(b, DOOR, 8); if (b.dist(s) > 1.6) moveToward(b, s); else b.input({}); return true; } if (now - (b._enterAt ?? 0) > 800) { b.cmd({ cmd: 'enter_dungeon', dungeon: DUNGEON_ID }); b._enterAt = now; } b.input({}); return true; }
      const STAGE = { x: 0, z: 812 };
      const dest = (b.self.z < STAGE.z - 4 || Math.abs(b.self.x ?? 0) > 14) ? STAGE : DOOR;
      moveToward(b, dest); return true;
    }
  }
  return false;
}
// VERBOSE FARM TELEMETRY: log boss engagements + kills and overpull warnings to the party tab, so a run's
// failures are legible (which boss, how big the pull, where it died). Throttled so it never spams.
function farmTelemetry(ctx, T, leader, bots, state) {
  const now = ctx.now;
  state._farmTel ??= { bossKey: null, bossLogAt: 0, overpullAt: 0, bossDead: {}, bossLowHp: 1 };
  const tel = state._farmTel;
  const partyIds = new Set(bots.map((o) => o.self?.id ?? o.pid));
  // PARTY-WIDE view: union of every member's visible mobs, so a boss is tracked even when the leader is
  // dead / far during the fight (the cause of missing Velkhar/Korzul logs). Keyed by id so dupes collapse.
  const seen = new Map();
  for (const o of bots) if (o.self && o.connected) for (const e of o.ents.values()) if (e.k === 'mob') seen.set(e.id, e);
  const hostiles = [...seen.values()].filter((m) => !m.dead && m.h);
  const onParty = hostiles.filter((m) => m.aggro != null && partyIds.has(m.aggro)).length;
  // BOSS telemetry — RELIABLE: a boss counts as ENGAGED the moment it's in combat with us (aggroed on the
  // party) OR taking damage (hp < max) OR a member is within 12y. Scan the party-wide view + any death
  // event, so Korgath/Velkhar/Korzul fights and kills are always logged regardless of who can see them.
  const anyClose = (m) => bots.some((o) => o.self && !o.self.dead && o.dist(m) < 12);
  const boss = [...seen.values()].find((m) => isFarmBoss(m) && !m.dead && (partyIds.has(m.aggro) || (m.mhp && m.hp < m.mhp) || anyClose(m)));
  // "Overpull" vs "boss adds": extra mobs WHILE A BOSS IS UP are its SUMMONED ADDS (Velkhar spawns 3
  // Bonewalkers at 66%/33%), not a mispull — label them honestly so the log isn't misleading.
  if (onParty >= (T.maxEngage ?? 2) + 2 && now - tel.overpullAt > 8000) {
    tel.overpullAt = now;
    if (boss) partyLine(leader, `➕ **${onParty - 1} adds** up during ${boss.nm ?? 'the boss'} — burning them off the healers.`);
    else partyLine(leader, `⚠️ **OVERPULL** — ${onParty} mobs on the party (cap ${T.maxEngage ?? 2}) at z≈${Math.round(leader.self?.z ?? 0)}. Watch for a wipe.`);
  }
  const bossDeathEvt = bots.some((o) => (o.events ?? []).some((ev) => ev.type === 'death' && isFarmBoss(seen.get(ev.entityId) ?? {})));
  if (boss) {
    const key = FARM_BOSSES.find((k) => isFarmBoss(boss, k));
    tel.bossLowHp = boss.hp / Math.max(1, boss.mhp);
    if (tel.bossKey !== key) { tel.bossKey = key; tel.bossLogAt = now; partyLine(leader, `🔱 **Engaging ${boss.nm ?? key}** (${boss.hp}/${boss.mhp} HP).`); }
    else if (now - tel.bossLogAt > 10000) { tel.bossLogAt = now; partyLine(leader, `🔱 ${boss.nm ?? key}: **${Math.round(tel.bossLowHp * 100)}%** HP.`); }
  } else if (tel.bossKey) {
    // a real KILL: it left our view after being low, or a death event fired for it.
    if ((bossDeathEvt || (tel.bossLowHp ?? 1) < 0.2) && !tel.bossDead[tel.bossKey]) { tel.bossDead[tel.bossKey] = true; partyLine(leader, `🏆 **${tel.bossKey.toUpperCase()} DEFEATED!** (loot logged above)`); }
    tel.bossKey = null;
  }
  // PULL telemetry (the key tuning signal): on a NEW focus mob, log WHAT we pulled, WHO is holding it,
  // and HOW MANY mobs are on the party — so pull conservativeness / threat can be tuned in real time.
  const focus = state.focusId != null ? leader.ents.get(state.focusId) : null;
  if (focus && !focus.dead && !isFarmBoss(focus)) {
    if (tel.pullId !== focus.id) {
      tel.pullId = focus.id;
      const holder = bots.find((o) => o.self && (o.self.id ?? o.pid) === focus.aggro);
      partyLine(leader, `⚔️ Pull: **${focus.nm ?? 'mob'}** — tanking: ${holder ? holder.charName : '(threat not set yet)'} · **${onParty}** mob(s) on the party`);
    }
  } else if (!focus) { tel.pullId = null; }
}

// DUNGEON-RUN advance: inside the instance, push the tank/leader FORWARD (deeper = +z, hugging the
// captured centre-line x so we thread the chamber waists) ONE pull at a time. Only step forward when the
// party is healthy and out of combat — otherwise HOLD so heals/regen top everyone off before the next
// pack. We never call this while a mob is in pull range (the leader is targetless here), so the trash/boss
// blocking the path simply becomes the focus as we close on it; the existing focus-fire + heal logic kills
// it. Stops at the back of the instance so a cleared run doesn't grind into the end wall.
function dungeonAdvance(leader, bots, T, state, lootQueue) {
  if (!leader.self) return;
  // OUTSIDE GUARD: never advance/sweep when the leader is OUTSIDE the instance (x<500). After a reset the
  // leader can be at the door mid-recovery while phase is still 'clear'; without this guard it "sweeps for
  // the chamber gap" against overworld terrain at the door and stale cx pins the loop (the door-cycle bug).
  // The reset/muster machinery (farmDrive) owns re-entry; here we just hold until we're back inside.
  if ((leader.self.x ?? 0) < 500) { leader.input({}); leaderSay(leader, 'outside — waiting to re-enter'); return; }
  const party = bots.filter((b) => b.self && !b.self.dead);
  // LOOT GATE: pause briefly to loot a CLOSE corpse before advancing — but TIME-BOUNDED so a lingering /
  // unreachable corpse can't deadlock the whole clear (the bug that froze them at the entry). Only counts
  // corpses within loot-grab range, and gives up after lootWaitMs.
  const corpseNear = lootQueue && [...lootQueue.values()].some((c) => party.some((b) => b.dist(c) < (T.lootGrab ?? 10) + 5));
  if (corpseNear) {
    if (!state.lootWaitSince) state.lootWaitSince = Date.now();
    if (Date.now() - state.lootWaitSince < (T.lootWaitMs ?? 6000)) { state._advAt = Date.now(); leader.cmd({ cmd: 'stopattack' }); leader.input({}); leaderSay(leader, 'looting the kills before advancing'); return; }
  } else state.lootWaitSince = 0;
  // REGROUP GATE: single-pulling means moving as ONE. Don't push forward while a follower is DEAD (still
  // corpse-running) or lagging behind — otherwise the leader walks deep alone, the party scatters, and they
  // wipe one by one (the v1/v4 bug). Wait for everyone alive AND close before the next pull.
  const followers = bots.filter((b) => b !== leader && b.self && b.connected);
  // regroup distance: a 5-man naturally spreads ~20-22y, so the tight duo-tuned regroupDist (14) makes the
  // leader churn ("holding for 1") and inch forward only via the timeout. Use a roomier radius for the farm.
  const regroupD = T.dungeonFarm ? Math.max(30, T.regroupDist ?? 22) : (T.regroupDist ?? 22);
  const notReady = followers.filter((b) => b.self.dead || b.dist(leader.pos()) > regroupD);
  // TIME-BOUNDED: hold for the party to close up, but never FOREVER — a follower that can't path back
  // (stuck on terrain after a boss) would otherwise freeze the whole run mid-instance (the deadlock that
  // stalled the push to Korzul). After regroupWaitMs, advance anyway; a stuck straggler gets left behind.
  if (notReady.length) {
    if (!state.regroupSince) state.regroupSince = Date.now();
    const allDeadStrays = notReady.every((b) => b.self.dead);
    if (allDeadStrays || Date.now() - state.regroupSince < (T.regroupWaitMs ?? 22000)) {
      state._advAt = Date.now(); leader.cmd({ cmd: 'stopattack' }); leader.input({}); leaderSay(leader, `holding for ${notReady.length} to regroup (${notReady.filter((b) => b.self.dead).length} dead)`); return;
    }
  } else state.regroupSince = 0;
  const healer = party.find((b) => b.isHealer() && b !== leader) ?? party.find((b) => b.isHealer());
  const hurt = party.some((b) => b.hpFrac() < (T.advanceHp ?? 0.85));
  const oom = healer && healer.self.mres && (healer.self.res ?? 0) / healer.self.mres < (T.advanceMana ?? 0.6);
  // TIME-BOUNDED recover hold: wait for HP/mana before the next pull, but never forever — an OOM priest
  // that can't regen (in combat, no water) would deadlock the whole clear at the entry otherwise.
  if (hurt || oom) {
    if (!state.recoverWaitSince) state.recoverWaitSince = Date.now();
    if (Date.now() - state.recoverWaitSince < (T.recoverWaitMs ?? 20000)) { state._advAt = Date.now(); leader.cmd({ cmd: 'stopattack' }); leader.input({}); leaderSay(leader, 'holding to heal/mana up before the next pull'); return; }
  } else state.recoverWaitSince = 0;
  const cx = state.dungeonCx ?? leader.self.x;
  const entryZ = state.dungeonEntryZ ?? leader.self.z;
  if (leader.self.z - entryZ > (T.advanceMaxDepth ?? 175)) { leader.input({}); leaderSay(leader, 'instance cleared — holding at the back'); return; }
  // BLOCKED-ADVANCE recovery: track forward depth; if it stops increasing while we're "advancing", a mob is
  // blocking the chamber waist just BEYOND pullRadius (so target-selection never engages it) or the centre
  // line cx is slightly off the gap. Close on the nearest mob AHEAD to drag it into pull range and kill it
  // (at a choke you MUST kill the blockers), or — if there's no mob — sweep x to find the waist gap. Without
  // this the whole run wall-stalls at the first tight waist (the z-stuck-at-1093 deadlock).
  state._advZ ??= -1e9; state._advAt ??= Date.now();
  // CRITICAL: only count "no forward progress" time when we are genuinely OUT OF COMBAT. During a boss/add
  // fight the party stands still (no depth gain) for minutes — without this the stuck-timer false-trips and
  // RESETS the instance mid-boss (the post-Velkhar abandon-before-Korzul bug). Any hostile aggroed on the
  // party counts as combat and keeps the timer fresh.
  const _advPids = new Set(bots.map((o) => o.self?.id ?? o.pid));
  const _fighting = bots.some((o) => o.self && !o.self.dead && (typeof o.hostiles === 'function' ? o.hostiles() : []).some((m) => !m.dead && _advPids.has(m.aggro)));
  if (leader.self.z > state._advZ + 2 || _fighting) {
    // LANE-TRACK: every time we actually gain depth, re-centre cx on the leader's current x — the open lane
    // we just walked. Far more robust than one fragile capture at entry (which goes stale/wrong after a
    // messy reform and walls the whole run). Only update on real forward progress, not while fighting in place.
    if (leader.self.z > state._advZ + 2 && (leader.self.x ?? 0) > 500) state.dungeonCx = leader.self.x;
    state._advZ = leader.self.z; state._advAt = Date.now();
  }
  // TRASH-FIRST: never advance (or rush at the boss) while LIVE trash is near the party. PULL the nearest
  // mob and fight it HERE; the party focus-fires it down, THEN we step forward. This is what stops the
  // body-pulling-a-pack-of-8 + running-a-train-to-the-boss behavior — they attack what's here first.
  const nearTrash = leader.hostiles().filter((m) => !m.dead && leader.dist(m) < (T.advanceClearRadius ?? 26)).sort((a, b) => leader.dist(a) - leader.dist(b))[0];
  if (nearTrash) {
    state.focusId = nearTrash.id;
    if (leader.self.target !== nearTrash.id) leader.cmd({ cmd: 'target', id: nearTrash.id });
    leader.input({}, leader.faceTo ? leader.faceTo(nearTrash) : undefined);
    leader.cmd({ cmd: 'attack' });
    leaderSay(leader, `clearing trash (${nearTrash.nm ?? 'mob'}) before advancing`);
    return;
  }
  const stuckMs = Date.now() - state._advAt;
  if (stuckMs > (T.advanceStuckMs ?? 8000)) {
    // WAYPOINT NAV: the next room's mobs line the actual path. When wall-stuck, steer toward the nearest mob
    // AHEAD (up to advanceUnstickRange, widened to 60 so it sees across the waist into the next chamber) —
    // moveToward follows the corridor's true direction toward it and skirts obstacles, instead of blindly
    // sweeping x at a bent/off-axis waist. Far more reliable for threading a chamber gap than the x-sweep.
    const ahead = leader.hostiles()
      .filter((m) => !m.dead && (m.z ?? 0) > leader.self.z - 4 && leader.dist(m) < (T.advanceUnstickRange ?? 60))
      .sort((a, b) => leader.dist(a) - leader.dist(b))[0];
    if (ahead) { state.focusId = ahead.id; moveToward(leader, ahead); leaderSay(leader, `steering toward ${ahead.nm ?? 'a mob'} ahead to thread the waist`); return; }
    // no mob to kill and the centre line is walled: if we've been wall-stuck a long time the instance
    // alignment is borked (bad entry/cx from a messy timeout-reform) — flag a full RESET for a clean
    // re-entry from the true entrance (farmAdvancePhase 'clear' picks this up and leaves the instance).
    if (stuckMs > (T.advanceResetMs ?? 180000) && state.farm) state.farm.wallStuck = true;
    // WIDE LATERAL+FORWARD SWEEP: search a much wider x band (±40) for the chamber gap, and ALTERNATE a
    // pure sideways slide (find the gap) with a forward push (go through it). The old narrow diagonal-only
    // sweep (±18, always +z) missed gaps that are off-centre or reached by sliding laterally first — which
    // is what wall-pins the run at a waist on a busy realm where resetting just hands back the same slot.
    const sweep = [8, -8, 16, -16, 24, -24, 32, -32, 40, -40];
    const ji = Math.floor(stuckMs / 2000);
    const jitter = sweep[ji % sweep.length];
    const step = T.advanceStep ?? 16;
    // 3-phase per x: BACK UP (-z, retreat into open space) -> SLIDE (same z, to a fresh x) -> PUSH (+z,
    // re-approach the waist from the new angle). Pushing straight into the same wall never threads an
    // off-axis or bent corridor; backing up + re-approaching does.
    const phase = ji % 3;
    const dz = phase === 0 ? -step : phase === 1 ? 0 : step;
    moveToward(leader, { x: cx + jitter, z: leader.self.z + dz });
    leaderSay(leader, 'blocked — backing up + sweeping wide for the chamber gap'); return;
  }
  moveToward(leader, { x: cx, z: leader.self.z + (T.advanceStep ?? 16) });
  leaderSay(leader, 'advancing to the next pull');
}

let _gearDumped = false; // reset on every hot-reload, so flipping dumpGear:true → save dumps exactly once
// ===================== ATTUNEMENT QUESTLINE (the q_nythraxis_* chain) =====================
// A self-contained state machine that walks 3 bots through the Nythraxis attunement: accept at Aldric,
// do each quest's objective, turn in together, accept the next. Quests 1-4 get them ATTUNED (Scourge's
// End in hand); quest 5 is a 10-player raid kill, out of reach, so we stop after #4.
const ATTUNE_GIVER = { x: -10, z: 656 };                       // Brother Aldric (accept + turn-in)
const ATTUNE_CHAIN = [
  'q_nythraxis_restless_dead',    // 1: collect 10 runed_bone_shard from boneclad_revenant
  'q_nythraxis_graves',           // 2: interact 3 grave objects
  'q_nythraxis_sealed_crypt',     // 3: crypt instance -> 3 relics -> elites -> keystones
  'q_nythraxis_bound_guardian',   // 4: ritual circle + bound_guardian boss
];
const ATTUNE_STEP = {
  q_nythraxis_restless_dead: { kind: 'grind', mob: 'boneclad_revenant', mobName: 'Boneclad Revenant', camps: [{ x: -40, z: 830, r: 28 }, { x: -15, z: 860, r: 20 }] },
  q_nythraxis_graves: { kind: 'objects', objs: [{ tid: 'grave_sir_aldren', x: 138, z: 838 }, { tid: 'grave_high_priest_malric', x: 141, z: 712 }, { tid: 'grave_captain_voss', x: -139, z: 787 }] },
  q_nythraxis_sealed_crypt: { kind: 'crypt', door: { x: -152, z: 610 }, dungeon: 'nythraxis_crypt', relics: ['captains_crest', 'priests_sigil', 'royal_seal'] },
  q_nythraxis_bound_guardian: { kind: 'objboss', obj: { tid: 'crypt_ritual_circle', x: 68, z: 800 }, boss: 'bound_guardian', bossName: 'Bound Guardian' },
};
const _attShort = (qid) => qid.replace('q_nythraxis_', '');
function _attuneLogQuests(ctx) {
  const { bots, leader } = ctx;
  for (const b of bots) {
    if (!b.self) continue;
    b._qa ??= new Set(); for (const q of (b.self.qlog ?? [])) if (q.questId?.startsWith('q_nythraxis_') && !b._qa.has(q.questId)) { b._qa.add(q.questId); partyLine(leader, `📥 **${b.charName}** accepted **${_attShort(q.questId)}**`); }
    b._qd ??= new Set(); for (const id of (b.self.qdone ?? [])) if (id.startsWith('q_nythraxis_') && !b._qd.has(id)) { b._qd.add(id); partyLine(leader, `✅ **${b.charName}** completed **${_attShort(id)}**`); }
  }
}
function attuneRunBack(b) { try { b.cmd({ cmd: 'release' }); } catch {} } // dead -> release: respawns ALIVE at graveyard, full HP
function attuneOffHeal(ctx, b, T) {
  // The 3-man has NO dedicated healer: the paladin (holy_light) and shaman (healing_wave) off-heal a low
  // party member, then go back to DPS. CRITICAL: only heal a member that's actually NEARBY (<30y) and low —
  // otherwise a low GUEST (swifter, operator-controlled) wandering off would glue the healer to it, drag it
  // away from the grind, and get it flagged AFK (the Pontius-AFK bug).
  if (!(b.isHealer && b.isHealer())) return false;
  const lowNear = (b.self.party?.members ?? []).some((m) => {
    if (m.dead || (m.hp / m.mhp) >= (T.healLow ?? 0.5)) return false;
    if (m.pid === (b.self.id ?? b.pid)) return true;                       // self always counts
    const e = b.ents.get(m.pid);                                          // member's entity -> position
    return e ? b.dist(e) < 30 : false;                                    // only if we can see it AND it's close
  });
  return lowNear ? tryHeal(b, ctx.leader.pid, ctx.HEAL_SPELL, T) : false;
}
function attuneRegroup(ctx, dest) {
  for (const b of ctx.bots) if (b.self && b.connected) { if (b.self.dead) attuneRunBack(b); else if (b.dist(dest) > 6) moveToward(b, dest); else b.input({}); }
}
// Party-wide focus-fire combat used by the grind + boss steps: every bot hits ONE shared focus mob so the
// squishy trio takes the fewest hits, off-heals when low, loots, and releases on death. Pass a chooser that
// returns the focus mob (or null) from the party-wide hostile view; falls back to the camp anchor when idle.
function attuneFight(ctx, T, chooseFocus, idleDest) {
  const { bots, lootQueue, MELEE } = ctx;
  const seen = new Map();
  for (const o of bots) if (o.self && !o.self.dead) for (const m of o.hostiles()) if (!m.dead && m.h) seen.set(m.id, m);
  const focus = chooseFocus([...seen.values()]);
  for (const b of bots) {
    if (!b.self || !b.connected) continue;
    if (b.self.dead) { attuneRunBack(b); continue; }
    if (lootSweep(b, lootQueue, T)) continue;                  // LOOT FIRST — collecting shards/keystones is the OBJECTIVE
    if (attuneOffHeal(ctx, b, T)) continue;                    // then heal a NEARBY low member
    if (focus && !focus.dead) { engage(b, focus, MELEE, T); continue; } // all DPS the SAME mob
    if (idleDest && b.dist(idleDest) > (idleDest.r ?? 8)) moveToward(b, idleDest); else b.input({});
  }
}
function attuneGrind(ctx, T, step) {
  const { leader } = ctx;
  const camp = step.camps.map((c) => ({ c, d: leader.self ? leader.dist(c) : 0 })).sort((a, b2) => a.d - b2.d)[0].c;
  const near = (m) => Math.hypot((m.x ?? 0) - camp.x, (m.z ?? 0) - camp.z) < (camp.r + 14);
  const anchor = leader.self ? leader.pos() : camp;
  const isQuestMob = (m) => !step.mob || m.tid === step.mob || (step.mobName && (m.nm ?? '').includes(step.mobName));
  const byNear = (a, b) => dist2(a, anchor) - dist2(b, anchor);
  const chooseFocus = (pool) => {
    const partyPids = new Set(ctx.bots.map((o) => o.self?.id ?? o.pid));
    const quest = pool.filter((m) => near(m) && isQuestMob(m));         // ONLY Boneclad Revenants (the shard droppers)
    const aggroAny = pool.filter((m) => partyPids.has(m.aggro));         // but defend against anything already on us
    return quest.filter((m) => partyPids.has(m.aggro)).sort(byNear)[0]   // a revenant already fighting us
        ?? quest.sort(byNear)[0]                                         // else the nearest revenant
        ?? aggroAny.sort(byNear)[0] ?? null;                             // else whatever is hitting us
  };
  attuneFight(ctx, T, chooseFocus, camp);
}
function dist2(m, p) { return Math.hypot((m.x ?? 0) - (p.x ?? 0), (m.z ?? 0) - (p.z ?? 0)); }
function _attuneAtObject(ctx, T, obj, sayKey, sayMsg) {
  // walk the party to a world object and INTERACT it (target it by tid in view first, else proximity). Defends
  // against anything that aggros. Used for the grave visions (q2) and the ritual circle (q4).
  const { bots, leader, now, state } = ctx;
  if (state[sayKey] !== `${obj.tid}`) { state[sayKey] = `${obj.tid}`; leaderSay(leader, sayMsg); }
  for (const b of bots) {
    if (!b.self || !b.connected) continue;
    if (b.self.dead) { attuneRunBack(b); continue; }
    const threat = b.hostiles().filter((m) => !m.dead && bots.some((o) => m.aggro === (o.self?.id ?? o.pid))).sort((x, y) => b.dist(x) - b.dist(y))[0];
    if (threat) { if (attuneOffHeal(ctx, b, T)) continue; engage(b, threat, ctx.MELEE, T); continue; }
    if (b.dist(obj) < 5) {
      const ent = [...b.ents.values()].find((e) => e.tid === obj.tid);
      if (ent && b.self.target !== ent.id) b.cmd({ cmd: 'target', id: ent.id });
      if (now - (b._iAt ?? 0) > 1300) { b.cmd({ cmd: 'interact' }); b._iAt = now; }
      b.input({});
    } else moveToward(b, obj);
  }
}
function attuneObjects(ctx, T, step) {
  // visit the 3 graves IN ORDER; advance when the leader's qlog count for that objective is satisfied.
  const { leader } = ctx;
  const q = (leader.self?.qlog ?? []).find((x) => x.questId === 'q_nythraxis_graves');
  const counts = q?.counts ?? [];
  let idx = step.objs.findIndex((_, i) => (counts[i] ?? 0) < 1);
  if (idx < 0) idx = step.objs.length - 1;
  const obj = step.objs[idx];
  _attuneAtObject(ctx, T, obj, '_attGrave', `visiting grave ${obj.tid.replace('grave_', '')} (${obj.x},${obj.z})`);
}
function attuneObjBoss(ctx, T, step) {
  // summon + kill the Bound Guardian at the ritual circle (needs crypt_keystone, carried from q3).
  const { bots } = ctx;
  const seen = new Map();
  for (const o of bots) if (o.self && !o.self.dead) for (const m of o.hostiles()) if (!m.dead && m.h) seen.set(m.id, m);
  const boss = [...seen.values()].find((m) => m.tid === step.boss || (step.bossName && (m.nm ?? '').includes(step.bossName)));
  if (boss) { attuneFight(ctx, T, () => boss, step.obj); return; }   // boss up -> kill it
  _attuneAtObject(ctx, T, step.obj, '_attCircle', `using the keystone at the ritual circle (${step.obj.x},${step.obj.z})`);
}
function attuneLeaveInstance(ctx) {
  const { bots, leader, now } = ctx;
  for (const b of bots) {
    if (!b.self || !b.connected) continue;
    if (b.self.dead) { attuneRunBack(b); continue; }
    if ((b.self.x ?? 0) < 500) { b.input({}); continue; }
    const exit = [...b.ents.values()].find((e) => e.tid === 'dungeon_exit');
    if (exit) { if (b.dist(exit) < 6) { if (now - (b._lAt ?? 0) > 1200) { b.cmd({ cmd: 'leave_dungeon' }); b._lAt = now; } b.input({}); } else moveToward(b, exit); }
    else moveToward(b, { x: b.self.x ?? 0, z: (b.self.z ?? 0) - 30 });   // exit out of view -> head toward the entry
  }
  leaderSay(leader, 'leaving the crypt to turn in at Aldric');
}
function attuneCrypt(ctx, T, step) {
  // q3: enter the Abandoned Crypt, then relic -> summoned elite -> loot keystone, x3. The relics + elites
  // are entities INSIDE the instance, so we navigate by entity (tid) in view, not fixed world coords.
  const { bots, leader, now, state } = ctx;
  const inside = (b) => (b.self?.x ?? 0) > 500;
  const aliveConn = bots.filter((b) => b.self && b.connected && !b.self.dead);
  // ENTER: if anyone alive is still outside, march everyone to the crypt door and zone in.
  if (!aliveConn.length || aliveConn.some((b) => !inside(b))) {
    if (state._attCrypt !== 'enter') { state._attCrypt = 'enter'; leaderSay(leader, `entering the Abandoned Crypt (${step.door.x},${step.door.z})`); }
    for (const b of bots) {
      if (!b.self || !b.connected) continue;
      if (b.self.dead) { attuneRunBack(b); continue; }
      if (inside(b)) { b.input({}); continue; }
      if (b.dist(step.door) < 7) { if (now - (b._eAt ?? 0) > 900) { b.cmd({ cmd: 'enter_dungeon', dungeon: step.dungeon }); b._eAt = now; } b.input({}); }
      else moveToward(b, step.door);
    }
    return;
  }
  // INSIDE: a summoned elite up? focus-fire it (this also covers its keystone auto-looting via lootSweep).
  const seen = new Map();
  for (const o of bots) if (o.self && !o.self.dead) for (const m of o.hostiles()) if (!m.dead && m.h) seen.set(m.id, m);
  const elite = [...seen.values()].filter((m) => bots.some((o) => m.aggro === (o.self?.id ?? o.pid)) || m.boss).sort((a, b) => dist2(a, leader.pos()) - dist2(b, leader.pos()))[0];
  if (elite) { if (state._attCrypt !== 'fight') { state._attCrypt = 'fight'; leaderSay(leader, `fighting ${elite.nm ?? 'the relic guardian'}`); } attuneFight(ctx, T, () => elite, null); return; }
  // no elite: go activate the next relic still present in view.
  const relic = [...leader.ents.values()].find((e) => (step.relics ?? []).includes(e.tid));
  if (relic) {
    if (state._attCrypt !== `relic:${relic.tid}`) { state._attCrypt = `relic:${relic.tid}`; leaderSay(leader, `activating relic ${relic.tid}`); }
    for (const b of bots) {
      if (!b.self || !b.connected) continue;
      if (b.self.dead) { attuneRunBack(b); continue; }
      if (attuneOffHeal(ctx, b, T)) continue;
      if (lootSweep(b, ctx.lootQueue, T)) continue;
      if (b.dist(relic) < 5) { if (b.self.target !== relic.id) b.cmd({ cmd: 'target', id: relic.id }); if (now - (b._iAt ?? 0) > 1500) { b.cmd({ cmd: 'interact' }); b._iAt = now; } b.input({}); }
      else moveToward(b, relic);
    }
    return;
  }
  // no relic + no elite visible: keystones likely all collected -> leave so we can turn in (allReady handles it).
  attuneLeaveInstance(ctx);
}
function attuneTick(ctx, T0) {
  const { bots, leader, now, state } = ctx;
  // EMERGENCY-ONLY off-heal thresholds for the no-dedicated-healer trio: only the paladin/shaman drop DPS
  // to heal when a member is genuinely low, so most ticks everyone is nuking and kills come fast.
  const T = { ...T0, healCrit: 0.4, healLow: 0.5, healTank: 0.55 };
  _attuneLogQuests(ctx);
  // GUEST players (e.g. swifter): manually controlled by the operator. The bots INVITE them by finding their
  // player entity in view and pinvite-ing it (pinvite is id-only), so the guest shares quest credit and gets
  // off-healed — but the brain NEVER issues movement/combat for a guest (it isn't in ctx.bots). The operator
  // logs the guest in and brings it near the party; the leader keeps re-inviting until it's a member.
  inviteGuests(ctx, T.guests ?? []);
  const conn = bots.filter((b) => b.self && b.connected);
  if (!conn.length) return;
  const partyDone = (qid) => conn.every((b) => (b.self.qdone ?? []).includes(qid));
  const stateOf = (b, qid) => (b.self.qlog ?? []).find((q) => q.questId === qid)?.state;
  const cur = ATTUNE_CHAIN.find((qid) => !partyDone(qid)) ?? null;
  // ATTUNED: quests 1-4 done. Scourge's End is in hand. Hold at Aldric.
  if (!cur) {
    if (!state._attuned) { state._attuned = true; partyLine(leader, "🎓 **ATTUNED!** Quests 1-4 of the Nythraxis attunement complete — Scourge's End is in hand. (The raid kill itself needs 10 players.)"); }
    attuneRegroup(ctx, ATTUNE_GIVER); return;
  }
  if (!state._attDbgAt || now - state._attDbgAt > 15000) {
    state._attDbgAt = now;
    const dbg = conn.map((b) => { const q = (b.self.qlog ?? []).find((x) => x.questId === cur); return `${b.charName}:${q ? (q.counts ?? []).join(',') + '(' + q.state + ')' : (b.self.qdone ?? []).includes(cur) ? 'done' : '—'}`; }).join('  ');
    partyLine(leader, `🔎 ${_attShort(cur)} — ${dbg}`);
  }
  const isReady = (b) => stateOf(b, cur) === 'ready' || (b.self.qdone ?? []).includes(cur);
  const hasIt = (b) => stateOf(b, cur) != null || (b.self.qdone ?? []).includes(cur);
  const allReady = conn.every(isReady);
  const anyMissing = conn.some((b) => !hasIt(b));   // someone hasn't ACCEPTED the current quest yet
  // SYNC at Aldric: go there if ANYONE is missing the quest (so the whole party is on the same one) OR
  // everyone's objectives are done (turn in together). Otherwise everyone has it active -> do the objective.
  if (allReady || anyMissing) {
    // if anyone is still INSIDE an instance (e.g. q3 finished in the crypt), LEAVE first — Aldric is outdoors.
    if (conn.some((b) => (b.self.x ?? 0) > 500)) { attuneLeaveInstance(ctx); return; }
    const verb = allReady ? 'turning in' : 'syncing/accepting';
    if (state._attStep !== `g:${cur}:${verb}`) { state._attStep = `g:${cur}:${verb}`; leaderSay(leader, `${verb} ${_attShort(cur)} at Aldric (-10,656)`); }
    for (const b of conn) {
      if (b.self.dead) { attuneRunBack(b); continue; }
      if (b.dist(ATTUNE_GIVER) < 5) { if (now - (b._iAt ?? 0) > 1200) { b.cmd({ cmd: 'interact' }); b._iAt = now; } b.input({}); }
      else moveToward(b, ATTUNE_GIVER);
    }
    return;
  }
  // OBJECTIVE in progress
  if (state._attStep !== `o:${cur}`) { state._attStep = `o:${cur}`; leaderSay(leader, `working ${_attShort(cur)} objectives`); }
  const step = ATTUNE_STEP[cur];
  if (step?.kind === 'grind') return attuneGrind(ctx, T, step);
  if (step?.kind === 'objects') return attuneObjects(ctx, T, step);
  if (step?.kind === 'crypt') return attuneCrypt(ctx, T, step);
  if (step?.kind === 'objboss') return attuneObjBoss(ctx, T, step);
  attuneRegroup(ctx, ATTUNE_GIVER);
}

export function tick(ctx) {
  const { bots, leader, tank, lootQueue, phase, arrived, CRYPT_DOOR, dungeon, HEAL_SPELL, OPENING_BUFF, MELEE, reBuff, now, state, grind } = ctx;
  const cfgQuestIds = new Set((ctx.questing?.hubs ?? []).flatMap((h) => (h.quests ?? []).map((q) => (typeof q === 'string' ? q : q.id))));
  const cfgQuestMinLvl = new Map((ctx.questing?.hubs ?? []).flatMap((h) => (h.quests ?? []).map((q) => (typeof q === 'string' ? [q, 1] : [q.id, q.minLevel ?? 1]))));
  // a class that CAN heal but is the TANK still tanks (holds aggro, melees, emergency-flees)
  // — only NON-tank heal-capable bots take the healer role (heal/kite/wand). Fixes paladin/
  // druid/shaman tanks that would otherwise kite away instead of holding the mob.
  const healerRole = (b) => b.isHealer() && b !== tank;
  // Per-config combat overrides: a party file may carry a `combat` block (e.g. a fragile 2-box
  // setting fleeHp:0.55, lvlCeil:1, pullManaFrac:0.4) that wins over the shared TUNABLES. Every
  // T.x read below — and the helpers that receive T — see the merged values. No `combat` → T===TUNABLES.
  const T = ctx.combat ? { ...TUNABLES, ...ctx.combat } : TUNABLES;
  // ATTUNEMENT mode (opt-in via combat.attune): run the q_nythraxis_* attunement questline (loot shards →
  // grave visions → crypt relics → bound guardian) as a self-contained state machine. Fully owns behavior
  // (movement, combat, interact, turn-in) and returns, so none of the farm/grind/dungeon logic runs.
  if (T.attune) { attuneTick(ctx, T); return; }
  // DUNGEON-RUN mode (opt-in via combat.dungeonRun): once we've zoned into the instance (phase
  // 'dungeon'), advance forward through the chambers ONE pull at a time to the bosses, instead of
  // camping the door. Gated so every other (non-dungeonRun) party behaves exactly as before.
  const DUNGEON_ID = dungeon?.id ?? 'hollow_crypt';
  const inDungeon = !!T.dungeonRun && phase === 'dungeon';
  // Capture the instance centre-line x (entry is at local x≈0 → world x = instance origin) on first
  // entry so we can advance straight up the middle (the chamber waists only leave a |x|<=5 gap).
  if (inDungeon) {
    if (state.dungeonCx == null && leader.self) { state.dungeonCx = leader.self.x; state.dungeonEntryZ = leader.self.z; }
  } else { state.dungeonCx = null; state.dungeonEntryZ = null; }
  // AVOID-MOBS (combat.avoidMobs): NEVER target these — matched against the wire templateId (`tid`) or
  // display name (`nm`), case-insensitive substring. e.g. ["ogre_crusher"] keeps a party ON Thornpeak
  // Ogres and OFF the adjacent Crusher ELITES it kept getting dragged into and wiping on. Empty/unset →
  // no exclusion, so every other party is unchanged.
  const AVOID = (T.avoidMobs ?? []).map((s) => String(s).toLowerCase());
  const isAvoided = (m) => AVOID.length > 0 && AVOID.some((a) => String(m.tid ?? '').toLowerCase().includes(a) || String(m.nm ?? '').toLowerCase().includes(a));
  // DUNGEON FARM: advance the clear->loot->leave->reform->enter reset machine (+ wipe detection) once per
  // tick, and log boss/overpull telemetry. farm is null for every non-farm party (no behavior change).
  const farm = T.dungeonFarm ? farmAdvancePhase(ctx, T, inDungeon) : null;
  if (farm && T.verbose && inDungeon) farmTelemetry(ctx, T, leader, bots, state);
  // Operator-controlled guest (ryzemage: water + a 4th DPS): keep inviting whenever it's in view and not yet a
  // member, so it's in the party before the muster zones in (the muster itself holds at the door for it).
  if (T.dungeonFarm) inviteGuests(ctx, farmGuestList(T));
  // PAUSE: flip `paused: true` (+save) to freeze the party in place — they stop attacking
  // and stand still (still logged in). Flip back to false to resume. Live, no relog.
  if (T.paused) { for (const b of bots) { if (b.self && b.connected) { b.cmd({ cmd: 'stopattack' }); b.input({}); } } return; }

  // (Whisper "logout" kill-switch lives in the ORCHESTRATOR — multibox.mjs — which can actually exit
  // the process; it logs out tank/leader-first. No duplicate handler here.)

  const lvl0 = leader.self.lv ?? 1;
  // DEATH-LOOP GUARD: if the party is dying repeatedly (too-hard camp / a deadly quest spot),
  // back off for a while — grind the SAFE ladder anchor (ignore quest co-locate) and only engage
  // mobs at or below our level. state.deaths is a rolling 10-min window of death timestamps.
  state.deaths = (state.deaths ?? []).filter((ts) => now - ts < 600000);
  // The grind death-loop backoff (retreat to an easier camp) is OPEN-WORLD logic — it must NOT fire inside
  // the dungeon farm (there is no "easier camp"; wipes are handled by the farm's own wipe-recovery).
  if (!T.dieFreely && !T.dungeonFarm && state.deaths.length >= (T.deathSpike ?? 6) && now >= (state.deathBackoffUntil ?? 0)) {
    state.deathBackoffUntil = now + (T.deathBackoffMs ?? 300000);
    const ptag = leader._ptag ? `${leader._ptag} ` : '';
    try { appendFileSync(leader._partyPath ?? 'logs/party.md', `- \`${_stamp()}\` ${ptag}⚠️ ${state.deaths.length} deaths/10m — backing off to the safe camp + easier mobs for ~5 min.\n`); } catch {}
  }
  const deathBackoff = !T.dungeonFarm && now < (state.deathBackoffUntil ?? 0);
  const ceil = deathBackoff ? Math.min(T.lvlCeil, 0) : T.lvlCeil; // during backoff, no +level pulls
  // Per-RUN grind anchor: the JSON config may carry its own `grind` block so a
  // second party can camp somewhere else WITHOUT touching the shared TUNABLES
  // (which the other running multibox hot-reloads from this same file). Absent →
  // fall back to TUNABLES, so existing configs behave exactly as before.
  // A seekCrypt party grinds `home` to level up (phase 'grind'); the moment it's ready and starts
  // travelling/clearing the dungeon (phase travel/dungeon) we STOP anchoring to a world camp, or the
  // travel-mode "walk back to HOME" logic would fight the march to the door / the in-instance advance.
  // Non-seekCrypt parties stay in 'grind' forever, so this never changes their behaviour.
  const GO_HOME = (grind?.goHome ?? T.goHome) && !(T.seekCrypt && phase !== 'grind');
  let HOME = grind?.home ?? T.home;
  let HOME_RADIUS = grind?.homeRadius ?? T.homeRadius;
  // Optional LEVEL LADDER: pick the highest-level step the leader has reached, so
  // the party migrates camps as it dings (wolves L1 → boars L2 → …). Steps are
  // [{ level, home:{x,z}, radius, label }]; the highest `level <= leaderLevel` wins.
  if (grind?.ladder?.length) {
    // a rung needs the LEADER at its `level`, AND (optional) the WEAKEST member at its `minMember` — so a
    // harder camp (stalkers) isn't entered until the under-leveled DPS can survive it too, not just the tank.
    const minLv = Math.min(...bots.filter((b) => b.self).map((b) => b.self.lv ?? 1));
    const step = grind.ladder
      .filter((s) => (s.level ?? 1) <= lvl0 && minLv >= (s.minMember ?? 0))
      .sort((a, b) => (a.level ?? 1) - (b.level ?? 1))
      .pop() ?? grind.ladder[0];
    HOME = step.home;
    if (step.radius != null) HOME_RADIUS = step.radius;
    if (state && state.campLabel !== step.label && !T.dungeonFarm) { // announce a camp change once, on ding (not in the farm — irrelevant noise there)
      state.campLabel = step.label;
      const where = step.label ?? `(${step.home.x}, ${step.home.z})`;
      const ptag = leader._ptag ? `${leader._ptag} ` : '';
      try { appendFileSync(leader._partyPath ?? 'logs/party.md', `- \`${_stamp()}\` ${ptag}🗺️ L${lvl0}: grind moves to **${where}**\n`); } catch {}
    }
  }

  // ---- live gear/gold/loot inspector (no relog) ----
  // Flip `dumpGear:true` in TUNABLES and save → every bot writes its money + equipped gear
  // + bags to its own journal, plus a side-by-side LOOT TABLE to party.md so you can COMPARE
  // the five at a glance. Flip back to false (save) to silence. self.copper is the live total.
  if (T.dumpGear && !_gearDumped) {
    _gearDumped = true;
    const money = (c) => `${Math.floor((c || 0) / 10000)}g ${Math.floor(((c || 0) % 10000) / 100)}s ${(c || 0) % 100}c`;
    const rows = [];
    for (const b of bots) {
      if (!b.self) continue;
      const bags = (b.self.inv ?? []).map((it) => `${it.itemId ?? it.id ?? it}${(it.count ?? 1) > 1 ? '×' + it.count : ''}`).join(', ') || '(empty)';
      b.journal(`🧰 GEAR — ${money(b.self.copper)} · ${b.kills} kills · equip ${JSON.stringify(b.self.equip ?? null)} · bags: ${bags}`);
      rows.push(`${(b.charName + ' (' + b.cls + ')').padEnd(20)} L${b.self.lv ?? '?'}  ${money(b.self.copper).padEnd(13)} ${String(b.kills).padStart(4)} kills · ${(b.self.inv ?? []).length} bag items`);
    }
    try { appendFileSync(leader._partyPath ?? 'logs/party.md', `- \`${_stamp()}\` 🧰 **LOOT TABLE** (compare the party)\n${rows.map((r) => '    ' + r).join('\n')}\n`); } catch {}
  } else if (!T.dumpGear) { _gearDumped = false; }
  // ---- QUEST-DRIVEN GRIND: "finish quests by default" ----
  // hub.quests entries may be { id, spot:{x,z,r} } (or bare "id"). If we have an ACTIVE quest with a
  // spot, steer HOME to THAT mob's camp so the party grinds to complete it (overrides the level
  // ladder). When no quest is in progress, HOME falls back to the ladder/home for free-grind.
  let qHub = null, questGrindId = null;
  if (ctx.questing) {
    const Q = ctx.questing;
    const hubs = Q.hubs ?? [{ maxLevel: 99, givers: Q.givers ?? (Q.giver ? [Q.giver] : []), quests: Q.quests ?? [], label: Q.label }];
    qHub = hubs.find((h) => lvl0 <= (h.maxLevel ?? 99)) ?? hubs[hubs.length - 1];
    const hq = (qHub?.quests ?? []).map((q) => (typeof q === 'string' ? { id: q } : q)); // qHub can be null when questing is off
    // active quests across the WHOLE party (not just the leader) — so a follower's in-progress quest
    // (e.g. Shims still collecting widow sacs while the leader's copy is already done) still steers the
    // camp, and a camp serving BOTH bots' quests wins on coverage. Keeps both members progressing.
    const active = new Set(bots.flatMap((bb) => (bb.self?.qlog ?? []).filter((q) => q.state === 'active').map((q) => q.questId)));
    // CO-LOCATE: grind the camp that satisfies the MOST active quests at once (e.g. snapper
    // camp covers q_deepfen + q_deepfen_purge + q_idols), instead of bouncing between spots.
    // steer only to spots of quests we're ELIGIBLE for — the giver may auto-hand a quest whose
    // content allows it (e.g. q_greyjaw) but whose target is a rare/elite we configured to defer
    // via minLevel; don't drag a low party to that camp until it's leveled up.
    // DEATH-AVOID: a camp that's WIPED us deathAvoidCap+ times recently is a death-trap for this duo.
    const deadly = (k) => (state.campDeaths?.[k] ?? []).filter((t) => now - t < (T.deathAvoidWindow ?? 300000)).length >= (T.deathAvoidCap ?? 3);
    const activeSpotsAll = hq.filter((q) => q.spot && active.has(q.id) && lvl0 >= (q.minLevel ?? 1));
    // skip death-trap camps entirely. If EVERY active-quest camp is deadly, activeSpots goes empty and we
    // fall through to the (sparser, lower-level) ladder grind instead of ping-ponging between killers and
    // wiping over and over — better slow-but-alive than a death spiral of graveyard runbacks.
    const activeSpots = activeSpotsAll.filter((q) => !deadly(`${q.spot.x},${q.spot.z}`));
    if (activeSpotsAll.length && !activeSpots.length && state.allCampsDeadlyAt !== Math.floor(now / 60000)) {
      state.allCampsDeadlyAt = Math.floor(now / 60000);
      try { appendFileSync(leader._partyPath ?? 'logs/party.md', `- \`${_stamp()}\` ${leader._ptag ? leader._ptag + ' ' : ''}⚠️ all quest camps are death-traps — falling back to safer ladder mobs\n`); } catch {}
    }
    if (activeSpots.length && !deathBackoff && !T.forceLadder) { // forceLadder: stay on the level-gated ladder camp, don't let quests yank HOME around the zone
      const byKey = new Map(); // "x,z" → list of active quests sharing that spot
      for (const q of activeSpots) { const k = `${q.spot.x},${q.spot.z}`; (byKey.get(k) ?? byKey.set(k, []).get(k)).push(q); }
      // CAMP CHOICE — distance-aware + COMMITMENT, robust to tick-level qlog flicker:
      //   1. rank camps by coverage (most active quests) then NEAREST to the party — never run across
      //      the map to a camp that covers no more than the one we're standing in.
      //   2. COMMIT: once we pick a camp, stay until it genuinely runs dry (no active quest there for
      //      >6s — rides out the qlog briefly dropping a quest for a tick) OR another camp covers
      //      STRICTLY MORE active quests. This kills the cross-map yank between two equal far-apart camps.
      const lpos = leader.pos();
      // activeSpots is already pre-filtered to exclude death-trap camps (see above), so byKey is clean.
      const keys = [...byKey.keys()];
      const distK = (k) => { const sp = byKey.get(k)[0].spot; return Math.hypot(sp.x - lpos.x, sp.z - lpos.z); };
      keys.sort((a, b) => (byKey.get(b).length - byKey.get(a).length) || (distK(a) - distK(b)));
      const topKey = keys[0] ?? [...byKey.keys()][0];
      // hold the committed camp only if it's still live AND not now flagged deadly (a deadly committed
      // camp must be abandoned, not clung to — that was the death loop).
      const curUsable = state.curCampKey != null && byKey.has(state.curCampKey) && !deadly(state.curCampKey) && keys.includes(state.curCampKey);
      if (curUsable) state.curCampSeenAt = now;
      const curDry = now - (state.curCampSeenAt ?? 0) > 6000;
      const curCov = curUsable ? byKey.get(state.curCampKey).length : 0;
      let chosenKey, chosenSpot;
      if (curUsable && state.curCampSpot && !curDry && byKey.get(topKey).length <= curCov) {
        chosenKey = state.curCampKey; chosenSpot = state.curCampSpot;           // hold the committed camp
      } else {
        chosenKey = topKey; chosenSpot = byKey.get(topKey)[0].spot;             // (re)commit to the best camp
        if (chosenKey !== state.curCampKey) { state.curCampKey = chosenKey; state.curCampSeenAt = now; }
      }
      state.curCampSpot = chosenSpot;
      const best = byKey.get(chosenKey) ?? [{ id: chosenKey, spot: chosenSpot }];
      const cur = best[0];
      HOME = chosenSpot; if (chosenSpot.r != null) HOME_RADIUS = chosenSpot.r;
      questGrindId = best.length > 1 ? `${best.length} quests` : cur.id;
      if (state && state.questGrindId !== questGrindId) {
        state.questGrindId = questGrindId;
        const names = best.map((q) => q.id).join(' + ');
        leaderSay(leader, `working on ${names}`);
        try { appendFileSync(leader._partyPath ?? 'logs/party.md', `- \`${_stamp()}\` ${leader._ptag ? leader._ptag + ' ' : ''}🎯 now working on **${names}** — grinding (${cur.spot.x}, ${cur.spot.z})\n`); } catch {}
      }
    }
  }

  // TIGHTEN the camp: cap the grind radius so the party hugs the camp centre instead of sprawling out
  // toward hazards (e.g. the lake edge at the drowned camp). Keeps holds/patrol/anchors close & on dry land.
  if (T.campRadiusMax != null) HOME_RADIUS = Math.min(HOME_RADIUS, T.campRadiusMax);
  // expose the ACTUAL resolved anchor (ladder step or quest spot) so the orchestrator's
  // status line measures distance to where we're really going — not the static TUNABLES.home.
  if (state) { state.homePt = HOME; state.homeRadius = HOME_RADIUS; }

  // pullTravel's narrow radius is ONLY for marching to the crypt. A normal grind is always
  // 'at' its camp, so use the wide pullGrind radius — otherwise it stands at the camp ignoring
  // mobs >14y away and only fights ones that happen to wander right up to it.
  // T.pullRadius lets a duo cap how far the tank ranges for a pull, so it stays NEAR the healer
  // (a tank that runs 60y to a stalker leaves the healer behind → no heals). Else the usual wide grind radius.
  const pullR = T.pullRadius ?? ((arrived || !T.seekCrypt) ? T.pullGrind : T.pullTravel);
  const _cands = leader.hostiles().filter((m) => {
    const dl = (m.lv ?? lvl0) - lvl0;
    const anchored = inDungeon
      ? true                                                  // inside the instance: the pullR check below is the only gate (no world-camp/door anchor)
      : GO_HOME
      ? Math.hypot((m.x ?? 0) - HOME.x, (m.z ?? 0) - HOME.z) < HOME_RADIUS
      : (!T.seekCrypt || !arrived || Math.hypot((m.x ?? 0) - CRYPT_DOOR.x, (m.z ?? 0) - CRYPT_DOOR.z) < T.anchorMobDist);
    return dl >= T.lvlFloor && dl <= ceil && leader.dist(m) < pullR && anchored && !isAvoided(m);
  });
  // SINGLE-PULL (T.pullIsolation yd): prefer the candidate with the FEWEST other mobs within that
  // radius (so we don't drag a whole pack — deadly when soloing), then by distance. Isolated mobs
  // (zero neighbours) naturally sort first. Off (0/undefined) → plain nearest, as before.
  // ALREADY being attacked → FIGHT BACK (don't passively stand and die). This bypasses the swarm
  // guard: the guard's job is to avoid PROACTIVELY pulling into a pack, not to make us ignore a mob
  // that's already on us.
  const _attacker = _cands.filter((m) => m.aggro === leader.pid).sort((a, b) => leader.dist(a) - leader.dist(b))[0];
  // PEEL — the tank's #1 job in a group is to PULL MOBS OFF THE HEALER. Any hostile aggroed on a NON-TANK
  // party member (the healer, who draws threat from heals + Smite) is grabbed FIRST, overriding the
  // focus-lock: a mob chewing the healer matters more than finishing the current ogre. The tank targets it
  // and the threat rotation (taunt is instant + ranged, then thunder-clap AoE) yanks it over. Range-bounded
  // to pullR so we don't sprint across the zone.
  const _memberPids = new Set((leader.self.party?.members ?? []).map((m) => m.pid).filter((pid) => pid !== leader.pid));
  const _peel = leader.hostiles()
    .filter((m) => !m.dead && m.aggro != null && _memberPids.has(m.aggro) && leader.dist(m) < pullR && !isAvoided(m))
    .sort((a, b) => leader.dist(a) - leader.dist(b))[0];
  let ltarget;
  // FOCUS-LOCK: keep hammering the SAME mob until it's dead, THEN switch. Concentrating the whole
  // party's damage on one target kills it fast (one fewer mob hitting us each time), instead of
  // re-picking "nearest/most-isolated" every tick and spreading hits so NOTHING dies while 5 mobs
  // chew on the tank. The lock only holds a mob still in range/alive; once it drops we pick the next.
  const _locked = state.focusId != null ? _cands.find((m) => m.id === state.focusId && !m.dead) : null;
  if (_peel) ltarget = _peel;                                   // PEEL FIRST — rip the mob off the healer (overrides focus-lock)
  else if (_locked) ltarget = _locked;
  else if (_attacker) ltarget = _attacker;                      // fresh fight → hit whoever's already on us
  else if (!_cands.length) ltarget = undefined;
  // PULL THE NEAREST (edge) mob — approaching from outside the camp, the closest one is on the rim, so
  // we don't walk THROUGH the pack to reach a deep "isolated" one (that was aggroing the whole cluster).
  // Grab the closest, kill it, step in for the next; the swarm-reset sheds any adds proximity pulls.
  else if (T.pullIsolation) {
    // SINGLE-PULL: prefer the candidate with the FEWEST other hostiles within pullIsolation yds (the most
    // isolated mob / linked pair), tie-break by distance — so we peel one off the room instead of
    // body-pulling a whole pack (deadly when 2-boxing L19-20 elites).
    const hs = leader.hostiles();
    const neigh = (m) => hs.filter((o) => o !== m && !o.dead && Math.hypot((o.x ?? 0) - (m.x ?? 0), (o.z ?? 0) - (m.z ?? 0)) < T.pullIsolation).length;
    ltarget = _cands.map((m) => ({ m, n: neigh(m), d: leader.dist(m) })).sort((a, b) => (a.n - b.n) || (a.d - b.d))[0]?.m;
  }
  else ltarget = _cands.sort((a, b) => leader.dist(a) - leader.dist(b))[0];
  state.focusId = ltarget?.id ?? null;                          // lock onto this target until it dies
  // VERBOSE COMBAT TELEMETRY (XPM tuning): announce the FOCUS target on every switch, and when a mob dies
  // report total damage done + time-to-kill + effective party DPS (derived from the focus mob's HP delta —
  // the server sends no per-hit numbers, so we measure the bar dropping). Logged on the leader's journal.
  if (T.verbose) {
    const fid = ltarget?.id ?? null;
    state._dps ??= { id: null };
    if (fid !== state._dps.id) {
      if (state._dps.id != null && state._dps.hp0 != null) {       // previous focus ended — report its kill
        const prev = leader.ents.get(state._dps.id);
        const died = !prev || prev.dead || (prev.hp ?? 0) <= 0;    // gone from view / dead → credit it to 0 HP
        const endHp = died ? 0 : (prev.hp ?? state._dps.lastHp ?? 0);
        const dt = Math.max(0.1, (now - state._dps.t0) / 1000);
        const dmg = (state._dps.hp0 ?? 0) - endHp;
        if (dmg > 0) leader.journal(`💥 ${state._dps.name ?? 'mob'} — ${Math.round(dmg)} dmg in ${dt.toFixed(1)}s (~${Math.round(dmg / dt)} dps party)${died ? ' ☠' : ' (switched)'}`);
      }
      state._dps = { id: fid, name: ltarget?.nm, hp0: ltarget?.hp ?? null, lastHp: ltarget?.hp ?? null, t0: now };
      if (ltarget) leader.journal(`🎯 FOCUS ${ltarget.nm ?? 'mob'} ${ltarget.hp}/${ltarget.mhp} (${Math.round((ltarget.hp / ltarget.mhp) * 100)}%) @${Math.round(leader.dist(ltarget))}y`);
    } else if (ltarget) {
      state._dps.lastHp = ltarget.hp;                              // track the bar dropping
    }
  }
  // ANTI-STARVATION: no lvlCeil-eligible target for a while (camp farmed out, OR every nearby mob is
  // ABOVE the ceiling — e.g. an L7 party at an L8-9 camp with lvlCeil 1) → stop idling at the camp
  // centre and engage the nearest ANCHORED mob regardless of level, rather than "waiting for the pack
  // to respawn" forever. lvlCeil is still respected until we've actually been starved this long.
  // Only ever engage mobs ANCHORED to HOME (the best camp — co-locate already picks it from active
  // quests + level). When HOME is dry we DON'T chase far/low mobs (that drift was grinding grey murlocs
  // 200y from camp); instead we patrol HOME for respawns + walk back if we've drifted (below). Just
  // track how long we've been targetless so the patrol can kick in.
  if (!ltarget) { if (!state.starvedSince) state.starvedSince = now; }
  else state.starvedSince = 0;

  // ---- QUESTS (only when this party's config sets `questing`) ----
  // hubs: [{ maxLevel, givers:[{x,z}], quests:[...] , label }]  (or shorthand { giver, quests }).
  // Pick the hub for the party's level; when a quest is READY (complete) or none are active yet,
  // the whole party walks to the questgiver(s) and `interact`s — the sim auto-accepts available
  // quests and auto-turns-in ready ones. Kills already happen via the grind, so this is pure bonus XP.
  let questRun = false, questGiver = null;
  if (qHub) {
    const hub = qHub;
    const givers = hub.givers ?? (hub.giver ? [hub.giver] : []);
    const qmeta = new Map((hub.quests ?? []).map((q) => (typeof q === 'string' ? [q, {}] : [q.id, q])));
    const qids = [...qmeta.keys()];
    // a quest below its configured minLevel can't be accepted yet — the server won't hand it over.
    // ...and one whose minLevel is more than `questGrey` BELOW us is trivial backtracking (a now-unified
    // L1→L20 hub holds every region's quests, so without this a fresh L13 char would trek back to the
    // start zone for L1 quests). Turn-ins of already-HELD quests are unaffected (this only gates accepts).
    const eligible = (qid) => { const ml = qmeta.get(qid)?.minLevel ?? 1; return lvl0 >= ml && lvl0 - ml <= (T.questGrey ?? 99); };
    // PARTY-WIDE decision (not just the leader): if ANY member has a ready quest to turn in, or ANY
    // member still needs to accept a configured quest, do a quest run so everyone — healers included —
    // visits the giver and gets its own credit. (Leader-only meant healers never accepted once the
    // leader had everything → they never finished quests.)
    const party = bots.filter((b) => b.self && b.connected);
    // BATCH turn-ins: don't round-trip to the giver for a single completion. The leader's ready
    // count drives it — go when >= turnInBatch are ready, OR one has been ready too long (so a lone
    // straggler still gets turned in). Accept-trips also clear ready quests, so this just avoids churn.
    const readyCount = (leader.self.qlog ?? []).filter((q) => q.state === 'ready').length;
    if (readyCount === 0) state.firstReadyAt = 0;
    else if (!state.firstReadyAt) state.firstReadyAt = Date.now();
    const anyReady = readyCount >= (T.turnInBatch ?? 2) || (readyCount >= 1 && Date.now() - (state.firstReadyAt || Date.now()) > (T.maxReadyWait ?? 60000));
    // only count quests we're ELIGIBLE for (level/prereq) — otherwise a low party walks to the
    // giver forever to accept quests the server keeps refusing, never settling to grind.
    const needIds = qids.filter((qid) => eligible(qid) && party.some((b) => {
      const act = new Set((b.self.qlog ?? []).map((q) => q.questId));
      const dn = new Set(b.self.qdone ?? []);
      return !act.has(qid) && !dn.has(qid);
    }));
    const needCount = needIds.length;
    const needAccept = needCount > 0;
    // ANTI-THRASH: if the un-accepted set hasn't shrunk in 90s at the SAME level, the
    // remaining quests are level/prereq-gated — stop walking to the giver (it can't take
    // them) until we accept something new or ding (either resets the timer). Without this
    // a low party ping-pongs "picking up quests" ↔ camp forever and never settles to grind.
    if (state.qNeedSeen !== needCount || state.qNeedLevel !== lvl0) { state.qNeedSeen = needCount; state.qNeedLevel = lvl0; state.qNeedSince = Date.now(); }
    // gate giver-trips after 90s of no progress (anti-thrash for genuinely level/prereq-gated quests),
    // BUT re-open a ~45s RETRY window every 2 min — so an ACCEPTABLE quest we simply hadn't reached yet
    // (e.g. a far questgiver across a couple deaths) gets another shot instead of deadlocking forever.
    const gatedFor = Date.now() - (state.qNeedSince ?? Date.now());
    const acceptGated = gatedFor > 90000 && (gatedFor % 120000) >= 45000;
    // The gate is BYPASSED whenever there's no active quest being grinded (questGrindId null) — i.e.
    // we're between tiers just grinding ladder filler. In that case going to accept eligible quests is
    // strictly better than grinding, so commit to the giver trip (the gate only matters mid-quest, to
    // avoid thrashing off a camp we're actively clearing). This is what un-stuck the L7→L8 transition:
    // it would grind snappers forever instead of walking to warden_fenwick to pick up q_deepfen.
    // forceLadder parties STAY ON THE CAMP AND GRIND — they do NOT run to the giver to PICK UP new quests
    // (operator: "no more picking up quests"). Kill-credit still accrues; ready quests still get turned in.
    const acceptOk = !T.forceLadder && needAccept && Date.now() > (state.qAcceptCd ?? 0) && (!acceptGated || !questGrindId);
    questRun = givers.length > 0 && (anyReady || acceptOk);
    // STAY ON THE CAMP AND GRIND — only check the giver ONCE IN A WHILE, not every cycle. After a giver
    // trip we suppress the next for questTripEvery (grind through it), UNLESS a big turn-in batch is ready.
    // Stops the "running across the zone half the time" between every pull. (state.lastQuestTripAt is
    // stamped when we actually reach a giver, below.)
    if (T.questTripEvery && now - (state.lastQuestTripAt ?? 0) < T.questTripEvery && readyCount < (T.turnInBatch ?? 2)) questRun = false;
    // NEVER leave for a giver trip MID-FIGHT. If any member is in active combat (a mob aggroed on the
    // party within ~18y), finish it FIRST — otherwise the healer walks off to the giver while the tank
    // is holding a pack, the tank goes unhealed, and dies (the 127y-apart deaths). Giver trips happen
    // BETWEEN pulls, together. Combat clears → questRun re-enables next tick.
    const partyInCombat = bots.some((bb) => bb.self && !bb.self.dead && bb.hostiles().some((m) => m.aggro != null && bots.some((o) => o.self && m.aggro === (o.self.id ?? o.pid)) && bb.dist(m) < 18));
    if (partyInCombat) questRun = false;
    // STUCK-BREAKER: never loop AT the giver forever. Only counts time spent ACTUALLY AT a giver
    // (<12y) and still not completing — a livelock (clustered NPCs, can't turn in). TRAVEL to a far
    // giver is NOT stuck, so it no longer trips the breaker before arriving (that was stranding the
    // L8 party 85y from warden_fenwick: the walk took >45s → false "stuck" → it never reached the giver).
    if (questRun && givers.some((g) => leader.dist(g) < 12)) {
      state.lastQuestTripAt = now;                          // reached the giver → start the grind cooldown before the next trip
      if (!state.qRunSince) state.qRunSince = Date.now();
      if (Date.now() - state.qRunSince > 30000) { questRun = false; state.qRunSince = 0; state.qStuckUntil = Date.now() + 60000; }
    } else state.qRunSince = 0;
    if (state.qStuckUntil && Date.now() < state.qStuckUntil) questRun = false;
    if (questRun) {
      // GO TO THE RIGHT NPC: target only the giver(s) that handle our pending work — quests we
      // still need to accept, plus any READY quest's turn-in NPC — instead of sweeping all givers.
      // Needs per-quest `giver:{x,z}` in config; falls back to all hub givers when absent (zone-2).
      const readyIds = new Set(party.flatMap((b) => (b.self.qlog ?? []).filter((q) => q.state === 'ready').map((q) => q.questId)));
      const ring = [], seenPt = new Set();
      for (const qid of [...needIds, ...readyIds]) {
        const g = qmeta.get(qid)?.giver; if (!g) continue;
        const k = `${g.x},${g.z}`; if (seenPt.has(k)) continue; seenPt.add(k); ring.push(g);
      }
      if (!ring.length) ring.push(...givers);
      state.qGi = (state.qGi ?? 0) % ring.length;
      questGiver = ring[state.qGi];
      // dwell ~4.5s once the leader is NEAR the giver (≈6 interacts → turn in + accept all), then
      // ROTATE to the next giver. 6.5y (was 3.5) — the leader mills at ~4.5y near a giver, so the
      // tight gate kept resetting the dwell counter → it never rotated to the 2nd NPC (e.g.
      // provisioner_hale), so quests turned in only there (q_prowler_pelts) stuck "ready" forever.
      if (leader.dist(questGiver) < 6.5) {
        state.qDwell = (state.qDwell ?? 0) + 1;
        if (state.qDwell > 40) { state.qDwell = 0; state.qGi = (state.qGi + 1) % ring.length; if (state.qGi === 0) state.qAcceptCd = Date.now() + 15000; }
      } else state.qDwell = 0;
      leaderSay(leader, anyReady ? 'turning in quests at the questgiver' : 'picking up quests');
    }
  }

  // bound the loot queue (corpses now linger until everyone loots them, or they despawn)
  while (lootQueue.size > 40) lootQueue.delete(lootQueue.keys().next().value);

  // ---- PULL COORDINATION: a RANGED bot pulls, the TANK Charges in and peels the mob OFF the
  // puller, and everyone else holds until the tank has aggro. The warrior can't pull at range, so
  // letting it melee-pull dragged whole packs; now one mob comes at a time and threat is set first.
  // Mobs expose `.aggro` (their current target's id) on the wire, so we can see who actually holds it.
  const RANGED_PULL = new Set(['hunter', 'mage', 'warlock']);
  const tankId = tank.self?.id ?? tank.pid;
  // designated puller: a living ranged DPS (not the tank, not a healer) — the HUNTER in the farm. It pulls
  // ONE mob from max range (so only that mob aggros, never the pack = no overpull), then HOLDS so the tank
  // TAUNTS it off. This works now that the warrior's threat (Bloodrage/Sunder/Taunt + the threat-lead) holds.
  const puller = bots.find((b) => b.connected && b.self && !b.self.dead && !b.isHealer() && b !== tank && RANGED_PULL.has(b.cls)) ?? null;
  const focus = ltarget;                                  // the one mob we kill this pull (nearest eligible)
  const aggroOn = (m, b) => !!m && m.aggro != null && m.aggro === (b?.self?.id ?? b?.pid);
  const tankOnFocus = aggroOn(focus, tank);               // tank has threat → safe for DPS to open up
  // THREAT-LEAD GATE (farm): track how long the tank has actually held the focus, so the DPS wait a beat
  // and let the warrior build a threat LEAD before they pile on — otherwise their damage + the heals
  // instantly out-threat a cold (rage-starved) tank and rip the mob onto a squishy (the core wipe cause).
  if (tankOnFocus && state._tankHoldId === focus?.id) { /* still holding */ }
  else if (tankOnFocus) { state._tankHoldId = focus?.id; state._tankHoldSince = now; }
  else { state._tankHoldId = null; state._tankHoldSince = 0; }
  const tankHasLead = tankOnFocus && now - (state._tankHoldSince ?? 0) > (T.threatLeadMs ?? 2500);
  const focusEngaged = !!focus && bots.some((b) => b.self && aggroOn(focus, b)); // mob already on someone
  // NO mana pull-gate (operator: "just die and run back") — dieFreely means no pacing/waiting for the
  // healer's mana; the party pulls regardless and wipes-and-regroups if the healer runs dry. Their call.
  const pullReady = !T.pullWhenReady || partyReady(bots, T, tank);

  for (const b of bots) {
    if (!b.self || !b.connected) continue;
    // LOOT ROLLS (farm): the warrior NEEDs everything, everyone else GREEDs — answered before the
    // dead-check so a bot can still roll on loot that dropped while it's corpse-running.
    if (T.dungeonFarm) answerLootRolls(b, leader);
    // farm off-tanks/DPS must not generate TANK-level threat (Consecration etc.) — only the warrior tanks.
    b._farmNoThreat = !!(T.dungeonFarm && b !== tank);
    // track XP from real 'xp' events; report each bot's gain every 5 min
    for (const ev of b.events) if (ev.type === 'xp' && (ev.pid === undefined || ev.pid === b.pid)) b.xpGained = (b.xpGained ?? 0) + (ev.amount ?? 0);
    if (b.xpAt === undefined) b.xpAt = Date.now();
    else if (Date.now() - b.xpAt > 60000) { const since = (b.xpGained ?? 0) - (b.xpLast ?? 0); b.xpLast = b.xpGained ?? 0; b.xpAt = Date.now(); b.journal(`📈 +${since} XP in 1m · run total ${b.xpGained ?? 0} · L${b.self.lv} ${b.self.xp ?? '?'}/${b.self.lxp ?? '?'}`); }
    // quest completions → party log + own journal (fires for whichever party is questing)
    const ptag = leader._ptag ? `${leader._ptag} ` : ''; // party tag for the consolidated log
    if (b.self.qdone) { b._qd ??= new Set(b.self.qdone); for (const qid of b.self.qdone) if (!b._qd.has(qid)) { b._qd.add(qid); b.journal(`✅ completed quest **${qid}**`); try { appendFileSync(leader._partyPath ?? 'logs/party.md', `- \`${_stamp()}\` ${ptag}✅ **${b.charName}** completed **${qid}**\n`); } catch {} } }
    // accept logging (mirrors completion): announce each NEW quest a bot picks up, so a
    // giver trip's outcome is visible. Seed from the current qlog on first sight so we
    // don't spam already-held quests on (re)connect — only genuinely new accepts log.
    if (b.self.qlog) { b._qa ??= new Set((b.self.qlog ?? []).map((q) => q.questId)); for (const q of (b.self.qlog ?? [])) { const qid = q.questId; if (qid && !b._qa.has(qid)) { b._qa.add(qid); b.journal(`📥 accepted quest **${qid}**`); try { appendFileSync(leader._partyPath ?? 'logs/party.md', `- \`${_stamp()}\` ${ptag}📥 **${b.charName}** accepted **${qid}**\n`); } catch {} } } }
    // AUTO-ABANDON: drop any active quest NOT in this config (removed like glowing_wax, or group/elite
    // ones the giver handed us like crushers/kazzix) — keeps the log clean and stops us co-locating to
    // a camp we can't solo. Gated on T.autoAbandon + a non-empty config quest set (never blind-drops).
    if (T.autoAbandon && cfgQuestIds.size && b.self.qlog) {
      b._qab ??= new Set();
      for (const q of b.self.qlog) {
        if (!q.questId || b._qab.has(q.questId)) continue;
        // DROP a quest if: (a) it's NOT in this config (un-progressable here — e.g. q_whispers/q_fenbridge_muster,
        // or group/elite ones the giver pushed on us), OR (b) it's gone GREY — its minLevel is way below us, so
        // it's a stale low-zone leftover we'll never backtrack to finish (e.g. q_spiders/q_boars at L8). Either
        // way it just clutters the log + can mislead the co-locate. (Turn-ins of READY quests still happen first.)
        const notInCfg = !cfgQuestIds.has(q.questId);
        const grey = cfgQuestMinLvl.has(q.questId) && (lvl0 - cfgQuestMinLvl.get(q.questId)) > (T.questGrey ?? 8) && q.state !== 'ready';
        if (notInCfg || grey) {
          b._qab.add(q.questId); b.cmd({ cmd: 'abandon', quest: q.questId });
          b.journal(`🗑️ abandoning **${q.questId}** (${notInCfg ? 'not in config' : 'grey / outleveled'}).`);
          try { appendFileSync(leader._partyPath ?? 'logs/party.md', `- \`${_stamp()}\` ${ptag}🗑️ **${b.charName}** abandoned **${q.questId}**\n`); } catch {}
        }
      }
    }
    // PERIODIC FULL QUEST LIST — so the operator can see exactly which quests each bot holds and
    // its progress. Per-bot throttle (60s). doing: active quests (counts), ready: complete + to turn in.
    if (!T.dungeonFarm && b.self.qlog && now - (b._qListAt ?? 0) > 60000) {
      b._qListAt = now;
      const fmt = (q) => `${q.questId.replace('q_', '')}${(q.counts ?? []).length ? ' (' + (q.counts ?? []).join('/') + ')' : ''}`;
      const doing = b.self.qlog.filter((q) => q.state === 'active').map(fmt);
      const ready = b.self.qlog.filter((q) => q.state === 'ready').map((q) => q.questId.replace('q_', ''));
      if (doing.length || ready.length) {
        const line = `📋 ${b.charName} quests — ${doing.length ? 'doing: ' + doing.join(', ') : ''}${doing.length && ready.length ? ' · ' : ''}${ready.length ? 'ready: ' + ready.join(', ') : ''}`;
        b.journal(line);
        try { appendFileSync(leader._partyPath ?? 'logs/party.md', `- \`${_stamp()}\` ${ptag}${line}\n`); } catch {}
      }
    }
    // QUEST PROGRESSION → party log (LEADER only, so a party doesn't log the same advance N times).
    // Objective counts come straight off the live qlog; log a count bump (throttled per quest so a
    // kill-streak doesn't spam) and the 'ready' milestone (objectives done → heading to turn in).
    if (!T.dungeonFarm && b === leader && b.self.qlog) {
      b._qprog ??= new Map();
      for (const q of b.self.qlog) {
        const sum = (q.counts ?? []).reduce((a, n) => a + (n || 0), 0);
        const prev = b._qprog.get(q.questId) ?? { sum: -1, ready: false, at: 0 };
        const nm = q.questId.replace('q_', '');
        if (q.state === 'ready' && !prev.ready) {
          try { appendFileSync(leader._partyPath ?? 'logs/party.md', `- \`${_stamp()}\` ${ptag}🎯 **${nm}** objectives complete — turning it in.\n`); } catch {}
        } else if (q.state === 'active' && sum > prev.sum && now - prev.at > 8000) {
          try { appendFileSync(leader._partyPath ?? 'logs/party.md', `- \`${_stamp()}\` ${ptag}🎯 **${nm}**: ${(q.counts ?? []).join('/')}\n`); } catch {} prev.at = now;
        }
        b._qprog.set(q.questId, { sum, ready: q.state === 'ready', at: prev.at });
      }
    }
    if (b.self.dead) { if (!b._deadEdge) { b._deadEdge = true; (state.deaths ??= []).push(now); const ck = state.curCampKey ?? 'none'; (state.campDeaths ??= {})[ck] = [...(state.campDeaths?.[ck] ?? []), now]; } b.cmd({ cmd: 'release' }); continue; }
    b._deadEdge = false;
    // LET CASTS FINISH: while a cast is in flight (e.g. a 2s Healing Wave), STAND STILL and issue nothing
    // else this tick. Moving — or re-issuing the cast — every tick cancels our own cast so the heal never
    // lands (the cast-spam self-interrupt). Hold until it completes. (dieFreely → we never abort to flee.)
    if (b.self.cast && (b.self.castRem ?? 0) > 0.05) { b.input({}); continue; }
    // PARTY CROSS-BUFFS (farm): in any LULL (no one hurt, nothing actively attacking us) the priest keeps
    // Power Word: Fortitude (+HP) and the paladin Blessing of Might (+AP) on every member — incl. anyone
    // who just rezzed and lost their buffs. Big survival win (more stamina = fewer deaths).
    if (T.dungeonFarm && PARTY_BUFFS[b.cls]) {
      const anyHurt = (b.self.party?.members ?? []).some((m) => !m.dead && m.mhp && m.hp / m.mhp < (T.healLow ?? 0.85));
      const inCombat = b.hostiles().some((m) => m.aggro != null && b.dist(m) < 16);
      if (!anyHurt && !inCombat && partyBuff(b, ctx, T)) continue;
    }
    // DUNGEON-FARM RESET PHASES (loot/leave/reform/enter) fully override normal behavior — loot the room,
    // walk out, disband+reform the party, re-enter. 'clear' falls through to the usual combat/advance.
    if (farm && farmDrive(b, ctx, T, farm, CRYPT_DOOR, DUNGEON_ID)) continue;
    // MARCH TO THE DUNGEON (no fighting en route): any bot seeking the dungeon that is still in the
    // OVERWORLD runs STRAIGHT to the door and zones in — it does NOT stop to fight mobs on the approach
    // (operator: "just form up and make their way into the instance"). Aggroed mobs leash off as we run;
    // combat only resumes once inside. Covers the initial approach AND a follower that hasn't zoned in yet
    // after the leader did (it stays gated on the bot's own overworld position, not the party phase).
    if (T.seekCrypt && (phase === 'travel' || phase === 'dungeon') && (b.self.x ?? 0) < 500) {
      try { b.cmd({ cmd: 'stopattack' }); } catch {}
      // priest mitigates ON THE MOVE with INSTANTS (no stopping): Renew the most-hurt member so nobody
      // bleeds out while we run the gauntlet. (Cast-time heals would cancel on the move; Renew is instant.)
      if (b.cls === 'priest' && b.offGcd() && (b.self.lv ?? 1) >= 8) {
        const hurt = (b.self.party?.members ?? []).filter((m) => !m.dead && m.hp / m.mhp < 0.7).sort((x, y) => x.hp / x.mhp - y.hp / y.mhp)[0];
        if (hurt) { if (b.self.target !== hurt.pid) b.cmd({ cmd: 'target', id: hurt.pid }); else b.cmd({ cmd: 'cast', ability: 'renew' }); }
      }
      // ROUTE UP THE CLEAR CENTRE LANE: the Sanctum Approach mobs cluster at x=+-40 (zealots/necromancers
      // east, revenants west) and the door is at (0,880); x~0 threads BETWEEN them. Get onto the centre
      // lane at a staging point just south of the mob band FIRST, then push straight north to the door,
      // instead of cutting diagonally through a pack. Then zone in when we reach the door.
      const STAGE = { x: 0, z: 812 };
      const dest = (b.self.z < STAGE.z - 4 || Math.abs(b.self.x ?? 0) > 14) ? STAGE : CRYPT_DOOR;
      if (b.dist(CRYPT_DOOR) < 7) { if (!(state._instBusyUntil && now < state._instBusyUntil) && now - (b._marchEnterAt ?? 0) > 1000) { b.cmd({ cmd: 'enter_dungeon', dungeon: DUNGEON_ID }); b._marchEnterAt = now; } b.input({}); }
      else moveToward(b, dest);
      continue;
    }
    // TRAVEL MODE: when the camp is FAR (relocating across the zone), RUN STRAIGHT TO IT — do NOT stop to
    // fight every mob en route (that's how a cross-zone move becomes a death-swarm). Just path; aggroed
    // mobs chase but leash off as we run. Combat resumes once we're near the camp. Skips while at a giver.
    if (GO_HOME && !questRun && leader.dist(HOME) > HOME_RADIUS + (T.travelBuffer ?? 35)) {
      try { b.cmd({ cmd: 'stopattack' }); } catch {}
      moveToward(b, b === leader ? HOME : followAnchor(b, leader.pos()));
      continue;
    }
    // periodic vitals to the live log (visible on the 8099 dashboard)
    if (Date.now() - (b.vitalsAt ?? 0) > (T.verbose ? 10000 : 60000)) { b.vitalsAt = Date.now(); const mp = b.self.mres ? ` mana ${Math.round((b.self.res ?? 0) / b.self.mres * 100)}%` : ` rage ${Math.round(b.self.res ?? 0)}`; b.journal(`📊 ${b.charName} ${b.self.hp}/${b.self.mhp} hp${mp} · ${b.kills} kills`); }
    if (!b._gearLogged && b.self.equip) { b._gearLogged = true; try { const eq = Object.entries(b.self.equip).filter(([,v])=>v).map(([k,v])=>`${k}:${typeof v==='object'?(v.itemId??v.id??v.name??JSON.stringify(v)):v}`).join(', '); const st = b.self.stats ? JSON.stringify(b.self.stats) : 'n/a'; b.journal(`🛡️ GEAR: ${eq||'(none)'}`); b.journal(`📈 STATS: ap=${b.self.ap ?? '?'} crit=${b.self.crit ?? '?'} weapon=${b.self.weapon ? JSON.stringify(b.self.weapon) : '?'} · ${st}`); } catch (e) { b.journal('gear-log err: '+e.message); } }
    // survival: low HP → break off and put distance between us and the nearest mob.
    // (regrouping on the leader just runs us back into the pack that's killing us.)
    // The TANK is exempt from the DPS fleeHp — it must hold aggro, so it only bails at the much
    // lower tankFleeHp emergency floor. A tank fleeing at 55% is what dumps the mob on the healer.
    const fleeAt = b === tank ? (T.tankFleeHp ?? 0.2) : T.fleeHp;
    // FLEE. With T.fleeToDisengage (opt-in, for solo/no-healer): once we drop below fleeAt we
    // COMMIT to disengaging, but only BACK OFF while a mob is ACTIVELY CHASING us (aggro on us) —
    // the instant it leashes off we stop where we are and WAIT TO HEAL (regen) to restHp, then
    // resume. No sprinting across the zone, no turning back at low HP into a re-kill.
    if (!healerRole(b) && !T.dieFreely) {
      if (T.fleeToDisengage) {
        if (b.hpFrac() < fleeAt) b._fleeing = true;
        if (b._fleeing) {
          const chasing = b.hostiles().filter((m) => m.aggro === b.pid && b.dist(m) < (T.disengageRange ?? 16)).sort((a, c) => b.dist(a) - b.dist(c));
          if (chasing.length) { b.cmd({ cmd: 'stopattack' }); b.input({ f: 1 }, b.faceTo(chasing[0]) + Math.PI); continue; } // chased → back off
          if (b.hpFrac() < (T.restHp ?? 0.7)) { b.cmd({ cmd: 'stopattack' }); b.input({}); continue; }                       // safe → wait to heal (regen in place)
          b._fleeing = false;                                                                                                 // healed → resume
        }
      } else if (b.hpFrac() < fleeAt) {
        b.cmd({ cmd: 'stopattack' });
        const threat = b.hostiles().sort((a, c) => b.dist(a) - b.dist(c))[0];
        b.input({ f: 1 }, threat ? b.faceTo(threat) + Math.PI : b.faceTo(leader.pos()));
        continue;
      }
    }
    // QUEST RUN — BEFORE the healer/heal logic so EVERY bot (priests + shaman included) walks to the
    // questgiver and interacts. Each member must interact for its OWN accept + turn-in credit, or
    // healers never finish quests. No combat at the giver, so preempting heals here is safe.
    if (questRun && questGiver) {
      // stand ON the target giver (≤2.5y) so it's unambiguously the NEAREST npc — otherwise
      // `interact` grabs a different NPC clustered nearby and the quest never turns in (livelock).
      if (b.dist(questGiver) < 2.5) { b.input({}); if (Date.now() - (b.qIa ?? 0) > 700) { b.cmd({ cmd: 'interact' }); b.qIa = Date.now(); } }
      else moveToward(b, questGiver);
      continue;
    }
    // healer self-preservation: a healer that face-tanks adds dies and wipes the group.
    // If a mob is on the healer while it's taking damage, step out of melee BEFORE healing.
    // SKIPPED in T.healerMelee mode — there the "healer" is a melee DPS that WANTS to be in the pack.
    if (healerRole(b) && !T.healerMelee) {
      // EMERGENCY SELF-HEAL — own HP critical: HEALING BEATS POSITIONING. Stand and cast NOW. The healer
      // died at 15 HP with 100% MANA because the panic-retreat AND the standoff "back away from the adjacent
      // mob" both `continue` the loop BEFORE reaching the heal — so a healer with a mob stuck on it kited
      // forever and never healed itself. A direct heal outpaces one stalker's melee; cast first, the tank's
      // threat rotation peels the add within a few ticks. This MUST come before any standoff/retreat below.
      if (b.hpFrac() < (T.healPanic ?? 0.45)) {
        b.cmd({ cmd: 'stopattack' });
        if (tryHeal(b, tank.pid, HEAL_SPELL, T)) continue;   // tryHeal picks SELF (the lowest member) → direct heal (skips renew < healCrit)
      }
      // HEALER STANDOFF: heal from RANGE (heal spells reach ~40y), staying ~15y back from the melee. A
      // cloth-ish healer that stands IN the pack takes adds, burns mana self-healing, goes OOM and DIES —
      // then the tank dies unhealed. So if ANY aggroed mob is within the standoff, step away from it before
      // anything else. The cast-finish guard above means this never interrupts an in-flight heal — it only
      // repositions between casts. We DON'T chase the giver mid-fight either (questRun is combat-gated).
      const tankD = b.dist(leader.pos());
      const HR = T.healRange ?? 30;
      // PRIORITY 1 — GLUE TO THE TANK. Per request: stand ON TOP of the tank and heal, do NOT wander. The
      // old leash (HR*0.8 = 24y) let the healer drift into SEPARATE mob packs and get bursted to death
      // (ryzeheal ran 30y into 2 ogres and died). Hard tank-leash: if more than healerLeash (~8y) from the
      // tank, the ONLY thing we do is close back to it. Nukes (30y) + heals (40y) easily reach the tank's
      // target from on top of him, so there is never a reason to leave his side.
      if (tankD > (T.healerLeash ?? 8)) { moveToward(b, leader.pos()); continue; }
      // PRIORITY 2 — only when comfortably in range, edge back from a mob right on top of us (bounded, so
      // we never drift out of heal range). Otherwise hold and heal.
      // GATED OFF in healerDps mode (per request: "they spend too much time running away — make them
      // attack mobs"). When the priest is a fighting DPS we DON'T back-pedal from an adjacent mob; we hold
      // and Smite/wand it (the healerDps block below). Emergency self-heal above still covers actual danger.
      const nearMob = b.hostiles().filter((m) => m.aggro != null).sort((a, c) => b.dist(a) - b.dist(c))[0];
      if (!T.healerDps && nearMob && b.dist(nearMob) < (T.healerStandoff ?? 10) && tankD < HR * 0.55) { b.cmd({ cmd: 'stopattack' }); b.input({ f: 1 }, b.faceTo(nearMob) + Math.PI); continue; }
    }
    // EVERY bot loots any in-range corpse it hasn't personally looted yet. Loot has PERSONAL
    // drops (quest items etc.) — each party member only gets their own copy if THEY loot it —
    // so all five must loot the same corpse. Drop it from the queue once everyone alive has.
    for (const [cid, c] of lootQueue) {
      if (b.dist(c) < T.lootGrab) {
        b._looted ??= new Set();
        if (!b._looted.has(cid)) { b.cmd({ cmd: 'loot', id: cid }); b._looted.add(cid); (c.by ??= new Set()).add(b.pid); }
        const alive = bots.filter((o) => o.connected && o.self && !o.self.dead);
        if (c.by && alive.length && alive.every((o) => c.by.has(o.pid))) lootQueue.delete(cid);
        break;
      }
    }
    // auto-equip newly looted gear (one new item per tick; server rejects anything not equippable for us)
    if (T.autoEquip && b.self.inv) { b.equipTried ??= new Set(); for (const it of b.self.inv) { const id = it.itemId ?? it.id ?? it; if (id && !b.equipTried.has(id)) { b.equipTried.add(id); b.cmd({ cmd: 'equip', item: id }); break; } } }
    // (re)cast a class buff ONLY when it's actually missing from self.auras — not on a blind 45s
    // timer. Most buffs last 30 min, so the old timer burned a GCD every 45s for nothing; now a
    // present buff is skipped and we only recast after death (auras cleared) or a first login.
    // A 5s per-ability retry guard avoids spamming a buff whose cast keeps getting rejected.
    const auraKinds = new Set((b.self.auras ?? []).map((a) => a.kind));
    b.buffTry ??= {};
    const need = (CLASS_BUFFS[b.cls] ?? [])
      .filter(([, lvl]) => (b.self.lv ?? 1) >= lvl)
      .map(([ab]) => ab)
      // Righteous Fury is the paladin's +threat TANK aura — only the actual tank should run it. On an
      // off-tank/DPS paladin it makes it out-threat the warrior and steal aggro (the farm "tanking: Pontius").
      .filter((ab) => !(ab === 'righteous_fury' && b !== tank))
      .filter((ab) => (!BUFF_AURA[ab] || !auraKinds.has(BUFF_AURA[ab])) && Date.now() - (b.buffTry[ab] ?? 0) > 5000);
    // BUFFS are 30-min out-of-combat maintenance — NEVER burn a GCD on them while we're hurt or a mob is
    // actively on us. The healer was casting Power Word: Fortitude at 33 HP instead of healing itself, then
    // dying. Refresh only when safe (HP high, nothing chewing on us).
    const _mobOnMe = b.hostiles().some((m) => m.aggro === b.pid && b.dist(m) < 14);
    if (need.length && b.offGcd() && b.hpFrac() > 0.7 && !_mobOnMe) {
      const ab = need[0]; b.buffTry[ab] = Date.now();
      b.cmd({ cmd: 'cast', ability: ab });
      b.journal(`✨ cast ${String(ab).replace(/_/g, ' ')}.`);
      continue;
    }
    // WATER BRIGADE (freeze-safe): turn the respawn lulls — already dead time — into real mana income,
    // WITHOUT ever drinking through a pull (the old freeze: it kept drinking while the tank pulled a mob
    // >18y away and just sat there looking AFK). Drink ONLY in a genuine lull: near the party, the tank
    // has no target, and NO hostile is within drinkSafeRadius of the leader OR me. The instant a pull
    // starts any of those flips true → we skip drinking and fall straight through to the rotation/wand,
    // so the nuke cadence is untouched. The mage tops up with the BEST water it carries (conjure_water
    // auto-makes the highest rank known: 288/672 mana, not the 76-mana sip).
    if (T.waterBrigade && MANA_CLASSES.has(b.cls)) {
      const nearParty = b.dist(leader.pos()) <= (T.follow ?? 5) + (T.drinkLeash ?? 22);
      const safeR = T.drinkSafeRadius ?? 30;
      const tankBusy = !!(tank?.self?.tid);                                              // tank has a target → combat live
      const mobNear = (leader.hostiles?.() ?? []).some((m) => !m.dead && leader.dist(m) < safeR)
        || b.hostiles().some((m) => !m.dead && b.dist(m) < safeR);                       // anything to fight near party/me
      if (nearParty && !tankBusy && !mobNear) {                                          // true respawn lull
        const mp = (b.self.res ?? 0) / Math.max(1, b.self.mres ?? 1);
        if (b.cls === 'mage' && waterCount(b) < (T.waterStock ?? 6) && b.offGcd()) { b.cmd({ cmd: 'cast', ability: 'conjure_water' }); continue; }
        if (mp < (T.drinkMana ?? 0.55)) { const d = bestDrink(b); if (d) { b.input({}); b.cmd({ cmd: 'use', item: d }); if ((b.drinkLogAt ?? 0) + 30000 < Date.now()) { b.drinkLogAt = Date.now(); b.journal('💧 drinking to restore mana.'); } continue; } }
      }
    }
    if (b !== tank && !T.healerMelee) {             // the tank tanks; only a non-tank healer heals/shields
      // Power Word: Shield removed from the rotation (per request) — GCDs go to real heals.
      // SKIPPED in T.healerMelee mode — Shims plays pure melee DPS (only an emergency tank-heal below).
      if (tryHeal(b, tank.pid, HEAL_SPELL, T)) continue;
    }
    if (healerRole(b) && T.healerMelee) {
      // MELEE-DPS + OFF-HEAL (per request): Shims is a MELEE DPS that off-heals when needed — runs into
      // melee on the tank's focus, swings + weaves shaman instants for damage, BUT if anyone's hurt he
      // throws a heal first (tank below healTank, anyone below healCrit), then back to melee. Not a
      // dedicated healer standing around; off-heal is the safety net, melee DPS is the job.
      const hurt = (b.self.party?.members ?? []).filter((m) => !m.dead)
        .filter((m) => m.hp / m.mhp < (m.pid === tank.pid ? (T.healTank ?? 0.6) : (T.healCrit ?? 0.35)))
        .sort((a, c) => a.hp / a.mhp - c.hp / c.mhp)[0];
      if (hurt && (b.self.res ?? 0) >= 30) {
        const he = b.ents.get(hurt.pid) ?? (hurt.pid === leader.pid ? leader.self : (hurt.pid === tank.pid ? tank.self : null));
        // CLOSE THE GAP FIRST — a heal cast on a target out of range does NOTHING (Shims sat 48y from the
        // tank casting heals that never landed → tank died unhealed). Move into heal range, then cast.
        if (he && b.dist(he) > (T.healRange ?? 30)) { moveToward(b, { x: he.x, z: he.z }); continue; }
        if (b.offGcd()) { if (b.self.target !== hurt.pid) b.cmd({ cmd: 'target', id: hurt.pid }); b.input({}); b.cmd({ cmd: 'cast', ability: HEAL_SPELL[b.cls] }); continue; }
      }
      const sid = ltarget?.id ?? leader.self.target;
      const mob = sid != null ? (b.ents.get(sid) ?? leader.ents.get(sid)) : null;
      if (mob && !mob.dead && mob.k === 'mob' && b.dist(leader.pos()) <= T.follow + 12) {
        if (b.self.target !== mob.id) b.cmd({ cmd: 'target', id: mob.id });
        if (b.dist(mob) > 4) { moveToward(b, { x: mob.x, z: mob.z }); continue; } // close to melee range
        b.input({}, b.faceTo(mob));
        b.cmd({ cmd: 'attack' });                  // melee swing on the tank's target
        if (b.offGcd()) rotate(b, mob, T);            // + shaman instants (earth/flame shock) in range
        continue;
      }
      // no focus to assist → stick near the leader (don't wander off)
      if (lootSweep(b, lootQueue, T)) continue;
      if (b.dist(leader.pos()) > T.follow) moveToward(b, followAnchor(b, leader.pos())); else holdIdle(b);
      continue;
    }
    // HUNTER PET — OFF-TANK an add (farm): swifter is the squishy puller, so its pet HOLDS THREAT on a LOOSE
    // mob (one that is on the hunter, or on a non-tank the tank hasn't grabbed yet) while the party focus-fires
    // the tank's target. Keep the pet in auto-taunt (hold) mode, then sic it on the add and taunt — refreshed
    // every ~3s or when the add changes — so the pet eats the extra mob and the hunter never gets chewed (the
    // "hunter dies first" wipe). NO pet (untamed) → this is a NO-OP; we never issue a pet command without a
    // live pet, so an un-tamed hunter behaves exactly as before.
    if (b.cls === 'hunter' && b !== tank) {
      const myId = b.self.id ?? b.pid;
      const myPets = [...b.ents.values()].filter((e) => e.own === myId);
      const livePet = myPets.find((e) => !e.dead);
      const deadPet = myPets.find((e) => e.dead);
      // REVIVE then DEFENSIVE: if the pet died (a wipe leaves swifter petless = the next pull kills him too),
      // bring it back, then keep it on DEFENSIVE so it engages mobs attacking the hunter/itself. Revive is
      // throttled (the corpse must still exist) and re-arms the mode/auto-taunt one-shots for the new pet.
      if (livePet) {
        b._hadPet = true;
        if (b._petMode !== 'defensive') { b.cmd({ cmd: 'pet_mode', mode: 'defensive' }); b._petMode = 'defensive'; } // set once
        if (!b._petHold) { b.cmd({ cmd: 'pet_auto_taunt', enabled: true }); b._petHold = true; } // hold-threat mode, set once
      } else if ((deadPet || b._hadPet) && now - (b._petReviveAt ?? 0) > 5000) {
        b._petReviveAt = now; b._petHold = false; b._petMode = null; // re-apply mode + hold once it's back up
        b.cmd({ cmd: 'pet_revive' });
        if (T.verbose) b.journal('🐾 reviving pet, then setting it defensive');
      }
      if (livePet) {
        const looseAdd = b.hostiles()
          .filter((m) => !m.dead && m.id !== (focus?.id) && (m.aggro === myId || (m.aggro != null && m.aggro !== tankId && bots.some((o) => o.self && (o.self.id ?? o.pid) === m.aggro))))
          .sort((a, c) => ((a.aggro === myId ? 0 : 1) - (c.aggro === myId ? 0 : 1)) || b.dist(a) - b.dist(c))[0];
        if (looseAdd && (b._petTgt !== looseAdd.id || now - (b._petAt ?? 0) > 3000)) {
          b._petTgt = looseAdd.id; b._petAt = now;
          if (b.self.target !== looseAdd.id) b.cmd({ cmd: 'target', id: looseAdd.id });
          b.cmd({ cmd: 'pet_attack' }); b.cmd({ cmd: 'pet_taunt' });
          if (T.verbose) b.journal(`🐾 sic pet → ${looseAdd.nm ?? 'add'} (off-tank; hunter holds range)`);
        }
      }
    }
    // RANGED-DPS SELF-DEFENSE: a squishy caster (mage) that gets chewed in melee dies (it was dying every
    // ~2 min). But it should NOT constantly RUN AWAY — it ROOTS approaching mobs (Frost Nova, L10+) and
    // keeps NUKING from where it stands. It only takes a short step back if a mob is actually in melee
    // range AND nova is on cooldown. Net: stays put and dps's, no silly fleeing.
    if (b !== tank && !healerRole(b) && RANGED_PULL.has(b.cls) && b.dist(leader.pos()) < (T.follow ?? 5) + 22) {
      const near = b.hostiles().filter((m) => m.aggro != null && b.dist(m) < (T.dpsPeel ?? 10)).sort((a, c) => b.dist(a) - b.dist(c))[0];
      if (near) {
        // root an approaching mob, then fall through and keep nuking (don't run)
        if (b.cls === 'mage' && (b.self.lv ?? 1) >= 10 && b.offGcd() && now - (b._novaAt ?? 0) > 11000) {
          if (b.self.target !== near.id) b.cmd({ cmd: 'target', id: near.id });
          b.cmd({ cmd: 'cast', ability: 'frost_nova' }); b._novaAt = now; continue;
        }
        // HUNTER kite: SLOW the mob that reached us (Wing Clip in melee, Concussive Shot at range) so it can't
        // stay glued to us; the step-back below then opens distance and the pet (above) is already peeling it.
        if (b.cls === 'hunter' && b.offGcd()) {
          const hlv = b.self.lv ?? 1;
          if (b.self.target !== near.id) b.cmd({ cmd: 'target', id: near.id });
          if (b.dist(near) < 6 && hlv >= 10) b.cmd({ cmd: 'cast', ability: 'wing_clip' });
          else if (hlv >= 8 && now - (b._concAt ?? 0) > 5000) { b.cmd({ cmd: 'cast', ability: 'concussive_shot' }); b._concAt = now; }
        }
        // only step back if a mob is genuinely in melee (would be hitting us) and we couldn't root it
        if (b.dist(near) < 6) { b.cmd({ cmd: 'stopattack' }); b.input({ f: 1 }, b.faceTo(near) + Math.PI); continue; }
      }
    }
    // DPS LEASH: a ranged DPS that's drifted far from the party (chasing a fleeing mob, or fleeing/regen-ing
    // while OOM) loses all its DPS and dies ALONE (the mage's d54-85y excursions). Pull it back to the tank
    // before engaging — it regens/nukes safely next to the group instead of wandering off.
    if (b !== tank && !healerRole(b) && b.dist(leader.pos()) > (T.dpsLeash ?? 30)) { b.cmd({ cmd: 'stopattack' }); moveToward(b, leader.pos()); continue; }
    if (healerRole(b)) {
      // nobody needs a heal this tick → contribute damage on the party's target. With mana to
      // spare, SMITE (real nuke); when LOW on mana, WAND — auto-attack is free and costs nothing,
      // so the priest keeps doing damage instead of standing idle while her mana regenerates.
      // Healing always preempts this (tryHeal above), and reaching here means everyone is ≥ healLow HP.
      if (T.healerDps) {
        const sid = ltarget?.id ?? leader.self.target;
        const mob = sid != null ? (b.ents.get(sid) ?? leader.ents.get(sid)) : null;
        const mp = (b.self.res ?? 0) / Math.max(1, b.self.mres ?? 1);
        const nuke = HEALER_NUKE[b.cls];
        const ranged = nuke && !MELEE.has(b.cls);                    // shaman/priest/druid → nuke from range
        const r = rangeFor(b.cls, MELEE);
        if (mob && !mob.dead && mob.k === 'mob' && b.dist(leader.pos()) <= T.follow + 8) {
          // contribute damage on the PARTY'S focus (the same mob the tank is on). Established threat first
          // (tankOnFocus) or the mob's already in combat with us — so we don't rip a fresh pull onto the healer.
          const safe = tankOnFocus || mob.aggro != null;
          if (ranged) {
            // RANGED healer: NEVER chase. The tank-leash above keeps us glued to the tank, and his target is
            // within nuke range from there. If the focus mob is somehow out of range, DO NOT run to it — that
            // is exactly what got the healer killed (it ran 30y into a separate ogre pack). Skip DPS this tick
            // and keep healing from the tank's side; the leash will hold position.
            if (b.dist(mob) > r.max) { continue; }
            if (b.self.target !== mob.id) b.cmd({ cmd: 'target', id: mob.id });
            b.input({}, b.faceTo(mob));
            // SHADOW-WEAVE DPS (XPM lever): instant Shadow Word: Pain DoT first — best damage-per-GCD (54 over
            // 18s) and being INSTANT it barely interrupts healing — applied once per new focus. Then Mind Blast
            // on its 8s CD when mana's healthy (the big 60+ nuke). Then Smite filler. Each tier sits ABOVE the
            // heal-mana reserve, so a DPS cast never starves the tank of heals; below swpMana we regen instead.
            // MANA DISCIPLINE: a priest that nukes itself dry can't heal → it OOM-died at 2% mana (a death =
            // ~40s corpse-run = the single biggest XPM loss). HARD FLOOR: no DPS below dpsFloor, always keeping
            // a heal reserve. SW:P (cheap, efficient instant DoT) stays the staple contribution; Mind Blast /
            // Smite only when genuinely flush. Trades a little priest burst for ZERO OOM deaths — net XPM win.
            // _castUntil: the snapshot's self.cast lags a tick or two after we issue a CAST-TIME nuke, so the
            // cast-finish guard above doesn't catch it yet and we re-issue → the cast RESTARTS and never lands
            // (the same self-interrupt that broke heals). Hold off re-casting for the nuke's cast time so it
            // actually completes. SW:P is INSTANT (castTime 0) so it's exempt — it can fire between nuke casts.
            if (safe && b.offGcd() && mp > (T.dpsFloor ?? 0.38) && Date.now() >= (b._castUntil ?? 0)) {
              const plv = b.self.lv ?? 1;
              if (b.cls === 'priest' && plv >= 4 && mp > (T.swpMana ?? 0.30) && b._swpTarget !== mob.id) {
                b._swpTarget = mob.id; b.cmd({ cmd: 'cast', ability: 'shadow_word_pain' }); // instant, mana-efficient DoT — the staple priest contribution; gated right at the floor so it lands on ~every mob
                if (T.verbose) b.journal(`🟣 Shadow Word: Pain → ${mob.nm ?? 'mob'} (DoT ~54/18s)`);
              } else if (b.cls === 'priest' && plv >= 10 && mp > (T.mbMana ?? 0.55) && Date.now() - (b._mbAt ?? 0) > 8000) {
                b._mbAt = Date.now(); b._castUntil = Date.now() + 1600; b.cmd({ cmd: 'cast', ability: 'mind_blast' }); // 1.5s cast
                if (T.verbose) b.journal(`🔮 Mind Blast → ${mob.nm ?? 'mob'} ${mob.hp}/${mob.mhp}`);
              } else if (mp > (T.healerNukeMana ?? 0.45)) {
                b._castUntil = Date.now() + 2100; b.cmd({ cmd: 'cast', ability: nuke }); // 2.0s cast — don't re-issue (restart)
                if (T.verbose) b.journal(`✴️ ${nuke === 'smite' ? 'Smite' : nuke} → ${mob.nm ?? 'mob'} ${mob.hp}/${mob.mhp}`);
              }
            }
            continue;
          }
          if (b.dist(mob) <= r.max) {                                // melee-capable healer → swing + weave nuke
            if (b.self.target !== mob.id) b.cmd({ cmd: 'target', id: mob.id });
            b.input({}, b.faceTo(mob));
            b.cmd({ cmd: 'attack' });
            if (nuke && b.offGcd() && mp > 0.45 && safe) b.cmd({ cmd: 'cast', ability: nuke });
            continue;
          }
        }
      }
      // no heal needed + no mob in reach → grab any of our own uncollected drops nearby, else regroup.
      if (lootSweep(b, lootQueue, T)) continue;
      if (b.dist(leader.pos()) > T.follow) moveToward(b, followAnchor(b, leader.pos())); else holdIdle(b);
      continue;
    }


    // FOCUS FIRE with RANGED-PULL coordination — one mob at a time, threat established first:
    //   TANK   : commits to the focus when the party's ready; CHARGES to close + land opening threat,
    //            then runs its threat rotation (taunt/sunder/heroic strike) to peel & hold.
    //   PULLER : a ranged DPS opens the pull with one shot, then HOLDS once the mob is on it so the
    //            tank can taunt it off; resumes full DPS only after the tank has aggro.
    //   DPS    : wait until the tank holds the focus, THEN assist (else just grab a loose add on them).
    let target = null;
    if (b === tank) {
      // PROTECT THE HEALERS (farm): mobs on a healer (esp. BOSS ADDS — Velkhar's 3 Bonewalkers) are the #1
      // wipe cause. The warrior pulls them OFF the healer: GO to the adds and THUNDER CLAP (AoE grabs all of
      // them at once) when 2+, plus TAUNT the nearest (single-target backup). Only the warrior has a taunt.
      if (T.dungeonFarm && b.cls === 'warrior') {
        const lvw = b.self.lv ?? 1;
        const healerPids = new Set(bots.filter((o) => o.self && o.isHealer() && o !== tank).map((o) => o.self.id ?? o.pid));
        const onHealers = b.hostiles().filter((m) => !m.dead && healerPids.has(m.aggro));
        if (onHealers.length) {
          const nearest = onHealers.sort((x, y) => b.dist(x) - b.dist(y))[0];
          // 2+ adds on healers → close to AoE range and THUNDER CLAP to grab them all off the healers.
          if (onHealers.length >= 2 && lvw >= 6) {
            if (b.dist(nearest) > 8) { moveToward(b, nearest); leaderSay(leader, `going to grab ${onHealers.length} adds off the healers`); continue; }
            if ((b.self.res ?? 0) >= 20 && Date.now() - (b.lastTclap ?? 0) > 4000) { b.cmd({ cmd: 'cast', ability: 'thunder_clap' }); b.lastTclap = Date.now(); leaderSay(leader, `Thunder Clap — grabbing ${onHealers.length} adds off the healers`); continue; }
          }
          // single add (or TC on cd): TAUNT the nearest off the healer.
          if (lvw >= 10 && Date.now() - (b.lastTaunt ?? 0) > 8000) {
            if (b.self.target !== nearest.id) b.cmd({ cmd: 'target', id: nearest.id });
            b.cmd({ cmd: 'cast', ability: 'taunt' }); b.lastTaunt = Date.now();
            leaderSay(leader, `taunting ${nearest.nm ?? 'an add'} off the healer`); continue;
          }
          // can't taunt/TC yet → at least body up to the adds so we're in range to grab them next tick.
          if (b.dist(nearest) > 8) { moveToward(b, nearest); continue; }
        }
      }
      // The tank STANDS ITS GROUND and fights whatever's on the party — no kiting, no shedding adds, no
      // fleeing (a tank+healer handles a few mobs fine; a genuinely-bad pull just wipes and regroups).
      // HEAL UP BEFORE RE-ENGAGING: between pulls (out of melee), if hurt, top off with a self-heal
      // (paladin Holy Light, shaman Healing Wave, etc.) so we enter the next fight at full. Mid-fight we
      // do NOT heal-stall — dieFreely handles a bad pull (fight → die → regroup). Skips if OOM (just rest).
      const selfHeal = HEAL_SPELL[b.cls];
      const inMelee = b.hostiles().some((m) => b.dist(m) < 6);
      if (selfHeal && !inMelee && b.hpFrac() < (T.recoverHp ?? 0.9) && b.offGcd() && (b.self.res ?? 0) >= 30) {
        if (b.self.target !== b.self.id) b.cmd({ cmd: 'target', id: b.self.id });
        b.input({});
        b.cmd({ cmd: 'cast', ability: selfHeal });
        leaderSay(leader, 'healing up before the next pull');
        continue;
      }
      if (focus && (pullReady || focusEngaged || focus.aggro === b.pid || tank.dist(focus) < 8)) {
        if (b === leader) leaderSay(leader, focusEngaged ? `tanking ${focus.nm ?? 'a foe'}` : `pulling ${focus.nm ?? 'a foe'}`);
        // CHARGE (L4+, 8-25y, off-GCD, 15s cd): closes the gap, stuns, seeds threat. But in the farm we do
        // NOT charge when the HUNTER is pulling — charging into the pack is exactly what causes overpulls.
        // Instead the tank stands, lets swifter pull the ONE mob back, and TAUNTS it off (threat rotation).
        const farmRangedPull = T.dungeonFarm && puller && puller !== tank;
        // RANGED-PULL HOLD: with the hunter pulling, the tank must NOT walk to a far focus — that marches the
        // melee INTO the pack and aggros neighbours (the overpull). Hold position, target the mob, and let
        // swifter pull it BACK to us; engage/taunt only once it's actually close (or already on the tank).
        if (farmRangedPull && tank.dist(focus) > 12 && !aggroOn(focus, tank)) {
          if (b.self.target !== focus.id) b.cmd({ cmd: 'target', id: focus.id });
          b.input({}); leaderSay(leader, `holding — swifter pulls ${focus.nm ?? 'it'} back to us`); continue;
        }
        if (!farmRangedPull && (b.self.lv ?? 1) >= 4 && tank.dist(focus) >= 8 && tank.dist(focus) <= 25 && Date.now() - (b.lastCharge ?? 0) > 15000) {
          if (b.self.target !== focus.id) b.cmd({ cmd: 'target', id: focus.id });
          b.cmd({ cmd: 'cast', ability: 'charge' }); b.lastCharge = Date.now(); continue;
        }
        target = focus;
      } else if (focus && b === leader) { if (T.verbose) b.journal(`⏸ NOT engaging ${focus.nm ?? 'foe'} @${Math.round(tank.dist(focus))}y — pullReady=${pullReady} focusEngaged=${focusEngaged}`); leaderSay(leader, 'letting the party recover before the next pull'); }
    } else if (b === puller) {
      if (focus && !focus.dead) {
        if (tankOnFocus) target = focus;                 // tank holds it → open up with full DPS
        else if (pullReady || focusEngaged) {            // initiate / sustain the pull, then hold
          if (b.self.target !== focus.id) b.cmd({ cmd: 'target', id: focus.id });
          b.input({}, b.faceTo(focus));
          if (!aggroOn(focus, b)) { b.cmd({ cmd: 'attack' }); if (b.offGcd()) rotate(b, focus, T); } // one shot to pull
          else b.cmd({ cmd: 'stopattack' });             // it's on us — STOP adding threat so the tank can peel it
          continue;
        }
      }
    } else {
      // other DPS: assist the focus ONLY once the tank has a real threat LEAD (held it a few seconds),
      // not the instant it first grabs aggro — that head start is what lets the warrior keep it off the squishies.
      if (focus && !focus.dead && (T.dungeonFarm ? tankHasLead : tankOnFocus)) target = focus;
      if (!target && T.assistOnly) {
        const lv = b.self.lv ?? 1;
        target = b.hostiles().filter((m) => {
          const dl = (m.lv ?? lv) - lv;
          return dl >= T.lvlFloor && dl <= ceil && b.dist(m) < T.assistRange && !isAvoided(m);
        }).sort((x, y) => b.dist(x) - b.dist(y))[0];
      }
    }
    // ENGAGEMENT CAP (no fleeing — just don't pile on): if the party is ALREADY holding maxEngage+ mobs,
    // the tank does NOT advance toward a new/deeper one (walking through a tight camp is what snowballs a
    // pull to 7-8 and out-damages the heals). It stands and kills the NEAREST mob already on us, in place;
    // steps in for the next only once the count drops. The healer keeps it alive through the capped few.
    if (b === tank && target && !target.dead) {
      const onParty = b.hostiles().filter((m) => m.aggro != null && bots.some((o) => o.self && m.aggro === (o.self.id ?? o.pid))).length;
      if (onParty >= (T.maxEngage ?? 4) && b.dist(target) > 5) {
        const near = b.hostiles().filter((m) => m.aggro != null).sort((x, y) => b.dist(x) - b.dist(y))[0] ?? target;
        if (b.self.target !== near.id) b.cmd({ cmd: 'target', id: near.id });
        b.input({}, b.faceTo(near)); b.cmd({ cmd: 'attack' }); if (b.offGcd()) rotate(b, near, T);
        continue;
      }
    }
    if (target && !target.dead) { engage(b, target, MELEE, T); continue; }

    // no target
    if (b === leader) {
      // INSIDE the instance (dungeonRun): push forward ONE pull at a time toward the bosses.
      if (inDungeon) {
        // GRACEFUL RECOVERY: after a wipe, HOLD (don't re-advance into the killer) until everyone is
        // back up and topped off — farmAdvancePhase clears F.wiping once the party has recovered.
        if (farm && farm.wiping) { b.cmd({ cmd: 'stopattack' }); b.input({}); leaderSay(leader, 'wiped — holding for the party to run back and regroup'); }
        else dungeonAdvance(leader, bots, T, state, lootQueue);
      }
      // crypt march ONLY when we're actually seeking the crypt. With seekCrypt:false we
      // ignore multibox.mjs's grind→travel phase flip (it fires at dungeonLevel) and keep
      // grinding `home` — otherwise hitting L8 would drag the party off the Mire Prowlers.
      // (seekCrypt WITHOUT dungeonRun keeps the legacy hold-the-door behaviour for the Hollow Crypt.)
      else if (T.seekCrypt && (phase === 'travel' || phase === 'dungeon')) {
        const door = [...b.ents.values()].find((e) => e.tid === 'dungeon_door');
        if (b.dist(CRYPT_DOOR) < 7 || (door && b.dist(door) < 7)) { for (const m of bots) m.cmd({ cmd: 'enter_dungeon', dungeon: DUNGEON_ID }); b.input({}); }
        else b.input({ f: 1 }, b.faceTo(CRYPT_DOOR));
      } else {
        const corpse = [...lootQueue.entries()].map(([id, c]) => ({ id, ...c })).filter((c) => b.dist(c) < T.lootWalk).sort((x, y) => b.dist(x) - b.dist(y))[0];
        // pace pulls: wait before the next pull if anyone is hurt, far, or a caster is low on mana
        const MANA_USERS = new Set(['mage', 'warlock', 'priest', 'druid', 'shaman', 'paladin']);
        const waitFor = bots.find((m) => m !== b && m.self && !m.self.dead && (
          m.hpFrac() < 0.5 || m.dist(b.pos()) > 16 ||
          (MANA_USERS.has(m.cls) && m.self.mres && (m.self.res ?? 0) / m.self.mres < T.pullManaFrac)
        ));
        if (corpse) {
          const q = lootQueue.get(corpse.id);
          if (!q || q.tries > 20) lootQueue.delete(corpse.id);
          else if (b.dist(corpse) > 4) { moveToward(b, corpse); q.tries++; }
          else { b.input({}); b.cmd({ cmd: 'loot', id: corpse.id }); b.cmd({ cmd: 'interact' }); lootQueue.delete(corpse.id); }
        } else if (GO_HOME && b.dist(HOME) > HOME_RADIUS) {
          // far from camp → ALWAYS walk back, even while hurt/low-mana. Standing 80y from
          // any mob just burns the run; pacing gates the next PULL, not travel to the camp.
          moveToward(b, b === leader ? HOME : campAnchor(b, HOME, HOME_RADIUS));
          leaderSay(leader, `pathing to the grind camp (${HOME.x}, ${HOME.z})`);
        } else if (T.pullWhenReady && (b.hpFrac() < T.restHp || waitFor)) {
          leaderSay(leader, 'letting the party recover before the next pull');
          b.input({});
        } else if (T.seekCrypt && !arrived) { b.input({ f: 1 }, b.faceTo(CRYPT_DOOR)); leaderSay(leader, 'marching to the crypt'); }
        else if (T.seekCrypt && b.dist(CRYPT_DOOR) > T.anchorReturn) b.input({ f: 1 }, b.faceTo(CRYPT_DOOR));
        else {
          // no mob in range → drift to the camp CENTRE and HOLD for respawns. BUT if the centre's been
          // dead too long (60s+ starved), PATROL within HOME_RADIUS — sweep a point near the camp edge so
          // we re-find respawns/spawns we've drifted off of. BOUNDED to the camp (never wanders off to a
          // mountain or another zone); the lvlCeil-respecting target-fallback grabs whatever we sweep into.
          const dHome = Math.hypot(b.self.x - HOME.x, b.self.z - HOME.z);
          if (dHome > HOME_RADIUS) { moveToward(b, b === leader ? HOME : campAnchor(b, HOME, HOME_RADIUS)); leaderSay(leader, 'returning to the camp'); }
          else if (now - (state.starvedSince || now) > 60000) {
            if (now > (state.patrolUntil ?? 0)) { const a = Math.random() * Math.PI * 2, r = HOME_RADIUS * (0.4 + Math.random() * 0.5); state.patrolPt = { x: HOME.x + Math.cos(a) * r, z: HOME.z + Math.sin(a) * r }; state.patrolUntil = now + 8000; }
            moveToward(b, b === leader ? state.patrolPt : campAnchor(b, state.patrolPt, HOME_RADIUS)); leaderSay(leader, 'sweeping the camp for respawns');
          }
          else { b.input({}); leaderSay(leader, 'waiting for the pack to respawn'); }
        }
      }
    } else {
      // no mob to fight → grab any of our own uncollected drops nearby, else regroup on the leader.
      if (lootSweep(b, lootQueue, T)) continue;
      if (b.dist(leader.pos()) > T.follow) moveToward(b, followAnchor(b, leader.pos())); else holdIdle(b);
    }
  }
}
