import { BOT_REPORT_REWARD_LETTER } from '../src/sim/content/letters';
import { type CustodyParcelBook, confirmCustodyParcelBooked } from './mail_custody_overlay';
import type { ReportReward } from './report_rewards_db';

export const REPORT_REWARD_NOTICE = 'An account you reported has been banned';
export const REPORT_REWARD_POLL_MS = 10_000;

export interface ReportRewardsDb {
  due(): Promise<ReportReward[]>;
  claim(id: number): Promise<boolean>;
  retry(ids: number[]): Promise<void>;
  notices(accountIds: number[]): Promise<{ id: number; accountId: number }[]>;
  notified(ids: number[]): Promise<void>;
}
export interface ReportRewardsHost {
  book: CustodyParcelBook;
  canBook(characterId: number, name: string): boolean;
  onlineAccounts(): number[];
  notice(accountId: number, text: string): boolean;
  measure<T>(work: () => T): T;
}

/** Single flight; fixed DB pages and indexed parcel lookup. No whole-book save.
 * An uncertain write parks delivery until boot replay, which owns durable recovery. */
export function createReportRewardsDelivery(db: ReportRewardsDb, host: ReportRewardsHost) {
  let flight: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const run = async () => {
    const refused: number[] = [];
    for (const row of await db.due()) {
      if (!host.measure(() => host.canBook(row.characterId, row.name))) {
        refused.push(row.id);
        continue;
      }
      if (!(await db.claim(row.id))) continue;
      const ref = `report_reward:${row.id}`;
      const recipient = { key: String(row.characterId), name: row.name };
      const booked = host.measure(() => {
        if (
          !host.book.mailSystemParcel(recipient, BOT_REPORT_REWARD_LETTER, [], ref) &&
          !host.book.hasCustodyParcel(ref)
        )
          return false;
        confirmCustodyParcelBooked({
          custodyRef: ref,
          recipient,
          letter: 'report_reward',
          items: [],
          copper: 0,
        });
        return true;
      });
      // System mail bypasses mailbox capacity. A defensive refusal
      // remains in custody for boot replay; never clear a possibly applied claim.
      if (!booked) console.error(`[report_rewards] parcel refused: ${ref}`);
    }
    await db.retry(refused);
    const notices = await db.notices(host.measure(() => host.onlineAccounts()));
    const sent = host.measure(() =>
      notices
        .filter((row) => host.notice(row.accountId, REPORT_REWARD_NOTICE))
        .map((row) => row.id),
    );
    await db.notified(sent);
  };
  const poll = (): Promise<void> => {
    if (flight) return flight;
    flight = run().finally(() => {
      flight = null;
    });
    return flight;
  };
  const beat = () => {
    void poll()
      .catch((err) => console.error('report reward delivery failed:', err))
      .finally(() => {
        if (!stopped) {
          timer = setTimeout(beat, REPORT_REWARD_POLL_MS);
          timer.unref();
        }
      });
  };
  return {
    poll,
    start() {
      stopped = false;
      beat();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await flight?.catch(() => {});
    },
  };
}
