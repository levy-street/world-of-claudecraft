// The seasonal swap of the town themes (pure, DOM-free): while Gourdlight Eve runs,
// the three event cities (Eastbrook, Fenbridge, Highwatch) play its own town theme
// instead of theirs, and the moment the event closes they play their own again. The
// soundtrack crossfades the swap like any other zone change (music.ts update), so a
// player standing in the square when the event opens or closes hears the one fade.
// "What runs now" is the world's own answer (IWorld activeSeasonalEvent: the server's
// calendar online, `/dev season` offline), never a clock here.
import { GOURDLIGHT_EVE_ID } from '../sim/content/gourdlight_eve';
import type { MusicZone } from './music_zones';

/** The town cues each seasonal event takes over, and the theme it plays there. */
const SEASONAL_TOWN_MUSIC: Readonly<
  Record<string, { towns: ReadonlySet<MusicZone>; theme: MusicZone }>
> = {
  [GOURDLIGHT_EVE_ID]: {
    towns: new Set<MusicZone>(['town_eastbrook', 'town_fenbridge', 'town_highwatch']),
    theme: 'town_gourdlight',
  },
};

/** The cue to play: `zone` itself, unless a running event scores that town. */
export function seasonalMusicZone(zone: MusicZone, activeEvent: string | null): MusicZone {
  if (activeEvent === null) return zone;
  const swap = SEASONAL_TOWN_MUSIC[activeEvent];
  return swap?.towns.has(zone) ? swap.theme : zone;
}
