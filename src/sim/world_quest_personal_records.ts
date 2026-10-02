// The offline host's world quest ladder: the character's own records on the
// boards that keep them (the glider's courses, Fire and Fly's trials, missions and
// Mastery), and the empty page on every other board.

import {
  type PersonalFireAndFlyRecords,
  personalFireAndFlyLeaderboard,
} from './fire_and_fly_personal_records';
import { fireAndFlyBoardGroup } from './fire_and_fly_scoreboards';
import { type PersonalGliderRecords, personalGliderLeaderboard } from './glider_personal_records';

export function personalWorldQuestLeaderboard(
  player: {
    name: string;
    gliderRecords: PersonalGliderRecords;
    fireAndFlyRecords: PersonalFireAndFlyRecords;
  },
  board: string,
  day: string,
  page: number,
  pageSize: number,
) {
  return fireAndFlyBoardGroup(board)
    ? personalFireAndFlyLeaderboard(player, board, day, page, pageSize)
    : personalGliderLeaderboard(player, board, day, page, pageSize);
}
