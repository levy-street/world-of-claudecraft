// Deed name / desc / title locale table for id_ID (data-as-code, size-exempt).
// One per-base-locale chunk behind DEED_LOCALE_LOADERS in deed_i18n.ts, so a
// visitor downloads only their own locale's deed strings. Split verbatim from
// the former deed_i18n.newlocales.ts single chunk; values carry no em or en
// dashes (repo copy rule). English (en / en_CA) resolves to the authored
// source before this table is consulted.
import type { DeedLocaleTable } from '../deed_i18n';

export const table: DeedLocaleTable = {
  pvp_card_duel_first_win: {
    name: 'Aturan Sendiri',
    desc: 'Menangkan Duel Kartu di hadapan Ahli Kartu.',
  },
  prog_first_steps: {
    name: 'Langkah Pertama',
    desc: 'Capai level 2 dan ayunkan langkah pertamamu di jalan yang masih panjang.',
  },
  prog_finding_your_feet: {
    name: 'Mulai Menapak',
    desc: 'Capai level 5; alam liar sudah terasa sedikit lebih kecil.',
  },
  prog_double_digits: { name: 'Dua Digit', desc: 'Capai level 10 dan buka talentamu.' },
  prog_the_long_middle: { name: 'Jalan Tengah yang Panjang', desc: 'Capai level 15.' },
  prog_level_cap: {
    name: 'Pemandangan dari Puncak',
    desc: 'Capai level 20, batas level tertinggi.',
  },
  prog_well_rested: {
    name: 'Istirahat Cukup',
    desc: 'Beristirahatlah di penginapan hingga kau memperoleh pengalaman istirahat.',
  },
  prog_talented: { name: 'Poin yang Tak Sia-sia', desc: 'Gunakan poin talenta pertamamu.' },
  prog_specialized: {
    name: 'Pernyataan Tekad',
    desc: 'Pilih satu spesialisasi dan pelajari kemampuan khasnya.',
  },
  prog_deep_roots: {
    name: 'Akar yang Dalam',
    desc: 'Gunakan satu poin talenta pada talenta di baris terakhir.',
  },
  prog_full_build: {
    name: 'Enam Lengkap',
    desc: 'Pilih satu opsi pada keenam baris talenta dalam satu build.',
  },
  prog_veteran: {
    name: 'Veteran',
    desc: 'Kumpulkan total 250.000 pengalaman sepanjang hayat.',
    title: 'Veteran',
  },
  prog_champion: {
    name: 'Juara',
    desc: 'Kumpulkan total 500.000 pengalaman sepanjang hayat.',
    title: 'Juara',
  },
  prog_paragon: {
    name: 'Teladan',
    desc: 'Kumpulkan total 1.000.000 pengalaman sepanjang hayat.',
    title: 'Teladan',
  },
  prog_mythic: {
    name: 'Mistis',
    desc: 'Kumpulkan total 2.500.000 pengalaman sepanjang hayat.',
    title: 'Mistis',
  },
  prog_eternal: {
    name: 'Abadi',
    desc: 'Kumpulkan total 5.000.000 pengalaman sepanjang hayat.',
    title: 'Abadi',
  },
  prog_prestige: {
    name: 'Mulai Lagi dari Awal',
    desc: 'Capai batas level, penuhi bilah pengalaman sekali lagi, dan raih peringkat prestise 1.',
  },
  prog_prestige_5: { name: 'Kebiasaan Lama', desc: 'Capai peringkat prestise 5.' },
  prog_prestige_10: { name: 'Gerak Abadi', desc: 'Capai peringkat prestise 10.' },
  prog_first_harvest: { name: 'Buah Ladang', desc: 'Panen titik pengumpulan pertamamu.' },
  prog_mining_100: { name: 'Bijih dalam Darah', desc: 'Capai 100 kecakapan Penambangan.' },
  prog_logging_100: { name: 'Penebas Inti Kayu', desc: 'Capai 100 kecakapan Penebangan Kayu.' },
  prog_herbalism_100: { name: 'Penguasa Padang Rumput', desc: 'Capai 100 kecakapan Herbalisme.' },
  prog_master_gatherer: {
    name: 'Pengumpul Ulung',
    desc: 'Capai 100 kecakapan dalam Penambangan, Penebangan Kayu, dan Herbalisme.',
  },
  prog_first_craft: { name: 'Buatan Tangan', desc: 'Selesaikan hasil kerajinan sukses pertamamu.' },
  prog_craft_specialist: {
    name: 'Rahasia Dapur',
    desc: 'Capai 75 keahlian pada satu kerajinan mana pun dan buka bonus spesialisasinya.',
  },
  prog_around_the_ring: {
    name: 'Mengitari Lingkaran',
    desc: 'Capai 25 keahlian pada lima kerajinan yang berbeda.',
  },
  cmb_first_blood: { name: 'Darah Pertama', desc: 'Kalahkan musuh pertamamu.' },
  cmb_slayer: { name: 'Pembantai', desc: 'Kalahkan 1.000 musuh.' },
  cmb_legion_of_one: { name: 'Legiun Seorang Diri', desc: 'Kalahkan 10.000 musuh.' },
  cmb_heavy_hitter: { name: 'Pemukul Kelas Berat', desc: 'Timbulkan total 500.000 kerusakan.' },
  cmb_critical_eye: { name: 'Mata Jeli', desc: 'Daratkan 500 serangan kritis.' },
  cmb_giantslayer: {
    name: 'Penumbang Raksasa',
    desc: 'Daratkan pukulan penghabisan pada musuh yang setidaknya lima level di atasmu.',
  },
  cmb_first_fall: {
    name: 'Tepis Debu, Bangkit Lagi',
    desc: 'Mati untuk pertama kalinya; itu terjadi pada yang terbaik sekalipun.',
  },
  dgn_hollow_crypt: {
    name: 'Pendobrak Kripta',
    desc: 'Kalahkan Morthen sang Pemanggil Kubur di Kripta Berongga.',
  },
  dgn_sunken_bastion: {
    name: 'Ikatan Kabut Terurai',
    desc: 'Kalahkan Vael sang Fogbinder di Benteng Karam.',
  },
  dgn_drowned_temple: {
    name: 'Menenggelamkan Sang Bulan',
    desc: 'Kalahkan Ysolei, Awatara Bulan Tenggelam, di Kuil Tenggelam.',
  },
  dgn_gravewyrm_sanctum: {
    name: 'Wyrm di Kedalaman',
    desc: 'Kalahkan Korzul sang Gravewyrm di Sanktum Gravewyrm.',
  },
  dgn_hollow_crypt_heroic: {
    name: 'Heroik: Kripta Berongga',
    desc: 'Kalahkan Morthen sang Pemanggil Kubur di Kripta Berongga pada tingkat kesulitan Heroik.',
  },
  dgn_sunken_bastion_heroic: {
    name: 'Heroik: Benteng Karam',
    desc: 'Kalahkan Vael sang Fogbinder di Benteng Karam pada tingkat kesulitan Heroik.',
  },
  dgn_drowned_temple_heroic: {
    name: 'Heroik: Kuil Tenggelam',
    desc: 'Kalahkan Ysolei, Awatara Bulan Tenggelam, di Kuil Tenggelam pada tingkat kesulitan Heroik.',
  },
  dgn_gravewyrm_sanctum_heroic: {
    name: 'Heroik: Sanktum Gravewyrm',
    desc: 'Kalahkan Korzul sang Gravewyrm di Sanktum Gravewyrm pada tingkat kesulitan Heroik.',
  },
  dgn_nythraxis: {
    name: 'Tamatlah Sang Bencana',
    desc: 'Kalahkan Nythraxis, Bencana Thornpeak, di balik pintu kerajaan yang tersegel.',
  },
  dgn_nythraxis_heroic: {
    name: 'Heroik: Tamatlah Sang Bencana',
    desc: 'Kalahkan Nythraxis, Bencana Thornpeak, pada tingkat kesulitan Heroik.',
  },
  dgn_thornpeak_rounds: {
    name: 'Ronda Keliling',
    desc: 'Tuntaskan Kripta Berongga, Benteng Karam, Kuil Tenggelam, dan Sanktum Gravewyrm.',
  },
  dgn_deepward: {
    name: 'Penjaga Kedalaman',
    desc: 'Taklukkan setiap dungeon, raid, dan kedua delve pada tingkat kesulitan Heroik.',
  },
  dgn_mark_circuit: {
    name: 'Sirkuit Penuh',
    desc: 'Dapatkan Tanda Heroik dari keempat dungeon Heroik dalam satu hari yang sama.',
  },
  dgn_boss_clears_50: {
    name: 'Lima Puluh Gerbang Tumbang',
    desc: 'Kalahkan 50 bos pamungkas dungeon.',
  },
  dgn_morthen_flawless: {
    name: 'Tak Sebatang Tulang Patah',
    desc: 'Kalahkan Morthen sang Pemanggil Kubur pada tingkat kesulitan Heroik tanpa satu pun anggota party yang mati.',
  },
  dgn_morthen_trio: {
    name: 'Bertiga Melawan Kubur',
    desc: 'Kalahkan Morthen sang Pemanggil Kubur dengan tiga pemain atau kurang.',
  },
  dgn_olen_arc: {
    name: 'Mengelak dari Sang Penuai',
    desc: 'Kalahkan Komandan Ksatria Olen tanpa Busur Penuai miliknya mengenai siapa pun selain target yang sedang diincarnya.',
  },
  dgn_vael_thralls: {
    name: 'Bukan Budakku',
    desc: 'Kalahkan Vael sang Fogbinder dengan setiap Budak Tenggelam yang dipanggilnya telah tewas lebih dulu.',
  },
  dgn_ysolei_moonspawn: {
    name: 'Tak Satu Anak Bulan Tersisa',
    desc: 'Kalahkan Ysolei dengan setiap Anak Bulan yang dipanggilnya telah tewas lebih dulu.',
  },
  dgn_ysolei_flawless: {
    name: 'Mata yang Kering',
    desc: 'Kalahkan Ysolei, Awatara Bulan Tenggelam, pada tingkat kesulitan Heroik tanpa satu pun anggota party yang mati.',
  },
  dgn_velkhar_bonewalkers: {
    name: 'Tetaplah Terkubur',
    desc: 'Kalahkan Nekromancer Agung Velkhar dengan setiap Pejalan Tulang Bangkit dihancurkan sebelum ia tumbang.',
  },
  dgn_korzul_flawless: {
    name: 'Penumbang Wyrm',
    desc: 'Kalahkan Korzul sang Gravewyrm pada tingkat kesulitan Heroik tanpa satu pun anggota party yang mati.',
    title: 'Penumbang Wyrm',
  },
  dgn_sanctum_speed: {
    name: 'Lari Kencang Sanktum',
    desc: 'Kalahkan Korzul sang Gravewyrm dalam 15 menit sejak party-mu mengklaim Sanktum Gravewyrm.',
  },
  dgn_nythraxis_gravebreaker: {
    name: 'Tak Bertekuk Lutut pada Raja',
    desc: 'Kalahkan Nythraxis tanpa Pembelah Kubur mengenai siapa pun selain target yang sedang diincarnya.',
  },
  dgn_nythraxis_wardens: {
    name: 'Penjaga Batu Penangkal',
    desc: 'Kalahkan Nythraxis dengan setiap Amukan Nirmaut dipatahkan sebelum sempat menghantam.',
  },
  dgn_nythraxis_deathless: {
    name: 'Tiada yang Lebih Nirmaut',
    desc: 'Kalahkan Nythraxis, Bencana Thornpeak, pada tingkat kesulitan Heroik tanpa satu pun anggota raid yang mati.',
    title: 'sang Nirmaut',
  },
  cmb_thunzharr: {
    name: 'Gunung pun Tumbang',
    desc: 'Tumbangkan Thunzharr, Puncak yang Terjaga, di Stormcrag.',
  },
  cmb_thunzharr_unbroken: {
    name: 'Pemecah Puncak',
    desc: 'Tumbangkan Thunzharr, Puncak yang Terjaga, tanpa mati sejak pukulan pertamamu hingga napas terakhirnya.',
    title: 'Pemecah Puncak',
  },
  cmb_thunzharr_ten: {
    name: 'Kebiasaan Menumbangkan Gunung',
    desc: 'Tumbangkan Thunzharr, Puncak yang Terjaga, sepuluh kali.',
  },
  dlv_reliquary: { name: 'Pelari Reliquary', desc: 'Tuntaskan Reliquary yang Runtuh.' },
  dlv_reliquary_heroic: {
    name: 'Heroik: Reliquary yang Runtuh',
    desc: 'Tuntaskan Reliquary yang Runtuh pada tingkat Heroik.',
  },
  dlv_litany: { name: 'Bungkam Litani', desc: 'Tuntaskan Litani Tenggelam.' },
  dlv_litany_heroic: {
    name: 'Heroik: Litani Tenggelam',
    desc: 'Tuntaskan Litani Tenggelam pada tingkat Heroik.',
  },
  dlv_lore_journal: { name: 'Catatan Pinggir', desc: 'Buka kelima entri jurnal delve.' },
  dlv_companion_max: {
    name: 'Sahabat di Kedalaman',
    desc: 'Naikkan seorang pendamping delve hingga pangkat tertingginya.',
  },
  dlv_companions_both: {
    name: 'Dua Lentera Menyala',
    desc: 'Naikkan kedua pendamping delve, Akolit Tessa dan Edda Reedhand, hingga pangkat tertinggi mereka.',
  },
  dlv_clears_50: { name: 'Lima Puluh Depa', desc: 'Tuntaskan 50 penjelajahan delve.' },
  dlv_solo_heroic: {
    name: 'Berdua Saja Sudah Ramai',
    desc: 'Tuntaskan sebuah delve tingkat Heroik tanpa pemain lain, hanya kau dan pendampingmu.',
  },
  dlv_tumbler_premium: {
    name: 'Jalan Sang Pembuka Kunci, Paripurna',
    desc: 'Buka sebuah peti relikuari bersegel pelindung pada taruhan tertinggi, mulus pada satu-satunya percobaanmu.',
  },
  dlv_rite_flawless: {
    name: 'Hafal Kata demi Kata',
    desc: 'Selesaikan Ritus Relikuari Tenggelam tanpa satu pun kesalahan.',
  },
  dlv_varric_ringers: {
    name: 'Lonceng-Lonceng Terdiam',
    desc: 'Kalahkan Diaken Varric dengan setiap Pembunyi Lonceng Pemakaman yang ia bangkitkan telah tewas lebih dulu.',
  },
  dlv_nhalia_bells: {
    name: 'Peredam Lonceng',
    desc: 'Kalahkan Suster Nhalia, Sang Kidung Tenggelam, tanpa satu pun anggota party terkena hantaman Lonceng Berdentang.',
    title: 'Peredam Lonceng',
  },
  chr_vale_chapter_i: {
    name: 'Kronik Lembah, Bab I',
    desc: 'Selesaikan bab pertama kronik Saul: tugas-tugas pembuka Eastbrook, seluk-beluk Lembah, dan cicipan pertama kerajinannya.',
  },
  chr_vale_chapter_ii: {
    name: 'Kronik Lembah, Bab II',
    desc: 'Selesaikan bab kedua kronik Saul: bandit, murloc, dan hama tambang ditumpas, laga di Sowfield dimainkan, dan Reliquary dijajal.',
  },
  chr_vale_chapter_iii: {
    name: 'Kronik Sang Lembah',
    desc: 'Tuntaskan seluruh kisah Lembah: kedok sang Pemanggil Kubur terbongkar, Kripta Berongga disucikan, dan setiap teror bernama di Lembah ditumbangkan.',
    title: 'dari Lembah',
  },
  chr_vale_gatherer: {
    name: 'Hidup dari Hasil Bumi',
    desc: 'Panen satu urat bijih, satu tegakan kayu, dan satu petak herba di Lembah Eastbrook.',
  },
  chr_vale_first_cast: {
    name: 'Ada Sesuatu di Danau Cermin',
    desc: 'Pancing seekor ikan dari perairan Lembah Eastbrook.',
  },
  chr_vale_packbreaker: {
    name: 'Pemecah Kawanan',
    desc: 'Bantai 3 Serigala Hutan dalam waktu 10 detik.',
  },
  chr_vale_cup_debut: {
    name: 'Penantang Ember Tembaga',
    desc: 'Turun ke lapangan dan sentuh bola dalam sebuah pertandingan Piala Lembah di Sowfield.',
  },
  chr_vale_rares: {
    name: 'Teror-Teror Lembah',
    desc: 'Bantai lima teror bernama di Lembah Eastbrook: Greyjaw Tua, Mogger, Grix sang Raja Terowongan, Kapten Verlan, dan Pengikat Arwah Maldrec.',
  },
  chr_marsh_chapter_i: {
    name: 'Kronik Rawa, Bab I',
    desc: 'Selesaikan bab pertama kronik Osric Fenn: penuhi panggilan mobilisasi Jembatan Rawa, amankan jalan lintasnya, dan kenali seluk-beluk rawa.',
  },
  chr_marsh_chapter_ii: {
    name: 'Kronik Rawa, Bab II',
    desc: 'Selesaikan bab kedua kronik Osric Fenn: sarang para janda dibakar habis, kaum tenggelam dibaringkan dalam damai, Sang Bapak Kod didaratkan, dan Litani dijajal.',
  },
  chr_marsh_chapter_iii: {
    name: 'Kronik Mirefen',
    desc: 'Tuntaskan seluruh kisah rawa: perkemahan sekte diporak-porandakan, sang Fogbinder dibungkam di Benteng Karam, dan setiap teror bernama di dalam kabut ditumbangkan.',
    title: 'dari Mirefen',
  },
  chr_marsh_gatherer: {
    name: 'Meramban di Jembatan Rawa',
    desc: 'Panen satu urat bijih, satu tegakan kayu, dan satu petak herba di Rawa Mirefen.',
  },
  chr_marsh_unburst: {
    name: 'Jangan Berdiri di Dalam Spora',
    desc: 'Bantai 8 Kembung Rawa tanpa terkena ledakan Spora Kaustik mereka.',
  },
  chr_marsh_hush_the_mending: {
    name: 'Bungkam Sang Penambal',
    desc: 'Di Perkemahan Gravecaller, bantai seorang Penambal Pemanggil Kubur sebelum satu pun kultis yang dirawatnya tumbang.',
  },
  chr_marsh_rares: {
    name: 'Nama-Nama dalam Kabut',
    desc: 'Bantai tiga teror bernama di Rawa Mirefen: Mirejaw sang Rakus, Sloomtooth sang Tenggelam, dan Suster Nhalia.',
  },
  chr_peaks_chapter_i: {
    name: 'Kronik Puncak, Bab I',
    desc: 'Selesaikan bab pertama kronik Zenzie: bersihkan jalan punggung bukit, kosongkan liang-liang, dan kenali setiap jalur yang dijaga Menara Pengawas.',
  },
  chr_peaks_chapter_ii: {
    name: 'Kronik Puncak, Bab II',
    desc: 'Selesaikan bab kedua kronik Zenzie: hancurkan Kemah Perang Drogmar, baca tanda-tanda badai yang terjaga, dan berdirilah di tempat Glimmermere berpendar.',
  },
  chr_peaks_chapter_iii: {
    name: 'Kronik Thornpeak',
    desc: 'Tuntaskan seluruh kisah gunung: Wyrmcult dihancurkan, Sanktum dibungkam, sang Puncak yang Terjaga dirobohkan, dan setiap teror bernama di tebing-tebing ditumbangkan.',
    title: 'dari Thornpeak',
  },
  chr_peaks_sparring: {
    name: 'Latihan Tembok',
    desc: 'Berikan total 1.000 kerusakan pada Boneka Latihan di atas Menara Pengawas.',
  },
  chr_peaks_glimmer_cast: {
    name: 'Air Dingin, Cahaya Lebih Dingin',
    desc: 'Pancing seekor ikan dari Glimmermere.',
  },
  chr_peaks_moongate: {
    name: 'Melewati Gerbang Dingin',
    desc: 'Melangkahlah melewati gerbang bulan di tepian Glimmermere.',
  },
  chr_peaks_waking_witness: {
    name: 'Gunung yang Berjalan',
    desc: 'Saksikan Thunzharr, Puncak yang Terjaga, saat ia melangkah di gunung.',
  },
  chr_peaks_rares: {
    name: 'Nama Terpahat di Tebing',
    desc: 'Bantai empat teror bernama di Dataran Tinggi Thornpeak: Mandor Ironvein, Brutok Penghancur Tengkorak, Voskar sang Sayap Bara, dan Tuan Sumsum Varkas.',
  },
  col_discovery_25: {
    name: 'Tukang Timbun',
    desc: 'Temukan 25 barang berbeda (sebuah barang terhitung saat pertama kali masuk ke dalam kepemilikanmu).',
  },
  col_discovery_75: { name: 'Pemburu Kilauan', desc: 'Temukan 75 barang berbeda.' },
  col_discovery_150: {
    name: 'Lemari Keajaiban',
    desc: 'Temukan 150 barang berbeda.',
    title: 'sang Kurator',
  },
  col_discovery_250: { name: 'Katalog Agung', desc: 'Temukan 250 barang berbeda.' },
  col_first_rare: {
    name: 'Sesuatu yang Biru',
    desc: 'Dapatkan barang pertamamu yang berkualitas langka.',
  },
  col_first_epic: {
    name: 'Berdarah Ungu',
    desc: 'Dapatkan barang pertamamu yang berkualitas epik.',
  },
  col_first_legendary: {
    name: 'Rezeki Jingga',
    desc: 'Dapatkan barang pertamamu yang berkualitas legendaris.',
  },
  col_set_vale_arcanist: {
    name: 'Regalia Arkanis Lembah',
    desc: 'Temukan setiap bagian dari Regalia Arkanis Lembah.',
  },
  col_set_boundstone_vanguard: {
    name: 'Garda Depan Batu Terikat',
    desc: 'Temukan setiap bagian dari Garda Depan Batu Terikat.',
  },
  col_set_greyjaw_stalker: {
    name: 'Perlengkapan Pengintai Greyjaw',
    desc: 'Temukan setiap bagian dari Perlengkapan Pengintai Greyjaw.',
  },
  col_set_deathlord: {
    name: 'Perlengkapan Tempur Barrowlord',
    desc: 'Temukan setiap bagian dari Perlengkapan Tempur Barrowlord.',
  },
  col_set_wyrmshadow: {
    name: 'Jubah Nightfang',
    desc: 'Temukan setiap bagian dari Jubah Nightfang.',
  },
  col_set_necromancers: {
    name: 'Busana Mournweave',
    desc: 'Temukan setiap bagian dari Busana Mournweave.',
  },
  col_set_crownforged: {
    name: 'Regalia Bonewrought',
    desc: 'Temukan setiap bagian dari Regalia Bonewrought.',
  },
  col_set_nighttalon: { name: 'Bulu Direfang', desc: 'Temukan setiap bagian dari Bulu Direfang.' },
  col_set_soulflame: {
    name: 'Regalia Wraithfire',
    desc: 'Temukan setiap bagian dari Regalia Wraithfire.',
  },
  col_set_stormcallers: {
    name: 'Jubah Galecall',
    desc: 'Temukan setiap bagian dari Jubah Galecall.',
  },
  col_seven_regalia: {
    name: 'Lemari Busana Tujuh Rupa',
    desc: 'Temukan setiap bagian dari ketujuh keluarga zirah epik.',
    title: 'yang Gemilang',
  },
  col_true_colors: {
    name: 'Warna Sejati',
    desc: 'Turun ke lapangan mengenakan tampilan apa pun selain tampilan bawaan kelasmu.',
  },
  col_all_slots: {
    name: 'Necis Sebelas Slot',
    desc: 'Kenakan barang di kesebelas slot perlengkapan pada saat yang sama.',
  },
  col_quartermaster_buyout: {
    name: 'Pelanggan Kesayangan',
    desc: 'Temukan kesepuluh barang dagangan Kepala Perbekalan Vex.',
  },
  col_glimmerfin: { name: 'Kilau Harapan', desc: 'Pancing seekor Koi Sirip Kilau.' },
  col_full_creel: {
    name: 'Keranjang Ikan Penuh',
    desc: 'Temukan keenam tangkapan umum dari perairan Lembah, Rawa, dan Dataran Tinggi.',
  },
  col_junk_drawer: {
    name: 'Laci Rongsokan',
    desc: 'Temukan 10 barang berbeda yang berkualitas buruk.',
  },
  pvp_arena_first_match: {
    name: 'Pasir di Sepatu Bot',
    desc: 'Bertarunglah dalam satu pertandingan berperingkat di Koliseum Abu, di divisi mana pun.',
  },
  pvp_arena_first_win: {
    name: 'Gemuruh Penonton',
    desc: 'Menangkan satu pertandingan arena berperingkat di divisi mana pun.',
  },
  pvp_arena_1v1_1600: {
    name: 'Penantang Koliseum',
    desc: 'Capai rating 1600 di divisi arena 1v1.',
  },
  pvp_arena_1v1_1750: { name: 'Rival Koliseum', desc: 'Capai rating 1750 di divisi arena 1v1.' },
  pvp_arena_1v1_1900: {
    name: 'Gladiator',
    desc: 'Capai rating 1900 di divisi arena 1v1.',
    title: 'Gladiator',
  },
  pvp_arena_2v2_1600: { name: 'Kuat Berdua', desc: 'Capai rating 1600 di divisi arena 2v2.' },
  pvp_arena_2v2_1750: { name: 'Duet Maut', desc: 'Capai rating 1750 di divisi arena 2v2.' },
  pvp_arena_2v2_1900: {
    name: 'Kemitraan Sempurna',
    desc: 'Capai rating 1900 di divisi arena 2v2.',
  },
  pvp_duel_first_win: { name: 'Selesaikan di Luar', desc: 'Menangkan sebuah duel.' },
  pvp_duel_grace: {
    name: 'Pelajaran Kerendahan Hati',
    desc: 'Kalah dalam duel dengan martabat yang sebagian besar masih utuh.',
  },
  pvp_vcup_first_match: {
    name: 'Turun ke Lapangan',
    desc: 'Selesaikan satu pertandingan Piala Lembah secara penuh di Sowfield, menang ataupun kalah.',
  },
  pvp_vcup_first_win: {
    name: 'Trofi Pertama',
    desc: 'Menangkan satu pertandingan Piala Lembah berperingkat.',
  },
  pvp_vcup_wins_10: {
    name: 'Pebola Babi Hutan Kawakan',
    desc: 'Menangkan 10 pertandingan Piala Lembah berperingkat.',
  },
  pvp_vcup_wins_25: {
    name: 'Legenda Bola Babi Hutan',
    desc: 'Menangkan 25 pertandingan Piala Lembah berperingkat.',
    title: 'Legenda Bola Babi Hutan',
  },
  pvp_vcup_first_goal: {
    name: 'Pecah Telur',
    desc: 'Cetak satu gol dalam pertandingan Piala Lembah berperingkat.',
  },
  pvp_vcup_hat_trick: {
    name: 'Pahlawan Hat-trick',
    desc: 'Cetak tiga gol dalam satu pertandingan Piala Lembah berperingkat, di divisi 3v3 atau lebih besar.',
  },
  pvp_vcup_golden_goal: {
    name: 'Momen Emas',
    desc: 'Cetak gol emas yang menentukan hasil sebuah pertandingan Piala Lembah berperingkat.',
  },
  pvp_vcup_first_save: {
    name: 'Tangan Andal',
    desc: 'Lakukan satu penyelamatan sebagai kiper dalam pertandingan Piala Lembah berperingkat.',
  },
  pvp_vcup_clean_sheet: {
    name: 'Tak Satu Pun Lolos',
    desc: 'Menangkan pertandingan Piala Lembah berperingkat sebagai kiper tanpa kebobolan satu gol pun.',
  },
  pvp_vcup_guild_win: {
    name: 'Demi Sang Panji',
    desc: 'Menangkan pertandingan Piala Lembah berperingkat yang diikuti di bawah panji guild-mu.',
  },
  pvp_fiesta_first_bout: {
    name: 'Penyusup Pesta',
    desc: 'Bertarunglah dalam satu laga Fiesta 2v2 secara penuh, menang ataupun kalah.',
  },
  pvp_fiesta_first_win: { name: 'Bintang Fiesta', desc: 'Menangkan satu laga Fiesta 2v2.' },
  pvp_fiesta_double: {
    name: 'Sekali Dayung, Dua Tumbang',
    desc: 'Robohkan dua lawan Fiesta dalam rentang empat detik.',
  },
  pvp_fiesta_shutdown: {
    name: 'Perusak Pesta',
    desc: 'Robohkan lawan Fiesta yang tengah berada dalam rentetan tiga atau lebih.',
  },
  pvp_fiesta_full_build: {
    name: 'Berdandan untuk Pesta',
    desc: 'Menangkan laga Fiesta dengan augmen terkunci dari ketiga gelombang.',
  },
  pvp_fiesta_powerups: {
    name: 'Cicipi Semuanya',
    desc: 'Ambil masing-masing dari keempat power-up gelanggang setidaknya sekali: Setan Kecepatan, Raksasa, Bot Bulan, dan Berserker.',
  },
  pvp_fiesta_five_kills: {
    name: 'Tulang Punggung Pesta',
    desc: 'Robohkan lima lawan dalam satu laga Fiesta.',
  },
  soc_first_party: {
    name: 'Lebih Baik Bersama',
    desc: 'Bergabunglah dalam satu party bersama pemain lain.',
  },
  soc_full_house: {
    name: 'Formasi Lengkap',
    desc: 'Taklukkan sebuah dungeon dengan party lengkap berisi lima orang.',
  },
  soc_guild_joined: { name: 'Di Bawah Satu Panji', desc: 'Jadilah anggota sebuah guild.' },
  soc_guild_founded: { name: 'Pena Sang Pendiri', desc: 'Dirikan guild milikmu sendiri.' },
  soc_first_trade: {
    name: 'Pertukaran yang Adil',
    desc: 'Selesaikan satu pertukaran barang dengan pemain lain.',
  },
  soc_first_sale: {
    name: 'Buka Lapak',
    desc: 'Ambil uang hasil penjualan pertamamu di Pasar Dunia.',
  },
  soc_steady_custom: {
    name: 'Pelanggan Tetap',
    desc: 'Kumpulkan total 10 emas seumur hidup dari penjualanmu di Pasar Dunia.',
  },
  soc_market_magnate: {
    name: 'Taipan Pasar',
    desc: 'Kumpulkan total 100 emas seumur hidup dari penjualanmu di Pasar Dunia.',
    title: 'Taipan',
  },
  soc_by_ravens_wing: {
    name: 'Lewat Sayap Gagak',
    desc: 'Kirim sepucuk surat Pos Gagak yang memuat uang atau paket.',
  },
  soc_room_for_more: { name: 'Ruang Tambahan', desc: 'Beli perluasan bank pertamamu.' },
  soc_gilded_strongbox: {
    name: 'Brankas Bersepuh Emas',
    desc: 'Beli setiap perluasan bank yang bersedia dijual para bendahara kepadamu.',
  },
  soc_meet_bursar: {
    name: 'Kepada Fernando Kami Percaya',
    desc: 'Beri hormat kepada Bendahara Fernando, penjaga Brankas Bersepuh Emas di Eastbrook.',
  },
  soc_pocket_money: {
    name: 'Uang Jajan',
    desc: 'Jarah total 1 emas seumur hidup dalam bentuk kepingan uang.',
  },
  soc_heavy_purse: {
    name: 'Pundi-Pundi Berat',
    desc: 'Jarah total 10 emas seumur hidup dalam bentuk kepingan uang.',
  },
  soc_wyrms_hoard: {
    name: 'Timbunan Sang Wyrm',
    desc: 'Jarah total 100 emas seumur hidup dalam bentuk kepingan uang.',
  },
  soc_civic_duty: { name: 'Tugas Warga', desc: 'Alokasikan poin fokus kota pertamamu.' },
  exp_long_road_north: {
    name: 'Jalan Panjang ke Utara',
    desc: 'Kunjungi ketiga permukiman pusat: Eastbrook, Jembatan Rawa, dan Menara Pengawas.',
  },
  exp_vale_wayfarer: {
    name: 'Pengelana Lembah',
    desc: 'Kunjungi kesebelas tempat bernama di Lembah Eastbrook.',
  },
  exp_marsh_wayfarer: {
    name: 'Pengelana Rawa',
    desc: 'Kunjungi kedelapan tempat bernama di Rawa Mirefen.',
  },
  exp_peaks_wayfarer: {
    name: 'Pengelana Dataran Tinggi',
    desc: 'Kunjungi kesepuluh tempat bernama di Dataran Tinggi Thornpeak.',
  },
  exp_world_traveler: {
    name: 'Penjelajah Dunia',
    desc: 'Raih jasa pengelana dari ketiga zona.',
    title: 'Sang Pengelana',
  },
  exp_something_shiny: {
    name: 'Sesuatu yang Berkilau',
    desc: 'Pungut sebuah benda berkilauan dari tanah.',
  },
  exp_first_ore: { name: 'Belah Bumi', desc: 'Panen titik bijih pertamamu.' },
  exp_first_timber: { name: 'Awas, Tumbang!', desc: 'Panen titik kayu pertamamu.' },
  exp_first_herb: { name: 'Tangan Dingin', desc: 'Panen titik herba pertamamu.' },
  feat_era_cap: {
    name: 'Anak Era Pertama',
    desc: 'Mencapai level 20 selagi Era Pertama masih berjalan.',
  },
  feat_book_complete: { name: 'Seisi Kitab', desc: 'Raih setiap jasa dalam Kitab Jasa.' },
  feat_brightwood_relic: {
    name: 'Mengenang Brightwood',
    desc: 'Simpan sebuah relik dari Brightwood lama: Jaket Kulit Berduri atau Mahkota Sang Raja.',
  },
  hid_saul_footnote: {
    name: 'Catatan Kaki Sejarah',
    desc: 'Mengusik Saul sang Juru Kronik sembilan kali tanpa jeda.',
    title: 'Sang Catatan Kaki',
  },
  hid_gilded_tour: {
    name: 'Tur Bersepuh Emas',
    desc: 'Bertransaksi dengan ketiga cabang Brankas Bersepuh Emas.',
  },
  hid_fall_death: {
    name: 'Gravitasi Selalu Menang',
    desc: 'Mati akibat percakapan panjang dengan tanah.',
  },
  hid_keepers_toll_twice: {
    name: 'Sang Penjaga Menagih Dua Kali',
    desc: 'Mati selagi Upeti Sang Penjaga masih membebanimu.',
  },
  hid_roll_hundred: {
    name: 'Seratus Sempurna',
    desc: 'Melempar angka 100 sempurna pada /roll biasa.',
  },
  hid_yumi_cheer: {
    name: 'Penggemar Berat Yumi',
    desc: 'Bersorak untuk Yumi di tempat yang bisa ia dengar, di tengah laga.',
  },
  hid_bountiful_coffer: {
    name: 'Peti Ungu',
    desc: 'Membobol sebuah Peti Melimpah sebelum peti itu sempat macet.',
  },
  hid_companion_save: {
    name: 'Tidak Selama Ia Berjaga',
    desc: 'Pendamping delve-mu menarik rekan party yang tumbang hingga berdiri kembali.',
  },
  hid_codfather: {
    name: 'Masuk ke Dalam Keluarga',
    desc: 'Menyeret Sang Bapak Kod keluar dari Perairan Dangkal Deepfen.',
  },
  prog_crown_below: {
    name: 'Mahkota di Kedalaman',
    desc: 'Ikuti jejak sang mahkota dari padang tulang yang gelisah hingga ke makam Raja Nythraxis dan tuntaskan Akhir Sang Bencana.',
  },
  prog_mere_at_rest: {
    name: 'Danau yang Tenteram',
    desc: 'Tuntaskan penjagaan Ondrel Vane hingga akhir: paduan suara dibungkam, sang Lingkar Pucat ditumbangkan, dan Bulan Tenggelam diistirahatkan.',
  },
  prog_callused_hands: {
    name: 'Tangan Kapalan',
    desc: 'Selesaikan Kerja untuk Setiap Tangan dan dapatkan kapalan pertamamu dalam aneka pertukangan Eastbrook.',
  },
  prog_tools_of_the_trade: {
    name: 'Perkakas Sang Tukang',
    desc: 'Selesaikan proses pembuatan di stasiun kerajinan.',
  },
  dgn_nythraxis_crypt: {
    name: 'Yang Disimpan Kripta',
    desc: 'Beranikan diri memasuki Kripta Terbengkalai dan dapatkan kembali kedua belahan batu kunci serta buku harian kuno dari para penjaganya.',
  },
  chr_marsh_first_cast: {
    name: 'Belut di Sela Buluh',
    desc: 'Pancing seekor ikan dari perairan Rawa Mirefen.',
  },
};
