import {
  type ClassTalents,
  type GlobalModEffect,
  type Role,
  type SpecDef,
  type StatModEffect,
  TALENTS,
  type TalentChoiceOption,
  type TalentEffect,
  type TalentNode,
} from '../sim/content/talents';
import { CHOICE_ROWS, type ChoiceRowOption } from '../sim/content/choice_rows';
import { ABILITIES } from '../sim/data';
import type { PlayerClass } from '../sim/types';
import { tEntity } from './entity_i18n';
import { getLanguage, languageTag, type SupportedLanguage, t } from './i18n';
import { TALENT_NEW } from './talent_i18n.newlocales';

// Localized UI label for a spec's combat role (tank/healer/dps). Shared by the
// talents window (spec cards) and the character sheet's spec summary so the role
// name reads identically in both. Distinct from the lowercased role words used to
// generate talent descriptions (localeText.roleLabels below).
export function roleLabel(role: Role): string {
  return role === 'tank'
    ? t('game.talents.roleTank')
    : role === 'healer'
      ? t('game.talents.roleHealer')
      : t('game.talents.roleDps');
}

export type TalentTranslationKind = 'talentNode' | 'talentChoice' | 'talentSpec' | 'talentMastery';
export type TalentTranslationField = 'name' | 'description';

export type TalentTranslationRequest =
  | { kind: 'talentNode'; node: TalentNode; field: TalentTranslationField }
  | {
      kind: 'talentChoice';
      choice: TalentChoiceOption | ChoiceRowOption;
      field: TalentTranslationField;
    }
  | { kind: 'talentSpec'; spec: SpecDef; field: TalentTranslationField }
  | { kind: 'talentMastery'; spec: SpecDef; field: TalentTranslationField };

export interface TalentTranslationManifestEntry {
  kind: TalentTranslationKind;
  id: string;
  classId: PlayerClass;
  specId?: string;
  field: TalentTranslationField;
  source: string;
}

type StatKey = keyof StatModEffect;
type GlobalKey = keyof GlobalModEffect;
type DisplayGlobalKey = Exclude<GlobalKey, 'critVsRooted'>;

export interface TalentLocaleText {
  // Primary-attribute multipliers (strPct/agiPct/intPct/spiPct) reuse their base stat
  // label ("+10% Agility"), so locales don't repeat them here.
  statLabels: Record<
    | Exclude<StatKey, 'strPct' | 'agiPct' | 'intPct' | 'spiPct'>
    | DisplayGlobalKey
    | 'damage'
    | 'cost'
    | 'cooldown'
    | 'castTime'
    | 'castWhileMoving'
    | 'spellCritVsRooted',
    string
  >;
  roleLabels: Record<'tank' | 'healer' | 'dps', string>;
  perRank: string;
  noEffect: string;
  chooseOne: (name: string) => string;
  specDescription: (className: string, role: string, abilityName: string) => string;
  grant: (abilityName: string) => string;
  increase: (target: string, amount: string, perRank: string) => string;
  reduce: (target: string, amount: string, perRank: string) => string;
  castWhileMoving: (abilityName: string) => string;
  addRoot: (abilityName: string, seconds: string) => string;
  addAoeRoot: (abilityName: string, seconds: string) => string;
  addInterrupt: (abilityName: string, seconds: string) => string;
  addDot: (abilityName: string, amount: string, seconds: string) => string;
  addLeechDot: (abilityName: string, amount: string, seconds: string) => string;
}

const abilityIdByName = new Map(
  Object.values(ABILITIES).map((ability) => [ability.name, ability.id]),
);

const choiceRowTitleSources = new Set([
  'Juggernaut',
  'Warbringer',
  'Concussive Clap',
  'Crippling Strikes',
  'Furious Bloodrage',
  'Commanding Presence',
  'Executioner',
  'Iron Hide',
  'Firestarter',
  'Impulse',
  'Mana Attunement',
  'Ice Nova',
  'Quick Wits',
  'Shatter',
  'Permafrost',
  'Hot Streak',
  'Netherwind',
  'Battlemage Armor',
  "Crusader's Zeal",
  'Blessed Momentum',
  'Vengeful Exorcism',
  'Fist of Justice',
  'Consecrated Ground',
  'Divine Wisdom',
  "Guardian's Favor",
  'Greater Blessing',
  'Righteous Cause',
  'Sacred Ward',
  'Ardent Defender',
  'Aura Mastery',
  'Improved Serpent Sting',
  'Quick Shots',
  'Aspect Mastery',
  'Improved Concussive',
  'Efficiency',
  'Survival Instincts',
  'Sniper Training',
  "Serpent's Venom",
  'Master Tamer',
  'Thick Hide',
  'Improved Volley',
  'Rapid Killing',
  'Relentless Strikes',
  'Improved Backstab',
  'Opportunist',
  'Improved Gouge',
  'Improved Kidney Shot',
  'Endurance',
  'Improved Slice and Dice',
  'Seal Fate',
  'Deadly Brew',
  'Improved Evasion',
  'Cheat Death',
  'Adrenaline Junkie',
  'Master Assassin',
  'Searing Light',
  'Improved Renew',
  'Twisted Faith',
  'Improved Shield',
  'Meditation',
  'Vampiric Embrace',
  'Mind Melt',
  'Greater Heal',
  'Pain and Suffering',
  'Improved Fortitude',
  'Inner Fire',
  'Blessed Recovery',
  'Concussion',
  'Improved Lightning Shield',
  'Imbue Mastery',
  'Improved Earth Shock',
  'Frost Bind',
  'Shock Efficiency',
  'Ancestral Guidance',
  'Elemental Attunement',
  'Improved Flame Shock',
  'Weapon Fury',
  'Improved Ghost Wolf',
  'Elemental Warding',
  'Elemental Fury',
  'Tidal Waves',
  'Bane',
  'Improved Corruption',
  'Improved Immolate',
  'Improved Life Tap',
  'Fel Concentration',
  'Demon Armor',
  'Amplify Curse',
  'Ruin',
  'Shadow Mastery',
  'Improved Fear',
  'Demonic Resilience',
  'Curse Mastery',
  'Improved Wrath',
  'Ferocity',
  "Nature's Bounty",
  'Improved Roots',
  'Brutal Bash',
  'Furor',
  'Improved Mark',
  'Savage Fury',
  'Moonfury',
  'Empowered Touch',
  'Improved Barkskin',
  'Survival of the Fittest',
  'Improved Hurricane',
]);

const rowTitleDirect: Partial<Record<SupportedLanguage, Record<string, string>>> = {
  es: {
    Juggernaut: 'Fuerza imparable',
    Warbringer: 'Portador de guerra',
    Firestarter: 'Iniciador de fuego',
    Impulse: 'Impulso',
    'Mana Attunement': 'Sintonía de maná',
    'Ice Nova': 'Nova de hielo',
    'Quick Wits': 'Ingenio rápido',
    Shatter: 'Resquebrajar',
    Permafrost: 'Escarcha permanente',
    'Hot Streak': 'Buena racha',
    Netherwind: 'Viento abisal',
    'Battlemage Armor': 'Armadura de mago de batalla',
  },
  fr_FR: {
    Juggernaut: 'Force irrésistible',
    Warbringer: 'Porte-guerre',
    Firestarter: 'Boutefeu',
    Impulse: 'Impulsion',
    'Mana Attunement': 'Harmonisation du mana',
    'Ice Nova': 'Nova de glace',
    'Quick Wits': 'Vivacité d’esprit',
    Shatter: 'Fracasser',
    Permafrost: 'Pergélisol',
    'Hot Streak': 'Bonne série',
    Netherwind: 'Vent du Néant',
    'Battlemage Armor': 'Armure de mage de bataille',
  },
  it_IT: {
    Juggernaut: 'Forza inarrestabile',
    Warbringer: 'Portaguerra',
    Firestarter: 'Accendifuoco',
    Impulse: 'Impulso',
    'Mana Attunement': 'Sintonia del mana',
    'Ice Nova': 'Nova di ghiaccio',
    'Quick Wits': 'Prontezza mentale',
    Shatter: 'Frantumazione',
    Permafrost: 'Gelo perenne',
    'Hot Streak': 'Serie rovente',
    Netherwind: 'Vento Fatui',
    'Battlemage Armor': 'Armatura da mago guerriero',
  },
  de_DE: {
    Juggernaut: 'Unaufhaltsame Macht',
    Warbringer: 'Kriegsbringer',
    Firestarter: 'Feuerstarter',
    Impulse: 'Impuls',
    'Mana Attunement': 'Manaeinstimmung',
    'Ice Nova': 'Eisnova',
    'Quick Wits': 'Schnelle Auffassung',
    Shatter: 'Zertrümmern',
    Permafrost: 'Permafrost',
    'Hot Streak': 'Glückssträhne',
    Netherwind: 'Netherwind',
    'Battlemage Armor': 'Kampfmagier-Rüstung',
  },
  zh_CN: {
    Juggernaut: '势不可挡',
    Warbringer: '战争使者',
    Firestarter: '纵火者',
    Impulse: '冲动',
    'Mana Attunement': '法力协调',
    'Ice Nova': '冰霜新星',
    'Quick Wits': '急智',
    Shatter: '碎冰',
    Permafrost: '永久冻土',
    'Hot Streak': '炽热连击',
    Netherwind: '虚空之风',
    'Battlemage Armor': '战斗法师护甲',
  },
  zh_TW: {
    Juggernaut: '勢不可擋',
    Warbringer: '戰爭使者',
    Firestarter: '縱火者',
    Impulse: '衝動',
    'Mana Attunement': '法力協調',
    'Ice Nova': '冰霜新星',
    'Quick Wits': '急智',
    Shatter: '碎冰',
    Permafrost: '永久凍土',
    'Hot Streak': '熾熱連擊',
    Netherwind: '虛空之風',
    'Battlemage Armor': '戰鬥法師護甲',
  },
  ko_KR: {
    Juggernaut: '거침없는 돌진',
    Warbringer: '전쟁인도자',
    Firestarter: '화염 시동',
    Impulse: '충동',
    'Mana Attunement': '마나 조율',
    'Ice Nova': '얼음 회오리',
    'Quick Wits': '빠른 재치',
    Shatter: '산산조각',
    Permafrost: '영구 동토',
    'Hot Streak': '몰아치는 열기',
    Netherwind: '황천바람',
    'Battlemage Armor': '전투마법사 갑옷',
  },
  ja_JP: {
    Juggernaut: '止められぬ突進',
    Warbringer: '戦の先触れ',
    Firestarter: '火付け役',
    Impulse: '衝動',
    'Mana Attunement': 'マナ同調',
    'Ice Nova': 'アイスノヴァ',
    'Quick Wits': '機転',
    Shatter: '粉砕',
    Permafrost: '永久凍土',
    'Hot Streak': '熱い連続',
    Netherwind: 'ネザーウィンド',
    'Battlemage Armor': '戦闘魔導士の鎧',
  },
  pt_BR: {
    Juggernaut: 'Força imparável',
    Warbringer: 'Arauto da guerra',
    Firestarter: 'Iniciador de chamas',
    Impulse: 'Impulso',
    'Mana Attunement': 'Sintonia de mana',
    'Ice Nova': 'Nova de gelo',
    'Quick Wits': 'Raciocínio rápido',
    Shatter: 'Estilhaçar',
    Permafrost: 'Permafrost',
    'Hot Streak': 'Sequência quente',
    Netherwind: 'Vento etéreo',
    'Battlemage Armor': 'Armadura de mago de batalha',
  },
  ru_RU: {
    Juggernaut: 'Неудержимая сила',
    Warbringer: 'Вестник войны',
    Firestarter: 'Зачинатель огня',
    Impulse: 'Импульс',
    'Mana Attunement': 'Настройка маны',
    'Ice Nova': 'Ледяная звезда',
    'Quick Wits': 'Живой ум',
    Shatter: 'Раскалывание',
    Permafrost: 'Вечная мерзлота',
    'Hot Streak': 'Полоса удачи',
    Netherwind: 'Ветер Пустоты',
    'Battlemage Armor': 'Броня боевого мага',
  },
};

const rowTitleTermText: Partial<
  Record<SupportedLanguage, { improved: string; greater: string; mastery: string; unknown: string }>
> = {
  es: { improved: 'Mejora de', greater: 'Mayor', mastery: 'Maestría de', unknown: 'Talento' },
  fr_FR: { improved: 'Amélioration de', greater: 'Supérieur', mastery: 'Maîtrise de', unknown: 'Talent' },
  it_IT: { improved: 'Miglioramento di', greater: 'Superiore', mastery: 'Maestria di', unknown: 'Talento' },
  de_DE: { improved: 'Verbesserter', greater: 'Großer', mastery: 'Meisterschaft der', unknown: 'Talent' },
  zh_CN: { improved: '强化', greater: '强效', mastery: '精通', unknown: '天赋' },
  zh_TW: { improved: '強化', greater: '強效', mastery: '精通', unknown: '天賦' },
  ko_KR: { improved: '강화', greater: '상급', mastery: '숙련', unknown: '특성' },
  ja_JP: { improved: '強化', greater: '上級', mastery: '熟達', unknown: 'タレント' },
  pt_BR: { improved: 'Aprimoramento de', greater: 'Maior', mastery: 'Maestria de', unknown: 'Talento' },
  ru_RU: { improved: 'Улучшение:', greater: 'Великое', mastery: 'Мастерство:', unknown: 'Талант' },
  nl_NL: { improved: 'Verbetering van', greater: 'Groter', mastery: 'Meesterschap van', unknown: 'Talent' },
  pl_PL: { improved: 'Ulepszenie:', greater: 'Większe', mastery: 'Mistrzostwo:', unknown: 'Talent' },
  id_ID: { improved: 'Peningkatan', greater: 'Lebih Kuat', mastery: 'Penguasaan', unknown: 'Talenta' },
  tr_TR: { improved: 'Geliştirilmiş', greater: 'Büyük', mastery: 'Ustalığı', unknown: 'Yetenek' },
  sv_SE: { improved: 'Förbättrad', greater: 'Större', mastery: 'Mästerskap i', unknown: 'Talang' },
  vi_VN: { improved: 'Cường hóa', greater: 'Cao cấp', mastery: 'Tinh thông', unknown: 'Tài năng' },
  da_DK: { improved: 'Forbedret', greater: 'Større', mastery: 'Mesterskab i', unknown: 'Talent' },
};

function translateChoiceRowTitle(source: string, lang: SupportedLanguage): string | undefined {
  if (!choiceRowTitleSources.has(source)) return undefined;
  const baseLang = lang === 'es_ES' ? 'es' : lang === 'fr_CA' ? 'fr_FR' : lang;
  const direct = rowTitleDirect[baseLang]?.[source];
  if (direct) return direct;
  const terms = rowTitleTermText[baseLang];
  if (!terms) return undefined;
  const ability = [...abilityIdByName.entries()]
    .sort((a, b) => b[0].length - a[0].length)
    .find(([name]) => source.includes(name));
  if (source.startsWith('Improved ') && ability) {
    return `${terms.improved} ${abilityName(ability[1])}`;
  }
  if (source.endsWith(' Mastery') && ability) {
    return `${terms.mastery} ${abilityName(ability[1])}`;
  }
  if (source.startsWith('Greater ') && ability) {
    return `${terms.greater} ${abilityName(ability[1])}`;
  }
  if (baseLang === 'zh_CN') return `抉择${[...choiceRowTitleSources].indexOf(source) + 101}`;
  if (baseLang === 'zh_TW') return `抉擇${[...choiceRowTitleSources].indexOf(source) + 101}`;
  if (baseLang === 'ko_KR') return `선택 ${[...choiceRowTitleSources].indexOf(source) + 101}`;
  if (baseLang === 'ja_JP') return `選択${[...choiceRowTitleSources].indexOf(source) + 101}`;
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
  return `${terms.unknown} ${slug}`;
}

const enText: TalentLocaleText = {
  statLabels: {
    str: 'Strength',
    agi: 'Agility',
    sta: 'Stamina',
    int: 'Intellect',
    spi: 'Spirit',
    armor: 'armor',
    ap: 'attack power',
    crit: 'critical strike chance',
    dodge: 'dodge chance',
    apPct: 'attack power',
    staPct: 'Stamina',
    armorPct: 'armor',
    maxHpPct: 'maximum health',
    meleeDmgPct: 'melee ability damage',
    spellDmgPct: 'spell damage',
    healPct: 'healing done',
    threatPct: 'threat generated',
    damage: 'damage',
    cost: 'cost',
    cooldown: 'cooldown',
    castTime: 'cast time',
    castWhileMoving: 'castable while moving',
    spellCritVsRooted: 'spell critical chance against rooted targets',
  },
  roleLabels: { tank: 'tank', healer: 'healer', dps: 'damage' },
  perRank: ' per rank',
  noEffect: 'Provides a specialization benefit.',
  chooseOne: (name) => `Choose one ${name} option.`,
  specDescription: (className, role, abilityName) =>
    `${className} specialization focused on ${role}. Signature ability: ${abilityName}.`,
  grant: (abilityName) => `Grants ${abilityName}.`,
  increase: (target, amount, perRank) => `Increases ${target} by ${amount}${perRank}.`,
  reduce: (target, amount, perRank) => `Reduces ${target} by ${amount}${perRank}.`,
  castWhileMoving: (abilityName) => `${abilityName} is castable while moving.`,
  addRoot: (abilityName, seconds) => `${abilityName} also roots the target for ${seconds} sec.`,
  addAoeRoot: (abilityName, seconds) => `${abilityName} also roots targets hit for ${seconds} sec.`,
  addInterrupt: (abilityName, seconds) =>
    `${abilityName} also interrupts spellcasting for a ${seconds} sec school lockout.`,
  addDot: (abilityName, amount, seconds) =>
    `${abilityName} also applies ${amount} damage over ${seconds} sec.`,
  addLeechDot: (abilityName, amount, seconds) =>
    `${abilityName} also heals you for up to ${amount} over ${seconds} sec.`,
};

// The non-dialect locales. es_ES and fr_CA are not declared here; they are pure
// dialect aliases assembled into `localeText` below (no `{} as` cast).
const localeTextByBase = {
  en: enText,
  en_CA: enText,
  es: {
    statLabels: {
      str: 'Fuerza',
      agi: 'Agilidad',
      sta: 'Aguante',
      int: 'Intelecto',
      spi: 'Espíritu',
      armor: 'armadura',
      ap: 'poder de ataque',
      crit: 'probabilidad de golpe crítico',
      dodge: 'probabilidad de esquivar',
      apPct: 'poder de ataque',
      staPct: 'Aguante',
      armorPct: 'armadura',
      maxHpPct: 'salud máxima',
      meleeDmgPct: 'daño de habilidades cuerpo a cuerpo',
      spellDmgPct: 'daño con hechizos',
      healPct: 'sanación realizada',
      threatPct: 'amenaza generada',
      damage: 'daño',
      cost: 'coste',
      cooldown: 'reutilización',
      castTime: 'tiempo de lanzamiento',
      castWhileMoving: 'lanzable en movimiento',
      spellCritVsRooted: 'probabilidad de golpe crítico con hechizos contra objetivos enraizados',
    },
    roleLabels: { tank: 'tanque', healer: 'sanación', dps: 'daño' },
    perRank: ' por rango',
    noEffect: 'Aporta una ventaja de especialización.',
    chooseOne: (name) => `Elige una opción de ${name}.`,
    specDescription: (className, role, abilityName) =>
      `Especialización de ${className} centrada en ${role}. Habilidad distintiva: ${abilityName}.`,
    grant: (abilityName) => `Otorga ${abilityName}.`,
    increase: (target, amount, perRank) => `Aumenta ${target} en ${amount}${perRank}.`,
    reduce: (target, amount, perRank) => `Reduce ${target} en ${amount}${perRank}.`,
    castWhileMoving: (abilityName) => `${abilityName} se puede lanzar en movimiento.`,
    addRoot: (abilityName, seconds) => `${abilityName} también enraíza al objetivo durante ${seconds} s.`,
    addAoeRoot: (abilityName, seconds) =>
      `${abilityName} también enraíza a los objetivos alcanzados durante ${seconds} s.`,
    addInterrupt: (abilityName, seconds) =>
      `${abilityName} también interrumpe el lanzamiento y bloquea esa escuela durante ${seconds} s.`,
    addDot: (abilityName, amount, seconds) =>
      `${abilityName} también aplica ${amount} de daño durante ${seconds} s.`,
    addLeechDot: (abilityName, amount, seconds) =>
      `${abilityName} también te sana hasta ${amount} durante ${seconds} s.`,
  },
  fr_FR: {
    statLabels: {
      str: 'Force',
      agi: 'Agilité',
      sta: 'Endurance',
      int: 'Intelligence',
      spi: 'Esprit',
      armor: 'armure',
      ap: "puissance d'attaque",
      crit: 'chances de coup critique',
      dodge: "chances d'esquive",
      apPct: "puissance d'attaque",
      staPct: 'Endurance',
      armorPct: 'armure',
      maxHpPct: 'points de vie maximum',
      meleeDmgPct: 'dégâts des techniques de mêlée',
      spellDmgPct: 'dégâts des sorts',
      healPct: 'soins prodigués',
      threatPct: 'menace générée',
      damage: 'dégâts',
      cost: 'coût',
      cooldown: 'temps de recharge',
      castTime: "temps d'incantation",
      castWhileMoving: 'incantable en déplacement',
      spellCritVsRooted: 'chances de coup critique des sorts contre les cibles enracinées',
    },
    roleLabels: { tank: 'tank', healer: 'soigneur', dps: 'dégâts' },
    perRank: ' par rang',
    noEffect: 'Apporte un avantage de spécialisation.',
    chooseOne: (name) => `Choisissez une option de ${name}.`,
    specDescription: (className, role, abilityName) =>
      `Spécialisation de ${className} axée sur ${role}. Technique signature : ${abilityName}.`,
    grant: (abilityName) => `Octroie ${abilityName}.`,
    increase: (target, amount, perRank) => `Augmente ${target} de ${amount}${perRank}.`,
    reduce: (target, amount, perRank) => `Réduit ${target} de ${amount}${perRank}.`,
    castWhileMoving: (abilityName) => `${abilityName} peut être incanté en déplacement.`,
    addRoot: (abilityName, seconds) => `${abilityName} enracine aussi la cible pendant ${seconds} s.`,
    addAoeRoot: (abilityName, seconds) =>
      `${abilityName} enracine aussi les cibles touchées pendant ${seconds} s.`,
    addInterrupt: (abilityName, seconds) =>
      `${abilityName} interrompt aussi l'incantation et verrouille cette école pendant ${seconds} s.`,
    addDot: (abilityName, amount, seconds) =>
      `${abilityName} applique aussi ${amount} points de dégâts en ${seconds} s.`,
    addLeechDot: (abilityName, amount, seconds) =>
      `${abilityName} vous rend aussi jusqu'à ${amount} points de vie en ${seconds} s.`,
  },
  it_IT: {
    statLabels: {
      str: 'Forza',
      agi: 'Agilità',
      sta: 'Tempra',
      int: 'Intelletto',
      spi: 'Spirito',
      armor: 'armatura',
      ap: "potenza d'attacco",
      crit: 'probabilità di critico',
      dodge: 'probabilità di schivata',
      apPct: "potenza d'attacco",
      staPct: 'Tempra',
      armorPct: 'armatura',
      maxHpPct: 'salute massima',
      meleeDmgPct: 'danni delle abilità da mischia',
      spellDmgPct: 'danni magici',
      healPct: 'cure effettuate',
      threatPct: 'minaccia generata',
      damage: 'danni',
      cost: 'costo',
      cooldown: 'tempo di recupero',
      castTime: 'tempo di lancio',
      castWhileMoving: 'lanciabile in movimento',
      spellCritVsRooted: 'probabilità di critico magico contro bersagli immobilizzati',
    },
    roleLabels: { tank: 'difesa', healer: 'cura', dps: 'danno' },
    perRank: ' per grado',
    noEffect: 'Fornisce un beneficio di specializzazione.',
    chooseOne: (name) => `Scegli un'opzione di ${name}.`,
    specDescription: (className, role, abilityName) =>
      `Specializzazione da ${className} concentrata su ${role}. Abilità distintiva: ${abilityName}.`,
    grant: (abilityName) => `Conferisce ${abilityName}.`,
    increase: (target, amount, perRank) => `Aumenta ${target} di ${amount}${perRank}.`,
    reduce: (target, amount, perRank) => `Riduce ${target} di ${amount}${perRank}.`,
    castWhileMoving: (abilityName) => `${abilityName} può essere lanciato in movimento.`,
    addRoot: (abilityName, seconds) => `${abilityName} immobilizza anche il bersaglio per ${seconds} s.`,
    addAoeRoot: (abilityName, seconds) =>
      `${abilityName} immobilizza anche i bersagli colpiti per ${seconds} s.`,
    addInterrupt: (abilityName, seconds) =>
      `${abilityName} interrompe anche il lancio e blocca quella scuola per ${seconds} s.`,
    addDot: (abilityName, amount, seconds) =>
      `${abilityName} applica anche ${amount} danni in ${seconds} s.`,
    addLeechDot: (abilityName, amount, seconds) =>
      `${abilityName} ti cura anche fino a ${amount} in ${seconds} s.`,
  },
  de_DE: {
    statLabels: {
      str: 'Stärke',
      agi: 'Beweglichkeit',
      sta: 'Ausdauer',
      int: 'Intelligenz',
      spi: 'Willenskraft',
      armor: 'Rüstung',
      ap: 'Angriffskraft',
      crit: 'kritische Trefferchance',
      dodge: 'Ausweichchance',
      apPct: 'Angriffskraft',
      staPct: 'Ausdauer',
      armorPct: 'Rüstung',
      maxHpPct: 'maximale Gesundheit',
      meleeDmgPct: 'Schaden von Nahkampffähigkeiten',
      spellDmgPct: 'Zauberschaden',
      healPct: 'gewirkte Heilung',
      threatPct: 'erzeugte Bedrohung',
      damage: 'Schaden',
      cost: 'Kosten',
      cooldown: 'Abklingzeit',
      castTime: 'Wirkzeit',
      castWhileMoving: 'beim Bewegen wirkbar',
      spellCritVsRooted: 'kritische Zaubertrefferchance gegen festgewurzelte Ziele',
    },
    roleLabels: { tank: 'Tank', healer: 'Heilung', dps: 'Schaden' },
    perRank: ' pro Rang',
    noEffect: 'Gewährt einen Spezialisierungsvorteil.',
    chooseOne: (name) => `Wähle eine Option für ${name}.`,
    specDescription: (className, role, abilityName) =>
      `${className}-Spezialisierung mit Fokus auf ${role}. Signaturfähigkeit: ${abilityName}.`,
    grant: (abilityName) => `Gewährt ${abilityName}.`,
    increase: (target, amount, perRank) => `Erhöht ${target} um ${amount}${perRank}.`,
    reduce: (target, amount, perRank) => `Verringert ${target} um ${amount}${perRank}.`,
    castWhileMoving: (abilityName) => `${abilityName} kann beim Bewegen gewirkt werden.`,
    addRoot: (abilityName, seconds) => `${abilityName} verwurzelt das Ziel zusätzlich für ${seconds} Sek.`,
    addAoeRoot: (abilityName, seconds) =>
      `${abilityName} verwurzelt getroffene Ziele zusätzlich für ${seconds} Sek.`,
    addInterrupt: (abilityName, seconds) =>
      `${abilityName} unterbricht zusätzlich das Wirken und sperrt die Schule für ${seconds} Sek.`,
    addDot: (abilityName, amount, seconds) =>
      `${abilityName} verursacht zusätzlich ${amount} Schaden über ${seconds} Sek.`,
    addLeechDot: (abilityName, amount, seconds) =>
      `${abilityName} heilt Euch zusätzlich um bis zu ${amount} über ${seconds} Sek.`,
  },
  zh_CN: {
    statLabels: {
      str: '力量',
      agi: '敏捷',
      sta: '耐力',
      int: '智力',
      spi: '精神',
      armor: '护甲',
      ap: '攻击强度',
      crit: '暴击几率',
      dodge: '闪避几率',
      apPct: '攻击强度',
      staPct: '耐力',
      armorPct: '护甲',
      maxHpPct: '最大生命值',
      meleeDmgPct: '近战技能伤害',
      spellDmgPct: '法术伤害',
      healPct: '治疗量',
      threatPct: '威胁值',
      damage: '伤害',
      cost: '消耗',
      cooldown: '冷却时间',
      castTime: '施法时间',
      castWhileMoving: '可在移动中施放',
      spellCritVsRooted: '对被定身目标的法术暴击几率',
    },
    roleLabels: { tank: '坦克', healer: '治疗', dps: '伤害输出' },
    perRank: '/每级',
    noEffect: '提供一个专精增益。',
    chooseOne: (name) => `选择一个${name}选项。`,
    specDescription: (className, role, abilityName) =>
      `${className}专精，侧重${role}。标志技能：${abilityName}。`,
    grant: (abilityName) => `获得${abilityName}。`,
    increase: (target, amount, perRank) => `使${target}提高${amount}${perRank}。`,
    reduce: (target, amount, perRank) => `使${target}降低${amount}${perRank}。`,
    castWhileMoving: (abilityName) => `${abilityName}可在移动中施放。`,
    addRoot: (abilityName, seconds) => `${abilityName}还会使目标定身${seconds}秒。`,
    addAoeRoot: (abilityName, seconds) => `${abilityName}还会使命中的目标定身${seconds}秒。`,
    addInterrupt: (abilityName, seconds) =>
      `${abilityName}还会打断施法，并使该法术系锁定${seconds}秒。`,
    addDot: (abilityName, amount, seconds) =>
      `${abilityName}还会在${seconds}秒内造成${amount}点伤害。`,
    addLeechDot: (abilityName, amount, seconds) =>
      `${abilityName}还会在${seconds}秒内为你恢复最多${amount}点生命值。`,
  },
  zh_TW: {
    statLabels: {
      str: '力量',
      agi: '敏捷',
      sta: '耐力',
      int: '智力',
      spi: '精神',
      armor: '護甲',
      ap: '攻擊強度',
      crit: '致命一擊機率',
      dodge: '閃避機率',
      apPct: '攻擊強度',
      staPct: '耐力',
      armorPct: '護甲',
      maxHpPct: '最大生命值',
      meleeDmgPct: '近戰技能傷害',
      spellDmgPct: '法術傷害',
      healPct: '治療量',
      threatPct: '威脅值',
      damage: '傷害',
      cost: '消耗',
      cooldown: '冷卻時間',
      castTime: '施法時間',
      castWhileMoving: '可在移動中施放',
      spellCritVsRooted: '對被定身目標的法術致命一擊機率',
    },
    roleLabels: { tank: '坦克', healer: '治療', dps: '傷害輸出' },
    perRank: '/每級',
    noEffect: '提供一個專精增益。',
    chooseOne: (name) => `選擇一個${name}選項。`,
    specDescription: (className, role, abilityName) =>
      `${className}專精，側重${role}。代表技能：${abilityName}。`,
    grant: (abilityName) => `獲得${abilityName}。`,
    increase: (target, amount, perRank) => `使${target}提高${amount}${perRank}。`,
    reduce: (target, amount, perRank) => `使${target}降低${amount}${perRank}。`,
    castWhileMoving: (abilityName) => `${abilityName}可在移動中施放。`,
    addRoot: (abilityName, seconds) => `${abilityName}還會使目標定身${seconds}秒。`,
    addAoeRoot: (abilityName, seconds) => `${abilityName}還會使命中的目標定身${seconds}秒。`,
    addInterrupt: (abilityName, seconds) =>
      `${abilityName}還會打斷施法，並使該法術系鎖定${seconds}秒。`,
    addDot: (abilityName, amount, seconds) =>
      `${abilityName}還會在${seconds}秒內造成${amount}點傷害。`,
    addLeechDot: (abilityName, amount, seconds) =>
      `${abilityName}還會在${seconds}秒內為你恢復最多${amount}點生命值。`,
  },
  ko_KR: {
    statLabels: {
      str: '힘',
      agi: '민첩',
      sta: '체력',
      int: '지능',
      spi: '정신력',
      armor: '방어도',
      ap: '전투력',
      crit: '치명타율',
      dodge: '회피율',
      apPct: '전투력',
      staPct: '체력',
      armorPct: '방어도',
      maxHpPct: '최대 생명력',
      meleeDmgPct: '근접 능력 피해',
      spellDmgPct: '주문 피해',
      healPct: '치유량',
      threatPct: '생성 위협',
      damage: '피해',
      cost: '소모량',
      cooldown: '재사용 대기시간',
      castTime: '시전 시간',
      castWhileMoving: '이동 중 시전 가능',
      spellCritVsRooted: '이동 불가 대상에 대한 주문 치명타율',
    },
    roleLabels: { tank: '방어', healer: '치유', dps: '피해' },
    perRank: '/등급',
    noEffect: '전문화 보너스를 제공합니다.',
    chooseOne: (name) => `${name} 선택지 하나를 고르세요.`,
    specDescription: (className, role, abilityName) =>
      `${role}에 집중하는 ${className} 전문화입니다. 대표 능력: ${abilityName}.`,
    grant: (abilityName) => `${abilityName}을 얻습니다.`,
    increase: (target, amount, perRank) => `${target}이 ${amount}${perRank} 증가합니다.`,
    reduce: (target, amount, perRank) => `${target}이 ${amount}${perRank} 감소합니다.`,
    castWhileMoving: (abilityName) => `${abilityName}을 이동 중에 시전할 수 있습니다.`,
    addRoot: (abilityName, seconds) => `${abilityName}이 대상을 ${seconds}초 동안 이동 불가로 만듭니다.`,
    addAoeRoot: (abilityName, seconds) =>
      `${abilityName}이 적중한 대상들을 ${seconds}초 동안 이동 불가로 만듭니다.`,
    addInterrupt: (abilityName, seconds) =>
      `${abilityName}이 시전을 방해하고 해당 계열을 ${seconds}초 동안 차단합니다.`,
    addDot: (abilityName, amount, seconds) =>
      `${abilityName}이 ${seconds}초에 걸쳐 ${amount}의 피해를 추가로 줍니다.`,
    addLeechDot: (abilityName, amount, seconds) =>
      `${abilityName}이 ${seconds}초에 걸쳐 최대 ${amount}만큼 당신을 치유합니다.`,
  },
  ja_JP: {
    statLabels: {
      str: '筋力',
      agi: '敏捷性',
      sta: 'スタミナ',
      int: '知力',
      spi: '精神力',
      armor: '防御力',
      ap: '攻撃力',
      crit: 'クリティカル率',
      dodge: '回避率',
      apPct: '攻撃力',
      staPct: 'スタミナ',
      armorPct: '防御力',
      maxHpPct: '最大体力',
      meleeDmgPct: '近接アビリティダメージ',
      spellDmgPct: '呪文ダメージ',
      healPct: '回復量',
      threatPct: '生成脅威',
      damage: 'ダメージ',
      cost: 'コスト',
      cooldown: 'クールダウン',
      castTime: '詠唱時間',
      castWhileMoving: '移動中に詠唱可能',
      spellCritVsRooted: '足止め中の対象への呪文クリティカル率',
    },
    roleLabels: { tank: 'タンク', healer: '回復', dps: 'ダメージ' },
    perRank: '/ランク',
    noEffect: '専門化ボーナスを提供します。',
    chooseOne: (name) => `${name}の選択肢を1つ選びます。`,
    specDescription: (className, role, abilityName) =>
      `${role}に重点を置く${className}専門化。シグネチャ能力: ${abilityName}。`,
    grant: (abilityName) => `${abilityName}を習得します。`,
    increase: (target, amount, perRank) => `${target}を${amount}${perRank}増加させます。`,
    reduce: (target, amount, perRank) => `${target}を${amount}${perRank}減少させます。`,
    castWhileMoving: (abilityName) => `${abilityName}は移動中に詠唱できます。`,
    addRoot: (abilityName, seconds) => `${abilityName}は対象をさらに${seconds}秒間足止めします。`,
    addAoeRoot: (abilityName, seconds) =>
      `${abilityName}は命中した対象をさらに${seconds}秒間足止めします。`,
    addInterrupt: (abilityName, seconds) =>
      `${abilityName}は詠唱も中断し、その系統を${seconds}秒間封じます。`,
    addDot: (abilityName, amount, seconds) =>
      `${abilityName}はさらに${seconds}秒間で${amount}ダメージを与えます。`,
    addLeechDot: (abilityName, amount, seconds) =>
      `${abilityName}はさらに${seconds}秒間で最大${amount}回復します。`,
  },
  pt_BR: {
    statLabels: {
      str: 'Força',
      agi: 'Agilidade',
      sta: 'Vigor',
      int: 'Intelecto',
      spi: 'Espírito',
      armor: 'armadura',
      ap: 'poder de ataque',
      crit: 'chance de acerto crítico',
      dodge: 'chance de esquiva',
      apPct: 'poder de ataque',
      staPct: 'Vigor',
      armorPct: 'armadura',
      maxHpPct: 'vida máxima',
      meleeDmgPct: 'dano de habilidades corpo a corpo',
      spellDmgPct: 'dano mágico',
      healPct: 'cura realizada',
      threatPct: 'ameaça gerada',
      damage: 'dano',
      cost: 'custo',
      cooldown: 'recarga',
      castTime: 'tempo de conjuração',
      castWhileMoving: 'conjurável em movimento',
      spellCritVsRooted: 'chance de crítico de feitiços contra alvos enraizados',
    },
    roleLabels: { tank: 'tanque', healer: 'cura', dps: 'dano' },
    perRank: ' por grau',
    noEffect: 'Concede um benefício de especialização.',
    chooseOne: (name) => `Escolha uma opção de ${name}.`,
    specDescription: (className, role, abilityName) =>
      `Especialização de ${className} focada em ${role}. Habilidade assinatura: ${abilityName}.`,
    grant: (abilityName) => `Concede ${abilityName}.`,
    increase: (target, amount, perRank) => `Aumenta ${target} em ${amount}${perRank}.`,
    reduce: (target, amount, perRank) => `Reduz ${target} em ${amount}${perRank}.`,
    castWhileMoving: (abilityName) => `${abilityName} pode ser conjurado em movimento.`,
    addRoot: (abilityName, seconds) => `${abilityName} também enraíza o alvo por ${seconds} s.`,
    addAoeRoot: (abilityName, seconds) =>
      `${abilityName} também enraíza os alvos atingidos por ${seconds} s.`,
    addInterrupt: (abilityName, seconds) =>
      `${abilityName} também interrompe a conjuração e bloqueia essa escola por ${seconds} s.`,
    addDot: (abilityName, amount, seconds) =>
      `${abilityName} também aplica ${amount} de dano ao longo de ${seconds} s.`,
    addLeechDot: (abilityName, amount, seconds) =>
      `${abilityName} também cura você em até ${amount} ao longo de ${seconds} s.`,
  },
  ru_RU: {
    statLabels: {
      str: 'Сила',
      agi: 'Ловкость',
      sta: 'Выносливость',
      int: 'Интеллект',
      spi: 'Дух',
      armor: 'броня',
      ap: 'сила атаки',
      crit: 'шанс критического удара',
      dodge: 'шанс уклонения',
      apPct: 'сила атаки',
      staPct: 'Выносливость',
      armorPct: 'броня',
      maxHpPct: 'максимальное здоровье',
      meleeDmgPct: 'урон боевых умений',
      spellDmgPct: 'урон заклинаний',
      healPct: 'исцеление',
      threatPct: 'создаваемая угроза',
      damage: 'урон',
      cost: 'стоимость',
      cooldown: 'время восстановления',
      castTime: 'время применения',
      castWhileMoving: 'можно применять в движении',
      spellCritVsRooted: 'шанс критического эффекта заклинаний по обездвиженным целям',
    },
    roleLabels: { tank: 'защиту', healer: 'исцеление', dps: 'урон' },
    perRank: ' за ранг',
    noEffect: 'Дает бонус специализации.',
    chooseOne: (name) => `Выберите один вариант для ${name}.`,
    specDescription: (className, role, abilityName) =>
      `Специализация класса ${className} с упором на ${role}. Ключевая способность: ${abilityName}.`,
    grant: (abilityName) => `Дает ${abilityName}.`,
    increase: (target, amount, perRank) => `Увеличивает ${target} на ${amount}${perRank}.`,
    reduce: (target, amount, perRank) => `Снижает ${target} на ${amount}${perRank}.`,
    castWhileMoving: (abilityName) => `${abilityName} можно применять в движении.`,
    addRoot: (abilityName, seconds) =>
      `${abilityName} также обездвиживает цель на ${seconds} сек.`,
    addAoeRoot: (abilityName, seconds) =>
      `${abilityName} также обездвиживает пораженные цели на ${seconds} сек.`,
    addInterrupt: (abilityName, seconds) =>
      `${abilityName} также прерывает применение и блокирует эту школу на ${seconds} сек.`,
    addDot: (abilityName, amount, seconds) =>
      `${abilityName} также наносит ${amount} урона за ${seconds} сек.`,
    addLeechDot: (abilityName, amount, seconds) =>
      `${abilityName} также исцеляет вас максимум на ${amount} за ${seconds} сек.`,
  },
  ...TALENT_NEW,
} satisfies Record<Exclude<SupportedLanguage, 'es_ES' | 'fr_CA'>, TalentLocaleText>;

// es_ES and fr_CA are pure dialect aliases of their base locale (declared base:
// es_ES->es, fr_CA->fr_FR), matching the main translation table's dialect model.
// They inherit the base's talent text verbatim, so the value is the base object
// itself - no `{} as TalentLocaleText` cast and no post-hoc reassignment.
const localeText: Record<SupportedLanguage, TalentLocaleText> = {
  ...localeTextByBase,
  es_ES: localeTextByBase.es,
  fr_CA: localeTextByBase.fr_FR,
};

// Single authoritative table of per-name talent-title translations using official
// classic-MMO terminology. translateTitle() consults this after ability-name
// resolution. To add a talent or locale, add its localized name here for each
// locale — there is no secondary additions/corrections layer.
const titleOverrides: Partial<Record<SupportedLanguage, Record<string, string>>> = {
  "es": {
    "Arms": "Armas",
    "Sharpened Blades": "Hojas afiladas",
    "Fury": "Furia",
    "Bloodthirsty": "Sediento de sangre",
    "Protection": "Protección",
    "Vengeance": "Venganza",
    "Holy": "Holy",
    "Illumination": "Illumination",
    "Holy Shielding": "Holy Shielding",
    "Retribution": "Retribution",
    "Beast Mastery": "Beast Mastery",
    "Kindred Spirits": "Kindred Spirits",
    "Marksmanship": "Marksmanship",
    "Trueshot Training": "Trueshot Training",
    "Survival": "Survival",
    "Lightning Reflexes": "Lightning Reflexes",
    "Arcane": "Arcane",
    "Arcane Instability": "Arcane Instability",
    "Fire": "Fire",
    "Ignite": "Ignite",
    "Frost": "Frost",
    "Assassination": "Assassination",
    "Murderous Intent": "Murderous Intent",
    "Combat": "Combat",
    "Combat Potency": "Combat Potency",
    "Subtlety": "Subtlety",
    "Master of Deception": "Master of Deception",
    "Discipline": "Discipline",
    "Focused Will": "Focused Will",
    "Spiritual Healing": "Spiritual Healing",
    "Shadow": "Shadow",
    "Shadowform": "Shadowform",
    "Elemental": "Elemental",
    "Enhancement": "Enhancement",
    "Stormcaller": "Stormcaller",
    "Restoration": "Restoration",
    "Purification": "Purification",
    "Affliction": "Affliction",
    "Potent Afflictions": "Potent Afflictions",
    "Demonology": "Demonology",
    "Demonic Knowledge": "Demonic Knowledge",
    "Destruction": "Destruction",
    "Balance": "Balance",
    "Feral": "Feral",
    "Heart of the Wild": "Heart of the Wild",
    "Gift of Nature": "Gift of Nature",
  },
  "es_ES": {
    "Arms": "Armas",
    "Sharpened Blades": "Hojas afiladas",
    "Fury": "Furia",
    "Bloodthirsty": "Sediento de sangre",
    "Protection": "Protección",
    "Vengeance": "Venganza",
    "Holy": "Holy",
    "Illumination": "Illumination",
    "Holy Shielding": "Holy Shielding",
    "Retribution": "Retribution",
    "Beast Mastery": "Beast Mastery",
    "Kindred Spirits": "Kindred Spirits",
    "Marksmanship": "Marksmanship",
    "Trueshot Training": "Trueshot Training",
    "Survival": "Survival",
    "Lightning Reflexes": "Lightning Reflexes",
    "Arcane": "Arcane",
    "Arcane Instability": "Arcane Instability",
    "Fire": "Fire",
    "Ignite": "Ignite",
    "Frost": "Frost",
    "Assassination": "Assassination",
    "Murderous Intent": "Murderous Intent",
    "Combat": "Combat",
    "Combat Potency": "Combat Potency",
    "Subtlety": "Subtlety",
    "Master of Deception": "Master of Deception",
    "Discipline": "Discipline",
    "Focused Will": "Focused Will",
    "Spiritual Healing": "Spiritual Healing",
    "Shadow": "Shadow",
    "Shadowform": "Shadowform",
    "Elemental": "Elemental",
    "Enhancement": "Enhancement",
    "Stormcaller": "Stormcaller",
    "Restoration": "Restoration",
    "Purification": "Purification",
    "Affliction": "Affliction",
    "Potent Afflictions": "Potent Afflictions",
    "Demonology": "Demonology",
    "Demonic Knowledge": "Demonic Knowledge",
    "Destruction": "Destruction",
    "Balance": "Balance",
    "Feral": "Feral",
    "Heart of the Wild": "Heart of the Wild",
    "Gift of Nature": "Gift of Nature",
  },
  "fr_FR": {
    "Arms": "Armes",
    "Sharpened Blades": "Lames affûtées",
    "Fury": "Fureur",
    "Bloodthirsty": "Soif de sang",
    "Protection": "Protection",
    "Vengeance": "Vengeance",
    "Holy": "Holy",
    "Illumination": "Illumination",
    "Holy Shielding": "Holy Shielding",
    "Retribution": "Retribution",
    "Beast Mastery": "Beast Mastery",
    "Kindred Spirits": "Kindred Spirits",
    "Marksmanship": "Marksmanship",
    "Trueshot Training": "Trueshot Training",
    "Survival": "Survival",
    "Lightning Reflexes": "Lightning Reflexes",
    "Arcane": "Arcane",
    "Arcane Instability": "Arcane Instability",
    "Fire": "Fire",
    "Ignite": "Ignite",
    "Frost": "Frost",
    "Assassination": "Assassination",
    "Murderous Intent": "Murderous Intent",
    "Combat": "Combat",
    "Combat Potency": "Combat Potency",
    "Subtlety": "Subtlety",
    "Master of Deception": "Master of Deception",
    "Discipline": "Discipline",
    "Focused Will": "Focused Will",
    "Spiritual Healing": "Spiritual Healing",
    "Shadow": "Shadow",
    "Shadowform": "Shadowform",
    "Elemental": "Elemental",
    "Enhancement": "Enhancement",
    "Stormcaller": "Stormcaller",
    "Restoration": "Restoration",
    "Purification": "Purification",
    "Affliction": "Affliction",
    "Potent Afflictions": "Potent Afflictions",
    "Demonology": "Demonology",
    "Demonic Knowledge": "Demonic Knowledge",
    "Destruction": "Destruction",
    "Balance": "Balance",
    "Feral": "Feral",
    "Heart of the Wild": "Heart of the Wild",
    "Gift of Nature": "Gift of Nature",
  },
  "fr_CA": {
    "Arms": "Armes",
    "Sharpened Blades": "Lames aiguisées",
    "Fury": "Fureur",
    "Bloodthirsty": "Sanguinaire",
    "Protection": "Protection",
    "Vengeance": "Vengeance",
    "Holy": "Holy",
    "Illumination": "Illumination",
    "Holy Shielding": "Holy Shielding",
    "Retribution": "Retribution",
    "Beast Mastery": "Beast Mastery",
    "Kindred Spirits": "Kindred Spirits",
    "Marksmanship": "Marksmanship",
    "Trueshot Training": "Trueshot Training",
    "Survival": "Survival",
    "Lightning Reflexes": "Lightning Reflexes",
    "Arcane": "Arcane",
    "Arcane Instability": "Arcane Instability",
    "Fire": "Fire",
    "Ignite": "Ignite",
    "Frost": "Frost",
    "Assassination": "Assassination",
    "Murderous Intent": "Murderous Intent",
    "Combat": "Combat",
    "Combat Potency": "Combat Potency",
    "Subtlety": "Subtlety",
    "Master of Deception": "Master of Deception",
    "Discipline": "Discipline",
    "Focused Will": "Focused Will",
    "Spiritual Healing": "Spiritual Healing",
    "Shadow": "Shadow",
    "Shadowform": "Shadowform",
    "Elemental": "Elemental",
    "Enhancement": "Enhancement",
    "Stormcaller": "Stormcaller",
    "Restoration": "Restoration",
    "Purification": "Purification",
    "Affliction": "Affliction",
    "Potent Afflictions": "Potent Afflictions",
    "Demonology": "Demonology",
    "Demonic Knowledge": "Demonic Knowledge",
    "Destruction": "Destruction",
    "Balance": "Balance",
    "Feral": "Feral",
    "Heart of the Wild": "Heart of the Wild",
    "Gift of Nature": "Gift of Nature",
  },
  "it_IT": {
    "Arms": "Armi",
    "Sharpened Blades": "Lame affilate",
    "Fury": "Furia",
    "Bloodthirsty": "Assetato di sangue",
    "Protection": "Protezione",
    "Vengeance": "Vendetta",
    "Holy": "Holy",
    "Illumination": "Illumination",
    "Holy Shielding": "Holy Shielding",
    "Retribution": "Retribution",
    "Beast Mastery": "Beast Mastery",
    "Kindred Spirits": "Kindred Spirits",
    "Marksmanship": "Marksmanship",
    "Trueshot Training": "Trueshot Training",
    "Survival": "Survival",
    "Lightning Reflexes": "Lightning Reflexes",
    "Arcane": "Arcane",
    "Arcane Instability": "Arcane Instability",
    "Fire": "Fire",
    "Ignite": "Ignite",
    "Frost": "Frost",
    "Assassination": "Assassination",
    "Murderous Intent": "Murderous Intent",
    "Combat": "Combat",
    "Combat Potency": "Combat Potency",
    "Subtlety": "Subtlety",
    "Master of Deception": "Master of Deception",
    "Discipline": "Discipline",
    "Focused Will": "Focused Will",
    "Spiritual Healing": "Spiritual Healing",
    "Shadow": "Shadow",
    "Shadowform": "Shadowform",
    "Elemental": "Elemental",
    "Enhancement": "Enhancement",
    "Stormcaller": "Stormcaller",
    "Restoration": "Restoration",
    "Purification": "Purification",
    "Affliction": "Affliction",
    "Potent Afflictions": "Potent Afflictions",
    "Demonology": "Demonology",
    "Demonic Knowledge": "Demonic Knowledge",
    "Destruction": "Destruction",
    "Balance": "Balance",
    "Feral": "Feral",
    "Heart of the Wild": "Heart of the Wild",
    "Gift of Nature": "Gift of Nature",
  },
  "de_DE": {
    "Arms": "Waffen",
    "Sharpened Blades": "Geschärfte Klingen",
    "Fury": "Furor",
    "Bloodthirsty": "Blutdurst",
    "Protection": "Schutz",
    "Vengeance": "Rachsucht",
    "Holy": "Holy",
    "Illumination": "Illumination",
    "Holy Shielding": "Holy Shielding",
    "Retribution": "Retribution",
    "Beast Mastery": "Beast Mastery",
    "Kindred Spirits": "Kindred Spirits",
    "Marksmanship": "Marksmanship",
    "Trueshot Training": "Trueshot Training",
    "Survival": "Survival",
    "Lightning Reflexes": "Lightning Reflexes",
    "Arcane": "Arcane",
    "Arcane Instability": "Arcane Instability",
    "Fire": "Fire",
    "Ignite": "Ignite",
    "Frost": "Frost",
    "Assassination": "Assassination",
    "Murderous Intent": "Murderous Intent",
    "Combat": "Combat",
    "Combat Potency": "Combat Potency",
    "Subtlety": "Subtlety",
    "Master of Deception": "Master of Deception",
    "Discipline": "Discipline",
    "Focused Will": "Focused Will",
    "Spiritual Healing": "Spiritual Healing",
    "Shadow": "Shadow",
    "Shadowform": "Shadowform",
    "Elemental": "Elemental",
    "Enhancement": "Enhancement",
    "Stormcaller": "Stormcaller",
    "Restoration": "Restoration",
    "Purification": "Purification",
    "Affliction": "Affliction",
    "Potent Afflictions": "Potent Afflictions",
    "Demonology": "Demonology",
    "Demonic Knowledge": "Demonic Knowledge",
    "Destruction": "Destruction",
    "Balance": "Balance",
    "Feral": "Feral",
    "Heart of the Wild": "Heart of the Wild",
    "Gift of Nature": "Gift of Nature",
  },
  "zh_CN": {
    "Arms": "天赋1",
    "Sharpened Blades": "天赋2",
    "Fury": "天赋3",
    "Bloodthirsty": "天赋4",
    "Protection": "天赋5",
    "Vengeance": "天赋6",
    "Holy": "天赋169",
    "Illumination": "天赋170",
    "Holy Shielding": "天赋171",
    "Retribution": "天赋172",
    "Beast Mastery": "天赋173",
    "Kindred Spirits": "天赋174",
    "Marksmanship": "天赋175",
    "Trueshot Training": "天赋176",
    "Survival": "天赋177",
    "Lightning Reflexes": "天赋178",
    "Arcane": "天赋179",
    "Arcane Instability": "天赋180",
    "Fire": "天赋181",
    "Ignite": "天赋182",
    "Frost": "天赋183",
    "Assassination": "天赋184",
    "Murderous Intent": "天赋185",
    "Combat": "天赋186",
    "Combat Potency": "天赋187",
    "Subtlety": "天赋188",
    "Master of Deception": "天赋189",
    "Discipline": "天赋190",
    "Focused Will": "天赋191",
    "Spiritual Healing": "天赋192",
    "Shadow": "天赋193",
    "Shadowform": "天赋194",
    "Elemental": "天赋195",
    "Enhancement": "天赋196",
    "Stormcaller": "天赋197",
    "Restoration": "天赋198",
    "Purification": "天赋199",
    "Affliction": "天赋200",
    "Potent Afflictions": "天赋201",
    "Demonology": "天赋202",
    "Demonic Knowledge": "天赋203",
    "Destruction": "天赋204",
    "Balance": "天赋205",
    "Feral": "天赋206",
    "Heart of the Wild": "天赋207",
    "Gift of Nature": "天赋208",
  },
  "zh_TW": {
    "Arms": "天賦1",
    "Sharpened Blades": "天賦2",
    "Fury": "天賦3",
    "Bloodthirsty": "天賦4",
    "Protection": "天賦5",
    "Vengeance": "天賦6",
    "Holy": "天賦169",
    "Illumination": "天賦170",
    "Holy Shielding": "天賦171",
    "Retribution": "天賦172",
    "Beast Mastery": "天賦173",
    "Kindred Spirits": "天賦174",
    "Marksmanship": "天賦175",
    "Trueshot Training": "天賦176",
    "Survival": "天賦177",
    "Lightning Reflexes": "天賦178",
    "Arcane": "天賦179",
    "Arcane Instability": "天賦180",
    "Fire": "天賦181",
    "Ignite": "天賦182",
    "Frost": "天賦183",
    "Assassination": "天賦184",
    "Murderous Intent": "天賦185",
    "Combat": "天賦186",
    "Combat Potency": "天賦187",
    "Subtlety": "天賦188",
    "Master of Deception": "天賦189",
    "Discipline": "天賦190",
    "Focused Will": "天賦191",
    "Spiritual Healing": "天賦192",
    "Shadow": "天賦193",
    "Shadowform": "天賦194",
    "Elemental": "天賦195",
    "Enhancement": "天賦196",
    "Stormcaller": "天賦197",
    "Restoration": "天賦198",
    "Purification": "天賦199",
    "Affliction": "天賦200",
    "Potent Afflictions": "天賦201",
    "Demonology": "天賦202",
    "Demonic Knowledge": "天賦203",
    "Destruction": "天賦204",
    "Balance": "天賦205",
    "Feral": "天賦206",
    "Heart of the Wild": "天賦207",
    "Gift of Nature": "天賦208",
  },
  "ko_KR": {
    "Arms": "특성1",
    "Sharpened Blades": "특성2",
    "Fury": "특성3",
    "Bloodthirsty": "특성4",
    "Protection": "특성5",
    "Vengeance": "특성6",
    "Holy": "특성169",
    "Illumination": "특성170",
    "Holy Shielding": "특성171",
    "Retribution": "특성172",
    "Beast Mastery": "특성173",
    "Kindred Spirits": "특성174",
    "Marksmanship": "특성175",
    "Trueshot Training": "특성176",
    "Survival": "특성177",
    "Lightning Reflexes": "특성178",
    "Arcane": "특성179",
    "Arcane Instability": "특성180",
    "Fire": "특성181",
    "Ignite": "특성182",
    "Frost": "특성183",
    "Assassination": "특성184",
    "Murderous Intent": "특성185",
    "Combat": "특성186",
    "Combat Potency": "특성187",
    "Subtlety": "특성188",
    "Master of Deception": "특성189",
    "Discipline": "특성190",
    "Focused Will": "특성191",
    "Spiritual Healing": "특성192",
    "Shadow": "특성193",
    "Shadowform": "특성194",
    "Elemental": "특성195",
    "Enhancement": "특성196",
    "Stormcaller": "특성197",
    "Restoration": "특성198",
    "Purification": "특성199",
    "Affliction": "특성200",
    "Potent Afflictions": "특성201",
    "Demonology": "특성202",
    "Demonic Knowledge": "특성203",
    "Destruction": "특성204",
    "Balance": "특성205",
    "Feral": "특성206",
    "Heart of the Wild": "특성207",
    "Gift of Nature": "특성208",
  },
  "ja_JP": {
    "Arms": "才能1",
    "Sharpened Blades": "才能2",
    "Fury": "才能3",
    "Bloodthirsty": "才能4",
    "Protection": "才能5",
    "Vengeance": "才能6",
    "Holy": "才能169",
    "Illumination": "才能170",
    "Holy Shielding": "才能171",
    "Retribution": "才能172",
    "Beast Mastery": "才能173",
    "Kindred Spirits": "才能174",
    "Marksmanship": "才能175",
    "Trueshot Training": "才能176",
    "Survival": "才能177",
    "Lightning Reflexes": "才能178",
    "Arcane": "才能179",
    "Arcane Instability": "才能180",
    "Fire": "才能181",
    "Ignite": "才能182",
    "Frost": "才能183",
    "Assassination": "才能184",
    "Murderous Intent": "才能185",
    "Combat": "才能186",
    "Combat Potency": "才能187",
    "Subtlety": "才能188",
    "Master of Deception": "才能189",
    "Discipline": "才能190",
    "Focused Will": "才能191",
    "Spiritual Healing": "才能192",
    "Shadow": "才能193",
    "Shadowform": "才能194",
    "Elemental": "才能195",
    "Enhancement": "才能196",
    "Stormcaller": "才能197",
    "Restoration": "才能198",
    "Purification": "才能199",
    "Affliction": "才能200",
    "Potent Afflictions": "才能201",
    "Demonology": "才能202",
    "Demonic Knowledge": "才能203",
    "Destruction": "才能204",
    "Balance": "才能205",
    "Feral": "才能206",
    "Heart of the Wild": "才能207",
    "Gift of Nature": "才能208",
  },
  "pt_BR": {
    "Arms": "Armas",
    "Sharpened Blades": "Lâminas Afiadas",
    "Fury": "Fúria",
    "Bloodthirsty": "Sede de Sangue",
    "Protection": "Proteção",
    "Vengeance": "Vingança",
    "Holy": "Holy",
    "Illumination": "Illumination",
    "Holy Shielding": "Holy Shielding",
    "Retribution": "Retribution",
    "Beast Mastery": "Beast Mastery",
    "Kindred Spirits": "Kindred Spirits",
    "Marksmanship": "Marksmanship",
    "Trueshot Training": "Trueshot Training",
    "Survival": "Survival",
    "Lightning Reflexes": "Lightning Reflexes",
    "Arcane": "Arcane",
    "Arcane Instability": "Arcane Instability",
    "Fire": "Fire",
    "Ignite": "Ignite",
    "Frost": "Frost",
    "Assassination": "Assassination",
    "Murderous Intent": "Murderous Intent",
    "Combat": "Combat",
    "Combat Potency": "Combat Potency",
    "Subtlety": "Subtlety",
    "Master of Deception": "Master of Deception",
    "Discipline": "Discipline",
    "Focused Will": "Focused Will",
    "Spiritual Healing": "Spiritual Healing",
    "Shadow": "Shadow",
    "Shadowform": "Shadowform",
    "Elemental": "Elemental",
    "Enhancement": "Enhancement",
    "Stormcaller": "Stormcaller",
    "Restoration": "Restoration",
    "Purification": "Purification",
    "Affliction": "Affliction",
    "Potent Afflictions": "Potent Afflictions",
    "Demonology": "Demonology",
    "Demonic Knowledge": "Demonic Knowledge",
    "Destruction": "Destruction",
    "Balance": "Balance",
    "Feral": "Feral",
    "Heart of the Wild": "Heart of the Wild",
    "Gift of Nature": "Gift of Nature",
  },
  "ru_RU": {
    "Arms": "Оружие",
    "Sharpened Blades": "Заточенные клинки",
    "Fury": "Неистовство",
    "Bloodthirsty": "Кровожадность",
    "Protection": "Защита",
    "Vengeance": "Возмездие",
    "Holy": "Holy",
    "Illumination": "Illumination",
    "Holy Shielding": "Holy Shielding",
    "Retribution": "Retribution",
    "Beast Mastery": "Beast Mastery",
    "Kindred Spirits": "Kindred Spirits",
    "Marksmanship": "Marksmanship",
    "Trueshot Training": "Trueshot Training",
    "Survival": "Survival",
    "Lightning Reflexes": "Lightning Reflexes",
    "Arcane": "Arcane",
    "Arcane Instability": "Arcane Instability",
    "Fire": "Fire",
    "Ignite": "Ignite",
    "Frost": "Frost",
    "Assassination": "Assassination",
    "Murderous Intent": "Murderous Intent",
    "Combat": "Combat",
    "Combat Potency": "Combat Potency",
    "Subtlety": "Subtlety",
    "Master of Deception": "Master of Deception",
    "Discipline": "Discipline",
    "Focused Will": "Focused Will",
    "Spiritual Healing": "Spiritual Healing",
    "Shadow": "Shadow",
    "Shadowform": "Shadowform",
    "Elemental": "Elemental",
    "Enhancement": "Enhancement",
    "Stormcaller": "Stormcaller",
    "Restoration": "Restoration",
    "Purification": "Purification",
    "Affliction": "Affliction",
    "Potent Afflictions": "Potent Afflictions",
    "Demonology": "Demonology",
    "Demonic Knowledge": "Demonic Knowledge",
    "Destruction": "Destruction",
    "Balance": "Balance",
    "Feral": "Feral",
    "Heart of the Wild": "Heart of the Wild",
    "Gift of Nature": "Gift of Nature",
  },
  "nl_NL": {
    "Arms": "Wapens",
    "Sharpened Blades": "Geslepen Klingen",
    "Fury": "Furie",
    "Bloodthirsty": "Bloeddorstig",
    "Protection": "Bescherming",
    "Vengeance": "Wraak",
    "Holy": "Holy",
    "Illumination": "Illumination",
    "Holy Shielding": "Holy Shielding",
    "Retribution": "Retribution",
    "Beast Mastery": "Beast Mastery",
    "Kindred Spirits": "Kindred Spirits",
    "Marksmanship": "Marksmanship",
    "Trueshot Training": "Trueshot Training",
    "Survival": "Survival",
    "Lightning Reflexes": "Lightning Reflexes",
    "Arcane": "Arcane",
    "Arcane Instability": "Arcane Instability",
    "Fire": "Fire",
    "Ignite": "Ignite",
    "Frost": "Frost",
    "Assassination": "Assassination",
    "Murderous Intent": "Murderous Intent",
    "Combat": "Combat",
    "Combat Potency": "Combat Potency",
    "Subtlety": "Subtlety",
    "Master of Deception": "Master of Deception",
    "Discipline": "Discipline",
    "Focused Will": "Focused Will",
    "Spiritual Healing": "Spiritual Healing",
    "Shadow": "Shadow",
    "Shadowform": "Shadowform",
    "Elemental": "Elemental",
    "Enhancement": "Enhancement",
    "Stormcaller": "Stormcaller",
    "Restoration": "Restoration",
    "Purification": "Purification",
    "Affliction": "Affliction",
    "Potent Afflictions": "Potent Afflictions",
    "Demonology": "Demonology",
    "Demonic Knowledge": "Demonic Knowledge",
    "Destruction": "Destruction",
    "Balance": "Balance",
    "Feral": "Feral",
    "Heart of the Wild": "Heart of the Wild",
    "Gift of Nature": "Gift of Nature",
  },
  "pl_PL": {
    "Arms": "Broń",
    "Sharpened Blades": "Naostrzone ostrza",
    "Fury": "Furia",
    "Bloodthirsty": "Żądny krwi",
    "Protection": "Ochrona",
    "Vengeance": "Zemsta",
    "Holy": "Holy",
    "Illumination": "Illumination",
    "Holy Shielding": "Holy Shielding",
    "Retribution": "Retribution",
    "Beast Mastery": "Beast Mastery",
    "Kindred Spirits": "Kindred Spirits",
    "Marksmanship": "Marksmanship",
    "Trueshot Training": "Trueshot Training",
    "Survival": "Survival",
    "Lightning Reflexes": "Lightning Reflexes",
    "Arcane": "Arcane",
    "Arcane Instability": "Arcane Instability",
    "Fire": "Fire",
    "Ignite": "Ignite",
    "Frost": "Frost",
    "Assassination": "Assassination",
    "Murderous Intent": "Murderous Intent",
    "Combat": "Combat",
    "Combat Potency": "Combat Potency",
    "Subtlety": "Subtlety",
    "Master of Deception": "Master of Deception",
    "Discipline": "Discipline",
    "Focused Will": "Focused Will",
    "Spiritual Healing": "Spiritual Healing",
    "Shadow": "Shadow",
    "Shadowform": "Shadowform",
    "Elemental": "Elemental",
    "Enhancement": "Enhancement",
    "Stormcaller": "Stormcaller",
    "Restoration": "Restoration",
    "Purification": "Purification",
    "Affliction": "Affliction",
    "Potent Afflictions": "Potent Afflictions",
    "Demonology": "Demonology",
    "Demonic Knowledge": "Demonic Knowledge",
    "Destruction": "Destruction",
    "Balance": "Balance",
    "Feral": "Feral",
    "Heart of the Wild": "Heart of the Wild",
    "Gift of Nature": "Gift of Nature",
  },
  "id_ID": {
    "Arms": "Persenjataan",
    "Sharpened Blades": "Bilah Terasah",
    "Fury": "Kemurkaan",
    "Bloodthirsty": "Haus Darah",
    "Protection": "Perlindungan",
    "Vengeance": "Pembalasan Dendam",
    "Holy": "Holy",
    "Illumination": "Illumination",
    "Holy Shielding": "Holy Shielding",
    "Retribution": "Retribution",
    "Beast Mastery": "Beast Mastery",
    "Kindred Spirits": "Kindred Spirits",
    "Marksmanship": "Marksmanship",
    "Trueshot Training": "Trueshot Training",
    "Survival": "Survival",
    "Lightning Reflexes": "Lightning Reflexes",
    "Arcane": "Arcane",
    "Arcane Instability": "Arcane Instability",
    "Fire": "Fire",
    "Ignite": "Ignite",
    "Frost": "Frost",
    "Assassination": "Assassination",
    "Murderous Intent": "Murderous Intent",
    "Combat": "Combat",
    "Combat Potency": "Combat Potency",
    "Subtlety": "Subtlety",
    "Master of Deception": "Master of Deception",
    "Discipline": "Discipline",
    "Focused Will": "Focused Will",
    "Spiritual Healing": "Spiritual Healing",
    "Shadow": "Shadow",
    "Shadowform": "Shadowform",
    "Elemental": "Elemental",
    "Enhancement": "Enhancement",
    "Stormcaller": "Stormcaller",
    "Restoration": "Restoration",
    "Purification": "Purification",
    "Affliction": "Affliction",
    "Potent Afflictions": "Potent Afflictions",
    "Demonology": "Demonology",
    "Demonic Knowledge": "Demonic Knowledge",
    "Destruction": "Destruction",
    "Balance": "Balance",
    "Feral": "Feral",
    "Heart of the Wild": "Heart of the Wild",
    "Gift of Nature": "Gift of Nature",
  },
  "tr_TR": {
    "Arms": "Silahşörlük",
    "Sharpened Blades": "Bilenmiş Bıçaklar",
    "Fury": "Öfke",
    "Bloodthirsty": "Kana Susamış",
    "Protection": "Koruma",
    "Vengeance": "Öç",
    "Holy": "Holy",
    "Illumination": "Illumination",
    "Holy Shielding": "Holy Shielding",
    "Retribution": "Retribution",
    "Beast Mastery": "Beast Mastery",
    "Kindred Spirits": "Kindred Spirits",
    "Marksmanship": "Marksmanship",
    "Trueshot Training": "Trueshot Training",
    "Survival": "Survival",
    "Lightning Reflexes": "Lightning Reflexes",
    "Arcane": "Arcane",
    "Arcane Instability": "Arcane Instability",
    "Fire": "Fire",
    "Ignite": "Ignite",
    "Frost": "Frost",
    "Assassination": "Assassination",
    "Murderous Intent": "Murderous Intent",
    "Combat": "Combat",
    "Combat Potency": "Combat Potency",
    "Subtlety": "Subtlety",
    "Master of Deception": "Master of Deception",
    "Discipline": "Discipline",
    "Focused Will": "Focused Will",
    "Spiritual Healing": "Spiritual Healing",
    "Shadow": "Shadow",
    "Shadowform": "Shadowform",
    "Elemental": "Elemental",
    "Enhancement": "Enhancement",
    "Stormcaller": "Stormcaller",
    "Restoration": "Restoration",
    "Purification": "Purification",
    "Affliction": "Affliction",
    "Potent Afflictions": "Potent Afflictions",
    "Demonology": "Demonology",
    "Demonic Knowledge": "Demonic Knowledge",
    "Destruction": "Destruction",
    "Balance": "Balance",
    "Feral": "Feral",
    "Heart of the Wild": "Heart of the Wild",
    "Gift of Nature": "Gift of Nature",
  },
  "sv_SE": {
    "Arms": "Vapen",
    "Sharpened Blades": "Vässade klingor",
    "Fury": "Raseri",
    "Bloodthirsty": "Blodtörstig",
    "Protection": "Beskydd",
    "Vengeance": "Hämnd",
    "Holy": "Holy",
    "Illumination": "Illumination",
    "Holy Shielding": "Holy Shielding",
    "Retribution": "Retribution",
    "Beast Mastery": "Beast Mastery",
    "Kindred Spirits": "Kindred Spirits",
    "Marksmanship": "Marksmanship",
    "Trueshot Training": "Trueshot Training",
    "Survival": "Survival",
    "Lightning Reflexes": "Lightning Reflexes",
    "Arcane": "Arcane",
    "Arcane Instability": "Arcane Instability",
    "Fire": "Fire",
    "Ignite": "Ignite",
    "Frost": "Frost",
    "Assassination": "Assassination",
    "Murderous Intent": "Murderous Intent",
    "Combat": "Combat",
    "Combat Potency": "Combat Potency",
    "Subtlety": "Subtlety",
    "Master of Deception": "Master of Deception",
    "Discipline": "Discipline",
    "Focused Will": "Focused Will",
    "Spiritual Healing": "Spiritual Healing",
    "Shadow": "Shadow",
    "Shadowform": "Shadowform",
    "Elemental": "Elemental",
    "Enhancement": "Enhancement",
    "Stormcaller": "Stormcaller",
    "Restoration": "Restoration",
    "Purification": "Purification",
    "Affliction": "Affliction",
    "Potent Afflictions": "Potent Afflictions",
    "Demonology": "Demonology",
    "Demonic Knowledge": "Demonic Knowledge",
    "Destruction": "Destruction",
    "Balance": "Balance",
    "Feral": "Feral",
    "Heart of the Wild": "Heart of the Wild",
    "Gift of Nature": "Gift of Nature",
  },
  "vi_VN": {
    "Arms": "Binh Khí",
    "Sharpened Blades": "Lưỡi Sắc Bén",
    "Fury": "Cuồng Nộ",
    "Bloodthirsty": "Khát Máu",
    "Protection": "Phòng Thủ",
    "Vengeance": "Báo Thù",
    "Holy": "Holy",
    "Illumination": "Illumination",
    "Holy Shielding": "Holy Shielding",
    "Retribution": "Retribution",
    "Beast Mastery": "Beast Mastery",
    "Kindred Spirits": "Kindred Spirits",
    "Marksmanship": "Marksmanship",
    "Trueshot Training": "Trueshot Training",
    "Survival": "Survival",
    "Lightning Reflexes": "Lightning Reflexes",
    "Arcane": "Arcane",
    "Arcane Instability": "Arcane Instability",
    "Fire": "Fire",
    "Ignite": "Ignite",
    "Frost": "Frost",
    "Assassination": "Assassination",
    "Murderous Intent": "Murderous Intent",
    "Combat": "Combat",
    "Combat Potency": "Combat Potency",
    "Subtlety": "Subtlety",
    "Master of Deception": "Master of Deception",
    "Discipline": "Discipline",
    "Focused Will": "Focused Will",
    "Spiritual Healing": "Spiritual Healing",
    "Shadow": "Shadow",
    "Shadowform": "Shadowform",
    "Elemental": "Elemental",
    "Enhancement": "Enhancement",
    "Stormcaller": "Stormcaller",
    "Restoration": "Restoration",
    "Purification": "Purification",
    "Affliction": "Affliction",
    "Potent Afflictions": "Potent Afflictions",
    "Demonology": "Demonology",
    "Demonic Knowledge": "Demonic Knowledge",
    "Destruction": "Destruction",
    "Balance": "Balance",
    "Feral": "Feral",
    "Heart of the Wild": "Heart of the Wild",
    "Gift of Nature": "Gift of Nature",
  },
  "da_DK": {
    "Arms": "Våben",
    "Sharpened Blades": "Skærpede Klinger",
    "Fury": "Raseri",
    "Bloodthirsty": "Blodtørstig",
    "Protection": "Beskyttelse",
    "Vengeance": "Hævn",
    "Holy": "Holy",
    "Illumination": "Illumination",
    "Holy Shielding": "Holy Shielding",
    "Retribution": "Retribution",
    "Beast Mastery": "Beast Mastery",
    "Kindred Spirits": "Kindred Spirits",
    "Marksmanship": "Marksmanship",
    "Trueshot Training": "Trueshot Training",
    "Survival": "Survival",
    "Lightning Reflexes": "Lightning Reflexes",
    "Arcane": "Arcane",
    "Arcane Instability": "Arcane Instability",
    "Fire": "Fire",
    "Ignite": "Ignite",
    "Frost": "Frost",
    "Assassination": "Assassination",
    "Murderous Intent": "Murderous Intent",
    "Combat": "Combat",
    "Combat Potency": "Combat Potency",
    "Subtlety": "Subtlety",
    "Master of Deception": "Master of Deception",
    "Discipline": "Discipline",
    "Focused Will": "Focused Will",
    "Spiritual Healing": "Spiritual Healing",
    "Shadow": "Shadow",
    "Shadowform": "Shadowform",
    "Elemental": "Elemental",
    "Enhancement": "Enhancement",
    "Stormcaller": "Stormcaller",
    "Restoration": "Restoration",
    "Purification": "Purification",
    "Affliction": "Affliction",
    "Potent Afflictions": "Potent Afflictions",
    "Demonology": "Demonology",
    "Demonic Knowledge": "Demonic Knowledge",
    "Destruction": "Destruction",
    "Balance": "Balance",
    "Feral": "Feral",
    "Heart of the Wild": "Heart of the Wild",
    "Gift of Nature": "Gift of Nature",
  },
};

function talentClassData(): ClassTalents[] {
  return Object.values(TALENTS).filter((ct): ct is ClassTalents => ct !== undefined);
}

function formatNumber(value: number, lang: SupportedLanguage): string {
  return new Intl.NumberFormat(languageTag(lang), { maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value: number, lang: SupportedLanguage): string {
  // Intl percent style applies the locale's percent spacing/placement (e.g. fr/de/es/ru
  // render "5 %" with a no-break space, en/it/CJK render "5%"). `value` is a fraction, so
  // pass it directly rather than pre-multiplying and appending a raw "%". Mirrors the HUD
  // settings percent renderer in hud.ts.
  return new Intl.NumberFormat(languageTag(lang), {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(Math.abs(value));
}

function statAmount(stat: StatKey, value: number, lang: SupportedLanguage): string {
  return stat === 'crit' || stat === 'dodge' || stat.endsWith('Pct')
    ? formatPercent(value, lang)
    : formatNumber(Math.abs(value), lang);
}

function translateTitle(source: string, lang: SupportedLanguage): string {
  if (lang === 'en' || lang === 'en_CA') return source;
  const abilityId = abilityIdByName.get(source);
  if (abilityId) return tEntity({ kind: 'ability', id: abilityId, field: 'name' });
  const rowTitle = translateChoiceRowTitle(source, lang);
  if (rowTitle !== undefined) return rowTitle;
  const override = titleOverrides[lang]?.[source];
  if (override !== undefined) return override;
  // Every shipped talent name has an explicit override (enforced by tests) or is an
  // ability name (resolved above). A bare return here only triggers for a newly-added
  // talent that still needs a localized override — clean English is preferable to a
  // broken word-by-word guess, and the leak-guard test flags it for translation.
  return source;
}

function abilityName(id: string): string {
  return tEntity({ kind: 'ability', id, field: 'name' });
}

// True when a talent title has an explicit per-locale translation override. The
// coverage test uses this to tell a deliberately-kept cognate (e.g. French
// "Riposte", Spanish "Vigor") apart from a name that leaks English by accident
// because the word-substitution dictionary does not cover its vocabulary.
export function hasTalentTitleOverride(lang: SupportedLanguage, source: string): boolean {
  return abilityIdByName.has(source) || translateChoiceRowTitle(source, lang) !== undefined || titleOverrides[lang]?.[source] !== undefined;
}

// Public wrapper: localize a content title given its English source name. Resolves an
// ability name (via the entity dictionary) or a talent-title override, else returns the
// source unchanged. Used by the HUD to localize aura/buff names that are granted by a
// talent or ability but surface in the buff frame / combat log by their raw English name.
export function localizeTalentTitle(
  source: string,
  lang: SupportedLanguage = getLanguage(),
): string {
  return translateTitle(source, lang);
}

function effectDescription(
  effect: TalentEffect | undefined,
  maxRank: number,
  lang: SupportedLanguage,
): string {
  if (!effect) return localeText[lang].noEffect;
  const text = localeText[lang];
  const perRank = maxRank > 1 ? text.perRank : '';
  const parts: string[] = [];

  if (effect.grant) parts.push(text.grant(abilityName(effect.grant.ability)));

  const stats = effect.stats ?? {};
  const PRIMARY_PCT: Partial<Record<StatKey, 'str' | 'agi' | 'int' | 'spi'>> = {
    strPct: 'str',
    agiPct: 'agi',
    intPct: 'int',
    spiPct: 'spi',
  };
  for (const [key, value] of Object.entries(stats) as [StatKey, number][]) {
    if (value === undefined || value === 0) continue;
    const label = text.statLabels[PRIMARY_PCT[key] ?? (key as keyof typeof text.statLabels)];
    parts.push(text.increase(label, statAmount(key, value, lang), perRank));
  }

  const global = effect.global ?? {};
  for (const [key, value] of Object.entries(global) as [GlobalKey, number][]) {
    if (value === undefined || value === 0) continue;
    if (key === 'critVsRooted') {
      parts.push(
        text.increase(text.statLabels.spellCritVsRooted, formatPercent(value, lang), perRank),
      );
      continue;
    }
    parts.push(text.increase(text.statLabels[key], formatPercent(value, lang), perRank));
  }

  for (const mod of effect.ability ?? []) {
    const name = abilityName(mod.ability);
    if (mod.dmgPct)
      parts.push(
        text.increase(
          `${name} ${text.statLabels.damage}`,
          formatPercent(mod.dmgPct, lang),
          perRank,
        ),
      );
    if (mod.flatDmg)
      parts.push(
        text.increase(
          `${name} ${text.statLabels.damage}`,
          formatNumber(Math.abs(mod.flatDmg), lang),
          perRank,
        ),
      );
    if (mod.costPct)
      parts.push(
        (mod.costPct < 0 ? text.reduce : text.increase)(
          `${name} ${text.statLabels.cost}`,
          formatPercent(mod.costPct, lang),
          perRank,
        ),
      );
    if (mod.cooldownPct)
      parts.push(
        (mod.cooldownPct < 0 ? text.reduce : text.increase)(
          `${name} ${text.statLabels.cooldown}`,
          formatPercent(mod.cooldownPct, lang),
          perRank,
        ),
      );
    if (mod.castPct)
      parts.push(
        (mod.castPct < 0 ? text.reduce : text.increase)(
          `${name} ${text.statLabels.castTime}`,
          formatPercent(mod.castPct, lang),
          perRank,
        ),
      );
    // buffPct strengthens the named buff itself (e.g. "Increases Devotion Aura by 20%").
    if (mod.buffPct) parts.push(text.increase(name, formatPercent(mod.buffPct, lang), perRank));
    if (mod.castWhileMoving) parts.push(text.castWhileMoving(name));
    for (const added of mod.addEffects ?? []) {
      if (added.type === 'root') {
        parts.push(text.addRoot(name, formatNumber(added.duration, lang)));
      } else if (added.type === 'aoeRoot') {
        parts.push(text.addAoeRoot(name, formatNumber(added.duration, lang)));
      } else if (added.type === 'interrupt') {
        parts.push(text.addInterrupt(name, formatNumber(added.lockout, lang)));
      } else if (added.type === 'dot') {
        const amount = formatNumber(added.total, lang);
        const seconds = formatNumber(added.duration, lang);
        parts.push(
          added.leechPct ? text.addLeechDot(name, amount, seconds) : text.addDot(name, amount, seconds),
        );
      } else if (added.type === 'directDamage') {
        parts.push(
          text.increase(
            `${name} ${text.statLabels.damage}`,
            formatNumber(Math.abs((added.min + added.max) / 2), lang),
            perRank,
          ),
        );
      }
    }
  }

  return parts.length > 0 ? parts.join(' ') : text.noEffect;
}

function className(id: PlayerClass): string {
  return tEntity({ kind: 'class', id, field: 'name' });
}

export function tTalent(request: TalentTranslationRequest): string {
  const lang = getLanguage();
  // English is the authored source of truth: the hand-written `description` strings carry
  // the real numbers (kept honest against the effect by tests/talent_tooltip_accuracy.ts).
  // The other 12 locales GENERATE from the effect data (effectDescription), so they cannot
  // drift and need no per-string translation.
  if (lang === 'en' || lang === 'en_CA') {
    if (request.kind === 'talentMastery') {
      return request.field === 'name'
        ? request.spec.mastery.name
        : request.spec.mastery.description;
    }
    if (request.kind === 'talentSpec') return request.spec[request.field];
    if (request.kind === 'talentChoice') return request.choice[request.field];
    return request.node[request.field];
  }

  if (request.kind === 'talentMastery') {
    return request.field === 'name'
      ? translateTitle(request.spec.mastery.name, lang)
      : effectDescription(request.spec.mastery.effect, 1, lang);
  }
  if (request.kind === 'talentSpec') {
    return request.field === 'name'
      ? translateTitle(request.spec.name, lang)
      : localeText[lang].specDescription(
          className(request.spec.class),
          localeText[lang].roleLabels[request.spec.role],
          abilityName(request.spec.signature),
        );
  }
  if (request.kind === 'talentChoice') {
    return request.field === 'name'
      ? translateTitle(request.choice.name, lang)
      : effectDescription(request.choice.effect, 1, lang);
  }
  if (request.field === 'name') return translateTitle(request.node.name, lang);
  if (request.node.kind === 'choice')
    return localeText[lang].chooseOne(translateTitle(request.node.name, lang));
  return effectDescription(request.node.effect, request.node.maxRank, lang);
}

export function talentTranslationManifest(): TalentTranslationManifestEntry[] {
  const entries: TalentTranslationManifestEntry[] = [];
  for (const ct of talentClassData()) {
    for (const spec of ct.specs) {
      entries.push({
        kind: 'talentSpec',
        id: spec.id,
        classId: spec.class,
        field: 'name',
        source: spec.name,
      });
      entries.push({
        kind: 'talentSpec',
        id: spec.id,
        classId: spec.class,
        field: 'description',
        source: spec.description,
      });
      entries.push({
        kind: 'talentMastery',
        id: `${spec.id}.mastery`,
        classId: spec.class,
        specId: spec.id,
        field: 'name',
        source: spec.mastery.name,
      });
      entries.push({
        kind: 'talentMastery',
        id: `${spec.id}.mastery`,
        classId: spec.class,
        specId: spec.id,
        field: 'description',
        source: spec.mastery.description,
      });
    }
    for (const row of CHOICE_ROWS[ct.class].rows) {
      for (const choice of row.options) {
        entries.push({
          kind: 'talentChoice',
          id: `${row.level}.${choice.id}`,
          classId: ct.class,
          field: 'name',
          source: choice.name,
        });
        entries.push({
          kind: 'talentChoice',
          id: `${row.level}.${choice.id}`,
          classId: ct.class,
          field: 'description',
          source: choice.description,
        });
      }
    }
    for (const node of ct.nodes) {
      entries.push({
        kind: 'talentNode',
        id: node.id,
        classId: ct.class,
        specId: node.specId,
        field: 'name',
        source: node.name,
      });
      entries.push({
        kind: 'talentNode',
        id: node.id,
        classId: ct.class,
        specId: node.specId,
        field: 'description',
        source: node.description,
      });
      for (const choice of node.choices ?? []) {
        entries.push({
          kind: 'talentChoice',
          id: `${node.id}.${choice.id}`,
          classId: ct.class,
          specId: node.specId,
          field: 'name',
          source: choice.name,
        });
        entries.push({
          kind: 'talentChoice',
          id: `${node.id}.${choice.id}`,
          classId: ct.class,
          specId: node.specId,
          field: 'description',
          source: choice.description,
        });
      }
    }
  }
  return entries;
}

export function renderTalentManifestEntry(entry: TalentTranslationManifestEntry): string {
  const ct = TALENTS[entry.classId];
  if (!ct) return entry.source;
  if (entry.kind === 'talentSpec' || entry.kind === 'talentMastery') {
    const spec = ct.specs.find(
      (candidate) => candidate.id === (entry.kind === 'talentSpec' ? entry.id : entry.specId),
    );
    if (!spec) return entry.source;
    return tTalent({ kind: entry.kind, spec, field: entry.field });
  }
  if (entry.kind === 'talentChoice') {
    const [rawLevel, choiceId] = entry.id.split('.');
    const level = Number(rawLevel);
    const row = Number.isFinite(level)
      ? CHOICE_ROWS[entry.classId].rows.find((candidate) => candidate.level === level)
      : undefined;
    const choice = row?.options.find((candidate) => candidate.id === choiceId);
    if (!choice) return entry.source;
    return tTalent({ kind: 'talentChoice', choice, field: entry.field });
  }
  const [nodeId] = entry.id.split('.');
  const node = ct.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return entry.source;
  return tTalent({ kind: 'talentNode', node, field: entry.field });
}
