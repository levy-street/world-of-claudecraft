// Pure render for the public Character Armory profile. No DOM or Hud dependency,
// so it works on the pre-login landing page and is unit-testable. All player-facing
// labels go through t(); class/spec/item names are content data (English) like the
// rest of the game's content.
import { CLASSES, ITEMS } from '../sim/data';
import { iconDataUrl, QUALITY_COLOR } from './icons';
import { talentsFor, type TalentAllocation } from '../sim/content/talents';
import { t, formatNumber } from './i18n';
import type { ArmoryProfile } from '../world_api';
import type { EquipSlot } from '../sim/types';

const SLOT_KEYS: EquipSlot[] = ['mainhand', 'chest', 'legs', 'feet'];

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function classColorHex(cls: string): string {
  const c = (CLASSES as Record<string, { color?: number; name?: string }>)[cls];
  const n = c && typeof c.color === 'number' ? c.color : 0xffffff;
  return '#' + n.toString(16).padStart(6, '0');
}

function pointsSpent(a: TalentAllocation | null): number {
  if (!a || !a.ranks) return 0;
  return Object.values(a.ranks).reduce((x, y) => x + (Number(y) || 0), 0);
}

function slotLabel(key: EquipSlot): string {
  switch (key) {
    case 'mainhand': return t('armory.mainhand');
    case 'chest': return t('armory.chest');
    case 'legs': return t('armory.legs');
    case 'feet': return t('armory.feet');
    default: return key;
  }
}

function gearSlotHtml(p: ArmoryProfile, key: EquipSlot): string {
  const slotName = slotLabel(key);
  const id = p.equipment[key];
  const item = id ? ITEMS[id] : null;
  if (!item) {
    return `<div class="armory-slot empty">`
      + `<img class="item-icon" src="${iconDataUrl('item', 'slot_empty')}" alt="" draggable="false">`
      + `<div class="armory-slot-info"><div class="armory-slot-name">${esc(slotName)}</div>`
      + `<div class="armory-slot-item empty">${esc(t('armory.empty'))}</div></div></div>`;
  }
  const qc = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff';
  const sub: string[] = [];
  if (item.weapon) {
    const dps = ((item.weapon.min + item.weapon.max) / 2 / item.weapon.speed).toFixed(1);
    sub.push(`${item.weapon.min}-${item.weapon.max} dmg (${dps} dps)`);
  }
  if (item.stats) for (const [k, v] of Object.entries(item.stats)) sub.push(`+${v} ${k}`);
  return `<div class="armory-slot">`
    + `<img class="item-icon q-${item.quality ?? 'common'}" src="${iconDataUrl('item', item.id)}" alt="" draggable="false">`
    + `<div class="armory-slot-info"><div class="armory-slot-name">${esc(slotName)}</div>`
    + `<div class="armory-slot-item" style="color:${qc}">${esc(item.name)}</div>`
    + (sub.length ? `<div class="armory-slot-stats">${esc(sub.join('   '))}</div>` : '')
    + `</div></div>`;
}

export function armoryProfileHtml(p: ArmoryProfile): string {
  const cls = (CLASSES as Record<string, { name?: string }>)[p.cls];
  const className = cls?.name ?? p.cls;
  const color = classColorHex(p.cls);
  const lvlText = t('armory.level', { level: p.level });
  const levelLine = p.level >= 20 && p.virtualLevel > p.level
    ? `${lvlText} <span class="armory-vlevel">(+${p.virtualLevel - p.level})</span>`
    : lvlText;
  const prestige = p.prestigeRank > 0
    ? ` <span class="armory-prestige" title="Prestige ${p.prestigeRank}">&#9733;${p.prestigeRank}</span>` : '';

  const tree = talentsFor(p.cls);
  const spec = tree && p.talents?.spec ? tree.specs.find((s) => s.id === p.talents!.spec) : null;
  const pts = pointsSpent(p.talents);
  const specLine = spec
    ? t('armory.specLine', { spec: `<b style="color:var(--gold)">${esc(spec.name)}</b>`, points: pts })
    : pts > 0 ? t('armory.pointsOnly', { points: pts }) : esc(t('armory.noSpec'));
  const mastery = spec
    ? `<div class="armory-mastery"><span>${esc(t('armory.mastery'))}</span> <b>${esc(spec.mastery.name)}</b><br>${esc(spec.mastery.description)}</div>` : '';

  const arena = (p.arenaWins + p.arenaLosses) > 0
    ? `<div class="armory-stat"><span>${esc(t('armory.arena'))}</span><b>${p.arenaRating} (${p.arenaWins}-${p.arenaLosses})</b></div>` : '';

  return `<div class="armory-card">`
    + `<div class="armory-header" style="border-left-color:${color}">`
      + `<div class="armory-name" style="color:${color}">${esc(p.name)}${prestige}</div>`
      + `<div class="armory-sub">${levelLine} ${esc(className)} &middot; ${esc(p.realm)}</div>`
    + `</div>`
    + `<div class="armory-stats">`
      + `<div class="armory-stat"><span>${esc(t('armory.lifetimeXp'))}</span><b>${formatNumber(p.lifetimeXp)}</b></div>`
      + arena
    + `</div>`
    + `<div class="armory-section-title">${esc(t('armory.equipment'))}</div>`
    + `<div class="armory-gear">${SLOT_KEYS.map((k) => gearSlotHtml(p, k)).join('')}</div>`
    + `<div class="armory-section-title">${esc(t('armory.talents'))}</div>`
    + `<div class="armory-talents">${specLine}${mastery}</div>`
    + `</div>`;
}
