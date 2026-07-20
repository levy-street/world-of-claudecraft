// Deed name / desc / title locale table for nl_NL (data-as-code, size-exempt).
// One per-base-locale chunk behind DEED_LOCALE_LOADERS in deed_i18n.ts, so a
// visitor downloads only their own locale's deed strings. Split verbatim from
// the former deed_i18n.newlocales.ts single chunk; values carry no em or en
// dashes (repo copy rule). English (en / en_CA) resolves to the authored
// source before this table is consulted.
import type { DeedLocaleTable } from '../deed_i18n';

export const table: DeedLocaleTable = {
  pvp_card_duel_first_win: {
    name: 'Eigen Spelregels',
    desc: 'Win een Kaartduel bij de Kaartmeester.',
  },
  prog_first_steps: {
    name: 'Eerste Stappen',
    desc: 'Bereik level 2 en zet je eerste stap op een lange weg.',
  },
  prog_finding_your_feet: {
    name: 'Je Draai Vinden',
    desc: 'Bereik level 5; de wildernis oogt al een stukje kleiner.',
  },
  prog_double_digits: {
    name: 'Dubbele Cijfers',
    desc: 'Bereik level 10 en ontgrendel je talenten.',
  },
  prog_the_long_middle: { name: 'Het Lange Midden', desc: 'Bereik level 15.' },
  prog_level_cap: {
    name: 'Het Uitzicht vanaf de Top',
    desc: 'Bereik level 20, het hoogste level.',
  },
  prog_well_rested: {
    name: 'Goed Uitgerust',
    desc: 'Nestel je in een herberg tot je uitgeruste ervaring hebt verdiend.',
  },
  prog_talented: { name: 'Een Punt Goed Besteed', desc: 'Besteed je eerste talentpunt.' },
  prog_specialized: {
    name: 'Kleur Bekennen',
    desc: 'Kies een specialisatie en leer haar kenmerkende vaardigheid.',
  },
  prog_deep_roots: {
    name: 'Diepe Wortels',
    desc: 'Besteed een talentpunt aan een talent uit de onderste rij.',
  },
  prog_full_build: {
    name: 'Het Volle Zestal',
    desc: 'Kies binnen één build één optie in alle zes talentrijen.',
  },
  prog_veteran: {
    name: 'Veteraan',
    desc: 'Verdien over je hele levensloop 250.000 ervaring.',
    title: 'Veteraan',
  },
  prog_champion: {
    name: 'Kampioen',
    desc: 'Verdien over je hele levensloop 500.000 ervaring.',
    title: 'Kampioen',
  },
  prog_paragon: {
    name: 'Toonbeeld',
    desc: 'Verdien over je hele levensloop 1.000.000 ervaring.',
    title: 'Toonbeeld',
  },
  prog_mythic: {
    name: 'Mythisch',
    desc: 'Verdien over je hele levensloop 2.500.000 ervaring.',
    title: 'Mythisch',
  },
  prog_eternal: {
    name: 'Eeuwig',
    desc: 'Verdien over je hele levensloop 5.000.000 ervaring.',
    title: 'Eeuwig',
  },
  prog_prestige: {
    name: 'Opnieuw Beginnen',
    desc: 'Bereik het hoogste level, vul de balk nog eens en eis prestigerang 1 op.',
  },
  prog_prestige_5: { name: 'Oude Gewoonten', desc: 'Bereik prestigerang 5.' },
  prog_prestige_10: { name: 'Perpetuum Mobile', desc: 'Bereik prestigerang 10.' },
  prog_first_harvest: { name: 'Vruchten van het Veld', desc: 'Oogst je eerste verzamelplek.' },
  prog_mining_100: { name: 'Erts in het Bloed', desc: 'Bereik 100 vaardigheid in Mijnbouw.' },
  prog_logging_100: { name: 'Kernhouthakker', desc: 'Bereik 100 vaardigheid in Houthakken.' },
  prog_herbalism_100: {
    name: 'Meester van de Weide',
    desc: 'Bereik 100 vaardigheid in Kruidenkunde.',
  },
  prog_master_gatherer: {
    name: 'Meesterverzamelaar',
    desc: 'Bereik 100 vaardigheid in Mijnbouw, Houthakken en Kruidenkunde.',
  },
  prog_first_craft: { name: 'Handwerk', desc: 'Voltooi je eerste geslaagde ambachtswerk.' },
  prog_craft_specialist: {
    name: 'Vakgeheimen',
    desc: 'Bereik 75 vaardigheid in één ambacht en ontgrendel de bijbehorende specialisatievoordelen.',
  },
  prog_around_the_ring: {
    name: 'De Ring Rond',
    desc: 'Bereik 25 vaardigheid in vijf verschillende ambachten.',
  },
  cmb_first_blood: { name: 'Eerste Bloed', desc: 'Versla je eerste vijand.' },
  cmb_slayer: { name: 'Slachter', desc: 'Versla 1.000 vijanden.' },
  cmb_legion_of_one: { name: 'Eenmanslegioen', desc: 'Versla 10.000 vijanden.' },
  cmb_heavy_hitter: { name: 'Zware Jongen', desc: 'Deel in totaal 500.000 schade uit.' },
  cmb_critical_eye: { name: 'Kritisch Oog', desc: 'Plaats 500 kritieke treffers.' },
  cmb_giantslayer: {
    name: 'Reuzendoder',
    desc: 'Deel de genadeslag uit aan een vijand die minstens vijf levels boven je staat.',
  },
  cmb_first_fall: {
    name: 'Klop Het Stof Eraf',
    desc: 'Sterf voor het eerst; het overkomt de besten onder ons.',
  },
  dgn_hollow_crypt: {
    name: 'Cryptebreker',
    desc: 'Versla Morthen de Grafroeper in de Holle Crypte.',
  },
  dgn_sunken_bastion: {
    name: 'De Fogbinder Ontbonden',
    desc: 'Versla Vael de Fogbinder in het Verzonken Bastion.',
  },
  dgn_drowned_temple: {
    name: 'De Maan Verdrinken',
    desc: 'Versla Ysolei, Avatar van de Verdronken Maan, in de Verdronken Tempel.',
  },
  dgn_gravewyrm_sanctum: {
    name: 'De Wurm Beneden',
    desc: 'Versla Korzul de Grafwurm in het Grafwurm-Heiligdom.',
  },
  dgn_hollow_crypt_heroic: {
    name: 'Heroïsch: De Holle Crypte',
    desc: 'Versla Morthen de Grafroeper in de Holle Crypte op Heroïsche moeilijkheidsgraad.',
  },
  dgn_sunken_bastion_heroic: {
    name: 'Heroïsch: Het Verzonken Bastion',
    desc: 'Versla Vael de Fogbinder in het Verzonken Bastion op Heroïsche moeilijkheidsgraad.',
  },
  dgn_drowned_temple_heroic: {
    name: 'Heroïsch: De Verdronken Tempel',
    desc: 'Versla Ysolei, Avatar van de Verdronken Maan, in de Verdronken Tempel op Heroïsche moeilijkheidsgraad.',
  },
  dgn_gravewyrm_sanctum_heroic: {
    name: 'Heroïsch: Grafwurm-Heiligdom',
    desc: 'Versla Korzul de Grafwurm in het Grafwurm-Heiligdom op Heroïsche moeilijkheidsgraad.',
  },
  dgn_nythraxis: {
    name: 'Geen Gesel Meer',
    desc: 'Versla Nythraxis, Gesel van Doorntop, achter de verzegelde koninklijke deur.',
  },
  dgn_nythraxis_heroic: {
    name: 'Heroïsch: Geen Gesel Meer',
    desc: 'Versla Nythraxis, Gesel van Doorntop, op Heroïsche moeilijkheidsgraad.',
  },
  dgn_thornpeak_rounds: {
    name: 'De Ronde Doen',
    desc: 'Zuiver de Holle Crypte, het Verzonken Bastion, de Verdronken Tempel en het Grafwurm-Heiligdom.',
  },
  dgn_deepward: {
    name: 'Diepwacht',
    desc: 'Bedwing elke kerker, de raid en beide delves op Heroïsche moeilijkheidsgraad.',
  },
  dgn_mark_circuit: {
    name: 'Het Volledige Circuit',
    desc: 'Verdien op één dag Heroïsche Merken uit alle vier de Heroïsche kerkers.',
  },
  dgn_boss_clears_50: { name: 'Vijftig Deuren Verder', desc: 'Versla 50 eindbazen van kerkers.' },
  dgn_morthen_flawless: {
    name: 'Geen Botje Gebroken',
    desc: 'Versla Morthen de Grafroeper op Heroïsche moeilijkheidsgraad zonder dat een groepslid sterft.',
  },
  dgn_morthen_trio: {
    name: 'Drie Tegen het Graf',
    desc: 'Versla Morthen de Grafroeper met drie of minder spelers.',
  },
  dgn_olen_arc: {
    name: 'De Maaier Ontweken',
    desc: 'Versla Ridder-Commandant Olen zonder dat zijn Maaiboog iemand anders raakt dan zijn huidige doelwit.',
  },
  dgn_vael_thralls: {
    name: 'Niemands Lijfeigene',
    desc: 'Versla Vael de Fogbinder terwijl elke Verdronken Lijfeigene die hij oproept al geveld is.',
  },
  dgn_ysolei_moonspawn: {
    name: 'Tot de Laatste Maanspruit',
    desc: 'Versla Ysolei terwijl elke Maanspruit die zij oproept al geveld is.',
  },
  dgn_ysolei_flawless: {
    name: 'Droge Ogen',
    desc: 'Versla Ysolei, Avatar van de Verdronken Maan, op Heroïsche moeilijkheidsgraad zonder dat een groepslid sterft.',
  },
  dgn_velkhar_bonewalkers: {
    name: 'Blijf Begraven',
    desc: 'Versla Groot-Necromantiër Velkhar terwijl elke Verrezen Botloper vernietigd is voordat Velkhar zelf valt.',
  },
  dgn_korzul_flawless: {
    name: 'Wurmveller',
    desc: 'Versla Korzul de Grafwurm op Heroïsche moeilijkheidsgraad zonder dat een groepslid sterft.',
    title: 'Wurmveller',
  },
  dgn_sanctum_speed: {
    name: 'Heiligdomssprint',
    desc: 'Versla Korzul de Grafwurm binnen 15 minuten nadat je groep het Grafwurm-Heiligdom heeft opgeëist.',
  },
  dgn_nythraxis_gravebreaker: {
    name: 'Kniel voor Geen Koning',
    desc: 'Versla Nythraxis zonder dat Grafbreker ooit iemand anders raakt dan zijn huidige doelwit.',
  },
  dgn_nythraxis_wardens: {
    name: 'Hoeders van de Wachtstenen',
    desc: 'Versla Nythraxis waarbij elke Doodloze Woede wordt gebroken voordat die losbarst.',
  },
  dgn_nythraxis_deathless: {
    name: 'Niemand Doodlozer',
    desc: 'Versla Nythraxis, Gesel van Doorntop, op Heroïsche moeilijkheidsgraad zonder dat één raider sterft.',
    title: 'de Doodloze',
  },
  cmb_thunzharr: {
    name: 'De Berg Viel',
    desc: 'Vel Thunzharr, de Ontwakende Piek, bij Stormrots.',
  },
  cmb_thunzharr_unbroken: {
    name: 'Piekbreker',
    desc: 'Vel Thunzharr, de Ontwakende Piek, zonder te sterven, van jouw eerste slag tot zijn laatste adem.',
    title: 'Piekbreker',
  },
  cmb_thunzharr_ten: {
    name: 'Bergen als Gewoonte',
    desc: 'Vel Thunzharr, de Ontwakende Piek, tien keer.',
  },
  dlv_reliquary: { name: 'Schrijnloper', desc: 'Zuiver het Ingestorte Reliekschrijn.' },
  dlv_reliquary_heroic: {
    name: 'Heroïsch: Het Ingestorte Reliekschrijn',
    desc: 'Zuiver het Ingestorte Reliekschrijn op het Heroïsche niveau.',
  },
  dlv_litany: { name: 'Stil de Litanie', desc: 'Zuiver de Verdronken Litanie.' },
  dlv_litany_heroic: {
    name: 'Heroïsch: De Verdronken Litanie',
    desc: 'Zuiver de Verdronken Litanie op het Heroïsche niveau.',
  },
  dlv_lore_journal: {
    name: 'Marginalia',
    desc: 'Ontgrendel alle vijf de aantekeningen in het delve-dagboek.',
  },
  dlv_companion_max: {
    name: 'Een Vriendin in de Diepte',
    desc: 'Breng een delve-metgezel naar haar hoogste rang.',
  },
  dlv_companions_both: {
    name: 'Beide Lantaarns Ontstoken',
    desc: 'Breng beide delve-metgezellen, Acoliet Tessa en Edda Reedhand, naar hun hoogste rang.',
  },
  dlv_clears_50: { name: 'Vijftig Vadem', desc: 'Voltooi 50 delve-tochten.' },
  dlv_solo_heroic: {
    name: 'Twee is al een Menigte',
    desc: 'Zuiver een delve op het Heroïsche niveau zonder enige andere speler, alleen jij en je metgezel.',
  },
  dlv_tumbler_premium: {
    name: 'Het Pad van de Tuimelaar, Volleerd',
    desc: 'Open een beschermde reliekschrijnkist op de hoogste inzet, foutloos bij je enige poging.',
  },
  dlv_rite_flawless: {
    name: 'Zonder Haperen',
    desc: 'Voltooi de Rite van het Verdronken Reliekschrijn zonder een enkele fout.',
  },
  dlv_varric_ringers: {
    name: 'De Klokken Verstommen',
    desc: 'Versla Diaken Varric terwijl elke Doodsklokluider die hij doet verrijzen al gedood is.',
  },
  dlv_nhalia_bells: {
    name: 'Klokkenstiller',
    desc: 'Versla Zuster Nhalia, de Verdronken Lofzang, zonder dat een groepslid door een Luidende Klok wordt geraakt.',
    title: 'Klokkenstiller',
  },
  chr_vale_chapter_i: {
    name: 'Dalkroniek, Hoofdstuk I',
    desc: 'Voltooi het eerste hoofdstuk van Sauls kroniek: de eerste boodschappen van Oostbeek, de ligging van het Dal en een eerste proeve van zijn ambachten.',
  },
  chr_vale_chapter_ii: {
    name: 'Dalkroniek, Hoofdstuk II',
    desc: 'Voltooi het tweede hoofdstuk van Sauls kroniek: bandieten, murlocs en mijnongedierte neergeslagen, op het Zeugveld gespeeld en het Reliekschrijn getrotseerd.',
  },
  chr_vale_chapter_iii: {
    name: 'Kroniek van het Dal',
    desc: 'Breng het hele verhaal van het Dal tot een einde: de Grafroeper ontmaskerd, de Holle Crypte gezuiverd en elke naamdragende verschrikking van het Dal geveld.',
    title: 'van het Dal',
  },
  chr_vale_gatherer: {
    name: 'Leven van het Land',
    desc: 'Oogst een ertsader, een houtopstand en een kruidenveldje in Oostbeekdal.',
  },
  chr_vale_first_cast: {
    name: 'Er Zit Iets in het Spiegelmeer',
    desc: 'Vang een vis in de wateren van Oostbeekdal.',
  },
  chr_vale_packbreaker: { name: 'Roedelbreker', desc: 'Dood 3 Boswolven binnen 10 seconden.' },
  chr_vale_cup_debut: {
    name: 'Kanshebber op de Koperen Emmer',
    desc: 'Betreed het veld en raak de bal in een Dalbeker-wedstrijd op het Zeugveld.',
  },
  chr_vale_rares: {
    name: 'Verschrikkingen van het Dal',
    desc: 'Dood de vijf naamdragende verschrikkingen van Oostbeekdal: Oude Grijskaak, Mogger, Grix de Tunnelkoning, Kapitein Verlan en Schimbinder Maldrec.',
  },
  chr_marsh_chapter_i: {
    name: 'Moeraskroniek, Hoofdstuk I',
    desc: 'Voltooi het eerste hoofdstuk van Osric Fenns kroniek: geef gehoor aan de mobilisatie van Veenbrug, stel de dijkweg veilig en leer de vorm van het veen kennen.',
  },
  chr_marsh_chapter_ii: {
    name: 'Moeraskroniek, Hoofdstuk II',
    desc: 'Voltooi het tweede hoofdstuk van Osric Fenns kroniek: de weduwen uitgerookt, de verdronkenen te ruste gelegd, de Kabeljauwvader aan land gehaald en de Litanie getrotseerd.',
  },
  chr_marsh_chapter_iii: {
    name: 'Kroniek van het Slijkveen',
    desc: 'Breng het hele verhaal van het veen tot een einde: het sektekamp gebroken, de Fogbinder tot zwijgen gebracht in het Verzonken Bastion en elke naamdragende verschrikking van de nevel geveld.',
    title: 'van het Slijkveen',
  },
  chr_marsh_gatherer: {
    name: 'Foerageren bij Veenbrug',
    desc: 'Oogst een ertsader, een houtopstand en een kruidenveldje in Slijkveenmoeras.',
  },
  chr_marsh_unburst: {
    name: 'Blijf Niet in de Sporen Staan',
    desc: 'Dood 8 Moerasbulten zonder in hun uitbarsting van Bijtende Sporen terecht te komen.',
  },
  chr_marsh_hush_the_mending: {
    name: 'Smoor de Heling',
    desc: 'Dood in het Grafroeper-Kampement een Grafroeper-Heler voordat ook maar een van de sektelingen die hij verzorgt sterft.',
  },
  chr_marsh_rares: {
    name: 'Namen in de Nevel',
    desc: 'Dood de drie naamdragende verschrikkingen van Slijkveenmoeras: Slijkkaak de Vraatzuchtige, Sloomtooth de Verdronkene en Zuster Nhalia.',
  },
  chr_peaks_chapter_i: {
    name: 'Hoogtenkroniek, Hoofdstuk I',
    desc: 'Voltooi het eerste hoofdstuk van Zenzies kroniek: veeg de bergkamweg schoon, ruim de holen leeg en leer elk pad kennen dat Hoogwacht bewaakt.',
  },
  chr_peaks_chapter_ii: {
    name: 'Hoogtenkroniek, Hoofdstuk II',
    desc: 'Voltooi het tweede hoofdstuk van Zenzies kroniek: breek Drogmars oorlogskamp, doorgrond de ontwakende storm en sta waar de Glinstermeer gloeit.',
  },
  chr_peaks_chapter_iii: {
    name: 'Kroniek van Doorntop',
    desc: 'Breng het hele verhaal van de berg tot een einde: de Wurmcultus gebroken, het Heiligdom tot zwijgen gebracht, de Ontwakende Piek geveld en elke naamdragende verschrikking van de rotsen ten val gebracht.',
    title: 'van Doorntop',
  },
  chr_peaks_sparring: {
    name: 'Muuroefeningen',
    desc: 'Breng in totaal 1.000 schade toe aan de oefenpop boven Hoogwacht.',
  },
  chr_peaks_glimmer_cast: {
    name: 'Koud Water, Kouder Licht',
    desc: 'Vang een vis in de Glinstermeer.',
  },
  chr_peaks_moongate: {
    name: 'Door de Koude Poort',
    desc: 'Stap door de maanpoort aan de oever van de Glinstermeer.',
  },
  chr_peaks_waking_witness: {
    name: 'De Berg Die Loopt',
    desc: 'Aanschouw Thunzharr, de Ontwakende Piek terwijl hij over de berg schrijdt.',
  },
  chr_peaks_rares: {
    name: 'Namen in de Rots Gekerfd',
    desc: 'Dood de vier naamdragende verschrikkingen van Doorntop-Hoogten: de IJzerader-Voorman, Brutok Schedelverbrijzelaar, Voskar de Sintelvleugel en Mergheer Varkas.',
  },
  col_discovery_25: {
    name: 'Hamsteraar',
    desc: 'Ontdek 25 verschillende voorwerpen (een voorwerp telt de eerste keer dat het ooit in je bezit komt).',
  },
  col_discovery_75: { name: 'Ekster', desc: 'Ontdek 75 verschillende voorwerpen.' },
  col_discovery_150: {
    name: 'Rariteitenkabinet',
    desc: 'Ontdek 150 verschillende voorwerpen.',
    title: 'de Curator',
  },
  col_discovery_250: { name: 'De Grote Catalogus', desc: 'Ontdek 250 verschillende voorwerpen.' },
  col_first_rare: {
    name: 'Iets Blauws',
    desc: 'Bemachtig je eerste voorwerp van zeldzame kwaliteit.',
  },
  col_first_epic: {
    name: 'In het Purper Geboren',
    desc: 'Bemachtig je eerste voorwerp van epische kwaliteit.',
  },
  col_first_legendary: {
    name: 'Oranje Boven',
    desc: 'Bemachtig je eerste voorwerp van legendarische kwaliteit.',
  },
  col_set_vale_arcanist: {
    name: 'Regalia van de Dal-Arcanist',
    desc: 'Ontdek elk onderdeel van de Regalia van de Dal-Arcanist.',
  },
  col_set_boundstone_vanguard: {
    name: 'Bandsteen-Voorhoede',
    desc: 'Ontdek elk onderdeel van de Bandsteen-Voorhoede.',
  },
  col_set_greyjaw_stalker: {
    name: 'Uitrusting van de Grijskaak-Sluiper',
    desc: 'Ontdek elk onderdeel van de Uitrusting van de Grijskaak-Sluiper.',
  },
  col_set_deathlord: {
    name: 'Barrowlord-Strijduitrusting',
    desc: 'Ontdek elk onderdeel van de Barrowlord-Strijduitrusting.',
  },
  col_set_wyrmshadow: {
    name: 'Nightfang-Gewaden',
    desc: 'Ontdek elk onderdeel van de Nightfang-Gewaden.',
  },
  col_set_necromancers: {
    name: 'Mournweave-Dracht',
    desc: 'Ontdek elk onderdeel van de Mournweave-Dracht.',
  },
  col_set_crownforged: {
    name: 'Bonewrought-Regalia',
    desc: 'Ontdek elk onderdeel van de Bonewrought-Regalia.',
  },
  col_set_nighttalon: {
    name: 'Direfang-Vacht',
    desc: 'Ontdek elk onderdeel van de Direfang-Vacht.',
  },
  col_set_soulflame: {
    name: 'Wraithfire-Regalia',
    desc: 'Ontdek elk onderdeel van de Wraithfire-Regalia.',
  },
  col_set_stormcallers: {
    name: 'Galecall-Gewaden',
    desc: 'Ontdek elk onderdeel van de Galecall-Gewaden.',
  },
  col_seven_regalia: {
    name: 'De Zevenvoudige Garderobe',
    desc: 'Ontdek elk onderdeel van alle zeven epische uitrustingsfamilies.',
    title: 'de Luisterrijke',
  },
  col_true_colors: {
    name: 'Ware Kleuren',
    desc: 'Betreed het veld in een ander uiterlijk dan de standaard van je klasse.',
  },
  col_all_slots: {
    name: 'Tot in de Elf Puntjes',
    desc: 'Draag tegelijkertijd een voorwerp in alle elf uitrustingsvakken.',
  },
  col_quartermaster_buyout: {
    name: 'Vaste Klant',
    desc: 'Ontdek alle tien de stukken uit de voorraad van de Heroïsche Kwartiermeester.',
  },
  col_glimmerfin: { name: 'Een Glansje Hoop', desc: 'Vang een Glansvin-Koi.' },
  col_full_creel: {
    name: 'Volle Viskorf',
    desc: 'Ontdek alle zes de gewone vangsten uit de wateren van het Dal, het Moeras en de Hoogten.',
  },
  col_junk_drawer: {
    name: 'De Rommellade',
    desc: 'Ontdek 10 verschillende voorwerpen van armzalige kwaliteit.',
  },
  pvp_arena_first_match: {
    name: 'Zand in je Laarzen',
    desc: 'Vecht een geklasseerde wedstrijd uit in het Asgrauwe Colosseum, in een van beide divisies.',
  },
  pvp_arena_first_win: {
    name: 'De Menigte Brult',
    desc: 'Win een geklasseerde arenawedstrijd in een van beide divisies.',
  },
  pvp_arena_1v1_1600: {
    name: 'Kanshebber van het Colosseum',
    desc: 'Bereik een rating van 1600 in de 1v1-arenadivisie.',
  },
  pvp_arena_1v1_1750: {
    name: 'Rivaal van het Colosseum',
    desc: 'Bereik een rating van 1750 in de 1v1-arenadivisie.',
  },
  pvp_arena_1v1_1900: {
    name: 'Gladiator',
    desc: 'Bereik een rating van 1900 in de 1v1-arenadivisie.',
    title: 'Gladiator',
  },
  pvp_arena_2v2_1600: {
    name: 'Twee Man Sterk',
    desc: 'Bereik een rating van 1600 in de 2v2-arenadivisie.',
  },
  pvp_arena_2v2_1750: {
    name: 'Geducht Duo',
    desc: 'Bereik een rating van 1750 in de 2v2-arenadivisie.',
  },
  pvp_arena_2v2_1900: {
    name: 'Perfect Samenspel',
    desc: 'Bereik een rating van 1900 in de 2v2-arenadivisie.',
  },
  pvp_duel_first_win: { name: 'Dat Lossen We Buiten Op', desc: 'Win een duel.' },
  pvp_duel_grace: {
    name: 'Een Les in Nederigheid',
    desc: 'Verlies een duel met je waardigheid grotendeels intact.',
  },
  pvp_vcup_first_match: {
    name: 'Het Veld Op',
    desc: 'Speel een volledige Dalbeker-wedstrijd op het Zeugveld uit, winst of verlies.',
  },
  pvp_vcup_first_win: {
    name: 'Het Eerste Zilverwerk',
    desc: 'Win een geklasseerde Dalbeker-wedstrijd.',
  },
  pvp_vcup_wins_10: {
    name: 'Doorgewinterde Zwijnenballer',
    desc: 'Win 10 geklasseerde Dalbeker-wedstrijden.',
  },
  pvp_vcup_wins_25: {
    name: 'Zwijnenbal-Legende',
    desc: 'Win 25 geklasseerde Dalbeker-wedstrijden.',
    title: 'Zwijnenbal-Legende',
  },
  pvp_vcup_first_goal: {
    name: 'De Ban Gebroken',
    desc: 'Scoor een doelpunt in een geklasseerde Dalbeker-wedstrijd.',
  },
  pvp_vcup_hat_trick: {
    name: 'Hattrickheld',
    desc: 'Scoor drie doelpunten in een enkele geklasseerde Dalbeker-wedstrijd, in de 3v3-divisie of groter.',
  },
  pvp_vcup_golden_goal: {
    name: 'Gouden Moment',
    desc: 'Scoor de golden goal die een geklasseerde Dalbeker-wedstrijd beslist.',
  },
  pvp_vcup_first_save: {
    name: 'Veilige Handen',
    desc: 'Verricht een redding als keeper in een geklasseerde Dalbeker-wedstrijd.',
  },
  pvp_vcup_clean_sheet: {
    name: 'De Nul Gehouden',
    desc: 'Win een geklasseerde Dalbeker-wedstrijd als keeper zonder een doelpunt tegen te krijgen.',
  },
  pvp_vcup_guild_win: {
    name: 'Voor het Vaandel',
    desc: 'Win een geklasseerde Dalbeker-wedstrijd, aangetreden onder het vaandel van je gilde.',
  },
  pvp_fiesta_first_bout: {
    name: 'Ongenode Gast',
    desc: 'Vecht een volledige 2v2 Fiesta-partij uit, winst of verlies.',
  },
  pvp_fiesta_first_win: { name: 'De Gangmaker van de Fiesta', desc: 'Win een 2v2 Fiesta-partij.' },
  pvp_fiesta_double: {
    name: 'Dubbelslag',
    desc: 'Scoor twee Fiesta-uitschakelingen binnen vier seconden.',
  },
  pvp_fiesta_shutdown: {
    name: 'Spelbreker',
    desc: 'Schakel een Fiesta-tegenstander uit die een reeks van drie of meer heeft lopen.',
  },
  pvp_fiesta_full_build: {
    name: 'Gekleed voor de Gelegenheid',
    desc: 'Win een Fiesta-partij met een vastgezette versterking uit elk van de drie golven.',
  },
  pvp_fiesta_powerups: {
    name: 'Van Alles Eén',
    desc: 'Pak elk van de vier power-ups in de ring minstens één keer: Snelheidsduivel, Kolos, Maanlaarzen en Berserker.',
  },
  pvp_fiesta_five_kills: {
    name: 'De Kar Trekken',
    desc: 'Scoor vijf uitschakelingen in een enkele Fiesta-partij.',
  },
  soc_first_party: { name: 'Samen Sterker', desc: 'Vorm een groep met een andere speler.' },
  soc_full_house: {
    name: 'Full House',
    desc: 'Zuiver een kerker met een voltallige groep van vijf.',
  },
  soc_guild_joined: { name: 'Onder Eén Vaandel', desc: 'Word lid van een gilde.' },
  soc_guild_founded: { name: 'De Veerpen van de Stichter', desc: 'Sticht je eigen gilde.' },
  soc_first_trade: { name: 'Een Eerlijke Ruil', desc: 'Voltooi een ruil met een andere speler.' },
  soc_first_sale: {
    name: 'Open voor Zaken',
    desc: 'Strijk de munten van je eerste verkoop op de Wereldmarkt op.',
  },
  soc_steady_custom: {
    name: 'Vaste Klandizie',
    desc: 'Strijk een levenstotaal van 10 goud op uit je verkopen op de Wereldmarkt.',
  },
  soc_market_magnate: {
    name: 'Marktmagnaat',
    desc: 'Strijk een levenstotaal van 100 goud op uit je verkopen op de Wereldmarkt.',
    title: 'Magnaat',
  },
  soc_by_ravens_wing: {
    name: 'Op Ravenwieken',
    desc: 'Verstuur een Ravenpost-brief met munten of een pakket.',
  },
  soc_room_for_more: { name: 'Ruimte voor Meer', desc: 'Koop je eerste bankuitbreiding.' },
  soc_gilded_strongbox: {
    name: 'De Vergulde Geldkist',
    desc: 'Koop elke bankuitbreiding die de thesauriers je willen verkopen.',
  },
  soc_meet_bursar: {
    name: 'Op Fernando Vertrouwen Wij',
    desc: 'Betuig je respect aan Thesaurier Fernando, hoeder van De Vergulde Geldkist in Oostbeek.',
  },
  soc_pocket_money: { name: 'Zakgeld', desc: 'Maak een levenstotaal van 1 goud aan munten buit.' },
  soc_heavy_purse: {
    name: 'Een Zware Buidel',
    desc: 'Maak een levenstotaal van 10 goud aan munten buit.',
  },
  soc_wyrms_hoard: {
    name: 'Een Wurmschat',
    desc: 'Maak een levenstotaal van 100 goud aan munten buit.',
  },
  soc_civic_duty: { name: 'Burgerplicht', desc: 'Wijs je eerste stadsfocuspunt toe.' },
  exp_long_road_north: {
    name: 'De Lange Weg naar het Noorden',
    desc: 'Bezoek alle drie de hoofdnederzettingen: Oostbeek, Veenbrug en Hoogwacht.',
  },
  exp_vale_wayfarer: {
    name: 'Doler van het Dal',
    desc: 'Bezoek alle elf benoemde plekken van het Oostbeekdal.',
  },
  exp_marsh_wayfarer: {
    name: 'Doler van het Moeras',
    desc: 'Bezoek alle acht benoemde plekken van het Slijkveenmoeras.',
  },
  exp_peaks_wayfarer: {
    name: 'Doler van de Hoogten',
    desc: 'Bezoek alle tien benoemde plekken van de Doorntop-Hoogten.',
  },
  exp_world_traveler: {
    name: 'Wereldreiziger',
    desc: 'Behaal de Doler-daad van alle drie de zones.',
    title: 'de Doler',
  },
  exp_something_shiny: {
    name: 'Iets Glinsterends',
    desc: 'Raap een fonkelend voorwerp op van de grond.',
  },
  exp_first_ore: { name: 'De Eerste Ader', desc: 'Oogst je eerste ertsader.' },
  exp_first_timber: { name: 'Van Onderen!', desc: 'Oogst je eerste houtvindplaats.' },
  exp_first_herb: { name: 'Groene Vingers', desc: 'Oogst je eerste kruidenvindplaats.' },
  feat_era_cap: {
    name: 'Kind van het Eerste Tijdperk',
    desc: 'Bereikte level 20 toen het Eerste Tijdperk nog het huidige was.',
  },
  feat_book_complete: { name: 'Het Hele Boek', desc: 'Behaal elke daad in het Boek der Daden.' },
  feat_brightwood_relic: {
    name: 'Helderwoud Herdacht',
    desc: 'Bewaar een relikwie van het oude Helderwoud: het Doornhuid-Wambuis of de Monarchenkroon.',
  },
  hid_saul_footnote: {
    name: 'Een Voetnoot in de Geschiedenis',
    desc: 'Viel Saul de Kroniekschrijver negen keer zonder ophouden lastig.',
    title: 'de Voetnoot',
  },
  hid_gilded_tour: {
    name: 'De Vergulde Rondgang',
    desc: 'Deed zaken met alle drie de filialen van De Vergulde Geldkist.',
  },
  hid_fall_death: {
    name: 'Zwaartekracht Wint Altijd',
    desc: 'Gestorven aan een lang gesprek met de grond.',
  },
  hid_keepers_toll_twice: {
    name: 'De Hoeder Int Tweemaal',
    desc: 'Gestorven terwijl de Tol van de Hoeder nog op je drukte.',
  },
  hid_roll_hundred: {
    name: 'Zuivere Honderd',
    desc: 'Rolde een perfecte 100 met een gewone /roll.',
  },
  hid_yumi_cheer: {
    name: "Yumi's Grootste Fan",
    desc: 'Juichte midden in een partij voor Yumi, waar ze je kon horen.',
  },
  hid_bountiful_coffer: {
    name: 'De Paarse Koffer',
    desc: 'Kraakte een Weelderige Koffer voordat hij kon vastlopen.',
  },
  hid_companion_save: {
    name: 'Niet Zolang Zij Waakt',
    desc: 'Je delve-metgezel sleepte een gevallen groepsgenoot weer overeind.',
  },
  hid_codfather: {
    name: 'Opgenomen in de Familie',
    desc: 'Sleepte De Kabeljauwvader uit de Diepveen-Ondiepten.',
  },
  prog_crown_below: {
    name: 'De Kroon Beneden',
    desc: 'Volg de kroon van de rusteloze knekelvelden tot aan de tombe van Koning Nythraxis en volbreng Het Einde van de Gesel.',
  },
  prog_mere_at_rest: {
    name: 'Het Meer in Ruste',
    desc: 'Zie de wacht van Getijdenwaker Ondrel Vane door tot het einde: het koor tot zwijgen gebracht, de Bleekkronkel geveld en de Verdronken Maan ter ruste gelegd.',
  },
  prog_callused_hands: {
    name: 'Eeltige Handen',
    desc: 'Voltooi Een Ambacht voor Elke Hand en verdien je eerste eelt in de ambachten van Oostbeek.',
  },
  prog_tools_of_the_trade: {
    name: 'Gereedschap van het Vak',
    desc: 'Voltooi een ambachtswerk bij een ambachtsstation.',
  },
  dgn_nythraxis_crypt: {
    name: 'Wat de Crypte Bewaarde',
    desc: 'Trotseer de Verlaten Crypte en herwin beide sluitsteenhelften en het oude dagboek uit de greep van haar wachters.',
  },
  chr_marsh_first_cast: {
    name: 'Alen in het Riet',
    desc: 'Vang een vis in de wateren van Slijkveenmoeras.',
  },
};
