import { AUTHORED_TOWNS } from './authored_town_registry';
import { GOURDLIGHT_KEEPER_POSTS } from './content/gourdlight_eve';

// Later painted towns join the world registry without joining Gourdlight Eve.
const eventTownIds = new Set<string>(GOURDLIGHT_KEEPER_POSTS.map((post) => post.id));
export const SEASONAL_EVENT_TOWNS = Object.freeze(
  AUTHORED_TOWNS.filter((town) => eventTownIds.has(town.id)),
);
