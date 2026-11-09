import type { MobTemplate } from '../../src/sim/types';
import { pct, words } from './entity_format';

const traits: Record<string, string> = {
  slumber: 'Stays asleep until something wakes it.',
  warpath: 'Charges along its attack path.',
  slams: 'Shows a warning, then slams the ground several times.',
  rangedMechanics: 'Uses ranged attacks against distant targets.',
  starwake: 'Leaves dangerous ground behind its attack.',
  launch: 'Launches its target.',
  eyeWard: 'Shields its eye until a condition in the fight is met.',
  collateral: 'Can hit nearby creatures with its attacks.',
  aoePulse: 'Damages targets in range.',
  infernoChannel: 'Keeps casting while it sends out damaging pulses.',
  breathCone: 'Breathes in a cone in front of it, damaging targets there.',
  engageShout: 'Roots nearby players when the fight begins.',
  counterStun: 'Hits back at its attacker with a stun.',
  broodEgg: 'Can hatch a creature and trigger nearby eggs.',
  broodWhelp: 'Leaps at an enemy and sets it burning.',
  bigCast: 'Slowly charges up an attack that hits an area.',
  deathZoneCast: 'Marks the ground under a player. Get out before the cast ends, or you die.',
  deathZoneStrike: 'Marks an area that kills anyone inside. Get out before the cast ends.',
  summonAdds: 'Calls in helpers when its health drops to the listed amounts.',
  enrage: 'Becomes enraged when its health drops below the listed amount.',
  desperateHeal: 'Heals itself once when its health drops past the listed amount.',
  rampage: 'Each melee hit that lands gives it more attack power and restarts the buff timer.',
  mendAlly: 'Heals wounded allies in range, including itself.',
  wardAllies: 'Shields allies in range.',
  channelHeal: 'Keeps casting a heal that gets stronger with each tick.',
  rally: 'Grants attack power to nearby allies.',
  warcry: 'Increases nearby allies’ attack speed.',
  stomp: 'Stuns nearby enemies.',
  charge: 'Charges a target within the listed distance and stuns it.',
  stoneskin: 'Gets a shield that absorbs damage.',
  terrify: 'Makes enemies in range run away in fear.',
  aoeSlow: 'Slows the movement of nearby enemies.',
  cleave: 'Its swing can also hit nearby targets.',
  arcCleave: 'Swings in an arc in front of it.',
  deathThroes: 'Explodes after it dies.',
  packFrenzy: 'When it dies, nearby allies attack faster.',
  mortalStrike: 'Lowers the healing the target gets.',
  healAbsorb: 'Soaks up healing the target gets, until the amount is used up or the effect ends.',
  lifeleech: 'Heals itself for part of the damage it deals.',
  concuss: 'Stuns the target when its melee hit lands.',
  expose: 'Makes the target take more damage.',
  corrode: 'Each stack lowers armor.',
  spellVuln: 'Makes the target take more spell damage.',
  staggerHit: 'Lowers the target’s chance to dodge.',
  ensnare: 'Roots the target in place.',
  stunOnHit: 'Stuns the target.',
  slowStrike: 'Slows the target’s weapon swings.',
  knockback: 'Knocks the target back.',
  tongues: 'Makes spells take longer to cast.',
  manaBurn: 'Drains mana.',
  sapVigor: 'Drains Rage or Energy from a melee target. It does not affect mana users.',
  enfeeble: 'Lowers Intellect.',
  enervate: 'Lowers Stamina.',
  plague: 'Lowers Stamina.',
  wither: 'Lowers Agility.',
  dread: 'Makes the target run away in fear.',
  polymorphHex: 'Polymorphs the target.',
  vulnerability: 'Makes the target take more damage.',
  silence: 'Stops non-physical spells from being cast.',
  blind: 'Makes the target more likely to miss with weapon attacks.',
  disarm: 'Stops melee and ranged auto-attacks.',
  lockout: 'Stops spells of one school from being cast.',
  costTax: 'Makes abilities cost more to use.',
  chillOnHit: 'Slows movement.',
  demoralize: 'Lowers attack power.',
  siphonSpirit: 'Lowers a mana user’s Spirit.',
  thorns: 'If you hit it in melee, you take damage back.',
  frenzyOnHit: 'Can start attacking faster after it is hit.',
  spellReflect: 'When a non-physical spell hits it and it survives, the caster takes damage back.',
  hex: 'Lowers the damage and healing the target deals.',
  critVuln: 'Makes the target take more damage from critical hits.',
  purgeOnHit: 'Removes one helpful effect that can be removed.',
  petRanged: 'Can attack from range as a companion.',
  petChainPull: 'Pulls an enemy toward its companion.',
  petCleave: 'Can hit additional enemies.',
  petSpell: 'Uses a spell at the listed range and interval.',
  mechanicLevelScale: 'Its special attacks deal more damage at higher creature levels.',
  trashKit: 'This fight uses these special attacks.',
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
          '. When its attack hits, it has a ' +
          pct(v.chance) +
          ' chance to deal ' +
          v.perTick +
          ' damage every ' +
          v.interval +
          ' sec for ' +
          v.duration +
          ' sec.' +
          (v.maxStacks ? ' Stacks up to ' + v.maxStacks + ' times.' : ''),
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
      'Damage cannot bring its health below ' + pct(m.damageFloorPct) + ' of its maximum health.',
    );
  if (m.rankMechanics?.length)
    out.push(
      'In Rifts, each rank adds the next attack on this list. Rank C uses the first one, B the first two, A the first three and S the first four: ' +
        m.rankMechanics.map(words).join(', ') +
        '.',
    );
  return out;
}
