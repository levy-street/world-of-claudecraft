import type { SupportedLanguage } from './i18n';

// Authored winning-Warrior row descriptions that cannot be generated from
// primitive effect metadata alone. Keep description data separate from title data.
type RetainedRowDescriptionId =
  | 'war_row_second_wind'
  | 'war_row_anger_management'
  | 'war_row_blood_offering'
  | 'war_row_battle_rhythm';

type DescriptionMap = Readonly<Record<RetainedRowDescriptionId, string>>;

export const RETAINED_ROW_DESCRIPTION_OVERRIDES: Partial<
  Record<SupportedLanguage, DescriptionMap>
> = {
  es: {
    war_row_second_wind:
      'Por debajo del 35 % de salud, regeneras un 1,5 % de tu salud por segundo.',
    war_row_anger_management:
      'Tus ataques automáticos generan un 25 % más de ira y tus habilidades, un 15 % más.',
    war_row_blood_offering:
      'Tus actitudes obtienen efectos adicionales. Actitud de Batalla: los golpes críticos de tus habilidades infligen un 15 % más de daño. Actitud Rabiosa: tus ataques automáticos son un 5 % más rápidos. Actitud en Guardia: un golpe que te quitaría al menos un 20 % de tu salud máxima inflige un 15 % menos de daño.',
    war_row_battle_rhythm:
      'Cada tercera habilidad que utilizas genera un 20 % más de ira e inflige un 5 % más de daño.',
  },
  es_ES: {
    war_row_second_wind:
      'Por debajo del 35 % de salud, regeneras un 1,5 % de tu salud por segundo.',
    war_row_anger_management:
      'Tus ataques automáticos generan un 25 % más de ira y tus habilidades, un 15 % más.',
    war_row_blood_offering:
      'Tus actitudes obtienen efectos adicionales. Actitud de Batalla: los golpes críticos de tus habilidades infligen un 15 % más de daño. Actitud Rabiosa: tus ataques automáticos son un 5 % más rápidos. Actitud en Guardia: un golpe que te quitaría al menos un 20 % de tu salud máxima inflige un 15 % menos de daño.',
    war_row_battle_rhythm:
      'Cada tercera habilidad que utilizas genera un 20 % más de ira e inflige un 5 % más de daño.',
  },
  fr_FR: {
    war_row_second_wind:
      'Lorsque vos points de vie sont inférieurs à 35 %, vous régénérez 1,5 % de vos points de vie par seconde.',
    war_row_anger_management:
      'Vos attaques automatiques génèrent 25 % de rage en plus et vos techniques 15 % de plus.',
    war_row_blood_offering:
      'Vos postures gagnent des effets supplémentaires. Posture de combat : les coups critiques de vos techniques infligent 15 % de dégâts supplémentaires. Posture berserker : vos attaques automatiques sont 5 % plus rapides. Posture de garde : un coup qui vous retirerait au moins 20 % de votre maximum de points de vie inflige 15 % de dégâts en moins.',
    war_row_battle_rhythm:
      'Chaque troisième technique utilisée génère 20 % de rage en plus et inflige 5 % de dégâts supplémentaires.',
  },
  fr_CA: {
    war_row_second_wind:
      'Lorsque vos points de vie sont inférieurs à 35 %, vous régénérez 1,5 % de vos points de vie par seconde.',
    war_row_anger_management:
      'Vos attaques automatiques génèrent 25 % de rage en plus et vos techniques 15 % de plus.',
    war_row_blood_offering:
      'Vos postures gagnent des effets supplémentaires. Posture de combat : les coups critiques de vos techniques infligent 15 % de dégâts supplémentaires. Posture berserker : vos attaques automatiques sont 5 % plus rapides. Posture de garde : un coup qui vous retirerait au moins 20 % de votre maximum de points de vie inflige 15 % de dégâts en moins.',
    war_row_battle_rhythm:
      'Chaque troisième technique utilisée génère 20 % de rage en plus et inflige 5 % de dégâts supplémentaires.',
  },
  it_IT: {
    war_row_second_wind: 'Sotto il 35% di salute, rigeneri l’1,5% della tua salute ogni secondo.',
    war_row_anger_management:
      'I tuoi attacchi automatici generano il 25% di rabbia in più e le tue abilità il 15% in più.',
    war_row_blood_offering:
      'Le tue posizioni ottengono effetti aggiuntivi. Posizione di Battaglia: i colpi critici delle tue abilità infliggono il 15% di danni in più. Posizione del Berserker: i tuoi attacchi automatici sono più rapidi del 5%. Posizione Guardinga: un colpo che ti sottrarrebbe almeno il 20% della salute massima infligge il 15% di danni in meno.',
    war_row_battle_rhythm:
      'Ogni terza abilità usata genera il 20% di rabbia in più e infligge il 5% di danni in più.',
  },
  de_DE: {
    war_row_second_wind:
      'Unter 35 % Gesundheit regenerierst du pro Sekunde 1,5 % deiner Gesundheit.',
    war_row_anger_management:
      'Deine automatischen Angriffe erzeugen 25 % mehr Wut und deine Fähigkeiten 15 % mehr.',
    war_row_blood_offering:
      'Deine Haltungen erhalten zusätzliche Effekte. Kampfhaltung: Kritische Treffer deiner Fähigkeiten verursachen 15 % mehr Schaden. Berserkerhaltung: Deine automatischen Angriffe sind 5 % schneller. Wehrhafte Haltung: Ein Treffer, der dir mindestens 20 % deiner maximalen Gesundheit nehmen würde, verursacht 15 % weniger Schaden.',
    war_row_battle_rhythm:
      'Jede dritte eingesetzte Fähigkeit erzeugt 20 % mehr Wut und verursacht 5 % mehr Schaden.',
  },
  pt_BR: {
    war_row_second_wind: 'Abaixo de 35% de vida, você regenera 1,5% da sua vida por segundo.',
    war_row_anger_management:
      'Seus ataques automáticos geram 25% mais raiva e suas habilidades geram 15% mais.',
    war_row_blood_offering:
      'Suas posturas recebem efeitos adicionais. Postura de Batalha: acertos críticos das suas habilidades causam 15% a mais de dano. Postura de Berserker: seus ataques automáticos ficam 5% mais rápidos. Postura de Guarda: um golpe que tiraria pelo menos 20% da sua vida máxima causa 15% a menos de dano.',
    war_row_battle_rhythm:
      'Cada terceira habilidade usada gera 20% mais raiva e causa 5% a mais de dano.',
  },
  ru_RU: {
    war_row_second_wind:
      'При уровне здоровья ниже 35% вы восстанавливаете 1,5% здоровья в секунду.',
    war_row_anger_management:
      'Ваши автоматические атаки генерируют на 25% больше ярости, а способности на 15% больше.',
    war_row_blood_offering:
      'Ваши стойки получают дополнительные эффекты. Боевая стойка: критические удары способностей наносят на 15% больше урона. Стойка берсерка: автоматические атаки совершаются на 5% быстрее. Стойка стража: удар, который отнял бы не менее 20% максимального здоровья, наносит на 15% меньше урона.',
    war_row_battle_rhythm:
      'Каждая третья использованная способность генерирует на 20% больше ярости и наносит на 5% больше урона.',
  },
  cs_CZ: {
    war_row_second_wind: 'Pod 35 % zdraví si každou sekundu obnovujete 1,5 % zdraví.',
    war_row_anger_management:
      'Vaše automatické útoky generují o 25 % více zuřivosti a vaše schopnosti o 15 % více.',
    war_row_blood_offering:
      'Vaše postoje získávají další účinky. Bojový postoj: kritické zásahy schopností způsobují o 15 % vyšší poškození. Postoj berserka: automatické útoky jsou o 5 % rychlejší. Krytý postoj: zásah, který by vám odebral alespoň 20 % maximálního zdraví, způsobí o 15 % nižší poškození.',
    war_row_battle_rhythm:
      'Každá třetí použitá schopnost generuje o 20 % více zuřivosti a způsobuje o 5 % vyšší poškození.',
  },
  nl_NL: {
    war_row_second_wind: 'Onder 35% gezondheid herstel je elke seconde 1,5% van je gezondheid.',
    war_row_anger_management:
      'Je automatische aanvallen genereren 25% meer woede en je vaardigheden 15% meer.',
    war_row_blood_offering:
      'Je houdingen krijgen extra effecten. Strijdhouding: kritieke treffers van je vaardigheden richten 15% meer schade aan. Berserkerhouding: je automatische aanvallen zijn 5% sneller. Bewaakte Houding: een treffer die minstens 20% van je maximale gezondheid zou kosten, richt 15% minder schade aan.',
    war_row_battle_rhythm:
      'Elke derde gebruikte vaardigheid genereert 20% meer woede en richt 5% meer schade aan.',
  },
  pl_PL: {
    war_row_second_wind: 'Poniżej 35% zdrowia regenerujesz 1,5% zdrowia na sekundę.',
    war_row_anger_management:
      'Twoje automatyczne ataki generują o 25% więcej szału, a umiejętności o 15% więcej.',
    war_row_blood_offering:
      'Twoje postawy zyskują dodatkowe efekty. Postawa bojowa: trafienia krytyczne umiejętności zadają o 15% więcej obrażeń. Postawa berserkera: automatyczne ataki są o 5% szybsze. Czujna postawa: cios, który odebrałby co najmniej 20% maksymalnego zdrowia, zadaje o 15% mniej obrażeń.',
    war_row_battle_rhythm:
      'Co trzecia użyta umiejętność generuje o 20% więcej szału i zadaje o 5% więcej obrażeń.',
  },
  id_ID: {
    war_row_second_wind: 'Saat nyawamu di bawah 35%, kamu memulihkan 1,5% nyawa setiap detik.',
    war_row_anger_management:
      'Serangan otomatismu menghasilkan 25% lebih banyak amarah dan kemampuanmu 15% lebih banyak.',
    war_row_blood_offering:
      'Kuda-kudamu memperoleh efek tambahan. Kuda-kuda Tempur: serangan kritis kemampuanmu menghasilkan 15% lebih banyak kerusakan. Kuda-kuda Berserker: serangan otomatismu 5% lebih cepat. Kuda-kuda Waspada: serangan yang akan mengurangi setidaknya 20% nyawa maksimummu menghasilkan 15% lebih sedikit kerusakan.',
    war_row_battle_rhythm:
      'Setiap kemampuan ketiga yang kamu gunakan menghasilkan 20% lebih banyak amarah dan 5% lebih banyak kerusakan.',
  },
  tr_TR: {
    war_row_second_wind: 'Sağlığın %35’in altındayken her saniye sağlığının %1,5’ini yenilersin.',
    war_row_anger_management: 'Otomatik saldırıların %25, yeteneklerin %15 daha fazla öfke üretir.',
    war_row_blood_offering:
      'Duruşların ek etkiler kazanır. Savaş Duruşu: yeteneklerinin kritik vuruşları %15 daha fazla hasar verir. Berserker Duruşu: otomatik saldırıların %5 daha hızlıdır. Korumalı Duruş: azami sağlığının en az %20’sini götürecek bir darbe %15 daha az hasar verir.',
    war_row_battle_rhythm:
      'Kullandığın her üçüncü yetenek %20 daha fazla öfke üretir ve %5 daha fazla hasar verir.',
  },
  sv_SE: {
    war_row_second_wind: 'Under 35 % hälsa återställer du 1,5 % av din hälsa per sekund.',
    war_row_anger_management:
      'Dina automatiska attacker genererar 25 % mer raseri och dina förmågor 15 % mer.',
    war_row_blood_offering:
      'Dina ställningar får ytterligare effekter. Stridsställning: kritiska träffar med förmågor gör 15 % mer skada. Bärsärkaställning: dina automatiska attacker är 5 % snabbare. Gardställning: en träff som skulle ta minst 20 % av din maximala hälsa gör 15 % mindre skada.',
    war_row_battle_rhythm:
      'Var tredje förmåga du använder genererar 20 % mer raseri och gör 5 % mer skada.',
  },
  vi_VN: {
    war_row_second_wind: 'Khi còn dưới 35% máu, bạn hồi 1,5% máu mỗi giây.',
    war_row_anger_management: 'Đòn đánh tự động tạo thêm 25% nộ và kỹ năng tạo thêm 15% nộ.',
    war_row_blood_offering:
      'Các thế của bạn nhận thêm hiệu ứng. Thế Công: đòn chí mạng từ kỹ năng gây thêm 15% sát thương. Thế Cuồng Chiến: đòn đánh tự động nhanh hơn 5%. Thế Thủ: một đòn đánh vốn lấy đi ít nhất 20% máu tối đa của bạn sẽ gây ít hơn 15% sát thương.',
    war_row_battle_rhythm:
      'Mỗi kỹ năng thứ ba bạn sử dụng tạo thêm 20% nộ và gây thêm 5% sát thương.',
  },
  da_DK: {
    war_row_second_wind: 'Under 35 % helbred genvinder du 1,5 % af dit helbred hvert sekund.',
    war_row_anger_management:
      'Dine autoangreb genererer 25 % mere raseri, og dine evner genererer 15 % mere.',
    war_row_blood_offering:
      'Dine stillinger får yderligere effekter. Kampstilling: kritiske træffere med evner giver 15 % mere skade. Berserkerstilling: dine autoangreb er 5 % hurtigere. Værgende Stilling: et træf, der ville tage mindst 20 % af dit maksimale helbred, giver 15 % mindre skade.',
    war_row_battle_rhythm:
      'Hver tredje evne, du bruger, genererer 20 % mere raseri og giver 5 % mere skade.',
  },
  zh_CN: {
    war_row_second_wind: '生命值低于35%时，你每秒恢复1.5%的生命值。',
    war_row_anger_management: '你的自动攻击产生的怒气提高25%，技能产生的怒气提高15%。',
    war_row_blood_offering:
      '你的姿态获得额外效果。战斗姿态：你的技能暴击造成的伤害提高15%。狂暴姿态：你的自动攻击加快5%。戒备姿态：若一次命中会使你损失至少20%的最大生命值，则该次伤害降低15%。',
    war_row_battle_rhythm: '你每使用第三个技能时，该技能产生的怒气提高20%，造成的伤害提高5%。',
  },
  zh_TW: {
    war_row_second_wind: '生命值低於35%時，你每秒恢復1.5%的生命值。',
    war_row_anger_management: '你的自動攻擊產生的怒氣提高25%，技能產生的怒氣提高15%。',
    war_row_blood_offering:
      '你的姿態獲得額外效果。戰鬥姿態：你的技能致命一擊造成的傷害提高15%。狂暴姿態：你的自動攻擊加快5%。戒備姿態：若一次命中會使你損失至少20%的最大生命值，則該次傷害降低15%。',
    war_row_battle_rhythm: '你每使用第三個技能時，該技能產生的怒氣提高20%，造成的傷害提高5%。',
  },
  ja_JP: {
    war_row_second_wind: '体力が35%未満の間、毎秒、体力を1.5%回復します。',
    war_row_anger_management: '自動攻撃の怒気生成量が25%、アビリティの怒気生成量が15%増加します。',
    war_row_blood_offering:
      '各スタンスに追加効果を与えます。バトルスタンス：アビリティのクリティカルダメージが15%増加します。バーサーカースタンス：自動攻撃が5%速くなります。ガーデッドスタンス：最大体力の20%以上を失う攻撃のダメージが15%減少します。',
    war_row_battle_rhythm: '3回目に使用するアビリティは、怒気生成量が20%、ダメージが5%増加します。',
  },
  ko_KR: {
    war_row_second_wind: '생명력이 35% 미만이면 매초 생명력의 1.5%를 회복합니다.',
    war_row_anger_management: '자동 공격의 분노 생성량이 25%, 능력의 분노 생성량이 15% 증가합니다.',
    war_row_blood_offering:
      '각 태세에 추가 효과가 부여됩니다. 전투 태세: 능력의 치명타 피해가 15% 증가합니다. 광전사 태세: 자동 공격이 5% 빨라집니다. 방어 태세: 최대 생명력의 20% 이상을 잃게 할 공격의 피해가 15% 감소합니다.',
    war_row_battle_rhythm: '세 번째로 사용하는 능력은 분노 생성량이 20%, 피해가 5% 증가합니다.',
  },
};
