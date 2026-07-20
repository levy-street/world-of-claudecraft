// Deed name / desc / title locale table for cs_CZ (data-as-code, size-exempt).
// One per-base-locale chunk behind DEED_LOCALE_LOADERS in deed_i18n.ts, so a
// visitor downloads only their own locale's deed strings. Split verbatim from
// the former deed_i18n.newlocales.ts single chunk; values carry no em or en
// dashes (repo copy rule). English (en / en_CA) resolves to the authored
// source before this table is consulted.
import type { DeedLocaleTable } from '../deed_i18n';

export const table: DeedLocaleTable = {
  pvp_card_duel_first_win: {
    name: 'Vlastní pravidla',
    desc: 'Vyhraj Karetní souboj u Karetního mistra.',
  },
  prog_first_steps: {
    name: 'První kroky',
    desc: 'Dosáhni úrovně 2 a udělej první krok na dlouhé cestě.',
  },
  prog_finding_your_feet: {
    name: 'Pevná půda pod nohama',
    desc: 'Dosáhni úrovně 5; divočina už vypadá o kousek menší.',
  },
  prog_double_digits: { name: 'Dvě cifry', desc: 'Dosáhni úrovně 10 a odemkni své talenty.' },
  prog_the_long_middle: { name: 'Dlouhý střed cesty', desc: 'Dosáhni úrovně 15.' },
  prog_level_cap: { name: 'Výhled z vrcholu', desc: 'Dosáhni úrovně 20, nejvyšší možné úrovně.' },
  prog_well_rested: {
    name: 'Dobře odpočatý',
    desc: 'Usaď se v hostinci, dokud nezískáš odpočaté zkušenosti.',
  },
  prog_talented: { name: 'Dobře vynaložený bod', desc: 'Utrať svůj první talentový bod.' },
  prog_specialized: {
    name: 'Vyhlášení záměru',
    desc: 'Zvol si specializaci a nauč se její stěžejní schopnost.',
  },
  prog_deep_roots: {
    name: 'Hluboké kořeny',
    desc: 'Utrať talentový bod za talent z poslední řady.',
  },
  prog_full_build: {
    name: 'Plná šestka',
    desc: 'Vyber jednu možnost ve všech šesti řadách talentů v jedné sestavě.',
  },
  prog_veteran: {
    name: 'Veterán',
    desc: 'Získej za celý život 250 000 zkušeností.',
    title: 'Veterán',
  },
  prog_champion: {
    name: 'Šampion',
    desc: 'Získej za celý život 500 000 zkušeností.',
    title: 'Šampion',
  },
  prog_paragon: { name: 'Vzor', desc: 'Získej za celý život 1 000 000 zkušeností.', title: 'Vzor' },
  prog_mythic: {
    name: 'Mýtický',
    desc: 'Získej za celý život 2 500 000 zkušeností.',
    title: 'Mýtický',
  },
  prog_eternal: {
    name: 'Věčný',
    desc: 'Získej za celý život 5 000 000 zkušeností.',
    title: 'Věčný',
  },
  prog_prestige: {
    name: 'Začít znovu',
    desc: 'Dosáhni nejvyšší úrovně, naplň ukazatel ještě jednou a získej prestižní hodnost 1.',
  },
  prog_prestige_5: { name: 'Staré zvyky', desc: 'Dosáhni prestižní hodnosti 5.' },
  prog_prestige_10: { name: 'Perpetuum mobile', desc: 'Dosáhni prestižní hodnosti 10.' },
  prog_first_harvest: { name: 'Plody polí', desc: 'Skliď své první sběrné naleziště.' },
  prog_mining_100: { name: 'Ruda v krvi', desc: 'Dosáhni zdatnosti 100 v hornictví.' },
  prog_logging_100: {
    name: 'Sekáč jádrového dřeva',
    desc: 'Dosáhni zdatnosti 100 v dřevorubectví.',
  },
  prog_herbalism_100: { name: 'Mistr lučin', desc: 'Dosáhni zdatnosti 100 v bylinkářství.' },
  prog_master_gatherer: {
    name: 'Mistr sběrač',
    desc: 'Dosáhni zdatnosti 100 v hornictví, dřevorubectví a bylinkářství.',
  },
  prog_first_craft: { name: 'Vlastníma rukama', desc: 'Dokonči svou první úspěšnou výrobu.' },
  prog_craft_specialist: {
    name: 'Tajemství řemesla',
    desc: 'Dosáhni dovednosti 75 v kterémkoli řemesle a odemkni výhody jeho specializace.',
  },
  prog_around_the_ring: {
    name: 'Kolem dokola',
    desc: 'Dosáhni dovednosti 25 v pěti různých řemeslech.',
  },
  cmb_first_blood: { name: 'První krev', desc: 'Poraz svého prvního nepřítele.' },
  cmb_slayer: { name: 'Zabiják', desc: 'Poraz 1 000 nepřátel.' },
  cmb_legion_of_one: { name: 'Armáda jednoho', desc: 'Poraz 10 000 nepřátel.' },
  cmb_heavy_hitter: { name: 'Těžká váha', desc: 'Uštědři celkem 500 000 poškození.' },
  cmb_critical_eye: { name: 'Kritické oko', desc: 'Zasaď 500 kritických úderů.' },
  cmb_giantslayer: {
    name: 'Obrobijce',
    desc: 'Zasaď smrtící úder nepříteli alespoň o pět úrovní nad tebou.',
  },
  cmb_first_fall: { name: 'Oklepat a jít dál', desc: 'Zemři poprvé; stává se to i těm nejlepším.' },
  dgn_hollow_crypt: { name: 'Lamač krypty', desc: 'Poraz Morthena Hrobovolajícího v Duté kryptě.' },
  dgn_sunken_bastion: {
    name: 'Mlhovazač bez pout',
    desc: 'Poraz Vaela Mlhovazače v Potopené baště.',
  },
  dgn_drowned_temple: {
    name: 'Utopit měsíc',
    desc: 'Poraz Ysolei, avatara utopeného měsíce, v Utopeném chrámu.',
  },
  dgn_gravewyrm_sanctum: {
    name: 'Drak v hlubinách',
    desc: 'Poraz Korzula Hrobodraka ve Svatyni Hrobodraka.',
  },
  dgn_hollow_crypt_heroic: {
    name: 'Hrdinská: Dutá krypta',
    desc: 'Poraz Morthena Hrobovolajícího v Duté kryptě na hrdinské obtížnosti.',
  },
  dgn_sunken_bastion_heroic: {
    name: 'Hrdinská: Potopená bašta',
    desc: 'Poraz Vaela Mlhovazače v Potopené baště na hrdinské obtížnosti.',
  },
  dgn_drowned_temple_heroic: {
    name: 'Hrdinská: Utopený chrám',
    desc: 'Poraz Ysolei, avatara utopeného měsíce, v Utopeném chrámu na hrdinské obtížnosti.',
  },
  dgn_gravewyrm_sanctum_heroic: {
    name: 'Hrdinská: Svatyně Hrobodraka',
    desc: 'Poraz Korzula Hrobodraka ve Svatyni Hrobodraka na hrdinské obtížnosti.',
  },
  dgn_nythraxis: {
    name: 'Už žádná metla',
    desc: 'Poraz Nythraxise, metlu Thornpeaku, za zapečetěnými královskými dveřmi.',
  },
  dgn_nythraxis_heroic: {
    name: 'Hrdinská: Už žádná metla',
    desc: 'Poraz Nythraxise, metlu Thornpeaku, na hrdinské obtížnosti.',
  },
  dgn_thornpeak_rounds: {
    name: 'Obchůzka',
    desc: 'Vyčisti Dutou kryptu, Potopenou baštu, Utopený chrám a Svatyni Hrobodraka.',
  },
  dgn_deepward: {
    name: 'Stráž hlubin',
    desc: 'Pokoř každý dungeon, raid i obě výpravy na hrdinské obtížnosti.',
  },
  dgn_mark_circuit: {
    name: 'Celý okruh',
    desc: 'Získej Hrdinské značky ze všech čtyř hrdinských dungeonů během jediného dne.',
  },
  dgn_boss_clears_50: {
    name: 'Padesát dveří za sebou',
    desc: 'Poraz 50 závěrečných bossů dungeonů.',
  },
  dgn_morthen_flawless: {
    name: 'Ani kůstka nazmar',
    desc: 'Poraz Morthena Hrobovolajícího na hrdinské obtížnosti, aniž by kdokoli ze skupiny zemřel.',
  },
  dgn_morthen_trio: {
    name: 'Tři proti hrobu',
    desc: 'Poraz Morthena Hrobovolajícího s nejvýše třemi hráči.',
  },
  dgn_olen_arc: {
    name: 'Úkrok před žencem',
    desc: 'Poraz rytířského velitele Olena, aniž by jeho Žnoucí oblouk zasáhl kohokoli kromě jeho aktuálního cíle.',
  },
  dgn_vael_thralls: {
    name: 'Bez jediného otroka',
    desc: 'Poraz Vaela Mlhovazače, když je každý Utopený otrok, kterého povolal, již zabit.',
  },
  dgn_ysolei_moonspawn: {
    name: 'Do posledního plemene',
    desc: 'Poraz Ysolei, když je každé Měsíční plémě, které povolala, již zabito.',
  },
  dgn_ysolei_flawless: {
    name: 'Suché oči',
    desc: 'Poraz Ysolei, avatara utopeného měsíce, na hrdinské obtížnosti, aniž by kdokoli ze skupiny zemřel.',
  },
  dgn_velkhar_bonewalkers: {
    name: 'Zůstaňte pohřbení',
    desc: 'Poraz velkého nekromanta Velkhara tak, aby byl každý Povstalý kostěný chodec zničen dřív, než Velkhar padne.',
  },
  dgn_korzul_flawless: {
    name: 'Drakobijce',
    desc: 'Poraz Korzula Hrobodraka na hrdinské obtížnosti, aniž by kdokoli ze skupiny zemřel.',
    title: 'Drakobijce',
  },
  dgn_sanctum_speed: {
    name: 'Sprint svatyní',
    desc: 'Poraz Korzula Hrobodraka do 15 minut od chvíle, kdy si tvá skupina zabrala Svatyni Hrobodraka.',
  },
  dgn_nythraxis_gravebreaker: {
    name: 'Před králem nepokleknu',
    desc: 'Poraz Nythraxise tak, aby Hrobolam nikdy nezasáhl nikoho kromě jeho aktuálního cíle.',
  },
  dgn_nythraxis_wardens: {
    name: 'Strážci ochranných kamenů',
    desc: 'Poraz Nythraxise tak, aby byl každý Nesmrtelný hněv zlomen dřív, než udeří.',
  },
  dgn_nythraxis_deathless: {
    name: 'Nikdo nesmrtelnější',
    desc: 'Poraz Nythraxise, metlu Thornpeaku, na hrdinské obtížnosti, aniž by jediný člen raidu zemřel.',
    title: 'Nesmrtelný',
  },
  cmb_thunzharr: {
    name: 'Hora padla',
    desc: 'Sraz Thunzharra, probouzející se štít, u Bouřného skalního štítu.',
  },
  cmb_thunzharr_unbroken: {
    name: 'Štítolam',
    desc: 'Sraz Thunzharra, probouzející se štít, aniž bys zemřel, od svého prvního úderu po jeho poslední dech.',
    title: 'Štítolam',
  },
  cmb_thunzharr_ten: {
    name: 'Hory ze zvyku',
    desc: 'Sraz Thunzharra, probouzející se štít, desetkrát.',
  },
  dlv_reliquary: { name: 'Relikviářový běžec', desc: 'Vyčisti Zhroucený relikviář.' },
  dlv_reliquary_heroic: {
    name: 'Hrdinsky: Zhroucený relikviář',
    desc: 'Vyčisti Zhroucený relikviář na hrdinském stupni.',
  },
  dlv_litany: { name: 'Utiš Litanii', desc: 'Vyčisti Utopenou litanii.' },
  dlv_litany_heroic: {
    name: 'Hrdinsky: Utopená litanie',
    desc: 'Vyčisti Utopenou litanii na hrdinském stupni.',
  },
  dlv_lore_journal: {
    name: 'Poznámky na okraji',
    desc: 'Odemkni všech pět záznamů deníku výprav.',
  },
  dlv_companion_max: {
    name: 'V hlubině poznáš přítele',
    desc: 'Doveď společnici z výprav na její nejvyšší hodnost.',
  },
  dlv_companions_both: {
    name: 'Obě lucerny rozžaté',
    desc: 'Doveď obě společnice z výprav, Akolytku Tessu a Eddu Reedhand, na nejvyšší hodnost.',
  },
  dlv_clears_50: { name: 'Padesát sáhů', desc: 'Dokonči 50 výprav.' },
  dlv_solo_heroic: {
    name: 'Ve dvou se to lépe táhne',
    desc: 'Vyčisti výpravu na hrdinském stupni bez jediného dalšího hráče, jen ty a tvá společnice.',
  },
  dlv_tumbler_premium: {
    name: 'Cesta stavítek, zvládnutá',
    desc: 'Otevři chráněnou truhlu relikviáře při nejvyšší sázce, bezchybně na jediný pokus.',
  },
  dlv_rite_flawless: {
    name: 'Slovo od slova',
    desc: 'Dokonči Obřad utopeného relikviáře bez jediné chyby.',
  },
  dlv_varric_ringers: {
    name: 'Zvony umlkly',
    desc: 'Poraz Diákona Varrica poté, co pobiješ každého Pohřebního zvoníka, kterého pozvedne.',
  },
  dlv_nhalia_bells: {
    name: 'Tišitel zvonů',
    desc: 'Poraz Sestru Nhalii, Utopený chvalozpěv, aniž by kohokoli ze skupiny zasáhl Zvonící zvon.',
    title: 'Tišitel zvonů',
  },
  chr_vale_chapter_i: {
    name: 'Kronika Údolí, kapitola I',
    desc: 'Dokonči první kapitolu Saulovy kroniky: první pochůzky v Eastbrooku, obhlídka Údolí a první ochutnávka zdejších řemesel.',
  },
  chr_vale_chapter_ii: {
    name: 'Kronika Údolí, kapitola II',
    desc: 'Dokonči druhou kapitolu Saulovy kroniky: bandité, murloci i důlní havěť pobiti, zápas na Prasečím poli odehrán a Relikviář zdolán.',
  },
  chr_vale_chapter_iii: {
    name: 'Kronika Údolí',
    desc: 'Doveď příběh Údolí až do konce: Hrobovolající odhalen, Dutá krypta očištěna a všechny pojmenované hrůzy Údolí pobity.',
    title: 'z Údolí',
  },
  chr_vale_gatherer: {
    name: 'Z darů kraje',
    desc: 'Vytěž v Eastbrookském údolí rudnou žílu, porost dřeva i záhon bylin.',
  },
  chr_vale_first_cast: {
    name: 'Něco v Zrcadlovém jezeře',
    desc: 'Chyť rybu ve vodách Eastbrookského údolí.',
  },
  chr_vale_packbreaker: { name: 'Postrach smeček', desc: 'Zab 3 Lesní vlky během 10 sekund.' },
  chr_vale_cup_debut: {
    name: 'Uchazeč o Měděné vědro',
    desc: 'Nastup na hřiště a dotkni se míče v zápase Poháru Údolí na Prasečím poli.',
  },
  chr_vale_rares: {
    name: 'Hrůzy Údolí',
    desc: 'Zab pět pojmenovaných hrůz Eastbrookského údolí: Starého Šedočelista, Moggera, Grixe Tunelového krále, Kapitána Verlana a Maldreca, poutače přízraků.',
  },
  chr_marsh_chapter_i: {
    name: 'Kronika Močálu, kapitola I',
    desc: 'Dokonči první kapitolu kroniky Osrica Fenna: odpověz na fenbridgeské svolání, zajisti hráz a poznej tvář slatě.',
  },
  chr_marsh_chapter_ii: {
    name: 'Kronika Močálu, kapitola II',
    desc: 'Dokonči druhou kapitolu kroniky Osrica Fenna: vdovy vypáleny, utopení uloženi k odpočinku, Tresčí kmotr uloven a Litanie zdolána.',
  },
  chr_marsh_chapter_iii: {
    name: 'Kronika Mirefenu',
    desc: 'Doveď příběh slatě až do konce: tábor kultu rozprášen, Mlhovazač umlčen v Potopené baště a všechny pojmenované hrůzy mlhy pobity.',
    title: 'z Mirefenu',
  },
  chr_marsh_gatherer: {
    name: 'Fenbridgeská sklizeň',
    desc: 'Vytěž v Mirefenském močálu rudnou žílu, porost dřeva i záhon bylin.',
  },
  chr_marsh_unburst: {
    name: 'Nestůj ve výtrusech',
    desc: 'Zab 8 Bahenních nadmutců, aniž by tě zasáhl výbuch jejich Žíravých výtrusů.',
  },
  chr_marsh_hush_the_mending: {
    name: 'Umlč hojení',
    desc: 'V táboře Hrobovolajících zab Ranhojiče Hrobovolajících dřív než kteréhokoli z kultistů, o které pečuje.',
  },
  chr_marsh_rares: {
    name: 'Jména v mlze',
    desc: 'Zab tři pojmenované hrůzy Mirefenského močálu: Lačnou Bahnočelist, Sloomtootha Utopeného a Sestru Nhalii.',
  },
  chr_peaks_chapter_i: {
    name: 'Kronika Výšin, kapitola I',
    desc: 'Dokonči první kapitolu Zenziiny kroniky: vyčisti hřebenovou cestu, vyprázdni nory a poznej každou stezku, kterou Highwatch střeží.',
  },
  chr_peaks_chapter_ii: {
    name: 'Kronika Výšin, kapitola II',
    desc: 'Dokonči druhou kapitolu Zenziiny kroniky: rozbij Drogmarův válečný tábor, přečti probouzející se bouři a postav se tam, kde září Třpytivé pleso.',
  },
  chr_peaks_chapter_iii: {
    name: 'Kronika Thornpeaku',
    desc: 'Doveď příběh hory až do konce: kult draka rozprášen, Svatyně umlčena, Probouzející se štít sražen a všechny pojmenované hrůzy skalisek pobity.',
    title: 'z Thornpeaku',
  },
  chr_peaks_sparring: {
    name: 'Dril na hradbách',
    desc: 'Uštědři celkem 1 000 poškození Cvičnému panákovi nad Highwatchem.',
  },
  chr_peaks_glimmer_cast: {
    name: 'Studená voda, chladnější světlo',
    desc: 'Chyť rybu z Třpytivého plesa.',
  },
  chr_peaks_moongate: {
    name: 'Skrz chladnou bránu',
    desc: 'Projdi měsíční bránou na břehu Třpytivého plesa.',
  },
  chr_peaks_waking_witness: {
    name: 'Hora, která kráčí',
    desc: 'Spatři Thunzharra, probouzející se štít, když kráčí horou.',
  },
  chr_peaks_rares: {
    name: 'Jména vytesaná do skály',
    desc: 'Zab čtyři pojmenované hrůzy Thornpeakských výšin: Předáka Železné žíly, Brutoka Drtiče lebek, Voskara Žhavé křídlo a Pána morku Varkase.',
  },
  col_discovery_25: {
    name: 'Křeček',
    desc: 'Objev 25 různých předmětů (předmět se počítá, když se poprvé ocitne ve tvém vlastnictví).',
  },
  col_discovery_75: { name: 'Straka', desc: 'Objev 75 různých předmětů.' },
  col_discovery_150: {
    name: 'Kabinet kuriozit',
    desc: 'Objev 150 různých předmětů.',
    title: 'Kurátor',
  },
  col_discovery_250: { name: 'Velký katalog', desc: 'Objev 250 různých předmětů.' },
  col_first_rare: { name: 'Něco modrého', desc: 'Získej svůj první předmět vzácné kvality.' },
  col_first_epic: { name: 'Zrozen v purpuru', desc: 'Získej svůj první předmět epické kvality.' },
  col_first_legendary: {
    name: 'Oranžové terno',
    desc: 'Získej svůj první předmět legendární kvality.',
  },
  col_set_vale_arcanist: {
    name: 'Regálie údolního arkanisty',
    desc: 'Objev každý kus Regálií údolního arkanisty.',
  },
  col_set_boundstone_vanguard: {
    name: 'Předvoj spoutaného kamene',
    desc: 'Objev každý kus Předvoje spoutaného kamene.',
  },
  col_set_greyjaw_stalker: {
    name: 'Výbava stopaře Šedočelista',
    desc: 'Objev každý kus Výbavy stopaře Šedočelista.',
  },
  col_set_deathlord: {
    name: 'Válečná výstroj mohylového pána',
    desc: 'Objev každý kus Válečné výstroje mohylového pána.',
  },
  col_set_wyrmshadow: {
    name: 'Roucha nočního tesáku',
    desc: 'Objev každý kus Rouch nočního tesáku.',
  },
  col_set_necromancers: { name: 'Oděv smutkotkaní', desc: 'Objev každý kus Oděvu smutkotkaní.' },
  col_set_crownforged: { name: 'Regálie z kosti', desc: 'Objev každý kus Regálií z kosti.' },
  col_set_nighttalon: {
    name: 'Kožešina děsivého tesáku',
    desc: 'Objev každý kus Kožešiny děsivého tesáku.',
  },
  col_set_soulflame: {
    name: 'Regálie přízračného ohně',
    desc: 'Objev každý kus Regálií přízračného ohně.',
  },
  col_set_stormcallers: {
    name: 'Roucha volání vichru',
    desc: 'Objev každý kus Rouch volání vichru.',
  },
  col_seven_regalia: {
    name: 'Sedmerý šatník',
    desc: 'Objev každý kus všech sedmi epických zbrojních rodin.',
    title: 'Skvostný',
  },
  col_true_colors: {
    name: 'V pravých barvách',
    desc: 'Nastup na hřiště v jiném vzhledu, než je výchozí vzhled tvé třídy.',
  },
  col_all_slots: {
    name: 'Jedenáct kusů parády',
    desc: 'Měj současně nasazený předmět ve všech jedenácti slotech výstroje.',
  },
  col_quartermaster_buyout: {
    name: 'Věrný zákazník',
    desc: 'Objev všech deset kusů z nabídky Zásobovače Vexe.',
  },
  col_glimmerfin: { name: 'Třpyt naděje', desc: 'Chyť Koi se třpytivou ploutví.' },
  col_full_creel: {
    name: 'Plný košík',
    desc: 'Objev všech šest běžných úlovků z vod Údolí, Močálu a Výšin.',
  },
  col_junk_drawer: {
    name: 'Šuplík s harampádím',
    desc: 'Objev 10 různých předmětů mizerné kvality.',
  },
  pvp_arena_first_match: {
    name: 'Písek v botách',
    desc: 'Odehraj hodnocený zápas v Popelavém koloseu, v libovolné z obou kategorií.',
  },
  pvp_arena_first_win: {
    name: 'Dav burácí',
    desc: 'Vyhraj hodnocený zápas v aréně, v libovolné z obou kategorií.',
  },
  pvp_arena_1v1_1600: {
    name: 'Vyzyvatel kolosea',
    desc: 'Dosáhni hodnocení 1600 v arénové kategorii 1 na 1.',
  },
  pvp_arena_1v1_1750: {
    name: 'Sok kolosea',
    desc: 'Dosáhni hodnocení 1750 v arénové kategorii 1 na 1.',
  },
  pvp_arena_1v1_1900: {
    name: 'Gladiátor',
    desc: 'Dosáhni hodnocení 1900 v arénové kategorii 1 na 1.',
    title: 'Gladiátor',
  },
  pvp_arena_2v2_1600: {
    name: 'Dva ve zbrani',
    desc: 'Dosáhni hodnocení 1600 v arénové kategorii 2 na 2.',
  },
  pvp_arena_2v2_1750: {
    name: 'Obávaná dvojka',
    desc: 'Dosáhni hodnocení 1750 v arénové kategorii 2 na 2.',
  },
  pvp_arena_2v2_1900: {
    name: 'Dokonalá souhra',
    desc: 'Dosáhni hodnocení 1900 v arénové kategorii 2 na 2.',
  },
  pvp_duel_first_win: { name: 'Vyřídíme si to venku', desc: 'Vyhraj duel.' },
  pvp_duel_grace: { name: 'Lekce pokory', desc: 'Prohraj duel s důstojností víceméně nedotčenou.' },
  pvp_vcup_first_match: {
    name: 'Kopačky na hřišti',
    desc: 'Odehraj celý zápas Poháru údolí na Prasečím poli, ať vyhraješ, nebo prohraješ.',
  },
  pvp_vcup_first_win: { name: 'První trofej', desc: 'Vyhraj hodnocený zápas Poháru údolí.' },
  pvp_vcup_wins_10: {
    name: 'Ostřílený kančbalista',
    desc: 'Vyhraj 10 hodnocených zápasů Poháru údolí.',
  },
  pvp_vcup_wins_25: {
    name: 'Legenda kančbalu',
    desc: 'Vyhraj 25 hodnocených zápasů Poháru údolí.',
    title: 'Legenda kančbalu',
  },
  pvp_vcup_first_goal: {
    name: 'Střelecký účet otevřen',
    desc: 'Vstřel gól v hodnoceném zápase Poháru údolí.',
  },
  pvp_vcup_hat_trick: {
    name: 'Hrdina hattricku',
    desc: 'Vstřel tři góly v jediném hodnoceném zápase Poháru údolí, v kategorii 3 na 3 nebo větší.',
  },
  pvp_vcup_golden_goal: {
    name: 'Zlatý okamžik',
    desc: 'Vstřel zlatý gól, který rozhodne hodnocený zápas Poháru údolí.',
  },
  pvp_vcup_first_save: {
    name: 'Jisté ruce',
    desc: 'Předveď zákrok jako brankář v hodnoceném zápase Poháru údolí.',
  },
  pvp_vcup_clean_sheet: {
    name: 'Přese mě nic neprojde',
    desc: 'Vyhraj hodnocený zápas Poháru údolí jako brankář bez inkasovaného gólu.',
  },
  pvp_vcup_guild_win: {
    name: 'Za zástavu',
    desc: 'Vyhraj hodnocený zápas Poháru údolí odehraný pod zástavou tvého cechu.',
  },
  pvp_fiesta_first_bout: {
    name: 'Nezvaný host',
    desc: 'Odehraj celý souboj Fiesty 2 na 2, ať vyhraješ, nebo prohraješ.',
  },
  pvp_fiesta_first_win: { name: 'Duše Fiesty', desc: 'Vyhraj souboj Fiesty 2 na 2.' },
  pvp_fiesta_double: {
    name: 'Dvojitý malér',
    desc: 'Zaznamenej dvě eliminace ve Fiestě během čtyř sekund.',
  },
  pvp_fiesta_shutdown: {
    name: 'Kazič zábavy',
    desc: 'Sejmi soupeře ve Fiestě, který je na sérii tří a více.',
  },
  pvp_fiesta_full_build: {
    name: 'Ve velké parádě',
    desc: 'Vyhraj souboj Fiesty s vylepšením zajištěným ze všech tří vln.',
  },
  pvp_fiesta_powerups: {
    name: 'Od každého jednou',
    desc: 'Seber alespoň jednou každý ze čtyř power-upů v ringu: Démona rychlosti, Kolosa, Měsíční boty a Berserkera.',
  },
  pvp_fiesta_five_kills: {
    name: 'Tahoun párty',
    desc: 'Zaznamenej pět eliminací v jediném souboji Fiesty.',
  },
  soc_first_party: {
    name: 'Ve dvou se to lépe táhne',
    desc: 'Připoj se do skupiny s dalším hráčem.',
  },
  soc_full_house: { name: 'Plná sestava', desc: 'Vyčisti dungeon v plné pětičlenné skupině.' },
  soc_guild_joined: { name: 'Pod jednou zástavou', desc: 'Staň se členem cechu.' },
  soc_guild_founded: { name: 'Zakladatelův brk', desc: 'Založ vlastní cech.' },
  soc_first_trade: { name: 'Poctivý obchod', desc: 'Dokonči obchod s jiným hráčem.' },
  soc_first_sale: {
    name: 'Máme otevřeno',
    desc: 'Vyzvedni mince ze svého prvního prodeje na Světovém trhu.',
  },
  soc_steady_custom: {
    name: 'Stálá klientela',
    desc: 'Vyzvedni z prodejů na Světovém trhu celkem 10 zlatých za celý život.',
  },
  soc_market_magnate: {
    name: 'Magnát trhu',
    desc: 'Vyzvedni z prodejů na Světovém trhu celkem 100 zlatých za celý život.',
    title: 'Magnát',
  },
  soc_by_ravens_wing: {
    name: 'Na havraních křídlech',
    desc: 'Pošli Havraní poštou dopis nesoucí mince nebo balíček.',
  },
  soc_room_for_more: { name: 'Kam s tím', desc: 'Kup si své první rozšíření banky.' },
  soc_gilded_strongbox: {
    name: 'Pozlacená truhlice',
    desc: 'Kup všechna rozšíření banky, která ti pokladníci prodají.',
  },
  soc_meet_bursar: {
    name: 'Věříme ve Fernanda',
    desc: 'Slož poklonu pokladníku Fernandovi, správci Pozlacené truhlice v Eastbrooku.',
  },
  soc_pocket_money: { name: 'Kapesné', desc: 'Ukořisti za celý život celkem 1 zlatý v mincích.' },
  soc_heavy_purse: {
    name: 'Těžký měšec',
    desc: 'Ukořisti za celý život celkem 10 zlatých v mincích.',
  },
  soc_wyrms_hoard: {
    name: 'Dračí poklad',
    desc: 'Ukořisti za celý život celkem 100 zlatých v mincích.',
  },
  soc_civic_duty: { name: 'Občanská povinnost', desc: 'Přiděl svůj první bod zaměření města.' },
  exp_long_road_north: {
    name: 'Dlouhá cesta na sever',
    desc: 'Navštiv všechna tři hlavní sídla: Eastbrook, Fenbridge a Highwatch.',
  },
  exp_vale_wayfarer: {
    name: 'Pocestný z údolí',
    desc: 'Navštiv všech jedenáct pojmenovaných míst Eastbrookského údolí.',
  },
  exp_marsh_wayfarer: {
    name: 'Pocestný z močálu',
    desc: 'Navštiv všech osm pojmenovaných míst Mirefenského močálu.',
  },
  exp_peaks_wayfarer: {
    name: 'Pocestný z výšin',
    desc: 'Navštiv všech deset pojmenovaných míst Thornpeakských výšin.',
  },
  exp_world_traveler: {
    name: 'Světoběžník',
    desc: 'Vykonej skutek pocestného všech tří zón.',
    title: 'Pocestný',
  },
  exp_something_shiny: { name: 'Něco se třpytí', desc: 'Seber ze země třpytící se předmět.' },
  exp_first_ore: { name: 'Udeř do země', desc: 'Skliď své první naleziště rudy.' },
  exp_first_timber: { name: 'Pozor, padá!', desc: 'Skliď své první naleziště dřeva.' },
  exp_first_herb: { name: 'Zelené prsty', desc: 'Skliď své první naleziště bylin.' },
  feat_era_cap: {
    name: 'Dítě První éry',
    desc: 'Dosáhl(a) jsi úrovně 20 v době, kdy trvala První éra.',
  },
  feat_book_complete: { name: 'Celá kniha', desc: 'Vykonej každý skutek v Knize skutků.' },
  feat_brightwood_relic: {
    name: 'Vzpomínka na Brightwood',
    desc: 'Uchovej relikvii starého Brightwoodu: Kazajku z trnité kůže nebo Korunu monarchy.',
  },
  hid_saul_footnote: {
    name: 'Poznámka pod čarou dějin',
    desc: 'Devětkrát bez přestávky jsi otravoval(a) kronikáře Saula.',
    title: 'Poznámka pod čarou',
  },
  hid_gilded_tour: {
    name: 'Pozlacené turné',
    desc: 'Obchodoval(a) jsi se všemi třemi pobočkami Pozlacené truhlice.',
  },
  hid_fall_death: {
    name: 'Gravitace vždycky vyhraje',
    desc: 'Zemřel(a) jsi na dlouhý rozhovor se zemí.',
  },
  hid_keepers_toll_twice: {
    name: 'Strážce vybírá dvakrát',
    desc: 'Zemřel(a) jsi, když na tobě ještě leželo Strážcovo mýto.',
  },
  hid_roll_hundred: { name: 'Čistá stovka', desc: 'Hodil(a) jsi rovných 100 při obyčejném /roll.' },
  hid_yumi_cheer: {
    name: 'Největší fanoušek Yumi',
    desc: 'Povzbuzoval(a) jsi Yumi uprostřed souboje tam, kde tě mohla slyšet.',
  },
  hid_bountiful_coffer: {
    name: 'Purpurová truhla',
    desc: 'Rozlouskl(a) jsi Bohatou truhlu dřív, než se stačila zaseknout.',
  },
  hid_companion_save: {
    name: 'Ne pod jejím dohledem',
    desc: 'Tvá společnice z výpravy zvedla padlého člena skupiny zpátky na nohy.',
  },
  hid_codfather: {
    name: 'Vítej v rodině',
    desc: 'Vytáhl(a) jsi Tresčího kmotra z Mělčin Deepfenu.',
  },
  prog_crown_below: {
    name: 'Koruna v hlubinách',
    desc: 'Následuj korunu od neklidných kostěných polí až do hrobky krále Nythraxise a dokonči úkol Konec metly.',
  },
  prog_mere_at_rest: {
    name: 'Klid nad plesem',
    desc: 'Doveď hlídku Ondrela Vanea až do konce: sbor umlčen, Bledá spirála skolena a utopený měsíc uložen k odpočinku.',
  },
  prog_callused_hands: {
    name: 'Mozolnaté ruce',
    desc: 'Dokonči úkol Řemeslo pro každou ruku a vyslouž si první mozol v eastbrookských řemeslech.',
  },
  prog_tools_of_the_trade: {
    name: 'Nástroje řemesla',
    desc: 'Dokonči výrobu na řemeslné stanici.',
  },
  dgn_nythraxis_crypt: {
    name: 'Co krypta skrývala',
    desc: 'Odvaž se do Opuštěné krypty a získej od jejích strážců obě poloviny klíče od krypty i starobylý deník.',
  },
  chr_marsh_first_cast: {
    name: 'Úhoři v rákosí',
    desc: 'Chyť rybu ve vodách Mirefenského močálu.',
  },
};
