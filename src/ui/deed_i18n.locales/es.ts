// Deed name / desc / title locale table for es (data-as-code, size-exempt).
// One per-base-locale chunk behind DEED_LOCALE_LOADERS in deed_i18n.ts, so a
// visitor downloads only their own locale's deed strings. Split verbatim from
// the former deed_i18n.newlocales.ts single chunk; values carry no em or en
// dashes (repo copy rule). English (en / en_CA) resolves to the authored
// source before this table is consulted.
import type { DeedLocaleTable } from '../deed_i18n';

export const table: DeedLocaleTable = {
  pvp_card_duel_first_win: {
    name: 'La baza es mía',
    desc: 'Gana un Duelo de Cartas en el Maestro de Cartas.',
  },
  prog_first_steps: {
    name: 'Primeros pasos',
    desc: 'Alcanza el nivel 2 y da tu primer paso en un largo camino.',
  },
  prog_finding_your_feet: {
    name: 'Pie firme',
    desc: 'Alcanza el nivel 5; las tierras salvajes ya se ven un poco más pequeñas.',
  },
  prog_double_digits: {
    name: 'Dos dígitos',
    desc: 'Alcanza el nivel 10 y desbloquea tus talentos.',
  },
  prog_the_long_middle: { name: 'El largo trecho', desc: 'Alcanza el nivel 15.' },
  prog_level_cap: { name: 'La vista desde la cima', desc: 'Alcanza el nivel 20, el nivel máximo.' },
  prog_well_rested: {
    name: 'Bien descansado',
    desc: 'Instálate en una posada hasta obtener experiencia de descanso.',
  },
  prog_talented: { name: 'Un punto bien gastado', desc: 'Gasta tu primer punto de talento.' },
  prog_specialized: {
    name: 'Declaración de intenciones',
    desc: 'Elige una especialización y aprende su habilidad distintiva.',
  },
  prog_deep_roots: {
    name: 'Raíces profundas',
    desc: 'Gasta un punto de talento en un talento de la última fila.',
  },
  prog_full_build: {
    name: 'Los seis al completo',
    desc: 'Selecciona una opción en las seis filas de talentos de una sola configuración.',
  },
  prog_veteran: {
    name: 'Veterano',
    desc: 'Acumula 250,000 de experiencia a lo largo de tu vida.',
    title: 'Veterano',
  },
  prog_champion: {
    name: 'Campeón',
    desc: 'Acumula 500,000 de experiencia a lo largo de tu vida.',
    title: 'Campeón',
  },
  prog_paragon: {
    name: 'Parangón',
    desc: 'Acumula 1,000,000 de experiencia a lo largo de tu vida.',
    title: 'Parangón',
  },
  prog_mythic: {
    name: 'Mítico',
    desc: 'Acumula 2,500,000 de experiencia a lo largo de tu vida.',
    title: 'Mítico',
  },
  prog_eternal: {
    name: 'Eterno',
    desc: 'Acumula 5,000,000 de experiencia a lo largo de tu vida.',
    title: 'Eterno',
  },
  prog_prestige: {
    name: 'Volver a empezar',
    desc: 'Alcanza el nivel máximo, llena la barra una vez más y reclama el rango de prestigio 1.',
  },
  prog_prestige_5: { name: 'Viejas costumbres', desc: 'Alcanza el rango de prestigio 5.' },
  prog_prestige_10: { name: 'Movimiento perpetuo', desc: 'Alcanza el rango de prestigio 10.' },
  prog_first_harvest: { name: 'Frutos del campo', desc: 'Cosecha tu primer nodo de recolección.' },
  prog_mining_100: { name: 'Mineral en la sangre', desc: 'Alcanza 100 de competencia en Minería.' },
  prog_logging_100: { name: 'Talador de duramen', desc: 'Alcanza 100 de competencia en Tala.' },
  prog_herbalism_100: {
    name: 'Maestro del prado',
    desc: 'Alcanza 100 de competencia en Herboristería.',
  },
  prog_master_gatherer: {
    name: 'Maestro recolector',
    desc: 'Alcanza 100 de competencia en Minería, Tala y Herboristería.',
  },
  prog_first_craft: { name: 'Hecho a mano', desc: 'Completa con éxito tu primera fabricación.' },
  prog_craft_specialist: {
    name: 'Secretos del oficio',
    desc: 'Alcanza 75 de habilidad en un mismo oficio y desbloquea sus ventajas de especialización.',
  },
  prog_around_the_ring: {
    name: 'La vuelta al anillo',
    desc: 'Alcanza 25 de habilidad en cinco oficios distintos.',
  },
  cmb_first_blood: { name: 'Primera sangre', desc: 'Derrota a tu primer enemigo.' },
  cmb_slayer: { name: 'Matador', desc: 'Derrota a 1,000 enemigos.' },
  cmb_legion_of_one: { name: 'Legión de uno', desc: 'Derrota a 10,000 enemigos.' },
  cmb_heavy_hitter: { name: 'Mano pesada', desc: 'Inflige 500,000 de daño en total.' },
  cmb_critical_eye: { name: 'Ojo crítico', desc: 'Asesta 500 golpes críticos.' },
  cmb_giantslayer: {
    name: 'Matagigantes',
    desc: 'Asesta el golpe mortal a un enemigo al menos cinco niveles por encima del tuyo.',
  },
  cmb_first_fall: {
    name: 'Sacúdete el polvo',
    desc: 'Muere por primera vez; le pasa hasta a los mejores.',
  },
  dgn_hollow_crypt: {
    name: 'Quiebracriptas',
    desc: 'Derrota a Morthen el Gravecaller en la Cripta Hueca.',
  },
  dgn_sunken_bastion: {
    name: 'El Fogbinder desatado',
    desc: 'Derrota a Vael el Fogbinder en el Bastión Sumergido.',
  },
  dgn_drowned_temple: {
    name: 'Ahogar la Luna',
    desc: 'Derrota a Ysolei, Avatar de la Luna Ahogada, en el Templo Ahogado.',
  },
  dgn_gravewyrm_sanctum: {
    name: 'El wyrm de las profundidades',
    desc: 'Derrota a Korzul el Gravewyrm en el Santuario del Gravewyrm.',
  },
  dgn_hollow_crypt_heroic: {
    name: 'Heroico: La Cripta Hueca',
    desc: 'Derrota a Morthen el Gravecaller en la Cripta Hueca en dificultad heroica.',
  },
  dgn_sunken_bastion_heroic: {
    name: 'Heroico: El Bastión Sumergido',
    desc: 'Derrota a Vael el Fogbinder en el Bastión Sumergido en dificultad heroica.',
  },
  dgn_drowned_temple_heroic: {
    name: 'Heroico: El Templo Ahogado',
    desc: 'Derrota a Ysolei, Avatar de la Luna Ahogada, en el Templo Ahogado en dificultad heroica.',
  },
  dgn_gravewyrm_sanctum_heroic: {
    name: 'Heroico: Santuario del Gravewyrm',
    desc: 'Derrota a Korzul el Gravewyrm en el Santuario del Gravewyrm en dificultad heroica.',
  },
  dgn_nythraxis: {
    name: 'Azote nunca más',
    desc: 'Derrota a Nythraxis, Azote de Thornpeak, más allá de la puerta real sellada.',
  },
  dgn_nythraxis_heroic: {
    name: 'Heroico: Azote nunca más',
    desc: 'Derrota a Nythraxis, Azote de Thornpeak, en dificultad heroica.',
  },
  dgn_thornpeak_rounds: {
    name: 'Hacer la ronda',
    desc: 'Supera la Cripta Hueca, el Bastión Sumergido, el Templo Ahogado y el Santuario del Gravewyrm.',
  },
  dgn_deepward: {
    name: 'Guarda de las Profundidades',
    desc: 'Conquista cada mazmorra, la banda y las dos expediciones en dificultad heroica.',
  },
  dgn_mark_circuit: {
    name: 'El circuito completo',
    desc: 'Obtén Marcas Heroicas de las cuatro mazmorras heroicas en un solo día.',
  },
  dgn_boss_clears_50: {
    name: 'Cincuenta puertas más abajo',
    desc: 'Derrota a 50 jefes finales de mazmorra.',
  },
  dgn_morthen_flawless: {
    name: 'Sin dejarse los huesos',
    desc: 'Derrota a Morthen el Gravecaller en dificultad heroica sin que muera ningún miembro del grupo.',
  },
  dgn_morthen_trio: {
    name: 'Tres contra la tumba',
    desc: 'Derrota a Morthen el Gravecaller con tres jugadores o menos.',
  },
  dgn_olen_arc: {
    name: 'Esquiva al segador',
    desc: 'Derrota al Caballero comandante Olen sin que su Arco Segador golpee a nadie más que a su objetivo actual.',
  },
  dgn_vael_thralls: {
    name: 'Ningún siervo mío',
    desc: 'Derrota a Vael el Fogbinder con cada Siervo ahogado que convoque ya abatido.',
  },
  dgn_ysolei_moonspawn: {
    name: 'Hasta el último engendro lunar',
    desc: 'Derrota a Ysolei con cada Engendro lunar que convoque ya abatido.',
  },
  dgn_ysolei_flawless: {
    name: 'Ni una lágrima',
    desc: 'Derrota a Ysolei, Avatar de la Luna Ahogada, en dificultad heroica sin que muera ningún miembro del grupo.',
  },
  dgn_velkhar_bonewalkers: {
    name: 'Quédense enterrados',
    desc: 'Derrota al Gran nigromante Velkhar con cada Caminahuesos alzado destruido antes de que él caiga.',
  },
  dgn_korzul_flawless: {
    name: 'Matawyrms',
    desc: 'Derrota a Korzul el Gravewyrm en dificultad heroica sin que muera ningún miembro del grupo.',
    title: 'Matawyrms',
  },
  dgn_sanctum_speed: {
    name: 'Carrera por el Santuario',
    desc: 'Derrota a Korzul el Gravewyrm en los 15 minutos siguientes a que tu grupo reclame el Santuario del Gravewyrm.',
  },
  dgn_nythraxis_gravebreaker: {
    name: 'Ante ningún rey me arrodillo',
    desc: 'Derrota a Nythraxis sin que Quiebratumbas golpee jamás a nadie más que a su objetivo actual.',
  },
  dgn_nythraxis_wardens: {
    name: 'Guardianes de las piedras de guarda',
    desc: 'Derrota a Nythraxis con cada Furia Imperecedera quebrada antes de que llegue a golpear.',
  },
  dgn_nythraxis_deathless: {
    name: 'Nadie más imperecedero',
    desc: 'Derrota a Nythraxis, Azote de Thornpeak, en dificultad heroica sin que muera un solo miembro de la banda.',
    title: 'el Imperecedero',
  },
  cmb_thunzharr: {
    name: 'La montaña cayó',
    desc: 'Derriba a Thunzharr, el Pico Despierto, en Stormcrag.',
  },
  cmb_thunzharr_unbroken: {
    name: 'Quiebrapicos',
    desc: 'Derriba a Thunzharr, el Pico Despierto, sin morir desde tu primer golpe hasta su último aliento.',
    title: 'Quiebrapicos',
  },
  cmb_thunzharr_ten: {
    name: 'Costumbre de montañas',
    desc: 'Derriba a Thunzharr, el Pico Despierto, diez veces.',
  },
  dlv_reliquary: { name: 'Corredor del Relicario', desc: 'Limpia el Relicario Hundido.' },
  dlv_reliquary_heroic: {
    name: 'Heroico: El Relicario Hundido',
    desc: 'Limpia el Relicario Hundido en el nivel Heroico.',
  },
  dlv_litany: { name: 'Acalla la Letanía', desc: 'Limpia la Letanía Ahogada.' },
  dlv_litany_heroic: {
    name: 'Heroico: La Letanía Ahogada',
    desc: 'Limpia la Letanía Ahogada en el nivel Heroico.',
  },
  dlv_lore_journal: {
    name: 'Notas al margen',
    desc: 'Desbloquea las cinco entradas del diario de expedición.',
  },
  dlv_companion_max: {
    name: 'Una amiga en las profundidades',
    desc: 'Lleva a una compañera de expedición a su rango más alto.',
  },
  dlv_companions_both: {
    name: 'Ambas linternas encendidas',
    desc: 'Lleva a las dos compañeras de expedición, la Acólita Tessa y Edda Reedhand, a su rango más alto.',
  },
  dlv_clears_50: { name: 'Cincuenta brazas', desc: 'Completa 50 expediciones.' },
  dlv_solo_heroic: {
    name: 'Dos son multitud',
    desc: 'Limpia una expedición de nivel Heroico sin ningún otro jugador: solo tú y tu compañera.',
  },
  dlv_tumbler_premium: {
    name: 'El camino del cerrojo, dominado',
    desc: 'Abre un cofre protegido del relicario a la apuesta más alta, impecable en tu único intento.',
  },
  dlv_rite_flawless: {
    name: 'Al pie de la letra',
    desc: 'Completa el Rito del Relicario Ahogado sin un solo error.',
  },
  dlv_varric_ringers: {
    name: 'Las campanas enmudecen',
    desc: 'Derrota al Diácono Varric con todos los Campaneros funerarios que alza ya abatidos.',
  },
  dlv_nhalia_bells: {
    name: 'Acallacampanas',
    desc: 'Derrota a la Hermana Nhalia, el Cántico Ahogado, sin que ninguna Campana doliente golpee a ningún miembro del grupo.',
    title: 'Acallacampanas',
  },
  chr_vale_chapter_i: {
    name: 'Crónica del Valle, capítulo I',
    desc: 'Termina el primer capítulo de la crónica de Saul: los primeros encargos de Eastbrook, el trazado del Valle y una primera muestra de sus oficios.',
  },
  chr_vale_chapter_ii: {
    name: 'Crónica del Valle, capítulo II',
    desc: 'Termina el segundo capítulo de la crónica de Saul: bandidos, merodeadores Aletabarro y alimañas de la mina abatidos, un partido disputado en el Sembradal y el Relicario desafiado.',
  },
  chr_vale_chapter_iii: {
    name: 'Crónica del Valle',
    desc: 'Vive la historia del Valle hasta el final: el Gravecaller desenmascarado, la Cripta Hueca purificada y cada terror con nombre del Valle abatido.',
    title: 'del Valle',
  },
  chr_vale_gatherer: {
    name: 'Vivir de la tierra',
    desc: 'Recolecta una veta de mineral, un árbol talable y un macizo de hierbas en el Valle de Eastbrook.',
  },
  chr_vale_first_cast: {
    name: 'Algo en el Lago Espejo',
    desc: 'Pesca un pez en las aguas del Valle de Eastbrook.',
  },
  chr_vale_packbreaker: {
    name: 'Rompemanadas',
    desc: 'Mata 3 Lobos del bosque en un lapso de 10 segundos.',
  },
  chr_vale_cup_debut: {
    name: 'Aspirante al Balde de Cobre',
    desc: 'Salta al campo y toca el balón en un partido de la Copa del Valle en el Sembradal.',
  },
  chr_vale_rares: {
    name: 'Terrores del Valle',
    desc: 'Mata a los cinco terrores con nombre del Valle de Eastbrook: el Viejo Greyjaw, Mogger, Grix el Rey Túnel, el Capitán Verlan y Maldrec el Ataespectros.',
  },
  chr_marsh_chapter_i: {
    name: 'Crónica de la Ciénaga, capítulo I',
    desc: 'Termina el primer capítulo de la crónica de Osric Fenn: responde al alistamiento de Fenbridge, asegura la calzada y aprende la forma del pantano.',
  },
  chr_marsh_chapter_ii: {
    name: 'Crónica de la Ciénaga, capítulo II',
    desc: 'Termina el segundo capítulo de la crónica de Osric Fenn: las viudas expulsadas con fuego, los ahogados devueltos al descanso, el Bacaladrino pescado y la Letanía desafiada.',
  },
  chr_marsh_chapter_iii: {
    name: 'Crónica de Mirefen',
    desc: 'Vive la historia del pantano hasta el final: el campamento del culto destruido, el Fogbinder silenciado en el Bastión Sumergido y cada terror con nombre de la niebla abatido.',
    title: 'de Mirefen',
  },
  chr_marsh_gatherer: {
    name: 'Forrajeo en Fenbridge',
    desc: 'Recolecta una veta de mineral, un árbol talable y un macizo de hierbas en la Ciénaga de Mirefen.',
  },
  chr_marsh_unburst: {
    name: 'No pises las esporas',
    desc: 'Mata 8 Hinchados del pantano sin que te alcance su estallido de Esporas Cáusticas.',
  },
  chr_marsh_hush_the_mending: {
    name: 'Silencia la sanación',
    desc: 'En el campamento Gravecaller, mata a un Sanador Gravecaller antes que a cualquiera de los cultistas que atiende.',
  },
  chr_marsh_rares: {
    name: 'Nombres en la niebla',
    desc: 'Mata a los tres terrores con nombre de la Ciénaga de Mirefen: Mirejaw el Voraz, Sloomtooth el Ahogado y la Hermana Nhalia.',
  },
  chr_peaks_chapter_i: {
    name: 'Crónica de las Alturas, capítulo I',
    desc: 'Termina el primer capítulo de la crónica de Zenzie: despeja el camino de la cresta, vacía las madrigueras y conoce cada senda que guarda Highwatch.',
  },
  chr_peaks_chapter_ii: {
    name: 'Crónica de las Alturas, capítulo II',
    desc: 'Termina el segundo capítulo de la crónica de Zenzie: destruye el campamento de guerra de Drogmar, descifra la tormenta que despierta y planta los pies donde resplandece el Glimmermere.',
  },
  chr_peaks_chapter_iii: {
    name: 'Crónica de Thornpeak',
    desc: 'Vive la historia de la montaña hasta el final: el Culto del Wyrm quebrado, el Santuario silenciado, el Pico Despierto derribado y cada terror con nombre de los riscos abatido.',
    title: 'de Thornpeak',
  },
  chr_peaks_sparring: {
    name: 'Ejercicios de muralla',
    desc: 'Inflige 1000 de daño total al muñeco de entrenamiento sobre Highwatch.',
  },
  chr_peaks_glimmer_cast: {
    name: 'Agua fría, luz más fría',
    desc: 'Pesca un pez en el Glimmermere.',
  },
  chr_peaks_moongate: {
    name: 'A través de la puerta fría',
    desc: 'Cruza la puerta lunar en la orilla del Glimmermere.',
  },
  chr_peaks_waking_witness: {
    name: 'La montaña que camina',
    desc: 'Contempla a Thunzharr, el Pico Despierto, mientras recorre la montaña.',
  },
  chr_peaks_rares: {
    name: 'Nombres tallados en el risco',
    desc: 'Mata a los cuatro terrores con nombre de las Alturas de Thornpeak: el Capataz Vena de Hierro, Brutok Rompecráneos, Voskar Aladebrasa y el Señor de Médula Varkas.',
  },
  col_discovery_25: {
    name: 'Acaparador',
    desc: 'Descubre 25 objetos distintos (un objeto cuenta la primera vez que llega a tu poder).',
  },
  col_discovery_75: { name: 'Urraca', desc: 'Descubre 75 objetos distintos.' },
  col_discovery_150: {
    name: 'Gabinete de curiosidades',
    desc: 'Descubre 150 objetos distintos.',
    title: 'el Curador',
  },
  col_discovery_250: { name: 'El gran catálogo', desc: 'Descubre 250 objetos distintos.' },
  col_first_rare: { name: 'Algo azul', desc: 'Consigue tu primer objeto de calidad rara.' },
  col_first_epic: {
    name: 'Nacido en la púrpura',
    desc: 'Consigue tu primer objeto de calidad épica.',
  },
  col_first_legendary: {
    name: 'Qué naranja suerte',
    desc: 'Consigue tu primer objeto de calidad legendaria.',
  },
  col_set_vale_arcanist: {
    name: 'Vestiduras del Arcanista del Valle',
    desc: 'Descubre cada pieza de las Vestiduras del Arcanista del Valle.',
  },
  col_set_boundstone_vanguard: {
    name: 'Vanguardia Piedravínculo',
    desc: 'Descubre cada pieza de la Vanguardia Piedravínculo.',
  },
  col_set_greyjaw_stalker: {
    name: 'Equipo del acechador de Greyjaw',
    desc: 'Descubre cada pieza del Equipo del acechador de Greyjaw.',
  },
  col_set_deathlord: {
    name: 'Armamento de guerra de Barrowlord',
    desc: 'Descubre cada pieza del Armamento de guerra de Barrowlord.',
  },
  col_set_wyrmshadow: {
    name: 'Vestimentas Nightfang',
    desc: 'Descubre cada pieza de las Vestimentas Nightfang.',
  },
  col_set_necromancers: {
    name: 'Atavío de Mournweave',
    desc: 'Descubre cada pieza del Atavío de Mournweave.',
  },
  col_set_crownforged: {
    name: 'Vestiduras Bonewrought',
    desc: 'Descubre cada pieza de las Vestiduras Bonewrought.',
  },
  col_set_nighttalon: { name: 'Pelaje Direfang', desc: 'Descubre cada pieza del Pelaje Direfang.' },
  col_set_soulflame: {
    name: 'Vestiduras Wraithfire',
    desc: 'Descubre cada pieza de las Vestiduras Wraithfire.',
  },
  col_set_stormcallers: {
    name: 'Vestimentas de Galecall',
    desc: 'Descubre cada pieza de las Vestimentas de Galecall.',
  },
  col_seven_regalia: {
    name: 'El guardarropa séptuple',
    desc: 'Descubre cada pieza de las siete familias de armaduras épicas.',
    title: 'el Resplandeciente',
  },
  col_true_colors: {
    name: 'Tus verdaderos colores',
    desc: 'Salta al campo con cualquier apariencia que no sea la predeterminada de tu clase.',
  },
  col_all_slots: {
    name: 'De punta en blanco, once veces',
    desc: 'Ten un objeto equipado en las once ranuras de equipo al mismo tiempo.',
  },
  col_quartermaster_buyout: {
    name: 'Cliente preferente',
    desc: 'Descubre las diez piezas del inventario del Intendente Vex.',
  },
  col_glimmerfin: { name: 'Un destello de esperanza', desc: 'Pesca un Koi de aletas brillantes.' },
  col_full_creel: {
    name: 'Nasa llena',
    desc: 'Descubre las seis capturas comunes de las aguas del Valle, la Ciénaga y las Alturas.',
  },
  col_junk_drawer: {
    name: 'El cajón de los trastos',
    desc: 'Descubre 10 objetos distintos de calidad pobre.',
  },
  pvp_arena_first_match: {
    name: 'Arena en las botas',
    desc: 'Disputa un combate clasificatorio en el Coliseo Ceniciento, en cualquiera de las dos categorías.',
  },
  pvp_arena_first_win: {
    name: 'La multitud ruge',
    desc: 'Gana un combate clasificatorio de arena en cualquiera de las dos categorías.',
  },
  pvp_arena_1v1_1600: {
    name: 'Aspirante del Coliseo',
    desc: 'Alcanza un índice de 1600 en la categoría 1c1 de la arena.',
  },
  pvp_arena_1v1_1750: {
    name: 'Rival del Coliseo',
    desc: 'Alcanza un índice de 1750 en la categoría 1c1 de la arena.',
  },
  pvp_arena_1v1_1900: {
    name: 'Gladiador',
    desc: 'Alcanza un índice de 1900 en la categoría 1c1 de la arena.',
    title: 'Gladiador',
  },
  pvp_arena_2v2_1600: {
    name: 'Dúo firme',
    desc: 'Alcanza un índice de 1600 en la categoría 2c2 de la arena.',
  },
  pvp_arena_2v2_1750: {
    name: 'Pareja temible',
    desc: 'Alcanza un índice de 1750 en la categoría 2c2 de la arena.',
  },
  pvp_arena_2v2_1900: {
    name: 'Compenetración perfecta',
    desc: 'Alcanza un índice de 1900 en la categoría 2c2 de la arena.',
  },
  pvp_duel_first_win: { name: 'Esto se arregla afuera', desc: 'Gana un duelo.' },
  pvp_duel_grace: {
    name: 'Una lección de humildad',
    desc: 'Pierde un duelo con la dignidad casi intacta.',
  },
  pvp_vcup_first_match: {
    name: 'Botas en la cancha',
    desc: 'Juega un partido completo de la Copa del Valle en el Sembradal, ganes o pierdas.',
  },
  pvp_vcup_first_win: {
    name: 'El primer trofeo',
    desc: 'Gana un partido clasificatorio de la Copa del Valle.',
  },
  pvp_vcup_wins_10: {
    name: 'Balonjabalista curtido',
    desc: 'Gana 10 partidos clasificatorios de la Copa del Valle.',
  },
  pvp_vcup_wins_25: {
    name: 'Leyenda del balonjabalí',
    desc: 'Gana 25 partidos clasificatorios de la Copa del Valle.',
    title: 'Leyenda del balonjabalí',
  },
  pvp_vcup_first_goal: {
    name: 'Estreno goleador',
    desc: 'Anota un gol en un partido clasificatorio de la Copa del Valle.',
  },
  pvp_vcup_hat_trick: {
    name: 'Héroe del triplete',
    desc: 'Anota tres goles en un solo partido clasificatorio de la Copa del Valle, en la categoría 3c3 o superior.',
  },
  pvp_vcup_golden_goal: {
    name: 'Momento de oro',
    desc: 'Anota el gol de oro que decide un partido clasificatorio de la Copa del Valle.',
  },
  pvp_vcup_first_save: {
    name: 'Manos seguras',
    desc: 'Realiza una atajada como guardameta en un partido clasificatorio de la Copa del Valle.',
  },
  pvp_vcup_clean_sheet: {
    name: 'Por aquí no pasa nada',
    desc: 'Gana un partido clasificatorio de la Copa del Valle como guardameta sin recibir ningún gol.',
  },
  pvp_vcup_guild_win: {
    name: 'Por el estandarte',
    desc: 'Gana un partido clasificatorio de la Copa del Valle disputado bajo el estandarte de tu hermandad.',
  },
  pvp_fiesta_first_bout: {
    name: 'Colado en la Fiesta',
    desc: 'Disputa un combate completo de Fiesta 2c2, ganes o pierdas.',
  },
  pvp_fiesta_first_win: { name: 'El alma de la Fiesta', desc: 'Gana un combate de Fiesta 2c2.' },
  pvp_fiesta_double: {
    name: 'Doble problema',
    desc: 'Consigue dos derribos en la Fiesta en un lapso de cuatro segundos.',
  },
  pvp_fiesta_shutdown: {
    name: 'Aguafiestas',
    desc: 'Derriba a un rival de la Fiesta que lleve una racha de tres o más.',
  },
  pvp_fiesta_full_build: {
    name: 'Vestido para la ocasión',
    desc: 'Gana un combate de Fiesta con un aumento fijado de cada una de las tres oleadas.',
  },
  pvp_fiesta_powerups: {
    name: 'Uno de cada',
    desc: 'Recoge al menos una vez cada una de las cuatro mejoras del ring: Demonio Veloz, Coloso, Botas Lunares y Frenético.',
  },
  pvp_fiesta_five_kills: {
    name: 'Cargando con la Fiesta',
    desc: 'Consigue cinco derribos en un solo combate de Fiesta.',
  },
  soc_first_party: { name: 'Mejor acompañados', desc: 'Únete a un grupo con otro jugador.' },
  soc_full_house: {
    name: 'Casa llena',
    desc: 'Supera una mazmorra con un grupo completo de cinco.',
  },
  soc_guild_joined: {
    name: 'Bajo un mismo estandarte',
    desc: 'Conviértete en miembro de una hermandad.',
  },
  soc_guild_founded: { name: 'La pluma fundadora', desc: 'Funda tu propia hermandad.' },
  soc_first_trade: { name: 'Un trato justo', desc: 'Completa un intercambio con otro jugador.' },
  soc_first_sale: {
    name: 'Abierto al público',
    desc: 'Cobra las monedas de tu primera venta en el Mercado Mundial.',
  },
  soc_steady_custom: {
    name: 'Clientela fija',
    desc: 'Cobra un total acumulado de 10 de oro por tus ventas en el Mercado Mundial.',
  },
  soc_market_magnate: {
    name: 'Magnate del mercado',
    desc: 'Cobra un total acumulado de 100 de oro por tus ventas en el Mercado Mundial.',
    title: 'Magnate',
  },
  soc_by_ravens_wing: {
    name: 'En alas del cuervo',
    desc: 'Envía una carta del Correo del Cuervo que lleve monedas o un paquete.',
  },
  soc_room_for_more: { name: 'Sitio para más', desc: 'Compra tu primera ampliación de banco.' },
  soc_gilded_strongbox: {
    name: 'El Arca Dorada',
    desc: 'Compra cada ampliación de banco que los tesoreros estén dispuestos a venderte.',
  },
  soc_meet_bursar: {
    name: 'En Fernando confiamos',
    desc: 'Presenta tus respetos al Tesorero Fernando, custodio del Arca Dorada en Eastbrook.',
  },
  soc_pocket_money: {
    name: 'Dinero de bolsillo',
    desc: 'Saquea un total acumulado de 1 de oro en monedas.',
  },
  soc_heavy_purse: {
    name: 'Bolsa pesada',
    desc: 'Saquea un total acumulado de 10 de oro en monedas.',
  },
  soc_wyrms_hoard: {
    name: 'Un tesoro de wyrm',
    desc: 'Saquea un total acumulado de 100 de oro en monedas.',
  },
  soc_civic_duty: { name: 'Deber cívico', desc: 'Asigna tu primer punto de enfoque del pueblo.' },
  exp_long_road_north: {
    name: 'El largo camino al norte',
    desc: 'Visita los tres asentamientos principales: Eastbrook, Fenbridge y Highwatch.',
  },
  exp_vale_wayfarer: {
    name: 'Caminante del Valle',
    desc: 'Visita los once lugares con nombre del Valle de Eastbrook.',
  },
  exp_marsh_wayfarer: {
    name: 'Caminante de la Ciénaga',
    desc: 'Visita los ocho lugares con nombre de la Ciénaga de Mirefen.',
  },
  exp_peaks_wayfarer: {
    name: 'Caminante de las Alturas',
    desc: 'Visita los diez lugares con nombre de las Alturas de Thornpeak.',
  },
  exp_world_traveler: {
    name: 'Trotamundos',
    desc: 'Consigue la gesta de caminante de las tres zonas.',
    title: 'Caminante',
  },
  exp_something_shiny: { name: 'Algo brillante', desc: 'Recoge un objeto reluciente del suelo.' },
  exp_first_ore: { name: '¡A picar piedra!', desc: 'Recolecta tu primer nodo de mineral.' },
  exp_first_timber: { name: '¡Árbol va!', desc: 'Recolecta tu primer nodo de madera.' },
  exp_first_herb: { name: 'Mano verde', desc: 'Recolecta tu primer nodo de hierbas.' },
  feat_era_cap: {
    name: 'Hijo de la Primera Era',
    desc: 'Alcanzaste el nivel 20 mientras la Primera Era estaba en curso.',
  },
  feat_book_complete: {
    name: 'El libro completo',
    desc: 'Consigue cada gesta del Libro de Gestas.',
  },
  feat_brightwood_relic: {
    name: 'Brightwood en la memoria',
    desc: 'Conserva una reliquia del viejo Brightwood: el Jubón de piel de zarza o la Corona del Monarca.',
  },
  hid_saul_footnote: {
    name: 'Una nota al pie de la historia',
    desc: 'Importunaste a Saul el Cronista nueve veces sin pausa.',
    title: 'Nota al pie',
  },
  hid_gilded_tour: {
    name: 'La gira dorada',
    desc: 'Hiciste negocios con las tres sucursales del Arca Dorada.',
  },
  hid_fall_death: {
    name: 'La gravedad siempre gana',
    desc: 'Moriste tras una larga conversación con el suelo.',
  },
  hid_keepers_toll_twice: {
    name: 'El Guardián cobra dos veces',
    desc: 'Moriste mientras el Tributo del Guardián aún pesaba sobre ti.',
  },
  hid_roll_hundred: { name: 'Cien natural', desc: 'Sacaste un 100 perfecto en un /roll sin más.' },
  hid_yumi_cheer: {
    name: 'Fan número uno de Yumi',
    desc: 'Vitoreaste a Yumi donde podía oírte, en pleno combate.',
  },
  hid_bountiful_coffer: {
    name: 'El cofre púrpura',
    desc: 'Forzaste un Cofre Pródigo antes de que pudiera trabarse.',
  },
  hid_companion_save: {
    name: 'No mientras ella vigile',
    desc: 'Tu compañera de expedición puso de nuevo en pie a un aliado caído.',
  },
  hid_codfather: {
    name: 'Ya eres de la familia',
    desc: 'Sacaste a El Bacaladrino de los Bajíos de Deepfen.',
  },
  prog_crown_below: {
    name: 'La corona de las profundidades',
    desc: 'Sigue la corona desde los campos de huesos inquietos hasta la tumba del rey Nythraxis y lleva El fin del Azote a su término.',
  },
  prog_mere_at_rest: {
    name: 'El lago en reposo',
    desc: 'Acompaña hasta el final la guardia de Ondrel Vane, el Vigía de la Marea: el coro silenciado, la Espiral Pálida abatida y la Luna Ahogada puesta a descansar.',
  },
  prog_callused_hands: {
    name: 'Manos encallecidas',
    desc: 'Completa Un oficio para cada mano y gánate tu primer callo en los oficios de Eastbrook.',
  },
  prog_tools_of_the_trade: {
    name: 'Las herramientas del oficio',
    desc: 'Completa una fabricación en una estación de artesanía.',
  },
  dgn_nythraxis_crypt: {
    name: 'Lo que guardaba la cripta',
    desc: 'Adéntrate en la Cripta abandonada y recupera de sus guardianes las dos mitades de la piedra clave y el diario antiguo.',
  },
  chr_marsh_first_cast: {
    name: 'Anguilas entre los juncos',
    desc: 'Pesca un pez en las aguas de la Ciénaga de Mirefen.',
  },
};

// es_ES rides this base table plus the delve-vocabulary override layer
// assembled in deed_i18n.ts.
export const dialects: Record<string, DeedLocaleTable> = {
  es_ES: {
    dgn_deepward: {
      name: 'Guarda de las Profundidades',
      desc: 'Conquista cada mazmorra, la banda y las dos Profundidades en dificultad heroica.',
    },
    dlv_lore_journal: {
      name: 'Notas al margen',
      desc: 'Desbloquea las cinco entradas del diario de Profundidad.',
    },
    dlv_companion_max: {
      name: 'Una amiga en las profundidades',
      desc: 'Lleva a una compañera de Profundidad a su rango más alto.',
    },
    dlv_companions_both: {
      name: 'Ambas linternas encendidas',
      desc: 'Lleva a las dos compañeras de Profundidad, la Acólita Tessa y Edda Reedhand, a su rango más alto.',
    },
    dlv_clears_50: { name: 'Cincuenta brazas', desc: 'Completa 50 Profundidades.' },
    dlv_solo_heroic: {
      name: 'Dos son multitud',
      desc: 'Limpia una Profundidad de nivel Heroico sin ningún otro jugador: solo tú y tu compañera.',
    },
    hid_companion_save: {
      name: 'No mientras ella vigile',
      desc: 'Tu compañera de Profundidad puso de nuevo en pie a un aliado caído.',
    },
  },
};
