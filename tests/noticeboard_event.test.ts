import { describe, expect, it, vi } from 'vitest';
import { presentNoticeboardEvent } from '../src/ui/noticeboard_event';

describe('noticeboard event routing', () => {
  it('opens glider records only at the launch sign and preserves guild boards', () => {
    const popup = { show: vi.fn() };
    const rankings = { openGliderRankings: vi.fn() };
    const guild = vi.fn();
    presentNoticeboardEvent(
      {
        type: 'noticeboard',
        noticeboardId: 'noticeboard_eastbrook',
        boardId: 'glider_launch_rankings',
        state: 'empty',
      },
      popup,
      rankings,
      guild,
    );
    expect(rankings.openGliderRankings).toHaveBeenCalledTimes(1);
    expect(guild).not.toHaveBeenCalled();
    presentNoticeboardEvent(
      {
        type: 'noticeboard',
        noticeboardId: 'noticeboard_eastbrook',
        boardId: 'eastbrook_noticeboard',
        state: 'empty',
      },
      popup,
      rankings,
      guild,
    );
    expect(guild).toHaveBeenCalledWith('eastbrook_noticeboard');
    guild.mockClear();
    const listings = [{ guild: 'Guild recruitment', note: 'Join our guild' }];
    presentNoticeboardEvent(
      {
        type: 'noticeboard',
        noticeboardId: 'noticeboard_eastbrook',
        boardId: 'eastbrook_noticeboard',
        state: 'listings',
        listings,
      },
      popup,
      rankings,
      guild,
    );
    expect(popup.show).toHaveBeenCalledWith(listings);
    expect(guild).not.toHaveBeenCalled();
    expect(rankings.openGliderRankings).toHaveBeenCalledTimes(1);
  });
});
