// Deed name / desc / title locale table for da_DK (data-as-code, size-exempt).
// One per-base-locale chunk behind DEED_LOCALE_LOADERS in deed_i18n.ts, so a
// visitor downloads only their own locale's deed strings. Split verbatim from
// the former deed_i18n.newlocales.ts single chunk; values carry no em or en
// dashes (repo copy rule). English (en / en_CA) resolves to the authored
// source before this table is consulted.
import type { DeedLocaleTable } from '../deed_i18n';

export const table: DeedLocaleTable = {
  prog_first_steps: {
    name: 'De Første Skridt',
    desc: 'Nå niveau 2, og tag dit første skridt på en lang vej.',
  },
  prog_finding_your_feet: {
    name: 'Fast Grund under Fødderne',
    desc: 'Nå niveau 5; vildmarken ser allerede en smule mindre ud.',
  },
  prog_double_digits: { name: 'Tocifret', desc: 'Nå niveau 10, og lås dine talenter op.' },
  prog_the_long_middle: { name: 'Den Lange Midte', desc: 'Nå niveau 15.' },
  prog_level_cap: { name: 'Udsigten fra Toppen', desc: 'Nå niveau 20, det højeste niveau.' },
  prog_well_rested: {
    name: 'Veludhvilet',
    desc: 'Slå dig til ro på en kro, indtil du har optjent udhvilet erfaring.',
  },
  prog_talented: { name: 'Godt Givet Ud', desc: 'Brug dit første talentpoint.' },
  prog_specialized: {
    name: 'En Klar Hensigt',
    desc: 'Vælg en specialisering, og lær dens signaturevne.',
  },
  prog_deep_roots: {
    name: 'Dybe Rødder',
    desc: 'Brug et talentpoint på et talent i nederste række.',
  },
  prog_full_build: {
    name: 'Alle Elleve',
    desc: 'Brug alle elleve talentpoint på ét og samme build.',
  },
  prog_veteran: { name: 'Veteran', desc: 'Optjen sammenlagt 250.000 erfaring.', title: 'Veteran' },
  prog_champion: { name: 'Mester', desc: 'Optjen sammenlagt 500.000 erfaring.', title: 'Mester' },
  prog_paragon: {
    name: 'Forbillede',
    desc: 'Optjen sammenlagt 1.000.000 erfaring.',
    title: 'Forbillede',
  },
  prog_mythic: { name: 'Mytisk', desc: 'Optjen sammenlagt 2.500.000 erfaring.', title: 'Mytisk' },
  prog_eternal: { name: 'Evig', desc: 'Optjen sammenlagt 5.000.000 erfaring.', title: 'Evig' },
  prog_prestige: {
    name: 'Begynd Forfra',
    desc: 'Nå det højeste niveau, fyld bjælken endnu en gang, og gør krav på prestigerang 1.',
  },
  prog_prestige_5: { name: 'Gamle Vaner', desc: 'Nå prestigerang 5.' },
  prog_prestige_10: { name: 'Evighedsmaskinen', desc: 'Nå prestigerang 10.' },
  prog_first_harvest: { name: 'Markens Frugter', desc: 'Høst din første indsamlingsforekomst.' },
  prog_mining_100: { name: 'Malm i Blodet', desc: 'Nå 100 i færdigheden Minedrift.' },
  prog_logging_100: { name: 'Kernevedshugger', desc: 'Nå 100 i færdigheden Skovhugst.' },
  prog_herbalism_100: { name: 'Engens Mester', desc: 'Nå 100 i færdigheden Urtekundskab.' },
  prog_master_gatherer: {
    name: 'Mestersamler',
    desc: 'Nå 100 i færdighed i Minedrift, Skovhugst og Urtekundskab.',
  },
  prog_first_craft: { name: 'Håndlavet', desc: 'Fuldfør din første vellykkede fremstilling.' },
  prog_craft_specialist: {
    name: 'Fagets Hemmeligheder',
    desc: 'Nå 75 i færdighed i ét enkelt håndværk, og lås dets specialiseringsfordele op.',
  },
  prog_around_the_ring: {
    name: 'Ringen Rundt',
    desc: 'Nå 25 i færdighed i fem forskellige håndværk.',
  },
  cmb_first_blood: { name: 'Første Blod', desc: 'Besejr din første fjende.' },
  cmb_slayer: { name: 'Dræber', desc: 'Besejr 1.000 fjender.' },
  cmb_legion_of_one: { name: 'Én Mands Legion', desc: 'Besejr 10.000 fjender.' },
  cmb_heavy_hitter: { name: 'Hårdtslående', desc: 'Uddel 500.000 skade i alt.' },
  cmb_critical_eye: { name: 'Kritisk Blik', desc: 'Uddel 500 kritiske træf.' },
  cmb_giantslayer: {
    name: 'Kæmpedræber',
    desc: 'Giv dødsstødet til en fjende mindst fem niveauer over dig.',
  },
  cmb_first_fall: {
    name: 'Børst Støvet Af',
    desc: 'Dø for første gang; det sker for de bedste af os.',
  },
  dgn_hollow_crypt: { name: 'Kryptbryder', desc: 'Besejr Morthen Gravkalderen i Den Hule Krypt.' },
  dgn_sunken_bastion: {
    name: 'Fogbinderen Ubundet',
    desc: 'Besejr Vael Fogbinderen i Den Sunkne Bastion.',
  },
  dgn_drowned_temple: {
    name: 'Månen Druknes',
    desc: 'Besejr Ysolei, den Druknede Månes Avatar, i Det Druknede Tempel.',
  },
  dgn_gravewyrm_sanctum: {
    name: 'Ormen Dernede',
    desc: 'Besejr Korzul Gravormen i Gravormens Helligdom.',
  },
  dgn_hollow_crypt_heroic: {
    name: 'Heroisk: Den Hule Krypt',
    desc: 'Besejr Morthen Gravkalderen i Den Hule Krypt på heroisk sværhedsgrad.',
  },
  dgn_sunken_bastion_heroic: {
    name: 'Heroisk: Den Sunkne Bastion',
    desc: 'Besejr Vael Fogbinderen i Den Sunkne Bastion på heroisk sværhedsgrad.',
  },
  dgn_drowned_temple_heroic: {
    name: 'Heroisk: Det Druknede Tempel',
    desc: 'Besejr Ysolei, den Druknede Månes Avatar, i Det Druknede Tempel på heroisk sværhedsgrad.',
  },
  dgn_gravewyrm_sanctum_heroic: {
    name: 'Heroisk: Gravormens Helligdom',
    desc: 'Besejr Korzul Gravormen i Gravormens Helligdom på heroisk sværhedsgrad.',
  },
  dgn_nythraxis: {
    name: 'Svøbens Endeligt',
    desc: 'Besejr Nythraxis, Tornetops Svøbe, bag den forseglede kongelige dør.',
  },
  dgn_nythraxis_heroic: {
    name: 'Heroisk: Svøbens Endeligt',
    desc: 'Besejr Nythraxis, Tornetops Svøbe, på heroisk sværhedsgrad.',
  },
  dgn_thornpeak_rounds: {
    name: 'På Runde',
    desc: 'Ryd Den Hule Krypt, Den Sunkne Bastion, Det Druknede Tempel og Gravormens Helligdom.',
  },
  dgn_deepward: {
    name: 'Dybets Værge',
    desc: 'Betving hver eneste fangekælder, raidet og begge delves på heroisk sværhedsgrad.',
  },
  dgn_mark_circuit: {
    name: 'Hele Turen Rundt',
    desc: 'Optjen Heroiske Mærker fra alle fire heroiske fangekældre på en og samme dag.',
  },
  dgn_boss_clears_50: {
    name: 'Halvtreds Døre Nede',
    desc: 'Besejr 50 slutbosser i fangekældrene.',
  },
  dgn_morthen_flawless: {
    name: 'Ikke en Knogle at Rafle om',
    desc: 'Besejr Morthen Gravkalderen på heroisk sværhedsgrad, uden at noget gruppemedlem dør.',
  },
  dgn_morthen_trio: {
    name: 'Tre mod Graven',
    desc: 'Besejr Morthen Gravkalderen med tre eller færre spillere.',
  },
  dgn_olen_arc: {
    name: 'Et Skridt foran Leen',
    desc: 'Besejr Ridderkommandør Olen, uden at hans Mejende Bue rammer andre end hans aktuelle mål.',
  },
  dgn_vael_thralls: {
    name: 'Trællefri',
    desc: 'Besejr Vael Fogbinderen, mens samtlige Druknede Trælle, han hidkalder, allerede er fældet.',
  },
  dgn_ysolei_moonspawn: {
    name: 'Hver Eneste Måneyngel',
    desc: 'Besejr Ysolei, mens al den Måneyngel, hun hidkalder, allerede er fældet.',
  },
  dgn_ysolei_flawless: {
    name: 'Tørre Øjne',
    desc: 'Besejr Ysolei, den Druknede Månes Avatar, på heroisk sværhedsgrad, uden at noget gruppemedlem dør.',
  },
  dgn_velkhar_bonewalkers: {
    name: 'Bliv i Graven',
    desc: 'Besejr Stornekromantør Velkhar med samtlige Genopvakte Benvandrere tilintetgjort, før han falder.',
  },
  dgn_korzul_flawless: {
    name: 'Ormefælder',
    desc: 'Besejr Korzul Gravormen på heroisk sværhedsgrad, uden at noget gruppemedlem dør.',
    title: 'Ormefælder',
  },
  dgn_sanctum_speed: {
    name: 'Helligdomsspurt',
    desc: 'Besejr Korzul Gravormen inden for 15 minutter efter, at din gruppe har gjort krav på Gravormens Helligdom.',
  },
  dgn_nythraxis_gravebreaker: {
    name: 'Knæl for Ingen Konge',
    desc: 'Besejr Nythraxis, uden at Gravbryder nogensinde rammer andre end hans aktuelle mål.',
  },
  dgn_nythraxis_wardens: {
    name: 'Værgestenenes Vogtere',
    desc: 'Besejr Nythraxis med hvert Udødeligt Raseri brudt, før det rammer.',
  },
  dgn_nythraxis_deathless: {
    name: 'Ingen Mere Udødelig',
    desc: 'Besejr Nythraxis, Tornetops Svøbe, på heroisk sværhedsgrad, uden at en eneste raider dør.',
    title: 'den Udødelige',
  },
  cmb_thunzharr: {
    name: 'Bjerget Faldt',
    desc: 'Fæld Thunzharr, den Vågnende Tinde, ved Stormklippen.',
  },
  cmb_thunzharr_unbroken: {
    name: 'Tindebryder',
    desc: 'Fæld Thunzharr, den Vågnende Tinde, uden at dø fra dit første slag til hans sidste åndedrag.',
    title: 'Tindebryder',
  },
  cmb_thunzharr_ten: {
    name: 'Bjerge som Vane',
    desc: 'Fæld Thunzharr, den Vågnende Tinde, ti gange.',
  },
  dlv_reliquary: { name: 'Relikvarieløber', desc: 'Ryd Det Sammenstyrtede Relikvarium.' },
  dlv_reliquary_heroic: {
    name: 'Heroisk: Det Sammenstyrtede Relikvarium',
    desc: 'Ryd Det Sammenstyrtede Relikvarium på heroisk niveau.',
  },
  dlv_litany: { name: 'Tys på Litaniet', desc: 'Ryd Det Druknede Litani.' },
  dlv_litany_heroic: {
    name: 'Heroisk: Det Druknede Litani',
    desc: 'Ryd Det Druknede Litani på heroisk niveau.',
  },
  dlv_lore_journal: { name: 'Randnoter', desc: 'Lås alle fem optegnelser i delve-dagbogen op.' },
  dlv_companion_max: {
    name: 'En Ven i Dybet',
    desc: 'Optræn en delve-følgesvend til hendes højeste rang.',
  },
  dlv_companions_both: {
    name: 'Begge Lygter Tændt',
    desc: 'Optræn begge delve-følgesvende, Akolyt Tessa og Edda Sivhånd, til deres højeste rang.',
  },
  dlv_clears_50: { name: 'Halvtreds Favne', desc: 'Gennemfør 50 delve-ture.' },
  dlv_solo_heroic: {
    name: 'To er en Hel Flok',
    desc: 'Ryd en delve på heroisk niveau uden nogen anden spiller, kun dig og din følgesvend.',
  },
  dlv_tumbler_premium: {
    name: 'Stifternes Sti, Mestret',
    desc: 'Åbn en værnet relikvariekiste ved højeste indsats, fejlfrit i dit eneste forsøg.',
  },
  dlv_rite_flawless: {
    name: 'Til Punkt og Prikke',
    desc: 'Gennemfør Det Druknede Relikvarieritual uden en eneste fejl.',
  },
  dlv_varric_ringers: {
    name: 'Klokkerne Forstummer',
    desc: 'Fæld hver Ligklokkeringer, Diakon Varric genopvækker, før han selv falder.',
  },
  dlv_nhalia_bells: {
    name: 'Klokkestiller',
    desc: 'Besejr Søster Nhalia, den Druknede Kantikel, uden at noget gruppemedlem bliver ramt af en Klemtende Klokke.',
    title: 'Klokkestiller',
  },
  chr_vale_chapter_i: {
    name: 'Dalens Krønike, Kapitel I',
    desc: 'Afslut første kapitel af Sauls krønike: Østbæks første ærinder, overblik over Dalen og en første smag på dens håndværk.',
  },
  chr_vale_chapter_ii: {
    name: 'Dalens Krønike, Kapitel II',
    desc: 'Afslut andet kapitel af Sauls krønike: banditter, mudfinne-snigerne og minens skadedyr nedkæmpet, Somarken spillet og Relikvariet trodset.',
  },
  chr_vale_chapter_iii: {
    name: 'Krøniken om Dalen',
    desc: 'Følg Dalens fulde fortælling til ende: Gravkalderen afsløret, Den Hule Krypt renset og hver navngiven rædsel i Dalen fældet.',
    title: 'af Dalen',
  },
  chr_vale_gatherer: {
    name: 'Leve af Landet',
    desc: 'Høst en malmåre, en skovbevoksning og et urtebed i Østbæk Dal.',
  },
  chr_vale_first_cast: { name: 'Noget i Spejlsøen', desc: 'Fang en fisk i Østbæk Dals vande.' },
  chr_vale_packbreaker: { name: 'Flokbryder', desc: 'Dræb 3 Skovulve inden for 10 sekunder.' },
  chr_vale_cup_debut: {
    name: 'Kobberspandens Kandidat',
    desc: 'Gå på banen og rør bolden i en Dalpokal-kamp på Somarken.',
  },
  chr_vale_rares: {
    name: 'Dalens Rædsler',
    desc: 'Dræb de fem navngivne rædsler i Østbæk Dal: Gamle Gråkæft, Mogger, Grix Tunnelkongen, Kaptajn Verlan og Genfærdsbinder Maldrec.',
  },
  chr_marsh_chapter_i: {
    name: 'Sumpens Krønike, Kapitel I',
    desc: 'Afslut første kapitel af Osric Fenns krønike: besvar mønstringen ved Sumpbroen, sikr dæmningsvejen og lær kærets form at kende.',
  },
  chr_marsh_chapter_ii: {
    name: 'Sumpens Krønike, Kapitel II',
    desc: 'Afslut andet kapitel af Osric Fenns krønike: enkerne røget ud, de druknede stedt til hvile, Torskefaderen halet i land og Litaniet trodset.',
  },
  chr_marsh_chapter_iii: {
    name: 'Krøniken om Mosekæret',
    desc: 'Følg kærets fulde fortælling til ende: kultlejren knust, Fogbinderen bragt til tavshed i Den Sunkne Bastion og hver navngiven rædsel i tågen fældet.',
    title: 'af Mosekæret',
  },
  chr_marsh_gatherer: {
    name: 'Sanketur ved Sumpbroen',
    desc: 'Høst en malmåre, en skovbevoksning og et urtebed i Mosekær Sump.',
  },
  chr_marsh_unburst: {
    name: 'Stå Ikke i Sporerne',
    desc: 'Dræb 8 Sumpopsvulmere uden at blive fanget i deres udbrud af Ætsende Sporer.',
  },
  chr_marsh_hush_the_mending: {
    name: 'Bring Helingen til Tavshed',
    desc: 'Fæld en Gravkalder-Heler i Gravkaldernes Lejr, inden nogen af de kultister, den plejer, falder.',
  },
  chr_marsh_rares: {
    name: 'Navne i Tågen',
    desc: 'Dræb de tre navngivne rædsler i Mosekær Sump: Sumpkæft den Glubske, Sloomtand den Druknede og Søster Nhalia.',
  },
  chr_peaks_chapter_i: {
    name: 'Tindernes Krønike, Kapitel I',
    desc: 'Afslut første kapitel af Zenzies krønike: ryd vejen over bjergkammen, tøm hulerne og lær hver sti, Højvagten vogter.',
  },
  chr_peaks_chapter_ii: {
    name: 'Tindernes Krønike, Kapitel II',
    desc: 'Afslut andet kapitel af Zenzies krønike: knus Drogmars Krigslejr, tyd den vågnende storm og stå, hvor Glimmersøen gløder.',
  },
  chr_peaks_chapter_iii: {
    name: 'Krøniken om Tornetop',
    desc: 'Følg bjergets fulde fortælling til ende: Ormekulten knust, Helligdommen bragt til tavshed, den Vågnende Tinde styrtet og hver navngiven rædsel i klipperne fældet.',
    title: 'af Tornetop',
  },
  chr_peaks_sparring: {
    name: 'Øvelser på Muren',
    desc: 'Tilføj træningsdukken over Højvagten 1.000 skade i alt.',
  },
  chr_peaks_glimmer_cast: { name: 'Koldt Vand, Koldere Lys', desc: 'Fang en fisk i Glimmersøen.' },
  chr_peaks_moongate: {
    name: 'Gennem den Kolde Port',
    desc: 'Træd gennem måneporten ved Glimmersøens bred.',
  },
  chr_peaks_waking_witness: {
    name: 'Bjerget der Vandrer',
    desc: 'Få øje på Thunzharr, den Vågnende Tinde, mens han skrider hen over bjerget.',
  },
  chr_peaks_rares: {
    name: 'Navne Hugget i Klippen',
    desc: 'Dræb de fire navngivne rædsler i Tornetop Højder: Jernåre-Formanden, Brutok Kranieknuser, Voskar Glødevinge og Margherre Varkas.',
  },
  col_discovery_25: {
    name: 'Hamstrer',
    desc: 'Opdag 25 forskellige genstande (en genstand tæller første gang, den nogensinde kommer i din besiddelse).',
  },
  col_discovery_75: { name: 'Husskade', desc: 'Opdag 75 forskellige genstande.' },
  col_discovery_150: {
    name: 'Raritetskabinet',
    desc: 'Opdag 150 forskellige genstande.',
    title: 'Kuratoren',
  },
  col_discovery_250: { name: 'Det Store Katalog', desc: 'Opdag 250 forskellige genstande.' },
  col_first_rare: { name: 'Noget Blåt', desc: 'Skaf din første genstand af sjælden kvalitet.' },
  col_first_epic: { name: 'Født i Purpur', desc: 'Skaf din første genstand af episk kvalitet.' },
  col_first_legendary: {
    name: 'Appelsinen i Turbanen',
    desc: 'Skaf din første genstand af legendarisk kvalitet.',
  },
  col_set_vale_arcanist: {
    name: 'Dalarkanistens Skrud',
    desc: 'Opdag hver del af Dalarkanistens Skrud.',
  },
  col_set_boundstone_vanguard: {
    name: 'Bundstens-Fortroppen',
    desc: 'Opdag hver del af Bundstens-Fortroppen.',
  },
  col_set_greyjaw_stalker: {
    name: 'Gråkæbe-Luskerens Udstyr',
    desc: 'Opdag hver del af Gråkæbe-Luskerens Udstyr.',
  },
  col_set_deathlord: {
    name: 'Barrowlord-Krigsudstyr',
    desc: 'Opdag hver del af Barrowlord-Krigsudstyret.',
  },
  col_set_wyrmshadow: { name: 'Nightfang-Ornat', desc: 'Opdag hver del af Nightfang-Ornatet.' },
  col_set_necromancers: { name: 'Mournweave-Dragt', desc: 'Opdag hver del af Mournweave-Dragten.' },
  col_set_crownforged: {
    name: 'Bonewrought-Skrud',
    desc: 'Opdag hver del af Bonewrought-Skruddet.',
  },
  col_set_nighttalon: { name: 'Direfang-Pels', desc: 'Opdag hver del af Direfang-Pelsen.' },
  col_set_soulflame: { name: 'Wraithfire-Skrud', desc: 'Opdag hver del af Wraithfire-Skruddet.' },
  col_set_stormcallers: { name: 'Galecall-Ornat', desc: 'Opdag hver del af Galecall-Ornatet.' },
  col_seven_regalia: {
    name: 'Den Syvfoldige Garderobe',
    desc: 'Opdag hver del af alle syv episke rustningsfamilier.',
    title: 'den Prægtige',
  },
  col_true_colors: {
    name: 'Bekend Kulør',
    desc: 'Gå på banen iført et hvilket som helst andet udseende end din klasses standard.',
  },
  col_all_slots: {
    name: 'Klædt På til Elleve',
    desc: 'Hav en genstand udrustet i alle elleve udstyrspladser på samme tid.',
  },
  col_quartermaster_buyout: {
    name: 'Stamkunde',
    desc: 'Opdag alle ti dele af den Heroiske Kvartermesters lager.',
  },
  col_glimmerfin: { name: 'Et Glimt af Håb', desc: 'Fang en Glimtfinne-Koi.' },
  col_full_creel: {
    name: 'Fyldt Fiskekurv',
    desc: 'Opdag alle seks almindelige fangster fra Dalens, Sumpens og Højdernes vande.',
  },
  col_junk_drawer: {
    name: 'Rodeskuffen',
    desc: 'Opdag 10 forskellige genstande af ringe kvalitet.',
  },
  pvp_arena_first_match: {
    name: 'Sand i Støvlerne',
    desc: 'Kæmp en ranglistekamp i Askekolosseet, i en af rækkerne.',
  },
  pvp_arena_first_win: {
    name: 'Publikum Brøler',
    desc: 'Vind en ranglistekamp i arenaen, i en af rækkerne.',
  },
  pvp_arena_1v1_1600: { name: 'Kolosseets Udfordrer', desc: 'Nå 1600 i rating i 1v1-arenarækken.' },
  pvp_arena_1v1_1750: { name: 'Kolosseets Rival', desc: 'Nå 1750 i rating i 1v1-arenarækken.' },
  pvp_arena_1v1_1900: {
    name: 'Gladiator',
    desc: 'Nå 1900 i rating i 1v1-arenarækken.',
    title: 'Gladiator',
  },
  pvp_arena_2v2_1600: { name: 'To Mand Høj', desc: 'Nå 1600 i rating i 2v2-arenarækken.' },
  pvp_arena_2v2_1750: { name: 'Frygtet Makkerpar', desc: 'Nå 1750 i rating i 2v2-arenarækken.' },
  pvp_arena_2v2_1900: { name: 'Perfekt Parløb', desc: 'Nå 1900 i rating i 2v2-arenarækken.' },
  pvp_duel_first_win: { name: 'Vi Tager Den Udenfor', desc: 'Vind en duel.' },
  pvp_duel_grace: {
    name: 'En Lektion i Ydmyghed',
    desc: 'Tab en duel med værdigheden nogenlunde i behold.',
  },
  pvp_vcup_first_match: {
    name: 'Støvler på Banen',
    desc: 'Spil en hel Dalpokal-kamp til ende på Somarken, uanset sejr eller nederlag.',
  },
  pvp_vcup_first_win: { name: 'Det Første Sølvtøj', desc: 'Vind en ranglistekamp i Dalpokalen.' },
  pvp_vcup_wins_10: {
    name: 'Garvet Vildsvineboldspiller',
    desc: 'Vind 10 ranglistekampe i Dalpokalen.',
  },
  pvp_vcup_wins_25: {
    name: 'Vildsvinebold-Legende',
    desc: 'Vind 25 ranglistekampe i Dalpokalen.',
    title: 'Vildsvinebold-Legende',
  },
  pvp_vcup_first_goal: { name: 'På Måltavlen', desc: 'Scor et mål i en Dalpokal-ranglistekamp.' },
  pvp_vcup_hat_trick: {
    name: 'Hattrick-Helt',
    desc: 'Scor tre mål i en enkelt Dalpokal-ranglistekamp, i 3v3-rækken eller større.',
  },
  pvp_vcup_golden_goal: {
    name: 'Gyldent Øjeblik',
    desc: 'Scor det gyldne mål, der afgør en Dalpokal-ranglistekamp.',
  },
  pvp_vcup_first_save: {
    name: 'Sikre Hænder',
    desc: 'Red et skud som målmand i en Dalpokal-ranglistekamp.',
  },
  pvp_vcup_clean_sheet: {
    name: 'Intet Slipper Forbi Mig',
    desc: 'Vind en Dalpokal-ranglistekamp som målmand uden at lukke et mål ind.',
  },
  pvp_vcup_guild_win: {
    name: 'For Banneret',
    desc: 'Vind en Dalpokal-ranglistekamp, hvor holdet stillede op under dit gildes banner.',
  },
  pvp_fiesta_first_bout: {
    name: 'Ubuden Gæst',
    desc: 'Kæmp en fuld 2v2 Fiesta-dyst, uanset sejr eller nederlag.',
  },
  pvp_fiesta_first_win: { name: 'Festens Midtpunkt', desc: 'Vind en 2v2 Fiesta-dyst.' },
  pvp_fiesta_double: {
    name: 'Dobbelt Ballade',
    desc: 'Lav to Fiesta-nedlæggelser inden for fire sekunder.',
  },
  pvp_fiesta_shutdown: {
    name: 'Lyseslukker',
    desc: 'Nedlæg en Fiesta-modstander, der er på en stime på tre eller mere.',
  },
  pvp_fiesta_full_build: {
    name: 'Klædt på til Lejligheden',
    desc: 'Vind en Fiesta-dyst med en forstærkning låst fast fra alle tre bølger.',
  },
  pvp_fiesta_powerups: {
    name: 'En af Hver',
    desc: 'Snup hver af de fire power-ups i ringen mindst én gang: Fartdjævel, Kolos, Månestøvler og Bersærk.',
  },
  pvp_fiesta_five_kills: {
    name: 'Bærer Hele Festen',
    desc: 'Lav fem nedlæggelser i en enkelt Fiesta-dyst.',
  },
  soc_first_party: { name: 'Bedre Sammen', desc: 'Slut dig til en gruppe med en anden spiller.' },
  soc_full_house: {
    name: 'Fuldt Hus',
    desc: 'Gennemfør en fangekælder med en fuld gruppe på fem.',
  },
  soc_guild_joined: { name: 'Under Samme Banner', desc: 'Bliv medlem af et gilde.' },
  soc_guild_founded: { name: 'Stifterens Fjerpen', desc: 'Stift dit eget gilde.' },
  soc_first_trade: {
    name: 'En Ærlig Handel',
    desc: 'Gennemfør en byttehandel med en anden spiller.',
  },
  soc_first_sale: {
    name: 'Åbent for Handel',
    desc: 'Indkassér mønterne fra dit første salg på Verdensmarkedet.',
  },
  soc_steady_custom: {
    name: 'Fast Kundekreds',
    desc: 'Indkassér en samlet livstidssum på 10 guld fra dine salg på Verdensmarkedet.',
  },
  soc_market_magnate: {
    name: 'Markedsmagnat',
    desc: 'Indkassér en samlet livstidssum på 100 guld fra dine salg på Verdensmarkedet.',
    title: 'Magnat',
  },
  soc_by_ravens_wing: {
    name: 'På Ravnevinger',
    desc: 'Send et Ravnepost-brev med mønter eller en pakke.',
  },
  soc_room_for_more: { name: 'Plads til Mere', desc: 'Køb din første bankudvidelse.' },
  soc_gilded_strongbox: {
    name: 'Det Forgyldte Pengeskrin',
    desc: 'Køb hver eneste bankudvidelse, som skatmestrene vil sælge dig.',
  },
  soc_meet_bursar: {
    name: 'Fernando Være Lovet',
    desc: 'Vis din ærbødighed for Skatmester Fernando, vogter af Det Forgyldte Pengeskrin i Østbæk.',
  },
  soc_pocket_money: {
    name: 'Lommepenge',
    desc: 'Saml en samlet livstidssum på 1 guld i mønt som bytte.',
  },
  soc_heavy_purse: {
    name: 'Tung Pung',
    desc: 'Saml en samlet livstidssum på 10 guld i mønt som bytte.',
  },
  soc_wyrms_hoard: {
    name: 'En Orms Skat',
    desc: 'Saml en samlet livstidssum på 100 guld i mønt som bytte.',
  },
  soc_civic_duty: { name: 'Borgerpligt', desc: 'Tildel dit første byfokus-point.' },
  exp_long_road_north: {
    name: 'Den Lange Vej mod Nord',
    desc: 'Besøg alle tre hovedbyer: Østbæk, Sumpbroen og Højvagten.',
  },
  exp_vale_wayfarer: {
    name: 'Dalens Vejfarer',
    desc: 'Besøg alle elleve navngivne steder i Østbæk Dal.',
  },
  exp_marsh_wayfarer: {
    name: 'Sumpens Vejfarer',
    desc: 'Besøg alle otte navngivne steder i Mosekær Sump.',
  },
  exp_peaks_wayfarer: {
    name: 'Højdernes Vejfarer',
    desc: 'Besøg alle ti navngivne steder i Tornetop Højder.',
  },
  exp_world_traveler: {
    name: 'Verdensrejsende',
    desc: 'Opnå vejfarer-bedriften i alle tre zoner.',
    title: 'Vejfareren',
  },
  exp_something_shiny: {
    name: 'Noget, der Glimter',
    desc: 'Saml en funklende genstand op fra jorden.',
  },
  exp_first_ore: { name: 'Hak i Klippen', desc: 'Høst din første malmforekomst.' },
  exp_first_timber: { name: 'Træet Falder!', desc: 'Høst din første træforekomst.' },
  exp_first_herb: { name: 'Grønne Fingre', desc: 'Høst din første urteforekomst.' },
  feat_era_cap: {
    name: 'Barn af Den Første Æra',
    desc: 'Nåede niveau 20, mens Den Første Æra stod på.',
  },
  feat_book_complete: { name: 'Hele Bogen', desc: 'Opnå hver eneste bedrift i Bedrifternes Bog.' },
  feat_brightwood_relic: {
    name: 'Til Minde om Lysskoven',
    desc: 'Gem et relikvie fra den gamle Lysskov: Tornehude-Vams eller Monarkens Krone.',
  },
  hid_saul_footnote: {
    name: 'En Fodnote i Historien',
    desc: 'Plagede krønikeskriveren Saul ni gange uden ophold.',
    title: 'Fodnoten',
  },
  hid_gilded_tour: {
    name: 'Den Forgyldte Rundtur',
    desc: 'Gjorde forretninger med alle tre filialer af Det Forgyldte Pengeskrin.',
  },
  hid_fall_death: {
    name: 'Tyngdekraften Vinder Altid',
    desc: 'Døde af en lang samtale med jorden.',
  },
  hid_keepers_toll_twice: {
    name: 'Vogteren Opkræver To Gange',
    desc: 'Døde, mens Vogterens Told stadig tyngede dig.',
  },
  hid_roll_hundred: {
    name: 'Et Rent Hundrede',
    desc: "Slog en perfekt 100'er med et almindeligt /roll.",
  },
  hid_yumi_cheer: {
    name: 'Yumis Største Fan',
    desc: 'Jublede for Yumi midt under en dyst, hvor hun kunne høre dig.',
  },
  hid_bountiful_coffer: {
    name: 'Det Purpurne Skrin',
    desc: 'Knækkede et Gavmildt Skrin, før det nåede at gå i baglås.',
  },
  hid_companion_save: {
    name: 'Ikke på Hendes Vagt',
    desc: 'Din delve-følgesvend halede en falden gruppefælle tilbage på benene.',
  },
  hid_codfather: {
    name: 'Optaget i Familien',
    desc: 'Halede Torskefaderen op af Dybmosens Lavvande.',
  },
  prog_crown_below: {
    name: 'Kronen Dernede',
    desc: "Følg kronen fra de rastløse knoglemarker til Kong Nythraxis' gravkammer, og fuldfør Svøbens Ende.",
  },
  prog_mere_at_rest: {
    name: 'Søen Falder til Ro',
    desc: 'Følg Ondrel Vanes vagt til vejs ende: koret bragt til tavshed, Blegslyngen fældet og den Druknede Måne stedt til hvile.',
  },
  prog_callused_hands: {
    name: 'Barkede Næver',
    desc: 'Fuldfør Et Håndværk til Hver Hånd, og slid dig til din første hårde hud i Østbæks håndværk.',
  },
  prog_tools_of_the_trade: {
    name: 'Fagets Redskaber',
    desc: 'Fuldfør en stationsbunden fremstilling ved håndværkspladsen i Højvagten.',
  },
  dgn_nythraxis_crypt: {
    name: 'Hvad Krypten Gemte',
    desc: 'Vov dig ind i Den Forladte Krypt, og hent begge halvdele af nøglestenen og den ældgamle dagbog fra dens vogtere.',
  },
  chr_marsh_first_cast: { name: 'Ål i Sivene', desc: 'Fang en fisk i Mosekær Sumps vande.' },
};
