import { TALENTS } from '../../src/sim/content/talents';
import { CLASSES, ZONES } from '../../src/sim/data';
import type { ArticleTools } from './entity_format';

type Writer = Pick<ArticleTools, 'add' | 'section' | 'bullets' | 'link' | 'titleBy'>;

const ROLE_LABELS: Record<string, string> = { tank: 'Tank', healer: 'Healer', dps: 'Damage' };
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Each row carries "Label: value" facts after the link; the reader lays them out as a card.
export function zoneHubRows(w: Pick<Writer, 'link' | 'titleBy'>): string[] {
  return [...ZONES]
    .sort(
      (a, b) =>
        a.levelRange[0] - b.levelRange[0] ||
        a.levelRange[1] - b.levelRange[1] ||
        a.name.localeCompare(b.name, 'en'),
    )
    .map((z) => {
      const [low, high] = z.levelRange;
      return [
        w.link(w.titleBy.zone.get(z.id)!),
        low === high ? 'Level: ' + low : 'Levels: ' + low + ' to ' + high,
        'Town: ' + z.hub.name,
      ].join(' · ');
    });
}

export function classHubRows(w: Pick<Writer, 'link' | 'titleBy'>): string[] {
  return Object.keys(CLASSES)
    .sort()
    .map((id) => {
      const cls = CLASSES[id as keyof typeof CLASSES];
      const specs = Object.values(TALENTS).find((t) => t.class === id)?.specs ?? [];
      const rank = (role: string) => {
        const i = Object.keys(ROLE_LABELS).indexOf(role);
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
      };
      const roles = [...new Set(specs.map((s) => s.role))]
        .sort((a, b) => rank(a) - rank(b))
        .map((role) => ROLE_LABELS[role] ?? capitalize(role));
      return [
        w.link(w.titleBy.class.get(id)!),
        ...(cls.resourceType ? ['Resource: ' + capitalize(cls.resourceType)] : []),
        'Roles: ' + roles.join(', '),
        'Specializations: ' + specs.map((s) => s.name).join(', '),
      ].join(' · ');
    });
}

export function addZoneAndClassHubs(w: Writer) {
  w.add('Zones', w.section('Regions by level', w.bullets(zoneHubRows(w))), ['Portals']);
  w.add('Classes', w.section('Playable classes', w.bullets(classHubRows(w))), ['Portals']);
}
