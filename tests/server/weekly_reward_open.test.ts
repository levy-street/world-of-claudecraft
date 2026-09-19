import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchWeeklyRewardCommand,
  WEEKLY_OPEN_RETRY_MS,
  WEEKLY_OPEN_SAVE_TIMEOUT_MS,
  type WeeklyRewardOpenHost,
  type WeeklyRewardSession,
} from '../../server/weekly_reward_open';
import { BUILTIN_WORLD, NPCS } from '../../src/sim/data';
import { type CharacterState, Sim } from '../../src/sim/sim';
import {
  emptyWeeklyRewards,
  WEEKLY_KEEPER_ID,
  weeklyRewardInfoFor,
} from '../../src/sim/weekly_rewards';

function setup(state?: CharacterState) {
  const sim = new Sim({
    seed: 42,
    noPlayer: true,
    playerClass: 'mage',
    world: {
      ...BUILTIN_WORLD,
      camps: [],
      npcs: { [WEEKLY_KEEPER_ID]: NPCS[WEEKLY_KEEPER_ID] },
      groundObjects: [],
    },
    lockoutNowMs: () => 2000,
    weeklyRaidResetMs: () => 604800000,
  });
  const pid = sim.addPlayer('mage', 'Collector', { state });
  const player = sim.entities.get(pid)!;
  const keeper = [...sim.entities.values()].find(
    (entity) => entity.templateId === WEEKLY_KEEPER_ID,
  )!;
  player.pos = { ...keeper.pos, x: keeper.pos.x - 1 };
  player.prevPos = { ...player.pos };
  sim.ctx.rebucket(player);
  const meta = sim.players.get(pid)!;
  if (!state) {
    meta.weeklyRewards = emptyWeeklyRewards(604800000);
    meta.weeklyRewards.vaults = [
      { resetAtMs: 1000, choices: [{ pool: 'dungeon' }, { pool: 'pvp' }] },
    ];
  }
  const session: WeeklyRewardSession = {
    pid,
    characterId: 31,
    left: false,
    escrowQuarantined: false,
  };
  let resolve!: (saved: boolean) => void;
  let reject!: (error: Error) => void;
  const saved = new Promise<boolean>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const saveCharacter = vi.fn(
    (
      _session: WeeklyRewardSession,
      _opts: Parameters<WeeklyRewardOpenHost<WeeklyRewardSession>['saveCharacter']>[1],
    ) => saved,
  );
  const host: WeeklyRewardOpenHost<WeeklyRewardSession> = {
    sim,
    clients: new Map([[pid, session]]),
    saveCharacter,
  };
  const open = (index = 0) =>
    dispatchWeeklyRewardCommand(host, session, 'weekly_reward_open', {
      choice: `1000:${index}`,
      token: '604800000:0',
    });
  const choices = () => weeklyRewardInfoFor(sim.ctx, pid)!.state.vaults[0].choices;
  return { sim, pid, meta, player, session, host, saveCharacter, resolve, reject, open, choices };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('weekly vault durable opening', () => {
  it('recovers the exact committed roll after a crash before acknowledgement reaches the player', async () => {
    const h = setup();
    let committed!: CharacterState;
    h.saveCharacter.mockImplementation(async () => {
      // This captures the real save boundary while the live item is hidden.
      expect(h.choices()[0].itemId).toBeUndefined();
      committed = JSON.parse(JSON.stringify(h.sim.serializeCharacter(h.pid)));
      expect(committed.weeklyRewards!.vaults[0].choices[0]).not.toHaveProperty('pendingSave');
      expect(committed.weeklyRewards!.vaults[0].choices[0]).not.toHaveProperty('opening');
      return true;
    });
    await h.open();
    const itemId = h.choices()[0].itemId;
    expect(itemId).toBeTruthy();
    const recovered = setup(committed);
    const rolling = vi.spyOn(recovered.sim.ctx.rng, 'pick');
    expect(recovered.choices()[0]).toEqual({ pool: 'dungeon', itemId, opened: true });
    expect(recovered.choices()[1]).toEqual({ pool: 'pvp' });
    await recovered.open();
    expect(rolling).not.toHaveBeenCalled();
    expect(recovered.saveCharacter).not.toHaveBeenCalled();
  });

  it('refuses a queued save before serialization when the character disappeared during the wait', async () => {
    const h = setup();
    let release!: () => void;
    const queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    const serialize = vi.fn(() => h.sim.serializeCharacter(h.pid));
    h.saveCharacter.mockImplementation(async (_session, opts) => {
      await queue;
      if (!opts.shouldStart()) return false;
      serialize();
      return true;
    });
    const work = h.open();
    const choice = h.meta.weeklyRewards!.vaults[0].choices[0];
    h.sim.entities.delete(h.pid);
    release();
    await work;
    expect(serialize).not.toHaveBeenCalled();
    expect(choice.pendingSave).toBe(true);
    expect(choice.opening).toBeUndefined();
    expect(choice.itemId).toBeTruthy();
  });

  it('withholds a newly rolled item until the save succeeds and reuses it on reopen', async () => {
    const h = setup();
    const rolling = vi.spyOn(h.sim.ctx.rng, 'pick');
    expect(h.choices()[0].itemId).toBeUndefined();
    const work = h.open();
    const itemId = h.meta.weeklyRewards!.vaults[0].choices[0].itemId;
    expect(itemId).toBeTruthy();
    expect(h.choices()[0].itemId).toBeUndefined();
    expect(h.choices()[1].itemId).toBeUndefined();
    expect(h.saveCharacter).toHaveBeenCalledOnce();
    expect(h.saveCharacter.mock.calls[0][1].shouldStart()).toBe(true);
    expect(h.saveCharacter.mock.calls[0][1].backgroundDbPermit).toBe(true);
    h.resolve(true);
    await work;
    expect(h.choices()[0].itemId).toBe(itemId);
    expect(h.choices()[1].itemId).toBeUndefined();
    await h.open();
    expect(h.saveCharacter).toHaveBeenCalledOnce();
    expect(rolling).toHaveBeenCalledOnce();
  });

  it('admits only one write per character and refuses claims during it', async () => {
    const h = setup();
    const claim = vi.spyOn(h.sim, 'claimWeeklyReward');
    const work = h.open();
    await Promise.all([h.open(), h.open(1)]);
    await dispatchWeeklyRewardCommand(h.host, h.session, 'weekly_reward_claim', {
      choice: '1000:0',
      token: '604800000:0',
    });
    expect(claim).not.toHaveBeenCalled();
    expect(h.saveCharacter).toHaveBeenCalledOnce();
    expect(h.meta.weeklyRewards!.vaults[0].choices[1].itemId).toBeUndefined();
    h.resolve(true);
    await work;
  });

  it.each(['false', 'throw'] as const)(
    'retains the same hidden roll after a %s result and retries after cooldown',
    async (result) => {
      vi.useFakeTimers();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const h = setup();
      const rolling = vi.spyOn(h.sim.ctx.rng, 'pick');
      const work = h.open();
      const itemId = h.meta.weeklyRewards!.vaults[0].choices[0].itemId;
      if (result === 'false') h.resolve(false);
      else h.reject(new Error('commit response unavailable'));
      await work;
      expect(h.choices()[0].itemId).toBeUndefined();
      await h.open();
      expect(h.saveCharacter).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(WEEKLY_OPEN_RETRY_MS);
      h.saveCharacter.mockResolvedValue(true);
      await h.open();
      expect(h.choices()[0].itemId).toBe(itemId);
      expect(h.saveCharacter).toHaveBeenCalledTimes(2);
      expect(rolling).toHaveBeenCalledOnce();
    },
  );

  it.each(['left', 'quarantined', 'replaced', 'state replaced', 'entity removed'] as const)(
    'cannot publish when authority is %s while saving',
    async (change) => {
      const h = setup();
      const work = h.open();
      const oldChoice = h.meta.weeklyRewards!.vaults[0].choices[0];
      if (change === 'left') h.session.left = true;
      if (change === 'quarantined') h.session.escrowQuarantined = true;
      if (change === 'replaced')
        (h.host.clients as Map<number, WeeklyRewardSession>).set(h.pid, { ...h.session });
      if (change === 'state replaced') h.meta.weeklyRewards = emptyWeeklyRewards(604800000);
      if (change === 'entity removed') h.sim.entities.delete(h.pid);
      expect(h.saveCharacter.mock.calls[0][1].shouldStart()).toBe(false);
      h.resolve(true);
      await work;
      // Reattaching the previous ledger does not turn an unacknowledged save
      // into a reveal. The private pending marker must still suppress it.
      h.meta.weeklyRewards = emptyWeeklyRewards(604800000);
      h.meta.weeklyRewards.vaults = [{ resetAtMs: 1000, choices: [oldChoice] }];
      if (change !== 'entity removed') expect(h.choices()[0].itemId).toBeUndefined();
    },
  );

  it('aborts a slow save without admitting another write until the first settles', async () => {
    vi.useFakeTimers();
    const h = setup();
    const work = h.open();
    const signal = h.saveCharacter.mock.calls[0][1].signal as AbortSignal;
    vi.advanceTimersByTime(WEEKLY_OPEN_SAVE_TIMEOUT_MS);
    expect(signal.aborted).toBe(true);
    await h.open(1);
    expect(h.saveCharacter).toHaveBeenCalledOnce();
    h.resolve(false);
    await work;
    expect(h.choices()[0].itemId).toBeUndefined();
  });

  it('refuses malformed commands and stale tokens before rolling or saving', async () => {
    const h = setup();
    for (const payload of [
      {},
      { choice: 1, token: '604800000:0' },
      { choice: '1000:0', token: 'old' },
    ])
      await dispatchWeeklyRewardCommand(h.host, h.session, 'weekly_reward_open', payload);
    expect(h.saveCharacter).not.toHaveBeenCalled();
    expect(h.meta.weeklyRewards!.vaults[0].choices[0].itemId).toBeUndefined();
  });
});
