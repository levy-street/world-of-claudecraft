import type { Sim } from '../src/sim/sim';

/** Load character state, then stamp authenticated account identity. The identity
 * belongs to this host and must never be sourced from the saved character blob. */
export function addAccountPlayer(
  sim: Sim,
  accountId: number,
  characterId: number,
  cls: Parameters<Sim['addPlayer']>[0],
  name: string,
  state: NonNullable<Parameters<Sim['addPlayer']>[2]>['state'] | null,
  meta: Pick<
    NonNullable<Parameters<Sim['addPlayer']>[2]>,
    'accountLedger' | 'bankBonus' | 'appearance'
  >,
): number {
  const pid = sim.addPlayer(cls, name, {
    state: state ?? undefined,
    characterId,
    accountLedger: meta.accountLedger,
    bankBonus: meta.bankBonus,
    appearance: meta.appearance ?? null,
    tutorialGreetingSent: state === null,
  });
  sim.meta(pid)!.accountId = accountId;
  return pid;
}
