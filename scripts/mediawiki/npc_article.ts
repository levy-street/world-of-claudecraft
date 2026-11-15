import { BUDDIES } from '../../src/sim/content/buddies';
import { TUG_HONOR_OFFER } from '../../src/sim/content/buddy_offers';
import { HEROIC_VENDOR_STOCK } from '../../src/sim/content/heroic_vendor';
import { CRUCIBLE_VENDOR_STOCK } from '../../src/sim/content/ignivar_loot';
import { BUILTIN_WORLD, ITEMS, NPCS, QUESTS, zoneContaining } from '../../src/sim/data';
import { npcRoleFor } from '../../src/sim/npc_role';
import { type NpcDef, questTurnInNpcIds } from '../../src/sim/types';
import { npcDisplayTitle } from '../../src/ui/entity_display_core';
import { type ArticleTools, ref } from './entity_format';
import { itemNpcPoints } from './item_npc_route';
import { npcServiceLabel } from './npc_service';
import { vendorOfferText } from './vendor_offer';

/**
 * The zones an NPC is found in. This is every overworld post the page lists. An NPC that is
 * only there during its activity has no listed post, so it falls back to its authored spot.
 * The zone page and the NPC page both read this, so they always name the same zones.
 */
export function homeZones(id: string) {
  const zones = new Map<string, NonNullable<ReturnType<typeof zoneContaining>>>();
  const points = itemNpcPoints('Reward', id);
  for (const p of points) {
    const z = p.frame === 'Overworld' ? zoneContaining(p.x, p.z) : undefined;
    if (z) zones.set(z.id, z);
  }
  if (points.length) return [...zones.values()];
  const n = BUILTIN_WORLD.npcs[id] ?? NPCS[id];
  const posted = !!n && (n.pos.x !== 0 || n.pos.z !== 0);
  const z = posted ? zoneContaining(n.pos.x, n.pos.z) : undefined;
  return z ? [z] : [];
}

export function npcArticle(template: NpcDef, w: ArticleTools) {
  const n = BUILTIN_WORLD.npcs[template.id] ?? template;
  const locations = itemNpcPoints('Reward', n.id);
  const place = locations.length
    ? locations
        .map((p) => {
          const area =
            p.frame === 'Overworld' ? (zoneContaining(p.x, p.z)?.name ?? 'Overworld') : p.frame;
          return (
            area +
            ' (' +
            Number(p.x.toFixed(2)) +
            ', ' +
            Number(p.z.toFixed(2)) +
            ')' +
            (p.frame === 'Overworld' ? '' : ', measured inside this area')
          );
        })
        .join('; ')
    : homeZones(n.id).length
      ? 'Appears during its activity, in ' +
        homeZones(n.id)
          .map((z) => z.name)
          .join(' and ') +
        '.'
      : 'Appears during its activity.';
  const role = npcRoleFor(n);
  const facts: [string, string][] = [
    ['Title', npcDisplayTitle(n.id)],
    ['Where to find them', place],
  ];
  if (role) facts.push(['Service', npcServiceLabel(role)]);
  const links = (ids: string[]) => w.bullets(ids.map((id) => ref(w, 'quest', id)));
  const offers = Object.values(QUESTS)
    .filter((q) => q.giverNpcId === n.id)
    .map((q) => q.id);
  const turnins = Object.values(QUESTS)
    .filter((q) => questTurnInNpcIds(q).includes(n.id))
    .map((q) => q.id);
  const stock = (n.vendorItems ?? []).map(
    (id) => ref(w, 'item', id) + ' · ' + vendorOfferText(w, n, ITEMS[id]),
  );
  if (n.warfareVendor) {
    const companion = BUDDIES[TUG_HONOR_OFFER.buddy];
    const title = w.titleBy.companion?.get(companion.key);
    stock.push(
      'Unlock ' +
        (title ? w.link(title, companion.name) : companion.name) +
        ' as a companion for ' +
        TUG_HONOR_OFFER.priceHonor.toLocaleString('en-US') +
        ' Honor.',
    );
  }
  if (n.heroicVendor)
    for (const row of HEROIC_VENDOR_STOCK)
      stock.push(ref(w, 'item', row.itemId) + ' · ' + row.marks + ' Heroic Marks');
  if (n.crucibleVendor)
    for (const row of CRUCIBLE_VENDOR_STOCK)
      stock.push(ref(w, 'item', row.itemId) + ' · Exchange ' + ref(w, 'item', row.sigilId));
  return (
    w.section('Greeting', n.greeting) +
    w.section('Details', w.table(facts)) +
    (offers.length ? w.section('Quests offered', links(offers)) : '') +
    (turnins.length ? w.section('Quest hand-ins', links(turnins)) : '') +
    (stock.length ? w.section('Vendor stock', w.bullets(stock)) : '')
  );
}
