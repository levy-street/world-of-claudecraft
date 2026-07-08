// GENERATED new-locale talent text. Spread into localeTextByBase in talent_i18n.ts.
import type { TalentLocaleText } from './talent_i18n';

export const TALENT_NEW: Record<
  'cs_CZ' | 'da_DK' | 'id_ID' | 'nl_NL' | 'pl_PL' | 'sv_SE' | 'tr_TR' | 'vi_VN',
  TalentLocaleText
> = {
  cs_CZ: {
    statLabels: {
      str: 'Síla',
      agi: 'Obratnost',
      sta: 'Výdrž',
      int: 'Intelekt',
      spi: 'Duch',
      armor: 'brnění',
      ap: 'útočnou sílu',
      crit: 'šanci na kritický zásah',
      dodge: 'šanci na vyhnutí',
      apPct: 'útočnou sílu',
      staPct: 'Výdrž',
      armorPct: 'brnění',
      maxHpPct: 'maximální zdraví',
      meleeDmgPct: 'poškození schopností na blízko',
      spellDmgPct: 'poškození kouzly',
      healPct: 'účinnost léčení',
      threatPct: 'vytvořenou hrozbu',
      damage: 'poškození',
      cost: 'cenu',
      cooldown: 'dobu obnovy',
      castTime: 'dobu sesílání',
    },
    roleLabels: { tank: 'tankování', healer: 'léčení', dps: 'poškození' },
    perRank: ' za stupeň',
    noEffect: 'Poskytuje bonus specializace.',
    chooseOne: (name) => 'Vyber jednu možnost pro ' + name + '.',
    specDescription: (className, role, abilityName) =>
      'Specializace pro ' +
      className +
      ' zaměřená na ' +
      role +
      '. Hlavní schopnost: ' +
      abilityName +
      '.',
    grant: (abilityName) => 'Poskytuje ' + abilityName + '.',
    increase: (target, amount, perRank) => 'Zvyšuje ' + target + ' o ' + amount + perRank + '.',
    reduce: (target, amount, perRank) => 'Snižuje ' + target + ' o ' + amount + perRank + '.',
  },
  da_DK: {
    statLabels: {
      str: 'Styrke',
      agi: 'Adræthed',
      sta: 'Udholdenhed',
      int: 'Intellekt',
      spi: 'Ånd',
      armor: 'rustning',
      ap: 'angrebskraft',
      crit: 'chance for kritisk slag',
      dodge: 'undvigelseschance',
      apPct: 'angrebskraft',
      staPct: 'Udholdenhed',
      armorPct: 'rustning',
      maxHpPct: 'maksimalt helbred',
      meleeDmgPct: 'skade fra nærkampsevner',
      spellDmgPct: 'magiskade',
      healPct: 'udført helbredelse',
      threatPct: 'genereret trussel',
      damage: 'skade',
      cost: 'omkostning',
      cooldown: 'afkøling',
      castTime: 'fremmaningstid',
    },
    roleLabels: { tank: 'tank', healer: 'helbreder', dps: 'skade' },
    perRank: ' pr. rang',
    noEffect: 'Giver en specialiseringsfordel.',
    chooseOne: (name) => 'Vælg én ' + name + '-mulighed.',
    specDescription: (className, role, abilityName) =>
      className + '-specialisering med fokus på ' + role + '. Signaturevne: ' + abilityName + '.',
    grant: (abilityName) => 'Giver ' + abilityName + '.',
    increase: (target, amount, perRank) => 'Forøger ' + target + ' med ' + amount + perRank + '.',
    reduce: (target, amount, perRank) => 'Reducerer ' + target + ' med ' + amount + perRank + '.',
  },
  id_ID: {
    statLabels: {
      str: 'Kekuatan',
      agi: 'Ketangkasan',
      sta: 'Stamina',
      int: 'Kecerdasan',
      spi: 'Semangat',
      armor: 'zirah',
      ap: 'kekuatan serang',
      crit: 'peluang serangan kritis',
      dodge: 'peluang menghindar',
      apPct: 'kekuatan serang',
      staPct: 'Stamina',
      armorPct: 'zirah',
      maxHpPct: 'nyawa maksimum',
      meleeDmgPct: 'kerusakan kemampuan jarak dekat',
      spellDmgPct: 'kerusakan mantra',
      healPct: 'penyembuhan yang dilakukan',
      threatPct: 'ancaman yang dihasilkan',
      damage: 'kerusakan',
      cost: 'biaya',
      cooldown: 'waktu jeda',
      castTime: 'waktu merapal',
    },
    roleLabels: { tank: 'tank', healer: 'penyembuh', dps: 'kerusakan' },
    perRank: ' per tingkat',
    noEffect: 'Memberikan manfaat spesialisasi.',
    chooseOne: (name) => 'Pilih salah satu opsi ' + name + '.',
    specDescription: (className, role, abilityName) =>
      'Spesialisasi ' +
      className +
      ' yang berfokus pada ' +
      role +
      '. Kemampuan khas: ' +
      abilityName +
      '.',
    grant: (abilityName) => 'Memberikan ' + abilityName + '.',
    increase: (target, amount, perRank) =>
      'Meningkatkan ' + target + ' sebesar ' + amount + perRank + '.',
    reduce: (target, amount, perRank) =>
      'Mengurangi ' + target + ' sebesar ' + amount + perRank + '.',
  },
  nl_NL: {
    statLabels: {
      str: 'Kracht',
      agi: 'Behendigheid',
      sta: 'Uithoudingsvermogen',
      int: 'Intellect',
      spi: 'Geest',
      armor: 'pantser',
      ap: 'aanvalskracht',
      crit: 'kritieke-treffer-kans',
      dodge: 'ontwijkkans',
      apPct: 'aanvalskracht',
      staPct: 'Uithoudingsvermogen',
      armorPct: 'pantser',
      maxHpPct: 'maximale gezondheid',
      meleeDmgPct: 'schade van melee-vaardigheden',
      spellDmgPct: 'spreukschade',
      healPct: 'genezing',
      threatPct: 'gegenereerde dreiging',
      damage: 'schade',
      cost: 'kosten',
      cooldown: 'afkoeltijd',
      castTime: 'spreuktijd',
    },
    roleLabels: { tank: 'tank', healer: 'genezer', dps: 'schade' },
    perRank: ' per rang',
    noEffect: 'Biedt een specialisatievoordeel.',
    chooseOne: (name) => 'Kies één ' + name + '-optie.',
    specDescription: (className, role, abilityName) =>
      className +
      '-specialisatie gericht op ' +
      role +
      '. Kenmerkende vaardigheid: ' +
      abilityName +
      '.',
    grant: (abilityName) => 'Verleent ' + abilityName + '.',
    increase: (target, amount, perRank) => 'Verhoogt ' + target + ' met ' + amount + perRank + '.',
    reduce: (target, amount, perRank) => 'Verlaagt ' + target + ' met ' + amount + perRank + '.',
  },
  pl_PL: {
    statLabels: {
      str: 'Siła',
      agi: 'Zręczność',
      sta: 'Wytrzymałość',
      int: 'Intelekt',
      spi: 'Duch',
      armor: 'pancerz',
      ap: 'siłę ataku',
      crit: 'szansę na trafienie krytyczne',
      dodge: 'szansę na unik',
      apPct: 'siłę ataku',
      staPct: 'Wytrzymałość',
      armorPct: 'pancerz',
      maxHpPct: 'maksymalne zdrowie',
      meleeDmgPct: 'obrażenia od zdolności wręcz',
      spellDmgPct: 'obrażenia od zaklęć',
      healPct: 'wykonane leczenie',
      threatPct: 'generowane zagrożenie',
      damage: 'obrażenia',
      cost: 'koszt',
      cooldown: 'czas odnowienia',
      castTime: 'czas rzucania',
    },
    roleLabels: { tank: 'tank', healer: 'uzdrowiciel', dps: 'obrażenia' },
    perRank: ' na poziom',
    noEffect: 'Zapewnia korzyść specjalizacji.',
    chooseOne: (name) => 'Wybierz jedną opcję: ' + name + '.',
    specDescription: (className, role, abilityName) =>
      'Specjalizacja klasy ' +
      className +
      ' skupiona na roli ' +
      role +
      '. Sztandarowa zdolność: ' +
      abilityName +
      '.',
    grant: (abilityName) => 'Daje ' + abilityName + '.',
    increase: (target, amount, perRank) => 'Zwiększa ' + target + ' o ' + amount + perRank + '.',
    reduce: (target, amount, perRank) => 'Zmniejsza ' + target + ' o ' + amount + perRank + '.',
  },
  sv_SE: {
    statLabels: {
      str: 'Styrka',
      agi: 'Smidighet',
      sta: 'Uthållighet',
      int: 'Intellekt',
      spi: 'Ande',
      armor: 'rustning',
      ap: 'attackkraft',
      crit: 'chans till kritisk träff',
      dodge: 'undvikningschans',
      apPct: 'attackkraft',
      staPct: 'Uthållighet',
      armorPct: 'rustning',
      maxHpPct: 'maximalt liv',
      meleeDmgPct: 'närstridsförmågeskada',
      spellDmgPct: 'magiskada',
      healPct: 'utförd läkning',
      threatPct: 'genererat hot',
      damage: 'skada',
      cost: 'kostnad',
      cooldown: 'nedkylning',
      castTime: 'kanaliseringstid',
    },
    roleLabels: { tank: 'tank', healer: 'läkare', dps: 'skada' },
    perRank: ' per rang',
    noEffect: 'Ger en specialiseringsfördel.',
    chooseOne: (name) => 'Välj ett ' + name + '-alternativ.',
    specDescription: (className, role, abilityName) =>
      className + '-specialisering inriktad på ' + role + '. Signaturförmåga: ' + abilityName + '.',
    grant: (abilityName) => 'Ger ' + abilityName + '.',
    increase: (target, amount, perRank) => 'Ökar ' + target + ' med ' + amount + perRank + '.',
    reduce: (target, amount, perRank) => 'Minskar ' + target + ' med ' + amount + perRank + '.',
  },
  tr_TR: {
    statLabels: {
      str: 'Güç',
      agi: 'Çeviklik',
      sta: 'Dayanıklılık',
      int: 'Zeka',
      spi: 'Ruh',
      armor: 'zırh',
      ap: 'saldırı gücü',
      crit: 'kritik vuruş şansı',
      dodge: 'savuşturma şansı',
      apPct: 'saldırı gücü',
      staPct: 'Dayanıklılık',
      armorPct: 'zırh',
      maxHpPct: 'maksimum can',
      meleeDmgPct: 'yakın dövüş yetenek hasarı',
      spellDmgPct: 'büyü hasarı',
      healPct: 'verilen iyileştirme',
      threatPct: 'üretilen tehdit',
      damage: 'hasar',
      cost: 'maliyet',
      cooldown: 'bekleme süresi',
      castTime: 'büyü süresi',
    },
    roleLabels: { tank: 'tank', healer: 'şifacı', dps: 'hasar' },
    perRank: ' her rütbede',
    noEffect: 'Bir uzmanlık avantajı sağlar.',
    chooseOne: (name) => 'Bir ' + name + ' seçeneği seçin.',
    specDescription: (className, role, abilityName) =>
      role + ' odaklı ' + className + ' uzmanlığı. İmza yeteneği: ' + abilityName + '.',
    grant: (abilityName) => abilityName + ' kazandırır.',
    increase: (target, amount, perRank) => target + ' değerini ' + amount + perRank + ' artırır.',
    reduce: (target, amount, perRank) => target + ' değerini ' + amount + perRank + ' azaltır.',
  },
  vi_VN: {
    statLabels: {
      str: 'Sức Mạnh',
      agi: 'Nhanh Nhẹn',
      sta: 'Thể Lực',
      int: 'Trí Tuệ',
      spi: 'Tinh Thần',
      armor: 'giáp',
      ap: 'sát thương cận chiến',
      crit: 'tỉ lệ chí mạng',
      dodge: 'tỉ lệ né đòn',
      apPct: 'sát thương cận chiến',
      staPct: 'Thể Lực',
      armorPct: 'giáp',
      maxHpPct: 'máu tối đa',
      meleeDmgPct: 'sát thương kỹ năng cận chiến',
      spellDmgPct: 'sát thương phép',
      healPct: 'lượng trị liệu',
      threatPct: 'lượng đe dọa tạo ra',
      damage: 'sát thương',
      cost: 'chi phí',
      cooldown: 'thời gian hồi',
      castTime: 'thời gian niệm',
    },
    roleLabels: { tank: 'đỡ đòn', healer: 'trị liệu', dps: 'sát thương' },
    perRank: ' mỗi cấp',
    noEffect: 'Mang lại lợi ích chuyên môn hóa.',
    chooseOne: (name) => 'Chọn một tùy chọn ' + name + '.',
    specDescription: (className, role, abilityName) =>
      'Chuyên môn hóa ' +
      className +
      ' tập trung vào ' +
      role +
      '. Kỹ năng đặc trưng: ' +
      abilityName +
      '.',
    grant: (abilityName) => 'Trao ' + abilityName + '.',
    increase: (target, amount, perRank) => 'Tăng ' + target + ' thêm ' + amount + perRank + '.',
    reduce: (target, amount, perRank) => 'Giảm ' + target + ' đi ' + amount + perRank + '.',
  },
};
