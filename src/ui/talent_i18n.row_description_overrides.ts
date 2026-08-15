import type { SupportedLanguage } from './i18n';

// Authored winning-Warrior row descriptions that cannot be generated from
// primitive effect metadata alone. Keep description data separate from title data.
type RetainedRowDescriptionId =
  | 'war_row_second_wind'
  | 'war_row_anger_management'
  | 'war_row_blood_offering'
  | 'war_row_battle_rhythm'
  | 'war_row_colossal_might'
  | 'mag_r5_blink_cast'
  | 'mag_r8_temporal_rift'
  | 'mag_r17_convergence'
  | 'mag_r20_overflowing_power'
  | 'dru_r20_improved_hurricane';

type OptionalRetainedRowDescriptionId =
  | 'wlk_r17_death_coil'
  | 'wlk_r20_chaos_bolt'
  | 'wlk_r20_grimoire_of_haste'
  | 'dru_r14_empowered_touch'
  | 'dru_r14_moonfury'
  | 'dru_r14_savage_fury'
  | 'dru_r20_berserk'
  | 'dru_r20_tranquility'
  | 'dru_r5_ferocity'
  | 'dru_r5_improved_wrath'
  | 'hun_r11_binding_payload'
  | 'hun_r11_crippling_pursuit'
  | 'hun_r14_efficient_rhythm'
  | 'hun_r14_guise_mastery'
  | 'hun_r17_apex_instinct'
  | 'hun_r17_pack_rally'
  | 'hun_r17_shell_and_fang'
  | 'hun_r20_chain_reaction'
  | 'hun_r20_fang_chorus'
  | 'hun_r20_overdraw'
  | 'hun_r5_enduring_courser'
  | 'hun_r5_predators_pace'
  | 'hun_r8_receding_shell'
  | 'hun_r8_shared_recovery'
  | 'pal_r14_divine_purpose'
  | 'pal_r14_sacred_reserve'
  | 'pal_r14_zeal'
  | 'pal_r17_extended_dawn'
  | 'pal_r20_dawn_echo'
  | 'pal_r20_perpetual_sun'
  | 'pal_r5_divine_steed'
  | 'pal_r5_radiant_stride'
  | 'pal_r8_recurring_grace'
  | 'pri_r11_vampiric_embrace'
  | 'pri_r14_pain_and_suffering'
  | 'pri_r20_incarnate_spirit'
  | 'pri_r20_second_verse'
  | 'pri_r5_improved_renew'
  | 'pri_r5_searing_light'
  | 'pri_r5_twisted_faith'
  | 'rog_r11_cheap_trick'
  | 'rog_r14_dusk_economy'
  | 'rog_r20_kill_chain'
  | 'rog_r20_second_shadow'
  | 'sha_r14_chain_lightning'
  | 'sha_r14_improved_flame_shock'
  | 'sha_r14_weapon_fury'
  | 'sha_r17_elemental_warding'
  | 'sha_r17_improved_ghost_wolf'
  | 'sha_r20_bloodlust'
  | 'sha_r20_elemental_fury'
  | 'sha_r20_tidal_waves'
  | 'sha_r5_imbue_mastery'
  | 'sha_r5_improved_lightning_shield'
  | 'sha_r8_frost_bind'
  | 'wlk_r11_demon_armor';

type DescriptionMap = Readonly<
  Record<RetainedRowDescriptionId, string> &
    Partial<Record<OptionalRetainedRowDescriptionId, string>>
>;

export const RETAINED_ROW_DESCRIPTION_OVERRIDES: Partial<
  Record<SupportedLanguage, DescriptionMap>
> = {
  es: {
    wlk_r17_death_coil:
      'Reduce un 25 % la reutilización de la preparación de tu especialización: Maleficio de violencia (Aflicción; castiga las acciones dañinas del enemigo), Mandato profano (Nigromancia; potencia brevemente a todos tus no-muertos) o Marca ruinosa (Destrucción; hace eco de tus hechizos directos).',
    wlk_r20_chaos_bolt:
      'Cada segundo que pasas lanzando o canalizando reduce 0,5 s la reutilización restante de tus habilidades de clase de brujo. No afecta a las habilidades de especialización ni a los talentos finales.',
    wlk_r20_grimoire_of_haste:
      'La primera habilidad de clase de brujo con reutilización que usas crea un reflejo prohibido. Puedes volver a usar esa misma habilidad una vez durante los siguientes 10 s por su coste normal sin iniciar otra reutilización. Este efecto solo puede ocurrir una vez cada 60 s.',
    mag_r5_blink_cast: 'Puedes usar Paso Fugaz en mitad de un lanzamiento sin interrumpirlo.',
    mag_r8_temporal_rift:
      'Lanzar tu barrera personal elimina los efectos de inmovilización que te afectan.',
    mag_r17_convergence:
      'Alternar un hechizo de Fuego y uno de Escarcha abre una oleada de poder de 8 s, una vez cada 30 s.',
    mag_r20_overflowing_power:
      'Gastar mana reduce el tiempo de reutilización de tus defensivas: 2 s por cada décima parte de tu mana máximo gastado, hasta 10 s cada 30 s.',
    dru_r20_improved_hurricane:
      'Mientras estás en Forma de búho lunar, tú y los miembros de tu grupo a 30 m ganáis un 3% de probabilidad de golpe crítico con hechizos.',
    war_row_second_wind:
      'Por debajo del 35 % de salud, regeneras un 1,5 % de tu salud por segundo.',
    war_row_anger_management:
      'Tus ataques automáticos generan un 10 % más de ira y tus habilidades, un 5 % más.',
    war_row_blood_offering:
      'Tus actitudes obtienen efectos adicionales. Actitud de Batalla: los golpes críticos de tus habilidades infligen un 15 % más de daño. Actitud Rabiosa: tus ataques automáticos son un 5 % más rápidos. Actitud en Guardia: un golpe que te quitaría al menos un 20 % de tu salud máxima inflige un 15 % menos de daño.',
    war_row_battle_rhythm: 'Cada tercera habilidad que utilizas genera un 20 % más de ira.',
    war_row_colossal_might:
      'Cada punto de ira que gastas reduce en 0,1 s el tiempo de reutilización de tus grandes habilidades ofensivas, hasta 10 s cada 30 s.',
    'dru_r14_empowered_touch':
      'Sobrefloración vuelve a plantar una Floración Silvestre nueva en cada aliado cuya sanación cosechó.',
    'dru_r14_moonfury':
      'La Oleada Lunar y la Estela Solar también restauran cada una un 15% de tu maná máximo.',
    'dru_r14_savage_fury':
      'Cada pulso de tus sangrados de Desollar y Desgarrar también añade 1 de Sangre Antigua.',
    'dru_r20_berserk':
      'Oleada Lunar, Estela Solar, Cosecha Roja, Quiebramédula y Sobrefloración son un 25% más fuertes.',
    'dru_r20_tranquility':
      'Cada punto de Marea Lunar, Sangre Antigua o Verdor que ganes restaura un 2% de tu maná máximo, 5 de energía o 3 de ira, según tu forma actual.',
    'dru_r5_ferocity':
      'Cambiar de forma otorga un 60% de velocidad de movimiento durante 3 s, como máximo una vez cada 20 s.',
    'dru_r5_improved_wrath':
      'Cambiar de forma elimina las raíces rompibles y las ralentizaciones.',
    'hun_r11_binding_payload':
      'La Trampa Fauces de Escarcha inmoviliza a todos los enemigos en su área de activación durante 3 s, y luego los ralentiza un 40% durante 4 s.',
    'hun_r11_crippling_pursuit':
      'El Disparo Aturdidor o el Tajo Aprisionante inmoviliza a un objetivo ya ralentizado durante 2 s. Tiempo de reutilización de 12 s por objetivo.',
    'hun_r14_efficient_rhythm':
      'Después de gastar 75 de concentración, tu próxima Orden de Manada, Disparo Medido o Golpe Destripador otorga 20 de concentración adicional.',
    'hun_r14_guise_mastery':
      'Durante 6 s, el Aspecto del Aguilucho aumenta la generación de concentración un 50%, el Aspecto de la Marta reduce el daño directo un 25%, y el Aspecto del Corcel otorga un 50% de velocidad de movimiento, o un 60% con Corcel Perdurable. Tiempo de reutilización compartido de 20 s.',
    'hun_r17_apex_instinct':
      'Cólera de las bestias, Concentración Gélida o Asalto del Rastro de Sangre restauran 40 de concentración. Tus próximas 3 habilidades que gastan concentración cuestan un 50% menos e infligen un 20% más de daño. Estos usos expiran 4 s después de que termine el tiempo de reutilización que los desencadenó.',
    'hun_r17_pack_rally':
      'El Aspecto del Corcel puede desencadenar la Reunión de Manada. Tú, tu compañero y los aliados de grupo o banda en un radio de 30 metros ganan un 30% de velocidad de movimiento y un 10% de velocidad de ataque, lanzamiento y canalización durante 10 s. Tiempo de reutilización de 90 s.',
    'hun_r17_shell_and_fang':
      'La Piel de Caparazón permite atacar y dar órdenes a la mascota, pero su reducción de daño baja al 40%.',
    'hun_r20_chain_reaction':
      'La Trampa Fauces de Escarcha marca a los enemigos en un radio de 4 metros durante 8 s. Tus próximas 3 habilidades que gastan concentración hacen eco de un 40% de daño entre los enemigos marcados.',
    'hun_r20_fang_chorus':
      'Cada habilidad que gasta concentración ordena un eco de mascota al 50% de potencia. Cada 3.er eco se convierte en un golpe de área de 4 metros.',
    'hun_r20_overdraw':
      'Cada 3.er Disparo Funesto, Tensado Largo o Contracolmillo inflige un 35% más de daño a su objetivo y un 50% de ese daño a hasta 2 enemigos en un radio de 5 metros.',
    'hun_r5_enduring_courser':
      'El Aspecto del Corcel otorga un 60% de velocidad de movimiento durante 3 s al activarse. Tiempo de reutilización interno de 20 s.',
    'hun_r5_predators_pace':
      'Una Orden de Manada, Disparo Medido o Golpe Destripador certero otorga un 20% de velocidad de movimiento durante 3 s. Tiempo de reutilización interno de 8 s.',
    'hun_r8_receding_shell':
      'Vuelve a lanzar la Piel de Caparazón para terminarla antes y recuperar un 50% de su duración no utilizada, hasta 45 s.',
    'hun_r8_shared_recovery':
      'El Corazón Salvaje también sana a tu mascota un 30% y otorga a ambos un 20% de reducción de daño durante 4 s.',
    'pal_r14_divine_purpose':
      'Las habilidades potenciadas por la Ascensión tienen un 20% de probabilidad de no consumir una carga.',
    'pal_r14_sacred_reserve':
      'Cuando termina la Ascensión Divina, recuperas 5 de Devoción.',
    'pal_r14_zeal':
      'Cada tercera habilidad que realmente genera Devoción otorga 1 de Devoción adicional.',
    'pal_r17_extended_dawn':
      'La Ascensión Divina potencia 2 habilidades adicionales.',
    'pal_r20_dawn_echo':
      'Cada tercera habilidad directa que realmente genera Devoción repite su daño o sanación directa principal al 40% sobre el mismo objetivo. Un eco efectivo otorga 1 de Devoción. El eco no puede ser crítico ni desencadenar otros ecos, y no otorga Devoción durante la Ascensión Divina.',
    'pal_r20_perpetual_sun':
      'Consumir tu última carga de Ascensión inflige 150 de daño Sagrado en un radio de 10 m, sana a los aliados en un radio de 20 m por 150 y luego duplica la generación de Devoción de tus habilidades durante 5 s. Que la carga expire no lo desencadena.',
    'pal_r5_divine_steed':
      'Gana un 0,75% de velocidad de movimiento por cada punto de Devoción, hasta un 15% con 20. Activar la Ascensión Divina gasta tu Devoción y otorga un 30% de velocidad de movimiento durante 5 s.',
    'pal_r5_radiant_stride':
      'El Martillo de Gracia otorga un 30% de velocidad de movimiento durante 4 s cuando inflige daño.',
    'pal_r8_recurring_grace':
      'El exceso de sanación del Martillo de Gracia se convierte en un escudo de absorción durante 10 s, con un tope del 10% de tu salud máxima.',
    'pri_r11_vampiric_embrace':
      'Un enemigo que consume por completo el Salmo de Protección queda inmovilizado durante 2 s, una vez por enemigo cada 12 s.',
    'pri_r14_pain_and_suffering':
      'La sanación por daño de Doctrina restaura el Salmo de Protección por un 20% de la sanación realizada, hasta su absorción original. Bendición convierte el exceso de sanación de Coro Sanador en una absorción de 10 s con un tope del 10% de la salud máxima. Cada eco de Efigie de Vísperas extiende la Endecha de Descomposición 1 s, hasta 6 s por objetivo.',
    'pri_r20_incarnate_spirit':
      'Un Salmo de Protección totalmente consumido sana a su objetivo por un 40% de la absorción original. La sanación de la Vigilia de Bendición también sana hasta a 3 miembros del grupo en un radio de 15 metros por un 40%. Un Diezmademonio de Vísperas con 5 acumulaciones inflige un 50% más de daño y dura un 50% más.',
    'pri_r20_second_verse':
      'Después de 2 s, repite un 40% de la sanación de Misericordia Purgante de Doctrina, la sanación grupal de Bendición, o el daño del eco de Efigie de Vísperas. La repetición no puede desencadenarse a sí misma.',
    'pri_r5_improved_renew':
      'El Salmo de Protección otorga a su objetivo un 40% de velocidad de movimiento durante 3 s.',
    'pri_r5_searing_light':
      'El Paso del Velo elimina inmovilizaciones y ralentizaciones, y luego otorga un 50% de velocidad de movimiento durante 3 s.',
    'pri_r5_twisted_faith':
      'El Paso del Velo te permite lanzar en movimiento durante 4 s.',
    'rog_r11_cheap_trick':
      'El Golpe al Vientre ya no requiere el Velo Crepuscular.',
    'rog_r14_dusk_economy':
      'Las habilidades cuestan un 50% menos de energía mientras estás en el Velo Crepuscular o envuelto en sombras por el velo, y durante 6 s después de salir del Velo Crepuscular.',
    'rog_r20_kill_chain':
      'Los golpes letales refrescan el Paso de Humo y otorgan 5 puntos de combo.',
    'rog_r20_second_shadow':
      'El Descanso Eterno lanzado con 5 puntos de combo vuelve a golpear desde las sombras por un 75% de su daño.',
    'sha_r14_chain_lightning':
      'Después de gastar 120 de maná, tu próxima acción de chamán que cueste maná cuesta 40 menos. Este estado listo no tiene un vencimiento corto.',
    'sha_r14_improved_flame_shock':
      'La Marca Pírica otorga 1 carga extra de Trueno cada 3.er Arco Eléctrico. Los ecos del Corazón de Vendaval infligen un 25% más de daño, el Ligado a la Piedra gana un 5% de reducción de daño, y el Manantial de Vida deposita un 20% más de Corriente Sanadora.',
    'sha_r14_weapon_fury':
      'Un Arco Eléctrico, Golpe Ancestral o Aguas Reparadoras certero restaura 1 carga de Égida de Truenos y 10 de maná, una vez cada 6 s.',
    'sha_r17_elemental_warding':
      'Activar la Égida de Truenos otorga un 40% de reducción de daño durante 6 s. Tiempo de reutilización interno de 120 s.',
    'sha_r17_improved_ghost_wolf':
      'Cuando está listo, salir del Lobo Sombrío permite lanzar en movimiento durante 8 s. Tiempo de reutilización interno de 90 s.',
    'sha_r20_bloodlust':
      'Después de que la Sacudida Terrestre o el Terremoto consuman todo el Trueno, conservas 2 de Trueno. Después de que un hechizo consuma el Presagio de Tormenta, conservas 1 paso de la Cadencia del Espíritu Guerrero. Después de que la Sanación en cadena consuma la Corriente Sanadora, restauras un 25% de la cantidad consumida.',
    'sha_r20_elemental_fury':
      'Después de que la Sacudida Terrestre o el Terremoto consuman todo el Trueno, repite un 40% de su daño tras 1 s. Un hechizo que consuma el Presagio de Tormenta se repite con un 40% de potencia. La sanación de la Corriente Sanadora consumida se repite con un 40% de potencia tras 2 s. Estas repeticiones no pueden desencadenar otros efectos.',
    'sha_r20_tidal_waves':
      'Después de que la Sacudida Terrestre o el Terremoto consuman todo el Trueno, la Marca Pírica vuelve instantáneo tu próximo Arco Eléctrico. El último eco del Corazón de Vendaval inflige un 50% de daño a hasta 2 enemigos en un radio de 8 metros. Un hechizo del Ligado a la Piedra que consuma el Presagio de Tormenta otorga una absorción equivalente al 8% de tu salud máxima. Con el Manantial de Vida activo, la Llamada de la Marea también añade un 50% de su sanación completa al aliado más herido en un radio de 10 metros.',
    'sha_r5_imbue_mastery':
      'Después de usar una Sacudida, el próximo Arco Eléctrico o Aguas Reparadoras que empieces a lanzar en los 8 s siguientes puede lanzarse en movimiento.',
    'sha_r5_improved_lightning_shield':
      'Entrar en Lobo Sombrío otorga un 60% de velocidad de movimiento durante 3 s, una vez cada 20 s.',
    'sha_r8_frost_bind':
      'La represalia de la Égida de Truenos otorga un 10% de reducción de daño durante 3 s.',
    'wlk_r11_demon_armor':
      'La primera vez que cada miembro del grupo toca tu Pozo de Almas, los protege con un escudo equivalente al 15% de su salud máxima durante 30 s. Cada jugador puede obtener este escudo una vez por Pozo de Almas.',
  },
  es_ES: {
    wlk_r17_death_coil:
      'Reduce un 25 % la reutilización de la preparación de tu especialización: Maleficio de violencia (Aflicción; castiga las acciones dañinas del enemigo), Mandato profano (Nigromancia; potencia brevemente a todos tus no-muertos) o Marca ruinosa (Destrucción; hace eco de tus hechizos directos).',
    wlk_r20_chaos_bolt:
      'Cada segundo que pasas lanzando o canalizando reduce 0,5 s la reutilización restante de tus habilidades de clase de brujo. No afecta a las habilidades de especialización ni a los talentos finales.',
    wlk_r20_grimoire_of_haste:
      'La primera habilidad de clase de brujo con reutilización que usas crea un reflejo prohibido. Puedes volver a usar esa misma habilidad una vez durante los siguientes 10 s por su coste normal sin iniciar otra reutilización. Este efecto solo puede ocurrir una vez cada 60 s.',
    mag_r5_blink_cast: 'Puedes usar Paso Fugaz en mitad de un lanzamiento sin interrumpirlo.',
    mag_r8_temporal_rift:
      'Lanzar tu barrera personal elimina los efectos de inmovilización que te afectan.',
    mag_r17_convergence:
      'Alternar un hechizo de Fuego y uno de Escarcha abre una oleada de poder de 8 s, una vez cada 30 s.',
    mag_r20_overflowing_power:
      'Gastar mana reduce el tiempo de reutilización de tus defensivas: 2 s por cada décima parte de tu mana máximo gastado, hasta 10 s cada 30 s.',
    dru_r20_improved_hurricane:
      'Mientras estás en Forma de búho lunar, tú y los miembros de tu grupo a 30 m ganáis un 3% de probabilidad de golpe crítico con hechizos.',
    war_row_second_wind:
      'Por debajo del 35 % de salud, regeneras un 1,5 % de tu salud por segundo.',
    war_row_anger_management:
      'Tus ataques automáticos generan un 10 % más de ira y tus habilidades, un 5 % más.',
    war_row_blood_offering:
      'Tus actitudes obtienen efectos adicionales. Actitud de Batalla: los golpes críticos de tus habilidades infligen un 15 % más de daño. Actitud Rabiosa: tus ataques automáticos son un 5 % más rápidos. Actitud en Guardia: un golpe que te quitaría al menos un 20 % de tu salud máxima inflige un 15 % menos de daño.',
    war_row_battle_rhythm: 'Cada tercera habilidad que utilizas genera un 20 % más de ira.',
    war_row_colossal_might:
      'Cada punto de ira que gastas reduce en 0,1 s el tiempo de reutilización de tus grandes habilidades ofensivas, hasta 10 s cada 30 s.',
    'dru_r14_empowered_touch':
      'Sobrefloración replanta una Floración Silvestre nueva en cada aliado cuya sanación cosechó.',
    'dru_r14_moonfury':
      'Oleada Lunar y Estela Solar también restauran cada una un 15% de tu maná máximo.',
    'dru_r14_savage_fury':
      'Cada tic de tus sangrados de Desollar y Desgarrar también añade 1 de Sangre Antigua.',
    'dru_r20_berserk':
      'Oleada Lunar, Estela Solar, Cosecha Roja, Quiebramédula y Sobrefloración son un 25% más fuertes.',
    'dru_r20_tranquility':
      'Cada 1 de Marea Lunar, Sangre Antigua o Verdor que ganas restaura un 2% de tu maná máximo, 5 de energía o 3 de ira, según tu forma actual.',
    'dru_r5_ferocity':
      'Cambiar de forma otorga un 60% de velocidad de movimiento durante 3 s, como máximo una vez cada 20 s.',
    'dru_r5_improved_wrath':
      'Cambiar de forma elimina raíces y ralentizaciones rompibles.',
    'hun_r11_binding_payload':
      'La Trampa Fauces de Escarcha inmoviliza a todos los enemigos en su área de activación durante 3 s, y luego los ralentiza un 40% durante 4 s.',
    'hun_r11_crippling_pursuit':
      'Disparo Aturdidor o Tajo Aprisionante inmoviliza durante 2 s a un objetivo ya ralentizado. Tiempo de reutilización de 12 s por objetivo.',
    'hun_r14_efficient_rhythm':
      'Tras gastar 75 de Concentración, tu próximo Orden de Manada, Disparo Medido o Golpe Destripador otorga 20 de Concentración adicional.',
    'hun_r14_guise_mastery':
      'Durante 6 s, el Aspecto del Aguilucho aumenta la generación de Concentración un 50%, el Aspecto de la Marta reduce el daño directo un 25%, y el Aspecto del Corcel otorga un 50% de velocidad de movimiento, o un 60% con Corcel Perdurable. Tiempo de reutilización compartido de 20 s.',
    'hun_r17_apex_instinct':
      'Cólera de las bestias, Concentración Gélida o Asalto del Rastro de Sangre restauran 40 de Concentración. Tus próximos 3 usos de habilidades que consumen Concentración cuestan un 50% menos e infligen un 20% más de daño. Estos usos caducan 4 s después de que termine el tiempo de reutilización que los activó.',
    'hun_r17_pack_rally':
      'El Aspecto del Corcel puede activar Reunión de Manada. Tú, tu compañero y los aliados de grupo o banda en 30 m ganáis un 30% de velocidad de movimiento y un 10% de velocidad de ataque, lanzamiento y canalización durante 10 s. Tiempo de reutilización de 90 s.',
    'hun_r17_shell_and_fang':
      'Piel de Caparazón permite atacar y ordenar a tu mascota, pero su reducción de daño baja al 40%.',
    'hun_r20_chain_reaction':
      'La Trampa Fauces de Escarcha marca a los enemigos en 4 m durante 8 s. Tus próximos 3 usos de habilidades que consumen Concentración hacen eco de un 40% de daño entre los enemigos marcados.',
    'hun_r20_fang_chorus':
      'Cada habilidad que consume Concentración ordena un eco de tu mascota al 50% de fuerza. Cada 3.er eco se convierte en una sacudida de 4 m.',
    'hun_r20_overdraw':
      'Cada 3.er Disparo Funesto, Tensado Largo o Contracolmillo inflige un 35% más de daño a su objetivo y un 50% de ese daño a hasta 2 enemigos en 5 m.',
    'hun_r5_enduring_courser':
      'El Aspecto del Corcel otorga un 60% de velocidad de movimiento durante 3 s al activarse. Tiempo de reutilización interno de 20 s.',
    'hun_r5_predators_pace':
      'Un acierto con Orden de Manada, Disparo Medido o Golpe Destripador otorga un 20% de velocidad de movimiento durante 3 s. Tiempo de reutilización interno de 8 s.',
    'hun_r8_receding_shell':
      'Vuelve a lanzar Piel de Caparazón para terminarla antes de tiempo y recuperar un 50% de su duración no usada, hasta 45 s.',
    'hun_r8_shared_recovery':
      'Corazón Salvaje también sana a tu mascota un 30% y os concede a ambos una reducción del daño recibido del 20% durante 4 s.',
    'pal_r14_divine_purpose':
      'Las habilidades potenciadas por la Ascensión tienen un 20% de probabilidad de no consumir una carga.',
    'pal_r14_sacred_reserve':
      'Cuando la Ascensión Divina termina, recuperas 5 de Devoción.',
    'pal_r14_zeal':
      'Cada tercera habilidad que realmente genera Devoción otorga 1 de Devoción adicional.',
    'pal_r17_extended_dawn':
      'La Ascensión Divina potencia 2 habilidades adicionales.',
    'pal_r20_dawn_echo':
      'Cada tercera habilidad directa que realmente genera Devoción repite su daño o sanación directa principal al 40% sobre el mismo objetivo. Un eco efectivo otorga 1 de Devoción. El eco no puede ser crítico ni activar otros ecos, y no otorga Devoción durante la Ascensión Divina.',
    'pal_r20_perpetual_sun':
      'Consumir tu última carga de Ascensión inflige 150 de daño Sagrado en 10 m, sana a los aliados en 20 m por 150, y luego duplica la generación de Devoción de tus habilidades durante 5 s. La expiración no lo activa.',
    'pal_r5_divine_steed':
      'Gana un 0,75% de velocidad de movimiento por cada punto de Devoción, hasta un 15% con 20. Activar la Ascensión Divina gasta tu Devoción y otorga un 30% de velocidad de movimiento durante 5 s.',
    'pal_r5_radiant_stride':
      'El Martillo de Gracia otorga un 30% de velocidad de movimiento durante 4 s cuando inflige daño.',
    'pal_r8_recurring_grace':
      'La sobrecuración del Martillo de Gracia se convierte en un escudo de absorción durante 10 s, limitado al 10% de tu salud máxima.',
    'pri_r11_vampiric_embrace':
      'Un enemigo que consume por completo el Salmo de Protección queda inmovilizado durante 2 s, una vez por enemigo cada 12 s.',
    'pri_r14_pain_and_suffering':
      'La sanación por daño de Doctrina restaura tu Salmo de Protección en un 20% de lo sanado, hasta su absorción original. Bendición convierte la sobrecuración de Coro Sanador en una absorción de 10 s, limitada al 10% de la salud máxima. Cada eco de la Efigie de Vísperas extiende la Endecha de Descomposición 1 s, hasta 6 s por objetivo.',
    'pri_r20_incarnate_spirit':
      'Un Salmo de Protección totalmente consumido sana a su objetivo por un 40% de la absorción original. La sanación de la Vigilia de Bendición también sana hasta a 3 miembros del grupo en 15 m por un 40%. Un Diezmademonio de Vísperas con 5 acumulaciones inflige un 50% más de daño y dura un 50% más.',
    'pri_r20_second_verse':
      'Tras 2 s, repite un 40% de la sanación de Misericordia Purgante de Doctrina, la sanación grupal de Bendición, o el daño del eco de la Efigie de Vísperas. La repetición no puede activarse a sí misma.',
    'pri_r5_improved_renew':
      'El Salmo de Protección otorga a su objetivo un 40% de velocidad de movimiento durante 3 s.',
    'pri_r5_searing_light':
      'Paso del Velo elimina raíces y ralentizaciones, y luego otorga un 50% de velocidad de movimiento durante 3 s.',
    'pri_r5_twisted_faith':
      'Paso del Velo permite al Sacerdote lanzar hechizos en movimiento durante 4 s.',
    'rog_r11_cheap_trick':
      'Golpe al Vientre ya no requiere el Velo Crepuscular.',
    'rog_r14_dusk_economy':
      'Las habilidades cuestan un 50% menos de energía mientras estás en el Velo Crepuscular o envuelto en el velo de sombras, y durante 6 s después de salir del Velo Crepuscular.',
    'rog_r20_kill_chain':
      'Los golpes letales reinician Paso de Humo y otorgan 5 puntos de combo.',
    'rog_r20_second_shadow':
      'Descanso Eterno lanzado con 5 puntos de combo vuelve a golpear desde las sombras por un 75% de su daño.',
    'sha_r14_chain_lightning':
      'Tras gastar 120 de maná, tu próxima acción de Chamán que cueste maná cuesta 40 menos. El estado listo no tiene una caducidad breve.',
    'sha_r14_improved_flame_shock':
      'La Marca Pírica otorga 1 carga extra de Trueno cada 3.er Arco Eléctrico. Los Ecos del Corazón de Vendaval infligen un 25% más de daño, el Ligado a la Piedra gana un 5% de reducción de daño, y el Manantial de Vida deposita un 20% más de Corriente Sanadora.',
    'sha_r14_weapon_fury':
      'Un acierto con Arco Eléctrico, Golpe Ancestral o Aguas Reparadoras restaura 1 carga de la Égida de Truenos y 10 de maná, una vez cada 6 s.',
    'sha_r17_elemental_warding':
      'Activar la Égida de Truenos otorga una reducción del daño recibido del 40% durante 6 s. Tiempo de reutilización interno de 120 s.',
    'sha_r17_improved_ghost_wolf':
      'Cuando está lista, salir de Lobo Sombrío permite lanzar hechizos en movimiento durante 8 s. Tiempo de reutilización interno de 90 s.',
    'sha_r20_bloodlust':
      'Cuando la Sacudida Terrestre o el Terremoto consumen todo el Trueno, conservas 2 de Trueno. Cuando un hechizo consume el Presagio de Tormenta, conservas 1 paso de la Cadencia del Espíritu Guerrero. Cuando la Sanación en cadena consume Corriente Sanadora, restauras un 25% de la cantidad consumida.',
    'sha_r20_elemental_fury':
      'Cuando la Sacudida Terrestre o el Terremoto consumen todo el Trueno, repite un 40% de su daño tras 1 s. Un hechizo que consume el Presagio de Tormenta se repite al 40% de su fuerza. La sanación de la Corriente Sanadora consumida se repite al 40% de su fuerza tras 2 s. Estas repeticiones no pueden activar otros efectos.',
    'sha_r20_tidal_waves':
      'Cuando la Sacudida Terrestre o el Terremoto consumen todo el Trueno, la Marca Pírica vuelve instantáneo tu próximo Arco Eléctrico. El último eco del Corazón de Vendaval inflige un 50% de daño a hasta 2 enemigos en 8 m. Un hechizo del Ligado a la Piedra que consume el Presagio de Tormenta otorga una absorción igual al 8% de tu salud máxima. Con el Manantial de Vida activo, la Llamada de la Marea también añade un 50% de su sanación completa al aliado más herido en 10 m.',
    'sha_r5_imbue_mastery':
      'Tras usar una Sacudida, el siguiente Arco Eléctrico o Aguas Reparadoras que inicies en los siguientes 8 s puede lanzarse en movimiento.',
    'sha_r5_improved_lightning_shield':
      'Entrar en Lobo Sombrío otorga un 60% de velocidad de movimiento durante 3 s, una vez cada 20 s.',
    'sha_r8_frost_bind':
      'La represalia de la Égida de Truenos otorga una reducción del daño recibido del 10% durante 3 s.',
    'wlk_r11_demon_armor':
      'La primera vez que cada miembro del grupo toca tu Soulwell, los escuda por un 15% de su salud máxima durante 30 s. Cada jugador puede obtener este escudo una vez por Soulwell.',
  },
  fr_FR: {
    mag_r5_blink_cast:
      "Vous pouvez utiliser Pas scintillant au milieu d'une incantation sans l'interrompre.",
    mag_r8_temporal_rift:
      "Lancer votre barrière personnelle dissipe les effets d'immobilisation qui vous affectent.",
    mag_r17_convergence:
      'Alterner un sort de Feu et un sort de Givre déclenche une poussée de puissance de 8 s, une fois toutes les 30 s.',
    mag_r20_overflowing_power:
      "Dépenser du mana réduit le temps de recharge de vos défensives : 2 s par dixième de votre mana maximum dépensé, jusqu'à 10 s toutes les 30 s.",
    dru_r20_improved_hurricane:
      'En Forme de sélénien, vous et les membres de votre groupe dans un rayon de 30 m gagnez 3 % de chances de coup critique avec les sorts.',
    war_row_second_wind:
      'Lorsque vos points de vie sont inférieurs à 35 %, vous régénérez 1,5 % de vos points de vie par seconde.',
    war_row_anger_management:
      'Vos attaques automatiques génèrent 10 % de rage en plus et vos techniques 5 % de plus.',
    war_row_blood_offering:
      'Vos postures gagnent des effets supplémentaires. Posture de combat : les coups critiques de vos techniques infligent 15 % de dégâts supplémentaires. Posture berserker : vos attaques automatiques sont 5 % plus rapides. Posture de garde : un coup qui vous retirerait au moins 20 % de votre maximum de points de vie inflige 15 % de dégâts en moins.',
    war_row_battle_rhythm: 'Chaque troisième technique utilisée génère 20 % de rage en plus.',
    war_row_colossal_might:
      "Chaque point de rage dépensé réduit de 0,1 s le temps de recharge de vos grandes capacités offensives, jusqu'à 10 s toutes les 30 s.",
    'dru_r14_empowered_touch':
      'Surfloraison replante une Floraison sauvage fraîche sur chaque allié dont elle a récolté le soin.',
    'dru_r14_moonfury':
      'Déferlante lunaire et Sillage solaire restaurent chacun aussi 15% de votre mana maximum.',
    'dru_r14_savage_fury':
      'Chaque tic de vos saignements d\'Écorcher et de Lacération ajoute aussi 1 Sang ancien.',
    'dru_r20_berserk':
      'Déferlante lunaire, Sillage solaire, Moisson rouge, Brise-moelle et Surfloraison sont 25% plus puissants.',
    'dru_r20_tranquility':
      'Chaque point de Marée lunaire, Sang ancien ou Verdoyance que vous gagnez restaure 2% de votre mana maximum, 5 énergie ou 3 rage, selon votre forme actuelle.',
    'dru_r5_ferocity':
      'Changer de forme octroie 60% de vitesse de déplacement pendant 3 s, au plus une fois toutes les 20 s.',
    'dru_r5_improved_wrath':
      'Changer de forme retire les immobilisations et ralentissements brisables.',
    'hun_r11_binding_payload':
      'Le Piège Mâchegivre immobilise tous les ennemis dans sa zone de déclenchement pendant 3 s, puis les ralentit de 40% pendant 4 s.',
    'hun_r11_crippling_pursuit':
      'Tir déstabilisant ou Taillade entravante immobilise une cible déjà ralentie pendant 2 s. Recharge de 12 s par cible.',
    'hun_r14_efficient_rhythm':
      'Après avoir dépensé 75 concentration, votre prochain Ordre de meute, Tir mesuré ou Frappe éventrante octroie 20 concentration supplémentaire.',
    'hun_r14_guise_mastery':
      'Pendant 6 s, l\'Aspect du busard augmente la génération de concentration de 50%, l\'Aspect de la martre réduit les dégâts directs de 25%, et l\'Aspect du coursier octroie 50% de vitesse de déplacement, ou 60% avec Coursier endurant. Recharge commune de 20 s.',
    'hun_r17_apex_instinct':
      'Courroux bestial, Concentration glaciale ou Assaut de la piste sanglante restaure 40 concentration. Vos 3 prochaines dépenses de concentration coûtent 50% de moins et infligent 20% de dégâts en plus. Ces usages expirent 4 s après la fin du temps de recharge déclencheur.',
    'hun_r17_pack_rally':
      'L\'Aspect du coursier peut déclencher le Ralliement de meute. Vous, votre compagnon, et les alliés de groupe ou de raid à moins de 30 m gagnez 30% de vitesse de déplacement et 10% de vitesse d\'attaque, d\'incantation et de canalisation pendant 10 s. Recharge de 90 s.',
    'hun_r17_shell_and_fang':
      'Peau de carapace autorise les attaques et les ordres au familier, mais sa réduction des dégâts est ramenée à 40%.',
    'hun_r20_chain_reaction':
      'Le Piège Mâchegivre marque les ennemis dans un rayon de 4 m pendant 8 s. Vos 3 prochaines dépenses de concentration répercutent 40% de dégâts entre les ennemis marqués.',
    'hun_r20_fang_chorus':
      'Chaque dépense de concentration commande un écho de familier à 50% de puissance. Un écho sur trois devient une secousse de 4 m.',
    'hun_r20_overdraw':
      'Un Tir funeste, Tir tendu ou Déchirement sur trois inflige 35% de dégâts en plus à sa cible et 50% de ces dégâts à 2 ennemis au plus dans un rayon de 5 m.',
    'hun_r5_enduring_courser':
      'L\'Aspect du coursier octroie 60% de vitesse de déplacement pendant 3 s lors de son activation. Recharge interne de 20 s.',
    'hun_r5_predators_pace':
      'Un Ordre de meute, Tir mesuré ou Frappe éventrante réussi octroie 20% de vitesse de déplacement pendant 3 s. Recharge interne de 8 s.',
    'hun_r8_receding_shell':
      'Relancez Peau de carapace pour y mettre fin prématurément et récupérer 50% de sa durée inutilisée, jusqu\'à 45 s.',
    'hun_r8_shared_recovery':
      'Cœur sauvage soigne aussi votre familier de 30% et vous octroie à tous deux 20% de réduction des dégâts pendant 4 s.',
    'pal_r14_divine_purpose':
      'Les capacités marquées par l\'Ascension ont 20% de chances de ne pas consommer de charge.',
    'pal_r14_sacred_reserve':
      'Quand l\'Ascension prend fin, récupérez 5 Dévotion.',
    'pal_r14_zeal':
      'Une capacité sur trois qui génère effectivement de la Dévotion octroie 1 Dévotion supplémentaire.',
    'pal_r17_extended_dawn':
      'L\'Ascension marque 2 capacités supplémentaires.',
    'pal_r20_dawn_echo':
      'Une capacité directe sur trois qui génère effectivement de la Dévotion répète ses dégâts ou soins directs principaux à 40% sur la même cible. Un écho effectif octroie 1 Dévotion. L\'écho ne peut ni asséner de coup critique ni déclencher d\'autres échos, et n\'octroie aucune Dévotion pendant l\'Ascension.',
    'pal_r20_perpetual_sun':
      'Consommer votre dernière charge d\'Ascension inflige 150 points de dégâts Sacrés dans un rayon de 10 m, soigne les alliés dans un rayon de 20 m de 150, puis double la génération de Dévotion des capacités pendant 5 s. L\'expiration ne le déclenche pas.',
    'pal_r5_divine_steed':
      'Gagnez 0,75% de vitesse de déplacement par Dévotion, jusqu\'à 15% à 20. Activer l\'Ascension dépense votre Dévotion et octroie 30% de vitesse de déplacement pendant 5 s.',
    'pal_r5_radiant_stride':
      'Le Marteau de grâce octroie 30% de vitesse de déplacement pendant 4 s lorsqu\'il inflige des dégâts.',
    'pal_r8_recurring_grace':
      'La surguérison du Marteau de grâce devient un bouclier d\'absorption pendant 10 s, jusqu\'à 10% de vos points de vie maximum.',
    'pri_r11_vampiric_embrace':
      'Un ennemi qui consomme entièrement le Psaume de protection est immobilisé pendant 2 s, une fois par ennemi toutes les 12 s.',
    'pri_r14_pain_and_suffering':
      'Les soins par les dégâts de la Doctrine restaurent le Psaume de protection de 20% des soins prodigués, jusqu\'à son absorption d\'origine. La Bénison transforme la surguérison du Soin du chœur en une absorption de 10 s plafonnée à 10% des points de vie maximum. Chaque écho de l\'Effigie des Vêpres prolonge la Complainte de décrépitude de 1 s, jusqu\'à 6 s par cible.',
    'pri_r20_incarnate_spirit':
      'Un Psaume de protection entièrement consommé soigne sa cible de 40% de l\'absorption d\'origine. Les soins de la Veille de la Bénison soignent aussi jusqu\'à 3 membres du groupe dans un rayon de 15 m de 40%. À 5 cumuls, le Démon de dîme des Vêpres inflige 50% de dégâts en plus et dure 50% plus longtemps.',
    'pri_r20_second_verse':
      'Après 2 s, répète 40% des soins de Miséricorde purifiante de la Doctrine, des soins de groupe de la Bénison, ou des dégâts d\'écho de l\'Effigie des Vêpres. La répétition ne peut pas se déclencher elle-même.',
    'pri_r5_improved_renew':
      'Psaume de protection octroie à sa cible 40% de vitesse de déplacement pendant 3 s.',
    'pri_r5_searing_light':
      'Pas du voile retire les immobilisations et les ralentissements, puis octroie 50% de vitesse de déplacement pendant 3 s.',
    'pri_r5_twisted_faith':
      'Pas du voile permet au Prêtre d\'incanter en mouvement pendant 4 s.',
    'rog_r11_cheap_trick':
      'Coup au ventre ne requiert plus le Voile du crépuscule.',
    'rog_r14_dusk_economy':
      'Les capacités coûtent 50% d\'énergie en moins pendant le Voile du crépuscule ou lorsque vous êtes enveloppé par le voile d\'ombre, et pendant 6 s après avoir quitté le Voile du crépuscule.',
    'rog_r20_kill_chain':
      'Les coups fatals rafraîchissent Pas de fumée et octroient 5 points de combo.',
    'rog_r20_second_shadow':
      'Sommeil éternel lancé à 5 points de combo frappe à nouveau depuis les ombres pour 75% de ses dégâts.',
    'sha_r14_chain_lightning':
      'Après avoir dépensé 120 mana, votre prochaine action de Chaman qui coûte du mana coûte 40 de moins. Cet état prêt n\'expire pas rapidement.',
    'sha_r14_improved_flame_shock':
      'Pyrebrand octroie 1 charge de Tonnerre supplémentaire tous les 3 Éclairs d\'arc. Les échos du Cœur-de-bourrasque infligent 25% de dégâts en plus, Stonebound gagne 5% de réduction des dégâts, et la Source-de-vie dépose 20% de Courant réparateur en plus.',
    'sha_r14_weapon_fury':
      'Un Éclair d\'arc, une Frappe ancestrale ou des Eaux réparatrices réussis restaurent 1 charge de Garde de tonnerre et 10 mana, une fois toutes les 6 s.',
    'sha_r17_elemental_warding':
      'Activer la Garde de tonnerre octroie 40% de réduction des dégâts pendant 6 s. Recharge interne de 120 s.',
    'sha_r17_improved_ghost_wolf':
      'Une fois prêt, quitter le Loup d\'ombre permet d\'incanter en mouvement pendant 8 s. Recharge interne de 90 s.',
    'sha_r20_bloodlust':
      'Après que la Secousse tellurique ou le Tremblement de terre consomme tout le Tonnerre, conservez 2 Tonnerre. Après qu\'un sort consomme le Présage de tempête, conservez 1 cran de la Cadence de l\'esprit guerrier. Après que la Reprise en cascade consomme le Courant réparateur, restaurez 25% du montant consommé.',
    'sha_r20_elemental_fury':
      'Après que la Secousse tellurique ou le Tremblement de terre consomme tout le Tonnerre, répète 40% de ses dégâts après 1 s. Un sort qui consomme le Présage de tempête se répète à 40% de puissance. Les soins du Courant réparateur consommé se répètent à 40% de puissance après 2 s. Ces répétitions ne peuvent déclencher aucun autre effet.',
    'sha_r20_tidal_waves':
      'Après que la Secousse tellurique ou le Tremblement de terre consomme tout le Tonnerre, Pyrebrand rend le prochain Éclair d\'arc instantané. Le dernier écho du Cœur-de-bourrasque inflige 50% de dégâts à 2 ennemis au plus dans un rayon de 8 m. Un sort de Stonebound qui consomme le Présage de tempête octroie une absorption égale à 8% de vos points de vie maximum. Avec la Source-de-vie active, l\'Appel des marées ajoute aussi 50% de son soin complet à l\'allié le plus blessé dans un rayon de 10 m.',
    'sha_r5_imbue_mastery':
      'Après avoir utilisé une Secousse, le prochain Éclair d\'arc ou Eaux réparatrices commencé dans les 8 s peut être incanté en mouvement.',
    'sha_r5_improved_lightning_shield':
      'Entrer en Loup d\'ombre octroie 60% de vitesse de déplacement pendant 3 s, une fois toutes les 20 s.',
    'sha_r8_frost_bind':
      'Les représailles de la Garde de tonnerre octroient 10% de réduction des dégâts pendant 3 s.',
    'wlk_r11_demon_armor':
      'La première fois que chaque membre du groupe touche votre Puits d\'âmes, il le protège d\'un bouclier égal à 15% de ses points de vie maximum pendant 30 s. Chaque joueur ne peut obtenir ce bouclier qu\'une fois par Puits d\'âmes.',
  },
  fr_CA: {
    mag_r5_blink_cast:
      "Vous pouvez utiliser Pas scintillant au milieu d'une incantation sans l'interrompre.",
    mag_r8_temporal_rift:
      "Lancer votre barrière personnelle dissipe les effets d'immobilisation qui vous affectent.",
    mag_r17_convergence:
      'Alterner un sort de Feu et un sort de Givre déclenche une poussée de puissance de 8 s, une fois toutes les 30 s.',
    mag_r20_overflowing_power:
      "Dépenser du mana réduit le temps de recharge de vos défensives : 2 s par dixième de votre mana maximum dépensé, jusqu'à 10 s toutes les 30 s.",
    dru_r20_improved_hurricane:
      'En Forme de sélénien, vous et les membres de votre groupe dans un rayon de 30 m gagnez 3 % de chances de coup critique avec les sorts.',
    war_row_second_wind:
      'Lorsque vos points de vie sont inférieurs à 35 %, vous régénérez 1,5 % de vos points de vie par seconde.',
    war_row_anger_management:
      'Vos attaques automatiques génèrent 10 % de rage en plus et vos techniques 5 % de plus.',
    war_row_blood_offering:
      'Vos postures gagnent des effets supplémentaires. Posture de combat : les coups critiques de vos techniques infligent 15 % de dégâts supplémentaires. Posture berserker : vos attaques automatiques sont 5 % plus rapides. Posture de garde : un coup qui vous retirerait au moins 20 % de votre maximum de points de vie inflige 15 % de dégâts en moins.',
    war_row_battle_rhythm: 'Chaque troisième technique utilisée génère 20 % de rage en plus.',
    war_row_colossal_might:
      "Chaque point de rage dépensé réduit de 0,1 s le temps de recharge de vos grandes capacités offensives, jusqu'à 10 s toutes les 30 s.",
    'dru_r14_empowered_touch':
      'Surfloraison replante une Floraison sauvage fraîche sur chaque allié dont elle a récolté les soins.',
    'dru_r14_moonfury':
      'Déferlante lunaire et Sillage solaire restaurent chacun aussi 15% de votre mana maximum.',
    'dru_r14_savage_fury':
      'Chaque pulsation de vos saignements d\'Écorcher et de Lacération ajoute aussi 1 Sang ancien.',
    'dru_r20_berserk':
      'Déferlante lunaire, Sillage solaire, Moisson rouge, Brise-moelle et Surfloraison sont 25% plus puissants.',
    'dru_r20_tranquility':
      'Chaque point de Marée lunaire, de Sang ancien ou de Verdoyance que vous gagnez restaure 2% de votre mana maximum, 5 énergie ou 3 rage, selon votre forme actuelle.',
    'dru_r5_ferocity':
      'Changer de forme confère 60% de vitesse de déplacement pendant 3 s, au plus une fois toutes les 20 s.',
    'dru_r5_improved_wrath':
      'Changer de forme retire les racines et ralentissements dissipables.',
    'hun_r11_binding_payload':
      'Piège Mâchegivre enracine tous les ennemis dans sa zone de déclenchement pendant 3 s, puis les ralentit de 40% pendant 4 s.',
    'hun_r11_crippling_pursuit':
      'Tir déstabilisant ou Taillade entravante enracine une cible déjà ralentie pendant 2 s. Recharge de 12 s par cible.',
    'hun_r14_efficient_rhythm':
      'Après avoir dépensé 75 Concentration, votre prochain Ordre de meute, Tir mesuré ou Frappe éviscérante accorde 20 Concentration supplémentaire.',
    'hun_r14_guise_mastery':
      'Pendant 6 s, Aspect du busard augmente la génération de Concentration de 50%, Aspect de la martre réduit les dégâts directs de 25%, et Aspect du coursier confère 50% de vitesse de déplacement, ou 60% avec Coursier endurant. Recharge partagée de 20 s.',
    'hun_r17_apex_instinct':
      'Courroux bestial, Concentration glaciale ou Assaut de la piste sanglante restaure 40 Concentration. Vos 3 prochaines techniques consommant de la Concentration coûtent 50% de moins et infligent 20% de dégâts en plus. Ces charges expirent 4 s après la fin de la recharge déclenchante.',
    'hun_r17_pack_rally':
      'Aspect du coursier peut déclencher Ralliement de meute. Vous, votre compagnon, et les alliés du groupe ou du raid dans un rayon de 30 m gagnent 30% de vitesse de déplacement et 10% de vitesse d\'attaque, d\'incantation et de canalisation pendant 10 s. Recharge de 90 s.',
    'hun_r17_shell_and_fang':
      'Peau de carapace autorise les attaques et les ordres au familier, mais sa réduction des dégâts tombe à 40%.',
    'hun_r20_chain_reaction':
      'Piège Mâchegivre marque les ennemis dans un rayon de 4 m pendant 8 s. Vos 3 prochaines techniques consommant de la Concentration font écho pour 40% de dégâts entre les ennemis marqués.',
    'hun_r20_fang_chorus':
      'Chaque technique consommant de la Concentration commande un écho de familier à 50% de puissance. Tous les 3 échos deviennent un coup en zone de 4 m.',
    'hun_r20_overdraw':
      'Tous les 3 Tir funeste, Tir tendu ou Contre-croc infligent 35% de dégâts en plus à leur cible et 50% de ces dégâts à un maximum de 2 ennemis dans un rayon de 5 m.',
    'hun_r5_enduring_courser':
      'Aspect du coursier confère 60% de vitesse de déplacement pendant 3 s lorsqu\'il est activé. Recharge interne de 20 s.',
    'hun_r5_predators_pace':
      'Un Ordre de meute, un Tir mesuré ou une Frappe éviscérante réussis confèrent 20% de vitesse de déplacement pendant 3 s. Recharge interne de 8 s.',
    'hun_r8_receding_shell':
      'Relancez Peau de carapace pour y mettre fin plus tôt et récupérer 50% de sa durée inutilisée, jusqu\'à 45 s.',
    'hun_r8_shared_recovery':
      'Cœur sauvage soigne aussi votre familier de 30% et vous accorde à tous deux 20% de réduction des dégâts pendant 4 s.',
    'pal_r14_divine_purpose':
      'Les capacités renforcées par l\'Ascension ont 20% de chances de ne pas consommer de charge.',
    'pal_r14_sacred_reserve':
      'Quand Ascension divine se termine, regagnez 5 Dévotion.',
    'pal_r14_zeal':
      'Une capacité sur trois qui génère effectivement de la Dévotion accorde 1 Dévotion supplémentaire.',
    'pal_r17_extended_dawn':
      'Ascension divine renforce 2 capacités supplémentaires.',
    'pal_r20_dawn_echo':
      'Une capacité directe sur trois qui génère effectivement de la Dévotion répète ses dégâts ou soins directs principaux à 40% sur la même cible. Un écho effectif accorde 1 Dévotion. L\'écho ne peut pas être critique ni déclencher d\'autres échos, et n\'accorde aucune Dévotion pendant Ascension divine.',
    'pal_r20_perpetual_sun':
      'Consommer votre dernière charge d\'Ascension inflige 150 points de dégâts Sacrés dans un rayon de 10 m, soigne les alliés dans un rayon de 20 m de 150, puis double la génération de Dévotion des capacités pendant 5 s. L\'expiration ne le déclenche pas.',
    'pal_r5_divine_steed':
      'Gagnez 0,75% de vitesse de déplacement par Dévotion, jusqu\'à 15% à 20. Activer Ascension divine dépense votre Dévotion et confère 30% de vitesse de déplacement pendant 5 s.',
    'pal_r5_radiant_stride':
      'Marteau de grâce confère 30% de vitesse de déplacement pendant 4 s lorsqu\'il inflige des dégâts.',
    'pal_r8_recurring_grace':
      'La surguérison de Marteau de grâce devient un bouclier d\'absorption pendant 10 s, plafonné à 10% de vos points de vie maximum.',
    'pri_r11_vampiric_embrace':
      'Un ennemi qui consomme entièrement Psaume de protection est enraciné pendant 2 s, une fois par ennemi toutes les 12 s.',
    'pri_r14_pain_and_suffering':
      'Les soins de dégâts de Doctrine restaurent Psaume de protection de 20% des soins prodigués, jusqu\'à son absorption d\'origine. Bénison transforme la surguérison de Soin du chœur en une absorption de 10 s plafonnée à 10% des points de vie maximum. Chaque écho d\'Effigie de Vêpres prolonge Chant funèbre de pourriture de 1 s, jusqu\'à 6 s par cible.',
    'pri_r20_incarnate_spirit':
      'Un Psaume de protection entièrement consommé soigne sa cible de 40% de l\'absorption d\'origine. Les soins de la Veille séraphique de Bénison guérissent aussi jusqu\'à 3 membres du groupe dans un rayon de 15 m de 40%. Un Démon de dîme de Vêpres à 5 cumuls inflige 50% de dégâts en plus et dure 50% plus longtemps.',
    'pri_r20_second_verse':
      'Après 2 s, répète 40% des soins de Miséricorde purifiante de Doctrine, des soins de groupe de Bénison, ou des dégâts d\'écho d\'Effigie de Vêpres. La répétition ne peut pas se déclencher elle-même.',
    'pri_r5_improved_renew':
      'Psaume de protection confère à sa cible 40% de vitesse de déplacement pendant 3 s.',
    'pri_r5_searing_light':
      'Pas du voile retire les racines et ralentissements, puis confère 50% de vitesse de déplacement pendant 3 s.',
    'pri_r5_twisted_faith':
      'Pas du voile permet au prêtre de lancer des sorts en mouvement pendant 4 s.',
    'rog_r11_cheap_trick':
      'Coup au ventre ne nécessite plus le Voile du crépuscule.',
    'rog_r14_dusk_economy':
      'Les techniques coûtent 50% d\'énergie en moins tant que vous êtes dans le Voile du crépuscule ou enveloppé d\'ombre par le voile, et pendant 6 s après avoir quitté le Voile du crépuscule.',
    'rog_r20_kill_chain':
      'Les coups fatals rafraîchissent Pas de fumée et confèrent 5 points de combo.',
    'rog_r20_second_shadow':
      'Sommeil éternel lancé à 5 points de combo frappe de nouveau depuis les ombres pour 75% de ses dégâts.',
    'sha_r14_chain_lightning':
      'Après avoir dépensé 120 mana, votre prochaine action de chaman qui coûte du mana coûte 40 de moins. Cet état ne comporte pas de délai d\'expiration court.',
    'sha_r14_improved_flame_shock':
      'La Marque de pyre octroie 1 Tonnerre supplémentaire tous les 3 Éclairs d\'arc. Les échos de Cœur-de-bourrasque infligent 25% de dégâts en plus, le Lié-à-la-pierre gagne 5% de réduction des dégâts, et la Source-de-vie dépose 20% de Courant réparateur en plus.',
    'sha_r14_weapon_fury':
      'Un Éclair d\'arc, une Frappe ancestrale ou des Eaux guérisseuses réussis restaurent 1 charge de Garde de tonnerre et 10 mana, une fois toutes les 6 s.',
    'sha_r17_elemental_warding':
      'Activer Garde de tonnerre confère 40% de réduction des dégâts pendant 6 s. Recharge interne de 120 s.',
    'sha_r17_improved_ghost_wolf':
      'Une fois prêt, quitter Shadewolf permet de lancer des sorts en mouvement pendant 8 s. Recharge interne de 90 s.',
    'sha_r20_bloodlust':
      'Quand Secousse tellurique ou Tremblement de terre consomme tout le Tonnerre, conservez 2 Tonnerre. Quand un sort consomme le Présage de tempête, conservez 1 étape de la Cadence de l\'esprit guerrier. Quand Salve de guérison consomme le Courant réparateur, restaurez 25% du montant consommé.',
    'sha_r20_elemental_fury':
      'Quand Secousse tellurique ou Tremblement de terre consomme tout le Tonnerre, répète 40% de ses dégâts après 1 s. Un sort qui consomme le Présage de tempête se répète à 40% de puissance. Les soins provenant du Courant réparateur consommé se répètent à 40% de puissance après 2 s. Ces répétitions ne peuvent déclencher aucun autre effet.',
    'sha_r20_tidal_waves':
      'Quand Secousse tellurique ou Tremblement de terre consomme tout le Tonnerre, la Marque de pyre rend instantané le prochain Éclair d\'arc. Le dernier écho de Cœur-de-bourrasque inflige 50% de dégâts à un maximum de 2 ennemis dans un rayon de 8 m. Un sort du Lié-à-la-pierre qui consomme le Présage de tempête confère une absorption égale à 8% de vos points de vie maximum. Avec la Source-de-vie active, Appel des marées ajoute aussi 50% de son soin complet à l\'allié le plus blessé dans un rayon de 10 m.',
    'sha_r5_imbue_mastery':
      'Après avoir utilisé une Secousse, le prochain Éclair d\'arc ou Eaux guérisseuses entamé dans les 8 s peut être lancé en mouvement.',
    'sha_r5_improved_lightning_shield':
      'Entrer en Shadewolf confère 60% de vitesse de déplacement pendant 3 s, une fois toutes les 20 s.',
    'sha_r8_frost_bind':
      'Les représailles de Garde de tonnerre confèrent 10% de réduction des dégâts pendant 3 s.',
    'wlk_r11_demon_armor':
      'La première fois que chaque membre du groupe touche votre Puits d\'âmes, il le protège d\'un bouclier égal à 15% de ses points de vie maximum pendant 30 s. Chaque joueur ne peut gagner ce bouclier qu\'une fois par Puits d\'âmes.',
  },
  it_IT: {
    mag_r5_blink_cast: 'Puoi usare Passo Baleno nel mezzo di un incantesimo senza interromperlo.',
    mag_r8_temporal_rift:
      'Lanciare la tua barriera personale rimuove gli effetti di immobilizzazione che ti affliggono.',
    mag_r17_convergence:
      "Alternare un incantesimo di Fuoco e uno di Gelo apre un'ondata di potere di 8 secondi, una volta ogni 30 secondi.",
    mag_r20_overflowing_power:
      'Spendere mana riduce il tempo di recupero delle tue difensive: 2 secondi per ogni decimo del tuo mana massimo speso, fino a 10 secondi ogni 30 secondi.',
    dru_r20_improved_hurricane:
      'In Forma di gufo lunare, tu e i membri del tuo gruppo entro 30 m guadagnate il 3% di probabilità di critico con gli incantesimi.',
    war_row_second_wind: 'Sotto il 35% di salute, rigeneri l’1,5% della tua salute ogni secondo.',
    war_row_anger_management:
      'I tuoi attacchi automatici generano il 10% di rabbia in più e le tue abilità il 5% in più.',
    war_row_blood_offering:
      'Le tue posizioni ottengono effetti aggiuntivi. Posizione di Battaglia: i colpi critici delle tue abilità infliggono il 15% di danni in più. Posizione del Berserker: i tuoi attacchi automatici sono più rapidi del 5%. Posizione Guardinga: un colpo che ti sottrarrebbe almeno il 20% della salute massima infligge il 15% di danni in meno.',
    war_row_battle_rhythm: 'Ogni terza abilità usata genera il 20% di rabbia in più.',
    war_row_colossal_might:
      'Ogni punto di rabbia speso riduce di 0,1 secondi il tempo di recupero delle tue grandi abilità offensive, fino a 10 secondi ogni 30 secondi.',
    'dru_r14_empowered_touch':
      'Sovrafioritura ripianta una Fioritura Selvaggia fresca su ogni alleato la cui cura ha raccolto.',
    'dru_r14_moonfury':
      'Ondata Lunare e Scia Solare ripristinano ciascuna anche il 15% del tuo mana massimo.',
    'dru_r14_savage_fury':
      'Ogni tick dei tuoi sanguinamenti di Scarnificare e Squartare aggiunge anche 1 Sangue Antico.',
    'dru_r20_berserk':
      'Ondata Lunare, Scia Solare, Mietitura Rossa, Spezzamidollo e Sovrafioritura sono il 25% più potenti.',
    'dru_r20_tranquility':
      'Ogni 1 punto di Marea Lunare, Sangue Antico o Verzura che guadagni ripristina il 2% del tuo mana massimo, 5 energia o 3 rabbia, in base alla tua forma attuale.',
    'dru_r5_ferocity':
      'Cambiare forma concede il 60% di velocità di movimento per 3 sec, al massimo una volta ogni 20 sec.',
    'dru_r5_improved_wrath':
      'Cambiare forma rimuove i radicamenti frangibili e i rallentamenti.',
    'hun_r11_binding_payload':
      'Trappola Fauci di Gelo radica ogni nemico nella sua area di attivazione per 3 sec, poi li rallenta del 40% per 4 sec.',
    'hun_r11_crippling_pursuit':
      'Tiro Scuotente o Fendente Immobilizzante radica per 2 sec un bersaglio già rallentato. Tempo di recupero di 12 sec per bersaglio.',
    'hun_r14_efficient_rhythm':
      'Dopo aver speso 75 Concentrazione, il tuo prossimo Comando del Branco, Tiro Misurato o Colpo Sventratore concede 20 Concentrazione aggiuntiva.',
    'hun_r14_guise_mastery':
      'Per 6 sec, Sembianze dell\'Albanella aumenta la generazione di Concentrazione del 50%, Sembianze della Martora riduce i danni diretti del 25%, e Sembianze del Corsiero concede il 50% di velocità di movimento, o il 60% con Corsiero Instancabile. Tempo di recupero condiviso di 20 sec.',
    'hun_r17_apex_instinct':
      'Ira Bestiale, Concentrazione Gelida o Assalto della Scia di Sangue ripristinano 40 Concentrazione. Le tue prossime 3 abilità che consumano Concentrazione costano il 50% in meno e infliggono il 20% di danni in più. Questi usi scadono 4 sec dopo la fine del tempo di recupero che li ha attivati.',
    'hun_r17_pack_rally':
      'Sembianze del Corsiero può attivare Adunata del Branco. Tu, il tuo compagno e gli alleati del gruppo o dell\'incursione entro 30 metri ottenete il 30% di velocità di movimento e il 10% di velocità di attacco, lancio e canalizzazione per 10 sec. Tempo di recupero di 90 sec.',
    'hun_r17_shell_and_fang':
      'Pelle di Corazza consente di attaccare e impartire comandi al famiglio, ma la sua riduzione danni scende al 40%.',
    'hun_r20_chain_reaction':
      'Trappola Fauci di Gelo marchia i nemici entro 4 metri per 8 sec. Le tue prossime 3 abilità che consumano Concentrazione fanno risuonare il 40% dei danni tra i nemici marchiati.',
    'hun_r20_fang_chorus':
      'Ogni abilità che consuma Concentrazione comanda un\'eco del famiglio al 50% di potenza. Ogni 3° eco diventa un colpo ad area di 4 metri.',
    'hun_r20_overdraw':
      'Ogni 3° Tiro Nefasto, Tiro Teso o Controzanna infligge il 35% di danni in più al proprio bersaglio e il 50% di quei danni fino a 2 nemici entro 5 metri.',
    'hun_r5_enduring_courser':
      'Sembianze del Corsiero concede il 60% di velocità di movimento per 3 sec quando viene attivata. Tempo di recupero interno di 20 sec.',
    'hun_r5_predators_pace':
      'Un Comando del Branco, Tiro Misurato o Colpo Sventratore andato a segno concede il 20% di velocità di movimento per 3 sec. Tempo di recupero interno di 8 sec.',
    'hun_r8_receding_shell':
      'Rilancia Pelle di Corazza per terminarla in anticipo e recuperare il 50% della sua durata non utilizzata, fino a 45 sec.',
    'hun_r8_shared_recovery':
      'Cuore Selvaggio cura anche il tuo famiglio del 30% e concede a entrambi il 20% di riduzione danni per 4 sec.',
    'pal_r14_divine_purpose':
      'Le abilità potenziate dall\'Ascensione hanno il 20% di probabilità di non consumare una carica.',
    'pal_r14_sacred_reserve':
      'Quando Ascensione Divina termina, recuperi 5 Devozione.',
    'pal_r14_zeal':
      'Ogni terza abilità che genera effettivamente Devozione concede 1 Devozione extra.',
    'pal_r17_extended_dawn':
      'Ascensione Divina potenzia 2 abilità aggiuntive.',
    'pal_r20_dawn_echo':
      'Ogni terza abilità diretta che genera effettivamente Devozione ripete i suoi danni o cure diretti primari al 40% sullo stesso bersaglio. Un eco efficace concede 1 Devozione. L\'eco non può infliggere colpi critici né attivare altri echi, e non concede Devozione durante Ascensione Divina.',
    'pal_r20_perpetual_sun':
      'Consumare la tua ultima carica di Ascensione infligge 150 danni Sacri entro 10 m, cura gli alleati entro 20 m di 150, poi raddoppia la generazione di Devozione delle abilità per 5 sec. La scadenza non lo attiva.',
    'pal_r5_divine_steed':
      'Guadagni lo 0,75% di velocità di movimento per ogni Devozione, fino al 15% a 20. Attivare Ascensione Divina spende la tua Devozione e concede il 30% di velocità di movimento per 5 sec.',
    'pal_r5_radiant_stride':
      'Martello della Grazia concede il 30% di velocità di movimento per 4 sec quando infligge danni.',
    'pal_r8_recurring_grace':
      'Le cure in eccesso di Martello della Grazia diventano uno scudo di assorbimento per 10 sec, limitato al 10% della tua salute massima.',
    'pri_r11_vampiric_embrace':
      'Un nemico che consuma interamente il Salmo di Protezione viene radicato per 2 sec, una volta per nemico ogni 12 sec.',
    'pri_r14_pain_and_suffering':
      'Le cure generate dai danni di Dottrina ripristinano il Salmo di Protezione del 20% della cura inflitta, fino al suo assorbimento originale. Benedizione trasforma le cure in eccesso di Cura del Coro in un assorbimento di 10 sec, limitato al 10% della salute massima. Ogni eco dell\'Effigie di Vespri estende il Canto Funebre della Putrefazione di 1 sec, fino a 6 sec per bersaglio.',
    'pri_r20_incarnate_spirit':
      'Un Salmo di Protezione consumato interamente cura il suo bersaglio del 40% dell\'assorbimento originale. La cura della Veglia di Benedizione cura anche fino a 3 membri del gruppo entro 15 metri del 40%. Con 5 accumuli di Vespri, il Demone della Decima infligge il 50% di danni in più e dura il 50% più a lungo.',
    'pri_r20_second_verse':
      'Dopo 2 sec, ripeti il 40% delle cure di Misericordia Purificatrice da Dottrina, delle cure di gruppo da Benedizione, o dei danni dell\'eco dell\'Effigie da Vespri. La ripetizione non può attivare se stessa.',
    'pri_r5_improved_renew':
      'Salmo di Protezione concede al suo bersaglio il 40% di velocità di movimento per 3 sec.',
    'pri_r5_searing_light':
      'Passo del Velo rimuove radicamenti e rallentamenti, poi concede il 50% di velocità di movimento per 3 sec.',
    'pri_r5_twisted_faith':
      'Passo del Velo permette al Sacerdote di lanciare incantesimi in movimento per 4 sec.',
    'rog_r11_cheap_trick':
      'Pugno allo Stomaco non richiede più il Velo Crepuscolare.',
    'rog_r14_dusk_economy':
      'Le abilità costano il 50% di energia in meno mentre sei nel Velo Crepuscolare o avvolto nell\'ombra dal Velo d\'Ombra, e per 6 sec dopo aver lasciato il Velo Crepuscolare.',
    'rog_r20_kill_chain':
      'I colpi mortali rinnovano Passo di Fumo e conferiscono 5 punti combo.',
    'rog_r20_second_shadow':
      'Sonno Eterno lanciato con 5 punti combo colpisce di nuovo dalle ombre per il 75% dei suoi danni.',
    'sha_r14_chain_lightning':
      'Dopo aver speso 120 Mana, la tua prossima azione dello Sciamano che costa Mana costa 40 in meno. Lo stato di prontezza non ha una breve scadenza.',
    'sha_r14_improved_flame_shock':
      'Marchio Pirico concede 1 carica di Tuono extra ogni 3° Dardo Folgorante. Gli echi di Cuore di Bufera infliggono il 25% di danni in più, Vincolo di Pietra ottiene il 5% di riduzione danni, e Fonte di Vita deposita il 20% di Corrente Risanatrice in più.',
    'sha_r14_weapon_fury':
      'Un Dardo Folgorante, Colpo Ancestrale o Acque Risananti andato a segno ripristina 1 carica di Barriera di Tuono e 10 Mana, una volta ogni 6 sec.',
    'sha_r17_elemental_warding':
      'Attivare Barriera di Tuono concede il 40% di riduzione danni per 6 sec. Tempo di recupero interno di 120 sec.',
    'sha_r17_improved_ghost_wolf':
      'Quando pronto, uscire da Lupo d\'Ombra permette di lanciare incantesimi in movimento per 8 sec. Tempo di recupero interno di 90 sec.',
    'sha_r20_bloodlust':
      'Dopo che Scossa Tellurica o Terremoto consuma tutto il Tuono, trattieni 2 Tuono. Dopo che un incantesimo consuma l\'Impulso di Tempesta, trattieni 1 tacca della Cadenza dello Spirito Guerriero. Dopo che Guarigione a Catena consuma la Corrente Risanatrice, ripristina il 25% della quantità consumata.',
    'sha_r20_elemental_fury':
      'Dopo che Scossa Tellurica o Terremoto consuma tutto il Tuono, ripeti il 40% dei suoi danni dopo 1 sec. Un incantesimo che consuma l\'Impulso di Tempesta si ripete al 40% di potenza. Le cure dalla Corrente Risanatrice consumata si ripetono al 40% di potenza dopo 2 sec. Queste ripetizioni non possono attivare altri effetti.',
    'sha_r20_tidal_waves':
      'Dopo che Scossa Tellurica o Terremoto consuma tutto il Tuono, Marchio Pirico rende istantaneo il prossimo Dardo Folgorante. L\'eco finale di Cuore di Bufera infligge il 50% dei danni fino a 2 nemici entro 8 metri. Un incantesimo di Vincolo di Pietra che consuma l\'Impulso di Tempesta concede un assorbimento pari all\'8% della tua salute massima. Con Fonte di Vita attiva, Richiamo della Marea aggiunge anche il 50% della sua cura piena all\'alleato più ferito entro 10 metri.',
    'sha_r5_imbue_mastery':
      'Dopo aver usato una Scossa, il prossimo Dardo Folgorante o Acque Risananti iniziato entro 8 sec può essere lanciato in movimento.',
    'sha_r5_improved_lightning_shield':
      'Entrare in Lupo d\'Ombra concede il 60% di velocità di movimento per 3 sec, una volta ogni 20 sec.',
    'sha_r8_frost_bind':
      'La rappresaglia di Barriera di Tuono concede il 10% di riduzione danni per 3 sec.',
    'wlk_r11_demon_armor':
      'La prima volta che ogni membro del gruppo tocca il tuo Soulwell, li protegge con uno scudo pari al 15% della loro salute massima per 30 sec. Ogni giocatore può ottenere questo scudo una sola volta per Soulwell.',
  },
  de_DE: {
    mag_r5_blink_cast:
      'Du kannst Flimmerschritt mitten in einem Zaubervorgang einsetzen, ohne ihn zu unterbrechen.',
    mag_r8_temporal_rift:
      'Das Wirken deiner persönlichen Barriere entfernt Verwurzelungseffekte von dir.',
    mag_r17_convergence:
      'Wenn du abwechselnd einen Feuer- und einen Frost-Zauber wirkst, entfachst du einmal alle 30 Sek. einen 8 Sek. anhaltenden Machtschub.',
    mag_r20_overflowing_power:
      'Manaverbrauch verkürzt die Abklingzeit deiner Defensivfähigkeiten: 2 Sek. pro einem Zehntel deines verbrauchten maximalen Manas, maximal 10 Sek. alle 30 Sek.',
    dru_r20_improved_hurricane:
      'Solange du dich in Moonkingestalt befindest, erhalten du und deine Gruppenmitglieder innerhalb von 30 m eine um 3 % erhöhte kritische Zaubertrefferchance.',
    war_row_second_wind:
      'Unter 35 % Gesundheit regenerierst du pro Sekunde 1,5 % deiner Gesundheit.',
    war_row_anger_management:
      'Deine automatischen Angriffe erzeugen 10 % mehr Wut und deine Fähigkeiten 5 % mehr.',
    war_row_blood_offering:
      'Deine Haltungen erhalten zusätzliche Effekte. Kampfhaltung: Kritische Treffer deiner Fähigkeiten verursachen 15 % mehr Schaden. Berserkerhaltung: Deine automatischen Angriffe sind 5 % schneller. Wehrhafte Haltung: Ein Treffer, der dir mindestens 20 % deiner maximalen Gesundheit nehmen würde, verursacht 15 % weniger Schaden.',
    war_row_battle_rhythm: 'Jede dritte eingesetzte Fähigkeit erzeugt 20 % mehr Wut.',
    war_row_colossal_might:
      'Jeder verbrauchte Wutpunkt verkürzt die Abklingzeit deiner wichtigsten Angriffsfähigkeiten um 0,1 Sek., maximal 10 Sek. alle 30 Sek.',
    'dru_r14_empowered_touch':
      'Überblüte pflanzt auf jedem Verbündeten, dessen Heilung sie geerntet hat, eine frische Wildblüte.',
    'dru_r14_moonfury':
      'Mondwoge und Sonnenspur stellen jeweils außerdem 15% Eures maximalen Manas wieder her.',
    'dru_r14_savage_fury':
      'Jeder Tick Eurer Schinden- und Zerfetzen-Blutungen fügt außerdem 1 Altes Blut hinzu.',
    'dru_r20_berserk':
      'Mondwoge, Sonnenspur, Rote Ernte, Markbrecher und Überblüte sind 25% stärker.',
    'dru_r20_tranquility':
      'Jede 1 Mondflut, Altes Blut oder Grünkraft, die Ihr gewinnt, stellt je nach aktueller Gestalt 2% Eures maximalen Manas, 5 Energie oder 3 Wut wieder her.',
    'dru_r5_ferocity':
      'Gestaltwandel gewährt 3 Sek. lang 60% Bewegungstempo, höchstens einmal alle 20 Sek.',
    'dru_r5_improved_wrath':
      'Gestaltwandel entfernt brechbare Wurzeleffekte und Verlangsamungen.',
    'hun_r11_binding_payload':
      'Frostkieferfalle verwurzelt jeden Gegner in ihrem Auslösebereich 3 Sek. lang und verlangsamt sie anschließend 4 Sek. lang um 40%.',
    'hun_r11_crippling_pursuit':
      'Rasselnder Schuss oder Fesselnder Hieb verwurzelt ein bereits verlangsamtes Ziel 2 Sek. lang. 12 Sek. Abklingzeit pro Ziel.',
    'hun_r14_efficient_rhythm':
      'Nachdem Ihr 75 Fokus ausgegeben habt, gewährt Euer nächster Rudelbefehl, Bedachter Schuss oder Ausweidender Hieb 20 zusätzlichen Fokus.',
    'hun_r14_guise_mastery':
      '6 Sek. lang erhöht die Gestalt der Weihe die Fokuserzeugung um 50%, verringert die Gestalt des Marders direkten Schaden um 25%, und die Gestalt des Renners gewährt 50% Bewegungstempo, oder 60% mit Ausdauerndem Renner. 20 Sek. gemeinsame Abklingzeit.',
    'hun_r17_apex_instinct':
      'Zorn des Wildtiers, Kalter Fokus oder Blutspurangriff stellt 40 Fokus wieder her. Eure nächsten 3 Fokusverbraucher kosten 50% weniger und verursachen 20% mehr Schaden. Diese Anwendungen laufen 4 Sek. nach Ende der auslösenden Abklingzeit ab.',
    'hun_r17_pack_rally':
      'Gestalt des Renners kann Rudelsammlung auslösen. Ihr, Euer Begleiter sowie Gruppen- oder Schlachtzugsverbündete im Umkreis von 30 Metern erhalten 10 Sek. lang 30% Bewegungstempo und 10% Angriffs-, Zauber- und Kanalisierungstempo. 90 Sek. Abklingzeit.',
    'hun_r17_shell_and_fang':
      'Panzerhaut erlaubt Angriffe und Begleiterbefehle, doch ihre Schadensreduzierung sinkt auf 40%.',
    'hun_r20_chain_reaction':
      'Frostkieferfalle markiert Gegner im Umkreis von 4 Metern 8 Sek. lang. Eure nächsten 3 Fokusverbraucher lassen 40% Schaden zwischen markierten Gegnern widerhallen.',
    'hun_r20_fang_chorus':
      'Jeder Fokusverbraucher befiehlt ein Begleiterecho mit 50% Stärke. Jedes 3. Echo wird zu einem Schlag im Umkreis von 4 Metern.',
    'hun_r20_overdraw':
      'Jeder 3. Finstere Schuss, Langer Zug oder Gegenbiss verursacht 35% mehr Schaden am Ziel und 50% dieses Schadens an bis zu 2 Gegnern im Umkreis von 5 Metern.',
    'hun_r5_enduring_courser':
      'Gestalt des Renners gewährt beim Aktivieren 3 Sek. lang 60% Bewegungstempo. 20 Sek. interne Abklingzeit.',
    'hun_r5_predators_pace':
      'Ein erfolgreicher Rudelbefehl, Bedachter Schuss oder Ausweidender Hieb gewährt 3 Sek. lang 20% Bewegungstempo. 8 Sek. interne Abklingzeit.',
    'hun_r8_receding_shell':
      'Wirkt Panzerhaut erneut, um sie vorzeitig zu beenden und 50% ihrer ungenutzten Dauer zurückzuerstatten, bis zu 45 Sek.',
    'hun_r8_shared_recovery':
      'Wildherz heilt außerdem Euren Begleiter um 30% und gewährt Euch beiden 4 Sek. lang 20% Schadensreduzierung.',
    'pal_r14_divine_purpose':
      'Vom Aufstieg gestärkte Fähigkeiten haben eine Chance von 20%, keine Aufladung zu verbrauchen.',
    'pal_r14_sacred_reserve':
      'Wenn der Göttliche Aufstieg endet, erhaltet Ihr 5 Hingabe zurück.',
    'pal_r14_zeal':
      'Jede dritte Fähigkeit, die tatsächlich Hingabe erzeugt, gewährt 1 zusätzliche Hingabe.',
    'pal_r17_extended_dawn':
      'Der Göttliche Aufstieg stärkt 2 zusätzliche Fähigkeiten.',
    'pal_r20_dawn_echo':
      'Jede dritte direkte Fähigkeit, die tatsächlich Hingabe erzeugt, wiederholt ihren primären direkten Schaden oder ihre Heilung mit 40% am selben Ziel. Ein wirksames Echo gewährt 1 Hingabe. Das Echo kann nicht kritisch treffen oder weitere Echos auslösen und gewährt während des Göttlichen Aufstiegs keine Hingabe.',
    'pal_r20_perpetual_sun':
      'Das Verbrauchen Eurer letzten Aufstiegsaufladung verursacht 150 Heiligschaden im Umkreis von 10 m, heilt Verbündete im Umkreis von 20 m um 150 und verdoppelt anschließend 5 Sek. lang die Hingabeerzeugung durch Fähigkeiten. Das Auslaufen der Aufladung löst dies nicht aus.',
    'pal_r5_divine_steed':
      'Erhaltet 0,75% Bewegungstempo pro Hingabe, bis zu 15% bei 20. Das Aktivieren des Göttlichen Aufstiegs verbraucht Eure Hingabe und gewährt 5 Sek. lang 30% Bewegungstempo.',
    'pal_r5_radiant_stride':
      'Hammer der Gnade gewährt 4 Sek. lang 30% Bewegungstempo, wenn er Schaden verursacht.',
    'pal_r8_recurring_grace':
      'Überheilung durch den Hammer der Gnade wird zu einem 10 Sek. langen Schild, gedeckelt bei 10% Eurer maximalen Gesundheit.',
    'pri_r11_vampiric_embrace':
      'Ein Gegner, der Psalm der Abschirmung vollständig verbraucht, wird 2 Sek. lang verwurzelt, einmal pro Gegner alle 12 Sek.',
    'pri_r14_pain_and_suffering':
      'Die Schadensheilung der Doktrin stellt Psalm der Abschirmung um 20% der geleisteten Heilung wieder her, bis zu seinem ursprünglichen Absorptionswert. Der Segensspruch verwandelt Überheilung durch Chorheilung in einen 10 Sek. langen Schild, gedeckelt bei 10% der maximalen Gesundheit. Jedes Echo Eures Vesper-Abbilds verlängert das Klagelied des Verfalls um 1 Sek., bis zu 6 Sek. pro Ziel.',
    'pri_r20_incarnate_spirit':
      'Ein vollständig verbrauchter Psalm der Abschirmung heilt sein Ziel um 40% des ursprünglichen Absorptionswerts. Die Heilung der Seraphischen Wacht aus dem Segensspruch heilt außerdem bis zu 3 Gruppenmitglieder im Umkreis von 15 Metern um 40%. Ein Zehntteufel der Vesper mit 5 Stapeln verursacht 50% mehr Schaden und hält 50% länger.',
    'pri_r20_second_verse':
      'Nach 2 Sek. wiederholt sich 40% der Heilung von Läuternder Gnade aus der Doktrin, der Gruppenheilung aus dem Segensspruch, oder des Echoschadens des Abbilds aus der Vesper. Die Wiederholung kann sich nicht selbst erneut auslösen.',
    'pri_r5_improved_renew':
      'Psalm der Abschirmung gewährt seinem Ziel 3 Sek. lang 40% Bewegungstempo.',
    'pri_r5_searing_light':
      'Schleierschritt entfernt Wurzeleffekte und Verlangsamungen und gewährt anschließend 3 Sek. lang 50% Bewegungstempo.',
    'pri_r5_twisted_faith':
      'Schleierschritt erlaubt es dem Priester, 4 Sek. lang während der Bewegung zu wirken.',
    'rog_r11_cheap_trick':
      'Magenhieb erfordert nicht länger Duskveil.',
    'rog_r14_dusk_economy':
      'Fähigkeiten kosten 50% weniger Energie, während Ihr Euch in Duskveil befindet oder vom Schleier in Schatten gehüllt seid, sowie für 6 Sek. nach dem Verlassen von Duskveil.',
    'rog_r20_kill_chain':
      'Tödliche Treffer erneuern Rauchschritt und gewähren 5 Combopunkte.',
    'rog_r20_second_shadow':
      'Grabesschlaf trifft bei 5 Combopunkten erneut aus dem Schatten für 75% seines Schadens.',
    'sha_r14_chain_lightning':
      'Nachdem Ihr 120 Mana ausgegeben habt, kostet Eure nächste Schamanenhandlung, die Mana kostet, 40 weniger. Der Bereitschaftszustand läuft nicht kurzfristig ab.',
    'sha_r14_improved_flame_shock':
      'Das Flammenmal gewährt bei jedem 3. Lichtbogenblitz 1 zusätzlichen Donner. Die Sturmherzechos verursachen 25% mehr Schaden, das Steingebundene erhält 5% Schadensreduzierung, und die Lebensquelle legt 20% mehr Flickströmung ab.',
    'sha_r14_weapon_fury':
      'Ein erfolgreicher Lichtbogenblitz, Ahnenhieb oder Heilende Wasser stellt alle 6 Sek. 1 Aufladung des Donnerschilds und 10 Mana wieder her.',
    'sha_r17_elemental_warding':
      'Das Aktivieren des Donnerschilds gewährt 6 Sek. lang 40% Schadensreduzierung. 120 Sek. interne Abklingzeit.',
    'sha_r17_improved_ghost_wolf':
      'Ist es bereit, erlaubt das Verlassen von Shadewolf 8 Sek. lang das Wirken während der Bewegung. 90 Sek. interne Abklingzeit.',
    'sha_r20_bloodlust':
      'Nachdem Erdstoß oder Erdbeben allen Donner verbraucht hat, behaltet Ihr 2 Donner. Nachdem ein Zauber Sturmzeichen verbraucht hat, behaltet Ihr 1 Stufe der Kriegsgeistkadenz. Nachdem Kettenheilung Flickströmung verbraucht hat, werden 25% der verbrauchten Menge wiederhergestellt.',
    'sha_r20_elemental_fury':
      'Nachdem Erdstoß oder Erdbeben allen Donner verbraucht hat, wiederholt sich nach 1 Sek. 40% seines Schadens. Ein Zauber, der Sturmzeichen verbraucht, wiederholt sich mit 40% Stärke. Heilung aus verbrauchter Flickströmung wiederholt sich nach 2 Sek. mit 40% Stärke. Diese Wiederholungen können keine weiteren Effekte auslösen.',
    'sha_r20_tidal_waves':
      'Nachdem Erdstoß oder Erdbeben allen Donner verbraucht hat, macht das Flammenmal den nächsten Lichtbogenblitz sofort wirkbar. Das letzte Sturmherzecho verursacht 50% Schaden an bis zu 2 Gegnern im Umkreis von 8 Metern. Ein Zauber des Steingebundenen, der Sturmzeichen verbraucht, gewährt einen Schild in Höhe von 8% Eurer maximalen Gesundheit. Bei aktiver Lebensquelle fügt der Gezeitenruf zudem 50% seiner vollen Heilung dem am stärksten verwundeten Verbündeten im Umkreis von 10 Metern hinzu.',
    'sha_r5_imbue_mastery':
      'Nach dem Wirken eines Stoßzaubers kann der nächste, innerhalb von 8 Sek. begonnene Lichtbogenblitz oder Heilende Wasser während der Bewegung gewirkt werden.',
    'sha_r5_improved_lightning_shield':
      'Das Betreten von Shadewolf gewährt 3 Sek. lang 60% Bewegungstempo, einmal alle 20 Sek.',
    'sha_r8_frost_bind':
      'Eine Vergeltung des Donnerschilds gewährt 3 Sek. lang 10% Schadensreduzierung.',
    'wlk_r11_demon_armor':
      'Beim ersten Berühren Eures Soulwell schützt es jedes Gruppenmitglied 30 Sek. lang mit einem Schild von 15% seiner maximalen Gesundheit. Jeder Spieler kann diesen Schild einmal pro Soulwell erhalten.',
  },
  pt_BR: {
    mag_r5_blink_cast: 'Você pode usar Passo Cintilante durante uma conjuração sem interrompê-la.',
    mag_r8_temporal_rift:
      'Conjurar sua barreira pessoal remove efeitos de imobilização que afetam você.',
    mag_r17_convergence:
      'Alternar entre uma magia de Fogo e uma de Gelo abre uma rajada de poder de 8 s, uma vez a cada 30 s.',
    mag_r20_overflowing_power:
      'Gastar mana reduz a recarga das suas defensivas: 2 s por décimo do seu mana máximo gasto, até 10 s a cada 30 s.',
    dru_r20_improved_hurricane:
      'Na Forma Moonkin, você e os membros do seu grupo num raio de 30 m ganham 3% de chance de acerto crítico com magias.',
    war_row_second_wind: 'Abaixo de 35% de vida, você regenera 1,5% da sua vida por segundo.',
    war_row_anger_management:
      'Seus ataques automáticos geram 10% mais raiva e suas habilidades geram 5% mais.',
    war_row_blood_offering:
      'Suas posturas recebem efeitos adicionais. Postura de Batalha: acertos críticos das suas habilidades causam 15% a mais de dano. Postura de Berserker: seus ataques automáticos ficam 5% mais rápidos. Postura de Guarda: um golpe que tiraria pelo menos 20% da sua vida máxima causa 15% a menos de dano.',
    war_row_battle_rhythm: 'Cada terceira habilidade usada gera 20% mais raiva.',
    war_row_colossal_might:
      'Cada ponto de raiva gasto reduz em 0,1 s a recarga das suas principais habilidades ofensivas, até 10 s a cada 30 s.',
    'dru_r14_empowered_touch':
      'Superflorescência replanta um novo Florescer Selvagem em cada aliado cuja cura ela colheu.',
    'dru_r14_moonfury':
      'Onda Lunar e Despertar Solar também restauram 15% da sua mana máxima cada.',
    'dru_r14_savage_fury':
      'Cada tique dos seus sangramentos de Esfolar e Rasgar também adiciona 1 de Sangue Antigo.',
    'dru_r20_berserk':
      'Onda Lunar, Despertar Solar, Colheita Vermelha, Quebra-Medula e Superflorescência ficam 25% mais fortes.',
    'dru_r20_tranquility':
      'Cada 1 de Moontide, Sangue Antigo ou Verdance que você ganha restaura 2% da sua mana máxima, 5 de energia ou 3 de raiva, de acordo com sua forma atual.',
    'dru_r5_ferocity':
      'Mudar de forma concede 60% de velocidade de movimento por 3 s, no máximo uma vez a cada 20 s.',
    'dru_r5_improved_wrath':
      'Mudar de forma remove enraizamentos e reduções de velocidade removíveis.',
    'hun_r11_binding_payload':
      'A Armadilha Presa Gélida enraíza todo inimigo na sua área de ativação por 3 s, depois os lentifica em 40% por 4 s.',
    'hun_r11_crippling_pursuit':
      'Tiro Desnorteante ou Talho Aprisionador enraízam um alvo já lentificado por 2 s. Recarga de 12 s por alvo.',
    'hun_r14_efficient_rhythm':
      'Depois de gastar 75 de Foco, seu próximo Comando da Matilha, Tiro Medido ou Golpe Estripador concede 20 de Foco adicional.',
    'hun_r14_guise_mastery':
      'Por 6 s, a Forma do Gavião aumenta a geração de Foco em 50%, a Forma da Marta reduz o dano direto sofrido em 25%, e a Forma do Corcel concede 50% de velocidade de movimento, ou 60% com Corcel Persistente. Recarga compartilhada de 20 s.',
    'hun_r17_apex_instinct':
      'Ira Bestial, Foco Gélido ou Assalto da Trilha de Sangue restauram 40 de Foco. Suas próximas 3 habilidades que gastam Foco custam 50% menos e causam 20% mais dano. Esses usos expiram 4 s após o fim da recarga que os ativou.',
    'hun_r17_pack_rally':
      'A Forma do Corcel pode acionar a Reunião da Matilha. Você, seu companheiro e aliados de grupo ou raide num raio de 30 m ganham 30% de velocidade de movimento e 10% de velocidade de ataque, lançamento e canalização por 10 s. Recarga de 90 s.',
    'hun_r17_shell_and_fang':
      'Pele de Casco permite ataques e comandos ao mascote, mas sua redução de dano cai para 40%.',
    'hun_r20_chain_reaction':
      'A Armadilha Presa Gélida marca inimigos num raio de 4 m por 8 s. Suas próximas 3 habilidades que gastam Foco ecoam 40% de dano entre os inimigos marcados.',
    'hun_r20_fang_chorus':
      'Cada habilidade que gasta Foco comanda um eco do mascote com 50% de força. A cada 3º eco, ele se torna um golpe em área de 4 m.',
    'hun_r20_overdraw':
      'A cada 3º Tiro Vil, Puxada Longa ou Contra-Presa, a habilidade causa 35% mais dano ao alvo e 50% desse dano a até 2 inimigos num raio de 5 m.',
    'hun_r5_enduring_courser':
      'A Forma do Corcel concede 60% de velocidade de movimento por 3 s quando ativada. Recarga interna de 20 s.',
    'hun_r5_predators_pace':
      'Um Comando da Matilha, Tiro Medido ou Golpe Estripador bem-sucedido concede 20% de velocidade de movimento por 3 s. Recarga interna de 8 s.',
    'hun_r8_receding_shell':
      'Lance novamente Pele de Casco para encerrá-la antes do tempo e recuperar 50% da sua duração não utilizada, até 45 s.',
    'hun_r8_shared_recovery':
      'Coração Selvagem também cura seu mascote em 30% e concede a ambos 20% de redução de dano por 4 s.',
    'pal_r14_divine_purpose':
      'Habilidades fortalecidas pela Ascensão têm 20% de chance de não consumir uma carga.',
    'pal_r14_sacred_reserve':
      'Quando a Ascensão Divina termina, recupere 5 de Devoção.',
    'pal_r14_zeal':
      'A cada terceira habilidade que realmente gera Devoção, você ganha 1 de Devoção extra.',
    'pal_r17_extended_dawn':
      'A Ascensão Divina fortalece 2 habilidades adicionais.',
    'pal_r20_dawn_echo':
      'A cada terceira habilidade direta que realmente gera Devoção, ela repete seu dano ou cura direto principal a 40% no mesmo alvo. Um eco efetivo concede 1 de Devoção. O eco não pode causar acerto crítico nem acionar outros ecos, e não concede Devoção durante a Ascensão Divina.',
    'pal_r20_perpetual_sun':
      'Consumir sua última carga de Ascensão causa 150 de dano Sagrado num raio de 10 m, cura aliados num raio de 20 m em 150 e então dobra a geração de Devoção das habilidades por 5 s. A expiração não aciona este efeito.',
    'pal_r5_divine_steed':
      'Ganhe 0,75% de velocidade de movimento por Devoção, até 15% em 20. Ativar a Ascensão Divina gasta sua Devoção e concede 30% de velocidade de movimento por 5 s.',
    'pal_r5_radiant_stride':
      'O Martelo da Graça concede 30% de velocidade de movimento por 4 s quando causa dano.',
    'pal_r8_recurring_grace':
      'O excesso de cura do Martelo da Graça se torna um escudo de absorção por 10 s, limitado a 10% da sua vida máxima.',
    'pri_r11_vampiric_embrace':
      'Um inimigo que consome totalmente o Salmo de Proteção fica enraizado por 2 s, uma vez por inimigo a cada 12 s.',
    'pri_r14_pain_and_suffering':
      'A cura por dano da Doutrina restaura o Salmo de Proteção em 20% da cura realizada, até seu valor original de absorção. A Bênção transforma o excesso de cura de Cura do Coro em uma absorção de 10 s, limitada a 10% da vida máxima. Cada eco da Efígie de Vésperas estende o Canto de Decadência em 1 s, até 6 s por alvo.',
    'pri_r20_incarnate_spirit':
      'Um Salmo de Proteção totalmente consumido cura seu alvo em 40% do valor original de absorção. A cura da Vigília Seráfica da Bênção também cura até 3 membros do grupo num raio de 15 m em 40%. Um Demônio do Dízimo de Vésperas com 5 acúmulos causa 50% mais dano e dura 50% mais.',
    'pri_r20_second_verse':
      'Após 2 s, repita 40% da cura de Misericórdia Purificadora da Doutrina, da cura em grupo da Bênção, ou do dano do eco da Efígie de Vésperas. A repetição não pode acionar a si mesma.',
    'pri_r5_improved_renew':
      'O Salmo de Proteção concede ao seu alvo 40% de velocidade de movimento por 3 s.',
    'pri_r5_searing_light':
      'Passo do Véu remove enraizamentos e reduções de velocidade, depois concede 50% de velocidade de movimento por 3 s.',
    'pri_r5_twisted_faith':
      'Passo do Véu permite ao Sacerdote conjurar em movimento por 4 s.',
    'rog_r11_cheap_trick':
      'Soco no Estômago não exige mais Duskveil.',
    'rog_r14_dusk_economy':
      'Habilidades custam 50% menos energia enquanto você está em Duskveil ou envolto em sombras pelo véu, e por 6 s após deixar Duskveil.',
    'rog_r20_kill_chain':
      'Golpes fatais renovam o Passo de Fumaça e concedem 5 pontos de combo.',
    'rog_r20_second_shadow':
      'Sono Eterno lançado com 5 pontos de combo golpeia novamente a partir das sombras por 75% do seu dano.',
    'sha_r14_chain_lightning':
      'Depois de gastar 120 de Mana, sua próxima ação de Xamã que custa Mana custa 40 a menos. O estado pronto não tem expiração breve.',
    'sha_r14_improved_flame_shock':
      'Marca Pírica concede 1 carga extra de Trovão a cada 3º Raio em Arco. Os ecos de Coração de Vendaval causam 25% mais dano, Vínculo de Pedra ganha 5% de redução de dano, e Fonte da Vida deposita 20% mais Corrente Restauradora.',
    'sha_r14_weapon_fury':
      'Um Raio em Arco, Golpe Ancestral ou Águas Restauradoras bem-sucedido restaura 1 carga de Salvaguarda do Trovão e 10 de Mana, uma vez a cada 6 s.',
    'sha_r17_elemental_warding':
      'Ativar a Salvaguarda do Trovão concede 40% de redução de dano por 6 s. Recarga interna de 120 s.',
    'sha_r17_improved_ghost_wolf':
      'Quando pronto, sair de Lobo Sombrio permite conjurar em movimento por 8 s. Recarga interna de 90 s.',
    'sha_r20_bloodlust':
      'Depois que o Abalo Terreno ou o Terremoto consome todo o Trovão, retenha 2 de Trovão. Depois que um feitiço consome o Presságio de Tempestade, retenha 1 golpe da Cadência do Espírito Guerreiro. Depois que a Cura em Cadeia consome a Corrente Restauradora, restaure 25% da quantidade consumida.',
    'sha_r20_elemental_fury':
      'Depois que o Abalo Terreno ou o Terremoto consome todo o Trovão, repita 40% do seu dano após 1 s. Um feitiço que consome o Presságio de Tempestade se repete com 40% de força. A cura da Corrente Restauradora consumida se repete com 40% de força após 2 s. Essas repetições não podem acionar outros efeitos.',
    'sha_r20_tidal_waves':
      'Depois que o Abalo Terreno ou o Terremoto consome todo o Trovão, a Marca Pírica torna o próximo Raio em Arco instantâneo. O eco final de Coração de Vendaval causa 50% de dano a até 2 inimigos num raio de 8 m. Um feitiço de Vínculo de Pedra que consome o Presságio de Tempestade concede uma absorção igual a 8% da sua vida máxima. Com a Fonte da Vida ativa, o Chamado da Maré também adiciona 50% da sua cura completa ao aliado mais ferido num raio de 10 m.',
    'sha_r5_imbue_mastery':
      'Depois de usar um Abalo, o próximo Raio em Arco ou Águas Restauradoras iniciado em até 8 s pode ser conjurado em movimento.',
    'sha_r5_improved_lightning_shield':
      'Entrar em Lobo Sombrio concede 60% de velocidade de movimento por 3 s, uma vez a cada 20 s.',
    'sha_r8_frost_bind':
      'A retaliação da Salvaguarda do Trovão concede 10% de redução de dano por 3 s.',
    'wlk_r11_demon_armor':
      'Na primeira vez que cada membro do grupo toca seu Soulwell, ele os escuda em 15% da vida máxima deles por 30 s. Cada jogador pode obter esse escudo uma vez por Soulwell.',
  },
  ru_RU: {
    mag_r5_blink_cast:
      'Вы можете использовать Мерцающий шаг в процессе применения заклинания, не прерывая его.',
    mag_r8_temporal_rift:
      'Применение личного барьера снимает действующие на вас эффекты обездвиживания.',
    mag_r17_convergence:
      'Чередование заклинания Огня и заклинания Льда открывает 8-секундный прилив силы, не чаще одного раза в 30 сек.',
    mag_r20_overflowing_power:
      'Расход маны сокращает время восстановления ваших защитных умений: 2 сек. за каждую десятую часть максимального запаса маны, не более 10 сек. каждые 30 сек.',
    dru_r20_improved_hurricane:
      'В Облике лунного совуха вы и члены вашей группы в радиусе 30 ярдов получают +3% к шансу критического удара заклинаниями.',
    war_row_second_wind:
      'При уровне здоровья ниже 35% вы восстанавливаете 1,5% здоровья в секунду.',
    war_row_anger_management:
      'Ваши автоматические атаки генерируют на 10% больше ярости, а способности на 5% больше.',
    war_row_blood_offering:
      'Ваши стойки получают дополнительные эффекты. Боевая стойка: критические удары способностей наносят на 15% больше урона. Стойка берсерка: автоматические атаки совершаются на 5% быстрее. Стойка стража: удар, который отнял бы не менее 20% максимального здоровья, наносит на 15% меньше урона.',
    war_row_battle_rhythm:
      'Каждая третья использованная способность генерирует на 20% больше ярости.',
    war_row_colossal_might:
      'Каждая единица ярости, которую вы тратите, сокращает время восстановления ваших основных атакующих способностей на 0,1 сек., не более 10 сек. каждые 30 сек.',
    'dru_r14_empowered_touch':
      '«Сверхцветение» заново высаживает свежий «Дикий расцвет» на каждом союзнике, чье исцеление оно собрало.',
    'dru_r14_moonfury':
      '«Лунный всплеск» и «Пробуждение солнца» также восстанавливают по 15% вашей максимальной маны.',
    'dru_r14_savage_fury':
      'Каждый тик кровотечений от «Свежевания» и «Кровавого разлома» также добавляет 1 стадию Старой крови.',
    'dru_r20_berserk':
      '«Лунный всплеск», «Пробуждение солнца», «Кровавая жатва», «Дробление костей» и «Сверхцветение» становятся сильнее на 25%.',
    'dru_r20_tranquility':
      'Каждая полученная 1 стадия Лунного прилива, Старой крови или Зелени восстанавливает 2% максимальной маны, 5 ед. энергии или 3 ед. ярости, в зависимости от вашего текущего облика.',
    'dru_r5_ferocity':
      'Смена облика дает 60% скорости передвижения на 3 сек., не чаще одного раза в 20 сек.',
    'dru_r5_improved_wrath':
      'Смена облика снимает разрушаемые обездвиживающие и замедляющие эффекты.',
    'hun_r11_binding_payload':
      '«Капкан ледяной пасти» обездвиживает всех врагов в зоне срабатывания на 3 сек., а затем замедляет их на 40% на 4 сек.',
    'hun_r11_crippling_pursuit':
      '«Сотрясающий выстрел» или «Сковывающий разрез» обездвиживают уже замедленную цель на 2 сек. Время восстановления для каждой цели: 12 сек.',
    'hun_r14_efficient_rhythm':
      'После траты 75 ед. концентрации следующее использование «Команды стае», «Выверенного выстрела» или «Потрошащего удара» дает 20 дополнительных ед. концентрации.',
    'hun_r14_guise_mastery':
      'В течение 6 сек. «Облик луня» увеличивает накопление концентрации на 50%, «Облик куницы» снижает получаемый прямой урон на 25%, а «Облик скакуна» дает 50% скорости передвижения, или 60% с «Неутомимым скакуном». Общее время восстановления: 20 сек.',
    'hun_r17_apex_instinct':
      '«Звериный гнев», «Холодная сосредоточенность» или «Натиск по кровавому следу» восстанавливает 40 ед. концентрации. Следующие 3 траты концентрации стоят на 50% меньше и наносят на 20% больше урона. Эти заряды истекают через 4 сек. после окончания времени восстановления способности, запустившей эффект.',
    'hun_r17_pack_rally':
      '«Облик скакуна» может запускать «Сбор стаи». Вы, ваш компаньон и союзники по группе или рейду в пределах 30 ярдов получаете 30% скорости передвижения и 10% скорости атаки, применения и поддержания заклинаний на 10 сек. Время восстановления: 90 сек.',
    'hun_r17_shell_and_fang':
      '«Панцирная кожа» позволяет атаковать и отдавать команды питомцу, но ее снижение урона уменьшается до 40%.',
    'hun_r20_chain_reaction':
      '«Капкан ледяной пасти» помечает врагов в пределах 4 ярда на 8 сек. Следующие 3 траты концентрации распространяют эхом 40% урона между помеченными врагами.',
    'hun_r20_fang_chorus':
      'Каждая трата концентрации вызывает эхо-атаку питомца силой 50%. Каждое 3-е эхо становится хлопком радиусом 4 ярда.',
    'hun_r20_overdraw':
      'Каждый 3-й «Зловещий выстрел», «Долгий натяг» или «Ответный клык» наносит на 35% больше урона своей цели и 50% этого урона еще до 2 врагам в пределах 5 ярдов.',
    'hun_r5_enduring_courser':
      '«Облик скакуна» дает 60% скорости передвижения на 3 сек. при активации. Внутреннее время восстановления: 20 сек.',
    'hun_r5_predators_pace':
      'Успешное применение «Команды стае», «Выверенного выстрела» или «Потрошащего удара» дает 20% скорости передвижения на 3 сек. Внутреннее время восстановления: 8 сек.',
    'hun_r8_receding_shell':
      'Повторное применение «Панцирной кожи» досрочно завершает ее действие и возвращает 50% неиспользованного времени действия, вплоть до 45 сек.',
    'hun_r8_shared_recovery':
      '«Дикое сердце» также исцеляет вашего питомца на 30% и дает вам обоим снижение получаемого урона на 20% на 4 сек.',
    'pal_r14_divine_purpose':
      'Способности, усиленные Вознесением, с вероятностью 20% не расходуют заряд.',
    'pal_r14_sacred_reserve':
      'Когда «Божественное вознесение» заканчивается, восстанавливается 5 ед. Преданности.',
    'pal_r14_zeal':
      'Каждая третья способность, которая реально дает Преданность, приносит дополнительно 1 ед. Преданности.',
    'pal_r17_extended_dawn':
      '«Божественное вознесение» усиливает 2 дополнительные способности.',
    'pal_r20_dawn_echo':
      'Каждая третья способность прямого действия, которая реально дает Преданность, повторяет свой основной прямой урон или исцеление с силой 40% по той же цели. Успешное эхо дает 1 ед. Преданности. Эхо не может критически поражать и не может запускать другие эхо-эффекты, а также не дает Преданность во время «Божественного вознесения».',
    'pal_r20_perpetual_sun':
      'Использование последнего заряда Вознесения наносит 150 ед. урона от Света в пределах 10 м, исцеляет союзников в пределах 20 м на 150 и затем удваивает получение Преданности от способностей на 5 сек. Истечение срока действия не запускает этот эффект.',
    'pal_r5_divine_steed':
      'Дает 0,75% скорости передвижения за каждую ед. Преданности, вплоть до 15% при 20 ед. Преданности. Активация «Божественного вознесения» тратит вашу Преданность и дает 30% скорости передвижения на 5 сек.',
    'pal_r5_radiant_stride':
      '«Молот благодати» дает 30% скорости передвижения на 4 сек., когда наносит урон.',
    'pal_r8_recurring_grace':
      'Избыточное исцеление «Молота благодати» превращается в поглощающий щит на 10 сек., ограниченный 10% вашего максимального здоровья.',
    'pri_r11_vampiric_embrace':
      'Враг, полностью поглотивший «Псалом ограждения», обездвиживается на 2 сек., не чаще раза в 12 сек. на одного врага.',
    'pri_r14_pain_and_suffering':
      'Исцеление, которое Доктрина создает из вашего урона, восстанавливает «Псалом ограждения» на 20% от совершенного исцеления, вплоть до исходного объема поглощения. Благословение превращает избыточное исцеление «Хорового исцеления» в поглощающий щит на 10 сек., ограниченный 10% максимального здоровья. Каждое эхо Изваяния Вечерни продлевает «Панихиду распада» на 1 сек., вплоть до 6 сек. на цель.',
    'pri_r20_incarnate_spirit':
      'Полностью поглощенный «Псалом ограждения» исцеляет свою цель на 40% от исходного объема поглощения. Исцеление от Бдения Благословения также исцеляет до 3 участников группы в пределах 15 ярдов на 40%. Демон десятины Вечерни при 5 стадиях наносит на 50% больше урона и длится на 50% дольше.',
    'pri_r20_second_verse':
      'Через 2 сек. повторяется 40% исцеления «Карающего милосердия» Доктрины, группового исцеления Благословения или урона эха Изваяния Вечерни. Повтор не может запустить сам себя.',
    'pri_r5_improved_renew':
      '«Псалом ограждения» дает своей цели 40% скорости передвижения на 3 сек.',
    'pri_r5_searing_light':
      '«Шаг сквозь завесу» снимает обездвиживающие и замедляющие эффекты, а затем дает 50% скорости передвижения на 3 сек.',
    'pri_r5_twisted_faith':
      '«Шаг сквозь завесу» позволяет жрецу применять заклинания на ходу в течение 4 сек.',
    'rog_r11_cheap_trick':
      '«Удар под дых» больше не требует «Сумеречной завесы».',
    'rog_r14_dusk_economy':
      'Способности стоят на 50% меньше энергии, пока вы в «Сумеречной завесе» или окутаны ее тенью, а также в течение 6 сек. после выхода из «Сумеречной завесы».',
    'rog_r20_kill_chain':
      'Смертельные удары обновляют «Дымный шаг» и дают 5 очков серии приемов.',
    'rog_r20_second_shadow':
      '«Вечный сон», примененный при 5 очках серии приемов, наносит повторный удар из тени с силой 75% урона.',
    'sha_r14_chain_lightning':
      'После траты 120 маны следующее действие шамана, требующее ману, стоит на 40 меньше. Это состояние готовности не имеет короткого срока действия.',
    'sha_r14_improved_flame_shock':
      '«Пламенное клеймо» дает 1 дополнительный заряд Грома за каждую 3-ю «Дуговую стрелу». Эхо бурного сердца наносит на 25% больше урона, «Каменные узы» получают снижение урона на 5%, а «Живой источник» откладывает на 20% больше Потока исцеления.',
    'sha_r14_weapon_fury':
      'Успешное применение «Дуговой стрелы», «Удара предков» или «Целебных вод» восстанавливает 1 заряд «Громового оберега» и 10 маны, не чаще раза в 6 сек.',
    'sha_r17_elemental_warding':
      'Активация «Громового оберега» дает снижение получаемого урона на 40% на 6 сек. Внутреннее время восстановления: 120 сек.',
    'sha_r17_improved_ghost_wolf':
      'Когда способность готова, выход из «Сумрачного волка» позволяет применять заклинания на ходу в течение 8 сек. Внутреннее время восстановления: 90 сек.',
    'sha_r20_bloodlust':
      'После того как «Земной толчок» или «Землетрясение» расходуют весь Гром, сохраняется 2 заряда Грома. После того как заклинание расходует Бурезаклятие, сохраняется 1 деление Ритма духа войны. После того как «Цепное исцеление» расходует Поток исцеления, восстанавливается 25% израсходованного объема.',
    'sha_r20_elemental_fury':
      'После того как «Земной толчок» или «Землетрясение» расходуют весь Гром, через 1 сек. повторяется 40% их урона. Заклинание, расходующее Бурезаклятие, повторяется с силой 40%. Исцеление от израсходованного Потока исцеления повторяется с силой 40% через 2 сек. Эти повторы не могут запускать другие эффекты.',
    'sha_r20_tidal_waves':
      'После того как «Земной толчок» или «Землетрясение» расходуют весь Гром, «Пламенное клеймо» делает следующую «Дуговую стрелу» мгновенной. Последнее эхо бурного сердца наносит 50% урона еще до 2 врагам в пределах 8 ярдов. Заклинание «Каменных уз», расходующее Бурезаклятие, дает поглощающий щит, равный 8% вашего максимального здоровья. При активном «Живом источнике» «Зов прилива» также добавляет 50% своего полного исцеления самому раненому союзнику в пределах 10 ярдов.',
    'sha_r5_imbue_mastery':
      'После применения толчка следующие «Дуговая стрела» или «Целебные воды», начатые в течение 8 сек., можно применять на ходу.',
    'sha_r5_improved_lightning_shield':
      'Превращение в «Сумрачного волка» дает 60% скорости передвижения на 3 сек., не чаще раза в 20 сек.',
    'sha_r8_frost_bind':
      'Ответный удар «Громового оберега» дает снижение получаемого урона на 10% на 3 сек.',
    'wlk_r11_demon_armor':
      'Когда участник группы впервые взаимодействует с вашим «Колодцем душ», он получает щит на 15% максимального здоровья на 30 сек. Каждый игрок может получить этот щит лишь один раз за «Колодец душ».',
  },
  cs_CZ: {
    mag_r5_blink_cast: 'Mihokrok můžeš použít uprostřed sesílání kouzla, aniž by bylo přerušeno.',
    mag_r8_temporal_rift: 'Seslání osobní bariéry z tebe odstraní účinky ukotvení.',
    mag_r17_convergence:
      'Střídání ohnivého a mrazivého kouzla otevře 8 s trvající příval moci, nejvýše jednou za 30 s.',
    mag_r20_overflowing_power:
      'Vydávání many zkracuje cooldown tvých obranných schopností: 2 s za každou desetinu utracené maximální many, nejvýše 10 s každých 30 s.',
    dru_r20_improved_hurricane:
      'V Podobě měsíčního křídla ty a členové tvé skupiny do 30 yd získáváte o 3 % vyšší šanci na kritický zásah kouzlem.',
    war_row_second_wind: 'Pod 35 % zdraví si každou sekundu obnovujete 1,5 % zdraví.',
    war_row_anger_management:
      'Vaše automatické útoky generují o 10 % více zuřivosti a vaše schopnosti o 5 % více.',
    war_row_blood_offering:
      'Vaše postoje získávají další účinky. Bojový postoj: kritické zásahy schopností způsobují o 15 % vyšší poškození. Postoj berserka: automatické útoky jsou o 5 % rychlejší. Krytý postoj: zásah, který by vám odebral alespoň 20 % maximálního zdraví, způsobí o 15 % nižší poškození.',
    war_row_battle_rhythm: 'Každá třetí použitá schopnost generuje o 20 % více zuřivosti.',
    war_row_colossal_might:
      'Každý bod zuřivosti, který utratíš, zkracuje cooldown tvých hlavních útočných schopností o 0,1 s, nejvýše 10 s každých 30 s.',
    'dru_r14_empowered_touch':
      'Překvět znovu zasadí čerstvý Divoký květ na každého spojence, jehož léčení sklidil.',
    'dru_r14_moonfury':
      'Měsíční vzedmutí i Sluneční vzedmutí navíc obnoví 15 % tvé maximální many.',
    'dru_r14_savage_fury':
      'Každý tik tvého krvácení ze Stažení z kůže a Roztržení navíc přidá 1 Starou krev.',
    'dru_r20_berserk':
      'Měsíční vzedmutí, Sluneční vzedmutí, Rudá sklizeň, Lámání morku a Překvět jsou o 25 % silnější.',
    'dru_r20_tranquility':
      'Každý 1 bod Měsíčního přílivu, Staré krve nebo Bujnosti, který získáš, obnoví 2 % tvé maximální many, 5 energie nebo 3 vzteku, podle tvé aktuální podoby.',
    'dru_r5_ferocity':
      'Změna podoby udělí 60 % rychlosti pohybu na 3 s, nejvýše jednou za 20 s.',
    'dru_r5_improved_wrath':
      'Změna podoby odstraní zrušitelná zakořenění a zpomalení.',
    'hun_r11_binding_payload':
      'Past mrazivé čelisti zakoření každého nepřítele ve své spouštěcí oblasti na 3 s, poté je zpomalí o 40 % na 4 s.',
    'hun_r11_crippling_pursuit':
      'Otřásající výstřel nebo Spoutávající sek zakoření již zpomalený cíl na 2 s. Doba obnovy na cíl 12 s.',
    'hun_r14_efficient_rhythm':
      'Po utracení 75 Soustředění tvůj příští Povel smečky, Odměřený výstřel nebo Párací úder udělí 20 Soustředění navíc.',
    'hun_r14_guise_mastery':
      'Po dobu 6 s Podoba motáka zvyšuje generování Soustředění o 50 %, Podoba kuny snižuje přímé poškození o 25 % a Podoba běžce uděluje 50 % rychlosti pohybu, nebo 60 % s Vytrvalým běžcem. Sdílená doba obnovy 20 s.',
    'hun_r17_apex_instinct':
      'Vyjící běs, Chladné soustředění nebo Útok krvavé stopy obnoví 40 Soustředění. Tvé další 3 schopnosti spotřebovávající Soustředění stojí o 50 % méně a způsobí o 20 % více poškození. Toto využití vyprší 4 s po skončení spouštěcí doby obnovy.',
    'hun_r17_pack_rally':
      'Podoba běžce může spustit Shromáždění smečky. Ty, tvůj společník a spojenci ze skupiny nebo raidu do 30 yardů získají 30 % rychlosti pohybu a 10 % rychlosti útoku, sesílání a kanálování na 10 s. Doba obnovy 90 s.',
    'hun_r17_shell_and_fang':
      'Krunýřová kůže umožňuje útoky a příkazy mazlíčkovi, ale její snížení poškození klesá na 40 %.',
    'hun_r20_chain_reaction':
      'Past mrazivé čelisti označí nepřátele do 4 yardů na 8 s. Tvé další 3 schopnosti spotřebovávající Soustředění ozvěnou přenesou 40 % poškození mezi označenými nepřáteli.',
    'hun_r20_fang_chorus':
      'Každá schopnost spotřebovávající Soustředění přikáže tvému mazlíčkovi ozvěnu o poloviční síle. Každá 3. ozvěna se promění v úder v okruhu 4 yardů.',
    'hun_r20_overdraw':
      'Každý 3. Prokletý výstřel, Dlouhý nátah nebo Protišpičák způsobí svému cíli o 35 % více poškození a 50 % tohoto poškození až 2 nepřátelům do 5 yardů.',
    'hun_r5_enduring_courser':
      'Podoba běžce udělí při aktivaci 60 % rychlosti pohybu na 3 s. Vnitřní doba obnovy 20 s.',
    'hun_r5_predators_pace':
      'Úspěšný Povel smečky, Odměřený výstřel nebo Párací úder udělí 20 % rychlosti pohybu na 3 s. Vnitřní doba obnovy 8 s.',
    'hun_r8_receding_shell':
      'Sešli znovu Krunýřovou kůži pro její předčasné ukončení a vrácení 50 % její nevyužité doby trvání, až do 45 s.',
    'hun_r8_shared_recovery':
      'Divoké srdce navíc vyléčí tvého mazlíčka o 30 % a udělí vám oběma 20% snížení poškození na 4 s.',
    'pal_r14_divine_purpose':
      'Schopnosti posílené Vzestupem mají 20% šanci nespotřebovat náboj.',
    'pal_r14_sacred_reserve':
      'Když Božský vzestup skončí, získej zpět 5 Oddanosti.',
    'pal_r14_zeal':
      'Každá třetí schopnost, která skutečně generuje Oddanost, udělí 1 Oddanost navíc.',
    'pal_r17_extended_dawn':
      'Božský vzestup posílí o 2 schopnosti navíc.',
    'pal_r20_dawn_echo':
      'Každá třetí přímá schopnost, která skutečně generuje Oddanost, zopakuje své hlavní přímé poškození nebo léčení za 40 % na stejném cíli. Účinná ozvěna udělí 1 Oddanost. Ozvěna nemůže kriticky zasáhnout ani spustit další ozvěny a během Božského vzestupu neudělí žádnou Oddanost.',
    'pal_r20_perpetual_sun':
      'Spotřebování tvého posledního náboje Vzestupu způsobí 150 svatého poškození v okruhu 10 m, vyléčí spojence v okruhu 20 m za 150 a poté na 5 s zdvojnásobí generování Oddanosti ze schopností. Vypršení to nespustí.',
    'pal_r5_divine_steed':
      'Získej 0,75 % rychlosti pohybu za každou Oddanost, až 15 % při 20. Aktivace Božského vzestupu spotřebuje tvou Oddanost a udělí 30 % rychlosti pohybu na 5 s.',
    'pal_r5_radiant_stride':
      'Kladivo milosti udělí 30 % rychlosti pohybu na 4 s, když způsobí poškození.',
    'pal_r8_recurring_grace':
      'Přeléčení z Kladiva milosti se změní na pohlcující štít na 10 s, omezený na 10 % tvého maximálního zdraví.',
    'pri_r11_vampiric_embrace':
      'Nepřítel, který plně spotřebuje Žalm ochrany, je zakořeněn na 2 s, nejvýše jednou za nepřítele každých 12 s.',
    'pri_r14_pain_and_suffering':
      'Léčení, které Doktrína vytváří z poškození, obnoví Žalm ochrany o 20 % vykonaného léčení, nejvýše na jeho původní hodnotu pohlcení. Požehnání promění přeléčení ze Sborového zacelení v 10s pohlcení omezené na 10 % maximálního zdraví. Každá ozvěna, která zasáhne tvou Podobiznu, prodlouží Žalozpěv rozkladu o 1 s, až na 6 s na cíl.',
    'pri_r20_incarnate_spirit':
      'Plně spotřebovaný Žalm ochrany vyléčí svůj cíl za 40 % původní hodnoty pohlcení. Léčení Serafínské stráže Požehnání navíc vyléčí až 3 členy skupiny do 15 yardů za 40 %. Desátkový běs Nešpor s 5 nánosy způsobí o 50 % více poškození a vydrží o 50 % déle.',
    'pri_r20_second_verse':
      'Po 2 s zopakuje 40 % léčení Očistného milosrdenství z Doktríny, skupinového léčení z Požehnání, nebo poškození ozvěny Podobizny z Nešpor. Opakování nemůže spustit samo sebe.',
    'pri_r5_improved_renew':
      'Žalm ochrany udělí svému cíli 40 % rychlosti pohybu na 3 s.',
    'pri_r5_searing_light':
      'Krok závoje odstraní zakořenění a zpomalení, poté udělí 50 % rychlosti pohybu na 3 s.',
    'pri_r5_twisted_faith':
      'Krok závoje umožní knězi sesílat za pohybu po dobu 4 s.',
    'rog_r11_cheap_trick':
      'Rána do břicha už nevyžaduje Závoj šera.',
    'rog_r14_dusk_economy':
      'Schopnosti stojí o 50 % méně energie, když jsi v Závoji šera nebo pod vlivem Stínového závoje, a ještě 6 s po opuštění Závoje šera.',
    'rog_r20_kill_chain':
      'Smrtící údery obnoví Kouřový krok a udělí 5 combo bodů.',
    'rog_r20_second_shadow':
      'Do hrobu seslané s 5 combo body udeří znovu ze stínů za 75 % svého poškození.',
    'sha_r14_chain_lightning':
      'Po utracení 120 many bude tvá příští šamanská akce, která stojí manu, stát o 40 méně. Tento připravený stav nevyprší po krátké době.',
    'sha_r14_improved_flame_shock':
      'Zbraň žárové značky udělí 1 Hrom navíc při každém 3. Bleskovém šípu. Ozvěny srdce vichru způsobí o 25 % více poškození, Zbraň spoutaná kamenem získá 5% snížení poškození a Zbraň pramene života uloží o 20 % více Léčivého proudu.',
    'sha_r14_weapon_fury':
      'Úspěšný Bleskový šíp, Úder předků nebo Léčivé vody obnoví 1 náboj Hromové ochrany a 10 many, jednou za 6 s.',
    'sha_r17_elemental_warding':
      'Aktivace Hromové ochrany udělí 40 % snížení poškození na 6 s. Vnitřní doba obnovy 120 s.',
    'sha_r17_improved_ghost_wolf':
      'Když je připraveno, opuštění Stínovlka umožní sesílat za pohybu po dobu 8 s. Vnitřní doba obnovy 90 s.',
    'sha_r20_bloodlust':
      'Poté, co Zemní otřes nebo Zemětřesení spotřebuje veškerý Hrom, podrží se 2 Hromy. Poté, co kouzlo spotřebuje Znamení bouře, podrží se 1 stupeň kadence válečného ducha. Poté, co Řetězové léčení spotřebuje Léčivý proud, obnoví se 25 % spotřebovaného množství.',
    'sha_r20_elemental_fury':
      'Poté, co Zemní otřes nebo Zemětřesení spotřebuje veškerý Hrom, zopakuje se 40 % jeho poškození po 1 s. Kouzlo, které spotřebuje Znamení bouře, se zopakuje se sílou 40 %. Léčení ze spotřebovaného Léčivého proudu se zopakuje se sílou 40 % po 2 s. Tato opakování nemohou spustit další efekty.',
    'sha_r20_tidal_waves':
      'Poté, co Zemní otřes nebo Zemětřesení spotřebuje veškerý Hrom, Zbraň žárové značky změní příští Bleskový šíp v okamžitý. Poslední Ozvěna srdce vichru způsobí 50 % poškození až 2 nepřátelům do 8 yardů. Kouzlo Zbraně spoutané kamenem, které spotřebuje Znamení bouře, udělí pohlcení rovné 8 % tvého maximálního zdraví. Když je aktivní Zbraň pramene života, Volání přílivu navíc přidá 50 % svého plného léčení nejzraněnějšímu spojenci do 10 yardů.',
    'sha_r5_imbue_mastery':
      'Po použití otřesu lze tvůj příští Bleskový šíp nebo Léčivé vody zahájené do 8 s seslat za pohybu.',
    'sha_r5_improved_lightning_shield':
      'Přeměna ve Stínovlka udělí 60 % rychlosti pohybu na 3 s, jednou za 20 s.',
    'sha_r8_frost_bind':
      'Odveta Hromové ochrany udělí 10 % snížení poškození na 3 s.',
    'wlk_r11_demon_armor':
      'Poprvé, co se člen skupiny dotkne tvého Soulwellu, získá štít za 15 % svého maximálního zdraví na 30 s. Každý hráč může tento štít získat jednou za Soulwell.',
  },
  nl_NL: {
    mag_r5_blink_cast:
      'Je kunt Flikkerstap gebruiken midden in een bezwering zonder die te onderbreken.',
    mag_r8_temporal_rift:
      'Het gebruiken van je persoonlijke barrière verwijdert worteleffecten die op je werken.',
    mag_r17_convergence:
      'Een Vuur- en een Vorstbezwering afwisselen opent een krachtsopstoot van 8 sec, maximaal eens per 30 sec.',
    mag_r20_overflowing_power:
      'Mana besteden verkort de herlaaditijd van je verdedigingsvaardigheden: 2 sec per tiende van je maximale mana besteed, tot maximaal 10 sec elke 30 sec.',
    dru_r20_improved_hurricane:
      'Terwijl je in Moonkin-Gedaante bent, krijgen jij en je groepsleden binnen 30 m 3% kans op een kritieke spreuktreffer.',
    war_row_second_wind: 'Onder 35% gezondheid herstel je elke seconde 1,5% van je gezondheid.',
    war_row_anger_management:
      'Je automatische aanvallen genereren 10% meer woede en je vaardigheden 5% meer.',
    war_row_blood_offering:
      'Je houdingen krijgen extra effecten. Strijdhouding: kritieke treffers van je vaardigheden richten 15% meer schade aan. Berserkerhouding: je automatische aanvallen zijn 5% sneller. Bewaakte Houding: een treffer die minstens 20% van je maximale gezondheid zou kosten, richt 15% minder schade aan.',
    war_row_battle_rhythm: 'Elke derde gebruikte vaardigheid genereert 20% meer woede.',
    war_row_colossal_might:
      'Elk punt woede dat je uitgeeft verkort de herlaaditijd van je grote aanvalsvaardigheden met 0,1 sec, tot maximaal 10 sec elke 30 sec.',
    'dru_r14_empowered_touch':
      'Overbloei herplant een verse Wildbloei op elke bondgenoot van wie het genezing heeft geoogst.',
    'dru_r14_moonfury':
      'Maangolf en Zonnespoor herstellen elk ook 15% van je maximale mana.',
    'dru_r14_savage_fury':
      'Elke tik van je Villen- en Verscheuren-bloedingen voegt ook 1 Oud Bloed toe.',
    'dru_r20_berserk':
      'Maangolf, Zonnespoor, Rode Oogst, Mergbreker en Overbloei zijn 25% sterker.',
    'dru_r20_tranquility':
      'Elke 1 Maanvloed, Oud Bloed of Groenkracht die je krijgt, herstelt 2% van je maximale mana, 5 energie of 3 woede, overeenkomend met je huidige gedaante.',
    'dru_r5_ferocity':
      'Van gedaante wisselen verleent 3 sec lang 60% bewegingssnelheid, hoogstens eenmaal per 20 sec.',
    'dru_r5_improved_wrath':
      'Van gedaante wisselen verwijdert breekbare wortels en vertragingen.',
    'hun_r11_binding_payload':
      'Vorstkaakval wortelt elke vijand in zijn triggergebied gedurende 3 sec, en vertraagt hen daarna 4 sec lang met 40%.',
    'hun_r11_crippling_pursuit':
      'Ratelend Schot of Kluisterende Houw wortelt een reeds vertraagd doelwit gedurende 2 sec. Afkoeltijd van 12 sec per doelwit.',
    'hun_r14_efficient_rhythm':
      'Nadat je 75 focus hebt besteed, verleent je volgende Roedelbevel, Beheerst Schot of Ontweiende Slag 20 extra focus.',
    'hun_r14_guise_mastery':
      '6 sec lang verhoogt Gedaante van de Kiekendief de focusopbouw met 50%, vermindert Gedaante van de Marter directe schade met 25%, en verleent Gedaante van de Renner 50% bewegingssnelheid, of 60% met Volhardende Renner. Gedeelde afkoeltijd van 20 sec.',
    'hun_r17_apex_instinct':
      'Beestachtige woede, Koude Focus of Bloedspoor-aanval herstelt 40 focus. Je volgende 3 vaardigheden die focus verbruiken kosten 50% minder en brengen 20% meer schade toe. Deze gebruiken verlopen 4 sec nadat de veroorzakende afkoeltijd eindigt.',
    'hun_r17_pack_rally':
      'Gedaante van de Renner kan Roedelverzameling activeren. Jij, je metgezel, en groeps- of raidbondgenoten binnen 30 m krijgen 10 sec lang 30% bewegingssnelheid en 10% aanvals-, spreuk- en kanaliseersnelheid. Afkoeltijd van 90 sec.',
    'hun_r17_shell_and_fang':
      'Schildhuid staat aanvallen en huisdierbevelen toe, maar de schadevermindering ervan wordt verlaagd naar 40%.',
    'hun_r20_chain_reaction':
      'Vorstkaakval markeert vijanden binnen 4 m gedurende 8 sec. Je volgende 3 vaardigheden die focus verbruiken laten 40% schade weerklinken tussen gemarkeerde vijanden.',
    'hun_r20_fang_chorus':
      'Elke vaardigheid die focus verbruikt beveelt een huisdier-echo op 50% sterkte. Elke 3e echo wordt een klap van 4 m.',
    'hun_r20_overdraw':
      'Elk 3e Boosaardig Schot, Lange Trek of Tegenbeet brengt 35% meer schade toe aan zijn doelwit en 50% van die schade aan tot 2 vijanden binnen 5 m.',
    'hun_r5_enduring_courser':
      'Gedaante van de Renner verleent 3 sec lang 60% bewegingssnelheid wanneer geactiveerd. Interne afkoeltijd van 20 sec.',
    'hun_r5_predators_pace':
      'Een geslaagd Roedelbevel, Beheerst Schot of Ontweiende Slag verleent 3 sec lang 20% bewegingssnelheid. Interne afkoeltijd van 8 sec.',
    'hun_r8_receding_shell':
      'Heractiveer Schildhuid om het vroegtijdig te beëindigen en 50% van de ongebruikte duur terug te krijgen, tot 45 sec.',
    'hun_r8_shared_recovery':
      'Wildhart geneest ook je huisdier voor 30% en verleent jullie beiden 4 sec lang 20% schadevermindering.',
    'pal_r14_divine_purpose':
      'Door Verheffing versterkte vaardigheden hebben 20% kans om geen lading te verbruiken.',
    'pal_r14_sacred_reserve':
      'Wanneer Goddelijke Verheffing eindigt, krijg je 5 Toewijding terug.',
    'pal_r14_zeal':
      'Elke derde vaardigheid die daadwerkelijk Toewijding genereert, verleent 1 extra Toewijding.',
    'pal_r17_extended_dawn':
      'Goddelijke Verheffing versterkt 2 extra vaardigheden.',
    'pal_r20_dawn_echo':
      'Elke derde directe vaardigheid die daadwerkelijk Toewijding genereert, herhaalt zijn primaire directe schade of genezing voor 40% op hetzelfde doelwit. Een effectieve echo verleent 1 Toewijding. De echo kan geen kritiek effect zijn of andere echo\'s activeren, en verleent geen Toewijding tijdens Goddelijke Verheffing.',
    'pal_r20_perpetual_sun':
      'Het verbruiken van je laatste Verheffingslading brengt 150 Heilige schade toe binnen 10 m, geneest bondgenoten binnen 20 m voor 150, en verdubbelt vervolgens 5 sec lang de Toewijding die vaardigheden genereren. Aflopen activeert dit niet.',
    'pal_r5_divine_steed':
      'Krijg 0,75% bewegingssnelheid per Toewijding, tot 15% bij 20. Het activeren van Goddelijke Verheffing verbruikt je Toewijding en verleent 5 sec lang 30% bewegingssnelheid.',
    'pal_r5_radiant_stride':
      'Hamer der Genade verleent 4 sec lang 30% bewegingssnelheid wanneer hij schade aanricht.',
    'pal_r8_recurring_grace':
      'Overgenezing van Hamer der Genade wordt een absorptieschild gedurende 10 sec, met een maximum van 10% van je maximale gezondheid.',
    'pri_r11_vampiric_embrace':
      'Een vijand die Psalm van Bescherming volledig verbruikt, wordt 2 sec lang geworteld, hoogstens eenmaal per vijand per 12 sec.',
    'pri_r14_pain_and_suffering':
      'Schade-genezing van de Leer herstelt Psalm van Bescherming met 20% van de genezing die is uitgevoerd, tot het oorspronkelijke absorptiebedrag. Zegen verandert overgenezing van Koorherstel in een absorptie van 10 sec, met een maximum van 10% maximale gezondheid. Elke Beeltenis-echo van Vesper verlengt Klaagzang van Verval met 1 sec, tot 6 sec per doelwit.',
    'pri_r20_incarnate_spirit':
      'Een volledig verbruikte Psalm van Bescherming geneest zijn doelwit voor 40% van de oorspronkelijke absorptie. De genezing van de Wake van Zegen geneest ook tot 3 groepsleden binnen 15 m voor 40%. Een Tiendduivel van Vesper met 5 stapels brengt 50% meer schade toe en houdt 50% langer stand.',
    'pri_r20_second_verse':
      'Na 2 sec herhaalt zich 40% van de genezing van Louterende Genade van de Leer, de groepsgenezing van Zegen, of de schade van de Beeltenis-echo van Vesper. De herhaling kan zichzelf niet activeren.',
    'pri_r5_improved_renew':
      'Psalm van Bescherming verleent zijn doelwit 3 sec lang 40% bewegingssnelheid.',
    'pri_r5_searing_light':
      'Sluierstap verwijdert wortels en vertragingen, en verleent daarna 3 sec lang 50% bewegingssnelheid.',
    'pri_r5_twisted_faith':
      'Sluierstap staat de Priester toe om 4 sec lang te spreuken terwijl hij beweegt.',
    'rog_r11_cheap_trick':
      'Buikstoot vereist niet langer Schemersluier.',
    'rog_r14_dusk_economy':
      'Vaardigheden kosten 50% minder energie terwijl je in Schemersluier bent of in de schaduwsluier gehuld bent, en gedurende 6 sec nadat je Schemersluier verlaat.',
    'rog_r20_kill_chain':
      'Dodelijke klappen vernieuwen Rookstap en verlenen 5 combopunten.',
    'rog_r20_second_shadow':
      'Zandslaap gespreukt bij 5 combopunten slaat opnieuw toe vanuit de schaduwen voor 75% van zijn schade.',
    'sha_r14_chain_lightning':
      'Nadat je 120 mana hebt besteed, kost je volgende Sjamaan-actie die mana kost 40 minder. Deze gereedheidstoestand heeft geen korte vervaltijd.',
    'sha_r14_improved_flame_shock':
      'Vuurmerk verleent 1 extra Donder-lading bij elke 3e Boogbliksem. Stormhartecho\'s brengen 25% meer schade toe, Steenband krijgt 5% schadevermindering, en Levensbron stort 20% meer Herstelstroom.',
    'sha_r14_weapon_fury':
      'Een geslaagde Boogbliksem, Voorouderslag of Helende Wateren herstelt 1 lading Donderwering en 10 mana, hoogstens eenmaal per 6 sec.',
    'sha_r17_elemental_warding':
      'Het activeren van Donderwering verleent 6 sec lang 40% schadevermindering. Interne afkoeltijd van 120 sec.',
    'sha_r17_improved_ghost_wolf':
      'Wanneer gereed, staat het verlaten van Schaduwwolf toe om 8 sec lang te spreuken terwijl je beweegt. Interne afkoeltijd van 90 sec.',
    'sha_r20_bloodlust':
      'Nadat Aardse Schok of Aardbeving alle Donder verbruikt, behoud je 2 Donder. Nadat een spreuk Stormteken verbruikt, behoud je 1 stap Krijgsgeestcadans. Nadat Kettinggenezing Herstelstroom verbruikt, herstel je 25% van het verbruikte bedrag.',
    'sha_r20_elemental_fury':
      'Nadat Aardse Schok of Aardbeving alle Donder verbruikt, herhaalt 40% van de schade zich na 1 sec. Een spreuk die Stormteken verbruikt, herhaalt zich op 40% sterkte. Genezing van verbruikte Herstelstroom herhaalt zich na 2 sec op 40% sterkte. Deze herhalingen kunnen geen andere effecten activeren.',
    'sha_r20_tidal_waves':
      'Nadat Aardse Schok of Aardbeving alle Donder verbruikt, maakt Vuurmerk de volgende Boogbliksem direct. De laatste echo van Stormhart brengt 50% schade toe aan tot 2 vijanden binnen 8 m. Een Steenband-spreuk die Stormteken verbruikt, verleent een absorptie gelijk aan 8% van je maximale gezondheid. Met Levensbron actief voegt Getijderoep ook 50% van zijn volledige genezing toe aan de zwaarst gewonde bondgenoot binnen 10 m.',
    'sha_r5_imbue_mastery':
      'Na het gebruiken van een Schok kan de volgende Boogbliksem of Helende Wateren die binnen 8 sec wordt gestart, worden gespreukt terwijl je beweegt.',
    'sha_r5_improved_lightning_shield':
      'Schaduwwolf betreden verleent 3 sec lang 60% bewegingssnelheid, hoogstens eenmaal per 20 sec.',
    'sha_r8_frost_bind':
      'De vergelding van Donderwering verleent 3 sec lang 10% schadevermindering.',
    'wlk_r11_demon_armor':
      'De eerste keer dat een groepslid je Soulwell aanraakt, beschermt het hen 30 sec lang met een schild van 15% van hun maximale gezondheid. Elke speler kan dit schild eenmaal per Soulwell krijgen.',
  },
  pl_PL: {
    mag_r5_blink_cast:
      'Możesz użyć Migotliwego Kroku w trakcie rzucania czaru, nie przerywając go.',
    mag_r8_temporal_rift:
      'Rzucenie osobistej bariery usuwa działające na ciebie efekty unieruchomienia.',
    mag_r17_convergence:
      'Naprzemienne użycie czaru Ognia i czaru Mrozu otwiera 8-sekundowy przypływ mocy, co najwyżej raz na 30 sek.',
    mag_r20_overflowing_power:
      'Wydawanie many skraca czas odnowienia twoich defensyw: 2 sek. za każdą dziesiątą część maksymalnej many, maksymalnie 10 sek. co 30 sek.',
    dru_r20_improved_hurricane:
      'Będąc w Postaci sowoniedźwiedzia, ty i członkowie twojej grupy w promieniu 30 jardów zyskujecie 3% szansy na krytyczne trafienie czarem.',
    war_row_second_wind: 'Poniżej 35% zdrowia regenerujesz 1,5% zdrowia na sekundę.',
    war_row_anger_management:
      'Twoje automatyczne ataki generują o 10% więcej szału, a umiejętności o 5% więcej.',
    war_row_blood_offering:
      'Twoje postawy zyskują dodatkowe efekty. Postawa bojowa: trafienia krytyczne umiejętności zadają o 15% więcej obrażeń. Postawa berserkera: automatyczne ataki są o 5% szybsze. Czujna postawa: cios, który odebrałby co najmniej 20% maksymalnego zdrowia, zadaje o 15% mniej obrażeń.',
    war_row_battle_rhythm: 'Co trzecia użyta umiejętność generuje o 20% więcej szału.',
    war_row_colossal_might:
      'Każdy wydany punkt szału skraca czas odnowienia twoich głównych umiejętności ofensywnych o 0,1 sek., maksymalnie 10 sek. co 30 sek.',
    'dru_r14_empowered_touch':
      'Nadrozkwit ponownie sadzi świeży Dziki rozkwit na każdym sojuszniku, którego leczenie zebrał.',
    'dru_r14_moonfury':
      'Księżycowy przybór i Słoneczny ślad dodatkowo przywracają po 15% twojej maksymalnej many.',
    'dru_r14_savage_fury':
      'Każde tiknięcie twoich krwawień ze Zdzierania i Rozszarpania dodaje też 1 Starą Krew.',
    'dru_r20_berserk':
      'Księżycowy przybór, Słoneczny ślad, Czerwone Żniwa, Łamacz szpiku i Nadrozkwit są o 25% silniejsze.',
    'dru_r20_tranquility':
      'Każdy 1 punkt Księżycowego przypływu, Starej Krwi lub Zieleni, który zyskujesz, przywraca 2% twojej maksymalnej many, 5 energii lub 3 wściekłości, zależnie od twojej obecnej postaci.',
    'dru_r5_ferocity':
      'Zmiana postaci przyznaje 60% prędkości ruchu na 3 sekundy, najwyżej raz na 20 sekund.',
    'dru_r5_improved_wrath':
      'Zmiana postaci usuwa przełamywalne unieruchomienia i spowolnienia.',
    'hun_r11_binding_payload':
      'Pułapka Mroźnej Paszczy unieruchamia każdego wroga w swoim obszarze wyzwolenia na 3 sekundy, a następnie spowalnia go o 40% na 4 sekundy.',
    'hun_r11_crippling_pursuit':
      'Wstrząsający strzał lub Pętające cięcie unieruchamia już spowolniony cel na 2 sekundy. Czas odnowienia na cel: 12 sekund.',
    'hun_r14_efficient_rhythm':
      'Po wydaniu 75 skupienia twój następny Rozkaz Sfory, Wyważony Strzał lub Patroszące uderzenie przyznaje 20 dodatkowego skupienia.',
    'hun_r14_guise_mastery':
      'Przez 6 sekund Postać błotniaka zwiększa generowanie skupienia o 50%, Postać kuny zmniejsza bezpośrednie obrażenia o 25%, a Postać rumaka przyznaje 50% prędkości ruchu, lub 60% z Wytrwałym Rumakiem. Wspólny czas odnowienia: 20 sekund.',
    'hun_r17_apex_instinct':
      'Bestialski gniew, Zimne Skupienie lub Szturm Krwawego Tropu przywraca 40 skupienia. Twoje następne 3 umiejętności zużywające skupienie kosztują o 50% mniej i zadają o 20% więcej obrażeń. Te zastosowania wygasają 4 sekundy po zakończeniu czasu odnowienia, który je wyzwolił.',
    'hun_r17_pack_rally':
      'Postać rumaka może wyzwolić Zbiórkę Sfory. Ty, twój towarzysz oraz sojusznicy z grupy lub rajdu w promieniu 30 m zyskują 30% prędkości ruchu i 10% szybkości ataku, rzucania i kanałowania na 10 sekund. Czas odnowienia: 90 sekund.',
    'hun_r17_shell_and_fang':
      'Pancerna Skóra pozwala na ataki i rozkazywanie zwierzęciu, ale jej redukcja obrażeń zostaje zmniejszona do 40%.',
    'hun_r20_chain_reaction':
      'Pułapka Mroźnej Paszczy oznacza wrogów w promieniu 4 m na 8 sekund. Twoje następne 3 umiejętności zużywające skupienie odbijają 40% obrażeń między oznaczonymi wrogami.',
    'hun_r20_fang_chorus':
      'Każda umiejętność zużywająca skupienie rozkazuje echu zwierzęcia o sile 50%. Co 3. echo zamienia się w uderzenie obszarowe w promieniu 4 m.',
    'hun_r20_overdraw':
      'Co 3. Plugawy strzał, Długie naciągnięcie lub Odwetowy kieł zadaje o 35% więcej obrażeń swojemu celowi oraz 50% tych obrażeń maksymalnie 2 wrogom w promieniu 5 m.',
    'hun_r5_enduring_courser':
      'Postać rumaka przyznaje 60% prędkości ruchu na 3 sekundy po aktywacji. Wewnętrzny czas odnowienia: 20 sekund.',
    'hun_r5_predators_pace':
      'Udany Rozkaz Sfory, Wyważony Strzał lub Patroszące uderzenie przyznaje 20% prędkości ruchu na 3 sekundy. Wewnętrzny czas odnowienia: 8 sekund.',
    'hun_r8_receding_shell':
      'Rzuć ponownie Pancerną Skórę, aby zakończyć ją wcześniej i odzyskać 50% jej niewykorzystanego czasu trwania, maksymalnie 45 sekund.',
    'hun_r8_shared_recovery':
      'Dzikie Serce leczy też twoje zwierzę o 30% i przyznaje wam obojgu 20% redukcji obrażeń na 4 sekundy.',
    'pal_r14_divine_purpose':
      'Umiejętności wzmocnione przez Wzniesienie mają 20% szans, by nie zużyć ładunku.',
    'pal_r14_sacred_reserve':
      'Gdy Boskie Wzniesienie się kończy, odzyskujesz 5 Oddania.',
    'pal_r14_zeal':
      'Co trzecia umiejętność, która faktycznie generuje Oddanie, przyznaje 1 dodatkowe Oddanie.',
    'pal_r17_extended_dawn':
      'Boskie Wzniesienie wzmacnia 2 dodatkowe umiejętności.',
    'pal_r20_dawn_echo':
      'Co trzecia bezpośrednia umiejętność, która faktycznie generuje Oddanie, powtarza swoje główne bezpośrednie obrażenia lub leczenie w 40% na tym samym celu. Skuteczne echo przyznaje 1 Oddanie. Echo nie może trafić krytycznie ani wyzwolić innych ech i nie przyznaje Oddania podczas Boskiego Wzniesienia.',
    'pal_r20_perpetual_sun':
      'Zużycie twojego ostatniego ładunku Wzniesienia zadaje 150 obrażeń Świętych w promieniu 10 m, leczy sojuszników w promieniu 20 m o 150, a następnie podwaja generowanie Oddania przez umiejętności na 5 sekund. Wygaśnięcie tego nie wyzwala.',
    'pal_r5_divine_steed':
      'Zyskujesz 0,75% prędkości ruchu za każde Oddanie, do 15% przy 20. Aktywacja Boskiego Wzniesienia zużywa twoje Oddanie i przyznaje 30% prędkości ruchu na 5 sekund.',
    'pal_r5_radiant_stride':
      'Młot Łaski przyznaje 30% prędkości ruchu na 4 sekundy, gdy zadaje obrażenia.',
    'pal_r8_recurring_grace':
      'Nadwyżka leczenia z Młota Łaski zamienia się w pochłaniającą tarczę na 10 sekund, ograniczoną do 10% twojego maksymalnego zdrowia.',
    'pri_r11_vampiric_embrace':
      'Wróg, który w pełni zużyje Psalm ochrony, zostaje unieruchomiony na 2 sekundy, najwyżej raz na wroga co 12 sekund.',
    'pri_r14_pain_and_suffering':
      'Leczenie z obrażeń Doktryny przywraca Psalm ochrony o 20% wykonanego leczenia, do jego pierwotnej wartości pochłaniania. Błogosławieństwo zamienia nadwyżkę leczenia z Chóralnego Uzdrowienia w 10-sekundową tarczę pochłaniającą, ograniczoną do 10% maksymalnego zdrowia. Każde echo Kukły Nieszporów przedłuża Pieśń rozkładu o 1 sekundę, maksymalnie do 6 sekund na cel.',
    'pri_r20_incarnate_spirit':
      'W pełni zużyty Psalm ochrony leczy swój cel za 40% pierwotnej wartości pochłaniania. Leczenie z Serafinowej Straży Błogosławieństwa leczy też do 3 członków drużyny w promieniu 15 m za 40%. Dziesięcinnik Nieszporów przy 5 ładunkach zadaje o 50% więcej obrażeń i trwa o 50% dłużej.',
    'pri_r20_second_verse':
      'Po 2 sekundach powtarza 40% leczenia Oczyszczającego Miłosierdzia z Doktryny, grupowego leczenia z Błogosławieństwa lub obrażeń echa Kukły z Nieszporów. Powtórzenie nie może wyzwolić samego siebie.',
    'pri_r5_improved_renew':
      'Psalm ochrony przyznaje swojemu celowi 40% prędkości ruchu na 3 sekundy.',
    'pri_r5_searing_light':
      'Krok Zasłony usuwa unieruchomienia i spowolnienia, a następnie przyznaje 50% prędkości ruchu na 3 sekundy.',
    'pri_r5_twisted_faith':
      'Krok Zasłony pozwala Kapłanowi rzucać zaklęcia podczas ruchu przez 4 sekundy.',
    'rog_r11_cheap_trick':
      'Cios w brzuch nie wymaga już Zasłony zmierzchu.',
    'rog_r14_dusk_economy':
      'Umiejętności kosztują o 50% mniej energii, gdy jesteś w Zasłonie zmierzchu lub spowity cieniem zasłony, oraz przez 6 sekund po opuszczeniu Zasłony zmierzchu.',
    'rog_r20_kill_chain':
      'Zabójcze ciosy odświeżają Dymny krok i przyznają 5 punktów combo.',
    'rog_r20_second_shadow':
      'Wieczny sen rzucony przy 5 punktach combo uderza ponownie z cienia za 75% swoich obrażeń.',
    'sha_r14_chain_lightning':
      'Po wydaniu 120 many twoje następne działanie szamana kosztujące manę kosztuje o 40 mniej. Stan gotowości nie ma krótkiego czasu wygaśnięcia.',
    'sha_r14_improved_flame_shock':
      'Piętno Ognia przyznaje 1 dodatkowy ładunek Gromu co 3. Łukowy pocisk. Echa Serca Wichru zadają o 25% więcej obrażeń, Kamienne Więzy zyskują 5% redukcji obrażeń, a Źródło Życia dodaje o 20% więcej do Nurtu Cerowania.',
    'sha_r14_weapon_fury':
      'Udany Łukowy pocisk, Uderzenie Przodków lub Kojące wody przywraca 1 ładunek Osłony gromu i 10 many, najwyżej raz na 6 sekund.',
    'sha_r17_elemental_warding':
      'Aktywacja Osłony gromu przyznaje 40% redukcji obrażeń na 6 sekund. Wewnętrzny czas odnowienia: 120 sekund.',
    'sha_r17_improved_ghost_wolf':
      'Gdy jest gotowe, opuszczenie Cieniowilka pozwala rzucać zaklęcia podczas ruchu przez 8 sekund. Wewnętrzny czas odnowienia: 90 sekund.',
    'sha_r20_bloodlust':
      'Gdy Ziemny wstrząs lub Trzęsienie ziemi zużyje cały Grom, zachowujesz 2 Gromy. Gdy zaklęcie zużyje Znak Burzy, zachowujesz 1 stopień Kadencji Ducha Wojny. Gdy Leczenie Łańcuchowe zużyje Nurt Cerowania, przywracasz 25% zużytej ilości.',
    'sha_r20_elemental_fury':
      'Gdy Ziemny wstrząs lub Trzęsienie ziemi zużyje cały Grom, powtarza 40% swoich obrażeń po 1 sekundzie. Zaklęcie, które zużywa Znak Burzy, powtarza się z siłą 40%. Leczenie ze zużytego Nurtu Cerowania powtarza się z siłą 40% po 2 sekundach. Te powtórzenia nie mogą wyzwolić innych efektów.',
    'sha_r20_tidal_waves':
      'Gdy Ziemny wstrząs lub Trzęsienie ziemi zużyje cały Grom, Piętno Ognia sprawia, że następny Łukowy pocisk jest natychmiastowy. Ostatnie echo Serca Wichru zadaje 50% obrażeń maksymalnie 2 wrogom w promieniu 8 m. Zaklęcie Kamiennych Więzów, które zużywa Znak Burzy, przyznaje pochłanianie równe 8% twojego maksymalnego zdrowia. Gdy aktywne jest Źródło Życia, Wezwanie Przypływu dodaje też 50% swojego pełnego leczenia najbardziej rannemu sojusznikowi w promieniu 10 m.',
    'sha_r5_imbue_mastery':
      'Po użyciu wstrząsu następny Łukowy pocisk lub Kojące wody rozpoczęte w ciągu 8 sekund można rzucić podczas ruchu.',
    'sha_r5_improved_lightning_shield':
      'Wejście w Cieniowilka przyznaje 60% prędkości ruchu na 3 sekundy, najwyżej raz na 20 sekund.',
    'sha_r8_frost_bind':
      'Odwet Osłony gromu przyznaje 10% redukcji obrażeń na 3 sekundy.',
    'wlk_r11_demon_armor':
      'Za pierwszym razem, gdy członek grupy skorzysta z twojego Soulwell, osłania go tarczą równą 15% jego maksymalnego zdrowia na 30 sekund. Każdy gracz może zyskać tę tarczę raz na Soulwell.',
  },
  id_ID: {
    mag_r5_blink_cast:
      'Kamu dapat menggunakan Langkah Kilat di tengah rapalan tanpa mengganggunya.',
    mag_r8_temporal_rift:
      'Merapalkan penghalang pribadimu menghapus efek akar yang sedang memengaruhimu.',
    mag_r17_convergence:
      'Bergantian menggunakan mantra Api dan Beku membuka lonjakan kekuatan selama 8 dtk, satu kali setiap 30 dtk.',
    mag_r20_overflowing_power:
      'Menghabiskan mana mempersingkat waktu pemulihan bertahanmu: 2 dtk per sepersepuluh mana maksimum yang dihabiskan, hingga 10 dtk setiap 30 dtk.',
    dru_r20_improved_hurricane:
      'Saat dalam Wujud Moonkin, kamu dan anggota partaimu dalam jarak 30 m mendapat peningkatan 3% peluang serangan kritikal mantra.',
    war_row_second_wind: 'Saat nyawamu di bawah 35%, kamu memulihkan 1,5% nyawa setiap detik.',
    war_row_anger_management:
      'Serangan otomatismu menghasilkan 10% lebih banyak amarah dan kemampuanmu 5% lebih banyak.',
    war_row_blood_offering:
      'Kuda-kudamu memperoleh efek tambahan. Kuda-kuda Tempur: serangan kritis kemampuanmu menghasilkan 15% lebih banyak kerusakan. Kuda-kuda Berserker: serangan otomatismu 5% lebih cepat. Kuda-kuda Waspada: serangan yang akan mengurangi setidaknya 20% nyawa maksimummu menghasilkan 15% lebih sedikit kerusakan.',
    war_row_battle_rhythm:
      'Setiap kemampuan ketiga yang kamu gunakan menghasilkan 20% lebih banyak amarah.',
    war_row_colossal_might:
      'Setiap poin amarah yang kamu habiskan mempersingkat waktu pemulihan kemampuan ofensif utamamu sebesar 0,1 dtk, hingga 10 dtk setiap 30 dtk.',
    'dru_r14_empowered_touch':
      'Mekar Raya menanam kembali Mekar Liar segar pada setiap sekutu yang penyembuhannya dipanen.',
    'dru_r14_moonfury':
      'Gelombang Rembulan dan Jejak Surya masing-masing juga memulihkan 15% dari mana maksimummu.',
    'dru_r14_savage_fury':
      'Setiap denyut pendarahan Kupasan dan Robekanmu juga menambah 1 Darah Tua.',
    'dru_r20_berserk':
      'Gelombang Rembulan, Jejak Surya, Panen Merah, Pematah Sumsum, dan Mekar Raya menjadi 25% lebih kuat.',
    'dru_r20_tranquility':
      'Setiap 1 Pasang Rembulan, Darah Tua, atau Kehijauan yang kamu peroleh memulihkan 2% dari mana maksimummu, 5 energi, atau 3 amarah, sesuai wujudmu saat ini.',
    'dru_r5_ferocity':
      'Berubah wujud memberi 60% kecepatan gerak selama 3 dtk, paling banyak sekali setiap 20 dtk.',
    'dru_r5_improved_wrath':
      'Berubah wujud menghapus akar dan pelambatan yang bisa diputus.',
    'hun_r11_binding_payload':
      'Jerat Rahang Beku mengakar setiap musuh di area pemicunya selama 3 dtk, lalu memperlambat mereka sebesar 40% selama 4 dtk.',
    'hun_r11_crippling_pursuit':
      'Tembakan Pengguncang atau Tebasan Pembelenggu mengakar target yang sudah diperlambat selama 2 dtk. Jeda per target 12 dtk.',
    'hun_r14_efficient_rhythm':
      'Setelah menghabiskan 75 fokus, Perintah Kawanan, Tembakan Terukur, atau Serangan Cabik Perut berikutnya memberi 20 fokus tambahan.',
    'hun_r14_guise_mastery':
      'Selama 6 dtk, Wujud Elang Penyambar meningkatkan penghasilan fokus sebesar 50%, Wujud Musang mengurangi kerusakan langsung sebesar 25%, dan Wujud Kuda Pacu memberi 50% kecepatan gerak, atau 60% dengan Kuda Pacu Abadi. Jeda bersama 20 dtk.',
    'hun_r17_apex_instinct':
      'Murka Buas, Fokus Dingin, atau Serbuan Jejak Darah memulihkan 40 fokus. 3 kemampuan penghabis fokus berikutnya menghabiskan 50% lebih sedikit dan memberikan 20% kerusakan lebih besar. Penggunaan ini kedaluwarsa 4 dtk setelah jeda pemicunya berakhir.',
    'hun_r17_pack_rally':
      'Wujud Kuda Pacu dapat memicu Pengumpulan Kawanan. Kamu, pendampingmu, dan sekutu grup atau raid dalam radius 30 m memperoleh 30% kecepatan gerak dan 10% kecepatan serang, rapal, dan saluran selama 10 dtk. Jeda 90 dtk.',
    'hun_r17_shell_and_fang':
      'Kulit Cangkang mengizinkan serangan dan perintah peliharaan, tetapi pengurangan kerusakannya berkurang menjadi 40%.',
    'hun_r20_chain_reaction':
      'Jerat Rahang Beku menandai musuh dalam radius 4 m selama 8 dtk. 3 kemampuan penghabis fokus berikutnya menggemakan 40% kerusakan di antara musuh yang ditandai.',
    'hun_r20_fang_chorus':
      'Setiap kemampuan penghabis fokus memerintahkan gema peliharaan berkekuatan 50%. Setiap gema ke-3 menjadi ledakan dengan radius 4 m.',
    'hun_r20_overdraw':
      'Setiap Tembakan Bengis, Tarikan Panjang, atau Taring Balasan ke-3 memberikan 35% kerusakan lebih besar kepada targetnya dan 50% dari kerusakan itu kepada hingga 2 musuh dalam radius 5 m.',
    'hun_r5_enduring_courser':
      'Wujud Kuda Pacu memberi 60% kecepatan gerak selama 3 dtk saat diaktifkan. Jeda internal 20 dtk.',
    'hun_r5_predators_pace':
      'Perintah Kawanan, Tembakan Terukur, atau Serangan Cabik Perut yang berhasil memberi 20% kecepatan gerak selama 3 dtk. Jeda internal 8 dtk.',
    'hun_r8_receding_shell':
      'Rapal ulang Kulit Cangkang untuk mengakhirinya lebih awal dan mengembalikan 50% dari durasi yang belum terpakai, hingga 45 dtk.',
    'hun_r8_shared_recovery':
      'Hati Liar juga menyembuhkan peliharaanmu sebesar 30% dan memberi kalian berdua 20% pengurangan kerusakan selama 4 dtk.',
    'pal_r14_divine_purpose':
      'Kemampuan yang diberdayakan Kenaikan memiliki peluang 20% untuk tidak menghabiskan muatan.',
    'pal_r14_sacred_reserve':
      'Saat Kenaikan Ilahi berakhir, peroleh kembali 5 Pengabdian.',
    'pal_r14_zeal':
      'Setiap kemampuan ketiga yang benar-benar menghasilkan Pengabdian memberi 1 Pengabdian tambahan.',
    'pal_r17_extended_dawn':
      'Kenaikan Ilahi memberdayakan 2 kemampuan tambahan.',
    'pal_r20_dawn_echo':
      'Setiap kemampuan langsung ketiga yang benar-benar menghasilkan Pengabdian mengulangi kerusakan atau penyembuhan langsung utamanya sebesar 40% pada sasaran yang sama. Gema yang efektif memberi 1 Pengabdian. Gema ini tidak dapat menjadi pukulan kritis atau memicu gema lain, dan tidak memberi Pengabdian selama Kenaikan Ilahi.',
    'pal_r20_perpetual_sun':
      'Menghabiskan muatan Kenaikan terakhirmu memberikan 150 kerusakan Suci dalam radius 10 m, menyembuhkan sekutu dalam radius 20 m sebesar 150, lalu menggandakan penghasilan Pengabdian dari kemampuan selama 5 dtk. Habis masa berlaku tidak memicunya.',
    'pal_r5_divine_steed':
      'Memperoleh 0,75% kecepatan gerak per Pengabdian, hingga 15% pada 20. Mengaktifkan Kenaikan Ilahi menghabiskan Pengabdianmu dan memberi 30% kecepatan gerak selama 5 dtk.',
    'pal_r5_radiant_stride':
      'Palu Karunia memberi 30% kecepatan gerak selama 4 dtk saat memberikan kerusakan.',
    'pal_r8_recurring_grace':
      'Kelebihan penyembuhan Palu Karunia menjadi perisai penyerap selama 10 dtk, dibatasi hingga 10% dari nyawa maksimummu.',
    'pri_r11_vampiric_embrace':
      'Musuh yang menghabiskan seluruh Mazmur Penangkal akan terakar selama 2 dtk, sekali per musuh setiap 12 dtk.',
    'pri_r14_pain_and_suffering':
      'Penyembuhan-kerusakan Doktrin memulihkan Mazmur Penangkal sebesar 20% dari penyembuhan yang diberikan, hingga penyerapan awalnya. Berkat mengubah kelebihan penyembuhan Penyembuhan Koor menjadi penyerap 10 dtk yang dibatasi hingga 10% nyawa maksimum. Setiap gema Patung Vesper memperpanjang Ratapan Pembusukan selama 1 dtk, hingga 6 dtk per target.',
    'pri_r20_incarnate_spirit':
      'Mazmur Penangkal yang habis terpakai sepenuhnya menyembuhkan targetnya sebesar 40% dari penyerapan awalnya. Penyembuhan Jaga dari Berkat juga menyembuhkan hingga 3 anggota grup dalam radius 15 m sebesar 40%. Iblis Persepuluhan Vesper pada 5 tumpukan memberikan 50% kerusakan lebih besar dan bertahan 50% lebih lama.',
    'pri_r20_second_verse':
      'Setelah 2 dtk, ulangi 40% dari penyembuhan Belas Kasih Pembersih dari Doktrin, penyembuhan grup dari Berkat, atau kerusakan gema Patung dari Vesper. Pengulangan ini tidak dapat memicu dirinya sendiri.',
    'pri_r5_improved_renew':
      'Mazmur Penangkal memberi targetnya 40% kecepatan gerak selama 3 dtk.',
    'pri_r5_searing_light':
      'Langkah Tabir menghapus akar dan pelambatan, lalu memberi 50% kecepatan gerak selama 3 dtk.',
    'pri_r5_twisted_faith':
      'Langkah Tabir mengizinkan Pendeta merapal sambil bergerak selama 4 dtk.',
    'rog_r11_cheap_trick':
      'Pukulan Ulu Hati tidak lagi membutuhkan Selubung Senja.',
    'rog_r14_dusk_economy':
      'Kemampuan menghabiskan 50% lebih sedikit energi selagi dalam Selubung Senja atau diselimuti bayangan oleh Tabir Bayangan, dan selama 6 dtk setelah keluar dari Selubung Senja.',
    'rog_r20_kill_chain':
      'Pukulan pembunuh menyegarkan Langkah Asap dan memberi 5 poin combo.',
    'rog_r20_second_shadow':
      'Tidur Abadi yang dirapal pada 5 poin combo menyerang lagi dari bayangan sebesar 75% dari kerusakannya.',
    'sha_r14_chain_lightning':
      'Setelah menghabiskan 120 Mana, tindakan Dukun berikutnya yang berbiaya Mana menghabiskan 40 lebih sedikit. Kesiapan ini tidak kedaluwarsa dengan cepat.',
    'sha_r14_improved_flame_shock':
      'Tanda Bara memberi 1 muatan Guruh tambahan setiap Sambaran Busur ke-3. Gema Hati Badai memberikan 25% kerusakan lebih besar, Ikatan Batu memperoleh 5% pengurangan kerusakan, dan Mata Air Kehidupan menambahkan 20% lebih banyak Arus Pemulih.',
    'sha_r14_weapon_fury':
      'Sambaran Busur, Serangan Leluhur, atau Air Pemulih yang berhasil memulihkan 1 muatan Tameng Guntur dan 10 Mana, sekali setiap 6 dtk.',
    'sha_r17_elemental_warding':
      'Mengaktifkan Tameng Guntur memberi 40% pengurangan kerusakan selama 6 dtk. Jeda internal 120 dtk.',
    'sha_r17_improved_ghost_wolf':
      'Saat siap, keluar dari Serigala Bayang mengizinkan merapal sambil bergerak selama 8 dtk. Jeda internal 90 dtk.',
    'sha_r20_bloodlust':
      'Setelah Sentakan Bumi atau Gempa Bumi menghabiskan seluruh Guruh, pertahankan 2 Guruh. Setelah sebuah mantra mengonsumsi Pertanda Badai, pertahankan 1 tahap Irama Roh Perang. Setelah Penyembuhan Berantai mengonsumsi Arus Pemulih, pulihkan 25% dari jumlah yang dikonsumsi.',
    'sha_r20_elemental_fury':
      'Setelah Sentakan Bumi atau Gempa Bumi menghabiskan seluruh Guruh, ulangi 40% dari kerusakannya setelah 1 dtk. Mantra yang mengonsumsi Pertanda Badai berulang pada kekuatan 40%. Penyembuhan dari Arus Pemulih yang dikonsumsi berulang pada kekuatan 40% setelah 2 dtk. Pengulangan ini tidak dapat memicu efek lain.',
    'sha_r20_tidal_waves':
      'Setelah Sentakan Bumi atau Gempa Bumi menghabiskan seluruh Guruh, Tanda Bara membuat Sambaran Busur berikutnya seketika. Gema terakhir Hati Badai memberikan 50% kerusakan kepada hingga 2 musuh dalam radius 8 m. Mantra Ikatan Batu yang mengonsumsi Pertanda Badai memberi penyerap setara 8% dari nyawa maksimummu. Dengan Mata Air Kehidupan aktif, Panggilan Pasang juga menambahkan 50% dari penyembuhan penuhnya kepada sekutu yang paling terluka dalam radius 10 m.',
    'sha_r5_imbue_mastery':
      'Setelah memakai Sentakan, Sambaran Busur atau Air Pemulih berikutnya yang dimulai dalam 8 dtk dapat dirapal sambil bergerak.',
    'sha_r5_improved_lightning_shield':
      'Memasuki Serigala Bayang memberi 60% kecepatan gerak selama 3 dtk, sekali setiap 20 dtk.',
    'sha_r8_frost_bind':
      'Balasan Tameng Guntur memberi 10% pengurangan kerusakan selama 3 dtk.',
    'wlk_r11_demon_armor':
      'Saat setiap anggota grup pertama kali menyentuh Soulwell-mu, mereka mendapat perisai sebesar 15% dari nyawa maksimum selama 30 dtk. Setiap pemain hanya dapat memperoleh perisai ini sekali per Soulwell.',
  },
  tr_TR: {
    mag_r5_blink_cast:
      "Titreşim Adımı'nı bir büyüyü kesmeden kanalizasyon ortasında kullanabilirsin.",
    mag_r8_temporal_rift: 'Kişisel bariyerini kullanmak üzerindeki köklenme etkilerini kaldırır.',
    mag_r17_convergence:
      'Bir Ateş ve bir Buz büyüsünü art arda atmak, 30 saniyede bir olmak kaydıyla 8 saniyelik bir güç dalgası açar.',
    mag_r20_overflowing_power:
      'Mana harcamak savunma yeteneklerinin bekleme süresini kısaltır: harcanan azami manandan her onda biri için 2 saniye, 30 saniyede en fazla 10 saniye.',
    dru_r20_improved_hurricane:
      "Ay Kuşu Formu'ndayken sen ve 30 yarda yakınındaki grup üyeleri %3 büyü kritik vuruş şansı kazanır.",
    war_row_second_wind: 'Sağlığın %35’in altındayken her saniye sağlığının %1,5’ini yenilersin.',
    war_row_anger_management: 'Otomatik saldırıların %10, yeteneklerin %5 daha fazla öfke üretir.',
    war_row_blood_offering:
      'Duruşların ek etkiler kazanır. Savaş Duruşu: yeteneklerinin kritik vuruşları %15 daha fazla hasar verir. Berserker Duruşu: otomatik saldırıların %5 daha hızlıdır. Korumalı Duruş: azami sağlığının en az %20’sini götürecek bir darbe %15 daha az hasar verir.',
    war_row_battle_rhythm: 'Kullandığın her üçüncü yetenek %20 daha fazla öfke üretir.',
    war_row_colossal_might:
      'Harcadığın her öfke puanı, büyük saldırı yeteneklerinin bekleme süresini 0,1 saniye kısaltır; 30 saniyede en fazla 10 saniye.',
    'dru_r14_empowered_touch':
      'Taşkın Çiçeklenme, iyileştirmesini hasat ettiği her müttefike taze bir Yaban Çiçeği yeniden diker.',
    'dru_r14_moonfury':
      'Ay Kabarışı ve Güneş İzi ayrıca azami mananın %15\'ini geri kazandırır.',
    'dru_r14_savage_fury':
      'Deri Yüzme ve Parçalama kanamalarının her turu da 1 Kadim Kan ekler.',
    'dru_r20_berserk':
      'Ay Kabarışı, Güneş İzi, Kızıl Hasat, İlik Kıran ve Taşkın Çiçeklenme %25 daha güçlüdür.',
    'dru_r20_tranquility':
      'Kazandığın her 1 Ay Gelgiti, Kadim Kan veya Yeşillik, mevcut formuna uygun şekilde azami mananın %2\'sini, 5 enerjiyi ya da 3 öfkeyi geri kazandırır.',
    'dru_r5_ferocity':
      'Şekil değiştirmek 3 sn boyunca %60 hareket hızı kazandırır, en fazla 20 sn\'de bir.',
    'dru_r5_improved_wrath':
      'Şekil değiştirmek kırılabilir kökleri ve yavaşlatmaları kaldırır.',
    'hun_r11_binding_payload':
      'Buzçene Tuzağı, tetiklendiği alandaki her düşmanı 3 sn kökler, ardından 4 sn boyunca %40 yavaşlatır.',
    'hun_r11_crippling_pursuit':
      'Sarsıcı Atış veya Prangalayan Kesik, zaten yavaşlamış bir hedefi 2 sn kökler. Hedef başına 12 sn\'lik bekleme süresi.',
    'hun_r14_efficient_rhythm':
      'Bir sonraki 75 Odak harcadıktan sonra, Sürü Emri, Ölçülü Atış veya Deşen Darben 20 ekstra Odak kazandırır.',
    'hun_r14_guise_mastery':
      '6 sn boyunca, Delice Sureti Odak üretimini %50 artırır, Sansar Sureti doğrudan hasarı %25 azaltır ve Küheylan Sureti %50 hareket hızı kazandırır, Dayanıklı Küheylan ile %60. 20 sn\'lik paylaşılan bekleme süresi.',
    'hun_r17_apex_instinct':
      'Vahşi Gazap, Soğuk Odak veya Kan İzi Saldırısı 40 Odak geri kazandırır. Sonraki 3 Odak harcayan yeteneğin %50 daha az mal olur ve %20 daha fazla hasar verir. Bu kullanımlar, tetikleyen bekleme süresi bittikten 4 sn sonra sona erer.',
    'hun_r17_pack_rally':
      'Küheylan Sureti, Sürü Toplanmasını tetikleyebilir. Sen, yoldaşın ve 30 yarda içindeki grup veya akın müttefikleri 10 sn boyunca %30 hareket hızı ve %10 saldırı, okuma ve kanal hızı kazanır. 90 sn\'lik bekleme süresi.',
    'hun_r17_shell_and_fang':
      'Kabuk Deri saldırılara ve evcil hayvan komutlarına izin verir, ama hasar azaltımı %40\'a düşer.',
    'hun_r20_chain_reaction':
      'Buzçene Tuzağı, 4 yarda içindeki düşmanları 8 sn boyunca işaretler. Sonraki 3 Odak harcayan yeteneğin, işaretli düşmanlar arasında %40 hasar yankılar.',
    'hun_r20_fang_chorus':
      'Her Odak harcayan yetenek, %50 güçte bir evcil hayvan yankısı emreder. Her 3. yankı 4 yardalık bir sarsmaya dönüşür.',
    'hun_r20_overdraw':
      'Her 3. Uğursuz Atış, Uzun Çekiş veya Karşı Diş, hedefine %35 daha fazla hasar verir ve bu hasarın %50\'sini 5 yarda içindeki en fazla 2 düşmana verir.',
    'hun_r5_enduring_courser':
      'Küheylan Sureti etkinleştirildiğinde 3 sn boyunca %60 hareket hızı kazandırır. 20 sn\'lik dahili bekleme süresi.',
    'hun_r5_predators_pace':
      'Başarılı bir Sürü Emri, Ölçülü Atış veya Deşen Darbe 3 sn boyunca %20 hareket hızı kazandırır. 8 sn\'lik dahili bekleme süresi.',
    'hun_r8_receding_shell':
      'Kabuk Deriyi erken bitirmek için yeniden oku; kullanılmayan süresinin %50\'sini geri kazandırır, en fazla 45 sn.',
    'hun_r8_shared_recovery':
      'Yaban Yürek ayrıca evcil hayvanını %30 iyileştirir ve ikinize de 4 sn boyunca %20 hasar azaltımı kazandırır.',
    'pal_r14_divine_purpose':
      'Yüceliş tarafından güçlendirilen yetenekler, %20 ihtimalle bir şarj tüketmez.',
    'pal_r14_sacred_reserve':
      'Kutsal Yüceliş sona erdiğinde, 5 Adanmışlık geri kazan.',
    'pal_r14_zeal':
      'Gerçekten Adanmışlık üreten her üçüncü yetenek 1 ekstra Adanmışlık kazandırır.',
    'pal_r17_extended_dawn':
      'Kutsal Yüceliş 2 ek yeteneği güçlendirir.',
    'pal_r20_dawn_echo':
      'Gerçekten Adanmışlık üreten her üçüncü doğrudan yetenek, birincil doğrudan hasarını veya iyileştirmesini aynı hedefte %40 güçte tekrarlar. Etkili bir yankı 1 Adanmışlık kazandırır. Yankı kritik vuramaz veya başka yankıları tetikleyemez ve Kutsal Yüceliş sırasında Adanmışlık kazandırmaz.',
    'pal_r20_perpetual_sun':
      'Son Yüceliş şarjını tüketmek, 10 m içinde 150 Kutsal hasar verir, 20 m içindeki müttefikleri 150 iyileştirir, ardından 5 sn boyunca yetenek Adanmışlık üretimini ikiye katlar. Süre dolması bunu tetiklemez.',
    'pal_r5_divine_steed':
      'Adanmışlık başına %0,75 hareket hızı kazan, 20\'de en fazla %15. Kutsal Yücelişi etkinleştirmek Adanmışlığını harcar ve 5 sn boyunca %30 hareket hızı kazandırır.',
    'pal_r5_radiant_stride':
      'Lütuf Çekici hasar verdiğinde 4 sn boyunca %30 hareket hızı kazandırır.',
    'pal_r8_recurring_grace':
      'Lütuf Çekicinin fazla iyileştirmesi, azami canının %10\'uyla sınırlı 10 sn\'lik bir emme kalkanına dönüşür.',
    'pri_r11_vampiric_embrace':
      'Koruma Mezmurunu tamamen tüketen bir düşman 2 sn köklenir, düşman başına en fazla 12 sn\'de bir.',
    'pri_r14_pain_and_suffering':
      'Öğretinin hasar-iyileştirmesi, Koruma Mezmurunu verilen iyileştirmenin %20\'si kadar geri kazandırır, orijinal emme miktarına kadar. Lütuf, Koro Şifasının fazla iyileştirmesini azami canın %10\'uyla sınırlı 10 sn\'lik bir emmeye dönüştürür. Her Akşam Duası Heykel yankısı, Çürüme Ağıdını hedef başına en fazla 6 sn\'ye kadar 1 sn uzatır.',
    'pri_r20_incarnate_spirit':
      'Tamamen tüketilen bir Koruma Mezmuru, hedefini orijinal emme miktarının %40\'ı kadar iyileştirir. Lütuf Nöbeti iyileştirmesi ayrıca 15 yarda içindeki en fazla 3 grup üyesini %40 iyileştirir. 5 katmanlı bir Akşam Duası Öşür İfriti %50 daha fazla hasar verir ve %50 daha uzun sürer.',
    'pri_r20_second_verse':
      '2 sn sonra, Öğretiden gelen Arındıran Merhamet iyileştirmesinin, Lütuftan gelen grup iyileştirmesinin ya da Akşam Duasından gelen Heykel yankı hasarının %40\'ını tekrarlar. Tekrar kendini tetikleyemez.',
    'pri_r5_improved_renew':
      'Koruma Mezmuru, hedefine 3 sn boyunca %40 hareket hızı kazandırır.',
    'pri_r5_searing_light':
      'Perde Adımı kökleri ve yavaşlatmaları kaldırır, ardından 3 sn boyunca %50 hareket hızı kazandırır.',
    'pri_r5_twisted_faith':
      'Perde Adımı, Rahibin 4 sn boyunca hareket ederken büyü okumasına izin verir.',
    'rog_r11_cheap_trick':
      'Mide Yumruğu artık Alacakaranlık Perdesi gerektirmez.',
    'rog_r14_dusk_economy':
      'Alacakaranlık Perdesindeyken ya da perdenin gölgesine bürünmüşken, ve Alacakaranlık Perdesinden çıktıktan sonraki 6 sn boyunca, yetenekler %50 daha az enerji harcar.',
    'rog_r20_kill_chain':
      'Öldürücü darbeler Duman Adımını yeniler ve 5 kombo puanı kazandırır.',
    'rog_r20_second_shadow':
      '5 kombo puanında okunan Toprak Uykusu, gölgelerden hasarının %75\'i kadar tekrar vurur.',
    'sha_r14_chain_lightning':
      'Mana harcayan bir sonraki Şaman eylemin, 120 Mana harcadıktan sonra 40 daha az mana harcar. Hazır durum kısa sürede sona ermez.',
    'sha_r14_improved_flame_shock':
      'Ateş Damgası her 3. Ark Okunda 1 ekstra Gök Gürültüsü şarjı kazandırır. Fırtına Yüreği yankıları %25 daha fazla hasar verir, Taş Bağı %5 hasar azaltımı kazanır ve Yaşam Pınarı Onarım Akıntısına %20 daha fazla ekler.',
    'sha_r14_weapon_fury':
      'Başarılı bir Ark Oku, Ata Vuruşu veya Onaran Sular, en fazla 6 sn\'de bir 1 Gök Gürültüsü Siperi şarjı ve 10 Mana geri kazandırır.',
    'sha_r17_elemental_warding':
      'Gök Gürültüsü Siperini etkinleştirmek 6 sn boyunca %40 hasar azaltımı kazandırır. 120 sn\'lik dahili bekleme süresi.',
    'sha_r17_improved_ghost_wolf':
      'Hazır olduğunda, Shadewolf\'tan çıkmak 8 sn boyunca hareket ederken büyü okumana izin verir. 90 sn\'lik dahili bekleme süresi.',
    'sha_r20_bloodlust':
      'Toprak Sarsıntısı veya Deprem tüm Gök Gürültüsünü tükettikten sonra, 2 Gök Gürültüsü korunur. Bir büyü Fırtına Alametini tükettikten sonra, 1 Savaş Ruhu Ritmi adımı korunur. Zincirleme İyileştirme, Onarım Akıntısını tükettikten sonra, tüketilen miktarın %25\'ini geri kazandırır.',
    'sha_r20_elemental_fury':
      'Toprak Sarsıntısı veya Deprem tüm Gök Gürültüsünü tükettikten sonra, 1 sn sonra hasarının %40\'ını tekrarlar. Fırtına Alametini tüketen bir büyü %40 güçte tekrarlanır. Tüketilen Onarım Akıntısından gelen iyileştirme, 2 sn sonra %40 güçte tekrarlanır. Bu tekrarlar başka etkileri tetikleyemez.',
    'sha_r20_tidal_waves':
      'Toprak Sarsıntısı veya Deprem tüm Gök Gürültüsünü tükettikten sonra, Ateş Damgası bir sonraki Ark Okunu anlık yapar. Fırtına Yüreğinin son yankısı, 8 yarda içindeki en fazla 2 düşmana %50 hasar verir. Fırtına Alametini tüketen bir Taş Bağı büyüsü, azami canının %8\'ine eşit bir emme kazandırır. Yaşam Pınarı etkinken, Gelgit Çağrısı ayrıca tam iyileştirmesinin %50\'sini 10 yarda içindeki en çok yaralı müttefike ekler.',
    'sha_r5_imbue_mastery':
      'Bir Toprak Sarsıntısı kullandıktan sonra, 8 sn içinde başlatılan bir sonraki Ark Oku veya Onaran Sular hareket halindeyken okunabilir.',
    'sha_r5_improved_lightning_shield':
      'Shadewolf\'a girmek, 3 sn boyunca %60 hareket hızı kazandırır, en fazla 20 sn\'de bir.',
    'sha_r8_frost_bind':
      'Gök Gürültüsü Siperinin misillemesi 3 sn boyunca %10 hasar azaltımı kazandırır.',
    'wlk_r11_demon_armor':
      'Her grup üyesi Ruh Kuyuna ilk kez dokunduğunda, 30 sn boyunca azami canının %15\'i kadar onu kalkanlar. Her oyuncu bu kalkanı Ruh Kuyusu başına yalnızca bir kez kazanabilir.',
  },
  sv_SE: {
    mag_r5_blink_cast: 'Du kan använda Flimmersteg mitt i en besvärjelse utan att avbryta den.',
    mag_r8_temporal_rift: 'När du kastar din personliga barriär bryts rotningseffekter på dig.',
    mag_r17_convergence:
      'Att växelvis kasta en Eld- och en Frost-besvärjelse öppnar ett 8 sek långt kraftflöde, högst en gång var 30:e sek.',
    mag_r20_overflowing_power:
      'Manaförbrukning kortar ned dina defensivars nedkylningar: 2 sek per tiondel av ditt maximala manaförråd som förbrukas, högst 10 sek var 30:e sek.',
    dru_r20_improved_hurricane:
      'I Månfågelform får du och dina gruppmedlemmar inom 30 m 3 % chans till magisk kritisk träff.',
    war_row_second_wind: 'Under 35 % hälsa återställer du 1,5 % av din hälsa per sekund.',
    war_row_anger_management:
      'Dina automatiska attacker genererar 10 % mer raseri och dina förmågor 5 % mer.',
    war_row_blood_offering:
      'Dina ställningar får ytterligare effekter. Stridsställning: kritiska träffar med förmågor gör 15 % mer skada. Bärsärkaställning: dina automatiska attacker är 5 % snabbare. Gardställning: en träff som skulle ta minst 20 % av din maximala hälsa gör 15 % mindre skada.',
    war_row_battle_rhythm: 'Var tredje förmåga du använder genererar 20 % mer raseri.',
    war_row_colossal_might:
      'Varje raserienhet du förbrukar kortar ned nedkylningen på dina stora anfallsförmågor med 0,1 sek, högst 10 sek var 30:e sek.',
    'dru_r14_empowered_touch':
      'Överblomning planterar en färsk Vildblomning på varje allierad vars läkning den skördade.',
    'dru_r14_moonfury':
      'Månsvall och Solspår återställer även 15% av din maximala mana vardera.',
    'dru_r14_savage_fury':
      'Varje tick av dina blödningar från Flå och Riv upp lägger också till 1 Gammalt Blod.',
    'dru_r20_berserk':
      'Månsvall, Solspår, Röd Skörd, Märgbräckare och Överblomning är 25% starkare.',
    'dru_r20_tranquility':
      'Varje 1 Månflod, Gammalt Blod eller Grönska du får återställer 2% av din maximala mana, 5 energi eller 3 raseri, i enlighet med din nuvarande form.',
    'dru_r5_ferocity':
      'Att skifta gestalt ger 60% förflyttningshastighet i 3 sek, högst en gång var 20:e sek.',
    'dru_r5_improved_wrath':
      'Att skifta gestalt tar bort brytbara rötter och nedsaktningar.',
    'hun_r11_binding_payload':
      'Frostkäftsfälla rotar fast varje fiende i sitt utlösningsområde i 3 sek, och saktar sedan ner dem med 40% i 4 sek.',
    'hun_r11_crippling_pursuit':
      'Skakande skott eller Fjättrande hugg rotar fast ett redan nedsaktat mål i 2 sek. 12 sekunders nedkylning per mål.',
    'hun_r14_efficient_rhythm':
      'Efter att ha förbrukat 75 fokus ger ditt nästa Flockbefallning, Avvägt skott eller Uppsprättande hugg 20 extra fokus.',
    'hun_r14_guise_mastery':
      'I 6 sek ökar Kärrhökens skepnad fokusgenereringen med 50%, Mårdens skepnad minskar direktskada med 25%, och Springarens skepnad ger 50% förflyttningshastighet, eller 60% med Uthållig Springare. 20 sekunders delad nedkylning.',
    'hun_r17_apex_instinct':
      'Bestialisk vrede, Kallt fokus eller Blodspårsanfall återställer 40 fokus. Dina nästa 3 fokusförbrukande förmågor kostar 50% mindre och gör 20% mer skada. Dessa användningar upphör 4 sek efter att den utlösande nedkylningen tar slut.',
    'hun_r17_pack_rally':
      'Springarens skepnad kan utlösa Flocksamling. Du, ditt husdjur och grupp- eller rädallierade inom 30 meter får 30% förflyttningshastighet och 10% attack-, kast- och kanaliseringshastighet i 10 sek. 90 sekunders nedkylning.',
    'hun_r17_shell_and_fang':
      'Skalhud tillåter attacker och husdjursbefallningar, men dess skadereducering minskas till 40%.',
    'hun_r20_chain_reaction':
      'Frostkäftsfälla märker fiender inom 4 meter i 8 sek. Dina nästa 3 fokusförbrukande förmågor ekar 40% skada mellan märkta fiender.',
    'hun_r20_fang_chorus':
      'Varje fokusförbrukande förmåga befaller ett husdjurseko med 50% styrka. Var 3:e eko blir en smäll på 4 meter.',
    'hun_r20_overdraw':
      'Var 3:e Ondskeskott, Långt drag eller Mothugg gör 35% mer skada mot sitt mål och 50% av den skadan till upp till 2 fiender inom 5 meter.',
    'hun_r5_enduring_courser':
      'Springarens skepnad ger 60% förflyttningshastighet i 3 sek när den aktiveras. 20 sekunders intern nedkylning.',
    'hun_r5_predators_pace':
      'En lyckad Flockbefallning, Avvägt skott eller Uppsprättande hugg ger 20% förflyttningshastighet i 3 sek. 8 sekunders intern nedkylning.',
    'hun_r8_receding_shell':
      'Kasta Skalhud igen för att avsluta den i förtid och återbetala 50% av dess oanvända varaktighet, upp till 45 sek.',
    'hun_r8_shared_recovery':
      'Vildhjärta läker även ditt husdjur för 30% och ger er båda 20% minskad mottagen skada i 4 sek.',
    'pal_r14_divine_purpose':
      'Upphöjelse-förstärkta förmågor har 20% chans att inte förbruka en laddning.',
    'pal_r14_sacred_reserve':
      'När Gudomlig upphöjelse tar slut, återfå 5 hängivenhet.',
    'pal_r14_zeal':
      'Var tredje förmåga som faktiskt genererar hängivenhet ger 1 extra hängivenhet.',
    'pal_r17_extended_dawn':
      'Gudomlig upphöjelse förstärker 2 ytterligare förmågor.',
    'pal_r20_dawn_echo':
      'Var tredje direkt förmåga som faktiskt genererar hängivenhet upprepar sin primära direktskada eller läkning med 40% på samma mål. Ett verksamt eko ger 1 hängivenhet. Ekot kan inte kritisk träffa eller utlösa andra ekon, och ger ingen hängivenhet under Upphöjelse.',
    'pal_r20_perpetual_sun':
      'Att förbruka din sista upphöjelseladdning vållar 150 helig skada inom 10 m, läker allierade inom 20 m för 150, och fördubblar sedan förmågors hängivenhetsgenerering i 5 sek. Utgång utlöser den inte.',
    'pal_r5_divine_steed':
      'Få 0,75% förflyttningshastighet per hängivenhet, upp till 15% vid 20. Att aktivera Gudomlig upphöjelse förbrukar din hängivenhet och ger 30% förflyttningshastighet i 5 sek.',
    'pal_r5_radiant_stride':
      'Nådens hammare ger 30% förflyttningshastighet i 4 sek när den vållar skada.',
    'pal_r8_recurring_grace':
      'Nådens hammares överläkning blir en absorptionssköld i 10 sek, begränsad till 10% av din maximala hälsa.',
    'pri_r11_vampiric_embrace':
      'En fiende som helt förbrukar Värnpsalm rotas fast i 2 sek, en gång per fiende var 12:e sek.',
    'pri_r14_pain_and_suffering':
      'Läras skadeläkning återställer Värnpsalm med 20% av den gjorda läkningen, upp till dess ursprungliga absorption. Välsignelse gör Körläknings överläkning till en 10 sekunders absorption, begränsad till 10% av maximal hälsa. Varje Aftonsångens Bildstod-eko förlänger Förruttnelsens klagosång med 1 sek, upp till 6 sek per mål.',
    'pri_r20_incarnate_spirit':
      'Ett helt förbrukat Värnpsalm läker sitt mål för 40% av den ursprungliga absorptionen. Välsignelsens Vaka-läkning läker även upp till 3 gruppmedlemmar inom 15 meter för 40%. En Aftonsångens tiondedemon med 5 staplar gör 50% mer skada och varar 50% längre.',
    'pri_r20_second_verse':
      'Efter 2 sek upprepas 40% av Rensande nåds läkning från Lära, gruppläkning från Välsignelse, eller Bildstod-ekoskada från Aftonsång. Upprepningen kan inte utlösa sig själv.',
    'pri_r5_improved_renew':
      'Värnpsalm ger sitt mål 40% förflyttningshastighet i 3 sek.',
    'pri_r5_searing_light':
      'Slöjsteg tar bort rötter och nedsaktningar, och ger sedan 50% förflyttningshastighet i 3 sek.',
    'pri_r5_twisted_faith':
      'Slöjsteg låter prästen kasta i rörelse i 4 sek.',
    'rog_r11_cheap_trick':
      'Magslag kräver inte längre Skymningsslöja.',
    'rog_r14_dusk_economy':
      'Förmågor kostar 50% mindre energi medan du är i Skymningsslöja eller höljd i skugga av slöjan, samt i 6 sek efter att du lämnat Skymningsslöja.',
    'rog_r20_kill_chain':
      'Dödande slag förnyar Rökssteg och ger 5 kombopoäng.',
    'rog_r20_second_shadow':
      'Sista vilan kastad vid 5 kombopoäng slår till igen från skuggorna för 75% av dess skada.',
    'sha_r14_chain_lightning':
      'Efter att ha förbrukat 120 mana kostar din nästa manakostande Schaman-förmåga 40 mindre. Detta redo-tillstånd har ingen kort utgångstid.',
    'sha_r14_improved_flame_shock':
      'Eldmärket ger 1 extra Åska-laddning var 3:e Bågblixt. Stormhjärteekon gör 25% mer skada, Stenbundet får 5% skadereducering, och Livskällan lägger till 20% mer Lagningsström.',
    'sha_r14_weapon_fury':
      'En lyckad Bågblixt, Anfäders hugg eller Lagande vatten återställer 1 Åskvärn-laddning och 10 mana, en gång var 6:e sek.',
    'sha_r17_elemental_warding':
      'Att aktivera Åskvärn ger 40% minskad mottagen skada i 6 sek. 120 sekunders intern nedkylning.',
    'sha_r17_improved_ghost_wolf':
      'När den är redo tillåter det att lämna Skuggvarg kasta i rörelse i 8 sek. 90 sekunders intern nedkylning.',
    'sha_r20_bloodlust':
      'Efter att Jordstöt eller Jordbävning förbrukar all Åska, behåll 2 Åska. Efter att en besvärjelse förbrukar Stormtecken, behåll 1 steg av Krigsandens kadens. Efter att Kedjeläkning förbrukar Lagningsström, återställ 25% av den förbrukade mängden.',
    'sha_r20_elemental_fury':
      'Efter att Jordstöt eller Jordbävning förbrukar all Åska, upprepas 40% av dess skada efter 1 sek. En besvärjelse som förbrukar Stormtecken upprepas med 40% styrka. Läkning från förbrukad Lagningsström upprepas med 40% styrka efter 2 sek. Dessa upprepningar kan inte utlösa andra effekter.',
    'sha_r20_tidal_waves':
      'Efter att Jordstöt eller Jordbävning förbrukar all Åska gör Eldmärket nästa Bågblixt omedelbar. Stormhjärtats sista eko gör 50% skada till upp till 2 fiender inom 8 meter. En Stenbundet-besvärjelse som förbrukar Stormtecken ger en absorption motsvarande 8% av din maximala hälsa. Med Livskällan aktiv lägger Tidvattenskallelse även till 50% av sin fulla läkning till den mest skadade allierade inom 10 meter.',
    'sha_r5_imbue_mastery':
      'Efter att ha använt en stöt kan nästa Bågblixt eller Lagande vatten som påbörjas inom 8 sek kastas i rörelse.',
    'sha_r5_improved_lightning_shield':
      'Att gå in i Skuggvarg ger 60% förflyttningshastighet i 3 sek, en gång var 20:e sek.',
    'sha_r8_frost_bind':
      'Åskvärns vedergällning ger 10% minskad mottagen skada i 3 sek.',
    'wlk_r11_demon_armor':
      'Första gången varje gruppmedlem rör din Soulwell skyddar den dem med en sköld på 15% av deras maximala hälsa i 30 sek. Varje spelare kan få denna sköld en gång per Soulwell.',
  },
  vi_VN: {
    mag_r5_blink_cast:
      'Bạn có thể dùng Bước Chớp giữa chừng một lượt niệm phép mà không làm gián đoạn nó.',
    mag_r8_temporal_rift:
      'Thi triển lá chắn cá nhân sẽ xóa các hiệu ứng cố định đang ảnh hưởng đến bạn.',
    mag_r17_convergence:
      'Xen kẽ một phép Lửa và một phép Băng Giá kích hoạt 8 giây bùng phát sức mạnh, mỗi 30 giây một lần.',
    mag_r20_overflowing_power:
      'Tiêu thụ mana rút ngắn thời gian hồi chiêu phòng thủ của bạn: 2 giây mỗi một phần mười mana tối đa đã dùng, tối đa 10 giây mỗi 30 giây.',
    dru_r20_improved_hurricane:
      'Khi ở Hình Nguyệt Cầm, bạn và các thành viên nhóm trong vòng 30 thước nhận thêm 3% cơ hội chí mạng phép thuật.',
    war_row_second_wind: 'Khi còn dưới 35% máu, bạn hồi 1,5% máu mỗi giây.',
    war_row_anger_management: 'Đòn đánh tự động tạo thêm 10% nộ và kỹ năng tạo thêm 5% nộ.',
    war_row_blood_offering:
      'Các thế của bạn nhận thêm hiệu ứng. Thế Công: đòn chí mạng từ kỹ năng gây thêm 15% sát thương. Thế Cuồng Chiến: đòn đánh tự động nhanh hơn 5%. Thế Thủ: một đòn đánh vốn lấy đi ít nhất 20% máu tối đa của bạn sẽ gây ít hơn 15% sát thương.',
    war_row_battle_rhythm: 'Mỗi kỹ năng thứ ba bạn sử dụng tạo thêm 20% nộ.',
    war_row_colossal_might:
      'Mỗi điểm nộ bạn tiêu tốn rút ngắn 0,1 giây thời gian hồi chiêu của các kỹ năng tấn công chủ lực, tối đa 10 giây mỗi 30 giây.',
    'dru_r14_empowered_touch':
      'Mãn Khai trồng lại một Hoa Nở Hoang Dã mới lên mọi đồng minh mà nó đã thu hoạch lượng hồi máu.',
    'dru_r14_moonfury':
      'Nguyệt Trào và Vệt Dương mỗi cái cũng hồi thêm 15% mana tối đa của bạn.',
    'dru_r14_savage_fury':
      'Mỗi nhịp chảy máu của Lóc Xé và Xé Rách cũng thêm 1 Huyết Cổ.',
    'dru_r20_berserk':
      'Nguyệt Trào, Vệt Dương, Thu Hoạch Đỏ, Đoạn Tủy, và Mãn Khai mạnh hơn 25%.',
    'dru_r20_tranquility':
      'Mỗi 1 điểm Triều Nguyệt, Huyết Cổ, hoặc Sắc Xanh bạn nhận được sẽ hồi 2% mana tối đa, 5 năng lượng, hoặc 3 nộ khí, tùy theo hình dạng hiện tại của bạn.',
    'dru_r5_ferocity':
      'Biến hình ban 60% tốc độ di chuyển trong 3 giây, tối đa một lần mỗi 20 giây.',
    'dru_r5_improved_wrath':
      'Biến hình sẽ gỡ bỏ các hiệu ứng trói chân và làm chậm có thể phá vỡ.',
    'hun_r11_binding_payload':
      'Bẫy Hàm Băng trói chân mọi kẻ địch trong khu vực kích hoạt của nó trong 3 giây, sau đó làm chậm chúng 40% trong 4 giây.',
    'hun_r11_crippling_pursuit':
      'Bắn Rúng Động hoặc Nhát Chém Xiềng Xích trói chân một mục tiêu đã bị làm chậm trong 2 giây. Hồi chiêu riêng cho từng mục tiêu 12 giây.',
    'hun_r14_efficient_rhythm':
      'Sau khi tiêu 75 Tập Trung, lần dùng Lệnh Bầy Đàn, Phát Bắn Điềm Tĩnh, hoặc Đòn Moi Ruột tiếp theo của bạn ban thêm 20 Tập Trung.',
    'hun_r14_guise_mastery':
      'Trong 6 giây, Lốt Diều Hâu tăng 50% lượng Tập Trung tạo ra, Lốt Chồn giảm 25% sát thương trực tiếp phải nhận, và Lốt Tuấn Mã ban 50% tốc độ di chuyển, hoặc 60% khi có Tuấn Mã Bền Bỉ. Hồi chiêu dùng chung 20 giây.',
    'hun_r17_apex_instinct':
      'Tiếng Gầm Cuồng Nộ, Tập Trung Lạnh, hoặc Đột Kích Vệt Máu hồi 40 Tập Trung. 3 kỹ năng tiêu Tập Trung tiếp theo của bạn tốn ít hơn 50% và gây thêm 20% sát thương. Các lượt dùng này hết hạn 4 giây sau khi thời gian hồi chiêu kích hoạt kết thúc.',
    'hun_r17_pack_rally':
      'Lốt Tuấn Mã có thể kích hoạt Tập Hợp Bầy Đàn. Bạn, thú nuôi của bạn, và đồng minh trong nhóm hoặc raid trong bán kính 30 thước nhận 30% tốc độ di chuyển và 10% tốc độ tấn công, thi triển và dẫn phép trong 10 giây. Hồi chiêu 90 giây.',
    'hun_r17_shell_and_fang':
      'Da Mai cho phép tấn công và ra lệnh cho thú nuôi, nhưng lượng giảm sát thương của nó giảm còn 40%.',
    'hun_r20_chain_reaction':
      'Bẫy Hàm Băng đánh dấu kẻ địch trong bán kính 4 thước trong 8 giây. 3 kỹ năng tiêu Tập Trung tiếp theo của bạn vọng 40% sát thương giữa các kẻ địch bị đánh dấu.',
    'hun_r20_fang_chorus':
      'Mỗi kỹ năng tiêu Tập Trung ra lệnh cho thú nuôi vọng lại một đòn ở 50% sức mạnh. Cứ tiếng vọng thứ 3 sẽ trở thành một cú vỗ trong bán kính 4 thước.',
    'hun_r20_overdraw':
      'Cứ Bắn Tà Ác, Kéo Cung Dài, hoặc Xé Vết Thương thứ 3 sẽ gây thêm 35% sát thương lên mục tiêu và 50% lượng đó cho tối đa 2 kẻ địch trong bán kính 5 thước.',
    'hun_r5_enduring_courser':
      'Lốt Tuấn Mã ban 60% tốc độ di chuyển trong 3 giây khi được kích hoạt. Hồi chiêu nội bộ 20 giây.',
    'hun_r5_predators_pace':
      'Một lần dùng thành công Lệnh Bầy Đàn, Phát Bắn Điềm Tĩnh, hoặc Đòn Moi Ruột sẽ ban 20% tốc độ di chuyển trong 3 giây. Hồi chiêu nội bộ 8 giây.',
    'hun_r8_receding_shell':
      'Thi triển lại Da Mai để kết thúc sớm và hoàn lại 50% thời lượng chưa dùng, tối đa 45 giây.',
    'hun_r8_shared_recovery':
      'Tim Hoang Dã cũng hồi 30% máu cho thú nuôi của bạn và ban cho cả hai 20% giảm sát thương trong 4 giây.',
    'pal_r14_divine_purpose':
      'Các kỹ năng được Thăng Thiên tăng cường có 20% cơ hội không tiêu một lượt.',
    'pal_r14_sacred_reserve':
      'Khi Thăng Thiên Thần Thánh kết thúc, nhận lại 5 Sùng Tín.',
    'pal_r14_zeal':
      'Cứ mỗi kỹ năng thứ ba thực sự tạo ra Sùng Tín sẽ ban thêm 1 Sùng Tín.',
    'pal_r17_extended_dawn':
      'Thăng Thiên Thần Thánh tăng cường thêm 2 kỹ năng nữa.',
    'pal_r20_dawn_echo':
      'Cứ mỗi kỹ năng trực tiếp thứ ba thực sự tạo ra Sùng Tín sẽ lặp lại 40% lượng sát thương hoặc hồi máu trực tiếp chính của nó lên cùng mục tiêu. Một lần vọng hiệu quả sẽ ban 1 Sùng Tín. Tiếng vọng không thể chí mạng hay kích hoạt các tiếng vọng khác, và không ban Sùng Tín trong lúc Thăng Thiên Thần Thánh đang hoạt động.',
    'pal_r20_perpetual_sun':
      'Tiêu lượt Thăng Thiên cuối cùng của bạn sẽ gây 150 sát thương Thánh trong 10 m, hồi 150 máu cho đồng minh trong 20 m, rồi nhân đôi lượng Sùng Tín tạo ra từ kỹ năng trong 5 giây. Hết hạn tự nhiên không kích hoạt hiệu ứng này.',
    'pal_r5_divine_steed':
      'Nhận thêm 0,75% tốc độ di chuyển cho mỗi điểm Sùng Tín, tối đa 15% ở mức 20. Kích hoạt Thăng Thiên Thần Thánh sẽ tiêu Sùng Tín của bạn và ban 30% tốc độ di chuyển trong 5 giây.',
    'pal_r5_radiant_stride':
      'Búa Ân Điển ban 30% tốc độ di chuyển trong 4 giây khi nó gây sát thương.',
    'pal_r8_recurring_grace':
      'Lượng hồi máu dư của Búa Ân Điển trở thành một khiên hấp thụ trong 10 giây, tối đa bằng 10% máu tối đa của bạn.',
    'pri_r11_vampiric_embrace':
      'Kẻ địch tiêu hết toàn bộ Thánh Thi Hộ Mệnh sẽ bị trói chân trong 2 giây, tối đa một lần cho mỗi kẻ địch mỗi 12 giây.',
    'pri_r14_pain_and_suffering':
      'Sát thương hồi máu của Giáo Lý khôi phục Thánh Thi Hộ Mệnh bằng 20% lượng máu đã hồi, tối đa bằng lượng hấp thụ ban đầu của nó. Phúc Lành biến lượng hồi máu dư của Hồi Phục Hợp Xướng thành một khiên hấp thụ trong 10 giây, tối đa 10% máu tối đa. Mỗi tiếng vọng từ Hình Nộm Kinh Chiều của bạn kéo dài Ai Ca Mục Rữa thêm 1 giây, tối đa 6 giây cho mỗi mục tiêu.',
    'pri_r20_incarnate_spirit':
      'Một Thánh Thi Hộ Mệnh bị tiêu hết hoàn toàn sẽ hồi cho mục tiêu của nó 40% lượng hấp thụ ban đầu. Lượng hồi máu Canh Thức của Phúc Lành cũng hồi cho tối đa 3 thành viên tổ đội trong bán kính 15 thước với 40%. Một Quỷ Thập Phân của Kinh Chiều ở 5 lớp gây thêm 50% sát thương và tồn tại lâu hơn 50%.',
    'pri_r20_second_verse':
      'Sau 2 giây, lặp lại 40% lượng hồi máu của Từ Bi Thanh Tẩy từ Giáo Lý, lượng hồi máu nhóm từ Phúc Lành, hoặc sát thương vọng từ Hình Nộm của Kinh Chiều. Lần lặp lại này không thể tự kích hoạt chính nó.',
    'pri_r5_improved_renew':
      'Thánh Thi Hộ Mệnh ban cho mục tiêu của nó 40% tốc độ di chuyển trong 3 giây.',
    'pri_r5_searing_light':
      'Bước Màn Che gỡ bỏ hiệu ứng trói chân và làm chậm, sau đó ban 50% tốc độ di chuyển trong 3 giây.',
    'pri_r5_twisted_faith':
      'Bước Màn Che cho phép Tu Sĩ niệm chú khi đang di chuyển trong 4 giây.',
    'rog_r11_cheap_trick':
      'Thụi Bụng không còn yêu cầu Màn Chạng Vạng.',
    'rog_r14_dusk_economy':
      'Kỹ năng tốn ít hơn 50% năng lượng khi đang trong Màn Chạng Vạng hoặc được tấm màn bao phủ trong bóng tối, và trong 6 giây sau khi rời khỏi Màn Chạng Vạng.',
    'rog_r20_kill_chain':
      'Đòn kết liễu hạ gục mục tiêu sẽ làm mới Bước Khói và ban 5 điểm liên hoàn.',
    'rog_r20_second_shadow':
      'Giấc Ngủ Vùi Đất thi triển ở 5 điểm liên hoàn sẽ đánh thêm một lần nữa từ trong bóng tối với 75% sát thương của nó.',
    'sha_r14_chain_lightning':
      'Sau khi tiêu 120 Mana, kỹ năng tiếp theo của Shaman mà bạn dùng có tốn Mana sẽ tốn ít hơn 40 Mana. Trạng thái sẵn sàng này không hết hạn sớm.',
    'sha_r14_improved_flame_shock':
      'Dấu Hỏa ban thêm 1 Sấm mỗi Tia Hồ Quang thứ 3. Tiếng Vọng Tâm Phong gây thêm 25% sát thương, Thạch Phọc nhận thêm 5% giảm sát thương, và Suối Sinh dồn thêm 20% vào Dòng Chữa Lành.',
    'sha_r14_weapon_fury':
      'Một lần dùng thành công Tia Hồ Quang, Đòn Tổ Tiên, hoặc Dòng Nước Hàn Gắn sẽ hồi 1 lượt Bùa Hộ Sấm Sét và 10 Mana, tối đa một lần mỗi 6 giây.',
    'sha_r17_elemental_warding':
      'Kích hoạt Bùa Hộ Sấm Sét ban 40% giảm sát thương trong 6 giây. Hồi chiêu nội bộ 120 giây.',
    'sha_r17_improved_ghost_wolf':
      'Khi sẵn sàng, việc rời khỏi Sói Bóng cho phép niệm chú khi đang di chuyển trong 8 giây. Hồi chiêu nội bộ 90 giây.',
    'sha_r20_bloodlust':
      'Sau khi Địa Giật hoặc Động Đất tiêu hết toàn bộ Sấm, giữ lại 2 Sấm. Sau khi một phép tiêu Điềm Bão, giữ lại 1 nhịp của Nhịp Chiến Hồn. Sau khi Hồi Máu Liên Hoàn tiêu Dòng Chữa Lành, khôi phục 25% lượng đã tiêu.',
    'sha_r20_elemental_fury':
      'Sau khi Địa Giật hoặc Động Đất tiêu hết toàn bộ Sấm, lặp lại 40% sát thương của nó sau 1 giây. Một phép tiêu Điềm Bão sẽ lặp lại ở 40% sức mạnh. Lượng hồi máu từ Dòng Chữa Lành đã tiêu lặp lại ở 40% sức mạnh sau 2 giây. Các lần lặp lại này không thể kích hoạt hiệu ứng khác.',
    'sha_r20_tidal_waves':
      'Sau khi Địa Giật hoặc Động Đất tiêu hết toàn bộ Sấm, Dấu Hỏa khiến Tia Hồ Quang tiếp theo thành tức thời. Tiếng vọng cuối cùng của Tâm Phong gây 50% sát thương cho tối đa 2 kẻ địch trong bán kính 8 thước. Một phép của Thạch Phọc tiêu Điềm Bão sẽ ban một khiên hấp thụ bằng 8% máu tối đa của bạn. Khi Suối Sinh đang hoạt động, Gọi Thủy Triều cũng cộng thêm 50% lượng hồi đầy đủ của nó cho đồng minh bị thương nặng nhất trong bán kính 10 thước.',
    'sha_r5_imbue_mastery':
      'Sau khi dùng một đòn Giật, Tia Hồ Quang hoặc Dòng Nước Hàn Gắn tiếp theo bắt đầu trong vòng 8 giây có thể niệm khi đang di chuyển.',
    'sha_r5_improved_lightning_shield':
      'Bước vào Sói Bóng ban 60% tốc độ di chuyển trong 3 giây, tối đa một lần mỗi 20 giây.',
    'sha_r8_frost_bind':
      'Đòn phản công của Bùa Hộ Sấm Sét ban 10% giảm sát thương trong 3 giây.',
    'wlk_r11_demon_armor':
      'Lần đầu tiên mỗi thành viên nhóm chạm vào Giếng Linh Hồn của bạn, nó sẽ tạo khiên cho họ bằng 15% máu tối đa trong 30 giây. Mỗi người chơi chỉ có thể nhận khiên này một lần cho mỗi Giếng Linh Hồn.',
  },
  da_DK: {
    mag_r5_blink_cast: 'Du kan bruge Flimmertrin midt i en besværgelse uden at afbryde den.',
    mag_r8_temporal_rift:
      'Når du kaster din personlige barriere, fjernes rodfæstelseseffekter på dig.',
    mag_r17_convergence:
      'At veksle mellem en Ild- og en Frosttroldom åbner et kraftudbrud på 8 sek., maks. én gang pr. 30 sek.',
    mag_r20_overflowing_power:
      'Manaforbrug reducerer afkølingen på dine defensive evner: 2 sek. pr. tiendedel af dit maksimale mana brugt, op til 10 sek. hvert 30. sek.',
    dru_r20_improved_hurricane:
      'Mens du er i Måneugleform, får du og dine gruppemedlemmer inden for 30 m 3% chance for kritisk træffer med besværgelser.',
    war_row_second_wind: 'Under 35 % helbred genvinder du 1,5 % af dit helbred hvert sekund.',
    war_row_anger_management:
      'Dine autoangreb genererer 10 % mere raseri, og dine evner genererer 5 % mere.',
    war_row_blood_offering:
      'Dine stillinger får yderligere effekter. Kampstilling: kritiske træffere med evner giver 15 % mere skade. Berserkerstilling: dine autoangreb er 5 % hurtigere. Værgende Stilling: et træf, der ville tage mindst 20 % af dit maksimale helbred, giver 15 % mindre skade.',
    war_row_battle_rhythm: 'Hver tredje evne, du bruger, genererer 20 % mere raseri.',
    war_row_colossal_might:
      'Hvert raserispunkt du bruger, reducerer afkølingen på dine store angrebsevner med 0,1 sek., op til 10 sek. hvert 30. sek.',
    'dru_r14_empowered_touch':
      'Overblomstring genplanter en frisk Vildblomst på hver allieret, hvis helbredelse den høstede.',
    'dru_r14_moonfury':
      'Månebølge og Solspor genopretter hver også 15% af din maksimale mana.',
    'dru_r14_savage_fury':
      'Hver tik af dine Flæns- og Sønderriv-blødninger tilføjer også 1 Gammelt Blod.',
    'dru_r20_berserk':
      'Månebølge, Solspor, Rød Høst, Marvbrækker og Overblomstring er 25% stærkere.',
    'dru_r20_tranquility':
      'Hver 1 Måneflod, Gammelt Blod eller Grønske, du får, genopretter 2% af din maksimale mana, 5 energi eller 3 raseri, alt efter din nuværende form.',
    'dru_r5_ferocity':
      'Formskifte giver 60% bevægelseshastighed i 3 sek., højst én gang hvert 20. sek.',
    'dru_r5_improved_wrath':
      'Formskifte fjerner brydbare rødder og nedsættelser.',
    'hun_r11_binding_payload':
      'Frostkæbefælde rodfæster hver fjende i sit udløsningsområde i 3 sek. og sænker dem derefter med 40% i 4 sek.',
    'hun_r11_crippling_pursuit':
      'Rystende Skud eller Lænkende Hug rodfæster et allerede nedsat mål i 2 sek. 12 sek. nedkøling pr. mål.',
    'hun_r14_efficient_rhythm':
      'Efter at have brugt 75 fokus giver din næste Flokbefaling, Afmålt Skud eller Flænsehug 20 ekstra fokus.',
    'hun_r14_guise_mastery':
      'I 6 sek. øger Kærhøgens Skikkelse fokusgenerering med 50%, Mårens Skikkelse reducerer direkte skade med 25%, og Gangerens Skikkelse giver 50% bevægelseshastighed, eller 60% med Udholdende Ganger. 20 sek. delt nedkøling.',
    'hun_r17_apex_instinct':
      'Bestialsk vrede, Koldt Fokus eller Blodsporsangreb genopretter 40 fokus. Dine næste 3 fokusforbrugere koster 50% mindre og gør 20% mere skade. Disse brug udløber 4 sek. efter den udløsende nedkøling slutter.',
    'hun_r17_pack_rally':
      'Gangerens Skikkelse kan udløse Floksamling. Du, din følgesvend og gruppe- eller togtallierede inden for 30 m får 30% bevægelseshastighed og 10% angrebs-, kaste- og kanaliseringshastighed i 10 sek. 90 sek. nedkøling.',
    'hun_r17_shell_and_fang':
      'Skalhud tillader angreb og kæledyrsbefalinger, men dens skadereduktion reduceres til 40%.',
    'hun_r20_chain_reaction':
      'Frostkæbefælde mærker fjender inden for 4 m i 8 sek. Dine næste 3 fokusforbrugere genlyder 40% skade mellem mærkede fjender.',
    'hun_r20_fang_chorus':
      'Hver fokusforbruger befaler et kæledyrsekko med 50% styrke. Hvert 3. ekko bliver til et klap på 4 m.',
    'hun_r20_overdraw':
      'Hvert 3. Grumt Skud, Langt Optræk eller Modbid gør 35% mere skade på sit mål og 50% af den skade til op til 2 fjender inden for 5 m.',
    'hun_r5_enduring_courser':
      'Gangerens Skikkelse giver 60% bevægelseshastighed i 3 sek., når den aktiveres. 20 sek. intern nedkøling.',
    'hun_r5_predators_pace':
      'En vellykket Flokbefaling, Afmålt Skud eller Flænsehug giver 20% bevægelseshastighed i 3 sek. 8 sek. intern nedkøling.',
    'hun_r8_receding_shell':
      'Kast Skalhud igen for at afslutte den tidligt og få 50% af dens ubrugte varighed refunderet, op til 45 sek.',
    'hun_r8_shared_recovery':
      'Vildhjerte helbreder også dit kæledyr for 30% af dets maksimale sundhed og giver jer begge 20% reduceret skade i 4 sek.',
    'pal_r14_divine_purpose':
      'Markerede evner har 20% chance for ikke at forbruge en ladning.',
    'pal_r14_sacred_reserve':
      'Når Guddommelig Ophøjelse slutter, genvinder du 5 Hengivenhed.',
    'pal_r14_zeal':
      'Hver tredje evne, der rent faktisk genererer Hengivenhed, giver 1 ekstra Hengivenhed.',
    'pal_r17_extended_dawn':
      'Guddommelig Ophøjelse mærker 2 yderligere evner.',
    'pal_r20_dawn_echo':
      'Hver tredje direkte evne, der rent faktisk genererer Hengivenhed, gentager sin primære direkte skade eller helbredelse med 40% på samme mål. Et effektivt ekko giver 1 Hengivenhed. Ekkoet kan ikke ramme kritisk eller udløse andre ekkoer, og giver ingen Hengivenhed under Guddommelig Ophøjelse.',
    'pal_r20_perpetual_sun':
      'At forbruge din sidste Ophøjelsesladning gør 150 hellig skade inden for 10 m, helbreder allierede inden for 20 m for 150, og fordobler derefter evners Hengivenhedsgenerering i 5 sek. Udløb udløser den ikke.',
    'pal_r5_divine_steed':
      'Få 0,75% bevægelseshastighed pr. Hengivenhed, op til 15% ved 20. At aktivere Guddommelig Ophøjelse forbruger din Hengivenhed og giver 30% bevægelseshastighed i 5 sek.',
    'pal_r5_radiant_stride':
      'Nådens Hammer giver 30% bevægelseshastighed i 4 sek., når den gør skade.',
    'pal_r8_recurring_grace':
      'Nådens Hammers overhelbredelse bliver til et absorptionsskjold i 10 sek., med et loft på 10% af dit maksimale helbred.',
    'pri_r11_vampiric_embrace':
      'En fjende, der forbruger Værnets Salme fuldstændigt, rodfæstes i 2 sek., højst én gang pr. fjende hvert 12. sek.',
    'pri_r14_pain_and_suffering':
      'Læres skade-helbredelse genopretter Værnets Salme med 20% af den udførte helbredelse, op til dens oprindelige absorption. Velsignelse forvandler Korhelbredelses overhelbredelse til en 10 sek. absorption med et loft på 10% af maksimalt helbred. Hvert Aftensangs Billede-ekko forlænger Forfaldets Klagesang med 1 sek., op til 6 sek. pr. mål.',
    'pri_r20_incarnate_spirit':
      'En fuldstændigt forbrugt Værnets Salme helbreder sit mål for 40% af den oprindelige absorption. Velsignelses Vagt-helbredelse helbreder også op til 3 gruppemedlemmer inden for 15 m for 40%. En 5-stak Aftensangs Tiendedæmon gør 50% mere skade og varer 50% længere.',
    'pri_r20_second_verse':
      'Efter 2 sek. gentages 40% af Rensende Nådes helbredelse fra Lære, gruppehelbredelse fra Velsignelse, eller Billede-ekkoskade fra Aftensang. Gentagelsen kan ikke udløse sig selv.',
    'pri_r5_improved_renew':
      'Værnets Salme giver sit mål 40% bevægelseshastighed i 3 sek.',
    'pri_r5_searing_light':
      'Slørskridt fjerner rødder og nedsættelser og giver derefter 50% bevægelseshastighed i 3 sek.',
    'pri_r5_twisted_faith':
      'Slørskridt lader dig kaste, mens du bevæger dig, i 4 sek.',
    'rog_r11_cheap_trick':
      'Maveslag kræver ikke længere Skumringsslør.',
    'rog_r14_dusk_economy':
      'Evner koster 50% mindre energi, mens du er i Skumringsslør eller skyggehyllet af sløret, og i 6 sek. efter at have forladt Skumringsslør.',
    'rog_r20_kill_chain':
      'Dræbende slag fornyer Røgsmut og giver 5 combopoint.',
    'rog_r20_second_shadow':
      'Gravsøvn kastet ved 5 combopoint slår til igen fra skyggerne for 75% af sin skade.',
    'sha_r14_chain_lightning':
      'Efter at have brugt 120 mana koster din næste Shaman-handling, der koster mana, 40 mindre. Den klare tilstand har ingen kort udløbstid.',
    'sha_r14_improved_flame_shock':
      'Ildmærket giver 1 ekstra Torden-ladning hvert 3. Lysbuelyn. Stormhjerteekkoer gør 25% mere skade, Stenbundet får 5% reduceret skade, og Livskilden indsætter 20% mere Lapningsstrøm.',
    'sha_r14_weapon_fury':
      'Et vellykket Lysbuelyn, Forfædreslag eller Lægende Vande genopretter 1 Tordenværns-ladning og 10 mana, højst én gang hvert 6. sek.',
    'sha_r17_elemental_warding':
      'At aktivere Tordenværn giver 40% reduceret skade i 6 sek. 120 sek. intern nedkøling.',
    'sha_r17_improved_ghost_wolf':
      'Når klar, tillader det at forlade Skyggeulv at kaste, mens du bevæger dig, i 8 sek. 90 sek. intern nedkøling.',
    'sha_r20_bloodlust':
      'Efter at Jordstød eller Jordskælv har forbrugt al Torden, bevares 2 Torden. Efter at en besværgelse har forbrugt et Stormtegn, bevares 1 trin af Krigsåndens Kadence. Efter at Kædeheling har forbrugt Lapningsstrøm, genoprettes 25% af den forbrugte mængde.',
    'sha_r20_elemental_fury':
      'Efter at Jordstød eller Jordskælv har forbrugt al Torden, gentages 40% af dens skade efter 1 sek. En besværgelse, der forbruger et Stormtegn, gentages med 40% styrke. Helbredelse fra forbrugt Lapningsstrøm gentages med 40% styrke efter 2 sek. Disse gentagelser kan ikke udløse andre effekter.',
    'sha_r20_tidal_waves':
      'Efter at Jordstød eller Jordskælv har forbrugt al Torden, gør Ildmærket det næste Lysbuelyn øjeblikkeligt. Stormhjertets sidste ekko gør 50% skade til op til 2 fjender inden for 8 m. En Stenbundet-besværgelse, der forbruger et Stormtegn, giver en absorption svarende til 8% af dit maksimale helbred. Med Livskilden aktiv tilføjer Tidevandskald også 50% af sin fulde helbredelse til den mest sårede allierede inden for 10 m.',
    'sha_r5_imbue_mastery':
      'Efter at have brugt et Jordstød kan det næste Lysbuelyn eller Lægende Vande, der påbegyndes inden for 8 sek., kastes, mens du bevæger dig.',
    'sha_r5_improved_lightning_shield':
      'At gå ind i Skyggeulv giver 60% bevægelseshastighed i 3 sek., højst én gang hvert 20. sek.',
    'sha_r8_frost_bind':
      'Tordenværns gengældelse giver 10% reduceret skade i 3 sek.',
    'wlk_r11_demon_armor':
      'Første gang hvert gruppemedlem rører ved din Soulwell, skjoldes de for 15% af deres maksimale helbred i 30 sek. Hver spiller kan få dette skjold én gang pr. Soulwell.',
  },
  zh_CN: {
    mag_r5_blink_cast: '你可以在施法过程中使用闪烁步，而不会打断当前施法。',
    mag_r8_temporal_rift: '施放你的个人屏障会移除影响你的定身效果。',
    mag_r17_convergence:
      '交替施放一个火焰法术和一个冰霜法术，将触发 8 秒的力量爆发，每 30 秒最多触发一次。',
    mag_r20_overflowing_power:
      '消耗法力可缩短防御性技能的冷却时间：每消耗最大法力值的 1/10 减少 2 秒冷却，每 30 秒最多减少 10 秒。',
    dru_r20_improved_hurricane: '处于枭兽形态时，你与 30 码内的队伍成员的法术暴击几率提高 3%。',
    war_row_second_wind: '生命值低于35%时，你每秒恢复1.5%的生命值。',
    war_row_anger_management: '你的自动攻击产生的怒气提高10%，技能产生的怒气提高5%。',
    war_row_blood_offering:
      '你的姿态获得额外效果。战斗姿态：你的技能暴击造成的伤害提高15%。狂暴姿态：你的自动攻击加快5%。戒备姿态：若一次命中会使你损失至少20%的最大生命值，则该次伤害降低15%。',
    war_row_battle_rhythm: '你每使用第三个技能时，该技能产生的怒气提高20%。',
    war_row_colossal_might:
      '你每消耗1点怒气，主要进攻技能的冷却时间缩短0.1秒，每30秒最多减少10秒。',
    'dru_r14_empowered_touch':
      '盛放会为每个被其吸收治疗效果的盟友重新种下一株崭新的野性绽放。',
    'dru_r14_moonfury':
      '月涌和日醒还会各自恢复你最大法力值的 15%。',
    'dru_r14_savage_fury':
      '你的剐削与割裂流血效果的每次跳动都会额外产生 1 点古血。',
    'dru_r20_berserk':
      '月涌、日醒、血收、碎髓和盛放的效果强度提高 25%。',
    'dru_r20_tranquility':
      '你每获得 1 点月潮、古血或繁茂，就会根据当前形态恢复最大法力值的 2%、5 点能量或 3 点怒气。',
    'dru_r5_ferocity':
      '变形使移动速度提高 60%，持续 3 秒，每 20 秒最多触发一次。',
    'dru_r5_improved_wrath':
      '变形会解除可被打破的定身和减速效果。',
    'hun_r11_binding_payload':
      '霜颚陷阱定身触发区域内的所有敌人，持续 3 秒，随后使其减速 40%，持续 4 秒。',
    'hun_r11_crippling_pursuit':
      '震颤射击或束缚斩会定身已处于减速状态的目标，持续 2 秒。对同一目标每 12 秒最多触发一次。',
    'hun_r14_efficient_rhythm':
      '消耗 75 点集中值后，你的下一次兽群号令、审慎射击或剖膛一击会额外产生 20 点集中值。',
    'hun_r14_guise_mastery':
      '持续 6 秒，鹞鹰之姿使集中值产生量提高 50%，松貂之姿使你受到的直接伤害降低 25%，骏马之姿使移动速度提高 50%，若配合持久骏马则为 60%。三者共享 20 秒冷却。',
    'hun_r17_apex_instinct':
      '狂野怒火、冷静专注或血迹突袭会恢复 40 点集中值。你接下来 3 次消耗集中值的技能花费降低 50%，造成的伤害提高 20%。这些效果会在触发技能的冷却结束后 4 秒过期。',
    'hun_r17_pack_rally':
      '骏马之姿可以触发兽群集结：你、你的伙伴，以及 30 码内的小队或团队盟友获得 30% 移动速度加成，攻击、施法和引导速度提高 10%，持续 10 秒。冷却时间 90 秒。',
    'hun_r17_shell_and_fang':
      '甲壳之肤生效期间允许攻击和宠物指令，但其伤害降低效果减少至 40%。',
    'hun_r20_chain_reaction':
      '霜颚陷阱标记 4 码内的敌人，持续 8 秒。你接下来 3 次消耗集中值的技能会在被标记的敌人之间回响 40% 的伤害。',
    'hun_r20_fang_chorus':
      '每次消耗集中值的技能都会指挥宠物以 50% 强度回响攻击。每第 3 次回响会变为一次 4 码范围的振击。',
    'hun_r20_overdraw':
      '每第 3 次凶邪射击、引弓长射或反噬獠牙对目标造成的伤害提高 35%，并对 5 码内至多 2 名敌人造成该伤害 50% 的伤害。',
    'hun_r5_enduring_courser':
      '骏马之姿激活时使移动速度提高 60%，持续 3 秒。每 20 秒最多触发一次。',
    'hun_r5_predators_pace':
      '成功命中的兽群号令、审慎射击或剖膛一击会使移动速度提高 20%，持续 3 秒。每 8 秒最多触发一次。',
    'hun_r8_receding_shell':
      '重新施放甲壳之肤可将其提前结束，并返还其剩余持续时间的 50%，最多可返还 45 秒。',
    'hun_r8_shared_recovery':
      '野性之心额外为你的宠物恢复其最大生命值 30% 的生命值，并使你们二者受到的伤害降低 20%，持续 4 秒。',
    'pal_r14_divine_purpose':
      '受升华强化的技能有 20% 几率不消耗充能。',
    'pal_r14_sacred_reserve':
      '神圣升华结束时，回复 5 点虔诚。',
    'pal_r14_zeal':
      '每第三个实际产生虔诚的技能额外产生 1 点虔诚。',
    'pal_r17_extended_dawn':
      '神圣升华额外强化 2 个技能。',
    'pal_r20_dawn_echo':
      '每第三个实际产生虔诚的直接技能，会以 40% 的效果对同一目标重复其主要直接伤害或治疗。产生效果的回响会产生 1 点虔诚。该回响无法暴击，也无法触发其他回响，且在神圣升华期间不会产生虔诚。',
    'pal_r20_perpetual_sun':
      '消耗你最后一层升华充能时，对 10 米内敌人造成 150 点神圣伤害，为 20 米内的盟友恢复 150 点生命值，随后使技能产生的虔诚翻倍，持续 5 秒。自然到期不会触发此效果。',
    'pal_r5_divine_steed':
      '每点虔诚使你的移动速度提高 0.75%，虔诚达到 20 点时最高提高 15%。激活神圣升华会消耗你的虔诚，并使移动速度提高 30%，持续 5 秒。',
    'pal_r5_radiant_stride':
      '恩典之锤造成伤害时使你的移动速度提高 30%，持续 4 秒。',
    'pal_r8_recurring_grace':
      '恩典之锤造成的过量治疗会转化为吸收护盾，持续 10 秒，上限为你最大生命值的 10%。',
    'pri_r11_vampiric_embrace':
      '完全消耗守护圣咏护盾的敌人会被定身 2 秒，对同一敌人每 12 秒最多触发一次。',
    'pri_r14_pain_and_suffering':
      '教义的伤害转治疗效果会以所治疗量的 20% 恢复守护圣咏的护盾值，上限为其原本的吸收量。赐福会将圣歌愈疗产生的过量治疗转化为持续 10 秒的吸收护盾，上限为最大生命值的 10%。每次晚祷塑像的回响都会使腐朽挽歌延长 1 秒，每个目标最多延长 6 秒。',
    'pri_r20_incarnate_spirit':
      '完全消耗的守护圣咏会为其目标恢复相当于原吸收量 40% 的生命值。赐福的炽天使守望治疗还会为 15 码内至多 3 名小队成员恢复其 40% 的治疗量。5 层的晚祷什一魔造成的伤害提高 50%，持续时间延长 50%。',
    'pri_r20_second_verse':
      '2 秒后，重复 40% 的效果：教义的涤罪慈悲治疗、赐福的群体治疗，或晚祷的塑像回响伤害。此重复效果无法再次触发自身。',
    'pri_r5_improved_renew':
      '守护圣咏使其目标的移动速度提高 40%，持续 3 秒。',
    'pri_r5_searing_light':
      '帷幕步会解除定身和减速效果，随后使移动速度提高 50%，持续 3 秒。',
    'pri_r5_twisted_faith':
      '帷幕步使牧师能够在移动中施法，持续 4 秒。',
    'rog_r11_cheap_trick':
      '击腹拳不再需要暮帷。',
    'rog_r14_dusk_economy':
      '处于暮帷中，或被暮帷之影笼罩时，技能消耗的能量降低 50%；离开暮帷后 6 秒内同样有效。',
    'rog_r20_kill_chain':
      '击杀敌人会重置烟遁的冷却，并获得 5 点连击点。',
    'rog_r20_second_shadow':
      '在 5 点连击点时施放长眠，会从暗影中再次打击，造成其伤害 75% 的伤害。',
    'sha_r14_chain_lightning':
      '消耗 120 点法力后，你下一个消耗法力的萨满技能花费减少 40 点。该就绪状态不会短暂过期。',
    'sha_r14_improved_flame_shock':
      '焰烙每第 3 次电弧箭额外产生 1 层雷霆。风心的回响伤害提高 25%，缚石获得 5% 的伤害降低效果，活泉存入的愈合水流量提高 20%。',
    'sha_r14_weapon_fury':
      '成功命中的电弧箭、先祖打击或治愈之水会恢复 1 层雷霆护罩充能和 10 点法力，每 6 秒最多触发一次。',
    'sha_r17_elemental_warding':
      '激活雷霆护罩使你受到的伤害降低 40%，持续 6 秒。每 120 秒最多触发一次。',
    'sha_r17_improved_ghost_wolf':
      '处于就绪状态时，脱离影狼可使你在 8 秒内移动中施法。每 90 秒最多触发一次。',
    'sha_r20_bloodlust':
      '大地震击或地震消耗全部雷霆后，保留 2 层雷霆。法术消耗风暴施法后，保留 1 层战魂节律。治疗链消耗愈合水流后，恢复其消耗量的 25%。',
    'sha_r20_elemental_fury':
      '大地震击或地震消耗全部雷霆后，1 秒后以 40% 的效果重复其伤害。消耗风暴施法的法术会以 40% 的强度重复效果。消耗愈合水流产生的治疗会在 2 秒后以 40% 的强度重复。这些重复效果无法触发其他效果。',
    'sha_r20_tidal_waves':
      '大地震击或地震消耗全部雷霆后，焰烙会使下一个电弧箭瞬发。风心的最后一次回响会对 8 码内至多 2 名敌人造成 50% 的伤害。消耗风暴施法的缚石法术会给予一个相当于你最大生命值 8% 的吸收护盾。活泉生效期间，潮汐召唤还会为 10 码内伤势最重的盟友额外恢复其完整治疗量 50% 的生命值。',
    'sha_r5_imbue_mastery':
      '使用震击后，8 秒内开始施放的下一个电弧箭或治愈之水可以在移动中施放。',
    'sha_r5_improved_lightning_shield':
      '进入影狼时使移动速度提高 60%，持续 3 秒，每 20 秒最多触发一次。',
    'sha_r8_frost_bind':
      '雷霆护罩的反击效果触发时，使你受到的伤害降低 10%，持续 3 秒。',
    'wlk_r11_demon_armor':
      '小队成员首次触碰你的灵魂之井时，会获得一个吸收量为其最大生命值 15% 的护盾，持续 30 秒。每名玩家对每口灵魂之井只能获得一次该护盾。',
  },
  zh_TW: {
    mag_r5_blink_cast: '你可以在施法過程中使用閃爍步，而不會打斷詠唱。',
    mag_r8_temporal_rift: '施放你的個人屏障會移除影響你的定身效果。',
    mag_r17_convergence:
      '交替施放火焰系與冰霜系法術，可觸發持續8秒的力量湧現，每30秒最多觸發一次。',
    mag_r20_overflowing_power:
      '消耗法力可縮短你的防禦技能冷卻時間：每消耗最大法力值的十分之一縮短2秒，每30秒最多縮短10秒。',
    dru_r20_improved_hurricane:
      '處於梟獸形態時，你與30碼內的隊伍成員獲得3%的法術致命一擊機率加成。',
    war_row_second_wind: '生命值低於35%時，你每秒恢復1.5%的生命值。',
    war_row_anger_management: '你的自動攻擊產生的怒氣提高10%，技能產生的怒氣提高5%。',
    war_row_blood_offering:
      '你的姿態獲得額外效果。戰鬥姿態：你的技能致命一擊造成的傷害提高15%。狂暴姿態：你的自動攻擊加快5%。戒備姿態：若一次命中會使你損失至少20%的最大生命值，則該次傷害降低15%。',
    war_row_battle_rhythm: '你每使用第三個技能時，該技能產生的怒氣提高20%。',
    war_row_colossal_might:
      '你每消耗1點怒氣，主要進攻技能的冷卻時間縮短0.1秒，每30秒最多縮短10秒。',
    'dru_r14_empowered_touch':
      '盛放會在每位被收割治療效果的盟友身上，重新種下一株新的野性綻放。',
    'dru_r14_moonfury':
      '月湧與日醒都會額外恢復你最大法力值的 15%。',
    'dru_r14_savage_fury':
      '你的剮擊與割裂流血效果每次造成傷害時，都會額外增加 1 層古血。',
    'dru_r20_berserk':
      '月湧、日醒、血收、碎髓與盛放的效果提高 25%。',
    'dru_r20_tranquility':
      '你每獲得 1 層月潮、古血或繁茂，會依你目前的形態恢復最大法力值的 2%、5 點能量，或 3 點怒氣。',
    'dru_r5_ferocity':
      '變形會給予 60% 移動速度，持續 3 秒，每 20 秒最多觸發一次。',
    'dru_r5_improved_wrath':
      '變形會解除可被打破的定身與減速效果。',
    'hun_r11_binding_payload':
      '霜顎陷阱會使觸發範圍內的所有敵人定身 3 秒，接著使其移動速度降低 40%，持續 4 秒。',
    'hun_r11_crippling_pursuit':
      '對已處於減速狀態的目標使用震顫射擊或桎梏斬，會使其定身 2 秒。每個目標的冷卻時間為 12 秒。',
    'hun_r14_efficient_rhythm':
      '消耗 75 點集中值後，你下一次的獸群號令、審慎射擊或剖膛打擊會額外給予 20 點集中值。',
    'hun_r14_guise_mastery':
      '持續 6 秒，獵鷂之姿使集中值產生量提高 50%，靈貂之姿使受到的直接傷害降低 25%，駿馬之姿則給予 50% 移動速度（若搭配堅韌駿馬則為 60%）。共用冷卻時間 20 秒。',
    'hun_r17_apex_instinct':
      '狂野怒火、冷靜專注或血跡突襲會恢復 40 點集中值。你接下來 3 次消耗集中值的技能，消耗降低 50%，傷害提高 20%。此效果會在觸發技能的冷卻結束後 4 秒失效。',
    'hun_r17_pack_rally':
      '駿馬之姿可以觸發獸群集結：你、你的寵物，以及 30 碼內的隊伍或團隊盟友都會獲得 30% 移動速度，以及 10% 的攻擊、施法與引導速度，持續 10 秒。冷卻時間 90 秒。',
    'hun_r17_shell_and_fang':
      '甲殼之膚生效時可以攻擊並下達寵物指令，但其傷害降低效果會減少為 40%。',
    'hun_r20_chain_reaction':
      '霜顎陷阱會標記 4 碼內的敵人，持續 8 秒。你接下來 3 次消耗集中值的技能，會在被標記的敵人之間造成 40% 的迴響傷害。',
    'hun_r20_fang_chorus':
      '每次消耗集中值的技能都會命令寵物以 50% 強度發動迴響攻擊。每第 3 次迴響會變為 4 碼範圍的拍擊。',
    'hun_r20_overdraw':
      '每第 3 次的凶厲射擊、長弓引射或反噬獠牙，會對目標造成多 35% 的傷害，並對 5 碼內最多 2 名敵人造成該傷害的 50%。',
    'hun_r5_enduring_courser':
      '駿馬之姿啟動時會給予 60% 移動速度，持續 3 秒。內部冷卻時間 20 秒。',
    'hun_r5_predators_pace':
      '成功命中的獸群號令、審慎射擊或剖膛打擊會給予 20% 移動速度，持續 3 秒。內部冷卻時間 8 秒。',
    'hun_r8_receding_shell':
      '再次施放甲殼之膚可提前結束效果，並返還其剩餘持續時間的 50%，最多返還 45 秒。',
    'hun_r8_shared_recovery':
      '野性之心同時會為你的寵物恢復 30% 生命值，並使你與寵物受到的傷害降低 20%，持續 4 秒。',
    'pal_r14_divine_purpose':
      '受昇華強化的技能有 20% 機率不消耗充能。',
    'pal_r14_sacred_reserve':
      '神聖昇華結束時，恢復 5 點虔誠。',
    'pal_r14_zeal':
      '每第三個實際產生虔誠的技能，會額外給予 1 點虔誠。',
    'pal_r17_extended_dawn':
      '神聖昇華會額外強化 2 個技能。',
    'pal_r20_dawn_echo':
      '每第三個實際產生虔誠的直接技能，都會以 40% 效果對同一目標重複造成其主要直接傷害或治療。有效的迴響會給予 1 點虔誠。迴響無法暴擊，也無法觸發其他迴響，神聖昇華期間更不會給予虔誠。',
    'pal_r20_perpetual_sun':
      '消耗你最後一次昇華充能時，會對 10 公尺內的敵人造成 150 點神聖傷害，並為 20 公尺內的盟友恢復 150 點生命值，接著使技能產生的虔誠加倍，持續 5 秒。充能到期不會觸發此效果。',
    'pal_r5_divine_steed':
      '每點虔誠提供 0.75% 移動速度，最多在 20 點虔誠時達到 15%。發動神聖昇華會消耗你的虔誠，並給予 30% 移動速度，持續 5 秒。',
    'pal_r5_radiant_stride':
      '恩典之錘造成傷害時，會給予你 30% 移動速度，持續 4 秒。',
    'pal_r8_recurring_grace':
      '恩典之錘的過量治療會轉化為一層護盾，持續 10 秒，上限為你最大生命值的 10%。',
    'pri_r11_vampiric_embrace':
      '完全消耗守護聖詠的敵人會被定身 2 秒，每個敵人每 12 秒最多觸發一次。',
    'pri_r14_pain_and_suffering':
      '教義的傷害轉治療會以其治療量的 20% 恢復守護聖詠，上限為其原始吸收量。賜福會使聖歌癒療的過量治療轉化為持續 10 秒的護盾，上限為最大生命值的 10%。每次晚禱塑像迴響都會使腐朽輓歌延長 1 秒，每個目標最多延長 6 秒。',
    'pri_r20_incarnate_spirit':
      '完全消耗的守護聖詠會為其目標恢復相當於原始吸收量 40% 的生命值。賜福守望的治療同時也會為 15 碼內最多 3 名隊伍成員恢復 40% 的治療量。5 層的晚禱什一魔造成的傷害提高 50%，持續時間延長 50%。',
    'pri_r20_second_verse':
      '2 秒後，重複 40% 來自教義的滌罪慈悲治療、來自賜福的群體治療，或來自晚禱塑像迴響的傷害。此重複效果無法觸發自身。',
    'pri_r5_improved_renew':
      '守護聖詠會給予其目標 40% 移動速度，持續 3 秒。',
    'pri_r5_searing_light':
      '帷幕步會解除定身與減速效果，接著給予 50% 移動速度，持續 3 秒。',
    'pri_r5_twisted_faith':
      '帷幕步使牧師能在移動中施法，持續 4 秒。',
    'rog_r11_cheap_trick':
      '掏腹重擊不再需要處於暮紗狀態。',
    'rog_r14_dusk_economy':
      '處於暮紗狀態，或籠罩在暗影纏身效果中時，技能消耗的能量降低 50%；離開暮紗後的 6 秒內同樣有效。',
    'rog_r20_kill_chain':
      '擊殺會重置煙遁步的冷卻，並給予 5 點連擊點。',
    'rog_r20_second_shadow':
      '以 5 點連擊點施放的入土長眠，會從陰影中再次打擊，造成其傷害 75% 的額外傷害。',
    'sha_r14_chain_lightning':
      '消耗 120 點法力後，你下一個需要消耗法力的薩滿技能會少消耗 40 點法力。此就緒狀態沒有短暫的失效時限。',
    'sha_r14_improved_flame_shock':
      '焰烙每第 3 次電弧箭會額外給予 1 層雷霆。裂風迴響的傷害提高 25%，縛石獲得 5% 傷害降低，活泉則使癒合水流的存入量提高 20%。',
    'sha_r14_weapon_fury':
      '成功命中的電弧箭、先祖打擊或療癒之水，會恢復 1 次雷霆守護充能與 10 點法力，每 6 秒最多觸發一次。',
    'sha_r17_elemental_warding':
      '啟動雷霆守護會給予 40% 傷害降低，持續 6 秒。內部冷卻時間 120 秒。',
    'sha_r17_improved_ghost_wolf':
      '就緒時，離開幽影狼狀態可讓你在 8 秒內於移動中施法。內部冷卻時間 90 秒。',
    'sha_r20_bloodlust':
      '大地震擊或裂地震波消耗全部雷霆後，會保留 2 層雷霆。法術消耗風暴施法後，會保留 1 階戰魂節律。治療鏈消耗癒合水流後，會恢復其消耗量的 25%。',
    'sha_r20_elemental_fury':
      '大地震擊或裂地震波消耗全部雷霆後，會在 1 秒後以 40% 強度重複其傷害。消耗風暴施法的法術會以 40% 強度重複效果。消耗癒合水流所產生的治療，會在 2 秒後以 40% 強度重複。這些重複效果無法觸發其他效果。',
    'sha_r20_tidal_waves':
      '大地震擊或裂地震波消耗全部雷霆後，焰烙會使下一個電弧箭瞬發。裂風迴響的最後一擊會對 8 碼內最多 2 名敵人造成 50% 的傷害。消耗風暴施法的縛石法術，會給予相當於你最大生命值 8% 的護盾。活泉生效時，潮汐召喚也會將其完整治療量的 50% 加成給予 10 碼內傷勢最重的盟友。',
    'sha_r5_imbue_mastery':
      '使用震擊後，8 秒內開始施放的下一個電弧箭或療癒之水可以在移動中施法。',
    'sha_r5_improved_lightning_shield':
      '進入幽影狼狀態會給予 60% 移動速度，持續 3 秒，每 20 秒最多觸發一次。',
    'sha_r8_frost_bind':
      '雷霆守護的反擊會給予 10% 傷害降低，持續 3 秒。',
    'wlk_r11_demon_armor':
      '每位隊伍成員首次使用你的靈魂之井時，會獲得一層護盾，吸收相當於其最大生命值 15% 的傷害，持續 30 秒。每位玩家對每口靈魂之井只能獲得一次此護盾。',
  },
  ja_JP: {
    mag_r5_blink_cast: '詠唱の途中でも、それを中断せずに瞬き歩みを使用できます。',
    mag_r8_temporal_rift: '自身のバリアを発動すると、自分にかかっている移動不能効果を解除します。',
    mag_r17_convergence:
      '炎と氷の呪文を交互に使用すると、30秒ごとに最大1回、8秒間の魔力の奔流が開きます。',
    mag_r20_overflowing_power:
      'マナを消費すると防御アビリティのクールダウンが短縮されます：最大マナの10分の1を消費するごとに2秒短縮、30秒ごとに最大10秒まで。',
    dru_r20_improved_hurricane:
      'ムーンキン・フォームの間、あなたと30yd以内のパーティメンバーは呪文クリティカル率が3%増加します。',
    war_row_second_wind: '体力が35%未満の間、毎秒、体力を1.5%回復します。',
    war_row_anger_management: '自動攻撃の怒気生成量が10%、アビリティの怒気生成量が5%増加します。',
    war_row_blood_offering:
      '各スタンスに追加効果を与えます。バトルスタンス：アビリティのクリティカルダメージが15%増加します。バーサーカースタンス：自動攻撃が5%速くなります。ガーデッドスタンス：最大体力の20%以上を失う攻撃のダメージが15%減少します。',
    war_row_battle_rhythm: '3回目に使用するアビリティは、怒気生成量が20%増加します。',
    war_row_colossal_might:
      '消費した怒気1ポイントごとに、主要な攻撃アビリティのクールダウンが0.1秒短縮されます。30秒ごとに最大10秒まで。',
    'dru_r14_empowered_touch':
      '満開は、その回復効果を刈り取ったすべての味方に、新しい野生の芽吹きを植え直す。',
    'dru_r14_moonfury':
      'ムーンサージと陽醒は、それぞれ使用時に最大マナの15%も回復する。',
    'dru_r14_savage_fury':
      '皮剥ぎと血の亀裂の出血ダメージが発生するたびに、古き血を1蓄える。',
    'dru_r20_berserk':
      'ムーンサージ、陽醒、血の収穫、骨髄砕き、満開の効果が25%強化される。',
    'dru_r20_tranquility':
      '月潮、古き血、翠成のいずれかを1獲得するたびに、現在のフォームに応じて最大マナの2%、エネルギーを5、または怒りを3回復する。',
    'dru_r5_ferocity':
      '変身すると、3秒間移動速度が60%上昇する。発動は最短でも20秒に1回まで。',
    'dru_r5_improved_wrath':
      '変身すると、解除可能な足止めと減速効果を除去する。',
    'hun_r11_binding_payload':
      '霜顎の罠は起動範囲内のすべての敵を3秒間足止めし、その後4秒間、移動速度を40%低下させる。',
    'hun_r11_crippling_pursuit':
      '動揺の射撃または足枷斬りは、すでに減速している対象を2秒間足止めする。同一対象への発動は12秒に1回まで。',
    'hun_r14_efficient_rhythm':
      '集中値を75消費すると、次に使用する群れの指令、精密射撃、腹裂きの一撃のいずれかが、集中値をさらに20生成する。',
    'hun_r14_guise_mastery':
      '6秒間、猛禽の相は集中値の生成量を50%増加させ、テンの相は受ける直接ダメージを25%軽減し、駿馬の相は移動速度を50%上昇させる（持久の駿馬修得時は60%）。共有クールダウンは20秒。',
    'hun_r17_apex_instinct':
      '野獣の怒り、冷徹集中、血跡強襲のいずれかを使用すると集中値を40回復する。以後、集中値を消費するアビリティを3回使用するまで、コストが50%減少し、与えるダメージが20%増加する。この効果は発動元のクールダウンが終了してから4秒で失われる。',
    'hun_r17_pack_rally':
      '駿馬の相が群れの結集を発動できるようになる。あなたと相棒、そして30ヤード以内のグループまたはレイドの味方は、10秒間、移動速度が30%、攻撃・詠唱・チャネリング速度が10%上昇する。クールダウン90秒。',
    'hun_r17_shell_and_fang':
      '甲殻の皮膚の効果中も攻撃とペットへの指令が行えるようになるが、ダメージ軽減率は40%に低下する。',
    'hun_r20_chain_reaction':
      '霜顎の罠は4ヤード以内の敵に8秒間の印を刻む。以後、集中値を消費するアビリティを3回使用するまで、それらのダメージの40%が印のついた敵の間で反響する。',
    'hun_r20_fang_chorus':
      '集中値を消費するアビリティを使用するたびに、ペットが50%の威力で反響攻撃を行う。3回目の反響ごとに、4ヤード範囲を叩く一撃になる。',
    'hun_r20_overdraw':
      '凶弾、引き絞り、反撃の牙のいずれかを3回使用するごとに、対象へ与えるダメージが35%増加し、そのダメージの50%を5ヤード以内の敵最大2体にも与える。',
    'hun_r5_enduring_courser':
      '駿馬の相を発動すると、3秒間移動速度が60%上昇する。発動は20秒に1回まで。',
    'hun_r5_predators_pace':
      '群れの指令、精密射撃、腹裂きの一撃のいずれかが命中すると、3秒間移動速度が20%上昇する。発動は8秒に1回まで。',
    'hun_r8_receding_shell':
      '甲殻の皮膚を再使用すると効果を早期に終了させ、残っていた持続時間の50%（最大45秒）をクールダウン短縮として還元する。',
    'hun_r8_shared_recovery':
      '野生の心はペットも30%回復させ、4秒間、自分とペットの両方が受けるダメージを20%軽減する。',
    'pal_r14_divine_purpose':
      '昇天で強化されたアビリティは、20%の確率でチャージを消費しない。',
    'pal_r14_sacred_reserve':
      '神聖なる昇天が終了すると、献身を5獲得する。',
    'pal_r14_zeal':
      '実際に献身を生成するアビリティを3回使用するごとに、献身をさらに1獲得する。',
    'pal_r17_extended_dawn':
      '神聖なる昇天が強化するアビリティが2つ増える。',
    'pal_r20_dawn_echo':
      '実際に献身を生成する直接効果のアビリティを3回使用するごとに、同じ対象へ主要な直接ダメージまたは回復の40%を再度発動する。効果のあった反響は献身を1獲得する。この反響はクリティカルにならず、他の反響を誘発せず、神聖なる昇天の間は献身を生成しない。',
    'pal_r20_perpetual_sun':
      '昇天の最後のチャージを消費すると、10メートル以内に150の神聖ダメージを与え、20メートル以内の味方を150回復し、その後5秒間、アビリティによる献身の生成量が2倍になる。チャージが自然消滅した場合は発動しない。',
    'pal_r5_divine_steed':
      '献身1につき移動速度が0.75%上昇し、献身20で最大15%になる。神聖なる昇天を発動すると献身を消費し、5秒間移動速度が30%上昇する。',
    'pal_r5_radiant_stride':
      '恩寵の槌がダメージを与えると、4秒間移動速度が30%上昇する。',
    'pal_r8_recurring_grace':
      '恩寵の槌のオーバーヒール分が10秒間の吸収シールドになる。上限は最大体力の10%。',
    'pri_r11_vampiric_embrace':
      '守りの聖歌を完全に消費させた敵を2秒間足止めする。同じ敵への発動は12秒に1回まで。',
    'pri_r14_pain_and_suffering':
      'ドクトリンによるダメージ回復は、その回復量の20%分だけ守りの聖歌を回復する（元の吸収量が上限）。ベネディクションでは、聖歌の癒しのオーバーヒール分が10秒間の吸収シールドに変わる（上限は最大体力の10%）。ヴェスパーのエフィジーへの反響が発生するたびに、腐朽の葬送歌の持続時間が1秒延長される（対象1体につき最大6秒まで）。',
    'pri_r20_incarnate_spirit':
      '守りの聖歌を完全に消費させると、対象を元の吸収量の40%分回復する。ベネディクションの熾天使の見守りによる回復は、15ヤード以内のパーティメンバー最大3人にも40%の量を回復する。5スタックのヴェスパーのタイスフィーンドは、与えるダメージが50%増加し、持続時間が50%延びる。',
    'pri_r20_second_verse':
      '2秒後、ドクトリンによる浄罪の慈悲の回復、ベネディクションによる範囲回復、またはヴェスパーのエフィジーへの反響ダメージの40%を再度発動する。この再発動が自身を再度誘発することはない。',
    'pri_r5_improved_renew':
      '守りの聖歌は対象に、3秒間移動速度を40%上昇させる効果を与える。',
    'pri_r5_searing_light':
      'ヴェイルステップは足止めと減速効果を解除し、その後3秒間移動速度を50%上昇させる。',
    'pri_r5_twisted_faith':
      'ヴェイルステップの使用後4秒間、移動しながら詠唱できるようになる。',
    'rog_r11_cheap_trick':
      'みぞおち強打の使用にダスクヴェールが不要になる。',
    'rog_r14_dusk_economy':
      'ダスクヴェール中、または影に包まれている間、そしてダスクヴェールを解除してから6秒間は、アビリティの消費エナジーが50%減少する。',
    'rog_r20_kill_chain':
      'とどめの一撃を与えると、煙隠れのクールダウンがリセットされ、コンボポイントを5獲得する。',
    'rog_r20_second_shadow':
      'コンボポイント5で永の眠りを使用すると、影から再び攻撃し、通常の75%のダメージを与える。',
    'sha_r14_chain_lightning':
      'マナを120消費すると、次にマナを消費するシャーマンのアビリティのコストが40減少する。この状態に短い有効期限はない。',
    'sha_r14_improved_flame_shock':
      '火焔烙印は、電弧の矢を3回使用するごとに雷鳴をさらに1獲得する。ゲイルハートエコーのダメージが25%増加し、石縛は受けるダメージが5%軽減され、命泉は治癒の奔流への蓄積量が20%増加する。',
    'sha_r14_weapon_fury':
      '電弧の矢、祖霊の一撃、癒しの水流のいずれかが命中すると、雷の守りのチャージを1、マナを10回復する。発動は6秒に1回まで。',
    'sha_r17_elemental_warding':
      '雷の守りを発動すると、6秒間受けるダメージが40%軽減される。発動は120秒に1回まで。',
    'sha_r17_improved_ghost_wolf':
      '準備ができている場合、シェイドウルフを解除すると8秒間、移動しながら詠唱できるようになる。発動は90秒に1回まで。',
    'sha_r20_bloodlust':
      '大地の衝撃または地震がすべての雷鳴を消費した後、雷鳴を2残す。呪文がストームキャストを消費した後、戦霊の律動の段階を1残す。チェインヒールが治癒の奔流を消費した後、消費した量の25%を取り戻す。',
    'sha_r20_elemental_fury':
      '大地の衝撃または地震がすべての雷鳴を消費した後、1秒後にそのダメージの40%を再度発動する。ストームキャストを消費した呪文は、40%の威力で再発動する。治癒の奔流の消費による回復は、2秒後に40%の威力で再発動する。これらの再発動は他の効果を誘発しない。',
    'sha_r20_tidal_waves':
      '大地の衝撃または地震がすべての雷鳴を消費した後、火焔烙印は次の電弧の矢を即時発動にする。ゲイルハートエコーの最後の1回は、8ヤード以内の敵最大2体に50%のダメージを与える。ストームキャストを消費する石縛の呪文は、最大体力の8%分の吸収シールドを付与する。命泉が有効なとき、潮呼びは全回復量の50%を10ヤード以内の最も負傷した味方にも追加で与える。',
    'sha_r5_imbue_mastery':
      'ジョルトを使用すると、8秒以内に開始した次の電弧の矢または癒しの水流を、移動しながら詠唱できる。',
    'sha_r5_improved_lightning_shield':
      'シェイドウルフに変身すると、3秒間移動速度が60%上昇する。発動は20秒に1回まで。',
    'sha_r8_frost_bind':
      '雷の守りの反撃が発動すると、3秒間受けるダメージが10%軽減される。',
    'wlk_r11_demon_armor':
      'グループメンバーが初めて魂の泉に触れると、30秒間、最大体力の15%分のシールドを得る。このシールドは魂の泉1つにつき、各プレイヤーが1回だけ得られる。',
  },
  ko_KR: {
    mag_r5_blink_cast: '시전 도중에도 섬광걸음을 사용할 수 있으며, 시전이 끊기지 않습니다.',
    mag_r8_temporal_rift: '개인 보호막을 시전하면 자신에게 걸린 이동 불가 효과가 해제됩니다.',
    mag_r17_convergence:
      '화염 주문과 냉기 주문을 번갈아 사용하면 8초간 마력이 분출됩니다. 30초마다 한 번 발동합니다.',
    mag_r20_overflowing_power:
      '마나를 소비하면 방어 기술의 재사용 대기시간이 단축됩니다. 최대 마나의 10분의 1을 소비할 때마다 2초씩, 30초마다 최대 10초까지 줄어듭니다.',
    dru_r20_improved_hurricane:
      '달빛야수 변신 상태에서 30미터 이내의 파티원과 함께 주문 치명타율이 3% 증가합니다.',
    war_row_second_wind: '생명력이 35% 미만이면 매초 생명력의 1.5%를 회복합니다.',
    war_row_anger_management: '자동 공격의 분노 생성량이 10%, 능력의 분노 생성량이 5% 증가합니다.',
    war_row_blood_offering:
      '각 태세에 추가 효과가 부여됩니다. 전투 태세: 능력의 치명타 피해가 15% 증가합니다. 광전사 태세: 자동 공격이 5% 빨라집니다. 방어 태세: 최대 생명력의 20% 이상을 잃게 할 공격의 피해가 15% 감소합니다.',
    war_row_battle_rhythm: '세 번째로 사용하는 능력은 분노 생성량이 20% 증가합니다.',
    war_row_colossal_might:
      '소비한 분노 1포인트마다 주요 공격 기술의 재사용 대기시간이 0.1초 단축됩니다. 30초마다 최대 10초까지 줄어듭니다.',
    'dru_r14_empowered_touch':
      '만개는 치유 효과를 거둬들인 모든 아군에게 새로운 야생 개화를 다시 심어 줍니다.',
    'dru_r14_moonfury':
      '달의 격동과 해돋움은 사용할 때마다 최대 마나의 15%도 함께 회복시켜 줍니다.',
    'dru_r14_savage_fury':
      '저미기와 찢기의 출혈 효과가 틱마다 오랜 피를 1단계 추가로 쌓습니다.',
    'dru_r20_berserk':
      '달의 격동, 해돋움, 피의 수확, 골수분쇄, 만개의 효과가 25% 강력해집니다.',
    'dru_r20_tranquility':
      '달물결, 오랜 피, 푸른 생장을 1 얻을 때마다 현재 변신 형태에 맞춰 최대 마나의 2%, 기력 5, 또는 분노 3을 회복합니다.',
    'dru_r5_ferocity':
      '변신하면 3초 동안 이동 속도가 60% 증가하며, 20초에 한 번만 발동합니다.',
    'dru_r5_improved_wrath':
      '변신하면 해제 가능한 속박과 감속 효과가 사라집니다.',
    'hun_r11_binding_payload':
      '서리턱 덫이 발동 범위 안의 모든 적을 3초 동안 이동 불가로 만들고, 이어서 4초 동안 이동 속도를 40% 감소시킵니다.',
    'hun_r11_crippling_pursuit':
      '이미 감속된 대상에게 뒤흔드는 사격이나 족쇄 베기를 사용하면 대상을 2초 동안 이동 불가로 만듭니다. 대상별 재사용 대기시간 12초.',
    'hun_r14_efficient_rhythm':
      '집중을 75 소모하면, 다음에 사용하는 무리 명령, 정밀 사격, 내장 가르기가 집중을 20 추가로 부여합니다.',
    'hun_r14_guise_mastery':
      '6초 동안 새매의 상은 집중 생성량을 50% 증가시키고, 담비의 상은 직접 피해를 25% 감소시키며, 준마의 상은 이동 속도를 50%(인내의 준마 보유 시 60%) 증가시킵니다. 공용 재사용 대기시간 20초.',
    'hun_r17_apex_instinct':
      '야수의 격노, 냉정한 집중, 핏길 습격을 사용하면 집중을 40 회복합니다. 이후 사용하는 집중 소모 기술 3회는 소모량이 50% 줄고 피해가 20% 증가합니다. 이 효과는 발동시킨 재사용 대기시간이 끝난 뒤 4초가 지나면 사라집니다.',
    'hun_r17_pack_rally':
      '준마의 상을 취하면 무리 결집이 발동할 수 있습니다. 자신과 소환수, 그리고 30야드 이내의 파티 또는 공격대원은 10초 동안 이동 속도가 30%, 공격 및 시전, 정신 집중 속도가 10% 증가합니다. 재사용 대기시간 90초.',
    'hun_r17_shell_and_fang':
      '갑각 피부 사용 중에도 공격과 소환수 명령이 가능해지지만, 받는 피해 감소 효과가 40%로 줄어듭니다.',
    'hun_r20_chain_reaction':
      '서리턱 덫이 4야드 이내의 적에게 8초 동안 표식을 남깁니다. 이후 사용하는 집중 소모 기술 3회는 표식이 남은 적들 사이에 피해의 40%를 반향시킵니다.',
    'hun_r20_fang_chorus':
      '집중 소모 기술을 사용할 때마다 소환수가 50% 위력의 메아리 공격을 가합니다. 3번째 메아리마다 4미터 범위의 휩쓸기로 변합니다.',
    'hun_r20_overdraw':
      '사악한 사격, 긴 시위, 반격의 송곳니를 3번째로 사용할 때마다 대상에게 35% 더 많은 피해를 입히고, 5야드 이내의 적 최대 2명에게 그 피해의 50%를 입힙니다.',
    'hun_r5_enduring_courser':
      '준마의 상을 발동하면 3초 동안 이동 속도가 60% 증가합니다. 내부 재사용 대기시간 20초.',
    'hun_r5_predators_pace':
      '무리 명령, 정밀 사격, 내장 가르기가 적중하면 3초 동안 이동 속도가 20% 증가합니다. 내부 재사용 대기시간 8초.',
    'hun_r8_receding_shell':
      '갑각 피부를 다시 시전하면 효과가 조기에 종료되고, 남아 있던 지속시간의 50%를 최대 45초까지 돌려받습니다.',
    'hun_r8_shared_recovery':
      '야생의 심장이 소환수의 생명력도 30% 회복시키며, 자신과 소환수 모두에게 4초 동안 받는 피해를 20% 감소시켜 줍니다.',
    'pal_r14_divine_purpose':
      '승천으로 강화된 능력은 20% 확률로 충전을 소모하지 않습니다.',
    'pal_r14_sacred_reserve':
      '신성한 승천이 끝나면 헌신을 5 되찾습니다.',
    'pal_r14_zeal':
      '실제로 헌신을 생성하는 능력을 3번째로 사용할 때마다 헌신을 1 추가로 얻습니다.',
    'pal_r17_extended_dawn':
      '신성한 승천이 강화하는 능력이 2개 늘어납니다.',
    'pal_r20_dawn_echo':
      '실제로 헌신을 생성하는 직접 능력을 3번째로 사용할 때마다 같은 대상에게 주 피해 또는 치유 효과의 40%를 다시 발생시킵니다. 효과가 발생한 메아리는 헌신을 1 부여합니다. 이 메아리는 치명타가 발생하지 않고 다른 메아리를 발동시키지 않으며, 신성한 승천 중에는 헌신을 부여하지 않습니다.',
    'pal_r20_perpetual_sun':
      '마지막 승천 충전을 소모하면 10미터 이내의 적에게 150의 신성 피해를 입히고 20미터 이내의 아군을 150만큼 치유한 뒤, 5초 동안 능력의 헌신 생성량이 두 배가 됩니다. 충전이 시간 만료로 사라질 때는 발동하지 않습니다.',
    'pal_r5_divine_steed':
      '헌신 1당 이동 속도가 0.75%씩 증가하며, 헌신 20에서 최대 15%까지 증가합니다. 신성한 승천을 활성화하면 헌신을 소모하고 5초 동안 이동 속도가 30% 증가합니다.',
    'pal_r5_radiant_stride':
      '은총의 망치가 피해를 입히면 4초 동안 이동 속도가 30% 증가합니다.',
    'pal_r8_recurring_grace':
      '은총의 망치의 초과 치유량이 10초 동안 지속되는 흡수 보호막이 되며, 최대 생명력의 10%까지 저장됩니다.',
    'pri_r11_vampiric_embrace':
      '수호의 성가를 완전히 소진시킨 적은 2초 동안 이동 불가 상태가 되며, 동일한 적에게는 12초에 한 번만 적용됩니다.',
    'pri_r14_pain_and_suffering':
      '교리로 발생한 피해 전환 치유는 치유량의 20%만큼 수호의 성가를 회복시키며, 원래 흡수량을 넘지 않습니다. 축복은 성가 치유의 초과 치유량을 최대 생명력의 10%까지 흡수하는 10초짜리 보호막으로 전환합니다. 만과의 형상에서 메아리가 발생할 때마다 부패의 만가의 지속시간이 1초 늘어나며, 대상당 최대 6초까지 늘어납니다.',
    'pri_r20_incarnate_spirit':
      '수호의 성가를 완전히 소진시키면 대상의 생명력을 원래 흡수량의 40%만큼 회복시킵니다. 축복의 수호로 인한 치유는 15야드 이내의 파티원 최대 3명에게도 40%만큼 적용됩니다. 5단계까지 쌓인 만과의 십일조 악마는 피해가 50% 증가하고 지속시간도 50% 늘어납니다.',
    'pri_r20_second_verse':
      '2초 후, 교리로 발생한 정화의 자비의 치유량, 축복의 광역 치유량, 만과의 형상 메아리 피해량 중 40%를 다시 발생시킵니다. 이 반복 효과는 스스로를 다시 발동시키지 않습니다.',
    'pri_r5_improved_renew':
      '수호의 성가가 대상에게 3초 동안 이동 속도 40% 증가 효과를 부여합니다.',
    'pri_r5_searing_light':
      '장막걸음을 사용하면 속박과 감속 효과가 사라지고, 3초 동안 이동 속도가 50% 증가합니다.',
    'pri_r5_twisted_faith':
      '장막걸음을 사용하면 4초 동안 이동하면서 시전할 수 있습니다.',
    'rog_r11_cheap_trick':
      '명치 가격에 더 이상 황혼장막이 필요하지 않습니다.',
    'rog_r14_dusk_economy':
      '황혼장막 상태이거나 그림자에 휩싸인 동안, 그리고 황혼장막에서 벗어난 뒤 6초 동안 능력의 기력 소모가 50% 줄어듭니다.',
    'rog_r20_kill_chain':
      '적을 처치하면 연막 걸음의 재사용 대기시간이 초기화되고 연계 점수 5점을 얻습니다.',
    'rog_r20_second_shadow':
      '연계 점수 5점으로 사용한 영면은 그림자 속에서 한 번 더 공격해 피해의 75%를 추가로 입힙니다.',
    'sha_r14_chain_lightning':
      '마나를 120 소모하면, 마나를 소모하는 다음 주술사 능력의 비용이 40 줄어듭니다. 이 상태는 짧은 만료 시간 없이 유지됩니다.',
    'sha_r14_improved_flame_shock':
      '화염낙인은 전격 화살을 3번째로 사용할 때마다 천둥을 1 추가로 부여합니다. 질풍의 메아리는 피해가 25% 증가하고, 바위결속은 받는 피해가 5% 감소하며, 생명의 샘은 치유의 물결 저장량이 20% 늘어납니다.',
    'sha_r14_weapon_fury':
      '전격 화살, 선조의 일격, 치유의 물결이 적중하면 천둥 결계 충전을 1회와 마나 10을 회복하며, 6초에 한 번만 발동합니다.',
    'sha_r17_elemental_warding':
      '천둥 결계를 활성화하면 6초 동안 받는 피해가 40% 감소합니다. 내부 재사용 대기시간 120초.',
    'sha_r17_improved_ghost_wolf':
      '준비되어 있을 때 그림자늑대에서 벗어나면 8초 동안 이동하면서 시전할 수 있습니다. 내부 재사용 대기시간 90초.',
    'sha_r20_bloodlust':
      '대지의 충격이나 지진이 천둥을 모두 소모한 뒤에도 천둥 2를 유지합니다. 주문이 폭풍시전을 소모한 뒤에도 전령의 박자 1단계를 유지합니다. 연쇄 치유가 치유의 물결을 소모하면 소모량의 25%를 되돌려받습니다.',
    'sha_r20_elemental_fury':
      '대지의 충격이나 지진이 천둥을 모두 소모하면, 1초 후 피해의 40%를 다시 발생시킵니다. 폭풍시전을 소모하는 주문은 40% 위력으로 한 번 더 발동합니다. 치유의 물결 소모로 발생한 치유는 2초 후 40% 위력으로 다시 발생합니다. 이 반복 효과들은 다른 효과를 발동시키지 않습니다.',
    'sha_r20_tidal_waves':
      '대지의 충격이나 지진이 천둥을 모두 소모하면, 화염낙인 상태에서는 다음 전격 화살이 즉시 시전됩니다. 질풍의 마지막 메아리는 8야드 이내의 적 최대 2명에게 50%의 피해를 입힙니다. 폭풍시전을 소모하는 바위결속 주문은 최대 생명력의 8%에 해당하는 흡수 보호막을 부여합니다. 생명의 샘이 활성화된 상태에서는 해일 부름이 10야드 이내에서 가장 심하게 다친 아군에게 전체 치유량의 50%를 추가로 더합니다.',
    'sha_r5_imbue_mastery':
      '충격 계열 능력을 사용한 뒤 8초 안에 시전하는 다음 전격 화살 또는 치유의 물결은 이동하면서 시전할 수 있습니다.',
    'sha_r5_improved_lightning_shield':
      '그림자늑대로 변신하면 3초 동안 이동 속도가 60% 증가하며, 20초에 한 번만 발동합니다.',
    'sha_r8_frost_bind':
      '천둥 결계의 반격 효과가 발동하면 3초 동안 받는 피해가 10% 감소합니다.',
    'wlk_r11_demon_armor':
      '파티원이 자신의 영혼샘을 처음 사용할 때, 대상에게 30초 동안 최대 생명력의 15%를 흡수하는 보호막을 부여합니다. 각 플레이어는 영혼샘 하나당 이 보호막을 한 번만 얻을 수 있습니다.',
  },
};
