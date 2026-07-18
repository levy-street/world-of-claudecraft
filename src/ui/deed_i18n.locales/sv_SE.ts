// Deed name / desc / title locale table for sv_SE (data-as-code, size-exempt).
// One per-base-locale chunk behind DEED_LOCALE_LOADERS in deed_i18n.ts, so a
// visitor downloads only their own locale's deed strings. Split verbatim from
// the former deed_i18n.newlocales.ts single chunk; values carry no em or en
// dashes (repo copy rule). English (en / en_CA) resolves to the authored
// source before this table is consulted.
import type { DeedLocaleTable } from '../deed_i18n';

export const table: DeedLocaleTable = {
  pvp_card_duel_first_win: {
    name: 'Husregler',
    desc: 'Vinn en kortduell hos Kortmästaren.',
  },
  prog_first_steps: {
    name: 'Första stegen',
    desc: 'Nå nivå 2 och ta ditt första steg på en lång väg.',
  },
  prog_finding_your_feet: {
    name: 'Varm i kläderna',
    desc: 'Nå nivå 5; vildmarken ser redan lite mindre ut.',
  },
  prog_double_digits: { name: 'Tvåsiffrigt', desc: 'Nå nivå 10 och lås upp dina talanger.' },
  prog_the_long_middle: { name: 'Den långa mitten', desc: 'Nå nivå 15.' },
  prog_level_cap: { name: 'Utsikten från toppen', desc: 'Nå nivå 20, den högsta nivån.' },
  prog_well_rested: {
    name: 'Utvilad',
    desc: 'Slå dig till ro på ett värdshus tills du har tjänat in utvilad erfarenhet.',
  },
  prog_talented: { name: 'En väl spenderad poäng', desc: 'Spendera din första talangpoäng.' },
  prog_specialized: {
    name: 'Avsiktsförklaring',
    desc: 'Välj en specialisering och lär dig dess signaturförmåga.',
  },
  prog_deep_roots: {
    name: 'Djupa rötter',
    desc: 'Lägg en talangpoäng i en talang på den nedersta raden.',
  },
  prog_full_build: {
    name: 'Hela sexan',
    desc: 'Välj ett alternativ i alla sex talangrader i ett och samma bygge.',
  },
  prog_veteran: { name: 'Veteran', desc: 'Tjäna sammanlagt 250 000 erfarenhet.', title: 'Veteran' },
  prog_champion: {
    name: 'Mästare',
    desc: 'Tjäna sammanlagt 500 000 erfarenhet.',
    title: 'Mästare',
  },
  prog_paragon: {
    name: 'Förebild',
    desc: 'Tjäna sammanlagt 1 000 000 erfarenhet.',
    title: 'Förebild',
  },
  prog_mythic: { name: 'Mytisk', desc: 'Tjäna sammanlagt 2 500 000 erfarenhet.', title: 'Mytisk' },
  prog_eternal: { name: 'Evig', desc: 'Tjäna sammanlagt 5 000 000 erfarenhet.', title: 'Evig' },
  prog_prestige: {
    name: 'Börja om',
    desc: 'Nå den högsta nivån, fyll mätaren en gång till och gör anspråk på prestigerang 1.',
  },
  prog_prestige_5: { name: 'Gamla vanor', desc: 'Nå prestigerang 5.' },
  prog_prestige_10: { name: 'Evighetsmaskinen', desc: 'Nå prestigerang 10.' },
  prog_first_harvest: { name: 'Markens frukter', desc: 'Skörda din första fyndighet.' },
  prog_mining_100: { name: 'Malm i blodet', desc: 'Nå 100 i färdigheten Gruvdrift.' },
  prog_logging_100: { name: 'Kärnvedshuggare', desc: 'Nå 100 i färdigheten Timmerhuggning.' },
  prog_herbalism_100: { name: 'Ängens mästare', desc: 'Nå 100 i färdigheten Örtkunskap.' },
  prog_master_gatherer: {
    name: 'Mästersamlare',
    desc: 'Nå 100 i färdigheterna Gruvdrift, Timmerhuggning och Örtkunskap.',
  },
  prog_first_craft: { name: 'Handgjort', desc: 'Slutför ditt första lyckade hantverk.' },
  prog_craft_specialist: {
    name: 'Yrkeshemligheter',
    desc: 'Nå 75 i skicklighet i ett valfritt hantverk och lås upp dess specialiseringsförmåner.',
  },
  prog_around_the_ring: { name: 'Runt ringen', desc: 'Nå 25 i skicklighet i fem olika hantverk.' },
  cmb_first_blood: { name: 'Första blodet', desc: 'Besegra din första fiende.' },
  cmb_slayer: { name: 'Dräpare', desc: 'Besegra 1 000 fiender.' },
  cmb_legion_of_one: { name: 'En mans legion', desc: 'Besegra 10 000 fiender.' },
  cmb_heavy_hitter: { name: 'Tungviktare', desc: 'Utdela sammanlagt 500 000 skada.' },
  cmb_critical_eye: { name: 'Kritiskt öga', desc: 'Utdela 500 kritiska träffar.' },
  cmb_giantslayer: {
    name: 'Jättedräpare',
    desc: 'Utdela dödsstöten mot en fiende som är minst fem nivåer över dig.',
  },
  cmb_first_fall: {
    name: 'Borsta av dig',
    desc: 'Dö för första gången; det händer de bästa av oss.',
  },
  dgn_hollow_crypt: {
    name: 'Kryptbrytaren',
    desc: 'Besegra Morthen Gravkallaren i Den ihåliga kryptan.',
  },
  dgn_sunken_bastion: {
    name: 'Dimman lättar',
    desc: 'Besegra Vael Fogbindern i Den sjunkna bastionen.',
  },
  dgn_drowned_temple: {
    name: 'Att dränka månen',
    desc: 'Besegra Ysolei, den dränkta månens avatar, i Det dränkta templet.',
  },
  dgn_gravewyrm_sanctum: {
    name: 'Lindormen i djupet',
    desc: 'Besegra Korzul Gravlindormen i Gravlindormens helgedom.',
  },
  dgn_hollow_crypt_heroic: {
    name: 'Heroisk: Den ihåliga kryptan',
    desc: 'Besegra Morthen Gravkallaren i Den ihåliga kryptan på heroisk svårighetsgrad.',
  },
  dgn_sunken_bastion_heroic: {
    name: 'Heroisk: Den sjunkna bastionen',
    desc: 'Besegra Vael Fogbindern i Den sjunkna bastionen på heroisk svårighetsgrad.',
  },
  dgn_drowned_temple_heroic: {
    name: 'Heroisk: Det dränkta templet',
    desc: 'Besegra Ysolei, den dränkta månens avatar, i Det dränkta templet på heroisk svårighetsgrad.',
  },
  dgn_gravewyrm_sanctum_heroic: {
    name: 'Heroisk: Gravlindormens helgedom',
    desc: 'Besegra Korzul Gravlindormen i Gravlindormens helgedom på heroisk svårighetsgrad.',
  },
  dgn_nythraxis: {
    name: 'Ett gissel mindre',
    desc: 'Besegra Nythraxis, Törntoppens gissel, bortom den förseglade kungliga dörren.',
  },
  dgn_nythraxis_heroic: {
    name: 'Heroisk: Ett gissel mindre',
    desc: 'Besegra Nythraxis, Törntoppens gissel, på heroisk svårighetsgrad.',
  },
  dgn_thornpeak_rounds: {
    name: 'På rond',
    desc: 'Rensa Den ihåliga kryptan, Den sjunkna bastionen, Det dränkta templet och Gravlindormens helgedom.',
  },
  dgn_deepward: {
    name: 'Djupvärn',
    desc: 'Erövra varje fängelsehål, raiden och båda delverna på heroisk svårighetsgrad.',
  },
  dgn_mark_circuit: {
    name: 'Hela varvet',
    desc: 'Förtjäna heroiska märken från alla fyra heroiska fängelsehål på en och samma dag.',
  },
  dgn_boss_clears_50: {
    name: 'Femtio dörrar djupare',
    desc: 'Besegra 50 slutbossar i fängelsehål.',
  },
  dgn_morthen_flawless: {
    name: 'Benfritt',
    desc: 'Besegra Morthen Gravkallaren på heroisk svårighetsgrad utan att någon gruppmedlem dör.',
  },
  dgn_morthen_trio: {
    name: 'Tre mot graven',
    desc: 'Besegra Morthen Gravkallaren med tre eller färre spelare.',
  },
  dgn_olen_arc: {
    name: 'Kliv undan lien',
    desc: 'Besegra Riddarkommendör Olen utan att hans Skördebåge träffar någon annan än hans nuvarande mål.',
  },
  dgn_vael_thralls: {
    name: 'Träldomens slut',
    desc: 'Besegra Vael Fogbindern med varje Drunknad träl han kallar på redan dräpt.',
  },
  dgn_ysolei_moonspawn: {
    name: 'Vartenda månyngel',
    desc: 'Besegra Ysolei med varje Månyngel hon kallar på redan dräpt.',
  },
  dgn_ysolei_flawless: {
    name: 'Torra ögon',
    desc: 'Besegra Ysolei, den dränkta månens avatar, på heroisk svårighetsgrad utan att någon gruppmedlem dör.',
  },
  dgn_velkhar_bonewalkers: {
    name: 'Ligg kvar i graven',
    desc: 'Besegra Stornekromantiker Velkhar med varje Uppstånden benvandrare förstörd innan han själv faller.',
  },
  dgn_korzul_flawless: {
    name: 'Lindormsfällaren',
    desc: 'Besegra Korzul Gravlindormen på heroisk svårighetsgrad utan att någon gruppmedlem dör.',
    title: 'Lindormsfällaren',
  },
  dgn_sanctum_speed: {
    name: 'Helgedomssprinten',
    desc: 'Besegra Korzul Gravlindormen inom 15 minuter efter att din grupp gjort anspråk på Gravlindormens helgedom.',
  },
  dgn_nythraxis_gravebreaker: {
    name: 'Böj knä för ingen',
    desc: 'Besegra Nythraxis utan att Gravbrytaren någonsin träffar någon annan än hans nuvarande mål.',
  },
  dgn_nythraxis_wardens: {
    name: 'Skyddsstenarnas väktare',
    desc: 'Besegra Nythraxis med varje Odödligt raseri brutet innan det hinner slå.',
  },
  dgn_nythraxis_deathless: {
    name: 'Ingen mer odödlig',
    desc: 'Besegra Nythraxis, Törntoppens gissel, på heroisk svårighetsgrad utan att en enda raidmedlem dör.',
    title: 'den Odödliga',
  },
  cmb_thunzharr: {
    name: 'Berget föll',
    desc: 'Fäll Thunzharr, den vaknande toppen, vid Stormklinten.',
  },
  cmb_thunzharr_unbroken: {
    name: 'Toppbrytaren',
    desc: 'Fäll Thunzharr, den vaknande toppen, utan att dö från ditt första slag till hans sista andetag.',
    title: 'Toppbrytaren',
  },
  cmb_thunzharr_ten: {
    name: 'Bergsvana',
    desc: 'Fäll Thunzharr, den vaknande toppen, tio gånger.',
  },
  dlv_reliquary: { name: 'Relikvarielöpare', desc: 'Rensa Det rasade relikvariet.' },
  dlv_reliquary_heroic: {
    name: 'Heroisk: Det rasade relikvariet',
    desc: 'Rensa Det rasade relikvariet på heroisk nivå.',
  },
  dlv_litany: { name: 'Tysta litanian', desc: 'Rensa Den dränkta litanian.' },
  dlv_litany_heroic: {
    name: 'Heroisk: Den dränkta litanian',
    desc: 'Rensa Den dränkta litanian på heroisk nivå.',
  },
  dlv_lore_journal: {
    name: 'Marginalanteckningar',
    desc: 'Lås upp alla fem anteckningar i delve-dagboken.',
  },
  dlv_companion_max: {
    name: 'En vän i djupet',
    desc: 'För en delve-följeslagare till hennes högsta rang.',
  },
  dlv_companions_both: {
    name: 'Båda lyktorna tända',
    desc: 'För båda delve-följeslagarna, Akolyten Tessa och Edda Reedhand, till deras högsta rang.',
  },
  dlv_clears_50: { name: 'Femtio famnar', desc: 'Fullborda 50 delve-vändor.' },
  dlv_solo_heroic: {
    name: 'Två är en för mycket',
    desc: 'Rensa en delve på heroisk nivå utan någon annan spelare, bara du och din följeslagare.',
  },
  dlv_tumbler_premium: {
    name: 'Tillhållarens väg, bemästrad',
    desc: 'Öppna en skyddad relikvariekista vid högsta insats, felfritt på ditt enda försök.',
  },
  dlv_rite_flawless: {
    name: 'Ordagrant',
    desc: 'Fullborda den dränkta relikvarieriten utan ett enda misstag.',
  },
  dlv_varric_ringers: {
    name: 'Klockorna tystnar',
    desc: 'Besegra Diakon Varric när varje begravningsringare han väcker redan är dräpt.',
  },
  dlv_nhalia_bells: {
    name: 'Klockstillare',
    desc: 'Besegra Syster Nhalia, den dränkta lovsången, utan att någon gruppmedlem träffas av en klämtande klocka.',
    title: 'Klockstillare',
  },
  chr_vale_chapter_i: {
    name: 'Dalskrönikan, kapitel I',
    desc: 'Avsluta det första kapitlet i Sauls krönika: Östbäcks första ärenden, kunskap om hur dalen ligger och en första smak av dess näringar.',
  },
  chr_vale_chapter_ii: {
    name: 'Dalskrönikan, kapitel II',
    desc: 'Avsluta det andra kapitlet i Sauls krönika: banditer, murlocker och gruvans ohyra nedgjorda, Suggfältet spelat och relikvariet trotsat.',
  },
  chr_vale_chapter_iii: {
    name: 'Dalens krönika',
    desc: 'Följ dalens hela berättelse till slutet: Gravkallaren avslöjad, Den ihåliga kryptan rensad och dalens alla namnkunniga fasor nedlagda.',
    title: 'av Dalen',
  },
  chr_vale_gatherer: {
    name: 'Vad marken ger',
    desc: 'Skörda en malmåder, en virkesdunge och en örttäppa i Östbäcksdalen.',
  },
  chr_vale_first_cast: {
    name: 'Något i Spegelsjön',
    desc: 'Fånga en fisk ur Östbäcksdalens vatten.',
  },
  chr_vale_packbreaker: { name: 'Flockbrytare', desc: 'Dräp 3 skogsvargar inom 10 sekunder.' },
  chr_vale_cup_debut: {
    name: 'Kopparspannens utmanare',
    desc: 'Gå ut på planen och rör bollen i en Dalcupsmatch på Suggfältet.',
  },
  chr_vale_rares: {
    name: 'Dalens fasor',
    desc: 'Dräp Östbäcksdalens fem namnkunniga fasor: Gamle Gråkäft, Mogger, Grix Tunnelkungen, Kapten Verlan och Vålnadsbindare Maldrec.',
  },
  chr_marsh_chapter_i: {
    name: 'Träskkrönikan, kapitel I',
    desc: 'Avsluta det första kapitlet i Osric Fenns krönika: hörsamma Kärrbros mönstring, säkra vägbanken och lär känna kärrets skepnad.',
  },
  chr_marsh_chapter_ii: {
    name: 'Träskkrönikan, kapitel II',
    desc: 'Avsluta det andra kapitlet i Osric Fenns krönika: änkorna utrökta, de drunknade lagda till ro, Torskfadern landad och litanian trotsad.',
  },
  chr_marsh_chapter_iii: {
    name: 'Dykärrets krönika',
    desc: 'Följ kärrets hela berättelse till slutet: kultlägret krossat, Fogbindern tystad i Den sjunkna bastionen och dimmans alla namnkunniga fasor nedlagda.',
    title: 'av Dykärret',
  },
  chr_marsh_gatherer: {
    name: 'Skörd vid Kärrbron',
    desc: 'Skörda en malmåder, en virkesdunge och en örttäppa i Dykärrsträsket.',
  },
  chr_marsh_unburst: {
    name: 'Stå inte i sporerna',
    desc: 'Dräp 8 kärrpösare utan att bli fångad i utbrottet från deras Frätande sporer.',
  },
  chr_marsh_hush_the_mending: {
    name: 'Tysta helandet',
    desc: 'Dräp en gravkallarhelare i Gravkallarlägret innan någon av kultisterna den vårdar faller.',
  },
  chr_marsh_rares: {
    name: 'Namn i dimman',
    desc: 'Dräp Dykärrsträskets tre namnkunniga fasor: Kärrkäft den glupske, Sloomtooth den drunknade och Syster Nhalia.',
  },
  chr_peaks_chapter_i: {
    name: 'Höjdkrönikan, kapitel I',
    desc: 'Avsluta det första kapitlet i Zenzies krönika: rensa åsvägen, töm gryten och lär dig varje stig som Högvakten vaktar.',
  },
  chr_peaks_chapter_ii: {
    name: 'Höjdkrönikan, kapitel II',
    desc: 'Avsluta det andra kapitlet i Zenzies krönika: krossa Drogmars krigsläger, tyd den vaknande stormen och stå där Skimmertjärnen glöder.',
  },
  chr_peaks_chapter_iii: {
    name: 'Törntoppens krönika',
    desc: 'Följ bergets hela berättelse till slutet: Lindormskulten krossad, helgedomen tystad, den vaknande toppen fälld och klippornas alla namnkunniga fasor nedlagda.',
    title: 'av Törntoppen',
  },
  chr_peaks_sparring: {
    name: 'Murövningar',
    desc: 'Tillfoga träningsdockan ovanför Högvakten sammanlagt 1 000 skada.',
  },
  chr_peaks_glimmer_cast: {
    name: 'Kallt vatten, kallare ljus',
    desc: 'Fånga en fisk ur Skimmertjärnen.',
  },
  chr_peaks_moongate: {
    name: 'Genom den kalla porten',
    desc: 'Kliv genom månporten vid Skimmertjärnens strand.',
  },
  chr_peaks_waking_witness: {
    name: 'Berget som vandrar',
    desc: 'Få syn på Thunzharr, den vaknande toppen, medan han skrider fram över berget.',
  },
  chr_peaks_rares: {
    name: 'Namn ristade i klippan',
    desc: 'Dräp Törntoppshöjdernas fyra namnkunniga fasor: Järnådersförmannen, Brutok Skallkrossare, Voskar Glödvingen och Märgherre Varkas.',
  },
  col_discovery_25: {
    name: 'Hamstrare',
    desc: 'Upptäck 25 olika föremål (ett föremål räknas första gången det någonsin hamnar i din ägo).',
  },
  col_discovery_75: { name: 'Skata', desc: 'Upptäck 75 olika föremål.' },
  col_discovery_150: {
    name: 'Kuriosakabinett',
    desc: 'Upptäck 150 olika föremål.',
    title: 'Intendenten',
  },
  col_discovery_250: { name: 'Den stora katalogen', desc: 'Upptäck 250 olika föremål.' },
  col_first_rare: { name: 'Något blått', desc: 'Skaffa ditt första föremål av sällsynt kvalitet.' },
  col_first_epic: { name: 'Född i purpurn', desc: 'Skaffa ditt första föremål av episk kvalitet.' },
  col_first_legendary: {
    name: 'Tur att den är orange',
    desc: 'Skaffa ditt första föremål av legendarisk kvalitet.',
  },
  col_set_vale_arcanist: {
    name: 'Dalarkanistens regalier',
    desc: 'Upptäck varje del av Dalarkanistens regalier.',
  },
  col_set_boundstone_vanguard: {
    name: 'Bundstensförtruppen',
    desc: 'Upptäck varje del av Bundstensförtruppen.',
  },
  col_set_greyjaw_stalker: {
    name: 'Gråkäftssmygarens utrustning',
    desc: 'Upptäck varje del av Gråkäftssmygarens utrustning.',
  },
  col_set_deathlord: {
    name: 'Barrowlords stridsutrustning',
    desc: 'Upptäck varje del av Barrowlords stridsutrustning.',
  },
  col_set_wyrmshadow: { name: 'Nightfang-skrud', desc: 'Upptäck varje del av Nightfang-skruden.' },
  col_set_necromancers: {
    name: 'Mournweave-klädnad',
    desc: 'Upptäck varje del av Mournweave-klädnaden.',
  },
  col_set_crownforged: {
    name: 'Bonewrought-regalier',
    desc: 'Upptäck varje del av Bonewrought-regalierna.',
  },
  col_set_nighttalon: { name: 'Direfang-päls', desc: 'Upptäck varje del av Direfang-pälsen.' },
  col_set_soulflame: {
    name: 'Wraithfire-regalier',
    desc: 'Upptäck varje del av Wraithfire-regalierna.',
  },
  col_set_stormcallers: { name: 'Galecall-skrud', desc: 'Upptäck varje del av Galecall-skruden.' },
  col_seven_regalia: {
    name: 'Den sjufaldiga garderoben',
    desc: 'Upptäck varje del av alla sju episka rustningsfamiljer.',
    title: 'den praktfulla',
  },
  col_true_colors: {
    name: 'Rätta färger',
    desc: 'Gå i fält iklädd ett annat utseende än din klass förvalda.',
  },
  col_all_slots: {
    name: 'Uppklädd till elvorna',
    desc: 'Ha ett föremål utrustat i alla elva utrustningsplatser samtidigt.',
  },
  col_quartermaster_buyout: {
    name: 'Stamkund',
    desc: 'Upptäck alla tio delar av den heroiska kvartersmästarens utbud.',
  },
  col_glimmerfin: { name: 'Ett skimmer av hopp', desc: 'Fånga en skimmerfenad koi.' },
  col_full_creel: {
    name: 'Full fiskekorg',
    desc: 'Upptäck alla sex vanliga fångster ur dalens, träskets och höjdernas vatten.',
  },
  col_junk_drawer: { name: 'Skräplådan', desc: 'Upptäck 10 olika föremål av usel kvalitet.' },
  pvp_arena_first_match: {
    name: 'Sand i stövlarna',
    desc: 'Utkämpa en rankad match i Askans colosseum, i valfri division.',
  },
  pvp_arena_first_win: {
    name: 'Publiken jublar',
    desc: 'Vinn en rankad arenamatch i valfri division.',
  },
  pvp_arena_1v1_1600: {
    name: 'Colosseets utmanare',
    desc: 'Nå 1600 i rating i arenans 1 mot 1-division.',
  },
  pvp_arena_1v1_1750: {
    name: 'Colosseets rival',
    desc: 'Nå 1750 i rating i arenans 1 mot 1-division.',
  },
  pvp_arena_1v1_1900: {
    name: 'Gladiator',
    desc: 'Nå 1900 i rating i arenans 1 mot 1-division.',
    title: 'Gladiator',
  },
  pvp_arena_2v2_1600: {
    name: 'Två man starka',
    desc: 'Nå 1600 i rating i arenans 2 mot 2-division.',
  },
  pvp_arena_2v2_1750: { name: 'Fruktad duo', desc: 'Nå 1750 i rating i arenans 2 mot 2-division.' },
  pvp_arena_2v2_1900: {
    name: 'Perfekta parhästar',
    desc: 'Nå 1900 i rating i arenans 2 mot 2-division.',
  },
  pvp_duel_first_win: { name: 'Ta det utanför', desc: 'Vinn en duell.' },
  pvp_duel_grace: {
    name: 'En läxa i ödmjukhet',
    desc: 'Förlora en duell med värdigheten någorlunda i behåll.',
  },
  pvp_vcup_first_match: {
    name: 'Stövlar på planen',
    desc: 'Spela färdigt en hel Dalcupsmatch på Suggfältet, oavsett vinst eller förlust.',
  },
  pvp_vcup_first_win: { name: 'Första bucklan', desc: 'Vinn en rankad Dalcupsmatch.' },
  pvp_vcup_wins_10: { name: 'Rutinerad vildsvinsbollare', desc: 'Vinn 10 rankade Dalcupsmatcher.' },
  pvp_vcup_wins_25: {
    name: 'Vildsvinsbollslegend',
    desc: 'Vinn 25 rankade Dalcupsmatcher.',
    title: 'Vildsvinsbollslegend',
  },
  pvp_vcup_first_goal: { name: 'Målkontot öppnat', desc: 'Gör ett mål i en rankad Dalcupsmatch.' },
  pvp_vcup_hat_trick: {
    name: 'Hattrickhjälte',
    desc: 'Gör tre mål i en och samma rankade Dalcupsmatch, i 3 mot 3-divisionen eller större.',
  },
  pvp_vcup_golden_goal: {
    name: 'Gyllene ögonblick',
    desc: 'Gör det gyllene mål som avgör en rankad Dalcupsmatch.',
  },
  pvp_vcup_first_save: {
    name: 'Säkra händer',
    desc: 'Gör en räddning som målvakt i en rankad Dalcupsmatch.',
  },
  pvp_vcup_clean_sheet: {
    name: 'Här kommer inget förbi',
    desc: 'Vinn en rankad Dalcupsmatch som målvakt utan att släppa in ett mål.',
  },
  pvp_vcup_guild_win: {
    name: 'För baneret',
    desc: 'Vinn en rankad Dalcupsmatch spelad under ditt gilles baner.',
  },
  pvp_fiesta_first_bout: {
    name: 'Objuden gäst',
    desc: 'Utkämpa en hel 2 mot 2-drabbning i Fiestan, oavsett vinst eller förlust.',
  },
  pvp_fiesta_first_win: {
    name: 'Festens medelpunkt',
    desc: 'Vinn en 2 mot 2-drabbning i Fiestan.',
  },
  pvp_fiesta_double: {
    name: 'Två flugor i en smäll',
    desc: 'Fäll två motståndare i Fiestan inom fyra sekunder.',
  },
  pvp_fiesta_shutdown: {
    name: 'Glädjedödare',
    desc: 'Fäll en Fiestamotståndare som är inne på en svit om tre eller fler.',
  },
  pvp_fiesta_full_build: {
    name: 'Klädd för tillfället',
    desc: 'Vinn en Fiestadrabbning med en förstärkning låst från var och en av de tre vågorna.',
  },
  pvp_fiesta_powerups: {
    name: 'En av varje',
    desc: 'Plocka upp var och en av ringens fyra kraftbonusar minst en gång: Fartdemon, Koloss, Månkängor och Bärsärk.',
  },
  pvp_fiesta_five_kills: {
    name: 'Bär hela festen',
    desc: 'Fäll fem motståndare i en och samma Fiestadrabbning.',
  },
  soc_first_party: { name: 'Bättre tillsammans', desc: 'Gå med i en grupp med en annan spelare.' },
  soc_full_house: { name: 'Fullt hus', desc: 'Rensa ett fängelsehål med en full grupp om fem.' },
  soc_guild_joined: { name: 'Under samma baner', desc: 'Bli medlem i ett gille.' },
  soc_guild_founded: { name: 'Grundarens fjäderpenna', desc: 'Grunda ett eget gille.' },
  soc_first_trade: { name: 'Ärligt byte', desc: 'Genomför en handel med en annan spelare.' },
  soc_first_sale: {
    name: 'Öppet för affärer',
    desc: 'Hämta ut mynten från din första försäljning på Världsmarknaden.',
  },
  soc_steady_custom: {
    name: 'Stadig kundkrets',
    desc: 'Hämta ut sammanlagt 10 guld från dina försäljningar på Världsmarknaden.',
  },
  soc_market_magnate: {
    name: 'Marknadsmagnat',
    desc: 'Hämta ut sammanlagt 100 guld från dina försäljningar på Världsmarknaden.',
    title: 'Magnaten',
  },
  soc_by_ravens_wing: {
    name: 'På korpens vingar',
    desc: 'Skicka ett korppostbrev med mynt eller ett paket.',
  },
  soc_room_for_more: { name: 'Plats för mer', desc: 'Köp din första valvutbyggnad.' },
  soc_gilded_strongbox: {
    name: 'Förgyllda kassakistan',
    desc: 'Köp varje valvutbyggnad som kamrerarna är villiga att sälja dig.',
  },
  soc_meet_bursar: {
    name: 'Vår Fernando är oss en väldig borg',
    desc: 'Visa din aktning för kamrer Fernando, Förgyllda kassakistans väktare i Östbäck.',
  },
  soc_pocket_money: { name: 'Fickpengar', desc: 'Plundra sammanlagt 1 guld i mynt.' },
  soc_heavy_purse: { name: 'Tung börs', desc: 'Plundra sammanlagt 10 guld i mynt.' },
  soc_wyrms_hoard: { name: 'En lindorms skatt', desc: 'Plundra sammanlagt 100 guld i mynt.' },
  soc_civic_duty: { name: 'Medborgerlig plikt', desc: 'Placera din första stadsfokuspoäng.' },
  exp_long_road_north: {
    name: 'Den långa vägen norrut',
    desc: 'Besök alla tre huvudorterna: Östbäck, Kärrbron och Högvakten.',
  },
  exp_vale_wayfarer: {
    name: 'Dalens vägfarare',
    desc: 'Besök alla elva namngivna platser i Östbäcksdalen.',
  },
  exp_marsh_wayfarer: {
    name: 'Träskets vägfarare',
    desc: 'Besök alla åtta namngivna platser i Dykärrsträsket.',
  },
  exp_peaks_wayfarer: {
    name: 'Höjdernas vägfarare',
    desc: 'Besök alla tio namngivna platser i Törntoppshöjderna.',
  },
  exp_world_traveler: {
    name: 'Världsresenär',
    desc: 'Fullborda vägfararbedriften i alla tre zonerna.',
    title: 'Vägfararen',
  },
  exp_something_shiny: {
    name: 'Något som glimmar',
    desc: 'Plocka upp ett gnistrande föremål från marken.',
  },
  exp_first_ore: { name: 'Hugg i berget', desc: 'Skörda din första malmådra.' },
  exp_first_timber: { name: 'Träd faller!', desc: 'Skörda ditt första timmerbestånd.' },
  exp_first_herb: { name: 'Gröna fingrar', desc: 'Skörda ditt första örtstånd.' },
  feat_era_cap: { name: 'Första erans barn', desc: 'Nådde nivå 20 medan Första eran ännu rådde.' },
  feat_book_complete: { name: 'Hela boken', desc: 'Fullborda varenda bedrift i Bedrifternas bok.' },
  feat_brightwood_relic: {
    name: 'Till minne av Ljusskogen',
    desc: 'Bevara en relik från den gamla Ljusskogen: Snårhudsjackan eller Monarkens krona.',
  },
  hid_saul_footnote: {
    name: 'En fotnot i historien',
    desc: 'Tjatade på krönikören Saul nio gånger utan uppehåll.',
    title: 'Fotnoten',
  },
  hid_gilded_tour: {
    name: 'Den förgyllda rundturen',
    desc: 'Gjorde affärer med alla tre filialerna av Förgyllda kassakistan.',
  },
  hid_fall_death: { name: 'Tyngdlagen vinner alltid', desc: 'Dog av ett långt samtal med marken.' },
  hid_keepers_toll_twice: {
    name: 'Väktaren kräver dubbelt',
    desc: 'Dog medan Väktarens tull ännu vilade tungt på dig.',
  },
  hid_roll_hundred: { name: 'Naturlig hundra', desc: 'Slog en perfekt 100 på ett vanligt /roll.' },
  hid_yumi_cheer: {
    name: 'Yumis största beundrare',
    desc: 'Hejade på Yumi där hon kunde höra dig, mitt under en drabbning.',
  },
  hid_bountiful_coffer: {
    name: 'Purpurskrinet',
    desc: 'Knäckte ett Givmilt skrin innan det hann gå i baklås.',
  },
  hid_companion_save: {
    name: 'Inte på hennes vakt',
    desc: 'Din delveföljeslagare drog en fallen gruppkamrat på fötter igen.',
  },
  hid_codfather: { name: 'Upptagen i familjen', desc: 'Drog upp Torskfadern ur Djupkärrsgrunden.' },
  prog_crown_below: {
    name: 'Kronan därnere',
    desc: 'Följ kronan från de rastlösa benfälten till kung Nythraxis grav och fullborda Gisslets slut.',
  },
  prog_mere_at_rest: {
    name: 'Tjärnen till ro',
    desc: 'Följ tidväktaren Ondrel Vanes vaka till dess slut: kören tystad, Blekringeln dräpt och den dränkta månen lagd till ro.',
  },
  prog_callused_hands: {
    name: 'Valkiga händer',
    desc: 'Slutför Ett yrke för varje hand och förtjäna din första valk i Östbäcks hantverk.',
  },
  prog_tools_of_the_trade: {
    name: 'Yrkets verktyg',
    desc: 'Slutför ett stationsbundet hantverk vid Högvaktens hantverksnav.',
  },
  dgn_nythraxis_crypt: {
    name: 'Vad kryptan gömde',
    desc: 'Trotsa Den övergivna kryptan och återta båda nyckelstenshalvorna och den uråldriga dagboken från dess väktare.',
  },
  chr_marsh_first_cast: { name: 'Ålar i vassen', desc: 'Fånga en fisk ur Dykärrsträskets vatten.' },
};
