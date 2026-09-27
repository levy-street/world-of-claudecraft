import { GLIDER_RANKINGS_BOARD_ID } from '../sim/glider_scoreboards';
import type { SimEvent } from '../sim/types';
import type { LeaderboardWindow } from './leaderboard_window';
import type { NoticeboardPopup } from './noticeboard_popup';

/** Route the authoritative sign interaction to the matching existing window. */
export function presentNoticeboardEvent(
  event: Extract<SimEvent, { type: 'noticeboard' }>,
  popup: Pick<NoticeboardPopup, 'show'>,
  rankings: Pick<LeaderboardWindow, 'openGliderRankings'>,
  openGuildBoard: (boardId: string) => void,
): void {
  if (event.boardId === GLIDER_RANKINGS_BOARD_ID) rankings.openGliderRankings();
  else if (event.state === 'listings') popup.show(event.listings);
  else openGuildBoard(event.boardId);
}
