// GENERATED new-locale talent text. Spread into localeTextByBase in talent_i18n.ts.
import type { TalentLocaleText } from './talent_i18n';

export const TALENT_NEW: Record<
  'da_DK' | 'id_ID' | 'nl_NL' | 'pl_PL' | 'sv_SE' | 'tr_TR' | 'vi_VN',
  TalentLocaleText
> = {
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
      castWhileMoving: 'kan fremmanes under bevægelse',
      spellCritVsRooted: 'kritisk chance med besværgelser mod rodfæstede mål',
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
    castWhileMoving: (abilityName) => abilityName + ' kan fremmanes under bevægelse.',
    addRoot: (abilityName, seconds) =>
      abilityName + ' rodfæster også målet i ' + seconds + ' sek.',
    addAoeRoot: (abilityName, seconds) =>
      abilityName + ' rodfæster også ramte mål i ' + seconds + ' sek.',
    addInterrupt: (abilityName, seconds) =>
      abilityName + ' afbryder også kast og låser den skole i ' + seconds + ' sek.',
    addDot: (abilityName, amount, seconds) =>
      abilityName + ' påfører også ' + amount + ' skade over ' + seconds + ' sek.',
    addLeechDot: (abilityName, amount, seconds) =>
      abilityName + ' helbreder dig også for op til ' + amount + ' over ' + seconds + ' sek.',
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
      castWhileMoving: 'dapat dirapal sambil bergerak',
      spellCritVsRooted: 'peluang kritis mantra terhadap target yang terikat',
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
    castWhileMoving: (abilityName) => abilityName + ' dapat dirapal sambil bergerak.',
    addRoot: (abilityName, seconds) =>
      abilityName + ' juga mengikat target selama ' + seconds + ' dtk.',
    addAoeRoot: (abilityName, seconds) =>
      abilityName + ' juga mengikat target yang terkena selama ' + seconds + ' dtk.',
    addInterrupt: (abilityName, seconds) =>
      abilityName + ' juga menghentikan rapalan dan mengunci sekolah itu selama ' + seconds + ' dtk.',
    addDot: (abilityName, amount, seconds) =>
      abilityName + ' juga memberikan ' + amount + ' kerusakan selama ' + seconds + ' dtk.',
    addLeechDot: (abilityName, amount, seconds) =>
      abilityName + ' juga menyembuhkanmu hingga ' + amount + ' selama ' + seconds + ' dtk.',
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
      castWhileMoving: 'te gebruiken tijdens bewegen',
      spellCritVsRooted: 'kritieke spreukkans tegen gewortelde doelen',
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
    castWhileMoving: (abilityName) => abilityName + ' kan tijdens bewegen worden gebruikt.',
    addRoot: (abilityName, seconds) =>
      abilityName + ' wortelt het doel ook ' + seconds + ' sec.',
    addAoeRoot: (abilityName, seconds) =>
      abilityName + ' wortelt geraakte doelen ook ' + seconds + ' sec.',
    addInterrupt: (abilityName, seconds) =>
      abilityName + ' onderbreekt ook het spreuken en blokkeert die school ' + seconds + ' sec.',
    addDot: (abilityName, amount, seconds) =>
      abilityName + ' brengt ook ' + amount + ' schade toe over ' + seconds + ' sec.',
    addLeechDot: (abilityName, amount, seconds) =>
      abilityName + ' geneest je ook tot ' + amount + ' over ' + seconds + ' sec.',
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
      castWhileMoving: 'można rzucać w ruchu',
      spellCritVsRooted: 'szansa na krytyczne zaklęcie przeciw unieruchomionym celom',
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
    castWhileMoving: (abilityName) => abilityName + ' można rzucać w ruchu.',
    addRoot: (abilityName, seconds) =>
      abilityName + ' dodatkowo unieruchamia cel na ' + seconds + ' sek.',
    addAoeRoot: (abilityName, seconds) =>
      abilityName + ' dodatkowo unieruchamia trafione cele na ' + seconds + ' sek.',
    addInterrupt: (abilityName, seconds) =>
      abilityName + ' dodatkowo przerywa rzucanie i blokuje tę szkołę na ' + seconds + ' sek.',
    addDot: (abilityName, amount, seconds) =>
      abilityName + ' dodatkowo zadaje ' + amount + ' obrażeń przez ' + seconds + ' sek.',
    addLeechDot: (abilityName, amount, seconds) =>
      abilityName + ' dodatkowo leczy cię do ' + amount + ' przez ' + seconds + ' sek.',
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
      castWhileMoving: 'kan kastas under rörelse',
      spellCritVsRooted: 'kritisk chans med besvärjelser mot rotade mål',
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
    castWhileMoving: (abilityName) => abilityName + ' kan kastas under rörelse.',
    addRoot: (abilityName, seconds) =>
      abilityName + ' rotar också målet i ' + seconds + ' sek.',
    addAoeRoot: (abilityName, seconds) =>
      abilityName + ' rotar också träffade mål i ' + seconds + ' sek.',
    addInterrupt: (abilityName, seconds) =>
      abilityName + ' avbryter också kast och låser den skolan i ' + seconds + ' sek.',
    addDot: (abilityName, amount, seconds) =>
      abilityName + ' orsakar också ' + amount + ' skada över ' + seconds + ' sek.',
    addLeechDot: (abilityName, amount, seconds) =>
      abilityName + ' läker dig också för upp till ' + amount + ' över ' + seconds + ' sek.',
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
      castWhileMoving: 'hareket ederken kullanılabilir',
      spellCritVsRooted: 'sabitlenmiş hedeflere karşı büyü kritik şansı',
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
    castWhileMoving: (abilityName) => abilityName + ' hareket ederken kullanılabilir.',
    addRoot: (abilityName, seconds) =>
      abilityName + ' hedefi ayrıca ' + seconds + ' sn. sabitler.',
    addAoeRoot: (abilityName, seconds) =>
      abilityName + ' isabet alan hedefleri ayrıca ' + seconds + ' sn. sabitler.',
    addInterrupt: (abilityName, seconds) =>
      abilityName + ' ayrıca büyüyü keser ve o okulu ' + seconds + ' sn. kilitler.',
    addDot: (abilityName, amount, seconds) =>
      abilityName + ' ayrıca ' + seconds + ' sn. boyunca ' + amount + ' hasar verir.',
    addLeechDot: (abilityName, amount, seconds) =>
      abilityName + ' ayrıca ' + seconds + ' sn. boyunca seni en fazla ' + amount + ' iyileştirir.',
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
      castWhileMoving: 'có thể niệm khi di chuyển',
      spellCritVsRooted: 'tỉ lệ chí mạng phép lên mục tiêu bị trói chân',
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
    castWhileMoving: (abilityName) => abilityName + ' có thể niệm khi di chuyển.',
    addRoot: (abilityName, seconds) =>
      abilityName + ' cũng trói chân mục tiêu trong ' + seconds + ' giây.',
    addAoeRoot: (abilityName, seconds) =>
      abilityName + ' cũng trói chân các mục tiêu trúng đòn trong ' + seconds + ' giây.',
    addInterrupt: (abilityName, seconds) =>
      abilityName + ' cũng ngắt niệm và khóa hệ đó trong ' + seconds + ' giây.',
    addDot: (abilityName, amount, seconds) =>
      abilityName + ' cũng gây ' + amount + ' sát thương trong ' + seconds + ' giây.',
    addLeechDot: (abilityName, amount, seconds) =>
      abilityName + ' cũng hồi cho bạn tối đa ' + amount + ' trong ' + seconds + ' giây.',
  },
};
