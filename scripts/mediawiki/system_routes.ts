import { questMap } from './quest_map';
import { activityRoutes } from './routes_activities';
import { characterRoutes } from './routes_character';
import { socialRoutes } from './routes_social';
import { tradeRoutes } from './routes_trade';

export const systemRoutes = {
  ...activityRoutes,
  ...characterRoutes,
  ...socialRoutes,
  ...tradeRoutes,
};

export function systemRouteMap(name: string, notice: string): string {
  if (notice.startsWith("'''Retired")) return '';
  const route = systemRoutes[name];
  if (!route || (!route.points.length && !route.flow?.length))
    throw new Error('Missing navigable route for ' + name);
  const notes = route.notes ?? [];
  const chart = route.points.length
    ? questMap(route, 'system', notes)
    : ['== Route map ==', ...notes, ''].join('\n\n');
  const flow = route.flow?.length
    ? '=== Action route ===\n' +
      route.flow
        .map(
          (s, i, stops) =>
            '# ' + (i === 0 ? "'''Start.''' " : i === stops.length - 1 ? "'''Finish.''' " : '') + s,
        )
        .join('\n') +
      '\n\n'
    : '';
  return chart + '\n' + flow;
}
