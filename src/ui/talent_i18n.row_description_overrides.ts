import type { SupportedLanguage } from './i18n';

// Authored winning-Warrior row descriptions that cannot be generated from
// primitive effect metadata alone. Keep description data separate from title data.
type RetainedRowDescriptionId =
  | 'war_row_second_wind'
  | 'war_row_anger_management'
  | 'war_row_blood_offering'
  | 'war_row_battle_rhythm'
  | 'war_row_colossal_might'
  | 'mag_r5_blink_cast'
  | 'mag_r8_temporal_rift'
  | 'mag_r17_convergence'
  | 'mag_r20_overflowing_power'
  | 'dru_r20_improved_hurricane';

type DescriptionMap = Readonly<Record<RetainedRowDescriptionId, string>>;

export const RETAINED_ROW_DESCRIPTION_OVERRIDES: Partial<
  Record<SupportedLanguage, DescriptionMap>
> = {
  es: {
    mag_r5_blink_cast: 'Puedes usar Paso Fugaz en mitad de un lanzamiento sin interrumpirlo.',
    mag_r8_temporal_rift:
      'Cada 20 s, el siguiente aturdimiento, inmovilización o silencio que te impacte se limpia al instante.',
    mag_r17_convergence:
      'Alternar un hechizo de Fuego y uno de Escarcha abre una oleada de poder de 8 s, una vez cada 30 s.',
    mag_r20_overflowing_power:
      'Gastar mana reduce el tiempo de reutilización de tus defensivas: 2 s por cada décima parte de tu mana máximo gastado, hasta 10 s cada 30 s.',
    dru_r20_improved_hurricane:
      'Mientras estás en Forma de búho lunar, tú y los miembros de tu grupo a 30 m ganáis un 3% de probabilidad de golpe crítico con hechizos.',
    war_row_second_wind:
      'Por debajo del 35 % de salud, regeneras un 1,5 % de tu salud por segundo.',
    war_row_anger_management:
      'Tus ataques automáticos generan un 10 % más de ira y tus habilidades, un 5 % más.',
    war_row_blood_offering:
      'Tus actitudes obtienen efectos adicionales. Actitud de Batalla: los golpes críticos de tus habilidades infligen un 15 % más de daño. Actitud Rabiosa: tus ataques automáticos son un 5 % más rápidos. Actitud en Guardia: un golpe que te quitaría al menos un 20 % de tu salud máxima inflige un 15 % menos de daño.',
    war_row_battle_rhythm: 'Cada tercera habilidad que utilizas genera un 20 % más de ira.',
    war_row_colossal_might:
      'Cada punto de ira que gastas reduce en 0,1 s el tiempo de reutilización de tus grandes habilidades ofensivas, hasta 10 s cada 30 s.',
  },
  es_ES: {
    mag_r5_blink_cast: 'Puedes usar Paso Fugaz en mitad de un lanzamiento sin interrumpirlo.',
    mag_r8_temporal_rift:
      'Cada 20 s, el siguiente aturdimiento, inmovilización o silencio que te impacte se limpia al instante.',
    mag_r17_convergence:
      'Alternar un hechizo de Fuego y uno de Escarcha abre una oleada de poder de 8 s, una vez cada 30 s.',
    mag_r20_overflowing_power:
      'Gastar mana reduce el tiempo de reutilización de tus defensivas: 2 s por cada décima parte de tu mana máximo gastado, hasta 10 s cada 30 s.',
    dru_r20_improved_hurricane:
      'Mientras estás en Forma de búho lunar, tú y los miembros de tu grupo a 30 m ganáis un 3% de probabilidad de golpe crítico con hechizos.',
    war_row_second_wind:
      'Por debajo del 35 % de salud, regeneras un 1,5 % de tu salud por segundo.',
    war_row_anger_management:
      'Tus ataques automáticos generan un 10 % más de ira y tus habilidades, un 5 % más.',
    war_row_blood_offering:
      'Tus actitudes obtienen efectos adicionales. Actitud de Batalla: los golpes críticos de tus habilidades infligen un 15 % más de daño. Actitud Rabiosa: tus ataques automáticos son un 5 % más rápidos. Actitud en Guardia: un golpe que te quitaría al menos un 20 % de tu salud máxima inflige un 15 % menos de daño.',
    war_row_battle_rhythm: 'Cada tercera habilidad que utilizas genera un 20 % más de ira.',
    war_row_colossal_might:
      'Cada punto de ira que gastas reduce en 0,1 s el tiempo de reutilización de tus grandes habilidades ofensivas, hasta 10 s cada 30 s.',
  },
  fr_FR: {
    mag_r5_blink_cast:
      "Vous pouvez utiliser Pas scintillant au milieu d'une incantation sans l'interrompre.",
    mag_r8_temporal_rift:
      'Toutes les 20 s, le prochain étourdissement, immobilisation ou silence qui vous frappe est dissipé instantanément.',
    mag_r17_convergence:
      'Alterner un sort de Feu et un sort de Givre déclenche une poussée de puissance de 8 s, une fois toutes les 30 s.',
    mag_r20_overflowing_power:
      "Dépenser du mana réduit le temps de recharge de vos défensives : 2 s par dixième de votre mana maximum dépensé, jusqu'à 10 s toutes les 30 s.",
    dru_r20_improved_hurricane:
      'En Forme de sélénien, vous et les membres de votre groupe dans un rayon de 30 m gagnez 3 % de chances de coup critique avec les sorts.',
    war_row_second_wind:
      'Lorsque vos points de vie sont inférieurs à 35 %, vous régénérez 1,5 % de vos points de vie par seconde.',
    war_row_anger_management:
      'Vos attaques automatiques génèrent 10 % de rage en plus et vos techniques 5 % de plus.',
    war_row_blood_offering:
      'Vos postures gagnent des effets supplémentaires. Posture de combat : les coups critiques de vos techniques infligent 15 % de dégâts supplémentaires. Posture berserker : vos attaques automatiques sont 5 % plus rapides. Posture de garde : un coup qui vous retirerait au moins 20 % de votre maximum de points de vie inflige 15 % de dégâts en moins.',
    war_row_battle_rhythm: 'Chaque troisième technique utilisée génère 20 % de rage en plus.',
    war_row_colossal_might:
      "Chaque point de rage dépensé réduit de 0,1 s le temps de recharge de vos grandes capacités offensives, jusqu'à 10 s toutes les 30 s.",
  },
  fr_CA: {
    mag_r5_blink_cast:
      "Vous pouvez utiliser Pas scintillant au milieu d'une incantation sans l'interrompre.",
    mag_r8_temporal_rift:
      'Toutes les 20 s, le prochain étourdissement, immobilisation ou silence qui vous frappe est dissipé instantanément.',
    mag_r17_convergence:
      'Alterner un sort de Feu et un sort de Givre déclenche une poussée de puissance de 8 s, une fois toutes les 30 s.',
    mag_r20_overflowing_power:
      "Dépenser du mana réduit le temps de recharge de vos défensives : 2 s par dixième de votre mana maximum dépensé, jusqu'à 10 s toutes les 30 s.",
    dru_r20_improved_hurricane:
      'En Forme de sélénien, vous et les membres de votre groupe dans un rayon de 30 m gagnez 3 % de chances de coup critique avec les sorts.',
    war_row_second_wind:
      'Lorsque vos points de vie sont inférieurs à 35 %, vous régénérez 1,5 % de vos points de vie par seconde.',
    war_row_anger_management:
      'Vos attaques automatiques génèrent 10 % de rage en plus et vos techniques 5 % de plus.',
    war_row_blood_offering:
      'Vos postures gagnent des effets supplémentaires. Posture de combat : les coups critiques de vos techniques infligent 15 % de dégâts supplémentaires. Posture berserker : vos attaques automatiques sont 5 % plus rapides. Posture de garde : un coup qui vous retirerait au moins 20 % de votre maximum de points de vie inflige 15 % de dégâts en moins.',
    war_row_battle_rhythm: 'Chaque troisième technique utilisée génère 20 % de rage en plus.',
    war_row_colossal_might:
      "Chaque point de rage dépensé réduit de 0,1 s le temps de recharge de vos grandes capacités offensives, jusqu'à 10 s toutes les 30 s.",
  },
  it_IT: {
    mag_r5_blink_cast: 'Puoi usare Passo Baleno nel mezzo di un incantesimo senza interromperlo.',
    mag_r8_temporal_rift:
      'Ogni 20 secondi, il prossimo stordimento, immobilizzazione o silenzio che ti colpisce viene rimosso istantaneamente.',
    mag_r17_convergence:
      "Alternare un incantesimo di Fuoco e uno di Gelo apre un'ondata di potere di 8 secondi, una volta ogni 30 secondi.",
    mag_r20_overflowing_power:
      'Spendere mana riduce il tempo di recupero delle tue difensive: 2 secondi per ogni decimo del tuo mana massimo speso, fino a 10 secondi ogni 30 secondi.',
    dru_r20_improved_hurricane:
      'In Forma di gufo lunare, tu e i membri del tuo gruppo entro 30 m guadagnate il 3% di probabilità di critico con gli incantesimi.',
    war_row_second_wind: 'Sotto il 35% di salute, rigeneri l’1,5% della tua salute ogni secondo.',
    war_row_anger_management:
      'I tuoi attacchi automatici generano il 10% di rabbia in più e le tue abilità il 5% in più.',
    war_row_blood_offering:
      'Le tue posizioni ottengono effetti aggiuntivi. Posizione di Battaglia: i colpi critici delle tue abilità infliggono il 15% di danni in più. Posizione del Berserker: i tuoi attacchi automatici sono più rapidi del 5%. Posizione Guardinga: un colpo che ti sottrarrebbe almeno il 20% della salute massima infligge il 15% di danni in meno.',
    war_row_battle_rhythm: 'Ogni terza abilità usata genera il 20% di rabbia in più.',
    war_row_colossal_might:
      'Ogni punto di rabbia speso riduce di 0,1 secondi il tempo di recupero delle tue grandi abilità offensive, fino a 10 secondi ogni 30 secondi.',
  },
  de_DE: {
    mag_r5_blink_cast:
      'Du kannst Flimmerschritt mitten in einem Zaubervorgang einsetzen, ohne ihn zu unterbrechen.',
    mag_r8_temporal_rift:
      'Alle 20 Sek. wird die nächste Betäubung, Verwurzelung oder Stille, die dich trifft, sofort aufgehoben.',
    mag_r17_convergence:
      'Wenn du abwechselnd einen Feuer- und einen Frost-Zauber wirkst, entfachst du einmal alle 30 Sek. einen 8 Sek. anhaltenden Machtschub.',
    mag_r20_overflowing_power:
      'Manaverbrauch verkürzt die Abklingzeit deiner Defensivfähigkeiten: 2 Sek. pro einem Zehntel deines verbrauchten maximalen Manas, maximal 10 Sek. alle 30 Sek.',
    dru_r20_improved_hurricane:
      'Solange du dich in Moonkingestalt befindest, erhalten du und deine Gruppenmitglieder innerhalb von 30 m eine um 3 % erhöhte kritische Zaubertrefferchance.',
    war_row_second_wind:
      'Unter 35 % Gesundheit regenerierst du pro Sekunde 1,5 % deiner Gesundheit.',
    war_row_anger_management:
      'Deine automatischen Angriffe erzeugen 10 % mehr Wut und deine Fähigkeiten 5 % mehr.',
    war_row_blood_offering:
      'Deine Haltungen erhalten zusätzliche Effekte. Kampfhaltung: Kritische Treffer deiner Fähigkeiten verursachen 15 % mehr Schaden. Berserkerhaltung: Deine automatischen Angriffe sind 5 % schneller. Wehrhafte Haltung: Ein Treffer, der dir mindestens 20 % deiner maximalen Gesundheit nehmen würde, verursacht 15 % weniger Schaden.',
    war_row_battle_rhythm: 'Jede dritte eingesetzte Fähigkeit erzeugt 20 % mehr Wut.',
    war_row_colossal_might:
      'Jeder verbrauchte Wutpunkt verkürzt die Abklingzeit deiner wichtigsten Angriffsfähigkeiten um 0,1 Sek., maximal 10 Sek. alle 30 Sek.',
  },
  pt_BR: {
    mag_r5_blink_cast: 'Você pode usar Passo Cintilante durante uma conjuração sem interrompê-la.',
    mag_r8_temporal_rift:
      'A cada 20 s, o próximo atordoamento, imobilização ou silêncio que atingir você é removido instantaneamente.',
    mag_r17_convergence:
      'Alternar entre uma magia de Fogo e uma de Gelo abre uma rajada de poder de 8 s, uma vez a cada 30 s.',
    mag_r20_overflowing_power:
      'Gastar mana reduz a recarga das suas defensivas: 2 s por décimo do seu mana máximo gasto, até 10 s a cada 30 s.',
    dru_r20_improved_hurricane:
      'Na Forma Moonkin, você e os membros do seu grupo num raio de 30 m ganham 3% de chance de acerto crítico com magias.',
    war_row_second_wind: 'Abaixo de 35% de vida, você regenera 1,5% da sua vida por segundo.',
    war_row_anger_management:
      'Seus ataques automáticos geram 10% mais raiva e suas habilidades geram 5% mais.',
    war_row_blood_offering:
      'Suas posturas recebem efeitos adicionais. Postura de Batalha: acertos críticos das suas habilidades causam 15% a mais de dano. Postura de Berserker: seus ataques automáticos ficam 5% mais rápidos. Postura de Guarda: um golpe que tiraria pelo menos 20% da sua vida máxima causa 15% a menos de dano.',
    war_row_battle_rhythm: 'Cada terceira habilidade usada gera 20% mais raiva.',
    war_row_colossal_might:
      'Cada ponto de raiva gasto reduz em 0,1 s a recarga das suas principais habilidades ofensivas, até 10 s a cada 30 s.',
  },
  ru_RU: {
    mag_r5_blink_cast:
      'Вы можете использовать Мерцающий шаг в процессе применения заклинания, не прерывая его.',
    mag_r8_temporal_rift:
      'Каждые 20 сек. следующее оглушение, обездвиживание или немота, которые поразят вас, немедленно снимаются.',
    mag_r17_convergence:
      'Чередование заклинания Огня и заклинания Льда открывает 8-секундный прилив силы, не чаще одного раза в 30 сек.',
    mag_r20_overflowing_power:
      'Расход маны сокращает время восстановления ваших защитных умений: 2 сек. за каждую десятую часть максимального запаса маны, не более 10 сек. каждые 30 сек.',
    dru_r20_improved_hurricane:
      'В Облике лунного совуха вы и члены вашей группы в радиусе 30 ярдов получают +3% к шансу критического удара заклинаниями.',
    war_row_second_wind:
      'При уровне здоровья ниже 35% вы восстанавливаете 1,5% здоровья в секунду.',
    war_row_anger_management:
      'Ваши автоматические атаки генерируют на 10% больше ярости, а способности на 5% больше.',
    war_row_blood_offering:
      'Ваши стойки получают дополнительные эффекты. Боевая стойка: критические удары способностей наносят на 15% больше урона. Стойка берсерка: автоматические атаки совершаются на 5% быстрее. Стойка стража: удар, который отнял бы не менее 20% максимального здоровья, наносит на 15% меньше урона.',
    war_row_battle_rhythm:
      'Каждая третья использованная способность генерирует на 20% больше ярости.',
    war_row_colossal_might:
      'Каждая единица ярости, которую вы тратите, сокращает время восстановления ваших основных атакующих способностей на 0,1 сек., не более 10 сек. каждые 30 сек.',
  },
  cs_CZ: {
    mag_r5_blink_cast: 'Mihokrok můžeš použít uprostřed sesílání kouzla, aniž by bylo přerušeno.',
    mag_r8_temporal_rift:
      'Každých 20 s je nejbližší omráčení, ukotvení nebo umlčení, které tě zasáhne, okamžitě vyčištěno.',
    mag_r17_convergence:
      'Střídání ohnivého a mrazivého kouzla otevře 8 s trvající příval moci, nejvýše jednou za 30 s.',
    mag_r20_overflowing_power:
      'Vydávání many zkracuje cooldown tvých obranných schopností: 2 s za každou desetinu utracené maximální many, nejvýše 10 s každých 30 s.',
    dru_r20_improved_hurricane:
      'V Podobě měsíčního křídla ty a členové tvé skupiny do 30 yd získáváte o 3 % vyšší šanci na kritický zásah kouzlem.',
    war_row_second_wind: 'Pod 35 % zdraví si každou sekundu obnovujete 1,5 % zdraví.',
    war_row_anger_management:
      'Vaše automatické útoky generují o 10 % více zuřivosti a vaše schopnosti o 5 % více.',
    war_row_blood_offering:
      'Vaše postoje získávají další účinky. Bojový postoj: kritické zásahy schopností způsobují o 15 % vyšší poškození. Postoj berserka: automatické útoky jsou o 5 % rychlejší. Krytý postoj: zásah, který by vám odebral alespoň 20 % maximálního zdraví, způsobí o 15 % nižší poškození.',
    war_row_battle_rhythm: 'Každá třetí použitá schopnost generuje o 20 % více zuřivosti.',
    war_row_colossal_might:
      'Každý bod zuřivosti, který utratíš, zkracuje cooldown tvých hlavních útočných schopností o 0,1 s, nejvýše 10 s každých 30 s.',
  },
  nl_NL: {
    mag_r5_blink_cast:
      'Je kunt Flikkerstap gebruiken midden in een bezwering zonder die te onderbreken.',
    mag_r8_temporal_rift:
      'Elke 20 sec wordt de eerstvolgende verdoving, wortel of stilte die je treft onmiddellijk gereinigd.',
    mag_r17_convergence:
      'Een Vuur- en een Vorstbezwering afwisselen opent een krachtsopstoot van 8 sec, maximaal eens per 30 sec.',
    mag_r20_overflowing_power:
      'Mana besteden verkort de herlaaditijd van je verdedigingsvaardigheden: 2 sec per tiende van je maximale mana besteed, tot maximaal 10 sec elke 30 sec.',
    dru_r20_improved_hurricane:
      'Terwijl je in Moonkin-Gedaante bent, krijgen jij en je groepsleden binnen 30 m 3% kans op een kritieke spreuktreffer.',
    war_row_second_wind: 'Onder 35% gezondheid herstel je elke seconde 1,5% van je gezondheid.',
    war_row_anger_management:
      'Je automatische aanvallen genereren 10% meer woede en je vaardigheden 5% meer.',
    war_row_blood_offering:
      'Je houdingen krijgen extra effecten. Strijdhouding: kritieke treffers van je vaardigheden richten 15% meer schade aan. Berserkerhouding: je automatische aanvallen zijn 5% sneller. Bewaakte Houding: een treffer die minstens 20% van je maximale gezondheid zou kosten, richt 15% minder schade aan.',
    war_row_battle_rhythm: 'Elke derde gebruikte vaardigheid genereert 20% meer woede.',
    war_row_colossal_might:
      'Elk punt woede dat je uitgeeft verkort de herlaaditijd van je grote aanvalsvaardigheden met 0,1 sec, tot maximaal 10 sec elke 30 sec.',
  },
  pl_PL: {
    mag_r5_blink_cast:
      'Możesz użyć Migotliwego Kroku w trakcie rzucania czaru, nie przerywając go.',
    mag_r8_temporal_rift:
      'Co 20 sek. następne ogłuszenie, unieruchomienie lub uciszenie, które cię dosięgnie, zostaje natychmiast oczyszczone.',
    mag_r17_convergence:
      'Naprzemienne użycie czaru Ognia i czaru Mrozu otwiera 8-sekundowy przypływ mocy, co najwyżej raz na 30 sek.',
    mag_r20_overflowing_power:
      'Wydawanie many skraca czas odnowienia twoich defensyw: 2 sek. za każdą dziesiątą część maksymalnej many, maksymalnie 10 sek. co 30 sek.',
    dru_r20_improved_hurricane:
      'Będąc w Postaci sowoniedźwiedzia, ty i członkowie twojej grupy w promieniu 30 jardów zyskujecie 3% szansy na krytyczne trafienie czarem.',
    war_row_second_wind: 'Poniżej 35% zdrowia regenerujesz 1,5% zdrowia na sekundę.',
    war_row_anger_management:
      'Twoje automatyczne ataki generują o 10% więcej szału, a umiejętności o 5% więcej.',
    war_row_blood_offering:
      'Twoje postawy zyskują dodatkowe efekty. Postawa bojowa: trafienia krytyczne umiejętności zadają o 15% więcej obrażeń. Postawa berserkera: automatyczne ataki są o 5% szybsze. Czujna postawa: cios, który odebrałby co najmniej 20% maksymalnego zdrowia, zadaje o 15% mniej obrażeń.',
    war_row_battle_rhythm: 'Co trzecia użyta umiejętność generuje o 20% więcej szału.',
    war_row_colossal_might:
      'Każdy wydany punkt szału skraca czas odnowienia twoich głównych umiejętności ofensywnych o 0,1 sek., maksymalnie 10 sek. co 30 sek.',
  },
  id_ID: {
    mag_r5_blink_cast:
      'Kamu dapat menggunakan Langkah Kilat di tengah rapalan tanpa mengganggunya.',
    mag_r8_temporal_rift:
      'Setiap 20 dtk, efek stun, akar, atau bungkam berikutnya yang mengenaimu akan langsung dibersihkan.',
    mag_r17_convergence:
      'Bergantian menggunakan mantra Api dan Beku membuka lonjakan kekuatan selama 8 dtk, satu kali setiap 30 dtk.',
    mag_r20_overflowing_power:
      'Menghabiskan mana mempersingkat waktu pemulihan bertahanmu: 2 dtk per sepersepuluh mana maksimum yang dihabiskan, hingga 10 dtk setiap 30 dtk.',
    dru_r20_improved_hurricane:
      'Saat dalam Wujud Moonkin, kamu dan anggota partaimu dalam jarak 30 m mendapat peningkatan 3% peluang serangan kritikal mantra.',
    war_row_second_wind: 'Saat nyawamu di bawah 35%, kamu memulihkan 1,5% nyawa setiap detik.',
    war_row_anger_management:
      'Serangan otomatismu menghasilkan 10% lebih banyak amarah dan kemampuanmu 5% lebih banyak.',
    war_row_blood_offering:
      'Kuda-kudamu memperoleh efek tambahan. Kuda-kuda Tempur: serangan kritis kemampuanmu menghasilkan 15% lebih banyak kerusakan. Kuda-kuda Berserker: serangan otomatismu 5% lebih cepat. Kuda-kuda Waspada: serangan yang akan mengurangi setidaknya 20% nyawa maksimummu menghasilkan 15% lebih sedikit kerusakan.',
    war_row_battle_rhythm:
      'Setiap kemampuan ketiga yang kamu gunakan menghasilkan 20% lebih banyak amarah.',
    war_row_colossal_might:
      'Setiap poin amarah yang kamu habiskan mempersingkat waktu pemulihan kemampuan ofensif utamamu sebesar 0,1 dtk, hingga 10 dtk setiap 30 dtk.',
  },
  tr_TR: {
    mag_r5_blink_cast:
      "Titreşim Adımı'nı bir büyüyü kesmeden kanalizasyon ortasında kullanabilirsin.",
    mag_r8_temporal_rift:
      'Her 20 saniyede bir, sana çarpan ilk sersemletme, köklenme veya susturma anında temizlenir.',
    mag_r17_convergence:
      'Bir Ateş ve bir Buz büyüsünü art arda atmak, 30 saniyede bir olmak kaydıyla 8 saniyelik bir güç dalgası açar.',
    mag_r20_overflowing_power:
      'Mana harcamak savunma yeteneklerinin bekleme süresini kısaltır: harcanan azami manandan her onda biri için 2 saniye, 30 saniyede en fazla 10 saniye.',
    dru_r20_improved_hurricane:
      "Ay Kuşu Formu'ndayken sen ve 30 yarda yakınındaki grup üyeleri %3 büyü kritik vuruş şansı kazanır.",
    war_row_second_wind: 'Sağlığın %35’in altındayken her saniye sağlığının %1,5’ini yenilersin.',
    war_row_anger_management: 'Otomatik saldırıların %10, yeteneklerin %5 daha fazla öfke üretir.',
    war_row_blood_offering:
      'Duruşların ek etkiler kazanır. Savaş Duruşu: yeteneklerinin kritik vuruşları %15 daha fazla hasar verir. Berserker Duruşu: otomatik saldırıların %5 daha hızlıdır. Korumalı Duruş: azami sağlığının en az %20’sini götürecek bir darbe %15 daha az hasar verir.',
    war_row_battle_rhythm: 'Kullandığın her üçüncü yetenek %20 daha fazla öfke üretir.',
    war_row_colossal_might:
      'Harcadığın her öfke puanı, büyük saldırı yeteneklerinin bekleme süresini 0,1 saniye kısaltır; 30 saniyede en fazla 10 saniye.',
  },
  sv_SE: {
    mag_r5_blink_cast: 'Du kan använda Flimmersteg mitt i en besvärjelse utan att avbryta den.',
    mag_r8_temporal_rift:
      'Var 20:e sekund rensas nästa bedövning, rotning eller tystnad som träffar dig omedelbart.',
    mag_r17_convergence:
      'Att växelvis kasta en Eld- och en Frost-besvärjelse öppnar ett 8 sek långt kraftflöde, högst en gång var 30:e sek.',
    mag_r20_overflowing_power:
      'Manaförbrukning kortar ned dina defensivars nedkylningar: 2 sek per tiondel av ditt maximala manaförråd som förbrukas, högst 10 sek var 30:e sek.',
    dru_r20_improved_hurricane:
      'I Månfågelform får du och dina gruppmedlemmar inom 30 m 3 % chans till magisk kritisk träff.',
    war_row_second_wind: 'Under 35 % hälsa återställer du 1,5 % av din hälsa per sekund.',
    war_row_anger_management:
      'Dina automatiska attacker genererar 10 % mer raseri och dina förmågor 5 % mer.',
    war_row_blood_offering:
      'Dina ställningar får ytterligare effekter. Stridsställning: kritiska träffar med förmågor gör 15 % mer skada. Bärsärkaställning: dina automatiska attacker är 5 % snabbare. Gardställning: en träff som skulle ta minst 20 % av din maximala hälsa gör 15 % mindre skada.',
    war_row_battle_rhythm: 'Var tredje förmåga du använder genererar 20 % mer raseri.',
    war_row_colossal_might:
      'Varje raserienhet du förbrukar kortar ned nedkylningen på dina stora anfallsförmågor med 0,1 sek, högst 10 sek var 30:e sek.',
  },
  vi_VN: {
    mag_r5_blink_cast:
      'Bạn có thể dùng Bước Chớp giữa chừng một lượt niệm phép mà không làm gián đoạn nó.',
    mag_r8_temporal_rift:
      'Cứ 20 giây, hiệu ứng choáng, cố định hoặc câm lặng tiếp theo nhắm vào bạn sẽ bị tẩy sạch ngay lập tức.',
    mag_r17_convergence:
      'Xen kẽ một phép Lửa và một phép Băng Giá kích hoạt 8 giây bùng phát sức mạnh, mỗi 30 giây một lần.',
    mag_r20_overflowing_power:
      'Tiêu thụ mana rút ngắn thời gian hồi chiêu phòng thủ của bạn: 2 giây mỗi một phần mười mana tối đa đã dùng, tối đa 10 giây mỗi 30 giây.',
    dru_r20_improved_hurricane:
      'Khi ở Hình Nguyệt Cầm, bạn và các thành viên nhóm trong vòng 30 thước nhận thêm 3% cơ hội chí mạng phép thuật.',
    war_row_second_wind: 'Khi còn dưới 35% máu, bạn hồi 1,5% máu mỗi giây.',
    war_row_anger_management: 'Đòn đánh tự động tạo thêm 10% nộ và kỹ năng tạo thêm 5% nộ.',
    war_row_blood_offering:
      'Các thế của bạn nhận thêm hiệu ứng. Thế Công: đòn chí mạng từ kỹ năng gây thêm 15% sát thương. Thế Cuồng Chiến: đòn đánh tự động nhanh hơn 5%. Thế Thủ: một đòn đánh vốn lấy đi ít nhất 20% máu tối đa của bạn sẽ gây ít hơn 15% sát thương.',
    war_row_battle_rhythm: 'Mỗi kỹ năng thứ ba bạn sử dụng tạo thêm 20% nộ.',
    war_row_colossal_might:
      'Mỗi điểm nộ bạn tiêu tốn rút ngắn 0,1 giây thời gian hồi chiêu của các kỹ năng tấn công chủ lực, tối đa 10 giây mỗi 30 giây.',
  },
  da_DK: {
    mag_r5_blink_cast: 'Du kan bruge Flimmertrin midt i en besværgelse uden at afbryde den.',
    mag_r8_temporal_rift:
      'Hvert 20. sek. renses den næste bedøvelse, rodfæstelse eller tavshed der rammer dig, øjeblikkeligt.',
    mag_r17_convergence:
      'At veksle mellem en Ild- og en Frosttroldom åbner et kraftudbrud på 8 sek., maks. én gang pr. 30 sek.',
    mag_r20_overflowing_power:
      'Manaforbrug reducerer afkølingen på dine defensive evner: 2 sek. pr. tiendedel af dit maksimale mana brugt, op til 10 sek. hvert 30. sek.',
    dru_r20_improved_hurricane:
      'Mens du er i Måneugleform, får du og dine gruppemedlemmer inden for 30 m 3% chance for kritisk træffer med besværgelser.',
    war_row_second_wind: 'Under 35 % helbred genvinder du 1,5 % af dit helbred hvert sekund.',
    war_row_anger_management:
      'Dine autoangreb genererer 10 % mere raseri, og dine evner genererer 5 % mere.',
    war_row_blood_offering:
      'Dine stillinger får yderligere effekter. Kampstilling: kritiske træffere med evner giver 15 % mere skade. Berserkerstilling: dine autoangreb er 5 % hurtigere. Værgende Stilling: et træf, der ville tage mindst 20 % af dit maksimale helbred, giver 15 % mindre skade.',
    war_row_battle_rhythm: 'Hver tredje evne, du bruger, genererer 20 % mere raseri.',
    war_row_colossal_might:
      'Hvert raserispunkt du bruger, reducerer afkølingen på dine store angrebsevner med 0,1 sek., op til 10 sek. hvert 30. sek.',
  },
  zh_CN: {
    mag_r5_blink_cast: '你可以在施法过程中使用闪烁步，而不会打断当前施法。',
    mag_r8_temporal_rift: '每隔 20 秒，下一个命中你的昏迷、定身或沉默效果将被立即驱散。',
    mag_r17_convergence:
      '交替施放一个火焰法术和一个冰霜法术，将触发 8 秒的力量爆发，每 30 秒最多触发一次。',
    mag_r20_overflowing_power:
      '消耗法力可缩短防御性技能的冷却时间：每消耗最大法力值的 1/10 减少 2 秒冷却，每 30 秒最多减少 10 秒。',
    dru_r20_improved_hurricane: '处于枭兽形态时，你与 30 码内的队伍成员的法术暴击几率提高 3%。',
    war_row_second_wind: '生命值低于35%时，你每秒恢复1.5%的生命值。',
    war_row_anger_management: '你的自动攻击产生的怒气提高10%，技能产生的怒气提高5%。',
    war_row_blood_offering:
      '你的姿态获得额外效果。战斗姿态：你的技能暴击造成的伤害提高15%。狂暴姿态：你的自动攻击加快5%。戒备姿态：若一次命中会使你损失至少20%的最大生命值，则该次伤害降低15%。',
    war_row_battle_rhythm: '你每使用第三个技能时，该技能产生的怒气提高20%。',
    war_row_colossal_might:
      '你每消耗1点怒气，主要进攻技能的冷却时间缩短0.1秒，每30秒最多减少10秒。',
  },
  zh_TW: {
    mag_r5_blink_cast: '你可以在施法過程中使用閃爍步，而不會打斷詠唱。',
    mag_r8_temporal_rift: '每隔20秒，下一個命中你的昏迷、定身或沉默效果將被立即淨化。',
    mag_r17_convergence:
      '交替施放火焰系與冰霜系法術，可觸發持續8秒的力量湧現，每30秒最多觸發一次。',
    mag_r20_overflowing_power:
      '消耗法力可縮短你的防禦技能冷卻時間：每消耗最大法力值的十分之一縮短2秒，每30秒最多縮短10秒。',
    dru_r20_improved_hurricane:
      '處於梟獸形態時，你與30碼內的隊伍成員獲得3%的法術致命一擊機率加成。',
    war_row_second_wind: '生命值低於35%時，你每秒恢復1.5%的生命值。',
    war_row_anger_management: '你的自動攻擊產生的怒氣提高10%，技能產生的怒氣提高5%。',
    war_row_blood_offering:
      '你的姿態獲得額外效果。戰鬥姿態：你的技能致命一擊造成的傷害提高15%。狂暴姿態：你的自動攻擊加快5%。戒備姿態：若一次命中會使你損失至少20%的最大生命值，則該次傷害降低15%。',
    war_row_battle_rhythm: '你每使用第三個技能時，該技能產生的怒氣提高20%。',
    war_row_colossal_might:
      '你每消耗1點怒氣，主要進攻技能的冷卻時間縮短0.1秒，每30秒最多縮短10秒。',
  },
  ja_JP: {
    mag_r5_blink_cast: '詠唱の途中でも、それを中断せずに瞬き歩みを使用できます。',
    mag_r8_temporal_rift: '20秒ごとに、次にあなたに当たるスタン、拘束、沈黙を即座に浄化します。',
    mag_r17_convergence:
      '炎と氷の呪文を交互に使用すると、30秒ごとに最大1回、8秒間の魔力の奔流が開きます。',
    mag_r20_overflowing_power:
      'マナを消費すると防御アビリティのクールダウンが短縮されます：最大マナの10分の1を消費するごとに2秒短縮、30秒ごとに最大10秒まで。',
    dru_r20_improved_hurricane:
      'ムーンキン・フォームの間、あなたと30yd以内のパーティメンバーは呪文クリティカル率が3%増加します。',
    war_row_second_wind: '体力が35%未満の間、毎秒、体力を1.5%回復します。',
    war_row_anger_management: '自動攻撃の怒気生成量が10%、アビリティの怒気生成量が5%増加します。',
    war_row_blood_offering:
      '各スタンスに追加効果を与えます。バトルスタンス：アビリティのクリティカルダメージが15%増加します。バーサーカースタンス：自動攻撃が5%速くなります。ガーデッドスタンス：最大体力の20%以上を失う攻撃のダメージが15%減少します。',
    war_row_battle_rhythm: '3回目に使用するアビリティは、怒気生成量が20%増加します。',
    war_row_colossal_might:
      '消費した怒気1ポイントごとに、主要な攻撃アビリティのクールダウンが0.1秒短縮されます。30秒ごとに最大10秒まで。',
  },
  ko_KR: {
    mag_r5_blink_cast: '시전 도중에도 섬광걸음을 사용할 수 있으며, 시전이 끊기지 않습니다.',
    mag_r8_temporal_rift: '20초마다, 다음으로 적중하는 기절, 속박, 침묵 효과를 즉시 해제합니다.',
    mag_r17_convergence:
      '화염 주문과 냉기 주문을 번갈아 사용하면 8초간 마력이 분출됩니다. 30초마다 한 번 발동합니다.',
    mag_r20_overflowing_power:
      '마나를 소비하면 방어 기술의 재사용 대기시간이 단축됩니다. 최대 마나의 10분의 1을 소비할 때마다 2초씩, 30초마다 최대 10초까지 줄어듭니다.',
    dru_r20_improved_hurricane:
      '달빛야수 변신 상태에서 30미터 이내의 파티원과 함께 주문 치명타율이 3% 증가합니다.',
    war_row_second_wind: '생명력이 35% 미만이면 매초 생명력의 1.5%를 회복합니다.',
    war_row_anger_management: '자동 공격의 분노 생성량이 10%, 능력의 분노 생성량이 5% 증가합니다.',
    war_row_blood_offering:
      '각 태세에 추가 효과가 부여됩니다. 전투 태세: 능력의 치명타 피해가 15% 증가합니다. 광전사 태세: 자동 공격이 5% 빨라집니다. 방어 태세: 최대 생명력의 20% 이상을 잃게 할 공격의 피해가 15% 감소합니다.',
    war_row_battle_rhythm: '세 번째로 사용하는 능력은 분노 생성량이 20% 증가합니다.',
    war_row_colossal_might:
      '소비한 분노 1포인트마다 주요 공격 기술의 재사용 대기시간이 0.1초 단축됩니다. 30초마다 최대 10초까지 줄어듭니다.',
  },
};
