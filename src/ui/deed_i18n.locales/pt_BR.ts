// Deed name / desc / title locale table for pt_BR (data-as-code, size-exempt).
// One per-base-locale chunk behind DEED_LOCALE_LOADERS in deed_i18n.ts, so a
// visitor downloads only their own locale's deed strings. Split verbatim from
// the former deed_i18n.newlocales.ts single chunk; values carry no em or en
// dashes (repo copy rule). English (en / en_CA) resolves to the authored
// source before this table is consulted.
import type { DeedLocaleTable } from '../deed_i18n';

export const table: DeedLocaleTable = {
  prog_first_steps: {
    name: 'Primeiros Passos',
    desc: 'Alcance o nível 2 e dê o primeiro passo em uma longa estrada.',
  },
  prog_finding_your_feet: {
    name: 'Pegando o Jeito',
    desc: 'Alcance o nível 5; as terras selvagens já parecem um pouco menores.',
  },
  prog_double_digits: {
    name: 'Dois Dígitos',
    desc: 'Alcance o nível 10 e desbloqueie seus talentos.',
  },
  prog_the_long_middle: { name: 'O Longo Meio do Caminho', desc: 'Alcance o nível 15.' },
  prog_level_cap: { name: 'A Vista do Topo', desc: 'Alcance o nível 20, o nível máximo.' },
  prog_well_rested: {
    name: 'Bem Descansado',
    desc: 'Acomode-se em uma estalagem até acumular experiência de descanso.',
  },
  prog_talented: { name: 'Um Ponto Bem Gasto', desc: 'Gaste seu primeiro ponto de talento.' },
  prog_specialized: {
    name: 'Declaração de Intenções',
    desc: 'Escolha uma especialização e aprenda sua habilidade emblemática.',
  },
  prog_deep_roots: {
    name: 'Raízes Profundas',
    desc: 'Gaste um ponto de talento em um talento da fileira final.',
  },
  prog_full_build: {
    name: 'O Onze Titular',
    desc: 'Gaste todos os onze pontos de talento em uma única build.',
  },
  prog_veteran: {
    name: 'Veterano',
    desc: 'Acumule 250.000 de experiência ao longo da vida.',
    title: 'Veterano',
  },
  prog_champion: {
    name: 'Campeão',
    desc: 'Acumule 500.000 de experiência ao longo da vida.',
    title: 'Campeão',
  },
  prog_paragon: {
    name: 'Paragon',
    desc: 'Acumule 1.000.000 de experiência ao longo da vida.',
    title: 'Paragon',
  },
  prog_mythic: {
    name: 'Mítico',
    desc: 'Acumule 2.500.000 de experiência ao longo da vida.',
    title: 'Mítico',
  },
  prog_eternal: {
    name: 'Eterno',
    desc: 'Acumule 5.000.000 de experiência ao longo da vida.',
    title: 'Eterno',
  },
  prog_prestige: {
    name: 'Começar de Novo',
    desc: 'Alcance o nível máximo, encha a barra mais uma vez e reivindique o posto de prestígio 1.',
  },
  prog_prestige_5: { name: 'Velhos Hábitos', desc: 'Alcance o posto de prestígio 5.' },
  prog_prestige_10: { name: 'Movimento Perpétuo', desc: 'Alcance o posto de prestígio 10.' },
  prog_first_harvest: { name: 'Frutos do Campo', desc: 'Colha seu primeiro ponto de coleta.' },
  prog_mining_100: { name: 'Minério no Sangue', desc: 'Alcance 100 de proficiência em Mineração.' },
  prog_logging_100: { name: 'Talhador de Cerne', desc: 'Alcance 100 de proficiência em Lenharia.' },
  prog_herbalism_100: {
    name: 'Mestre da Campina',
    desc: 'Alcance 100 de proficiência em Herborismo.',
  },
  prog_master_gatherer: {
    name: 'Mestre Coletor',
    desc: 'Alcance 100 de proficiência em Mineração, Lenharia e Herborismo.',
  },
  prog_first_craft: { name: 'Feito à Mão', desc: 'Conclua sua primeira criação bem-sucedida.' },
  prog_craft_specialist: {
    name: 'Segredos do Ofício',
    desc: 'Alcance 75 de perícia em um único ofício e desbloqueie suas vantagens de especialização.',
  },
  prog_around_the_ring: {
    name: 'A Volta do Anel',
    desc: 'Alcance 25 de perícia em cinco ofícios diferentes.',
  },
  cmb_first_blood: { name: 'Primeiro Sangue', desc: 'Derrote seu primeiro inimigo.' },
  cmb_slayer: { name: 'Matador', desc: 'Derrote 1.000 inimigos.' },
  cmb_legion_of_one: { name: 'Legião de Um Só', desc: 'Derrote 10.000 inimigos.' },
  cmb_heavy_hitter: { name: 'Mão Pesada', desc: 'Cause 500.000 de dano no total.' },
  cmb_critical_eye: { name: 'Olho Crítico', desc: 'Acerte 500 golpes críticos.' },
  cmb_giantslayer: {
    name: 'Mata-Gigantes',
    desc: 'Dê o golpe fatal em um inimigo pelo menos cinco níveis acima do seu.',
  },
  cmb_first_fall: {
    name: 'Levanta, Sacode a Poeira',
    desc: 'Morra pela primeira vez; acontece até com os melhores.',
  },
  dgn_hollow_crypt: {
    name: 'Quebra-Criptas',
    desc: 'Derrote Morthen o Gravecaller na Cripta Vazia.',
  },
  dgn_sunken_bastion: {
    name: 'Fogbinder Desatado',
    desc: 'Derrote Vael, o Fogbinder, no Bastião Submerso.',
  },
  dgn_drowned_temple: {
    name: 'Afogando a Lua',
    desc: 'Derrote Ysolei, Avatar da Lua Afogada, no Templo Afogado.',
  },
  dgn_gravewyrm_sanctum: {
    name: 'O Wyrm Lá Embaixo',
    desc: 'Derrote Korzul o Gravewyrm no Santuário do Gravewyrm.',
  },
  dgn_hollow_crypt_heroic: {
    name: 'Heroico: A Cripta Vazia',
    desc: 'Derrote Morthen o Gravecaller na Cripta Vazia na dificuldade Heroica.',
  },
  dgn_sunken_bastion_heroic: {
    name: 'Heroico: O Bastião Submerso',
    desc: 'Derrote Vael, o Fogbinder, no Bastião Submerso na dificuldade Heroica.',
  },
  dgn_drowned_temple_heroic: {
    name: 'Heroico: O Templo Afogado',
    desc: 'Derrote Ysolei, Avatar da Lua Afogada, no Templo Afogado na dificuldade Heroica.',
  },
  dgn_gravewyrm_sanctum_heroic: {
    name: 'Heroico: Santuário do Gravewyrm',
    desc: 'Derrote Korzul o Gravewyrm no Santuário do Gravewyrm na dificuldade Heroica.',
  },
  dgn_nythraxis: {
    name: 'Flagelo Nunca Mais',
    desc: 'Derrote Nythraxis, Flagelo de Thornpeak, além da porta real selada.',
  },
  dgn_nythraxis_heroic: {
    name: 'Heroico: Flagelo Nunca Mais',
    desc: 'Derrote Nythraxis, Flagelo de Thornpeak, na dificuldade Heroica.',
  },
  dgn_thornpeak_rounds: {
    name: 'Fazendo a Ronda',
    desc: 'Limpe a Cripta Vazia, o Bastião Submerso, o Templo Afogado e o Santuário do Gravewyrm.',
  },
  dgn_deepward: {
    name: 'Guarda das Profundezas',
    desc: 'Conquiste todas as masmorras, a raide e as duas incursões na dificuldade Heroica.',
  },
  dgn_mark_circuit: {
    name: 'O Circuito Completo',
    desc: 'Ganhe Marcas Heroicas das quatro masmorras Heroicas em um único dia.',
  },
  dgn_boss_clears_50: {
    name: 'Cinquenta Portas Depois',
    desc: 'Derrote 50 chefes finais de masmorra.',
  },
  dgn_morthen_flawless: {
    name: 'Nenhum Osso Fora do Lugar',
    desc: 'Derrote Morthen o Gravecaller na dificuldade Heroica sem que nenhum membro do grupo morra.',
  },
  dgn_morthen_trio: {
    name: 'Três Contra a Cova',
    desc: 'Derrote Morthen o Gravecaller com três jogadores ou menos.',
  },
  dgn_olen_arc: {
    name: 'Desvie do Ceifador',
    desc: 'Derrote o Cavaleiro-comandante Olen sem que o Arco Ceifante dele atinja ninguém além do alvo atual.',
  },
  dgn_vael_thralls: {
    name: 'Nenhum Servo Meu',
    desc: 'Derrote Vael, o Fogbinder, com todos os Servos afogados que ele convoca já mortos.',
  },
  dgn_ysolei_moonspawn: {
    name: 'Até a Última Cria da Lua',
    desc: 'Derrote Ysolei com todas as Crias da Lua que ela convoca já mortas.',
  },
  dgn_ysolei_flawless: {
    name: 'Olhos Secos',
    desc: 'Derrote Ysolei, Avatar da Lua Afogada, na dificuldade Heroica sem que nenhum membro do grupo morra.',
  },
  dgn_velkhar_bonewalkers: {
    name: 'Fiquem Enterrados',
    desc: 'Derrote o Grande necromante Velkhar com todos os Andarilhos de ossos erguidos destruídos antes de ele cair.',
  },
  dgn_korzul_flawless: {
    name: 'Mata-Wyrm',
    desc: 'Derrote Korzul o Gravewyrm na dificuldade Heroica sem que nenhum membro do grupo morra.',
    title: 'Mata-Wyrm',
  },
  dgn_sanctum_speed: {
    name: 'Corrida no Santuário',
    desc: 'Derrote Korzul o Gravewyrm em até 15 minutos após seu grupo reivindicar o Santuário do Gravewyrm.',
  },
  dgn_nythraxis_gravebreaker: {
    name: 'Perante Rei Nenhum',
    desc: 'Derrote Nythraxis sem que o Quebra-Túmulos atinja ninguém além do alvo atual dele.',
  },
  dgn_nythraxis_wardens: {
    name: 'Guardiões das Pedras de Guarda',
    desc: 'Derrote Nythraxis com toda Fúria Imortal interrompida antes de acertar.',
  },
  dgn_nythraxis_deathless: {
    name: 'Mais Imortal, Impossível',
    desc: 'Derrote Nythraxis, Flagelo de Thornpeak, na dificuldade Heroica sem que um único membro da raide morra.',
    title: 'o Imortal',
  },
  cmb_thunzharr: {
    name: 'A Montanha Caiu',
    desc: 'Derrube Thunzharr, o Pico Desperto, em Stormcrag.',
  },
  cmb_thunzharr_unbroken: {
    name: 'Quebra-Picos',
    desc: 'Derrube Thunzharr, o Pico Desperto, sem morrer do seu primeiro golpe ao último suspiro dele.',
    title: 'Quebra-Picos',
  },
  cmb_thunzharr_ten: {
    name: 'Hábito de Montanhas',
    desc: 'Derrube Thunzharr, o Pico Desperto, dez vezes.',
  },
  dlv_reliquary: { name: 'Incursor do Relicário', desc: 'Limpe o Relicário Desmoronado.' },
  dlv_reliquary_heroic: {
    name: 'Heroico: O Relicário Desmoronado',
    desc: 'Limpe o Relicário Desmoronado no nível Heroico.',
  },
  dlv_litany: { name: 'Cale a Ladainha', desc: 'Limpe a Ladainha Afogada.' },
  dlv_litany_heroic: {
    name: 'Heroico: A Ladainha Afogada',
    desc: 'Limpe a Ladainha Afogada no nível Heroico.',
  },
  dlv_lore_journal: {
    name: 'Marginália',
    desc: 'Desbloqueie todas as cinco entradas do diário de incursão.',
  },
  dlv_companion_max: {
    name: 'Uma Amiga nas Profundezas',
    desc: 'Eleve uma companheira de incursão ao posto mais alto dela.',
  },
  dlv_companions_both: {
    name: 'Duas Lanternas Acesas',
    desc: 'Eleve as duas companheiras de incursão, a Acólita Tessa e Edda Reedhand, ao posto mais alto delas.',
  },
  dlv_clears_50: { name: 'Cinquenta Braças', desc: 'Complete 50 incursões.' },
  dlv_solo_heroic: {
    name: 'Dois Já É Demais',
    desc: 'Limpe uma incursão de nível Heroico sem nenhum outro jogador, apenas você e sua companheira.',
  },
  dlv_tumbler_premium: {
    name: 'O Caminho dos Pinos, Dominado',
    desc: 'Abra um baú protegido do relicário na aposta mais alta, sem falhas em sua única tentativa.',
  },
  dlv_rite_flawless: {
    name: 'Sem Tirar Nem Pôr',
    desc: 'Complete o Rito do Relicário Afogado sem um único erro.',
  },
  dlv_varric_ringers: {
    name: 'Os Sinos Emudecem',
    desc: 'Derrote o Diácono Varric com todos os Sineiros Fúnebres que ele ergue já abatidos.',
  },
  dlv_nhalia_bells: {
    name: 'Aquieta-Sinos',
    desc: 'Derrote a Irmã Nhalia, o Cântico Afogado, sem que nenhum membro do grupo seja atingido por um Sino Badalante.',
    title: 'Aquieta-Sinos',
  },
  chr_vale_chapter_i: {
    name: 'Crônica do Vale, Capítulo I',
    desc: 'Termine o primeiro capítulo da crônica de Saul: as primeiras tarefas de Eastbrook, o traçado do Vale e um primeiro gosto de seus ofícios.',
  },
  chr_vale_chapter_ii: {
    name: 'Crônica do Vale, Capítulo II',
    desc: 'Termine o segundo capítulo da crônica de Saul: bandidos, murlocs e pragas da mina exterminados, o Sowfield disputado e o Relicário enfrentado.',
  },
  chr_vale_chapter_iii: {
    name: 'Crônica do Vale',
    desc: 'Acompanhe a história do Vale até o fim: o Gravecaller desmascarado, a Cripta Vazia purificada e cada terror nomeado do Vale abatido.',
    title: 'do Vale',
  },
  chr_vale_gatherer: {
    name: 'Vivendo da Terra',
    desc: 'Colha um veio de minério, um bosque de madeira e um canteiro de ervas no Vale de Eastbrook.',
  },
  chr_vale_first_cast: {
    name: 'Algo no Lago Espelho',
    desc: 'Pesque um peixe nas águas do Vale de Eastbrook.',
  },
  chr_vale_packbreaker: {
    name: 'Quebra-Alcateia',
    desc: 'Mate 3 Lobos da floresta em 10 segundos.',
  },
  chr_vale_cup_debut: {
    name: 'Candidato ao Balde de Cobre',
    desc: 'Entre em campo e toque na bola em uma partida da Copa do Vale no Sowfield.',
  },
  chr_vale_rares: {
    name: 'Terrores do Vale',
    desc: 'Mate os cinco terrores nomeados do Vale de Eastbrook: Velho Greyjaw, Mogger, Grix o Rei dos Túneis, Capitão Verlan e Maldrec o Atador-de-espectros.',
  },
  chr_marsh_chapter_i: {
    name: 'Crônica do Pântano, Capítulo I',
    desc: 'Termine o primeiro capítulo da crônica de Osric Fenn: atenda à convocação de Fenbridge, proteja a passagem elevada e aprenda o feitio do brejo.',
  },
  chr_marsh_chapter_ii: {
    name: 'Crônica do Pântano, Capítulo II',
    desc: 'Termine o segundo capítulo da crônica de Osric Fenn: as viúvas expulsas a fogo, os afogados postos para descansar, o Bacalhau-Padrinho fisgado e a Ladainha enfrentada.',
  },
  chr_marsh_chapter_iii: {
    name: 'Crônica de Mirefen',
    desc: 'Acompanhe a história do brejo até o fim: o acampamento do culto desfeito, o Fogbinder silenciado no Bastião Submerso e cada terror nomeado da névoa abatido.',
    title: 'de Mirefen',
  },
  chr_marsh_gatherer: {
    name: 'Coleta em Fenbridge',
    desc: 'Colha um veio de minério, um bosque de madeira e um canteiro de ervas no Pântano de Mirefen.',
  },
  chr_marsh_unburst: {
    name: 'Não Fique nos Esporos',
    desc: 'Mate 8 Inchaços do brejo sem ser apanhado pela explosão de seus Esporos Cáusticos.',
  },
  chr_marsh_hush_the_mending: {
    name: 'Cale a Cura',
    desc: 'No Acampamento Gravecaller, mate um Restaurador Gravecaller antes de qualquer um dos cultistas aos cuidados dele.',
  },
  chr_marsh_rares: {
    name: 'Nomes na Névoa',
    desc: 'Mate os três terrores nomeados do Pântano de Mirefen: Mirejaw, o Voraz; Sloomtooth o Afogado; e a Irmã Nhalia.',
  },
  chr_peaks_chapter_i: {
    name: 'Crônica dos Picos, Capítulo I',
    desc: 'Termine o primeiro capítulo da crônica de Zenzie: limpe a estrada da crista, esvazie as tocas e conheça cada caminho que Highwatch guarda.',
  },
  chr_peaks_chapter_ii: {
    name: 'Crônica dos Picos, Capítulo II',
    desc: 'Termine o segundo capítulo da crônica de Zenzie: desfaça o acampamento de guerra de Drogmar, decifre a tempestade que desperta e pise onde o Glimmermere reluz.',
  },
  chr_peaks_chapter_iii: {
    name: 'Crônica de Thornpeak',
    desc: 'Acompanhe a história da montanha até o fim: o Culto do Wyrm desfeito, o Santuário silenciado, o Pico Desperto derrubado e cada terror nomeado dos penhascos abatido.',
    title: 'de Thornpeak',
  },
  chr_peaks_sparring: {
    name: 'Treino de Muralha',
    desc: 'Cause 1.000 de dano total ao Boneco de Treino acima de Highwatch.',
  },
  chr_peaks_glimmer_cast: {
    name: 'Água Fria, Luz Mais Fria',
    desc: 'Pesque um peixe no Glimmermere.',
  },
  chr_peaks_moongate: {
    name: 'Pelo Portão Frio',
    desc: 'Atravesse o portão lunar na margem do Glimmermere.',
  },
  chr_peaks_waking_witness: {
    name: 'A Montanha Que Anda',
    desc: 'Ponha os olhos em Thunzharr, o Pico Desperto, enquanto ele caminha pela montanha.',
  },
  chr_peaks_rares: {
    name: 'Nomes Talhados na Rocha',
    desc: 'Mate os quatro terrores nomeados das Alturas de Thornpeak: o Capataz Veio de Ferro, Brutok Quebra-crânios, Voskar Asa-de-brasa e o Senhor da Medula Varkas.',
  },
  col_discovery_25: {
    name: 'Acumulador',
    desc: 'Descubra 25 itens diferentes (um item conta na primeira vez que entra em sua posse).',
  },
  col_discovery_75: { name: 'Pega Ladra', desc: 'Descubra 75 itens diferentes.' },
  col_discovery_150: {
    name: 'Gabinete de Curiosidades',
    desc: 'Descubra 150 itens diferentes.',
    title: 'o Curador',
  },
  col_discovery_250: { name: 'O Grande Catálogo', desc: 'Descubra 250 itens diferentes.' },
  col_first_rare: { name: 'Algo Azul', desc: 'Adquira seu primeiro item de qualidade rara.' },
  col_first_epic: {
    name: 'Nascido na Púrpura',
    desc: 'Adquira seu primeiro item de qualidade épica.',
  },
  col_first_legendary: {
    name: 'Que Laranja a Sua!',
    desc: 'Adquira seu primeiro item de qualidade lendária.',
  },
  col_set_vale_arcanist: {
    name: 'Regália do Arcanista do Vale',
    desc: 'Descubra cada peça da Regália do Arcanista do Vale.',
  },
  col_set_boundstone_vanguard: {
    name: 'Vanguarda Pedra-vínculo',
    desc: 'Descubra cada peça da Vanguarda Pedra-vínculo.',
  },
  col_set_greyjaw_stalker: {
    name: 'Equipamento do Espreitador de Greyjaw',
    desc: 'Descubra cada peça do Equipamento do Espreitador de Greyjaw.',
  },
  col_set_deathlord: {
    name: 'Equipamento de Batalha Barrowlord',
    desc: 'Descubra cada peça do Equipamento de Batalha Barrowlord.',
  },
  col_set_wyrmshadow: {
    name: 'Vestimentas Nightfang',
    desc: 'Descubra cada peça das Vestimentas Nightfang.',
  },
  col_set_necromancers: {
    name: 'Traje Mournweave',
    desc: 'Descubra cada peça do Traje Mournweave.',
  },
  col_set_crownforged: {
    name: 'Regália Bonewrought',
    desc: 'Descubra cada peça da Regália Bonewrought.',
  },
  col_set_nighttalon: { name: 'Pele Direfang', desc: 'Descubra cada peça da Pele Direfang.' },
  col_set_soulflame: {
    name: 'Regália Wraithfire',
    desc: 'Descubra cada peça da Regália Wraithfire.',
  },
  col_set_stormcallers: {
    name: 'Vestimentas Galecall',
    desc: 'Descubra cada peça das Vestimentas Galecall.',
  },
  col_seven_regalia: {
    name: 'O Guarda-Roupa Sétuplo',
    desc: 'Descubra cada peça de todas as sete famílias de armaduras épicas.',
    title: 'o Resplandecente',
  },
  col_true_colors: {
    name: 'Cores Verdadeiras',
    desc: 'Entre em campo vestindo qualquer aparência que não seja a padrão da sua classe.',
  },
  col_all_slots: {
    name: 'Dos Pés aos Onze',
    desc: 'Tenha um item equipado em cada um dos onze espaços de equipamento ao mesmo tempo.',
  },
  col_quartermaster_buyout: {
    name: 'Cliente Preferencial',
    desc: 'Descubra todas as dez peças do estoque heroico do Intendente Vex.',
  },
  col_glimmerfin: {
    name: 'Lampejo de Esperança',
    desc: 'Pesque um Koi de nadadeiras cintilantes.',
  },
  col_full_creel: {
    name: 'Cesto Cheio',
    desc: 'Descubra todos os seis pescados comuns das águas do Vale, do Pântano e das Alturas.',
  },
  col_junk_drawer: {
    name: 'A Gaveta de Tralhas',
    desc: 'Descubra 10 itens diferentes de qualidade ruim.',
  },
  pvp_arena_first_match: {
    name: 'Areia nas Botas',
    desc: 'Dispute uma partida ranqueada no Coliseu das Cinzas, em qualquer uma das chaves.',
  },
  pvp_arena_first_win: {
    name: 'A Multidão Ruge',
    desc: 'Vença uma partida ranqueada de arena em qualquer uma das chaves.',
  },
  pvp_arena_1v1_1600: {
    name: 'Contendor do Coliseu',
    desc: 'Alcance 1600 de classificação na chave 1v1 da arena.',
  },
  pvp_arena_1v1_1750: {
    name: 'Rival do Coliseu',
    desc: 'Alcance 1750 de classificação na chave 1v1 da arena.',
  },
  pvp_arena_1v1_1900: {
    name: 'Gladiador',
    desc: 'Alcance 1900 de classificação na chave 1v1 da arena.',
    title: 'Gladiador',
  },
  pvp_arena_2v2_1600: {
    name: 'Força em Dobro',
    desc: 'Alcance 1600 de classificação na chave 2v2 da arena.',
  },
  pvp_arena_2v2_1750: {
    name: 'Dupla Temível',
    desc: 'Alcance 1750 de classificação na chave 2v2 da arena.',
  },
  pvp_arena_2v2_1900: {
    name: 'Parceria Perfeita',
    desc: 'Alcance 1900 de classificação na chave 2v2 da arena.',
  },
  pvp_duel_first_win: { name: 'Resolva Lá Fora', desc: 'Vença um duelo.' },
  pvp_duel_grace: {
    name: 'Uma Lição de Humildade',
    desc: 'Perca um duelo com a dignidade quase intacta.',
  },
  pvp_vcup_first_match: {
    name: 'Chuteiras no Gramado',
    desc: 'Jogue uma partida completa da Copa do Vale no Sowfield, vencendo ou perdendo.',
  },
  pvp_vcup_first_win: {
    name: 'A Primeira Taça',
    desc: 'Vença uma partida ranqueada da Copa do Vale.',
  },
  pvp_vcup_wins_10: {
    name: 'Javalibolista Tarimbado',
    desc: 'Vença 10 partidas ranqueadas da Copa do Vale.',
  },
  pvp_vcup_wins_25: {
    name: 'Lenda do Javalibol',
    desc: 'Vença 25 partidas ranqueadas da Copa do Vale.',
    title: 'Lenda do Javalibol',
  },
  pvp_vcup_first_goal: {
    name: 'Estreia no Placar',
    desc: 'Marque um gol em uma partida ranqueada da Copa do Vale.',
  },
  pvp_vcup_hat_trick: {
    name: 'Herói do Hat-Trick',
    desc: 'Marque três gols em uma única partida ranqueada da Copa do Vale, na chave 3v3 ou maior.',
  },
  pvp_vcup_golden_goal: {
    name: 'Momento de Ouro',
    desc: 'Marque o gol de ouro que decide uma partida ranqueada da Copa do Vale.',
  },
  pvp_vcup_first_save: {
    name: 'Mãos Seguras',
    desc: 'Faça uma defesa como goleiro em uma partida ranqueada da Copa do Vale.',
  },
  pvp_vcup_clean_sheet: {
    name: 'Aqui Não Passa Nada',
    desc: 'Vença uma partida ranqueada da Copa do Vale como goleiro sem sofrer nenhum gol.',
  },
  pvp_vcup_guild_win: {
    name: 'Pelo Estandarte',
    desc: 'Vença uma partida ranqueada da Copa do Vale disputada sob o estandarte da sua guilda.',
  },
  pvp_fiesta_first_bout: {
    name: 'Penetra na Festa',
    desc: 'Dispute um confronto 2v2 completo da Fiesta, vencendo ou perdendo.',
  },
  pvp_fiesta_first_win: { name: 'A Alma da Fiesta', desc: 'Vença um confronto 2v2 da Fiesta.' },
  pvp_fiesta_double: {
    name: 'Dose Dupla de Encrenca',
    desc: 'Consiga dois abates na Fiesta em até quatro segundos.',
  },
  pvp_fiesta_shutdown: {
    name: 'Estraga-Prazeres',
    desc: 'Abata um adversário da Fiesta que esteja em uma sequência de três ou mais.',
  },
  pvp_fiesta_full_build: {
    name: 'Vestido para a Ocasião',
    desc: 'Vença um confronto da Fiesta com um aprimoramento garantido de todas as três ondas.',
  },
  pvp_fiesta_powerups: {
    name: 'Um de Cada',
    desc: 'Pegue cada um dos quatro power-ups do ringue pelo menos uma vez: Demônio da Velocidade, Colosso, Botas Lunares e Berserker.',
  },
  pvp_fiesta_five_kills: {
    name: 'Carregando a Festa nas Costas',
    desc: 'Consiga cinco abates em um único confronto da Fiesta.',
  },
  soc_first_party: { name: 'Juntos É Melhor', desc: 'Entre em um grupo com outro jogador.' },
  soc_full_house: {
    name: 'Casa Cheia',
    desc: 'Conclua uma masmorra com um grupo completo de cinco.',
  },
  soc_guild_joined: { name: 'Sob o Mesmo Estandarte', desc: 'Torne-se membro de uma guilda.' },
  soc_guild_founded: { name: 'A Pena do Fundador', desc: 'Funde a sua própria guilda.' },
  soc_first_trade: { name: 'Troca Justa', desc: 'Conclua uma troca com outro jogador.' },
  soc_first_sale: {
    name: 'Aberto para Negócios',
    desc: 'Recolha as moedas da sua primeira venda no Mercado Mundial.',
  },
  soc_steady_custom: {
    name: 'Freguesia Fiel',
    desc: 'Recolha um total vitalício de 10 de ouro em vendas no Mercado Mundial.',
  },
  soc_market_magnate: {
    name: 'Magnata do Mercado',
    desc: 'Recolha um total vitalício de 100 de ouro em vendas no Mercado Mundial.',
    title: 'Magnata',
  },
  soc_by_ravens_wing: {
    name: 'Nas Asas do Corvo',
    desc: 'Envie uma carta pelo Correio do Corvo levando moedas ou uma encomenda.',
  },
  soc_room_for_more: { name: 'Espaço para Mais', desc: 'Compre sua primeira expansão de banco.' },
  soc_gilded_strongbox: {
    name: 'A Arca Dourada',
    desc: 'Compre cada expansão de banco que os tesoureiros tiverem à venda.',
  },
  soc_meet_bursar: {
    name: 'Em Fernando Confiamos',
    desc: 'Apresente seus respeitos ao Tesoureiro Fernando, guardião da Arca Dourada em Eastbrook.',
  },
  soc_pocket_money: {
    name: 'Dinheiro no Bolso',
    desc: 'Saqueie um total vitalício de 1 de ouro em moedas.',
  },
  soc_heavy_purse: {
    name: 'Bolsa Pesada',
    desc: 'Saqueie um total vitalício de 10 de ouro em moedas.',
  },
  soc_wyrms_hoard: {
    name: 'O Tesouro de um Wyrm',
    desc: 'Saqueie um total vitalício de 100 de ouro em moedas.',
  },
  soc_civic_duty: { name: 'Dever Cívico', desc: 'Aloque seu primeiro ponto de Foco da Cidade.' },
  exp_long_road_north: {
    name: 'A Longa Estrada para o Norte',
    desc: 'Visite os três povoados principais: Eastbrook, Fenbridge e Highwatch.',
  },
  exp_vale_wayfarer: {
    name: 'Andarilho do Vale',
    desc: 'Visite todos os onze locais nomeados do Vale de Eastbrook.',
  },
  exp_marsh_wayfarer: {
    name: 'Andarilho do Pântano',
    desc: 'Visite todos os oito locais nomeados do Pântano de Mirefen.',
  },
  exp_peaks_wayfarer: {
    name: 'Andarilho das Alturas',
    desc: 'Visite todos os dez locais nomeados das Alturas de Thornpeak.',
  },
  exp_world_traveler: {
    name: 'Viajante do Mundo',
    desc: 'Conquiste o feito de andarilho das três zonas.',
    title: 'o Andarilho',
  },
  exp_something_shiny: { name: 'Algo Brilhante', desc: 'Pegue um objeto cintilante do chão.' },
  exp_first_ore: { name: 'Golpeie a Terra', desc: 'Colete seu primeiro veio de minério.' },
  exp_first_timber: { name: 'Madeira!', desc: 'Colete seu primeiro ponto de madeira.' },
  exp_first_herb: { name: 'Dedo Verde', desc: 'Colha seu primeiro ponto de ervas.' },
  feat_era_cap: {
    name: 'Cria da Primeira Era',
    desc: 'Alcançou o nível 20 enquanto a Primeira Era estava em vigor.',
  },
  feat_book_complete: {
    name: 'O Livro Inteiro',
    desc: 'Conquiste cada feito do Livro dos Feitos.',
  },
  feat_brightwood_relic: {
    name: 'Brightwood na Lembrança',
    desc: 'Guarde uma relíquia da velha Brightwood: o Gibão de couro de sarça ou a Coroa do Monarca.',
  },
  hid_saul_footnote: {
    name: 'Uma Nota de Rodapé na História',
    desc: 'Importunou Saul, o Cronista, nove vezes, sem parar.',
    title: 'a Nota de Rodapé',
  },
  hid_gilded_tour: {
    name: 'A Turnê Dourada',
    desc: 'Fez negócios com as três agências da Arca Dourada.',
  },
  hid_fall_death: {
    name: 'A Gravidade Sempre Vence',
    desc: 'Morreu de uma longa conversa com o chão.',
  },
  hid_keepers_toll_twice: {
    name: 'O Guardião Cobra Duas Vezes',
    desc: 'Morreu enquanto o Tributo do Guardião ainda pesava sobre você.',
  },
  hid_roll_hundred: { name: 'Cem Natural', desc: 'Rolou um 100 perfeito em um /roll comum.' },
  hid_yumi_cheer: {
    name: 'Maior Fã da Yumi',
    desc: 'Torceu por Yumi onde ela podia ouvir você, em plena luta.',
  },
  hid_bountiful_coffer: {
    name: 'O Baú Púrpura',
    desc: 'Abriu um Baú Farto antes que ele pudesse emperrar.',
  },
  hid_companion_save: {
    name: 'Não no Turno Dela',
    desc: 'Sua companheira de incursão reergueu um companheiro de grupo caído.',
  },
  hid_codfather: {
    name: 'Entrou para a Família',
    desc: 'Tirou O Bacalhau-Padrinho dos Baixios de Deepfen.',
  },
  prog_crown_below: {
    name: 'A Coroa Sob a Terra',
    desc: 'Siga a coroa desde os campos de ossos inquietos até a tumba do Rei Nythraxis e conclua O Fim do Flagelo.',
  },
  prog_mere_at_rest: {
    name: 'O Lago em Repouso',
    desc: 'Acompanhe até o fim a vigília de Ondrel Vane: o coro silenciado, o Anel Pálido abatido e a Lua Afogada posta em repouso.',
  },
  prog_callused_hands: {
    name: 'Mãos Calejadas',
    desc: 'Complete Um Ofício para Cada Mão e ganhe seu primeiro calo nos ofícios de Eastbrook.',
  },
  prog_tools_of_the_trade: {
    name: 'Ferramentas do Ofício',
    desc: 'Conclua uma criação que exige uma estação no polo de ofícios de Highwatch.',
  },
  dgn_nythraxis_crypt: {
    name: 'O Que a Cripta Guardava',
    desc: 'Enfrente a Cripta abandonada e recupere de seus guardiões as duas metades da pedra-chave e o diário antigo.',
  },
  chr_marsh_first_cast: {
    name: 'Enguias nos Juncos',
    desc: 'Pesque um peixe nas águas do Pântano de Mirefen.',
  },
};
