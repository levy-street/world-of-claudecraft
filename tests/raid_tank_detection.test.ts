// Raid tank detection is form/posture-aware: the Ignivar and Varkhul non-tank
// mechanics treat a player as a tank by the same committed-tank rule creature
// crit immunity uses (combat/tank_crit_immunity.ts isCommittedTank), never by
// the spec role alone. A Wildfang druid in Cat Form is a damage dealer and
// eats the mechanic; one in Bruin Form is a tank. A Warspirit shaman is a tank
// only in the Stonebound posture; Galeheart or no imbue means damage dealer.
// Protection warriors and paladins are tanks by spec.

import { describe, expect, it } from 'vitest';
import { type CommittedTankMeta, isCommittedTank } from '../src/sim/combat/tank_crit_immunity';
import { committedTankIds } from '../src/sim/encounters/committed_tanks';
import {
  IGNIVAR_BRAND_AURA_ID,
  IGNIVAR_BRAND_TARGETS_NORMAL,
  updateIgnivarEncounter,
} from '../src/sim/encounters/ignivar';
import { updateVarkhulEncounter, VARKHUL_BOSS_ID } from '../src/sim/encounters/varkhul';
import { IGNIVAR_SECOND_WING_ID } from '../src/sim/ignivar_raid_ids';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, IGNIVAR_BOSS_ID, type PlayerClass } from '../src/sim/types';

type Build = {
  cls: PlayerClass;
  spec: string;
  // A form or Warspirit imbue cast through the real ability after the spec.
  cast?: 'bear_form' | 'cat_form' | 'rockbiter_weapon' | 'galeheart_weapon';
};

const PROT_WARRIOR: Build = { cls: 'warrior', spec: 'prot' };
const PROT_PALADIN: Build = { cls: 'paladin', spec: 'protection' };
const BRUIN_DRUID: Build = { cls: 'druid', spec: 'feral', cast: 'bear_form' };
const CAT_DRUID: Build = { cls: 'druid', spec: 'feral', cast: 'cat_form' };
const STONEBOUND_SHAMAN: Build = { cls: 'shaman', spec: 'enhancement', cast: 'rockbiter_weapon' };
const GALEHEART_SHAMAN: Build = { cls: 'shaman', spec: 'enhancement', cast: 'galeheart_weapon' };
const BARE_SHAMAN: Build = { cls: 'shaman', spec: 'enhancement' };

// Level, spec, and (optionally) a real form/imbue cast, then one tick so the
// cast resolves. Returns the player's entity.
function equip(sim: Sim, pid: number, build: Build): Entity {
  sim.setPlayerLevel(20, pid);
  expect(sim.setSpec(build.spec, pid)).toBe(true);
  const player = sim.entities.get(sim.players.get(pid)?.entityId ?? -1);
  if (!player) throw new Error(`player ${pid} missing`);
  if (build.cast) {
    player.resource = player.maxResource;
    sim.castAbility(build.cast, pid);
    sim.tick();
  }
  if (build.cast === 'bear_form')
    expect(player.auras.some((a) => a.kind === 'form_bear')).toBe(true);
  if (build.cast === 'cat_form') {
    expect(player.auras.some((a) => a.kind === 'form_cat')).toBe(true);
    expect(player.auras.some((a) => a.kind === 'form_bear')).toBe(false);
  }
  if (build.cast === 'rockbiter_weapon' || build.cast === 'galeheart_weapon') {
    expect(player.auras.some((a) => a.id === build.cast)).toBe(true);
  }
  return player;
}

describe('isCommittedTank (pure leaf)', () => {
  const player = (auras: Partial<Entity['auras'][number]>[] = []) =>
    ({ kind: 'player', auras }) as unknown as Entity;
  const meta = (cls: PlayerClass, spec: string | null): CommittedTankMeta => ({
    cls,
    talentMods: { spec },
  });

  it('counts Protection warriors and paladins by spec alone', () => {
    expect(isCommittedTank(player(), meta('warrior', 'prot'))).toBe(true);
    expect(isCommittedTank(player(), meta('paladin', 'protection'))).toBe(true);
    expect(isCommittedTank(player(), meta('warrior', 'arms'))).toBe(false);
    expect(isCommittedTank(player(), meta('paladin', 'retribution'))).toBe(false);
  });

  it('counts a Feral druid only in Bruin Form', () => {
    expect(isCommittedTank(player([{ kind: 'form_bear' }]), meta('druid', 'feral'))).toBe(true);
    expect(isCommittedTank(player([{ kind: 'form_cat' }]), meta('druid', 'feral'))).toBe(false);
    expect(isCommittedTank(player(), meta('druid', 'feral'))).toBe(false);
  });

  it('counts an Enhancement shaman only in the Stonebound posture', () => {
    const shaman = meta('shaman', 'enhancement');
    expect(isCommittedTank(player([{ id: 'rockbiter_weapon' }]), shaman)).toBe(true);
    expect(isCommittedTank(player([{ id: 'galeheart_weapon' }]), shaman)).toBe(false);
    expect(isCommittedTank(player(), shaman)).toBe(false);
  });

  it('never counts a specless player, a missing meta, or a non-player', () => {
    expect(isCommittedTank(player(), meta('warrior', null))).toBe(false);
    expect(isCommittedTank(player(), undefined)).toBe(false);
    const mob = { kind: 'mob', auras: [] } as unknown as Entity;
    expect(isCommittedTank(mob, meta('warrior', 'prot'))).toBe(false);
  });
});

describe('committedTankIds (real Sim builds)', () => {
  it('resolves each hybrid by its live form or posture, not its spec role', () => {
    const sim = new Sim({ seed: 4711, playerClass: 'warrior', noPlayer: true });
    const ids = new Map<Build, number>();
    for (const build of [
      PROT_WARRIOR,
      PROT_PALADIN,
      BRUIN_DRUID,
      CAT_DRUID,
      STONEBOUND_SHAMAN,
      GALEHEART_SHAMAN,
      BARE_SHAMAN,
    ]) {
      const pid = sim.addPlayer(build.cls, `${build.cls}-${build.cast ?? build.spec}`);
      ids.set(build, equip(sim, pid, build).id);
    }
    // The spec role is exactly what the old check read, and it is wrong for
    // both hybrids: Feral says tank in Cat Form, Enhancement says damage in
    // the Stonebound posture.
    expect(sim.players.get(ids.get(CAT_DRUID) as number)?.talentMods.role).toBe('tank');
    expect(sim.players.get(ids.get(STONEBOUND_SHAMAN) as number)?.talentMods.role).toBe('dps');

    const tanks = committedTankIds(sim.ctx);
    expect([...tanks].sort((a, b) => a - b)).toEqual(
      [PROT_WARRIOR, PROT_PALADIN, BRUIN_DRUID, STONEBOUND_SHAMAN]
        .map((build) => ids.get(build) as number)
        .sort((a, b) => a - b),
    );
  });
});

describe('Ignivar Brand of the Pyre tank exclusion', () => {
  it('brands the Cat druid and non-Stonebound shamans, never the committed tanks', () => {
    const sim = new Sim({ seed: 4242, playerClass: 'warrior', devCommands: true });
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', sim.player.id, true)).toBe(true);
    const boss = [...sim.entities.values()].find((e) => e.templateId === IGNIVAR_BOSS_ID);
    if (!boss) throw new Error('Ignivar did not spawn');
    const roster = new Map<Build, Entity>();
    roster.set(PROT_WARRIOR, equip(sim, sim.player.id, PROT_WARRIOR));
    // Every raider stands on the boss, so all seven are in the encounter.
    sim.player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z + 2 };
    sim.player.prevPos = { ...sim.player.pos };
    for (const build of [
      PROT_PALADIN,
      BRUIN_DRUID,
      STONEBOUND_SHAMAN,
      CAT_DRUID,
      GALEHEART_SHAMAN,
      BARE_SHAMAN,
    ]) {
      const pid = sim.addPlayer(build.cls, `${build.cls}-${build.cast ?? build.spec}`);
      const player = equip(sim, pid, build);
      player.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z + 2 };
      player.prevPos = { ...player.pos };
      roster.set(build, player);
    }
    boss.inCombat = true;
    boss.aiState = 'attack';
    boss.aggroTargetId = sim.player.id;
    boss.swingTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);
    const st = boss.ignivar;
    if (!st) throw new Error('Ignivar state was not initialized');
    st.frontalTimer = 999;
    st.skyfireTimer = 999;
    st.rotatingRaysTimer = 999;
    st.forgeWaveTimer = 999;
    st.forgeStrikeTimer = 999;
    st.overlapTimer = 999;
    st.meteorTimer = 999;
    st.soakTimer = 999;
    st.forgeChainsTimer = 999;
    st.brandTimer = 0;
    let draws = 0;
    sim.rng.setObserver(() => draws++);

    updateIgnivarEncounter(sim.ctx, boss);
    sim.rng.setObserver(null);

    const branded = (build: Build) =>
      roster.get(build)?.auras.some((a) => a.id === IGNIVAR_BRAND_AURA_ID) ?? false;
    // Three eligible non-tanks and three Brand slots: every eligible player
    // is branded, so the assertion does not depend on which roll picked whom.
    expect(IGNIVAR_BRAND_TARGETS_NORMAL).toBe(3);
    expect(branded(CAT_DRUID)).toBe(true);
    expect(branded(GALEHEART_SHAMAN)).toBe(true);
    expect(branded(BARE_SHAMAN)).toBe(true);
    expect(branded(PROT_WARRIOR)).toBe(false);
    expect(branded(PROT_PALADIN)).toBe(false);
    expect(branded(BRUIN_DRUID)).toBe(false);
    expect(branded(STONEBOUND_SHAMAN)).toBe(false);
    // One draw per living target slot, unchanged by the eligibility rule.
    expect(draws).toBe(IGNIVAR_BRAND_TARGETS_NORMAL);
  });

  // The player Ignivar is attacking is never branded, even when the committed
  // rule says they are not a tank right now: a Feral main tank who drops Bruin
  // Form, or a Warspirit main tank whose Stonebound imbue has lapsed.
  const FERAL_CASTER: Build = { cls: 'druid', spec: 'feral' };
  it.each([
    ['a Feral druid out of Bruin Form', FERAL_CASTER],
    ['an Enhancement shaman without Stonebound', BARE_SHAMAN],
  ])('never brands the main tank holding aggro as %s', (_label, mainTankBuild) => {
    const sim = new Sim({ seed: 4243, playerClass: mainTankBuild.cls, devCommands: true });
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', sim.player.id, true)).toBe(true);
    const boss = [...sim.entities.values()].find((e) => e.templateId === IGNIVAR_BOSS_ID);
    if (!boss) throw new Error('Ignivar did not spawn');
    const mainTank = equip(sim, sim.player.id, mainTankBuild);
    mainTank.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z + 2 };
    mainTank.prevPos = { ...mainTank.pos };
    const catPid = sim.addPlayer(CAT_DRUID.cls, 'cat-druid');
    const cat = equip(sim, catPid, CAT_DRUID);
    cat.pos = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z + 2 };
    cat.prevPos = { ...cat.pos };
    // Neither player is a committed tank, so only aggro can spare the main tank.
    expect(committedTankIds(sim.ctx).size).toBe(0);
    boss.inCombat = true;
    boss.aiState = 'attack';
    boss.aggroTargetId = mainTank.id;
    boss.swingTimer = 999;
    updateIgnivarEncounter(sim.ctx, boss);
    const st = boss.ignivar;
    if (!st) throw new Error('Ignivar state was not initialized');
    st.frontalTimer = 999;
    st.skyfireTimer = 999;
    st.rotatingRaysTimer = 999;
    st.forgeWaveTimer = 999;
    st.forgeStrikeTimer = 999;
    st.overlapTimer = 999;
    st.meteorTimer = 999;
    st.soakTimer = 999;
    st.forgeChainsTimer = 999;
    st.brandTimer = 0;
    let draws = 0;
    sim.rng.setObserver(() => draws++);

    updateIgnivarEncounter(sim.ctx, boss);
    sim.rng.setObserver(null);

    expect(mainTank.auras.some((a) => a.id === IGNIVAR_BRAND_AURA_ID)).toBe(false);
    expect(cat.auras.some((a) => a.id === IGNIVAR_BRAND_AURA_ID)).toBe(true);
    // Two living raiders, two slots: the excluded main tank still costs a draw.
    expect(draws).toBe(2);
  });
});

describe('Varkhul non-tank mechanic exclusion', () => {
  function varkhulWith(
    builds: readonly Build[],
    heroic = false,
  ): { sim: Sim; boss: Entity; added: Entity[] } {
    const sim = new Sim({ seed: 9417, playerClass: 'warrior', devCommands: true });
    expect(enterDungeon(sim.ctx, IGNIVAR_SECOND_WING_ID, sim.player.id, true)).toBe(true);
    const instance = sim.instances.find((entry) => entry.dungeonId === IGNIVAR_SECOND_WING_ID);
    if (!instance) throw new Error('Inner Crucible instance missing');
    instance.difficulty = heroic ? 'heroic' : 'normal';
    const boss = instance.mobIds
      .map((id) => sim.entities.get(id))
      .find((entity) => entity?.templateId === VARKHUL_BOSS_ID);
    if (!boss) throw new Error('Varkhul missing');
    equip(sim, sim.player.id, PROT_WARRIOR);
    const added = builds.map((build) => {
      const pid = sim.addPlayer(build.cls, `${build.cls}-${build.cast ?? build.spec}`);
      const player = equip(sim, pid, build);
      player.damageImmune = true;
      player.pos = sim.ctx.groundPos(boss.pos.x, boss.pos.z + 20);
      player.prevPos = { ...player.pos };
      return player;
    });
    boss.inCombat = true;
    boss.aiState = 'attack';
    boss.aggroTargetId = sim.player.id;
    boss.swingTimer = 999;
    sim.player.pos = sim.ctx.groundPos(boss.pos.x, boss.pos.z + 5);
    sim.player.prevPos = { ...sim.player.pos };
    return { sim, boss, added };
  }

  // Tempering Ray rotates through the living non-tanks (castKey % pool size),
  // so with exactly one eligible player the target names the eligibility rule.
  function temperingRayTarget(sim: Sim, boss: Entity): number | null {
    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    state.makersBrandTimer = 999;
    state.frontalTimer = 999;
    state.cinderOrbsTimer = 999;
    state.forgestormTimer = 999;
    state.sharedPyreTimer = 999;
    state.anvilTimer = 999;
    state.interceptBeamTimer = DT;
    updateVarkhulEncounter(sim.ctx, boss);
    return state.interceptBeamTargetId;
  }

  it('targets the Cat druid over a Stonebound shaman', () => {
    const { sim, boss, added } = varkhulWith([STONEBOUND_SHAMAN, CAT_DRUID]);
    expect(temperingRayTarget(sim, boss)).toBe(added[1].id);
  });

  it('targets the Galeheart shaman over a Bruin druid', () => {
    const { sim, boss, added } = varkhulWith([BRUIN_DRUID, GALEHEART_SHAMAN]);
    expect(temperingRayTarget(sim, boss)).toBe(added[1].id);
  });

  it('targets the unimbued shaman over a Protection paladin off tank', () => {
    const { sim, boss, added } = varkhulWith([PROT_PALADIN, BARE_SHAMAN]);
    expect(temperingRayTarget(sim, boss)).toBe(added[1].id);
  });

  // Master's Assembly hands every spawned add to the highest-threat committed
  // tank. The spec-role rule would pick the Cat druid (role tank, top threat);
  // the committed-tank rule skips it and finds the Stonebound shaman above the
  // Protection warrior.
  it("sends Master's Assembly adds to the top committed tank, not the Cat druid", () => {
    const { sim, boss, added } = varkhulWith([STONEBOUND_SHAMAN, CAT_DRUID], true);
    const [stonebound, cat] = added;
    boss.threat.set(sim.player.id, 100);
    boss.threat.set(stonebound.id, 1_000);
    boss.threat.set(cat.id, 5_000);
    boss.hp = Math.floor(boss.maxHp * 0.5);

    updateVarkhulEncounter(sim.ctx, boss);
    const state = boss.varkhul;
    if (!state) throw new Error('Varkhul state missing');
    expect(state.assemblyPhase).toBe('adds');
    state.assemblyForgeBeamWarmupRemaining = DT;
    for (const pending of state.assemblyPortalSpawns) pending.remaining = DT;
    updateVarkhulEncounter(sim.ctx, boss);

    const adds = state.assemblyAddIds.map((id) => sim.entities.get(id)).filter(Boolean) as Entity[];
    expect(adds.length).toBeGreaterThan(0);
    expect(adds.every((add) => add.aggroTargetId === stonebound.id)).toBe(true);
  });
});
