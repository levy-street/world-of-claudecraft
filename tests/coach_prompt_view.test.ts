// The island interact bubble's pure core: which target carries the keycap
// prompt at each rail station (the giver on the way in, the turn-in on the
// way back, the nearest live crate on the haul, the bell at graduation), the
// interact-reach show gate that mirrors the click path's own ranges, and the
// chip resolution per input family.

import { describe, expect, it } from 'vitest';
// The generation-side line list (plain mjs data): the clip keys the UI plays
// must each have a text entry the ElevenLabs pipeline renders.
import { EXTRA_LINES } from '../scripts/voices/extra_lines.mjs';
import { CLIMB_MIN_OVERHEAD } from '../src/sim/climb';
import { MANTLE_REACH } from '../src/sim/colliders';
import {
  BOOTCAMP_COURSE_CHECKPOINTS,
  PROVING_SHORE_NPCS,
  PROVING_SHORE_PROPS,
  PROVING_SHORE_QUESTS,
} from '../src/sim/content/proving_shore';
import { getActiveWorldContent } from '../src/sim/data';
import { CRAB_SUMMON_SITE } from '../src/sim/interactions/crab_summon';
import { LEDGE_GRAB_MAX } from '../src/sim/physics/ledge';
import { campCrateShape } from '../src/sim/prop_layout';
import { INTERACT_RANGE } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';
import { BELL_STEP_TARGET } from '../src/ui/bootcamp_view';
import {
  BOOTCAMP_PARKOUR,
  CORNER_ASK_YD,
  type CoachPromptEntity,
  coachGlowBagItemId,
  coachGlowButtonId,
  coachPromptChip,
  coachPromptChips,
  coachPromptInRange,
  coachPromptPlan,
  GUIDE_VOICE_LINES,
  JUMP_PROMPT_RANGE,
  nearestCrate,
  POUCH_ITEM_ID,
  POUCH_QUEST_ID,
  PROMPT_NPC_RANGE,
  PROMPT_OBJECT_RANGE,
  pouchLessonActive,
  turnAskOwnsBubble,
} from '../src/ui/coach_prompt_view';
import { en } from '../src/ui/i18n.catalog';

const AT_ORIGIN = { x: 0, z: 0 };

/** Fixture ids are only ever compared against a targetId, so any distinct
 *  number does; a counter keeps every fixture in a case unique. */
let nextId = 1;
function crate(x: number, z: number, dead = false): CoachPromptEntity {
  return { id: nextId++, kind: 'object', objectItemId: 'ps_castaway_crate', dead, pos: { x, z } };
}

function mob(templateId: string, x: number, z: number, dead = false): CoachPromptEntity {
  return { id: nextId++, kind: 'mob', templateId, dead, pos: { x, z } };
}

function plan(over: {
  bellPhase?: boolean;
  step?: Parameters<typeof coachPromptPlan>[0]['step'];
  focus?: { questId: string; state: 'available' | 'active' | 'ready' } | null;
  entities?: CoachPromptEntity[];
  playerPos?: { x: number; z: number };
  targetId?: number | null;
}) {
  return coachPromptPlan({
    bellPhase: over.bellPhase ?? false,
    step: over.step ?? null,
    focus: over.focus ?? null,
    entities: over.entities ?? [],
    playerPos: over.playerPos ?? AT_ORIGIN,
    targetId: over.targetId,
  });
}

describe('coachPromptPlan: which target carries the bubble', () => {
  it('aims at the giver with Talk while a quest is on offer', () => {
    const p = plan({ focus: { questId: 'q_ps_strike_true', state: 'available' } });
    const giver = PROVING_SHORE_NPCS[PROVING_SHORE_QUESTS.q_ps_strike_true.giverNpcId];
    expect(p).not.toBeNull();
    expect(p!.x).toBe(giver.pos.x);
    expect(p!.z).toBe(giver.pos.z);
    expect(p!.range).toBe(PROMPT_NPC_RANGE);
    expect(p!.verbKey).toBe('hudChrome.bootcamp.promptTalk');
  });

  it('aims at the turn-in with Turn in once the task is done', () => {
    const p = plan({ focus: { questId: 'q_ps_shell_and_claw', state: 'ready' } });
    const turnIn = PROVING_SHORE_NPCS[PROVING_SHORE_QUESTS.q_ps_shell_and_claw.turnInNpcId];
    expect(p!.x).toBe(turnIn.pos.x);
    expect(p!.verbKey).toBe('hudChrome.bootcamp.promptTurnIn');
  });

  it('bubbles the nearest live quarry for the kill lessons', () => {
    const near = mob('training_effigy', 4, 0);
    const far = mob('training_effigy', 30, 0);
    const felled = mob('training_effigy', 1, 0, true);
    const p = plan({
      focus: { questId: 'q_ps_strike_true', state: 'active' },
      entities: [far, felled, near],
      targetId: near.id,
    });
    expect(p!.x).toBe(4);
    expect(p!.kind).toBe('kill');
    expect(p!.verbKey).toBe('hudChrome.bootcamp.promptAttack');
  });

  describe('the kill lessons split select from strike', () => {
    // The CX ask: a new player told to press two things at once does
    // neither. The bubble asks for the click first and names the attack
    // button only once the quarry is actually selected.
    const focus = { questId: 'q_ps_strike_true', state: 'active' as const };

    it('asks for the click while nothing is selected', () => {
      const quarry = mob('training_effigy', 4, 0);
      const p = plan({ focus, entities: [quarry], targetId: null });
      expect(p!.kind).toBe('select');
      expect(p!.verbKey).toBe('hudChrome.bootcamp.promptSelect');
      // Still standing on the quarry: the click it wants has a target.
      expect(p!.x).toBe(quarry.pos.x);
    });

    it('treats a missing targetId the same as nothing selected', () => {
      const quarry = mob('training_effigy', 4, 0);
      expect(plan({ focus, entities: [quarry] })!.kind).toBe('select');
    });

    it('still asks for the click when the WRONG effigy is selected', () => {
      // The decisive case for comparing ids rather than "has any target":
      // a player who tabbed onto the far effigy is being pointed at the
      // near one, and pressing attack would swing at neither.
      const near = mob('training_effigy', 4, 0);
      const far = mob('training_effigy', 30, 0);
      const p = plan({ focus, entities: [near, far], targetId: far.id });
      expect(p!.x).toBe(near.pos.x);
      expect(p!.kind).toBe('select');
    });

    it('names the attack only once the bubbled quarry IS the target', () => {
      const quarry = mob('training_effigy', 4, 0);
      const p = plan({ focus, entities: [quarry], targetId: quarry.id });
      expect(p!.kind).toBe('kill');
      expect(p!.verbKey).toBe('hudChrome.bootcamp.promptAttack');
    });

    it('splits the scuttler cull the same way', () => {
      const scuttler = mob('shore_scuttler', 3, 0);
      const cull = { questId: 'q_ps_shell_and_claw', state: 'active' as const };
      expect(plan({ focus: cull, entities: [scuttler], targetId: null })!.kind).toBe('select');
      const selected = plan({ focus: cull, entities: [scuttler], targetId: scuttler.id });
      expect(selected!.kind).toBe('kill');
      expect(selected!.verbKey).toBe('hudChrome.bootcamp.promptUseAbility');
    });
  });

  it('stays quiet for a kill lesson with no live quarry in the roster', () => {
    expect(plan({ focus: { questId: 'q_ps_strike_true', state: 'active' } })).toBeNull();
    expect(plan({ focus: { questId: 'q_ps_shell_and_claw', state: 'active' } })).toBeNull();
  });

  it('aims at the nearest LIVE crate on the haul, with the object reach', () => {
    const near = crate(3, 0);
    const far = crate(40, 0);
    const looted = crate(1, 0, true);
    const p = plan({
      focus: { questId: 'q_ps_the_wreck_line', state: 'active' },
      entities: [far, looted, near],
    });
    expect(p!.x).toBe(3);
    expect(p!.range).toBe(PROMPT_OBJECT_RANGE);
    expect(p!.verbKey).toBe('hudChrome.bootcamp.promptPickUp');
  });

  it('goes quiet between crate respawns rather than pointing at nothing', () => {
    const p = plan({
      focus: { questId: 'q_ps_the_wreck_line', state: 'active' },
      entities: [crate(1, 0, true)],
    });
    expect(p).toBeNull();
  });

  it('walks the gauntlet ladder: Talk at Tam, Turn in at Pell, quiet mid-lane', () => {
    expect(plan({ step: 'talk' })!.verbKey).toBe('hudChrome.bootcamp.promptTalk');
    expect(plan({ step: 'done' })!.verbKey).toBe('hudChrome.bootcamp.promptTurnIn');
    expect(plan({ step: 'forward' })).toBeNull();
    expect(plan({ step: 'camera' })).toBeNull();
  });

  it('rings the bell at graduation', () => {
    const p = plan({ bellPhase: true });
    expect(p!.x).toBe(BELL_STEP_TARGET.x);
    expect(p!.z).toBe(BELL_STEP_TARGET.z);
    expect(p!.verbKey).toBe('hudChrome.bootcamp.promptRing');
  });

  it('asks for the lure at the pool, then attacks once the king is up', () => {
    // The pearl detour's quarry is summoned: with no live boss the bubble
    // stands on the tide pool with the bags-bind Summon ask; once he prowls
    // it becomes the usual kill bubble on him.
    const focus = { questId: 'q_ps_mother_of_pearl', state: 'active' as const };
    const before = plan({ focus, entities: [] });
    expect(before!.kind).toBe('use');
    expect(before!.verbKey).toBe('hudChrome.bootcamp.promptSummon');
    expect({ x: before!.x, z: before!.z }).toEqual({
      x: CRAB_SUMMON_SITE.x,
      z: CRAB_SUMMON_SITE.z,
    });
    const boss: CoachPromptEntity = {
      id: nextId++,
      kind: 'mob',
      templateId: 'mister_crabs',
      pos: { x: CRAB_SUMMON_SITE.x, z: CRAB_SUMMON_SITE.z + 3 },
    };
    const during = plan({ focus, entities: [boss], targetId: boss.id });
    expect(during!.kind).toBe('kill');
    expect(during!.verbKey).toBe('hudChrome.bootcamp.promptAttack');
    expect({ x: during!.x, z: during!.z }).toEqual(boss.pos);
    // While the king's corpse lies on the sand the press that matters is
    // the loot (the pearl is on it), never a re-summon over its shell.
    const corpse = plan({ focus, entities: [{ ...boss, dead: true }] });
    expect(corpse!.kind).toBe('interact');
    // Names the prize, not the generic "Pick up": a new player standing on
    // a corpse needs to know it still owes them something (CX).
    expect(corpse!.verbKey).toBe('hudChrome.bootcamp.promptLootPearl');
    expect({ x: corpse!.x, z: corpse!.z }).toEqual(boss.pos);
    // Corpse gone (despawned unlooted): the lure ask returns for the retry.
    expect(plan({ focus, entities: [] })!.kind).toBe('use');
  });

  it('finds the corpse when handed the LIVE one-shot entity iterator', () => {
    // The shipped bug (CX: "still doesn't tell me to loot Mister Crabs to
    // pick up the quest item. This is key."). Every fixture above passes an
    // array, which can be walked twice; the real caller passes
    // world.entities.values(), a Map iterator that is spent after ONE walk.
    // The live-boss scan drained it, so the corpse scan behind it saw an
    // empty world and the bubble fell through to "B Summon" while two
    // Mister Crabs corpses lay in frame. Anything re-scanning args.entities
    // has the same hole, so the fix materializes once inside the plan.
    const focus = { questId: 'q_ps_mother_of_pearl', state: 'active' as const };
    const corpse: CoachPromptEntity = {
      id: nextId++,
      kind: 'mob',
      templateId: 'mister_crabs',
      dead: true,
      pos: { x: CRAB_SUMMON_SITE.x, z: CRAB_SUMMON_SITE.z + 3 },
    };
    const world = new Map<number, CoachPromptEntity>([[corpse.id, corpse]]);
    const p = coachPromptPlan({
      bellPhase: false,
      step: null,
      focus,
      entities: world.values(),
      playerPos: corpse.pos,
    });
    expect(p!.verbKey).toBe('hudChrome.bootcamp.promptLootPearl');
    expect({ x: p!.x, z: p!.z }).toEqual(corpse.pos);
  });

  it('shows the loot ask at LOOT reach, not the fight reach it came from', () => {
    // The second half of the same lesson failing: corpse loot is gated on
    // INTERACT_RANGE, so keeping the kill bubble's 12 yards would put "Loot
    // the pearl" on screen from seven yards out of reach and teach a
    // first-timer that pressing the button does nothing.
    const focus = { questId: 'q_ps_mother_of_pearl', state: 'active' as const };
    const corpse = mob('mister_crabs', CRAB_SUMMON_SITE.x, CRAB_SUMMON_SITE.z, true);
    const p = plan({ focus, entities: [corpse] })!;
    expect(p.range).toBe(PROMPT_OBJECT_RANGE);
    expect(coachPromptInRange(p, { x: corpse.pos.x + 4, z: corpse.pos.z })).toBe(true);
    expect(coachPromptInRange(p, { x: corpse.pos.x + 9, z: corpse.pos.z })).toBe(false);
  });

  it('asks for the hurdle jump, then the crate step, then goes quiet', () => {
    // Lane 2 runs south (-z): entering at the first flag the bubble aims at
    // the hurdle rail; a stride past the rail it moves to the crate step; a
    // stride past the crates the lane is clear and the ask ends.
    const atFlag = plan({ step: 'turnwalk', playerPos: { x: -308, z: -16 } });
    expect(atFlag!.kind).toBe('jump');
    expect(atFlag!.verbKey).toBe('hudChrome.bootcamp.promptJump');
    expect({ x: atFlag!.x, z: atFlag!.z }).toEqual(BOOTCAMP_PARKOUR[0]);
    const pastRail = plan({ step: 'turnwalk', playerPos: { x: -308, z: -24.5 } });
    expect({ x: pastRail!.x, z: pastRail!.z }).toEqual(BOOTCAMP_PARKOUR[1]);
    expect(plan({ step: 'turnwalk', playerPos: { x: -308, z: -28.5 } })).toBeNull();
  });

  it('the parkour ledge tops sit in the climb band from the approach ground', () => {
    // Two-high crate stacks must FORCE the climb move: taller than the
    // jump-mantle can vault (CLIMB_MIN_OVERHEAD), inside the grab reach at
    // apex (apex + LEDGE_GRAB_MAX). Measured against the real terrain on
    // the approach side (north of the wall, where the jump launches).
    const apex = CLIMB_MIN_OVERHEAD - MANTLE_REACH;
    const grabCeiling = apex + LEDGE_GRAB_MAX;
    // campCrateShape keys on the index within the MERGED world crate list
    // (colliders.ts and props.ts both iterate PROPS.crates), and that index
    // decides barrel vs crate, so the lane must be measured at its GLOBAL
    // positions or the pin measures a fiction and cannot see an index shift
    // caused by another zone gaining a crate.
    const world = getActiveWorldContent().props.crates;
    const lane: { x: number; z: number; stack?: number; index: number }[] = [];
    world.forEach(([x, z, stack], index) => {
      if (z === -27 && x <= -304 && x >= -312) lane.push({ x, z, stack, index });
    });
    expect(lane.length).toBeGreaterThanOrEqual(6);
    // The lane's authored points are all present in the merged list.
    const authored = (PROVING_SHORE_PROPS.crates ?? []).filter(([, z]) => z === -27);
    expect(lane).toHaveLength(authored.length);
    for (const { x, z, stack, index } of lane) {
      expect(stack, `crate[${index}] stack`).toBe(2);
      const shape = campCrateShape(x, z, index);
      const top = groundHeight(x, z, WORLD_SEED) + shape.top * 2;
      const approach = groundHeight(x, z + 2, WORLD_SEED);
      const rise = top - approach;
      expect(rise, `crate[${index}] rise`).toBeGreaterThan(CLIMB_MIN_OVERHEAD + 0.05);
      expect(rise, `crate[${index}] rise`).toBeLessThan(grabCeiling - 0.1);
    }
  });

  it('anchors the parkour asks on the authored obstacles', () => {
    // The hurdle anchor sits mid-lane ON a fence rail spanning lane 2 wall
    // to wall, and the crate-step anchor sits on the authored crate line: if
    // the content moves, the bubbles move with it or this pins the drift.
    const [hurdle, step] = BOOTCAMP_PARKOUR;
    const rail = (PROVING_SHORE_PROPS.fences ?? []).find(
      (f) => f.z1 === hurdle.z && f.z2 === hurdle.z && f.x1 <= hurdle.x && hurdle.x <= f.x2,
    );
    const railSpan = rail ?? { x1: 0, x2: 0 };
    expect(rail, 'a lane 2 rail under the hurdle anchor').toBeTruthy();
    // Wall to wall: the rail meets both lane walls so it cannot be walked
    // around (lane 2's west wall x -312, east wall x -304).
    expect(Math.min(railSpan.x1, railSpan.x2)).toBe(-312);
    expect(Math.max(railSpan.x1, railSpan.x2)).toBe(-304);
    const crates = PROVING_SHORE_PROPS.crates ?? [];
    const stepRow = crates.filter(([, z]) => z === step.z);
    expect(stepRow.length, 'the crate step under the second anchor').toBeGreaterThanOrEqual(6);
    // Shoulder to shoulder across the lane: no slipping between crates. The
    // narrowest collider is the barrel (r 0.44, prop_layout.ts
    // campCrateShape), so adjacent points 1.1 apart always overlap or leave
    // a gap smaller than any player body.
    const xs = stepRow.map(([x]) => x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      const gap = xs[i] - xs[i - 1];
      expect(gap, `crate spacing ${i}`).toBeLessThanOrEqual(1.15);
    }
    expect(Math.min(...xs)).toBeLessThanOrEqual(-311);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(-305);
  });
});

describe('coachPromptInRange: the show gate mirrors the interact reach', () => {
  const base = {
    x: 0,
    z: 0,
    lift: 2,
    range: INTERACT_RANGE + 2,
    verbKey: 'hudChrome.bootcamp.promptTalk',
    kind: 'interact',
  } as const;

  it('shows at the reach boundary and hides one step past it', () => {
    expect(coachPromptInRange(base, { x: base.range, z: 0 })).toBe(true);
    expect(coachPromptInRange(base, { x: base.range + 0.5, z: 0 })).toBe(false);
  });
});

describe('nearestCrate: the haul scan', () => {
  it('ignores non-crate objects entirely', () => {
    const bell: CoachPromptEntity = {
      id: nextId++,
      kind: 'object',
      objectItemId: 'ps_ferry_bell',
      pos: { x: 1, z: 0 },
    };
    expect(nearestCrate([bell], AT_ORIGIN)).toBeNull();
  });
});

describe('GUIDE_VOICE_LINES: the clip keys, the pipeline lines, the captions', () => {
  it('renders every UI clip key from an extra_lines entry on the ferryman', () => {
    const byKey = new Map(EXTRA_LINES.map((l: { key: string }) => [l.key, l]));
    for (const line of Object.values(GUIDE_VOICE_LINES)) {
      const entry = byKey.get(line.clip) as { voiceNpc: string; text: string } | undefined;
      expect(
        entry,
        `${line.clip} must be declared in scripts/voices/extra_lines.mjs`,
      ).toBeDefined();
      expect(entry!.voiceNpc).toBe('ferryman_odo');
    }
  });

  it('speaks the SAME English the caption row shows (reword them together)', () => {
    const byKey = new Map(EXTRA_LINES.map((l: { key: string; text: string }) => [l.key, l.text]));
    const captions = en.hudChrome.bootcamp as Record<string, string>;
    for (const line of Object.values(GUIDE_VOICE_LINES)) {
      const captionKey = line.caption.replace('hudChrome.bootcamp.', '');
      expect(byKey.get(line.clip)).toBe(captions[captionKey]);
    }
  });
});

describe('coachPromptChip: one chip per input family', () => {
  it('shows the live keyboard or detected-pad bind, and nothing on touch', () => {
    expect(coachPromptChip('keyboard', 'F', 'A')).toEqual({ chip: 'F', chipIsKey: true });
    expect(coachPromptChip('pad', 'F', 'A')).toEqual({ chip: 'A', chipIsKey: true });
    expect(coachPromptChip('touch', 'F', 'A')).toEqual({ chip: null, chipIsKey: false });
  });

  it('hides the chip when the active input family has no interact binding', () => {
    expect(coachPromptChip('keyboard', '', 'A')).toEqual({ chip: null, chipIsKey: true });
    expect(coachPromptChip('pad', 'F', '')).toEqual({ chip: null, chipIsKey: true });
  });
});

describe('turnAskOwnsBubble: the corner keeps its own instruction', () => {
  // The CX report: at the first checkpoint the CARD said "D then W" but the
  // loud floating bubble went straight to "Jump", because lane 2's hurdle
  // sits inside the jump ask's range of that very checkpoint. Lane 3 has no
  // obstacle, which is exactly why it read correctly and lane 2 did not.
  const cps = BOOTCAMP_COURSE_CHECKPOINTS;

  it('holds the bubble while the player stands at the corner just tagged', () => {
    const corner = cps[0];
    expect(turnAskOwnsBubble(1, { x: corner.x, z: corner.z }, cps)).toBe(true);
    expect(turnAskOwnsBubble(1, { x: corner.x, z: corner.z - CORNER_ASK_YD + 1 }, cps)).toBe(true);
  });

  it('hands over once the player has run on toward the obstacle', () => {
    const corner = cps[0];
    expect(turnAskOwnsBubble(1, { x: corner.x, z: corner.z - CORNER_ASK_YD - 1 }, cps)).toBe(false);
  });

  it('hands over well before the hurdle, never fighting the jump ask for it', () => {
    // The whole point of sizing it under the jump range: both asks get their
    // own stretch of lane instead of flickering against each other.
    expect(CORNER_ASK_YD).toBeLessThan(JUMP_PROMPT_RANGE);
  });

  it('owns nothing before the first checkpoint is tagged', () => {
    expect(turnAskOwnsBubble(0, { x: cps[0].x, z: cps[0].z }, cps)).toBe(false);
  });

  it('tracks the SECOND corner once that one is tagged', () => {
    const second = cps[1];
    expect(turnAskOwnsBubble(2, { x: second.x, z: second.z }, cps)).toBe(true);
    // ...and not the first one any more.
    expect(turnAskOwnsBubble(2, { x: cps[0].x, z: cps[0].z }, cps)).toBe(false);
  });

  it('is safe past the end of the checkpoint list', () => {
    expect(turnAskOwnsBubble(99, { x: 0, z: 0 }, cps)).toBe(false);
  });
});

describe('pouchLessonActive: the buckle-on lesson knows when it is over', () => {
  // CX round 10: "what is up with the quest 'Pouch and Purse', gold trim is
  // always at the bottom here, no matter what". The lesson keyed on the
  // quest STATE alone, and 'ready' holds from the moment the pouch is bought
  // until it is handed back, so the bottom bloom and the pulsing bag stack
  // both stayed up long after the pouch was on. The end of the lesson is the
  // pouch being WORN, not the quest being turned in.
  const ready = { questId: POUCH_QUEST_ID, state: 'ready' as const };
  const empty: (string | null)[] = [null, null, null, null];

  it('is on while the bought pouch is still sitting in the bags', () => {
    expect(pouchLessonActive(ready, empty)).toBe(true);
    expect(coachGlowBagItemId(ready, empty)).toBe(POUCH_ITEM_ID);
  });

  it('is OFF the moment the pouch is socketed, quest still un-handed-in', () => {
    const worn = [POUCH_ITEM_ID, null, null, null];
    expect(pouchLessonActive(ready, worn)).toBe(false);
    expect(coachGlowBagItemId(ready, worn)).toBeNull();
  });

  it('ignores any other bag in a socket', () => {
    expect(pouchLessonActive(ready, ['travelers_knapsack', null, null, null])).toBe(true);
  });

  it('is off before the pouch is bought, when the lesson is the vendor', () => {
    expect(pouchLessonActive({ questId: POUCH_QUEST_ID, state: 'active' }, empty)).toBe(false);
  });

  it('is off for every other station, and for no station at all', () => {
    expect(pouchLessonActive({ questId: 'q_ps_the_wreck_line', state: 'ready' }, empty)).toBe(
      false,
    );
    expect(pouchLessonActive(null, empty)).toBe(false);
  });
});

describe('coachPromptChips + coachGlowButtonId (the touch button mapping)', () => {
  const inputs = {
    abilityAsk: false,
    caster: false,
    killIconId: 'attack',
    slotLabel: '1',
    jumpLabel: 'Space',
    bagsLabel: 'B',
    interactLabel: 'F',
    padControlCaps: ['A'],
  };

  it('maps every desktop interact keycap to the Interact button on touch', () => {
    // Talk, Turn in quest, Pick up, Read, Ring: all kind interact.
    expect(coachPromptChips('interact', 'touch', inputs)).toEqual([{ buttonIcon: 'interact' }]);
    expect(coachPromptChips('interact', 'keyboard', inputs)).toEqual([{ cap: 'F' }]);
    expect(coachPromptChips('interact', 'pad', inputs)).toEqual([{ cap: 'A' }]);
    expect(coachGlowButtonId('interact', 'touch', inputs)).toBe('mobile-interact');
    expect(coachGlowButtonId('interact', 'keyboard', inputs)).toBeNull();
  });

  it('maps the melee kill ask to the Attack button, and glows it', () => {
    expect(coachPromptChips('kill', 'touch', inputs)).toEqual([{ buttonIcon: 'attack' }]);
    expect(
      coachPromptChips('kill', 'pad', { ...inputs, padControlCaps: ['LT + D-pad →'] }),
    ).toEqual([{ cap: 'LT + D-pad →' }]);
    expect(coachGlowButtonId('kill', 'touch', inputs)).toBe('mobile-action-attack');
  });

  it('keeps the caster and drill bubbles on the ring slot art, and glows that slot', () => {
    const caster = { ...inputs, caster: true, killIconId: 'smite' };
    expect(coachPromptChips('kill', 'touch', caster)).toEqual([{ abilityIcon: 'smite' }]);
    expect(coachGlowButtonId('kill', 'touch', caster)).toBe('mobile-slot-primary');
    const drill = { ...inputs, abilityAsk: true, killIconId: 'heroic_strike' };
    expect(coachPromptChips('kill', 'touch', drill)).toEqual([{ abilityIcon: 'heroic_strike' }]);
    expect(coachGlowButtonId('kill', 'touch', drill)).toBe('mobile-slot-primary');
  });

  it('maps the parkour ask to the Jump button on touch, the bind elsewhere', () => {
    expect(coachPromptChips('jump', 'touch', inputs)).toEqual([{ buttonIcon: 'jump' }]);
    expect(coachPromptChips('jump', 'keyboard', inputs)).toEqual([{ cap: 'Space' }]);
    expect(coachPromptChips('jump', 'pad', { ...inputs, padControlCaps: ['Y'] })).toEqual([
      { cap: 'Y' },
    ]);
    expect(coachGlowButtonId('jump', 'touch', inputs)).toBe('mobile-jump');
  });

  it('names the target-cycle control on pad while keeping pointer selection chipless', () => {
    expect(coachPromptChips('select', 'pad', { ...inputs, padControlCaps: ['D-pad →'] })).toEqual([
      { cap: 'D-pad →' },
    ]);
    expect(coachPromptChips('select', 'touch', inputs)).toEqual([]);
    expect(coachPromptChips('select', 'keyboard', inputs)).toEqual([]);
    expect(coachGlowButtonId('select', 'touch', inputs)).toBeNull();
    expect(coachGlowButtonId(null, 'touch', inputs)).toBeNull();
  });

  it('names the working controller route for bag-item lessons', () => {
    const bags = { ...inputs, padControlCaps: ['View'] };
    expect(coachPromptChips('use', 'pad', bags)).toEqual([{ cap: 'View' }]);
  });
});
