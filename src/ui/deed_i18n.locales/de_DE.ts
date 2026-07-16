// Deed name / desc / title locale table for de_DE (data-as-code, size-exempt).
// One per-base-locale chunk behind DEED_LOCALE_LOADERS in deed_i18n.ts, so a
// visitor downloads only their own locale's deed strings. Split verbatim from
// the former deed_i18n.newlocales.ts single chunk; values carry no em or en
// dashes (repo copy rule). English (en / en_CA) resolves to the authored
// source before this table is consulted.
import type { DeedLocaleTable } from '../deed_i18n';

export const table: DeedLocaleTable = {
  prog_first_steps: {
    name: 'Erste Schritte',
    desc: 'Erreiche Stufe 2 und mache den ersten Schritt auf einem langen Weg.',
  },
  prog_finding_your_feet: {
    name: 'Sicherer Tritt',
    desc: 'Erreiche Stufe 5; die Wildnis wirkt schon ein wenig kleiner.',
  },
  prog_double_digits: {
    name: 'Zweistellig',
    desc: 'Erreiche Stufe 10 und schalte deine Talente frei.',
  },
  prog_the_long_middle: { name: 'Die lange Mitte', desc: 'Erreiche Stufe 15.' },
  prog_level_cap: { name: 'Der Blick von ganz oben', desc: 'Erreiche Stufe 20, die Höchststufe.' },
  prog_well_rested: {
    name: 'Gut ausgeruht',
    desc: 'Kehre in einem Gasthaus ein, bis du ausgeruhte Erfahrung verdient hast.',
  },
  prog_talented: { name: 'Ein gut angelegter Punkt', desc: 'Verteile deinen ersten Talentpunkt.' },
  prog_specialized: {
    name: 'Eine klare Ansage',
    desc: 'Wähle eine Spezialisierung und erlerne ihre Signaturfähigkeit.',
  },
  prog_deep_roots: {
    name: 'Tiefe Wurzeln',
    desc: 'Verteile einen Talentpunkt auf ein Talent der letzten Reihe.',
  },
  prog_full_build: {
    name: 'Die volle Elf',
    desc: 'Verteile alle elf Talentpunkte auf eine einzige Skillung.',
  },
  prog_veteran: { name: 'Veteran', desc: 'Sammle insgesamt 250.000 Erfahrung.', title: 'Veteran' },
  prog_champion: {
    name: 'Champion',
    desc: 'Sammle insgesamt 500.000 Erfahrung.',
    title: 'Champion',
  },
  prog_paragon: {
    name: 'Paragon',
    desc: 'Sammle insgesamt 1.000.000 Erfahrung.',
    title: 'Paragon',
  },
  prog_mythic: {
    name: 'Mythisch',
    desc: 'Sammle insgesamt 2.500.000 Erfahrung.',
    title: 'Mythisch',
  },
  prog_eternal: { name: 'Ewig', desc: 'Sammle insgesamt 5.000.000 Erfahrung.', title: 'Ewig' },
  prog_prestige: {
    name: 'Noch einmal von vorn',
    desc: 'Erreiche die Höchststufe, fülle den Balken noch einmal und beanspruche Prestigerang 1.',
  },
  prog_prestige_5: { name: 'Alte Gewohnheiten', desc: 'Erreiche Prestigerang 5.' },
  prog_prestige_10: { name: 'Perpetuum mobile', desc: 'Erreiche Prestigerang 10.' },
  prog_first_harvest: { name: 'Früchte des Feldes', desc: 'Ernte dein erstes Sammelvorkommen.' },
  prog_mining_100: { name: 'Erz im Blut', desc: 'Erreiche eine Fertigkeit von 100 im Bergbau.' },
  prog_logging_100: {
    name: 'Kernholzhauer',
    desc: 'Erreiche eine Fertigkeit von 100 in der Holzfällerei.',
  },
  prog_herbalism_100: {
    name: 'Meister der Wiesen',
    desc: 'Erreiche eine Fertigkeit von 100 in der Kräuterkunde.',
  },
  prog_master_gatherer: {
    name: 'Meistersammler',
    desc: 'Erreiche eine Fertigkeit von 100 in Bergbau, Holzfällerei und Kräuterkunde.',
  },
  prog_first_craft: {
    name: 'Handarbeit',
    desc: 'Schließe deine erste erfolgreiche Herstellung ab.',
  },
  prog_craft_specialist: {
    name: 'Betriebsgeheimnisse',
    desc: 'Erreiche eine Fertigkeit von 75 in einem beliebigen Handwerk und schalte dessen Spezialisierungsboni frei.',
  },
  prog_around_the_ring: {
    name: 'Einmal um den Ring',
    desc: 'Erreiche eine Fertigkeit von 25 in fünf verschiedenen Handwerken.',
  },
  cmb_first_blood: { name: 'Erstes Blut', desc: 'Besiege deinen ersten Gegner.' },
  cmb_slayer: { name: 'Schlächter', desc: 'Besiege 1.000 Gegner.' },
  cmb_legion_of_one: { name: 'Eine Legion für sich', desc: 'Besiege 10.000 Gegner.' },
  cmb_heavy_hitter: { name: 'Schwergewicht', desc: 'Richte insgesamt 500.000 Schaden an.' },
  cmb_critical_eye: { name: 'Kritischer Blick', desc: 'Lande 500 kritische Treffer.' },
  cmb_giantslayer: {
    name: 'Riesentöter',
    desc: 'Führe den Todesstoß gegen einen Gegner aus, der mindestens fünf Stufen über dir liegt.',
  },
  cmb_first_fall: {
    name: 'Staub abklopfen',
    desc: 'Stirb zum ersten Mal; das passiert den Besten von uns.',
  },
  dgn_hollow_crypt: {
    name: 'Gruftbrecher',
    desc: 'Besiege Morthen den Gravecaller in der Hohlen Gruft.',
  },
  dgn_sunken_bastion: {
    name: 'Der Fogbinder, entfesselt',
    desc: 'Besiege Vael den Fogbinder in der versunkenen Bastion.',
  },
  dgn_drowned_temple: {
    name: 'Den Mond ertränken',
    desc: 'Besiege Ysolei, Avatar des Ertränkten Mondes, im Ertränkten Tempel.',
  },
  dgn_gravewyrm_sanctum: {
    name: 'Der Wyrm in der Tiefe',
    desc: 'Besiege Korzul den Gravewyrm im Gravewyrm-Heiligtum.',
  },
  dgn_hollow_crypt_heroic: {
    name: 'Heroisch: Die Hohle Gruft',
    desc: 'Besiege Morthen den Gravecaller in der Hohlen Gruft auf heroischem Schwierigkeitsgrad.',
  },
  dgn_sunken_bastion_heroic: {
    name: 'Heroisch: Die versunkene Bastion',
    desc: 'Besiege Vael den Fogbinder in der versunkenen Bastion auf heroischem Schwierigkeitsgrad.',
  },
  dgn_drowned_temple_heroic: {
    name: 'Heroisch: Der Ertränkte Tempel',
    desc: 'Besiege Ysolei, Avatar des Ertränkten Mondes, im Ertränkten Tempel auf heroischem Schwierigkeitsgrad.',
  },
  dgn_gravewyrm_sanctum_heroic: {
    name: 'Heroisch: Gravewyrm-Heiligtum',
    desc: 'Besiege Korzul den Gravewyrm im Gravewyrm-Heiligtum auf heroischem Schwierigkeitsgrad.',
  },
  dgn_nythraxis: {
    name: 'Die Geißel gebrochen',
    desc: 'Besiege Nythraxis, Geißel von Thornpeak, jenseits der versiegelten königlichen Tür.',
  },
  dgn_nythraxis_heroic: {
    name: 'Heroisch: Die Geißel gebrochen',
    desc: 'Besiege Nythraxis, Geißel von Thornpeak, auf heroischem Schwierigkeitsgrad.',
  },
  dgn_thornpeak_rounds: {
    name: 'Die Runde gemacht',
    desc: 'Säubere die Hohle Gruft, die versunkene Bastion, den Ertränkten Tempel und das Gravewyrm-Heiligtum.',
  },
  dgn_deepward: {
    name: 'Tiefenwacht',
    desc: 'Bezwinge jeden Dungeon, den Schlachtzug und beide Tiefgänge auf heroischem Schwierigkeitsgrad.',
  },
  dgn_mark_circuit: {
    name: 'Der volle Rundgang',
    desc: 'Verdiene an einem einzigen Tag Heroische Marken aus allen vier heroischen Dungeons.',
  },
  dgn_boss_clears_50: { name: 'Fünfzig Türen weiter', desc: 'Besiege 50 Dungeon-Endbosse.' },
  dgn_morthen_flawless: {
    name: 'Ohne Wenn und Knochen',
    desc: 'Besiege Morthen den Gravecaller auf heroischem Schwierigkeitsgrad, ohne dass ein Gruppenmitglied stirbt.',
  },
  dgn_morthen_trio: {
    name: 'Drei gegen das Grab',
    desc: 'Besiege Morthen den Gravecaller mit höchstens drei Spielern.',
  },
  dgn_olen_arc: {
    name: 'Dem Schnitter ausgewichen',
    desc: 'Besiege Ritterkommandant Olen, ohne dass sein Sensenschwung jemand anderen als sein aktuelles Ziel trifft.',
  },
  dgn_vael_thralls: {
    name: 'Niemandes Knecht',
    desc: 'Besiege Vael den Fogbinder, nachdem jeder Ertrunkene Knecht, den er ruft, bereits erschlagen wurde.',
  },
  dgn_ysolei_moonspawn: {
    name: 'Bis zur letzten Mondbrut',
    desc: 'Besiege Ysolei, nachdem jede Mondbrut, die sie ruft, bereits erschlagen wurde.',
  },
  dgn_ysolei_flawless: {
    name: 'Trockenen Auges',
    desc: 'Besiege Ysolei, Avatar des Ertränkten Mondes, auf heroischem Schwierigkeitsgrad, ohne dass ein Gruppenmitglied stirbt.',
  },
  dgn_velkhar_bonewalkers: {
    name: 'Bleibt begraben',
    desc: 'Besiege Großnekromant Velkhar und vernichte jeden Erhobenen Knochenläufer, bevor Velkhar fällt.',
  },
  dgn_korzul_flawless: {
    name: 'Wyrmfäller',
    desc: 'Besiege Korzul den Gravewyrm auf heroischem Schwierigkeitsgrad, ohne dass ein Gruppenmitglied stirbt.',
    title: 'Wyrmfäller',
  },
  dgn_sanctum_speed: {
    name: 'Sprint durchs Heiligtum',
    desc: 'Besiege Korzul den Gravewyrm binnen 15 Minuten, nachdem deine Gruppe das Gravewyrm-Heiligtum beansprucht hat.',
  },
  dgn_nythraxis_gravebreaker: {
    name: 'Knie vor keinem König',
    desc: 'Besiege Nythraxis, ohne dass Grabbrecher je jemand anderen als sein aktuelles Ziel trifft.',
  },
  dgn_nythraxis_wardens: {
    name: 'Hüter der Wachsteine',
    desc: 'Besiege Nythraxis, wobei jeder Todlose Zorn gebrochen wird, bevor er sich entlädt.',
  },
  dgn_nythraxis_deathless: {
    name: 'Niemand ist todloser',
    desc: 'Besiege Nythraxis, Geißel von Thornpeak, auf heroischem Schwierigkeitsgrad, ohne dass ein einziges Schlachtzugsmitglied stirbt.',
    title: 'Todlos',
  },
  cmb_thunzharr: {
    name: 'Der Berg fiel',
    desc: 'Bringe Thunzharr, den Erwachenden Gipfel, bei Stormcrag zu Fall.',
  },
  cmb_thunzharr_unbroken: {
    name: 'Gipfelbrecher',
    desc: 'Bringe Thunzharr, den Erwachenden Gipfel, zu Fall, ohne von deinem ersten Schlag bis zu seinem letzten Atemzug zu sterben.',
    title: 'Gipfelbrecher',
  },
  cmb_thunzharr_ten: {
    name: 'Berge aus Gewohnheit',
    desc: 'Bringe Thunzharr, den Erwachenden Gipfel, zehnmal zu Fall.',
  },
  dlv_reliquary: { name: 'Reliquiarläufer', desc: 'Säubere das Eingestürzte Reliquiar.' },
  dlv_reliquary_heroic: {
    name: 'Heroisch: Das Eingestürzte Reliquiar',
    desc: 'Säubere das Eingestürzte Reliquiar auf heroischer Stufe.',
  },
  dlv_litany: { name: 'Die Litanei verstummt', desc: 'Säubere die Ertrunkene Litanei.' },
  dlv_litany_heroic: {
    name: 'Heroisch: Die Ertrunkene Litanei',
    desc: 'Säubere die Ertrunkene Litanei auf heroischer Stufe.',
  },
  dlv_lore_journal: {
    name: 'Marginalien',
    desc: 'Schalte alle fünf Einträge des Tiefgangsjournals frei.',
  },
  dlv_companion_max: {
    name: 'Eine Freundin in der Tiefe',
    desc: 'Bringe eine Tiefgangsgefährtin auf ihren höchsten Rang.',
  },
  dlv_companions_both: {
    name: 'Beide Laternen entzündet',
    desc: 'Bringe beide Tiefgangsgefährtinnen, Akolythin Tessa und Edda Reedhand, auf ihren höchsten Rang.',
  },
  dlv_clears_50: { name: 'Fünfzig Faden tief', desc: 'Schließe 50 Tiefgangsläufe ab.' },
  dlv_solo_heroic: {
    name: 'Zwei sind ein Heer',
    desc: 'Säubere einen Tiefgang auf heroischer Stufe ohne weitere Spieler, nur du und deine Gefährtin.',
  },
  dlv_tumbler_premium: {
    name: 'Der Pfad der Zuhaltungen, gemeistert',
    desc: 'Öffne eine bannversiegelte Reliquiartruhe beim höchsten Einsatz, makellos in deinem einzigen Versuch.',
  },
  dlv_rite_flawless: {
    name: 'Textsicher',
    desc: 'Schließe den Ritus des Ertrunkenen Reliquiars ohne einen einzigen Fehler ab.',
  },
  dlv_varric_ringers: {
    name: 'Das Geläut verklingt',
    desc: 'Besiege Diakon Varric, während jeder Begräbnisläuter, den er erweckt, bereits erschlagen ist.',
  },
  dlv_nhalia_bells: {
    name: 'Glockenstiller',
    desc: 'Besiege Schwester Nhalia, die Ertrunkene Hymne, ohne dass ein Gruppenmitglied von einer Läutenden Glocke getroffen wird.',
    title: 'Glockenstiller',
  },
  chr_vale_chapter_i: {
    name: 'Talchronik, Kapitel I',
    desc: 'Schließe das erste Kapitel von Sauls Chronik ab: Eastbrooks erste Botengänge, die Lage des Tals und ein erster Vorgeschmack auf seine Gewerke.',
  },
  chr_vale_chapter_ii: {
    name: 'Talchronik, Kapitel II',
    desc: 'Schließe das zweite Kapitel von Sauls Chronik ab: Banditen, Schlammflossen und Minengeziefer erledigt, auf dem Saufeld gespielt und den Abstieg ins Reliquiar gewagt.',
  },
  chr_vale_chapter_iii: {
    name: 'Die Chronik des Tals',
    desc: 'Führe die ganze Geschichte des Tals zu Ende: der Gravecaller entlarvt, die Hohle Gruft gereinigt und jeder namhafte Schrecken des Tals niedergestreckt.',
    title: 'vom Tal',
  },
  chr_vale_gatherer: {
    name: 'Was das Land hergibt',
    desc: 'Ernte im Eastbrook-Tal eine Erzader, ein Gehölz und ein Kräuterbeet.',
  },
  chr_vale_first_cast: {
    name: 'Da ist etwas im Spiegelsee',
    desc: 'Fange einen Fisch aus den Gewässern des Eastbrook-Tals.',
  },
  chr_vale_packbreaker: {
    name: 'Rudelbrecher',
    desc: 'Erlege 3 Waldwölfe innerhalb von 10 Sekunden.',
  },
  chr_vale_cup_debut: {
    name: 'Anwärter auf den Kupfereimer',
    desc: 'Betritt das Feld und berühre den Ball in einem Vale-Cup-Match auf dem Saufeld.',
  },
  chr_vale_rares: {
    name: 'Die Schrecken des Tals',
    desc: 'Erlege die fünf namhaften Schrecken des Eastbrook-Tals: den Alten Greyjaw, Mogger, Grix den Tunnelkönig, Hauptmann Verlan und Maldrec den Geisterbinder.',
  },
  chr_marsh_chapter_i: {
    name: 'Moorchronik, Kapitel I',
    desc: 'Schließe das erste Kapitel von Osric Fenns Chronik ab: dem Musterungsruf von Fenbridge gefolgt, der Damm gesichert und die Gestalt des Fenns erkundet.',
  },
  chr_marsh_chapter_ii: {
    name: 'Moorchronik, Kapitel II',
    desc: 'Schließe das zweite Kapitel von Osric Fenns Chronik ab: die Witwen ausgeräuchert, die Ertrunkenen zur Ruhe gebettet, der Kabeljaupate an Land gezogen und den Abstieg in die Litanei gewagt.',
  },
  chr_marsh_chapter_iii: {
    name: 'Die Chronik des Mirefen',
    desc: 'Führe die ganze Geschichte des Fenns zu Ende: das Kultlager zerschlagen, der Fogbinder in der versunkenen Bastion zum Schweigen gebracht und jeder namhafte Schrecken des Nebels niedergestreckt.',
    title: 'vom Mirefen',
  },
  chr_marsh_gatherer: {
    name: 'Furagieren bei Fenbridge',
    desc: 'Ernte im Mirefen-Moor eine Erzader, ein Gehölz und ein Kräuterbeet.',
  },
  chr_marsh_unburst: {
    name: 'Steh nicht in den Sporen',
    desc: 'Erlege 8 Moor-Aufgedunsene, ohne vom Ausbruch ihrer Ätzenden Sporen erwischt zu werden.',
  },
  chr_marsh_hush_the_mending: {
    name: 'Die Heilung verstummt',
    desc: 'Erlege im Gravecaller-Lager einen Gravecaller-Wundheiler, bevor einer der Kultisten fällt, die er versorgt.',
  },
  chr_marsh_rares: {
    name: 'Namen im Nebel',
    desc: 'Erlege die drei namhaften Schrecken des Mirefen-Moors: Mirejaw den Gefräßigen, Sloomzahn den Ertrunkenen und Schwester Nhalia.',
  },
  chr_peaks_chapter_i: {
    name: 'Gipfelchronik, Kapitel I',
    desc: 'Schließe das erste Kapitel von Zenzies Chronik ab: die Gratstraße geräumt, die Baue geleert und jeden Pfad kennengelernt, den Highwatch bewacht.',
  },
  chr_peaks_chapter_ii: {
    name: 'Gipfelchronik, Kapitel II',
    desc: 'Schließe das zweite Kapitel von Zenzies Chronik ab: Drogmars Kriegslager zerschlagen, den erwachenden Sturm gedeutet und dort gestanden, wo der Glimmermere leuchtet.',
  },
  chr_peaks_chapter_iii: {
    name: 'Die Chronik von Thornpeak',
    desc: 'Führe die ganze Geschichte des Berges zu Ende: der Wyrmkult zerschlagen, das Heiligtum zum Schweigen gebracht, der Erwachende Gipfel gefällt und jeder namhafte Schrecken der Felsen niedergestreckt.',
    title: 'von Thornpeak',
  },
  chr_peaks_sparring: {
    name: 'Drill an der Mauer',
    desc: 'Verursache insgesamt 1.000 Schaden an der Trainingspuppe über Highwatch.',
  },
  chr_peaks_glimmer_cast: {
    name: 'Kaltes Wasser, kälteres Licht',
    desc: 'Fange einen Fisch aus dem Glimmermere.',
  },
  chr_peaks_moongate: {
    name: 'Durch das kalte Tor',
    desc: 'Durchschreite das Mondtor am Ufer des Glimmermere.',
  },
  chr_peaks_waking_witness: {
    name: 'Der Berg, der wandelt',
    desc: 'Erblicke Thunzharr, den Erwachenden Gipfel, während er über den Berg schreitet.',
  },
  chr_peaks_rares: {
    name: 'In den Fels gemeißelte Namen',
    desc: 'Erlege die vier namhaften Schrecken der Thornpeak-Höhen: den Eisenader-Vorarbeiter, Brutok Schädelschmetterer, Voskar Glutschwinge und Marklord Varkas.',
  },
  col_discovery_25: {
    name: 'Hamsterer',
    desc: 'Entdecke 25 verschiedene Gegenstände (ein Gegenstand zählt, wenn er zum ersten Mal in deinen Besitz gelangt).',
  },
  col_discovery_75: { name: 'Elster', desc: 'Entdecke 75 verschiedene Gegenstände.' },
  col_discovery_150: {
    name: 'Wunderkammer',
    desc: 'Entdecke 150 verschiedene Gegenstände.',
    title: 'Kustos',
  },
  col_discovery_250: { name: 'Der große Katalog', desc: 'Entdecke 250 verschiedene Gegenstände.' },
  col_first_rare: {
    name: 'Etwas Blaues',
    desc: 'Erhalte deinen ersten Gegenstand von seltener Qualität.',
  },
  col_first_epic: {
    name: 'Purpurgeboren',
    desc: 'Erhalte deinen ersten Gegenstand von epischer Qualität.',
  },
  col_first_legendary: {
    name: 'Orangenehm überrascht',
    desc: 'Erhalte deinen ersten Gegenstand von legendärer Qualität.',
  },
  col_set_vale_arcanist: {
    name: 'Ornat des Tal-Arkanisten',
    desc: 'Entdecke jedes Teil des Ornats des Tal-Arkanisten.',
  },
  col_set_boundstone_vanguard: {
    name: 'Gebundstein-Vorhut',
    desc: 'Entdecke jedes Teil der Gebundstein-Vorhut.',
  },
  col_set_greyjaw_stalker: {
    name: 'Rüstzeug des Greyjaw-Pirschers',
    desc: 'Entdecke jedes Teil des Rüstzeugs des Greyjaw-Pirschers.',
  },
  col_set_deathlord: {
    name: 'Barrowlord-Kriegsrüstung',
    desc: 'Entdecke jedes Teil der Barrowlord-Kriegsrüstung.',
  },
  col_set_wyrmshadow: {
    name: 'Nightfang-Gewänder',
    desc: 'Entdecke jedes Teil der Nightfang-Gewänder.',
  },
  col_set_necromancers: {
    name: 'Mournweave-Gewandung',
    desc: 'Entdecke jedes Teil der Mournweave-Gewandung.',
  },
  col_set_crownforged: {
    name: 'Bonewrought-Ornat',
    desc: 'Entdecke jedes Teil des Bonewrought-Ornats.',
  },
  col_set_nighttalon: { name: 'Direfang-Pelz', desc: 'Entdecke jedes Teil des Direfang-Pelzes.' },
  col_set_soulflame: {
    name: 'Wraithfire-Ornat',
    desc: 'Entdecke jedes Teil des Wraithfire-Ornats.',
  },
  col_set_stormcallers: {
    name: 'Galecall-Gewänder',
    desc: 'Entdecke jedes Teil der Galecall-Gewänder.',
  },
  col_seven_regalia: {
    name: 'Die siebenfache Garderobe',
    desc: 'Entdecke jedes Teil aller sieben epischen Rüstungsfamilien.',
    title: 'in voller Pracht',
  },
  col_true_colors: {
    name: 'Farbe bekennen',
    desc: 'Zeig dich im Feld mit einem anderen Erscheinungsbild als dem Standard deiner Klasse.',
  },
  col_all_slots: {
    name: 'Aufgebrezelt hoch elf',
    desc: 'Trage gleichzeitig in allen elf Ausrüstungsplätzen einen Gegenstand.',
  },
  col_quartermaster_buyout: {
    name: 'Stammkunde',
    desc: 'Entdecke alle zehn Stücke aus dem Vorrat des Heroischen Quartiermeisters.',
  },
  col_glimmerfin: { name: 'Ein Schimmer Hoffnung', desc: 'Fange einen Schimmerflossen-Koi.' },
  col_full_creel: {
    name: 'Voller Fangkorb',
    desc: 'Entdecke alle sechs gewöhnlichen Fänge aus den Gewässern des Tals, des Moors und der Höhen.',
  },
  col_junk_drawer: {
    name: 'Die Krimskramsschublade',
    desc: 'Entdecke 10 verschiedene Gegenstände von schlechter Qualität.',
  },
  pvp_arena_first_match: {
    name: 'Sand in den Stiefeln',
    desc: 'Bestreite ein gewertetes Match im Aschenkolosseum, gleich in welchem Modus.',
  },
  pvp_arena_first_win: {
    name: 'Die Menge tobt',
    desc: 'Gewinne ein gewertetes Arenamatch, gleich in welchem Modus.',
  },
  pvp_arena_1v1_1600: {
    name: 'Anwärter des Kolosseums',
    desc: 'Erreiche eine Wertung von 1600 im 1v1-Arenamodus.',
  },
  pvp_arena_1v1_1750: {
    name: 'Rivale des Kolosseums',
    desc: 'Erreiche eine Wertung von 1750 im 1v1-Arenamodus.',
  },
  pvp_arena_1v1_1900: {
    name: 'Gladiator',
    desc: 'Erreiche eine Wertung von 1900 im 1v1-Arenamodus.',
    title: 'Gladiator',
  },
  pvp_arena_2v2_1600: {
    name: 'Zu zweit stark',
    desc: 'Erreiche eine Wertung von 1600 im 2v2-Arenamodus.',
  },
  pvp_arena_2v2_1750: {
    name: 'Gefürchtetes Duo',
    desc: 'Erreiche eine Wertung von 1750 im 2v2-Arenamodus.',
  },
  pvp_arena_2v2_1900: {
    name: 'Perfektes Gespann',
    desc: 'Erreiche eine Wertung von 1900 im 2v2-Arenamodus.',
  },
  pvp_duel_first_win: { name: 'Das klären wir draußen', desc: 'Gewinne ein Duell.' },
  pvp_duel_grace: {
    name: 'Eine Lektion in Demut',
    desc: 'Verliere ein Duell und bewahre dabei den Großteil deiner Würde.',
  },
  pvp_vcup_first_match: {
    name: 'Stiefel auf dem Rasen',
    desc: 'Bestreite ein Talpokal-Match auf dem Saufeld bis zum Schlusspfiff, ob Sieg oder Niederlage.',
  },
  pvp_vcup_first_win: { name: 'Der erste Pott', desc: 'Gewinne ein gewertetes Talpokal-Match.' },
  pvp_vcup_wins_10: {
    name: 'Keilerball-Routinier',
    desc: 'Gewinne 10 gewertete Talpokal-Matches.',
  },
  pvp_vcup_wins_25: {
    name: 'Keilerball-Legende',
    desc: 'Gewinne 25 gewertete Talpokal-Matches.',
    title: 'Keilerball-Legende',
  },
  pvp_vcup_first_goal: {
    name: 'Der Bann ist gebrochen',
    desc: 'Erziele ein Tor in einem gewerteten Talpokal-Match.',
  },
  pvp_vcup_hat_trick: {
    name: 'Hattrick-Held',
    desc: 'Erziele drei Tore in einem einzigen gewerteten Talpokal-Match, im 3v3-Modus oder größer.',
  },
  pvp_vcup_golden_goal: {
    name: 'Goldener Moment',
    desc: 'Erziele das Golden Goal, das ein gewertetes Talpokal-Match entscheidet.',
  },
  pvp_vcup_first_save: {
    name: 'Sichere Hände',
    desc: 'Pariere als Torhüter einen Ball in einem gewerteten Talpokal-Match.',
  },
  pvp_vcup_clean_sheet: {
    name: 'An mir kommt keiner vorbei',
    desc: 'Gewinne ein gewertetes Talpokal-Match als Torhüter, ohne ein Tor zu kassieren.',
  },
  pvp_vcup_guild_win: {
    name: 'Für das Banner',
    desc: 'Gewinne ein gewertetes Talpokal-Match, zu dem du unter dem Banner deiner Gilde angetreten bist.',
  },
  pvp_fiesta_first_bout: {
    name: 'Partycrasher',
    desc: 'Bestreite eine volle 2v2-Fiesta-Runde, ob Sieg oder Niederlage.',
  },
  pvp_fiesta_first_win: { name: 'Die Seele der Fiesta', desc: 'Gewinne eine 2v2-Fiesta-Runde.' },
  pvp_fiesta_double: {
    name: 'Doppelter Ärger',
    desc: 'Erziele zwei Fiesta-Niederschläge innerhalb von vier Sekunden.',
  },
  pvp_fiesta_shutdown: {
    name: 'Spielverderber',
    desc: 'Schalte einen Fiesta-Gegner aus, der auf einer Serie von drei oder mehr steht.',
  },
  pvp_fiesta_full_build: {
    name: 'Passend gekleidet',
    desc: 'Gewinne eine Fiesta-Runde mit einer gesicherten Verstärkung aus jeder der drei Wellen.',
  },
  pvp_fiesta_powerups: {
    name: 'Von jedem eins',
    desc: 'Schnapp dir jedes der vier Ring-Power-ups mindestens einmal: Tempoteufel, Koloss, Mondstiefel und Berserker.',
  },
  pvp_fiesta_five_kills: {
    name: 'Partyträger',
    desc: 'Erziele fünf Niederschläge in einer einzigen Fiesta-Runde.',
  },
  soc_first_party: {
    name: 'Gemeinsam stärker',
    desc: 'Schließe dich mit einem anderen Spieler zu einer Gruppe zusammen.',
  },
  soc_full_house: {
    name: 'Volles Haus',
    desc: 'Bezwinge einen Dungeon mit einer vollen Fünfergruppe.',
  },
  soc_guild_joined: { name: 'Unter einem Banner', desc: 'Werde Mitglied einer Gilde.' },
  soc_guild_founded: { name: 'Die Feder des Gründers', desc: 'Gründe deine eigene Gilde.' },
  soc_first_trade: {
    name: 'Ein fairer Handel',
    desc: 'Schließe einen Handel mit einem anderen Spieler ab.',
  },
  soc_first_sale: {
    name: 'Offen für Geschäfte',
    desc: 'Streiche die Münzen aus deinem ersten Verkauf auf dem Weltmarkt ein.',
  },
  soc_steady_custom: {
    name: 'Treue Kundschaft',
    desc: 'Streiche aus deinen Verkäufen auf dem Weltmarkt insgesamt 10 Gold ein.',
  },
  soc_market_magnate: {
    name: 'Marktmagnat',
    desc: 'Streiche aus deinen Verkäufen auf dem Weltmarkt insgesamt 100 Gold ein.',
    title: 'Magnat',
  },
  soc_by_ravens_wing: {
    name: 'Auf Rabenschwingen',
    desc: 'Verschicke einen Rabenpost-Brief mit Münzen oder einem Paket.',
  },
  soc_room_for_more: { name: 'Platz für mehr', desc: 'Kaufe deine erste Bankerweiterung.' },
  soc_gilded_strongbox: {
    name: 'Die Vergoldete Schatulle',
    desc: 'Kaufe jede Bankerweiterung, die die Kämmerer dir verkaufen.',
  },
  soc_meet_bursar: {
    name: 'Auf Fernando ist Verlass',
    desc: 'Erweise Kämmerer Fernando, dem Hüter der Vergoldeten Schatulle in Eastbrook, deine Ehrerbietung.',
  },
  soc_pocket_money: { name: 'Taschengeld', desc: 'Erbeute insgesamt 1 Gold in Münzen.' },
  soc_heavy_purse: { name: 'Ein schwerer Beutel', desc: 'Erbeute insgesamt 10 Gold in Münzen.' },
  soc_wyrms_hoard: { name: 'Der Hort eines Wyrms', desc: 'Erbeute insgesamt 100 Gold in Münzen.' },
  soc_civic_duty: { name: 'Bürgerpflicht', desc: 'Vergib deinen ersten Stadtfokus-Punkt.' },
  exp_long_road_north: {
    name: 'Die lange Straße gen Norden',
    desc: 'Besuche alle drei Hauptorte: Eastbrook, Fenbridge und Highwatch.',
  },
  exp_vale_wayfarer: {
    name: 'Wanderer des Tals',
    desc: 'Besuche alle elf benannten Orte des Eastbrook-Tals.',
  },
  exp_marsh_wayfarer: {
    name: 'Wanderer des Moors',
    desc: 'Besuche alle acht benannten Orte des Mirefen-Moors.',
  },
  exp_peaks_wayfarer: {
    name: 'Wanderer der Höhen',
    desc: 'Besuche alle zehn benannten Orte der Thornpeak-Höhen.',
  },
  exp_world_traveler: {
    name: 'Weltenbummler',
    desc: 'Erringe die Wanderer-Tat aller drei Zonen.',
    title: 'der Wanderer',
  },
  exp_something_shiny: {
    name: 'Etwas Glitzerndes',
    desc: 'Hebe ein funkelndes Objekt vom Boden auf.',
  },
  exp_first_ore: { name: 'Hau in den Fels', desc: 'Baue dein erstes Erzvorkommen ab.' },
  exp_first_timber: { name: 'Baum fällt!', desc: 'Ernte dein erstes Holzvorkommen.' },
  exp_first_herb: { name: 'Ein grüner Daumen', desc: 'Ernte dein erstes Kräutervorkommen.' },
  feat_era_cap: {
    name: 'Kind der Ersten Ära',
    desc: 'Stufe 20 erreicht, als die Erste Ära noch im Gange war.',
  },
  feat_book_complete: { name: 'Das ganze Buch', desc: 'Erringe jede Tat im Buch der Taten.' },
  feat_brightwood_relic: {
    name: 'Hellholz unvergessen',
    desc: 'Bewahre ein Relikt des alten Hellholzes: das Dornhaut-Wams oder die Krone des Monarchen.',
  },
  hid_saul_footnote: {
    name: 'Eine Fußnote der Geschichte',
    desc: 'Saul den Chronisten neunmal ohne Pause belästigt.',
    title: 'die Fußnote',
  },
  hid_gilded_tour: {
    name: 'Die vergoldete Rundreise',
    desc: 'Mit allen drei Filialen der Vergoldeten Schatulle Geschäfte gemacht.',
  },
  hid_fall_death: {
    name: 'Die Schwerkraft gewinnt immer',
    desc: 'An einem langen Zwiegespräch mit dem Boden verstorben.',
  },
  hid_keepers_toll_twice: {
    name: 'Der Hüter kassiert zweimal',
    desc: 'Gestorben, während der Zoll des Hüters noch auf dir lastete.',
  },
  hid_roll_hundred: {
    name: 'Eine glatte Hundert',
    desc: 'Bei einem schlichten /roll eine perfekte 100 gewürfelt.',
  },
  hid_yumi_cheer: {
    name: 'Yumis größter Fan',
    desc: 'Mitten im Kampf für Yumi gejubelt, wo sie dich hören konnte.',
  },
  hid_bountiful_coffer: {
    name: 'Die purpurne Truhe',
    desc: 'Eine Reiche Truhe geknackt, bevor sie sich verklemmen konnte.',
  },
  hid_companion_save: {
    name: 'Nicht, solange sie wacht',
    desc: 'Deine Tiefgang-Gefährtin hat ein gefallenes Gruppenmitglied zurück auf die Beine gehievt.',
  },
  hid_codfather: {
    name: 'In die Familie aufgenommen',
    desc: 'Den Kabeljaupaten aus den Deepfen-Untiefen gezogen.',
  },
  prog_crown_below: {
    name: 'Die Krone in der Tiefe',
    desc: 'Folge der Krone von den ruhelosen Knochenfeldern bis zum Grab von König Nythraxis und führe „Das Ende der Geißel“ zum Abschluss.',
  },
  prog_mere_at_rest: {
    name: 'Stille über dem See',
    desc: 'Begleite Ondrel Vanes Wacht bis zu ihrem Ende: der Chor zum Schweigen gebracht, der Bleichwinder erschlagen und der Ertränkte Mond zur Ruhe gebettet.',
  },
  prog_callused_hands: {
    name: 'Schwielige Hände',
    desc: 'Schließe „Ein Handwerk für jede Hand“ ab und verdiene dir deine erste Schwiele in den Handwerken von Eastbrook.',
  },
  prog_tools_of_the_trade: {
    name: 'Werkzeuge des Handwerks',
    desc: 'Schließe eine an eine Werkstation gebundene Herstellung im Handwerkszentrum von Highwatch ab.',
  },
  dgn_nythraxis_crypt: {
    name: 'Was die Krypta hütete',
    desc: 'Trotze der Verlassenen Krypta und birg beide Hälften des Kryptenschlüssels sowie das Alte Tagebuch von ihren Wächtern.',
  },
  chr_marsh_first_cast: {
    name: 'Aale im Schilf',
    desc: 'Fange einen Fisch aus den Gewässern des Mirefen-Moors.',
  },
};
