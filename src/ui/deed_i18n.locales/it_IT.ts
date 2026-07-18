// Deed name / desc / title locale table for it_IT (data-as-code, size-exempt).
// One per-base-locale chunk behind DEED_LOCALE_LOADERS in deed_i18n.ts, so a
// visitor downloads only their own locale's deed strings. Split verbatim from
// the former deed_i18n.newlocales.ts single chunk; values carry no em or en
// dashes (repo copy rule). English (en / en_CA) resolves to the authored
// source before this table is consulted.
import type { DeedLocaleTable } from '../deed_i18n';

export const table: DeedLocaleTable = {
  pvp_card_duel_first_win: {
    name: 'Regole di Casa',
    desc: 'Vinci un Duello di Carte dal Maestro delle Carte.',
  },
  prog_first_steps: {
    name: 'Primi Passi',
    desc: 'Raggiungi il livello 2 e muovi il primo passo su una lunga strada.',
  },
  prog_finding_your_feet: {
    name: 'Passo Sicuro',
    desc: "Raggiungi il livello 5; le terre selvagge sembrano già un po' più piccole.",
  },
  prog_double_digits: {
    name: 'Doppia Cifra',
    desc: 'Raggiungi il livello 10 e sblocca i tuoi talenti.',
  },
  prog_the_long_middle: { name: 'Nel Mezzo del Cammino', desc: 'Raggiungi il livello 15.' },
  prog_level_cap: {
    name: 'La Vista dalla Cima',
    desc: 'Raggiungi il livello 20, il livello massimo.',
  },
  prog_well_rested: {
    name: 'Ben Riposato',
    desc: 'Sistemati in una locanda finché non avrai maturato esperienza riposata.',
  },
  prog_talented: { name: 'Un Punto Ben Speso', desc: 'Spendi il tuo primo punto talento.' },
  prog_specialized: {
    name: "Dichiarazione d'Intenti",
    desc: 'Scegli una specializzazione e apprendi la sua abilità distintiva.',
  },
  prog_deep_roots: {
    name: 'Radici Profonde',
    desc: "Spendi un punto talento in un talento dell'ultima fila.",
  },
  prog_full_build: {
    name: 'Sei su Sei',
    desc: 'Seleziona un’opzione in tutte e sei le righe dei talenti di una singola configurazione.',
  },
  prog_veteran: {
    name: 'Veterano',
    desc: 'Guadagna 250.000 punti esperienza complessivi.',
    title: 'Veterano',
  },
  prog_champion: {
    name: 'Campione',
    desc: 'Guadagna 500.000 punti esperienza complessivi.',
    title: 'Campione',
  },
  prog_paragon: {
    name: 'Esemplare',
    desc: 'Guadagna 1.000.000 di punti esperienza complessivi.',
    title: 'Esemplare',
  },
  prog_mythic: {
    name: 'Mitico',
    desc: 'Guadagna 2.500.000 punti esperienza complessivi.',
    title: 'Mitico',
  },
  prog_eternal: {
    name: 'Eterno',
    desc: 'Guadagna 5.000.000 di punti esperienza complessivi.',
    title: 'Eterno',
  },
  prog_prestige: {
    name: 'Ricominciare da Capo',
    desc: 'Raggiungi il livello massimo, riempi la barra ancora una volta e rivendica il grado di prestigio 1.',
  },
  prog_prestige_5: { name: 'Vecchie Abitudini', desc: 'Raggiungi il grado di prestigio 5.' },
  prog_prestige_10: { name: 'Moto Perpetuo', desc: 'Raggiungi il grado di prestigio 10.' },
  prog_first_harvest: {
    name: 'I Frutti del Campo',
    desc: 'Raccogli il tuo primo nodo di raccolta.',
  },
  prog_mining_100: {
    name: 'Minerale nel Sangue',
    desc: 'Raggiungi 100 di competenza in Estrazione.',
  },
  prog_logging_100: { name: 'Spaccadurame', desc: 'Raggiungi 100 di competenza in Disboscamento.' },
  prog_herbalism_100: {
    name: 'Maestro del Prato',
    desc: 'Raggiungi 100 di competenza in Erboristeria.',
  },
  prog_master_gatherer: {
    name: 'Maestro Raccoglitore',
    desc: 'Raggiungi 100 di competenza in Estrazione, Disboscamento ed Erboristeria.',
  },
  prog_first_craft: {
    name: 'Fatto a Mano',
    desc: 'Porta a termine la tua prima creazione riuscita.',
  },
  prog_craft_specialist: {
    name: 'I Segreti del Mestiere',
    desc: 'Raggiungi 75 di abilità in un mestiere qualsiasi e sbloccane i vantaggi di specializzazione.',
  },
  prog_around_the_ring: {
    name: "Il Giro dell'Anello",
    desc: 'Raggiungi 25 di abilità in cinque mestieri diversi.',
  },
  cmb_first_blood: { name: 'Primo Sangue', desc: 'Sconfiggi il tuo primo nemico.' },
  cmb_slayer: { name: 'Uccisore', desc: 'Sconfiggi 1.000 nemici.' },
  cmb_legion_of_one: { name: 'Legione di Uno', desc: 'Sconfiggi 10.000 nemici.' },
  cmb_heavy_hitter: { name: 'Mano Pesante', desc: 'Infliggi 500.000 danni totali.' },
  cmb_critical_eye: { name: 'Occhio Critico', desc: 'Metti a segno 500 colpi critici.' },
  cmb_giantslayer: {
    name: 'Ammazzagiganti',
    desc: 'Assesta il colpo di grazia a un nemico superiore a te di almeno cinque livelli.',
  },
  cmb_first_fall: {
    name: 'Scrollati la Polvere di Dosso',
    desc: 'Muori per la prima volta; capita anche ai migliori.',
  },
  dgn_hollow_crypt: {
    name: 'Spaccacripte',
    desc: 'Sconfiggi Morthen il Gravecaller nella Cripta Vuota.',
  },
  dgn_sunken_bastion: {
    name: 'Il Fogbinder Slegato',
    desc: 'Sconfiggi Vael il Fogbinder nel Bastione Sommerso.',
  },
  dgn_drowned_temple: {
    name: 'Annegare la Luna',
    desc: 'Sconfiggi Ysolei, Avatar della Luna Annegata, nel Tempio Annegato.',
  },
  dgn_gravewyrm_sanctum: {
    name: 'Il Wyrm nel Profondo',
    desc: 'Sconfiggi Korzul il Gravewyrm nel Santuario del Gravewyrm.',
  },
  dgn_hollow_crypt_heroic: {
    name: 'Eroico: La Cripta Vuota',
    desc: 'Sconfiggi Morthen il Gravecaller nella Cripta Vuota in difficoltà Eroica.',
  },
  dgn_sunken_bastion_heroic: {
    name: 'Eroico: Il Bastione Sommerso',
    desc: 'Sconfiggi Vael il Fogbinder nel Bastione Sommerso in difficoltà Eroica.',
  },
  dgn_drowned_temple_heroic: {
    name: 'Eroico: Il Tempio Annegato',
    desc: 'Sconfiggi Ysolei, Avatar della Luna Annegata, nel Tempio Annegato in difficoltà Eroica.',
  },
  dgn_gravewyrm_sanctum_heroic: {
    name: 'Eroico: Santuario del Gravewyrm',
    desc: 'Sconfiggi Korzul il Gravewyrm nel Santuario del Gravewyrm in difficoltà Eroica.',
  },
  dgn_nythraxis: {
    name: 'Flagello Mai Più',
    desc: 'Sconfiggi Nythraxis, Flagello di Thornpeak, oltre la porta reale sigillata.',
  },
  dgn_nythraxis_heroic: {
    name: 'Eroico: Flagello Mai Più',
    desc: 'Sconfiggi Nythraxis, Flagello di Thornpeak, in difficoltà Eroica.',
  },
  dgn_thornpeak_rounds: {
    name: 'Il Gran Giro',
    desc: 'Ripulisci la Cripta Vuota, il Bastione Sommerso, il Tempio Annegato e il Santuario del Gravewyrm.',
  },
  dgn_deepward: {
    name: 'Custode del Profondo',
    desc: 'Conquista ogni dungeon, il raid ed entrambe le incursioni in difficoltà Eroica.',
  },
  dgn_mark_circuit: {
    name: 'Il Circuito Completo',
    desc: 'Ottieni Marchi Eroici da tutti e quattro i dungeon Eroici in un solo giorno.',
  },
  dgn_boss_clears_50: {
    name: 'Cinquanta Porte Dopo',
    desc: 'Sconfiggi 50 boss finali dei dungeon.',
  },
  dgn_morthen_flawless: {
    name: 'Nemmeno un Osso Rotto',
    desc: 'Sconfiggi Morthen il Gravecaller in difficoltà Eroica senza che alcun membro del gruppo muoia.',
  },
  dgn_morthen_trio: {
    name: 'Tre Contro la Tomba',
    desc: 'Sconfiggi Morthen il Gravecaller con tre giocatori o meno.',
  },
  dgn_olen_arc: {
    name: 'Schivare il Mietitore',
    desc: 'Sconfiggi il Cavaliere comandante Olen senza che il suo Arco Mietitore colpisca nessuno oltre al suo bersaglio attuale.',
  },
  dgn_vael_thralls: {
    name: 'Servo di Nessuno',
    desc: 'Sconfiggi Vael il Fogbinder con ogni Servo annegato da lui richiamato già ucciso.',
  },
  dgn_ysolei_moonspawn: {
    name: "Fino all'Ultima Progenie Lunare",
    desc: 'Sconfiggi Ysolei con ogni Progenie Lunare da lei richiamata già uccisa.',
  },
  dgn_ysolei_flawless: {
    name: 'Occhi Asciutti',
    desc: 'Sconfiggi Ysolei, Avatar della Luna Annegata, in difficoltà Eroica senza che alcun membro del gruppo muoia.',
  },
  dgn_velkhar_bonewalkers: {
    name: 'Restate Sepolti',
    desc: 'Sconfiggi il Grande negromante Velkhar con ogni Camminatore di ossa risorto distrutto prima che lui cada.',
  },
  dgn_korzul_flawless: {
    name: 'Abbattiwyrm',
    desc: 'Sconfiggi Korzul il Gravewyrm in difficoltà Eroica senza che alcun membro del gruppo muoia.',
    title: 'Abbattiwyrm',
  },
  dgn_sanctum_speed: {
    name: 'Scatto nel Santuario',
    desc: 'Sconfiggi Korzul il Gravewyrm entro 15 minuti da quando il tuo gruppo rivendica il Santuario del Gravewyrm.',
  },
  dgn_nythraxis_gravebreaker: {
    name: 'Mai Piegarsi a un Re',
    desc: 'Sconfiggi Nythraxis senza che Spaccatombe colpisca mai nessuno oltre al suo bersaglio attuale.',
  },
  dgn_nythraxis_wardens: {
    name: 'Custodi delle Pietre di Guardia',
    desc: 'Sconfiggi Nythraxis con ogni Furia Senza Morte spezzata prima che colpisca.',
  },
  dgn_nythraxis_deathless: {
    name: 'I Veri Senzamorte',
    desc: 'Sconfiggi Nythraxis, Flagello di Thornpeak, in difficoltà Eroica senza che un solo membro del raid muoia.',
    title: 'il Senzamorte',
  },
  cmb_thunzharr: {
    name: 'La Montagna è Caduta',
    desc: 'Abbatti Thunzharr, il Picco Risvegliato, a Stormcrag.',
  },
  cmb_thunzharr_unbroken: {
    name: 'Spaccavette',
    desc: 'Abbatti Thunzharr, il Picco Risvegliato, senza morire dal tuo primo colpo al suo ultimo respiro.',
    title: 'Spaccavette',
  },
  cmb_thunzharr_ten: {
    name: 'Il Vizio delle Montagne',
    desc: 'Abbatti Thunzharr, il Picco Risvegliato, dieci volte.',
  },
  dlv_reliquary: { name: 'Corridore del Reliquiario', desc: 'Ripulisci il Reliquiario Crollato.' },
  dlv_reliquary_heroic: {
    name: 'Eroico: Il Reliquiario Crollato',
    desc: 'Ripulisci il Reliquiario Crollato al livello Eroico.',
  },
  dlv_litany: { name: 'Silenzio sulla Litania', desc: 'Ripulisci la Litania Annegata.' },
  dlv_litany_heroic: {
    name: 'Eroico: La Litania Annegata',
    desc: 'Ripulisci la Litania Annegata al livello Eroico.',
  },
  dlv_lore_journal: {
    name: 'Note a Margine',
    desc: 'Sblocca tutte e cinque le voci del diario delle incursioni.',
  },
  dlv_companion_max: {
    name: "Un'Amica nel Profondo",
    desc: "Porta una compagna d'incursione al suo grado più alto.",
  },
  dlv_companions_both: {
    name: 'Due Lanterne Accese',
    desc: "Porta entrambe le compagne d'incursione, l'Accolita Tessa ed Edda Reedhand, al loro grado più alto.",
  },
  dlv_clears_50: { name: 'Cinquanta Braccia di Profondità', desc: 'Completa 50 incursioni.' },
  dlv_solo_heroic: {
    name: 'In Due è già Folla',
    desc: "Ripulisci un'incursione di livello Eroico senza nessun altro giocatore, solo tu e la tua compagna.",
  },
  dlv_tumbler_premium: {
    name: 'La Via del Nottolino, alla Perfezione',
    desc: 'Apri uno scrigno sigillato del reliquiario alla posta più alta, senza errori al tuo unico tentativo.',
  },
  dlv_rite_flawless: {
    name: 'Parola per Parola',
    desc: 'Completa il Rito del Reliquiario Annegato senza un solo errore.',
  },
  dlv_varric_ringers: {
    name: 'Le Campane Tacciono',
    desc: 'Sconfiggi il Diacono Varric quando ogni Campanaro Funebre che risveglia è già stato ucciso.',
  },
  dlv_nhalia_bells: {
    name: 'Fermacampane',
    desc: 'Sconfiggi Sorella Nhalia, il Cantico Annegato, senza che nessun membro del gruppo venga colpito da una Campana Rintoccante.',
    title: 'Fermacampane',
  },
  chr_vale_chapter_i: {
    name: 'Cronaca della Valle, Capitolo I',
    desc: 'Concludi il primo capitolo della cronaca di Saul: le prime commissioni di Eastbrook, la conformazione della Valle e un primo assaggio dei suoi mestieri.',
  },
  chr_vale_chapter_ii: {
    name: 'Cronaca della Valle, Capitolo II',
    desc: 'Concludi il secondo capitolo della cronaca di Saul: banditi, murloc e parassiti della miniera sterminati, una partita giocata al Campo della Scrofa e il Reliquiario affrontato.',
  },
  chr_vale_chapter_iii: {
    name: 'Cronaca della Valle',
    desc: "Porta a compimento l'intera storia della Valle: il Gravecaller smascherato, la Cripta Vuota purificata e ogni terrore famigerato della Valle abbattuto.",
    title: 'della Valle',
  },
  chr_vale_gatherer: {
    name: 'Vivere della Terra',
    desc: "Raccogli una vena di minerale, un ceppo di legname e una macchia d'erbe nella Valle di Eastbrook.",
  },
  chr_vale_first_cast: {
    name: 'Qualcosa nel Lago Specchio',
    desc: 'Pesca un pesce nelle acque della Valle di Eastbrook.',
  },
  chr_vale_packbreaker: {
    name: 'Spezzabranco',
    desc: 'Uccidi 3 Lupi della foresta entro 10 secondi.',
  },
  chr_vale_cup_debut: {
    name: 'Contendente del Secchio di Rame',
    desc: 'Scendi in campo e tocca la palla in una partita della Coppa della Valle al Campo della Scrofa.',
  },
  chr_vale_rares: {
    name: 'I Terrori della Valle',
    desc: 'Uccidi i cinque terrori famigerati della Valle di Eastbrook: il Vecchio Greyjaw, Mogger, Grix il Re dei Cunicoli, il Capitano Verlan e Maldrec il Legaspettri.',
  },
  chr_marsh_chapter_i: {
    name: 'Cronaca della Palude, Capitolo I',
    desc: 'Concludi il primo capitolo della cronaca di Osric Fenn: rispondi al raduno di Fenbridge, metti al sicuro la strada rialzata e impara la forma della palude.',
  },
  chr_marsh_chapter_ii: {
    name: 'Cronaca della Palude, Capitolo II',
    desc: 'Concludi il secondo capitolo della cronaca di Osric Fenn: le vedove scacciate col fuoco, gli annegati messi a riposo, il Pescadrino tirato a riva e la Litania affrontata.',
  },
  chr_marsh_chapter_iii: {
    name: 'Cronaca di Mirefen',
    desc: "Porta a compimento l'intera storia della palude: il campo del culto distrutto, il Fogbinder ridotto al silenzio nel Bastione Sommerso e ogni terrore famigerato della nebbia abbattuto.",
    title: 'di Mirefen',
  },
  chr_marsh_gatherer: {
    name: 'Raccolto di Fenbridge',
    desc: "Raccogli una vena di minerale, un ceppo di legname e una macchia d'erbe nella Palude di Mirefen.",
  },
  chr_marsh_unburst: {
    name: 'Non Restare nelle Spore',
    desc: "Uccidi 8 Gonfioni del pantano senza farti cogliere dall'esplosione delle loro Spore Caustiche.",
  },
  chr_marsh_hush_the_mending: {
    name: 'Silenzio alle Cure',
    desc: 'Nel campo Gravecaller, uccidi un Risanatore Gravecaller prima di qualsiasi cultista che ha in cura.',
  },
  chr_marsh_rares: {
    name: 'Nomi nella Nebbia',
    desc: "Uccidi i tre terrori famigerati della Palude di Mirefen: Mirejaw il Famelico, Sloomtooth l'Annegato e Sorella Nhalia.",
  },
  chr_peaks_chapter_i: {
    name: 'Cronaca delle Vette, Capitolo I',
    desc: 'Concludi il primo capitolo della cronaca di Zenzie: sgombra la strada della cresta, svuota le tane e impara ogni sentiero che Highwatch protegge.',
  },
  chr_peaks_chapter_ii: {
    name: 'Cronaca delle Vette, Capitolo II',
    desc: 'Concludi il secondo capitolo della cronaca di Zenzie: distruggi il campo di guerra di Drogmar, decifra la tempesta che si risveglia e fermati là dove il Glimmermere risplende.',
  },
  chr_peaks_chapter_iii: {
    name: 'Cronaca di Thornpeak',
    desc: "Porta a compimento l'intera storia della montagna: il Culto del Wyrm spezzato, il Santuario ridotto al silenzio, il Picco Risvegliato abbattuto e ogni terrore famigerato delle rupi eliminato.",
    title: 'di Thornpeak',
  },
  chr_peaks_sparring: {
    name: 'Esercitazioni sul Muro',
    desc: "Infliggi 1.000 danni totali al manichino d'allenamento sopra Highwatch.",
  },
  chr_peaks_glimmer_cast: {
    name: 'Acqua Fredda, Luce più Fredda',
    desc: 'Pesca un pesce nel Glimmermere.',
  },
  chr_peaks_moongate: {
    name: 'Oltre il Cancello Freddo',
    desc: 'Attraversa il cancello lunare sulla riva del Glimmermere.',
  },
  chr_peaks_waking_witness: {
    name: 'La Montagna che Cammina',
    desc: 'Posa lo sguardo su Thunzharr, il Picco Risvegliato, mentre incede sulla montagna.',
  },
  chr_peaks_rares: {
    name: 'Nomi Incisi nella Rupe',
    desc: 'Uccidi i quattro terrori famigerati delle Alture di Thornpeak: il Caposquadra Venaferrata, Brutok Spaccacranio, Voskar Aladibrace e il Signore del Midollo Varkas.',
  },
  col_discovery_25: {
    name: 'Accaparratore',
    desc: 'Scopri 25 oggetti diversi (un oggetto conta la prima volta che entra in tuo possesso).',
  },
  col_discovery_75: { name: 'Gazza Ladra', desc: 'Scopri 75 oggetti diversi.' },
  col_discovery_150: {
    name: 'Camera delle Meraviglie',
    desc: 'Scopri 150 oggetti diversi.',
    title: 'il Curatore',
  },
  col_discovery_250: { name: 'Il Gran Catalogo', desc: 'Scopri 250 oggetti diversi.' },
  col_first_rare: {
    name: 'Qualcosa di Blu',
    desc: 'Ottieni il tuo primo oggetto di qualità rara.',
  },
  col_first_epic: {
    name: 'Nato nella Porpora',
    desc: 'Ottieni il tuo primo oggetto di qualità epica.',
  },
  col_first_legendary: {
    name: "Un Colpo d'Arancio",
    desc: 'Ottieni il tuo primo oggetto di qualità leggendaria.',
  },
  col_set_vale_arcanist: {
    name: "Regalia dell'Arcanista della Valle",
    desc: "Scopri ogni pezzo delle Regalia dell'Arcanista della Valle.",
  },
  col_set_boundstone_vanguard: {
    name: 'Avanguardia Pietrvincolo',
    desc: "Scopri ogni pezzo dell'Avanguardia Pietrvincolo.",
  },
  col_set_greyjaw_stalker: {
    name: 'Corredo del Braccatore di Greyjaw',
    desc: 'Scopri ogni pezzo del Corredo del Braccatore di Greyjaw.',
  },
  col_set_deathlord: {
    name: 'Corredo da Guerra di Barrowlord',
    desc: 'Scopri ogni pezzo del Corredo da Guerra di Barrowlord.',
  },
  col_set_wyrmshadow: { name: 'Vesti Nightfang', desc: 'Scopri ogni pezzo delle Vesti Nightfang.' },
  col_set_necromancers: {
    name: 'Paramenti Mournweave',
    desc: 'Scopri ogni pezzo dei Paramenti Mournweave.',
  },
  col_set_crownforged: {
    name: 'Regalia Bonewrought',
    desc: 'Scopri ogni pezzo delle Regalia Bonewrought.',
  },
  col_set_nighttalon: {
    name: 'Pelliccia Direfang',
    desc: 'Scopri ogni pezzo della Pelliccia Direfang.',
  },
  col_set_soulflame: {
    name: 'Regalia Wraithfire',
    desc: 'Scopri ogni pezzo delle Regalia Wraithfire.',
  },
  col_set_stormcallers: { name: 'Vesti Galecall', desc: 'Scopri ogni pezzo delle Vesti Galecall.' },
  col_seven_regalia: {
    name: 'Il Guardaroba delle Sette Vesti',
    desc: 'Scopri ogni pezzo di tutte e sette le famiglie di armature epiche.',
    title: 'lo Sfolgorante',
  },
  col_true_colors: {
    name: 'I Tuoi Veri Colori',
    desc: 'Scendi in campo con un aspetto diverso da quello predefinito della tua classe.',
  },
  col_all_slots: {
    name: 'Di Tutto Punto, in Undici Punti',
    desc: "Indossa un oggetto in tutti e undici gli slot dell'equipaggiamento contemporaneamente.",
  },
  col_quartermaster_buyout: {
    name: 'Cliente di Riguardo',
    desc: 'Scopri tutti e dieci i pezzi della mercanzia del Quartiermastro Vex.',
  },
  col_glimmerfin: {
    name: 'Un Barlume di Speranza',
    desc: 'Pesca un Koi dalle pinne scintillanti.',
  },
  col_full_creel: {
    name: 'Cesta Piena',
    desc: 'Scopri tutte e sei le prede comuni delle acque della Valle, della Palude e delle Alture.',
  },
  col_junk_drawer: {
    name: 'Il Cassetto delle Cianfrusaglie',
    desc: 'Scopri 10 oggetti diversi di qualità scadente.',
  },
  pvp_arena_first_match: {
    name: 'Sabbia negli Stivali',
    desc: 'Disputa un incontro classificato nel Colosseo Cinereo, in una delle due categorie.',
  },
  pvp_arena_first_win: {
    name: 'Il Boato della Folla',
    desc: 'Vinci un incontro classificato in arena, in una delle due categorie.',
  },
  pvp_arena_1v1_1600: {
    name: 'Contendente del Colosseo',
    desc: "Raggiungi 1600 di valutazione nella categoria 1v1 dell'arena.",
  },
  pvp_arena_1v1_1750: {
    name: 'Rivale del Colosseo',
    desc: "Raggiungi 1750 di valutazione nella categoria 1v1 dell'arena.",
  },
  pvp_arena_1v1_1900: {
    name: 'Gladiatore',
    desc: "Raggiungi 1900 di valutazione nella categoria 1v1 dell'arena.",
    title: 'Gladiatore',
  },
  pvp_arena_2v2_1600: {
    name: 'Forti in Due',
    desc: "Raggiungi 1600 di valutazione nella categoria 2v2 dell'arena.",
  },
  pvp_arena_2v2_1750: {
    name: 'Coppia Temibile',
    desc: "Raggiungi 1750 di valutazione nella categoria 2v2 dell'arena.",
  },
  pvp_arena_2v2_1900: {
    name: 'Intesa Perfetta',
    desc: "Raggiungi 1900 di valutazione nella categoria 2v2 dell'arena.",
  },
  pvp_duel_first_win: { name: 'Risolviamola Fuori', desc: 'Vinci un duello.' },
  pvp_duel_grace: {
    name: 'Una Lezione di Umiltà',
    desc: 'Perdi un duello con la dignità quasi intatta.',
  },
  pvp_vcup_first_match: {
    name: 'Scarpini in Campo',
    desc: "Porta a termine un'intera partita di Coppa della Valle al Campo della Scrofa, vinta o persa che sia.",
  },
  pvp_vcup_first_win: {
    name: 'Primo Trofeo in Bacheca',
    desc: 'Vinci una partita classificata di Coppa della Valle.',
  },
  pvp_vcup_wins_10: {
    name: 'Vecchia Volpe del Boarball',
    desc: 'Vinci 10 partite classificate di Coppa della Valle.',
  },
  pvp_vcup_wins_25: {
    name: 'Leggenda del Boarball',
    desc: 'Vinci 25 partite classificate di Coppa della Valle.',
    title: 'Leggenda del Boarball',
  },
  pvp_vcup_first_goal: {
    name: 'A Segno',
    desc: 'Segna un gol in una partita classificata di Coppa della Valle.',
  },
  pvp_vcup_hat_trick: {
    name: 'Eroe della Tripletta',
    desc: 'Segna tre gol in una singola partita classificata di Coppa della Valle, nella categoria 3v3 o superiore.',
  },
  pvp_vcup_golden_goal: {
    name: "Momento d'Oro",
    desc: "Segna il gol d'oro che decide una partita classificata di Coppa della Valle.",
  },
  pvp_vcup_first_save: {
    name: 'Mani Sicure',
    desc: 'Effettua una parata da portiere in una partita classificata di Coppa della Valle.',
  },
  pvp_vcup_clean_sheet: {
    name: 'Di Qui Non Si Passa',
    desc: 'Vinci da portiere una partita classificata di Coppa della Valle senza subire gol.',
  },
  pvp_vcup_guild_win: {
    name: 'Per il Vessillo',
    desc: 'Vinci una partita classificata di Coppa della Valle disputata sotto il vessillo della tua gilda.',
  },
  pvp_fiesta_first_bout: {
    name: 'Imbucato alla Fiesta',
    desc: 'Combatti per intero uno scontro Fiesta 2v2, vinto o perso che sia.',
  },
  pvp_fiesta_first_win: { name: "L'Anima della Fiesta", desc: 'Vinci uno scontro Fiesta 2v2.' },
  pvp_fiesta_double: {
    name: 'Doppio Guaio',
    desc: 'Metti a segno due abbattimenti nella Fiesta nel giro di quattro secondi.',
  },
  pvp_fiesta_shutdown: {
    name: 'Guastafeste',
    desc: 'Abbatti un avversario della Fiesta che vanta una serie di tre o più abbattimenti.',
  },
  pvp_fiesta_full_build: {
    name: "In Tiro per l'Occasione",
    desc: 'Vinci uno scontro della Fiesta avendo fissato un potenziamento in ognuna delle tre ondate.',
  },
  pvp_fiesta_powerups: {
    name: 'Uno per Tipo',
    desc: 'Raccogli almeno una volta ognuno dei quattro power-up del ring: Demone della Velocità, Colosso, Stivali Lunari e Berserker.',
  },
  pvp_fiesta_five_kills: {
    name: 'Squadra in Spalla',
    desc: 'Metti a segno cinque abbattimenti in un singolo scontro della Fiesta.',
  },
  soc_first_party: {
    name: 'Meglio in Compagnia',
    desc: 'Unisciti a un gruppo con un altro giocatore.',
  },
  soc_full_house: {
    name: 'Al Gran Completo',
    desc: 'Completa un dungeon con un gruppo al completo di cinque membri.',
  },
  soc_guild_joined: { name: "Sotto un'Unica Bandiera", desc: 'Diventa membro di una gilda.' },
  soc_guild_founded: { name: 'La Penna del Fondatore', desc: 'Fonda una gilda tutta tua.' },
  soc_first_trade: {
    name: 'Un Equo Scambio',
    desc: 'Concludi uno scambio con un altro giocatore.',
  },
  soc_first_sale: {
    name: 'Bottega Aperta',
    desc: "Riscuoti l'incasso della tua prima vendita al Mercato Mondiale.",
  },
  soc_steady_custom: {
    name: 'Clientela Fissa',
    desc: "Riscuoti un totale complessivo di 10 monete d'oro dalle tue vendite al Mercato Mondiale.",
  },
  soc_market_magnate: {
    name: 'Magnate del Mercato',
    desc: "Riscuoti un totale complessivo di 100 monete d'oro dalle tue vendite al Mercato Mondiale.",
    title: 'Magnate',
  },
  soc_by_ravens_wing: {
    name: "Sull'Ala del Corvo",
    desc: 'Invia una lettera della Corvoposta con dentro monete o un pacco.',
  },
  soc_room_for_more: {
    name: "C'è Posto per Altro",
    desc: 'Acquista il tuo primo ampliamento della banca.',
  },
  soc_gilded_strongbox: {
    name: 'Il Forziere Dorato',
    desc: 'Acquista ogni ampliamento della banca che gli economi sono disposti a venderti.',
  },
  soc_meet_bursar: {
    name: 'In Fernando Confidiamo',
    desc: "Rendi omaggio all'Economo Fernando, custode del Forziere Dorato a Eastbrook.",
  },
  soc_pocket_money: {
    name: 'Paghetta',
    desc: "Raccogli come bottino un totale complessivo di 1 moneta d'oro in denaro sonante.",
  },
  soc_heavy_purse: {
    name: 'Borsa Pesante',
    desc: "Raccogli come bottino un totale complessivo di 10 monete d'oro in denaro sonante.",
  },
  soc_wyrms_hoard: {
    name: 'Un Tesoro da Wyrm',
    desc: "Raccogli come bottino un totale complessivo di 100 monete d'oro in denaro sonante.",
  },
  soc_civic_duty: {
    name: 'Dovere Civico',
    desc: 'Assegna il tuo primo punto di sviluppo cittadino.',
  },
  exp_long_road_north: {
    name: 'La Lunga Strada verso Nord',
    desc: 'Visita tutti e tre gli insediamenti principali: Eastbrook, Fenbridge e Highwatch.',
  },
  exp_vale_wayfarer: {
    name: 'Viandante della Valle',
    desc: 'Visita tutti gli undici luoghi noti della Valle di Eastbrook.',
  },
  exp_marsh_wayfarer: {
    name: 'Viandante della Palude',
    desc: 'Visita tutti gli otto luoghi noti della Palude di Mirefen.',
  },
  exp_peaks_wayfarer: {
    name: 'Viandante delle Alture',
    desc: 'Visita tutti i dieci luoghi noti delle Alture di Thornpeak.',
  },
  exp_world_traveler: {
    name: 'Giramondo',
    desc: "Ottieni l'impresa da viandante di tutte e tre le zone.",
    title: 'il Viandante',
  },
  exp_something_shiny: {
    name: 'Qualcosa che Luccica',
    desc: 'Raccogli da terra un oggetto scintillante.',
  },
  exp_first_ore: { name: 'Giù il Piccone', desc: 'Raccogli il tuo primo nodo di minerale.' },
  exp_first_timber: { name: "Cade l'Albero!", desc: 'Raccogli il tuo primo nodo di legname.' },
  exp_first_herb: { name: 'Pollice Verde', desc: 'Raccogli il tuo primo nodo di erbe.' },
  feat_era_cap: {
    name: 'Figlio della Prima Era',
    desc: 'Hai raggiunto il livello 20 mentre la Prima Era era in corso.',
  },
  feat_book_complete: {
    name: 'Il Libro Intero',
    desc: 'Ottieni ogni impresa del Libro delle Imprese.',
  },
  feat_brightwood_relic: {
    name: 'In Ricordo di Brightwood',
    desc: 'Conserva una reliquia della vecchia Brightwood: il Giubbotto di pelle di rovo o la Corona del Monarca.',
  },
  hid_saul_footnote: {
    name: 'Una Postilla nella Storia',
    desc: 'Hai importunato Saul il Cronista nove volte senza sosta.',
    title: 'la Postilla',
  },
  hid_gilded_tour: {
    name: 'Il Tour Dorato',
    desc: 'Hai fatto affari con tutte e tre le filiali del Forziere Dorato.',
  },
  hid_fall_death: {
    name: 'La Gravità Vince Sempre',
    desc: 'Ti è stata fatale una lunga conversazione con il suolo.',
  },
  hid_keepers_toll_twice: {
    name: 'Il Custode Riscuote Due Volte',
    desc: 'Hai incontrato la morte mentre il Tributo del Custode gravava ancora su di te.',
  },
  hid_roll_hundred: {
    name: 'Cento Naturale',
    desc: 'Hai tirato un 100 perfetto con un semplice /roll.',
  },
  hid_yumi_cheer: {
    name: 'Fan Numero Uno di Yumi',
    desc: 'Hai fatto il tifo per Yumi dove poteva sentirti, nel bel mezzo di uno scontro.',
  },
  hid_bountiful_coffer: {
    name: 'Lo Scrigno Viola',
    desc: 'Hai scassinato uno Scrigno Munifico prima che potesse incepparsi.',
  },
  hid_companion_save: {
    name: "Non Finché C'è Lei",
    desc: "La tua compagna d'incursione ha rimesso in piedi un membro del gruppo caduto.",
  },
  hid_codfather: {
    name: 'Uno di Famiglia',
    desc: 'Hai trascinato Il Pescadrino fuori dai Bassifondi di Deepfen.',
  },
  prog_crown_below: {
    name: 'La Corona Sepolta',
    desc: "Segui la corona dai campi d'ossa irrequieti fino alla tomba di re Nythraxis e porta a compimento La Fine del Flagello.",
  },
  prog_mere_at_rest: {
    name: 'La Quiete del Lago',
    desc: 'Porta a termine la veglia di Ondrel Vane: il coro messo a tacere, lo Spiropallido ucciso e la Luna Annegata deposta nel suo riposo.',
  },
  prog_callused_hands: {
    name: 'Mani Callose',
    desc: 'Completa Un Mestiere per Ogni Mano e guadagnati il primo callo nei mestieri di Eastbrook.',
  },
  prog_tools_of_the_trade: {
    name: 'Gli Attrezzi del Mestiere',
    desc: 'Completa una creazione vincolata a una postazione presso il polo artigiano di Highwatch.',
  },
  dgn_nythraxis_crypt: {
    name: 'Ciò che la Cripta Custodiva',
    desc: 'Affronta la Cripta abbandonata e recupera dai suoi guardiani entrambe le metà della chiave di volta e il diario antico.',
  },
  chr_marsh_first_cast: {
    name: 'Anguille tra le Canne',
    desc: 'Pesca un pesce nelle acque della Palude di Mirefen.',
  },
};
