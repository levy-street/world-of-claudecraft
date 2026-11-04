import type { MobTemplate } from '../../src/sim/types';
import { pct, words } from './entity_format';

const traits: Record<string, string> = {
  slumber: 'Remains asleep until awakened.',
  warpath: 'Charges along its attack path.',
  slams: 'Telegraphs a series of ground slams.',
  rangedMechanics: 'Uses ranged attacks against distant targets.',
  starwake: 'Leaves dangerous ground behind its attack.',
  launch: 'Launches its target.',
  eyeWard: 'Shields its eye until the encounter condition is met.',
  collateral: 'Can hit nearby creatures with its attacks.',
  aoePulse: 'Deals damage to targets in range.',
  infernoChannel: 'Channels a series of damaging pulses.',
  breathCone: 'Breathes damage in a frontal cone.',
  engageShout: 'Roots nearby players when the fight begins.',
  counterStun: 'Counters its attacker with a stun.',
  broodEgg: 'Can hatch a creature and trigger nearby eggs.',
  broodWhelp: 'Leaps to an enemy and applies a burn.',
  bigCast: 'Winds up an area attack.',
  deathZoneCast: 'Marks the ground under a player. Leave before the cast finishes or die.',
  deathZoneStrike: 'Marks a lethal area. Leave before the cast finishes.',
  summonAdds: 'Summons reinforcements at the listed health thresholds.',
  enrage: 'Enrages below the health threshold.',
  desperateHeal: 'Heals itself once on crossing its health threshold.',
  rampage: 'Each landed melee swing adds attack power and refreshes the buff.',
  mendAlly: 'Heals wounded allies in range, including itself.',
  wardAllies: 'Shields allies in range.',
  channelHeal: 'Channels a heal that grows with each tick.',
  rally: 'Grants attack power to nearby allies.',
  warcry: 'Increases nearby allies’ attack speed.',
  stomp: 'Stuns nearby enemies.',
  charge: 'Charges a target within the listed distance and stuns it.',
  stoneskin: 'Gains a damage absorption shield.',
  terrify: 'Fears enemies in range.',
  aoeSlow: 'Slows the movement of nearby enemies.',
  cleave: 'Its swing can also hit nearby targets.',
  arcCleave: 'Sweeps a frontal arc.',
  deathThroes: 'Explodes after death.',
  packFrenzy: 'On death, grants attack speed to nearby allies.',
  mortalStrike: 'Reduces the healing the victim receives.',
  healAbsorb: 'Absorbs incoming healing until the amount is spent or the effect expires.',
  lifeleech: 'Heals itself for a fraction of damage dealt.',
  concuss: 'Stuns the victim on a landed melee swing.',
  expose: 'Increases damage taken by the victim.',
  corrode: 'Reduces armor with each stack.',
  spellVuln: 'Increases spell damage taken.',
  staggerHit: 'Reduces the victim’s chance to dodge.',
  ensnare: 'Roots the victim in place.',
  stunOnHit: 'Stuns the victim.',
  slowStrike: 'Slows the victim’s weapon swings.',
  knockback: 'Knocks the victim back.',
  tongues: 'Increases spell cast time.',
  manaBurn: 'Drains mana.',
  sapVigor: 'Drains rage or energy from a melee target. Mana users are unaffected.',
  enfeeble: 'Lowers Intellect.',
  enervate: 'Lowers Stamina.',
  plague: 'Lowers Stamina.',
  wither: 'Lowers Agility.',
  dread: 'Fears the victim.',
  polymorphHex: 'Polymorphs the victim.',
  vulnerability: 'Increases damage taken.',
  silence: 'Blocks nonphysical spell casts.',
  blind: 'Raises the chance the victim misses a weapon attack.',
  disarm: 'Stops melee and ranged auto-attacks.',
  lockout: 'Blocks spells of one school.',
  costTax: 'Raises the resource cost of abilities.',
  chillOnHit: 'Slows movement.',
  demoralize: 'Lowers attack power.',
  siphonSpirit: 'Lowers a mana user’s Spirit.',
  thorns: 'A landed melee swing against this creature damages the attacker.',
  frenzyOnHit: 'Can gain attack speed when struck.',
  spellReflect: 'A surviving hit from a nonphysical spell deals damage back to the caster.',
  hex: 'Lowers damage and healing dealt by the victim.',
  critVuln: 'Increases critical damage taken.',
  purgeOnHit: 'Removes one eligible beneficial effect.',
  petRanged: 'Can attack from range as a companion.',
  petChainPull: 'Pulls an enemy toward its companion.',
  petCleave: 'Can hit additional enemies.',
  petSpell: 'Uses a spell at the listed range and interval.',
  mechanicLevelScale: 'Mechanic damage scales with creature level.',
  trashKit: 'This encounter uses the following special attacks.',
};
const omitted = new Set([
  'name',
  'castId',
  'yell',
  'detonateText',
  'fx',
  'color',
  'icon',
  'templateId',
  'ability',
]);
const units: Record<string, string> = {
  every: 'between uses',
  interval: 'between ticks',
  duration: 'duration',
  delay: 'delay',
  cooldown: 'cooldown',
  castTime: 'cast time',
  windup: 'windup',
  stunDuration: 'stun',
  seconds: 'duration',
};
const labels: Record<string, string> = {
  min: 'minimum damage',
  max: 'maximum damage',
  perTick: 'damage per tick',
  ap: 'attack power',
  agi: 'Agility',
  sta: 'Stamina',
  int: 'Intellect',
  spi: 'Spirit',
  amp: 'amplification',
  mult: 'multiplier',
  hasteMult: 'attack speed multiplier',
  dmgMult: 'damage multiplier',
  belowHpPct: 'triggers below health',
  atHpPct: 'health threshold',
  healPct: 'maximum health restored',
  healFrac: 'share of damage healed',
  pct: 'increase',
  maxStacks: 'stack limit',
  dmgIncrease: 'extra damage taken',
  critDamage: 'extra critical damage taken',
  miss: 'extra miss chance',
};
const ratios = new Set([
  'chance',
  'belowHpPct',
  'atHpPct',
  'healPct',
  'healFrac',
  'healReduction',
  'dmgIncrease',
  'amp',
  'miss',
  'dodgeReduction',
  'reductionPct',
  'critDamage',
  'pct',
  'maxHpPct',
]);
function value(k: string, v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => value(k, x)).join(', ');
  if (typeof v === 'object' && v)
    return Object.entries(v)
      .filter(([key]) => !omitted.has(key))
      .map(([key, x]) => param(key, x))
      .join(', ');
  if (typeof v === 'number') {
    if (ratios.has(k)) return pct(v);
    if (k in units || /Seconds$/.test(k)) return v + ' sec';
    if (/range|radius|distance/i.test(k)) return v + ' yd';
  }
  return typeof v === 'string' ? v.replace(/_/g, ' ') : String(v);
}
function param(k: string, v: unknown): string {
  return (labels[k] ?? units[k] ?? words(k)) + ' ' + value(k, v);
}

export function mobMechanicLines(m: MobTemplate): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(m)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const periodic = [
      'venom',
      'soulrot',
      'bleed',
      'frostbite',
      'smolder',
      'cinder',
      'arcaneRot',
      'stackPoison',
    ].includes(k);
    if (periodic) {
      out.push(
        v.name +
          '. On a landed hit, ' +
          pct(v.chance) +
          ' chance to deal ' +
          v.perTick +
          ' damage every ' +
          v.interval +
          ' sec for ' +
          v.duration +
          ' sec' +
          (v.maxStacks ? ', stacking up to ' + v.maxStacks + ' times' : '') +
          '.',
      );
    } else if (traits[k]) {
      const params = Object.entries(v)
        .filter(([key]) => !omitted.has(key))
        .map(([key, x]) => param(key, x));
      const prefix = v.name ?? words(k)[0].toUpperCase() + words(k).slice(1);
      out.push(prefix + '. ' + traits[k] + (params.length ? ' ' + params.join(', ') + '.' : ''));
    }
  }
  if (m.ccImmune) out.push('Immune to crowd control.');
  if (m.slowImmune) out.push('Immune to movement slows.');
  if (m.ignoreTaunt) out.push('Ignores taunts.');
  if (m.damageFloorPct !== undefined)
    out.push(
      'Damage cannot lower its health below ' + pct(m.damageFloorPct) + ' of maximum health.',
    );
  if (m.rankMechanics?.length)
    out.push(
      'Rift ranks unlock these attacks in order, one each at C, B, A and S: ' +
        m.rankMechanics.map(words).join(', ') +
        '.',
    );
  return out;
}
