// Deed name / desc / title locale table for tr_TR (data-as-code, size-exempt).
// One per-base-locale chunk behind DEED_LOCALE_LOADERS in deed_i18n.ts, so a
// visitor downloads only their own locale's deed strings. Split verbatim from
// the former deed_i18n.newlocales.ts single chunk; values carry no em or en
// dashes (repo copy rule). English (en / en_CA) resolves to the authored
// source before this table is consulted.
import type { DeedLocaleTable } from '../deed_i18n';

export const table: DeedLocaleTable = {
  prog_first_steps: {
    name: 'İlk Adımlar',
    desc: '2. seviyeye ulaş ve uzun bir yolun ilk adımını at.',
  },
  prog_finding_your_feet: {
    name: 'Ayaklar Alışıyor',
    desc: '5. seviyeye ulaş; yaban şimdiden biraz daha küçük görünüyor.',
  },
  prog_double_digits: {
    name: 'Çift Haneler',
    desc: '10. seviyeye ulaş ve yeteneklerinin kilidini aç.',
  },
  prog_the_long_middle: { name: 'Yolun Uzun Ortası', desc: '15. seviyeye ulaş.' },
  prog_level_cap: { name: 'Zirveden Manzara', desc: 'Seviye tavanı olan 20. seviyeye ulaş.' },
  prog_well_rested: {
    name: 'Dinlenmiş ve Dinç',
    desc: 'Dinlenmiş tecrübe kazanana kadar bir hana yerleş.',
  },
  prog_talented: { name: 'Yerini Bulan Puan', desc: 'İlk yetenek puanını harca.' },
  prog_specialized: {
    name: 'Niyet Beyanı',
    desc: 'Bir uzmanlık seç ve onun imza yeteneğini öğren.',
  },
  prog_deep_roots: { name: 'Derin Kökler', desc: 'Son sıradaki bir yeteneğe yetenek puanı harca.' },
  prog_full_build: {
    name: 'On Birin Tamamı',
    desc: 'On bir yetenek puanının tamamını tek bir dizilişe harca.',
  },
  prog_veteran: {
    name: 'Kıdemli',
    desc: 'Ömür boyu toplam 250.000 tecrübe puanı kazan.',
    title: 'Kıdemli',
  },
  prog_champion: {
    name: 'Şampiyon',
    desc: 'Ömür boyu toplam 500.000 tecrübe puanı kazan.',
    title: 'Şampiyon',
  },
  prog_paragon: {
    name: 'Erdem Timsali',
    desc: 'Ömür boyu toplam 1.000.000 tecrübe puanı kazan.',
    title: 'Erdem Timsali',
  },
  prog_mythic: {
    name: 'Efsanevi',
    desc: 'Ömür boyu toplam 2.500.000 tecrübe puanı kazan.',
    title: 'Efsanevi',
  },
  prog_eternal: {
    name: 'Ebedi',
    desc: 'Ömür boyu toplam 5.000.000 tecrübe puanı kazan.',
    title: 'Ebedi',
  },
  prog_prestige: {
    name: 'Baştan Al',
    desc: 'Seviye tavanına ulaş, çubuğu bir kez daha doldur ve 1. prestij rütbesini al.',
  },
  prog_prestige_5: { name: 'Eski Alışkanlıklar', desc: '5. prestij rütbesine ulaş.' },
  prog_prestige_10: { name: 'Devridaim', desc: '10. prestij rütbesine ulaş.' },
  prog_first_harvest: { name: 'Tarlanın Meyveleri', desc: 'İlk toplama kaynağını hasat et.' },
  prog_mining_100: { name: 'Kanında Cevher Var', desc: 'Madencilikte 100 yetkinliğe ulaş.' },
  prog_logging_100: { name: 'Öz Odun Baltacısı', desc: 'Odunculukta 100 yetkinliğe ulaş.' },
  prog_herbalism_100: {
    name: 'Çayırların Efendisi',
    desc: 'Şifalı Otçulukta 100 yetkinliğe ulaş.',
  },
  prog_master_gatherer: {
    name: 'Usta Toplayıcı',
    desc: 'Madencilik, Odunculuk ve Şifalı Otçulukta 100 yetkinliğe ulaş.',
  },
  prog_first_craft: { name: 'El Emeği Göz Nuru', desc: 'İlk başarılı üretimini tamamla.' },
  prog_craft_specialist: {
    name: 'Meslek Sırları',
    desc: 'Herhangi bir zanaatta 75 beceriye ulaş ve uzmanlık avantajlarının kilidini aç.',
  },
  prog_around_the_ring: { name: 'Halkayı Dolaşmak', desc: 'Beş farklı zanaatta 25 beceriye ulaş.' },
  cmb_first_blood: { name: 'İlk Kan', desc: 'İlk düşmanını alt et.' },
  cmb_slayer: { name: 'Kıyıcı', desc: '1.000 düşman alt et.' },
  cmb_legion_of_one: { name: 'Tek Kişilik Ordu', desc: '10.000 düşman alt et.' },
  cmb_heavy_hitter: { name: 'Eli Ağır', desc: 'Toplam 500.000 hasar ver.' },
  cmb_critical_eye: { name: 'Kritik Göz', desc: '500 kritik vuruş isabet ettir.' },
  cmb_giantslayer: {
    name: 'Devkıran',
    desc: 'Senden en az beş seviye yüksek bir düşmana son darbeyi indir.',
  },
  cmb_first_fall: {
    name: 'Silkelen ve Kalk',
    desc: 'İlk kez öl; en iyilerimizin bile başına gelir.',
  },
  dgn_hollow_crypt: { name: 'Mezarkıran', desc: "Oyuk Mezar'da Mezarçağıran Morthen'i alt et." },
  dgn_sunken_bastion: {
    name: 'Sisin Bağı Çözüldü',
    desc: "Batık Kale'de Fogbinder Vael'i alt et.",
  },
  dgn_drowned_temple: {
    name: "Ay'ı Boğmak",
    desc: "Boğulmuş Tapınak'ta Ysolei, Boğulmuş Ay'ın Avatarı'nı alt et.",
  },
  dgn_gravewyrm_sanctum: {
    name: 'Aşağıdaki Ejder',
    desc: "Mezarejderi Mabedi'nde Mezarejderi Korzul'u alt et.",
  },
  dgn_hollow_crypt_heroic: {
    name: 'Kahramanca: Oyuk Mezar',
    desc: "Oyuk Mezar'da Mezarçağıran Morthen'i Kahramanca zorlukta alt et.",
  },
  dgn_sunken_bastion_heroic: {
    name: 'Kahramanca: Batık Kale',
    desc: "Batık Kale'de Fogbinder Vael'i Kahramanca zorlukta alt et.",
  },
  dgn_drowned_temple_heroic: {
    name: 'Kahramanca: Boğulmuş Tapınak',
    desc: "Boğulmuş Tapınak'ta Ysolei, Boğulmuş Ay'ın Avatarı'nı Kahramanca zorlukta alt et.",
  },
  dgn_gravewyrm_sanctum_heroic: {
    name: 'Kahramanca: Mezarejderi Mabedi',
    desc: "Mezarejderi Mabedi'nde Mezarejderi Korzul'u Kahramanca zorlukta alt et.",
  },
  dgn_nythraxis: {
    name: 'Artık Bela Yok',
    desc: "Mühürlü kraliyet kapısının ardında Nythraxis, Dikenzirve Belası'nı alt et.",
  },
  dgn_nythraxis_heroic: {
    name: 'Kahramanca: Artık Bela Yok',
    desc: "Nythraxis, Dikenzirve Belası'nı Kahramanca zorlukta alt et.",
  },
  dgn_thornpeak_rounds: {
    name: 'Devriye Turu',
    desc: "Oyuk Mezar'ı, Batık Kale'yi, Boğulmuş Tapınak'ı ve Mezarejderi Mabedi'ni temizle.",
  },
  dgn_deepward: {
    name: 'Derinlerin Bekçisi',
    desc: 'Tüm zindanları, akını ve her iki mağara seferini Kahramanca zorlukta fethet.',
  },
  dgn_mark_circuit: {
    name: 'Tam Tur',
    desc: 'Dört Kahramanca zindanın hepsinden tek bir günde Kahramanca Nişan kazan.',
  },
  dgn_boss_clears_50: { name: 'Ellinci Kapı', desc: "50 zindan sonu boss'unu alt et." },
  dgn_morthen_flawless: {
    name: 'Kemiğimiz Bile Kırılmadı',
    desc: "Hiçbir grup üyesi ölmeden Mezarçağıran Morthen'i Kahramanca zorlukta alt et.",
  },
  dgn_morthen_trio: {
    name: 'Mezara Karşı Üç Kişi',
    desc: "Mezarçağıran Morthen'i en fazla üç oyuncuyla alt et.",
  },
  dgn_olen_arc: {
    name: "Azrail'e Çalım",
    desc: "Şövalye-Komutan Olen'i, Biçen Yay'ı mevcut hedefinden başka kimseye isabet etmeden alt et.",
  },
  dgn_vael_thralls: {
    name: 'Bana Köle Sökmez',
    desc: "Fogbinder Vael'i, çağırdığı her Boğulmuş Köle çoktan öldürülmüşken alt et.",
  },
  dgn_ysolei_moonspawn: {
    name: 'Son Ay Dölüne Dek',
    desc: "Ysolei'yi, çağırdığı her Ay Dölü çoktan öldürülmüşken alt et.",
  },
  dgn_ysolei_flawless: {
    name: 'Gözler Kupkuru',
    desc: "Hiçbir grup üyesi ölmeden Ysolei, Boğulmuş Ay'ın Avatarı'nı Kahramanca zorlukta alt et.",
  },
  dgn_velkhar_bonewalkers: {
    name: 'Gömülü Kalın',
    desc: "Yüce Nekromcu Velkhar'ı, o düşmeden önce her Diriltilmiş Kemikyürüyen yok edilmişken alt et.",
  },
  dgn_korzul_flawless: {
    name: 'Ejderdeviren',
    desc: "Hiçbir grup üyesi ölmeden Mezarejderi Korzul'u Kahramanca zorlukta alt et.",
    title: 'Ejderdeviren',
  },
  dgn_sanctum_speed: {
    name: 'Mabet Koşusu',
    desc: "Grubunun Mezarejderi Mabedi'ni almasından itibaren 15 dakika içinde Mezarejderi Korzul'u alt et.",
  },
  dgn_nythraxis_gravebreaker: {
    name: 'Hiçbir Krala Diz Çökme',
    desc: "Nythraxis'i, Kabirkıran mevcut hedefinden başka kimseye asla isabet etmeden alt et.",
  },
  dgn_nythraxis_wardens: {
    name: 'Koruma Taşlarının Bekçileri',
    desc: "Nythraxis'i, her Ölümsüz Öfke daha inmeden kırılmışken alt et.",
  },
  dgn_nythraxis_deathless: {
    name: 'Daha Ölümsüzü Yok',
    desc: "Tek bir akıncı bile ölmeden Nythraxis, Dikenzirve Belası'nı Kahramanca zorlukta alt et.",
    title: 'Ölümsüz',
  },
  cmb_thunzharr: {
    name: 'Dağ Devrildi',
    desc: "Fırtınakaya'da Thunzharr, Uyanan Zirve'yi yere ser.",
  },
  cmb_thunzharr_unbroken: {
    name: 'Zirvekıran',
    desc: "İlk darbenden onun son nefesine dek hiç ölmeden Thunzharr, Uyanan Zirve'yi yere ser.",
    title: 'Zirvekıran',
  },
  cmb_thunzharr_ten: {
    name: 'Dağ Devirme Alışkanlığı',
    desc: "Thunzharr, Uyanan Zirve'yi on kez yere ser.",
  },
  dlv_reliquary: { name: 'Emanetlik Akıncısı', desc: "Çökmüş Emanetlik'i temizle." },
  dlv_reliquary_heroic: {
    name: 'Kahramanca: Çökmüş Emanetlik',
    desc: "Çökmüş Emanetlik'i Kahramanca kademesinde temizle.",
  },
  dlv_litany: { name: 'Litanyayı Sustur', desc: "Boğulmuş Litanya'yı temizle." },
  dlv_litany_heroic: {
    name: 'Kahramanca: Boğulmuş Litanya',
    desc: "Boğulmuş Litanya'yı Kahramanca kademesinde temizle.",
  },
  dlv_lore_journal: {
    name: 'Derkenar',
    desc: 'Mağara seferi günlüğündeki beş kaydın tümünün kilidini aç.',
  },
  dlv_companion_max: {
    name: 'Derinlerde Bir Dost',
    desc: 'Bir mağara seferi yoldaşını en yüksek rütbesine çıkar.',
  },
  dlv_companions_both: {
    name: 'İki Fener de Yanıyor',
    desc: "Her iki mağara seferi yoldaşını da, Çömez Tessa ile Edda Reedhand'i, en yüksek rütbelerine çıkar.",
  },
  dlv_clears_50: { name: 'Elli Kulaç', desc: '50 mağara seferi tamamla.' },
  dlv_solo_heroic: {
    name: 'İki Kişilik Kalabalık',
    desc: 'Kahramanca kademesindeki bir mağara seferini başka hiçbir oyuncu olmadan, yalnızca sen ve yoldaşınla temizle.',
  },
  dlv_tumbler_premium: {
    name: 'Çilingirin Yolu, Ustalıkla',
    desc: 'Korumalı bir emanetlik sandığını en yüksek bahiste, tek denemende hiç hata yapmadan aç.',
  },
  dlv_rite_flawless: {
    name: 'Harfi Harfine',
    desc: "Boğulmuş Emanetlik Ayini'ni tek bir hata bile yapmadan tamamla.",
  },
  dlv_varric_ringers: {
    name: 'Çanlar Susar',
    desc: "Diyakoz Varric'i, dirilttiği her Cenaze Çancısı çoktan öldürülmüşken yen.",
  },
  dlv_nhalia_bells: {
    name: 'Çan Susturan',
    desc: "Boğulmuş İlahi Rahibe Nhalia'yı, hiçbir grup üyesine Çalan Çan çarpmadan yen.",
    title: 'Çan Susturan',
  },
  chr_vale_chapter_i: {
    name: 'Vadi Vakayinamesi, I. Bölüm',
    desc: "Saul'un vakayinamesinin ilk bölümünü bitir: Doğudere'nin ilk ayak işlerini gör, Vadi'nin yolunu yordamını öğren ve zanaatlarının ilk tadına bak.",
  },
  chr_vale_chapter_ii: {
    name: 'Vadi Vakayinamesi, II. Bölüm',
    desc: "Saul'un vakayinamesinin ikinci bölümünü bitir: haydutları, murlocları ve maden haşaratını hakla, Domuz Tarlası'nda sahaya çık ve Emanetlik'e göğüs ger.",
  },
  chr_vale_chapter_iii: {
    name: "Vadi'nin Vakayinamesi",
    desc: "Vadi'nin hikâyesini sonuna dek götür: Mezarçağıran'ın maskesini düşür, Oyuk Mezar'ı arındır ve Vadi'nin adı bilinen her dehşetini yere ser.",
    title: 'Vadili',
  },
  chr_vale_gatherer: {
    name: 'Toprağın Bereketi',
    desc: "Doğudere Vadisi'nde bir cevher damarı, bir kesimlik ağaç ve bir şifalı ot öbeği topla.",
  },
  chr_vale_first_cast: {
    name: "Ayna Gölü'nde Bir Şey Var",
    desc: "Doğudere Vadisi'nin sularından bir balık tut.",
  },
  chr_vale_packbreaker: { name: 'Sürü Kıran', desc: '10 saniye içinde 3 Orman Kurdu öldür.' },
  chr_vale_cup_debut: {
    name: 'Bakır Kova Adayı',
    desc: "Domuz Tarlası'ndaki bir Vadi Kupası maçında sahaya çık ve topa dokun.",
  },
  chr_vale_rares: {
    name: "Vadi'nin Dehşetleri",
    desc: "Doğudere Vadisi'nin adı bilinen beş dehşetini öldür: İhtiyar Greyjaw, Mogger, Tünelkral Grix, Kaptan Verlan ve Hayaletbağlayan Maldrec.",
  },
  chr_marsh_chapter_i: {
    name: 'Bataklık Vakayinamesi, I. Bölüm',
    desc: "Osric Fenn'in vakayinamesinin ilk bölümünü bitir: Bataklık Köprüsü'nün seferberlik çağrısına koş, geçit yolunu güvene al ve bataklığın yolunu yordamını öğren.",
  },
  chr_marsh_chapter_ii: {
    name: 'Bataklık Vakayinamesi, II. Bölüm',
    desc: "Osric Fenn'in vakayinamesinin ikinci bölümünü bitir: dulları yuvalarından yakıp çıkar, boğulmuşları huzura erdir, Morina Baba'yı kıyıya çıkar ve Litanya'ya göğüs ger.",
  },
  chr_marsh_chapter_iii: {
    name: "Mirefen'in Vakayinamesi",
    desc: "Bataklığın hikâyesini sonuna dek götür: tarikat kampını dağıt, Fogbinder'ı Batık Kale'de sustur ve sisin adı bilinen her dehşetini yere ser.",
    title: 'Mirefenli',
  },
  chr_marsh_gatherer: {
    name: 'Bataklık Köprüsü Hasadı',
    desc: "Mirefen Bataklığı'nda bir cevher damarı, bir kesimlik ağaç ve bir şifalı ot öbeği topla.",
  },
  chr_marsh_unburst: {
    name: 'Sporların İçinde Durma',
    desc: 'Yakıcı Sporlar patlamasına yakalanmadan 8 Bataklık Şişkini öldür.',
  },
  chr_marsh_hush_the_mending: {
    name: 'Şifayı Sustur',
    desc: "Mezar Çağıran Kampı'nda, bir Mezarçağıran Şifacısı'nı baktığı tarikatçıların herhangi birinden önce öldür.",
  },
  chr_marsh_rares: {
    name: 'Sisin Namlıları',
    desc: "Mirefen Bataklığı'nın adı bilinen üç dehşetini öldür: Doymak Bilmez Mirejaw, Boğulmuş Sloomtooth ve Rahibe Nhalia.",
  },
  chr_peaks_chapter_i: {
    name: 'Tepeler Vakayinamesi, I. Bölüm',
    desc: "Zenzie'nin vakayinamesinin ilk bölümünü bitir: sırt yolunu temizle, oyukları boşalt ve Yüksek Gözcü'nün koruduğu her patikayı öğren.",
  },
  chr_peaks_chapter_ii: {
    name: 'Tepeler Vakayinamesi, II. Bölüm',
    desc: "Zenzie'nin vakayinamesinin ikinci bölümünü bitir: Drogmar'ın Savaş Kampı'nı dağıt, uyanan fırtınayı oku ve Işıltıgöl'ün parıldadığı yerde dur.",
  },
  chr_peaks_chapter_iii: {
    name: "Dikenzirve'nin Vakayinamesi",
    desc: "Dağın hikâyesini sonuna dek götür: Ejder Tarikatı'nı çökert, Mabet'i sustur, Uyanan Zirve'yi devir ve kayalıkların adı bilinen her dehşetini yere ser.",
    title: 'Dikenzirveli',
  },
  chr_peaks_sparring: {
    name: 'Sur Talimi',
    desc: "Yüksek Gözcü'nün üstündeki antrenman kuklasına toplam 1.000 hasar ver.",
  },
  chr_peaks_glimmer_cast: {
    name: 'Soğuk Su, Daha Soğuk Işık',
    desc: "Işıltıgöl'den bir balık tut.",
  },
  chr_peaks_moongate: { name: 'Soğuk Geçitten', desc: 'Işıltıgöl kıyısındaki ay geçidinden geç.' },
  chr_peaks_waking_witness: {
    name: 'Yürüyen Dağ',
    desc: "Thunzharr, Uyanan Zirve'yi dağı arşınlarken kendi gözlerinle gör.",
  },
  chr_peaks_rares: {
    name: 'Kayaya Kazınan Adlar',
    desc: "Dikenzirve Tepeleri'nin adı bilinen dört dehşetini öldür: Demirdamar Ustabaşı, Brutok Kafataşıezen, Korkanat Voskar ve İlikbeyi Varkas.",
  },
  col_discovery_25: {
    name: 'İstifçi',
    desc: '25 farklı eşya keşfet (bir eşya, eline ilk geçtiği anda sayılır).',
  },
  col_discovery_75: { name: 'Saksağan', desc: '75 farklı eşya keşfet.' },
  col_discovery_150: { name: 'Nadire Kabinesi', desc: '150 farklı eşya keşfet.', title: 'Küratör' },
  col_discovery_250: { name: 'Büyük Katalog', desc: '250 farklı eşya keşfet.' },
  col_first_rare: { name: 'Mavi Boncuk', desc: 'Nadir kalitede ilk eşyanı edin.' },
  col_first_epic: { name: 'Mor Doğan', desc: 'Destansı kalitede ilk eşyanı edin.' },
  col_first_legendary: {
    name: 'Turnayı Turuncusundan',
    desc: 'Efsanevi kalitede ilk eşyanı edin.',
  },
  col_set_vale_arcanist: {
    name: 'Vadi Ezoteristinin Kisvesi',
    desc: "Vadi Ezoteristinin Kisvesi'nin her parçasını keşfet.",
  },
  col_set_boundstone_vanguard: {
    name: 'Bağlıtaş Öncüsü',
    desc: "Bağlıtaş Öncüsü'nün her parçasını keşfet.",
  },
  col_set_greyjaw_stalker: {
    name: 'Greyjaw Avcısı Takımı',
    desc: "Greyjaw Avcısı Takımı'nın her parçasını keşfet.",
  },
  col_set_deathlord: {
    name: 'Barrowlord Savaş Teçhizatı',
    desc: "Barrowlord Savaş Teçhizatı'nın her parçasını keşfet.",
  },
  col_set_wyrmshadow: {
    name: 'Nightfang Urbaları',
    desc: "Nightfang Urbaları'nın her parçasını keşfet.",
  },
  col_set_necromancers: {
    name: 'Mournweave Kıyafeti',
    desc: "Mournweave Kıyafeti'nin her parçasını keşfet.",
  },
  col_set_crownforged: {
    name: 'Bonewrought Kisvesi',
    desc: "Bonewrought Kisvesi'nin her parçasını keşfet.",
  },
  col_set_nighttalon: { name: 'Direfang Postu', desc: "Direfang Postu'nun her parçasını keşfet." },
  col_set_soulflame: {
    name: 'Wraithfire Kisvesi',
    desc: "Wraithfire Kisvesi'nin her parçasını keşfet.",
  },
  col_set_stormcallers: {
    name: 'Galecall Urbaları',
    desc: "Galecall Urbaları'nın her parçasını keşfet.",
  },
  col_seven_regalia: {
    name: 'Yedi Kat Gardırop',
    desc: 'Yedi destansı zırh ailesinin tamamının her parçasını keşfet.',
    title: 'İhtişamlı',
  },
  col_true_colors: {
    name: 'Asıl Rengini Göster',
    desc: 'Sınıfının varsayılan görünümü dışında herhangi bir görünümle sahaya çık.',
  },
  col_all_slots: {
    name: 'On Bir Dirhem Bir Çekirdek',
    desc: 'Aynı anda on bir ekipman yuvasının tamamında birer eşya kuşanmış ol.',
  },
  col_quartermaster_buyout: {
    name: 'Gedikli Müşteri',
    desc: "Kahramanca Levazımcısı'nın tezgâhındaki on parçanın tamamını keşfet.",
  },
  col_glimmerfin: { name: 'Umut Pırıltısı', desc: 'Bir Pırıltıyüzgeç Koi tut.' },
  col_full_creel: {
    name: 'Dolu Sepet',
    desc: "Vadi'nin, Bataklık'ın ve Tepeler'in sularındaki altı yaygın avın tümünü keşfet.",
  },
  col_junk_drawer: { name: 'Ivır Zıvır Çekmecesi', desc: 'Kötü kalitede 10 farklı eşya keşfet.' },
  pvp_arena_first_match: {
    name: 'Çizmelerindeki Kum',
    desc: "Kül Kolezyumu'nda, iki ligden herhangi birinde dereceli bir maça çık.",
  },
  pvp_arena_first_win: {
    name: 'Tribünler Kükrüyor',
    desc: 'İki ligden herhangi birinde dereceli bir arena maçı kazan.',
  },
  pvp_arena_1v1_1600: { name: 'Kolezyum Namzedi', desc: '1v1 arena liginde 1600 puana ulaş.' },
  pvp_arena_1v1_1750: { name: 'Kolezyum Hasmı', desc: '1v1 arena liginde 1750 puana ulaş.' },
  pvp_arena_1v1_1900: {
    name: 'Gladyatör',
    desc: '1v1 arena liginde 1900 puana ulaş.',
    title: 'Gladyatör',
  },
  pvp_arena_2v2_1600: { name: 'İki Kişilik Ordu', desc: '2v2 arena liginde 1600 puana ulaş.' },
  pvp_arena_2v2_1750: { name: 'Korkunç İkili', desc: '2v2 arena liginde 1750 puana ulaş.' },
  pvp_arena_2v2_1900: { name: 'Kusursuz Ortaklık', desc: '2v2 arena liginde 1900 puana ulaş.' },
  pvp_duel_first_win: { name: 'Bunu Dışarıda Halledelim', desc: 'Bir düello kazan.' },
  pvp_duel_grace: {
    name: 'Tevazu Dersi',
    desc: 'Onurunu büyük ölçüde koruyarak bir düello kaybet.',
  },
  pvp_vcup_first_match: {
    name: 'Sahaya İlk Adım',
    desc: "Kazan ya da kaybet, Domuz Tarlası'nda bir Vadi Kupası maçını sonuna kadar oyna.",
  },
  pvp_vcup_first_win: { name: 'İlk Kupa', desc: 'Dereceli bir Vadi Kupası maçı kazan.' },
  pvp_vcup_wins_10: {
    name: 'Domuztopunun Eski Kurdu',
    desc: '10 dereceli Vadi Kupası maçı kazan.',
  },
  pvp_vcup_wins_25: {
    name: 'Domuztopu Efsanesi',
    desc: '25 dereceli Vadi Kupası maçı kazan.',
    title: 'Domuztopu Efsanesi',
  },
  pvp_vcup_first_goal: { name: 'Siftah', desc: 'Dereceli bir Vadi Kupası maçında gol at.' },
  pvp_vcup_hat_trick: {
    name: 'Hat-Trick Kahramanı',
    desc: '3v3 ya da daha büyük ligde, tek bir dereceli Vadi Kupası maçında üç gol at.',
  },
  pvp_vcup_golden_goal: {
    name: 'Altın An',
    desc: 'Dereceli bir Vadi Kupası maçının kaderini belirleyen altın golü at.',
  },
  pvp_vcup_first_save: {
    name: 'Güvenli Eller',
    desc: 'Dereceli bir Vadi Kupası maçında kaleci olarak bir kurtarış yap.',
  },
  pvp_vcup_clean_sheet: {
    name: 'Bu Kaleden Geçilmez',
    desc: 'Dereceli bir Vadi Kupası maçını kaleci olarak gol yemeden kazan.',
  },
  pvp_vcup_guild_win: {
    name: 'Sancak İçin',
    desc: 'Loncanın sancağı altında katıldığın dereceli bir Vadi Kupası maçını kazan.',
  },
  pvp_fiesta_first_bout: {
    name: 'Davetsiz Misafir',
    desc: 'Kazan ya da kaybet, eksiksiz bir 2v2 Fiesta müsabakasında dövüş.',
  },
  pvp_fiesta_first_win: { name: "Fiesta'nın Neşesi", desc: 'Bir 2v2 Fiesta müsabakası kazan.' },
  pvp_fiesta_double: {
    name: 'Çifte Bela',
    desc: "Fiesta'da dört saniye içinde rakiplerini iki kez yere ser.",
  },
  pvp_fiesta_shutdown: {
    name: 'Oyunbozan',
    desc: "Fiesta'da, serisi üçe ya da daha fazlasına ulaşmış bir rakibi yere ser.",
  },
  pvp_fiesta_full_build: {
    name: 'Tepeden Tırnağa Hazır',
    desc: 'Üç dalganın her birinden birer takviye kilitlenmiş halde bir Fiesta müsabakası kazan.',
  },
  pvp_fiesta_powerups: {
    name: 'Her Şeyden Bir Tane',
    desc: 'Dört ring güçlendirmesinin her birini en az bir kez kap: Hız Şeytanı, Kolos, Ay Botları ve Cinnet.',
  },
  pvp_fiesta_five_kills: {
    name: 'Partiyi Sırtlayan',
    desc: 'Tek bir Fiesta müsabakasında rakiplerini beş kez yere ser.',
  },
  soc_first_party: {
    name: 'Birlikten Kuvvet Doğar',
    desc: 'Başka bir oyuncuyla aynı gruba katıl.',
  },
  soc_full_house: { name: 'Tam Kadro', desc: 'Beş kişilik tam bir grupla bir zindanı temizle.' },
  soc_guild_joined: { name: 'Tek Sancak Altında', desc: 'Bir loncaya üye ol.' },
  soc_guild_founded: { name: 'Kurucunun Tüy Kalemi', desc: 'Kendi loncanı kur.' },
  soc_first_trade: { name: 'Adil Bir Takas', desc: 'Başka bir oyuncuyla bir takası tamamla.' },
  soc_first_sale: {
    name: 'Dükkân Açıldı',
    desc: 'İlk Dünya Pazarı satışından kazandığın parayı tahsil et.',
  },
  soc_steady_custom: {
    name: 'Gedikli Müşteriler',
    desc: 'Dünya Pazarı satışlarından ömür boyu toplam 10 altın tahsil et.',
  },
  soc_market_magnate: {
    name: 'Pazar Kodamanı',
    desc: 'Dünya Pazarı satışlarından ömür boyu toplam 100 altın tahsil et.',
    title: 'Kodaman',
  },
  soc_by_ravens_wing: {
    name: 'Kuzgun Kanadıyla',
    desc: 'Para ya da paket taşıyan bir Kuzgun Postası mektubu gönder.',
  },
  soc_room_for_more: { name: 'Daha Fazlasına Yer Var', desc: 'İlk banka genişletmeni satın al.' },
  soc_gilded_strongbox: {
    name: 'Yaldızlı Kasa',
    desc: 'Veznedarların sana satacağı her banka genişletmesini satın al.',
  },
  soc_meet_bursar: {
    name: "Fernando'ya Emanet",
    desc: "Doğudere'de Yaldızlı Kasa'nın bekçisi Veznedar Fernando'ya saygılarını sun.",
  },
  soc_pocket_money: {
    name: 'Cep Harçlığı',
    desc: 'Ömür boyu toplamda 1 altın değerinde para yağmala.',
  },
  soc_heavy_purse: {
    name: 'Ağır Kese',
    desc: 'Ömür boyu toplamda 10 altın değerinde para yağmala.',
  },
  soc_wyrms_hoard: {
    name: 'Ejder İstifi',
    desc: 'Ömür boyu toplamda 100 altın değerinde para yağmala.',
  },
  soc_civic_duty: { name: 'Vatandaşlık Görevi', desc: 'İlk kasaba odak puanını ata.' },
  exp_long_road_north: {
    name: 'Kuzeye Giden Uzun Yol',
    desc: 'Üç merkez yerleşimin hepsini ziyaret et: Doğudere, Bataklık Köprüsü ve Yüksek Gözcü.',
  },
  exp_vale_wayfarer: {
    name: 'Vadinin Seyyahı',
    desc: "Doğudere Vadisi'nin adı bilinen on bir yerinin tamamını ziyaret et.",
  },
  exp_marsh_wayfarer: {
    name: 'Bataklığın Seyyahı',
    desc: "Mirefen Bataklığı'nın adı bilinen sekiz yerinin tamamını ziyaret et.",
  },
  exp_peaks_wayfarer: {
    name: 'Tepelerin Seyyahı',
    desc: "Dikenzirve Tepeleri'nin adı bilinen on yerinin tamamını ziyaret et.",
  },
  exp_world_traveler: {
    name: 'Cihan Seyyahı',
    desc: 'Üç bölgenin de seyyah yiğitliğini kazan.',
    title: 'Seyyah',
  },
  exp_something_shiny: { name: 'Parlak Bir Şey', desc: 'Işıldayan bir nesneyi yerden al.' },
  exp_first_ore: { name: 'Kazmayı Toprağa Vur', desc: 'İlk cevher kaynağını topla.' },
  exp_first_timber: { name: 'Ağaç Devriliyor!', desc: 'İlk odun kaynağını topla.' },
  exp_first_herb: { name: 'Bereketli Eller', desc: 'İlk şifalı ot kaynağını topla.' },
  feat_era_cap: {
    name: 'Birinci Çağın Evladı',
    desc: 'Birinci Çağ hüküm sürerken 20. seviyeye ulaştın.',
  },
  feat_book_complete: {
    name: 'Kitabın Tamamı',
    desc: "Yiğitlikler Kitabı'ndaki her yiğitliği kazan.",
  },
  feat_brightwood_relic: {
    name: "Parlakorman'ın Anısına",
    desc: "Eski Parlakorman'dan kalma bir yadigârı sakla: Dikenpost Cepken ya da Hükümdar'ın Tacı.",
  },
  hid_saul_footnote: {
    name: 'Tarihe Düşülen Dipnot',
    desc: "Vakanüvis Saul'u ara vermeden dokuz kez rahatsız ettin.",
    title: 'Dipnot',
  },
  hid_gilded_tour: {
    name: 'Yaldızlı Tur',
    desc: "Yaldızlı Kasa'nın üç şubesinin üçüyle de iş yaptın.",
  },
  hid_fall_death: {
    name: 'Yerçekimi Hep Kazanır',
    desc: 'Yerle girdiğin uzun bir sohbetin sonunda öldün.',
  },
  hid_keepers_toll_twice: {
    name: 'Bekçi İki Kez Tahsil Eder',
    desc: "Bekçi'nin Bedeli hâlâ üzerindeyken öldün.",
  },
  hid_roll_hundred: {
    name: 'Doğal Yüzlük',
    desc: 'Sıradan bir /roll atışında kusursuz bir 100 tutturdun.',
  },
  hid_yumi_cheer: {
    name: "Yumi'nin Bir Numaralı Hayranı",
    desc: "Müsabakanın tam ortasında, Yumi'nin seni duyabileceği bir yerde ona tezahürat yaptın.",
  },
  hid_bountiful_coffer: {
    name: 'Mor Sandık',
    desc: "Bir Bereket Sandığı'nı sıkışmasına fırsat vermeden kırıp açtın.",
  },
  hid_companion_save: {
    name: 'Onun Nöbetinde Asla',
    desc: 'Mağara seferi yoldaşın, yere serilen bir grup arkadaşını ayağa kaldırdı.',
  },
  hid_codfather: {
    name: 'Aileye Katıldın',
    desc: "Morina Baba'yı Derinbataklık Sığlıkları'ndan çekip çıkardın.",
  },
  prog_crown_below: {
    name: 'Aşağıdaki Taç',
    desc: "Huzursuz kemik tarlalarından Kral Nythraxis'in kabrine dek tacın izini sür ve Belanın Sonu görevini tamamla.",
  },
  prog_mere_at_rest: {
    name: 'Durulan Göl',
    desc: "Ondrel Vane'in nöbetini sonuna dek götür: koroyu sustur, Solgunkıvrım'ı öldür ve Boğulmuş Ay'ı huzura erdir.",
  },
  prog_callused_hands: {
    name: 'Nasırlı Eller',
    desc: "Her Ele Bir Zanaat görevini tamamla ve Doğudere'nin zanaatlarında ilk nasırını kazan.",
  },
  prog_tools_of_the_trade: {
    name: 'Alet İşler, El Övünür',
    desc: 'Yüksek Gözcü zanaat merkezinde tezgâh gerektiren bir üretimi tamamla.',
  },
  dgn_nythraxis_crypt: {
    name: 'Mahzenin Sakladığı',
    desc: "Terk Edilmiş Mahzen'e meydan oku ve muhafızlarından kilit taşının iki yarısı ile Kadim Günlük'ü geri al.",
  },
  chr_marsh_first_cast: {
    name: 'Sazlıktaki Yılanbalıkları',
    desc: "Mirefen Bataklığı'nın sularından bir balık tut.",
  },
};
