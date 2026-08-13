import type { CivicServicePlacement } from '../world_api/interaction';

type CivicServicePosition = Readonly<Pick<CivicServicePlacement, 'x' | 'z'>>;

/** Project authored service definitions into an immutable presentation boundary. */
export function buildCivicServicePlacements(
  mailboxes: readonly CivicServicePosition[],
  noticeboards: readonly CivicServicePosition[],
): readonly CivicServicePlacement[] {
  return Object.freeze([
    ...mailboxes.map(({ x, z }) => Object.freeze({ kind: 'mailbox' as const, x, z })),
    ...noticeboards.map(({ x, z }) => Object.freeze({ kind: 'noticeboard' as const, x, z })),
  ]);
}
