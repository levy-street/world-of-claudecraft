// Deed name / desc / title locale table for pl_PL (data-as-code, size-exempt).
// One per-base-locale chunk behind DEED_LOCALE_LOADERS in deed_i18n.ts, so a
// visitor downloads only their own locale's deed strings. Split verbatim from
// the former deed_i18n.newlocales.ts single chunk; values carry no em or en
// dashes (repo copy rule). English (en / en_CA) resolves to the authored
// source before this table is consulted.
import type { DeedLocaleTable } from '../deed_i18n';

export const table: DeedLocaleTable = {
  pvp_card_duel_first_win: {
    name: 'Zasady Domu',
    desc: 'Wygraj Pojedynek Karciany u Mistrza Kart.',
  },
  prog_first_steps: {
    name: 'Pierwsze Kroki',
    desc: 'Osiągnij poziom 2 i postaw pierwszy krok na długiej drodze.',
  },
  prog_finding_your_feet: {
    name: 'Pewny Grunt',
    desc: 'Osiągnij poziom 5; dzicz wydaje się już odrobinę mniejsza.',
  },
  prog_double_digits: { name: 'Dwie Cyfry', desc: 'Osiągnij poziom 10 i odblokuj swoje talenty.' },
  prog_the_long_middle: { name: 'Długi Środek Drogi', desc: 'Osiągnij poziom 15.' },
  prog_level_cap: { name: 'Widok ze Szczytu', desc: 'Osiągnij poziom 20, maksymalny poziom.' },
  prog_well_rested: {
    name: 'Dobrze Wypoczęty',
    desc: 'Zatrzymaj się w gospodzie, aż zdobędziesz doświadczenie za wypoczynek.',
  },
  prog_talented: { name: 'Dobrze Wydany Punkt', desc: 'Wydaj swój pierwszy punkt talentu.' },
  prog_specialized: {
    name: 'Deklaracja Zamiarów',
    desc: 'Wybierz specjalizację i naucz się jej sztandarowej zdolności.',
  },
  prog_deep_roots: {
    name: 'Głębokie Korzenie',
    desc: 'Wydaj punkt talentu na talent z ostatniego rzędu.',
  },
  prog_full_build: {
    name: 'Pełna Szóstka',
    desc: 'Wybierz po jednej opcji we wszystkich sześciu rzędach talentów w jednej konfiguracji.',
  },
  prog_veteran: {
    name: 'Weteran',
    desc: 'Zdobądź łącznie 250 000 punktów doświadczenia.',
    title: 'Weteran',
  },
  prog_champion: {
    name: 'Mistrz',
    desc: 'Zdobądź łącznie 500 000 punktów doświadczenia.',
    title: 'Mistrz',
  },
  prog_paragon: {
    name: 'Wzór cnót',
    desc: 'Zdobądź łącznie 1 000 000 punktów doświadczenia.',
    title: 'Wzór cnót',
  },
  prog_mythic: {
    name: 'Mityczny',
    desc: 'Zdobądź łącznie 2 500 000 punktów doświadczenia.',
    title: 'Mityczny',
  },
  prog_eternal: {
    name: 'Wieczny',
    desc: 'Zdobądź łącznie 5 000 000 punktów doświadczenia.',
    title: 'Wieczny',
  },
  prog_prestige: {
    name: 'Od Nowa',
    desc: 'Osiągnij maksymalny poziom, zapełnij pasek raz jeszcze i odbierz rangę prestiżu 1.',
  },
  prog_prestige_5: { name: 'Stare Nawyki', desc: 'Osiągnij rangę prestiżu 5.' },
  prog_prestige_10: { name: 'Perpetuum Mobile', desc: 'Osiągnij rangę prestiżu 10.' },
  prog_first_harvest: {
    name: 'Plony Pola',
    desc: 'Zbierz plon ze swojego pierwszego źródła surowców.',
  },
  prog_mining_100: { name: 'Ruda we Krwi', desc: 'Osiągnij 100 biegłości w Górnictwie.' },
  prog_logging_100: { name: 'Rębacz Twardzieli', desc: 'Osiągnij 100 biegłości w Drwalnictwie.' },
  prog_herbalism_100: { name: 'Mistrz Łąk', desc: 'Osiągnij 100 biegłości w Zielarstwie.' },
  prog_master_gatherer: {
    name: 'Mistrz Zbieractwa',
    desc: 'Osiągnij 100 biegłości w Górnictwie, Drwalnictwie i Zielarstwie.',
  },
  prog_first_craft: { name: 'Własnoręczna Robota', desc: 'Ukończ swój pierwszy udany wyrób.' },
  prog_craft_specialist: {
    name: 'Tajniki Fachu',
    desc: 'Osiągnij 75 umiejętności w dowolnym rzemiośle i odblokuj atuty jego specjalizacji.',
  },
  prog_around_the_ring: {
    name: 'Dookoła Kręgu',
    desc: 'Osiągnij 25 umiejętności w pięciu różnych rzemiosłach.',
  },
  cmb_first_blood: { name: 'Pierwsza Krew', desc: 'Pokonaj swojego pierwszego wroga.' },
  cmb_slayer: { name: 'Pogromca', desc: 'Pokonaj 1000 wrogów.' },
  cmb_legion_of_one: { name: 'Jednoosobowy Legion', desc: 'Pokonaj 10 000 wrogów.' },
  cmb_heavy_hitter: { name: 'Ciężka Ręka', desc: 'Zadaj łącznie 500 000 obrażeń.' },
  cmb_critical_eye: { name: 'Krytyczne Oko', desc: 'Zadaj 500 trafień krytycznych.' },
  cmb_giantslayer: {
    name: 'Pogromca Olbrzymów',
    desc: 'Zadaj ostateczny cios wrogowi o co najmniej pięć poziomów wyższemu od ciebie.',
  },
  cmb_first_fall: {
    name: 'Otrzep Się i Wstań',
    desc: 'Zgiń po raz pierwszy; zdarza się najlepszym.',
  },
  dgn_hollow_crypt: {
    name: 'Łamacz Krypt',
    desc: 'Pokonaj Morthena Grobowego Wołacza w Wydrążonej Krypcie.',
  },
  dgn_sunken_bastion: {
    name: 'Fogbinder Rozpętany',
    desc: 'Pokonaj Vaela Fogbindera w Zatopionym Bastionie.',
  },
  dgn_drowned_temple: {
    name: 'Utopić Księżyc',
    desc: 'Pokonaj Ysolei, Awatara Utopionego Księżyca, w Zatopionej Świątyni.',
  },
  dgn_gravewyrm_sanctum: {
    name: 'Żmij z Głębin',
    desc: 'Pokonaj Korzula Grobowego Żmija w Sanktuarium Grobowego Żmija.',
  },
  dgn_hollow_crypt_heroic: {
    name: 'Heroiczna: Wydrążona Krypta',
    desc: 'Pokonaj Morthena Grobowego Wołacza w Wydrążonej Krypcie na heroicznym poziomie trudności.',
  },
  dgn_sunken_bastion_heroic: {
    name: 'Heroiczny: Zatopiony Bastion',
    desc: 'Pokonaj Vaela Fogbindera w Zatopionym Bastionie na heroicznym poziomie trudności.',
  },
  dgn_drowned_temple_heroic: {
    name: 'Heroiczna: Zatopiona Świątynia',
    desc: 'Pokonaj Ysolei, Awatara Utopionego Księżyca, w Zatopionej Świątyni na heroicznym poziomie trudności.',
  },
  dgn_gravewyrm_sanctum_heroic: {
    name: 'Heroiczne: Sanktuarium Grobowego Żmija',
    desc: 'Pokonaj Korzula Grobowego Żmija w Sanktuarium Grobowego Żmija na heroicznym poziomie trudności.',
  },
  dgn_nythraxis: {
    name: 'Koniec Plagi',
    desc: 'Pokonaj Nythraxisa, Plagę Ciernistego Szczytu, za zapieczętowanymi królewskimi wrotami.',
  },
  dgn_nythraxis_heroic: {
    name: 'Heroiczny: Koniec Plagi',
    desc: 'Pokonaj Nythraxisa, Plagę Ciernistego Szczytu, na heroicznym poziomie trudności.',
  },
  dgn_thornpeak_rounds: {
    name: 'Wielki Obchód',
    desc: 'Oczyść Wydrążoną Kryptę, Zatopiony Bastion, Zatopioną Świątynię i Sanktuarium Grobowego Żmija.',
  },
  dgn_deepward: {
    name: 'Strażnik Głębin',
    desc: 'Zdobądź każdy loch, rajd i obie wyprawy na heroicznym poziomie trudności.',
  },
  dgn_mark_circuit: {
    name: 'Pełny Obieg',
    desc: 'Zdobądź znaki heroiczne ze wszystkich czterech heroicznych lochów w ciągu jednego dnia.',
  },
  dgn_boss_clears_50: {
    name: 'Za Pięćdziesiątymi Drzwiami',
    desc: 'Pokonaj 50 finałowych bossów lochów.',
  },
  dgn_morthen_flawless: {
    name: 'Poszło Jak po Kościach',
    desc: 'Pokonaj Morthena Grobowego Wołacza na heroicznym poziomie trudności tak, by nikt z drużyny nie zginął.',
  },
  dgn_morthen_trio: {
    name: 'W Trójkę Przeciw Mogile',
    desc: 'Pokonaj Morthena Grobowego Wołacza w składzie liczącym najwyżej trzech graczy.',
  },
  dgn_olen_arc: {
    name: 'Wymiń Żniwiarza',
    desc: 'Pokonaj Komandora Rycerzy Olena tak, by jego Kosiący łuk nie trafił nikogo poza jego bieżącym celem.',
  },
  dgn_vael_thralls: {
    name: 'Niczyj Niewolnik',
    desc: 'Pokonaj Vaela Fogbindera, gdy wszyscy przyzwani przez niego Utopieni Niewolnicy zostali już zgładzeni.',
  },
  dgn_ysolei_moonspawn: {
    name: 'Pomioty, Co do Jednego',
    desc: 'Pokonaj Ysolei, gdy wszystkie przyzwane przez nią Księżycowe Pomioty zostały już zgładzone.',
  },
  dgn_ysolei_flawless: {
    name: 'Suche Oczy',
    desc: 'Pokonaj Ysolei, Awatara Utopionego Księżyca, na heroicznym poziomie trudności tak, by nikt z drużyny nie zginął.',
  },
  dgn_velkhar_bonewalkers: {
    name: 'Zostańcie w Grobach',
    desc: 'Pokonaj Wielkiego Nekromantę Velkhara tak, by każdy Wskrzeszony Kościochód został zniszczony, zanim on sam padnie.',
  },
  dgn_korzul_flawless: {
    name: 'Żmijobójca',
    desc: 'Pokonaj Korzula Grobowego Żmija na heroicznym poziomie trudności tak, by nikt z drużyny nie zginął.',
    title: 'Żmijobójca',
  },
  dgn_sanctum_speed: {
    name: 'Sprint przez Sanktuarium',
    desc: 'Pokonaj Korzula Grobowego Żmija w ciągu 15 minut od zajęcia Sanktuarium Grobowego Żmija przez twoją drużynę.',
  },
  dgn_nythraxis_gravebreaker: {
    name: 'Przed Królem Nie Klękamy',
    desc: 'Pokonaj Nythraxisa tak, by Grobołam nie trafił nikogo poza jego bieżącym celem.',
  },
  dgn_nythraxis_wardens: {
    name: 'Strażnicy Kamieni Ochronnych',
    desc: 'Pokonaj Nythraxisa tak, by każdy Nieśmiertelny Szał został przerwany, zanim uderzy.',
  },
  dgn_nythraxis_deathless: {
    name: 'Nikt Bardziej Nieśmiertelny',
    desc: 'Pokonaj Nythraxisa, Plagę Ciernistego Szczytu, na heroicznym poziomie trudności tak, by ani jeden rajdowiec nie zginął.',
    title: 'Nieśmiertelny',
  },
  cmb_thunzharr: {
    name: 'Góra Runęła',
    desc: 'Powal Thunzharra, Budzący się Szczyt, przy Burzowej Turni.',
  },
  cmb_thunzharr_unbroken: {
    name: 'Łamacz Szczytów',
    desc: 'Powal Thunzharra, Budzący się Szczyt, nie ginąc od twojego pierwszego ciosu aż po jego ostatni oddech.',
    title: 'Łamacz Szczytów',
  },
  cmb_thunzharr_ten: {
    name: 'Górski Nawyk',
    desc: 'Powal Thunzharra, Budzący się Szczyt, dziesięć razy.',
  },
  dlv_reliquary: { name: 'Goniec z Relikwiarza', desc: 'Oczyść Zawalony Relikwiarz.' },
  dlv_reliquary_heroic: {
    name: 'Heroiczny: Zawalony Relikwiarz',
    desc: 'Oczyść Zawalony Relikwiarz na poziomie heroicznym.',
  },
  dlv_litany: { name: 'Uciszyć Litanię', desc: 'Oczyść Utopioną Litanię.' },
  dlv_litany_heroic: {
    name: 'Heroiczna: Utopiona Litania',
    desc: 'Oczyść Utopioną Litanię na poziomie heroicznym.',
  },
  dlv_lore_journal: {
    name: 'Marginalia',
    desc: 'Odblokuj wszystkie pięć wpisów w dzienniku wypraw.',
  },
  dlv_companion_max: {
    name: 'Prawdziwych przyjaciół poznaje się w głębinie',
    desc: 'Doprowadź towarzyszkę wypraw do najwyższej rangi.',
  },
  dlv_companions_both: {
    name: 'Obie latarnie płoną',
    desc: 'Doprowadź obie towarzyszki wypraw, Akolitkę Tessę i Eddę Trzcinoręką, do najwyższej rangi.',
  },
  dlv_clears_50: { name: 'Pięćdziesiąt sążni', desc: 'Ukończ 50 wypraw.' },
  dlv_solo_heroic: {
    name: 'Dwoje to już tłum',
    desc: 'Oczyść wyprawę na poziomie heroicznym bez żadnego innego gracza, tylko ty i twoja towarzyszka.',
  },
  dlv_tumbler_premium: {
    name: 'Ścieżka Zastawek, opanowana',
    desc: 'Otwórz strzeżoną skrzynię relikwiarza przy najwyższej stawce, bezbłędnie i za jednym jedynym podejściem.',
  },
  dlv_rite_flawless: {
    name: 'Co do słowa',
    desc: 'Ukończ Obrzęd Utopionego Relikwiarza, nie popełniając ani jednego błędu.',
  },
  dlv_varric_ringers: {
    name: 'Dzwony milkną',
    desc: 'Pokonaj Diakona Varrica tak, aby każdy wskrzeszony przez niego Pogrzebowy Dzwonnik poległ przed nim.',
  },
  dlv_nhalia_bells: {
    name: 'Uciszyciel Dzwonów',
    desc: 'Pokonaj Siostrę Nhalię, Utopiony Kantyk, nie pozwalając, by Bijący Dzwon trafił kogokolwiek z drużyny.',
    title: 'Uciszyciel Dzwonów',
  },
  chr_vale_chapter_i: {
    name: 'Kronika Doliny, rozdział I',
    desc: 'Ukończ pierwszy rozdział kroniki Saula: pierwsze posługi w Eastbrook, rozeznanie w Dolinie i pierwszy smak tutejszych rzemiosł.',
  },
  chr_vale_chapter_ii: {
    name: 'Kronika Doliny, rozdział II',
    desc: 'Ukończ drugi rozdział kroniki Saula: wytęp bandytów, murloki i kopalniane szkodniki, rozegraj mecz na Maciorowym Błoniu i staw czoła Relikwiarzowi.',
  },
  chr_vale_chapter_iii: {
    name: 'Kronika Doliny',
    desc: 'Doprowadź historię Doliny do końca: Grobowy Wołacz zdemaskowany, Wydrążona Krypta oczyszczona, a każda z osławionych zgróz Doliny powalona.',
    title: 'z Doliny',
  },
  chr_vale_gatherer: {
    name: 'Z darów ziemi',
    desc: 'Pozyskaj żyłę rudy, drzewostan i kępę ziół w Dolinie Wschodniego Strumienia.',
  },
  chr_vale_first_cast: {
    name: 'Coś siedzi w Jeziorze Lustrzanym',
    desc: 'Złów rybę w wodach Doliny Wschodniego Strumienia.',
  },
  chr_vale_packbreaker: { name: 'Pogromca Watahy', desc: 'Zabij 3 Leśne Wilki w ciągu 10 sekund.' },
  chr_vale_cup_debut: {
    name: 'Pretendent do Miedzianego Wiadra',
    desc: 'Wyjdź na boisko i dotknij piłki w meczu Pucharu Doliny na Maciorowym Błoniu.',
  },
  chr_vale_rares: {
    name: 'Zgrozy Doliny',
    desc: 'Zabij pięć osławionych zgróz Doliny Wschodniego Strumienia: Starego Szaropaszczego, Moggera, Grixa Tunelowego Króla, Kapitana Verlana i Widmowiąża Maldreca.',
  },
  chr_marsh_chapter_i: {
    name: 'Kronika Trzęsawiska, rozdział I',
    desc: 'Ukończ pierwszy rozdział kroniki Osrica Fenna: odpowiedz na zbiórkę przy Moście na Trzęsawisku, zabezpiecz groblę i poznaj kształt mokradeł.',
  },
  chr_marsh_chapter_ii: {
    name: 'Kronika Trzęsawiska, rozdział II',
    desc: 'Ukończ drugi rozdział kroniki Osrica Fenna: wypal gniazda wdów, złóż utopionych na spoczynek, wyciągnij Dorsznego Ojca z wody i staw czoła Litanii.',
  },
  chr_marsh_chapter_iii: {
    name: 'Kronika Mokrzawia',
    desc: 'Doprowadź historię mokradeł do końca: obóz kultu rozbity, Fogbinder uciszony w Zatopionym Bastionie, a każda z osławionych zgróz mgły powalona.',
    title: 'z Mokrzawia',
  },
  chr_marsh_gatherer: {
    name: 'Bagienne zbiory',
    desc: 'Pozyskaj żyłę rudy, drzewostan i kępę ziół na Trzęsawisku Mokrzawia.',
  },
  chr_marsh_unburst: {
    name: 'Nie stój w zarodnikach',
    desc: 'Zabij 8 Bagiennych obrzęklaków i ani razu nie daj się złapać w wybuch ich Żrących Zarodników.',
  },
  chr_marsh_hush_the_mending: {
    name: 'Najpierw uzdrowiciel',
    desc: 'W Obozowisku Grobowych Przyzywaczy zabij Grobowego Uzdrowiciela, zanim zginie którykolwiek z kultystów pod jego opieką.',
  },
  chr_marsh_rares: {
    name: 'Imiona we mgle',
    desc: 'Zabij trzy osławione zgrozy Trzęsawiska Mokrzawia: Bagnopaszczego Nienasyconego, Mulzęba Utopionego i Siostrę Nhalię.',
  },
  chr_peaks_chapter_i: {
    name: 'Kronika Wyżyn, rozdział I',
    desc: 'Ukończ pierwszy rozdział kroniki Zenzie: oczyść trakt na grani, opróżnij nory i poznaj każdą ścieżkę, której strzeże Wysoka Strażnica.',
  },
  chr_peaks_chapter_ii: {
    name: 'Kronika Wyżyn, rozdział II',
    desc: 'Ukończ drugi rozdział kroniki Zenzie: rozbij Obóz Wojenny Drogmara, odczytaj budzącą się burzę i stań tam, gdzie jarzy się Migotliwa Toń.',
  },
  chr_peaks_chapter_iii: {
    name: 'Kronika Ciernistego Szczytu',
    desc: 'Doprowadź historię góry do końca: Kult Żmija rozbity, Sanktuarium uciszone, Budzący się Szczyt powalony, a każda z osławionych zgróz turni pokonana.',
    title: 'z Ciernistego Szczytu',
  },
  chr_peaks_sparring: {
    name: 'Musztra na murach',
    desc: 'Zadaj łącznie 1000 punktów obrażeń manekinowi treningowemu nad Wysoką Strażnicą.',
  },
  chr_peaks_glimmer_cast: {
    name: 'Zimna woda, zimniejsze światło',
    desc: 'Złów rybę z Migotliwej Toni.',
  },
  chr_peaks_moongate: {
    name: 'Przez zimną bramę',
    desc: 'Przejdź przez księżycową bramę na brzegu Migotliwej Toni.',
  },
  chr_peaks_waking_witness: {
    name: 'Góra, która chodzi',
    desc: 'Ujrzyj na własne oczy Thunzharra, Budzący się Szczyt, gdy przemierza górę.',
  },
  chr_peaks_rares: {
    name: 'Imiona wyryte w skale',
    desc: 'Zabij cztery osławione zgrozy Wyżyn Ciernistego Szczytu: Sztygara z Żelaznej Żyły, Brutoka Czaszkokrusza, Voskara Żaroskrzydłego i Szpikowładcę Varkasa.',
  },
  col_discovery_25: {
    name: 'Chomik',
    desc: 'Odkryj 25 różnych przedmiotów (przedmiot liczy się, gdy po raz pierwszy trafi w twoje posiadanie).',
  },
  col_discovery_75: { name: 'Sroka', desc: 'Odkryj 75 różnych przedmiotów.' },
  col_discovery_150: {
    name: 'Gabinet osobliwości',
    desc: 'Odkryj 150 różnych przedmiotów.',
    title: 'Kustosz',
  },
  col_discovery_250: { name: 'Wielki katalog', desc: 'Odkryj 250 różnych przedmiotów.' },
  col_first_rare: {
    name: 'Coś niebieskiego',
    desc: 'Zdobądź swój pierwszy przedmiot rzadkiej jakości.',
  },
  col_first_epic: {
    name: 'Zrodzony w purpurze',
    desc: 'Zdobądź swój pierwszy przedmiot epickiej jakości.',
  },
  col_first_legendary: {
    name: 'Szczęście w kolorze pomarańczy',
    desc: 'Zdobądź swój pierwszy przedmiot legendarnej jakości.',
  },
  col_set_vale_arcanist: {
    name: 'Regalia Arkanisty z Doliny',
    desc: 'Odkryj każdą część Regaliów Arkanisty z Doliny.',
  },
  col_set_boundstone_vanguard: {
    name: 'Awangarda Spętanego Kamienia',
    desc: 'Odkryj każdą część Awangardy Spętanego Kamienia.',
  },
  col_set_greyjaw_stalker: {
    name: 'Oporządzenie Tropiciela Szaroszczękiego',
    desc: 'Odkryj każdą część Oporządzenia Tropiciela Szaroszczękiego.',
  },
  col_set_deathlord: {
    name: 'Rynsztunek Bojowy Barrowlorda',
    desc: 'Odkryj każdą część Rynsztunku Bojowego Barrowlorda.',
  },
  col_set_wyrmshadow: { name: 'Szaty Nightfang', desc: 'Odkryj każdą część Szat Nightfang.' },
  col_set_necromancers: {
    name: 'Odzienie Mournweave',
    desc: 'Odkryj każdą część Odzienia Mournweave.',
  },
  col_set_crownforged: {
    name: 'Regalia Bonewrought',
    desc: 'Odkryj każdą część Regaliów Bonewrought.',
  },
  col_set_nighttalon: { name: 'Futro Direfang', desc: 'Odkryj każdą część Futra Direfang.' },
  col_set_soulflame: {
    name: 'Regalia Wraithfire',
    desc: 'Odkryj każdą część Regaliów Wraithfire.',
  },
  col_set_stormcallers: { name: 'Szaty Galecall', desc: 'Odkryj każdą część Szat Galecall.' },
  col_seven_regalia: {
    name: 'Siedmioraka garderoba',
    desc: 'Odkryj każdą część wszystkich siedmiu epickich rodzin pancerzy.',
    title: 'Olśniewający',
  },
  col_true_colors: {
    name: 'Prawdziwe barwy',
    desc: 'Stań do boju w dowolnym wyglądzie innym niż domyślny dla twojej klasy.',
  },
  col_all_slots: {
    name: 'Wystrojony na jedenastkę',
    desc: 'Miej jednocześnie założony przedmiot w każdym z jedenastu miejsc ekwipunku.',
  },
  col_quartermaster_buyout: {
    name: 'Stały klient',
    desc: 'Odkryj wszystkie dziesięć przedmiotów z zapasów Kwatermistrza Vexa.',
  },
  col_glimmerfin: { name: 'Promyk nadziei', desc: 'Złów Lśniącopłetwego karpia koi.' },
  col_full_creel: {
    name: 'Pełen kosz',
    desc: 'Odkryj wszystkie sześć pospolitych ryb z wód Doliny, Trzęsawiska i Wyżyn.',
  },
  col_junk_drawer: {
    name: 'Szuflada z rupieciami',
    desc: 'Odkryj 10 różnych przedmiotów lichej jakości.',
  },
  pvp_arena_first_match: {
    name: 'Piasek w butach',
    desc: 'Stocz rankingowe starcie w Popielnym Koloseum, w dowolnej z lig.',
  },
  pvp_arena_first_win: {
    name: 'Ryk trybun',
    desc: 'Wygraj rankingowe starcie na arenie, w dowolnej z lig.',
  },
  pvp_arena_1v1_1600: {
    name: 'Pretendent Koloseum',
    desc: 'Osiągnij 1600 punktów rankingowych w arenowej lidze 1v1.',
  },
  pvp_arena_1v1_1750: {
    name: 'Rywal Koloseum',
    desc: 'Osiągnij 1750 punktów rankingowych w arenowej lidze 1v1.',
  },
  pvp_arena_1v1_1900: {
    name: 'Gladiator',
    desc: 'Osiągnij 1900 punktów rankingowych w arenowej lidze 1v1.',
    title: 'Gladiator',
  },
  pvp_arena_2v2_1600: {
    name: 'W dwójce siła',
    desc: 'Osiągnij 1600 punktów rankingowych w arenowej lidze 2v2.',
  },
  pvp_arena_2v2_1750: {
    name: 'Groźny duet',
    desc: 'Osiągnij 1750 punktów rankingowych w arenowej lidze 2v2.',
  },
  pvp_arena_2v2_1900: {
    name: 'Zgranie doskonałe',
    desc: 'Osiągnij 1900 punktów rankingowych w arenowej lidze 2v2.',
  },
  pvp_duel_first_win: { name: 'Załatwmy to na zewnątrz', desc: 'Wygraj pojedynek.' },
  pvp_duel_grace: {
    name: 'Lekcja pokory',
    desc: 'Przegraj pojedynek, ocalając niemal całą godność.',
  },
  pvp_vcup_first_match: {
    name: 'Buty na murawie',
    desc: 'Rozegraj pełny mecz Pucharu Doliny na Maciorowym Błoniu, wygrany czy przegrany.',
  },
  pvp_vcup_first_win: { name: 'Pierwsze trofeum', desc: 'Wygraj rankingowy mecz Pucharu Doliny.' },
  pvp_vcup_wins_10: {
    name: 'Wyjadacz dziczego balonu',
    desc: 'Wygraj 10 rankingowych meczów Pucharu Doliny.',
  },
  pvp_vcup_wins_25: {
    name: 'Legenda dziczego balonu',
    desc: 'Wygraj 25 rankingowych meczów Pucharu Doliny.',
    title: 'Legenda dziczego balonu',
  },
  pvp_vcup_first_goal: {
    name: 'Na listę strzelców',
    desc: 'Zdobądź gola w rankingowym meczu Pucharu Doliny.',
  },
  pvp_vcup_hat_trick: {
    name: 'Bohater hat-tricka',
    desc: 'Zdobądź trzy gole w jednym rankingowym meczu Pucharu Doliny, w lidze 3v3 lub większej.',
  },
  pvp_vcup_golden_goal: {
    name: 'Złota chwila',
    desc: 'Strzel złotego gola, który rozstrzyga rankingowy mecz Pucharu Doliny.',
  },
  pvp_vcup_first_save: {
    name: 'Pewne ręce',
    desc: 'Obroń strzał jako bramkarz w rankingowym meczu Pucharu Doliny.',
  },
  pvp_vcup_clean_sheet: {
    name: 'Mur nie do przebicia',
    desc: 'Wygraj rankingowy mecz Pucharu Doliny jako bramkarz, nie wpuszczając ani jednego gola.',
  },
  pvp_vcup_guild_win: {
    name: 'Za sztandar!',
    desc: 'Wygraj rankingowy mecz Pucharu Doliny, grając pod sztandarem swojej gildii.',
  },
  pvp_fiesta_first_bout: {
    name: 'Nieproszony gość',
    desc: 'Stocz pełne starcie Fiesty 2v2, wygrane czy przegrane.',
  },
  pvp_fiesta_first_win: { name: 'Dusza Fiesty', desc: 'Wygraj starcie Fiesty 2v2.' },
  pvp_fiesta_double: {
    name: 'Podwójny kłopot',
    desc: 'Zalicz dwa powalenia w Fieście w ciągu czterech sekund.',
  },
  pvp_fiesta_shutdown: {
    name: 'Koniec imprezy',
    desc: 'Powal w Fieście przeciwnika, który ma serię trzech lub więcej powaleń.',
  },
  pvp_fiesta_full_build: {
    name: 'Strój na okazję',
    desc: 'Wygraj starcie Fiesty, mając zatwierdzone ulepszenie z każdej z trzech fal.',
  },
  pvp_fiesta_powerups: {
    name: 'Po jednym z każdego',
    desc: 'Podnieś przynajmniej raz każde z czterech wzmocnień ringu: Demona Prędkości, Kolosa, Księżycowe Buty i Berserkera.',
  },
  pvp_fiesta_five_kills: {
    name: 'Cała impreza na barkach',
    desc: 'Zalicz pięć powaleń w jednym starciu Fiesty.',
  },
  soc_first_party: { name: 'Razem raźniej', desc: 'Dołącz do drużyny z innym graczem.' },
  soc_full_house: { name: 'Pełen skład', desc: 'Ukończ loch w pełnej, pięcioosobowej drużynie.' },
  soc_guild_joined: { name: 'Pod jednym sztandarem', desc: 'Zostań członkiem gildii.' },
  soc_guild_founded: { name: 'Pióro założyciela', desc: 'Załóż własną gildię.' },
  soc_first_trade: { name: 'Uczciwa wymiana', desc: 'Dokonaj wymiany z innym graczem.' },
  soc_first_sale: {
    name: 'Otwarcie interesu',
    desc: 'Odbierz monety ze swojej pierwszej sprzedaży na Światowym Rynku.',
  },
  soc_steady_custom: {
    name: 'Stały utarg',
    desc: 'Zgromadź łącznie 10 sztuk złota ze swoich sprzedaży na Światowym Rynku.',
  },
  soc_market_magnate: {
    name: 'Magnat rynku',
    desc: 'Zgromadź łącznie 100 sztuk złota ze swoich sprzedaży na Światowym Rynku.',
    title: 'Magnat',
  },
  soc_by_ravens_wing: {
    name: 'Na kruczych skrzydłach',
    desc: 'Wyślij Kruczą Pocztą list z monetami lub paczką.',
  },
  soc_room_for_more: {
    name: 'Miejsce się znajdzie',
    desc: 'Kup swoje pierwsze rozszerzenie skarbca.',
  },
  soc_gilded_strongbox: {
    name: 'Złocona Szkatuła',
    desc: 'Wykup każde rozszerzenie skarbca, jakie tylko skarbnicy zgodzą się ci sprzedać.',
  },
  soc_meet_bursar: {
    name: 'Ufamy Fernandowi',
    desc: 'Złóż uszanowanie Skarbnikowi Fernandowi, opiekunowi Złoconej Szkatuły w Eastbrook.',
  },
  soc_pocket_money: {
    name: 'Kieszonkowe',
    desc: 'Zdobądź z łupów łącznie 1 sztukę złota w monetach.',
  },
  soc_heavy_purse: {
    name: 'Ciężka sakiewka',
    desc: 'Zdobądź z łupów łącznie 10 sztuk złota w monetach.',
  },
  soc_wyrms_hoard: {
    name: 'Skarb żmija',
    desc: 'Zdobądź z łupów łącznie 100 sztuk złota w monetach.',
  },
  soc_civic_duty: {
    name: 'Obywatelski obowiązek',
    desc: 'Przydziel swój pierwszy punkt rozwoju miasta.',
  },
  exp_long_road_north: {
    name: 'Długa droga na północ',
    desc: 'Odwiedź wszystkie trzy główne osady: Eastbrook, Most na Trzęsawisku i Wysoką Strażnicę.',
  },
  exp_vale_wayfarer: {
    name: 'Wędrowiec Doliny',
    desc: 'Odwiedź wszystkie jedenaście nazwanych miejsc Doliny Wschodniego Strumienia.',
  },
  exp_marsh_wayfarer: {
    name: 'Wędrowiec Trzęsawiska',
    desc: 'Odwiedź wszystkie osiem nazwanych miejsc Trzęsawiska Mokrzawia.',
  },
  exp_peaks_wayfarer: {
    name: 'Wędrowiec Wyżyn',
    desc: 'Odwiedź wszystkie dziesięć nazwanych miejsc Wyżyn Ciernistego Szczytu.',
  },
  exp_world_traveler: {
    name: 'Obieżyświat',
    desc: 'Zdobądź czyn wędrowca każdej z trzech krain.',
    title: 'Wędrowiec',
  },
  exp_something_shiny: { name: 'Błyskotka', desc: 'Podnieś z ziemi migoczący przedmiot.' },
  exp_first_ore: {
    name: 'Kilofem w ziemię!',
    desc: 'Wydobądź surowce ze swojego pierwszego złoża rudy.',
  },
  exp_first_timber: { name: 'Uwaga, drzewo!', desc: 'Pozyskaj swoje pierwsze stanowisko drewna.' },
  exp_first_herb: { name: 'Ręka do zieleni', desc: 'Zbierz swoją pierwszą kępę ziół.' },
  feat_era_cap: {
    name: 'Dziecię Pierwszej Ery',
    desc: 'Poziom 20 osiągnięty, gdy trwała jeszcze Pierwsza Era.',
  },
  feat_book_complete: { name: 'Od deski do deski', desc: 'Zdobądź każdy czyn w Księdze Czynów.' },
  feat_brightwood_relic: {
    name: 'Pamięci Jasnego Boru',
    desc: 'Zachowaj relikt dawnego Jasnego Boru: Kaftan z ciernistej skóry lub Koronę monarchy.',
  },
  hid_saul_footnote: {
    name: 'Przypis do historii',
    desc: 'Saul Kronikarz zniósł od ciebie dziewięć zaczepek bez chwili przerwy.',
    title: 'Przypis',
  },
  hid_gilded_tour: {
    name: 'Złocona wycieczka',
    desc: 'Interesy załatwione we wszystkich trzech oddziałach Złoconej Szkatuły.',
  },
  hid_fall_death: {
    name: 'Grawitacja zawsze wygrywa',
    desc: 'Śmierć po długiej rozmowie z ziemią.',
  },
  hid_keepers_toll_twice: {
    name: 'Strażnik pobiera dwa razy',
    desc: 'Śmierć, gdy Myto Strażnika wciąż na tobie ciążyło.',
  },
  hid_roll_hundred: { name: 'Czysta setka', desc: 'Wyrzucone idealne 100 na zwykłym /roll.' },
  hid_yumi_cheer: {
    name: 'Fanklub Yumi',
    desc: 'Wiwaty dla Yumi w samym środku walki, tam gdzie mogła cię usłyszeć.',
  },
  hid_bountiful_coffer: {
    name: 'Purpurowy kufer',
    desc: 'Obfity Kufer rozpracowany, nim zdążył się zaciąć.',
  },
  hid_companion_save: {
    name: 'Nie na jej warcie',
    desc: 'Twoja towarzyszka wyprawy postawiła powalonego kompana z powrotem na nogi.',
  },
  hid_codfather: {
    name: 'Witamy w rodzinie',
    desc: 'Dorszny Ojciec wyciągnięty z Płycizn Głębokiego Trzęsawiska.',
  },
  prog_crown_below: {
    name: 'Korona w Głębi',
    desc: 'Podążaj za koroną od niespokojnych pól kości aż do grobowca króla Nythraxisa i doprowadź Kres Plagi do końca.',
  },
  prog_mere_at_rest: {
    name: 'Toń Ukojona',
    desc: "Dotrwaj do końca warty Ondrela Vane'a: chór uciszony, Bladozwój zgładzony, a Utopiony Księżyc złożony do snu.",
  },
  prog_callused_hands: {
    name: 'Spracowane Dłonie',
    desc: 'Ukończ Fach dla Każdej Ręki i zarób pierwszy odcisk w fachach Eastbrook.',
  },
  prog_tools_of_the_trade: {
    name: 'Narzędzia Fachu',
    desc: 'Ukończ wytwarzanie wymagające stanowiska w rzemieślniczym zapleczu Wysokiej Strażnicy.',
  },
  dgn_nythraxis_crypt: {
    name: 'Co Kryła Krypta',
    desc: 'Zapuść się do Opuszczonej Krypty i odzyskaj od jej strażników obie połowy zwornika oraz starożytny pamiętnik.',
  },
  chr_marsh_first_cast: {
    name: 'Węgorze w trzcinach',
    desc: 'Złów rybę w wodach Trzęsawiska Mokrzawia.',
  },
};
