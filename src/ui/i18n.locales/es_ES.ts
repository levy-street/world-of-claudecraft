// Divergence-only dialect overlay for "es_ES" over base locale "es".
//
// "es_ES" inherits from "es": the build (scripts/i18n_build.mjs) resolves it as
// nested `en` -> es overlay -> this overlay, so any key absent here falls through to es, then to English. This file
// therefore carries ONLY the keys whose value differs from es; every other key is
// intentionally omitted. A key must NOT be re-added with a value equal to es
// (redundant duplication). Every key here must be a real `en` leaf
// path (tests/i18n_overlay_key_membership.test.ts + the byte gate). Keys are in `en`'s
// leaf order.

import type { TranslationKey } from '../i18n.catalog';

export const es_ES: Partial<Record<TranslationKey, string>> = {
  // Stat tooltips inherit the es base: none of these keys needs a genuine Iberian
  // divergence (es already uses "hechizos" and neutral wording), so per the
  // divergence-only policy es_ES carries no hudChrome.statInfo.* overrides.
  'hudChrome.emotes.question': '¿Tío?',
  'nav.loginRegister': 'Iniciar sesión/Registrarse',
  'stats.playersOnline': 'Jugadores en línea',
  'stats.realmName': 'Nombre del reino',
  'footer.githubLabel': 'Proyecto de código abierto',
  'footer.terms': 'Términos de servicio',
  'footer.privacy': 'Política de privacidad',
  'highscores.title': 'Tabla de clasificaciones',
  'wiki.title': 'Wiki y guía del juego',
  'news.title': 'Noticias y actualizaciones',
  'download.title': 'Descargar lanzador de escritorio',
  'mode.onlineTitle': 'Jugar en línea',
  'mode.onlineAria': 'Jugar en línea: inicia sesión en el reino compartido persistente',
  'mode.offlineTitle': 'Jugar en solitario',
  'mode.offlineAria': 'Jugar en solitario: inicia una sesión local instantánea de un jugador',
  'auth.enterRealm': 'Entrar al reino',
  'auth.logIn': 'Iniciar sesión',
  'auth.createAccount': 'Crear cuenta',
  'auth.realmList': 'Lista de reinos',
  'auth.changeRealm': 'Cambiar de reino',
  'auth.createCharacter': 'Crear personaje',
  'auth.characterName': 'Nombre del personaje',
  'auth.enterWorld': 'Entrar al mundo',
  'auth.offlineCharacter': 'Personaje en solitario',
  'controls.title': 'Guía de controles',
  'controls.moveTurn': 'Moverse/Girar',
  'controls.autorun': 'Correr automáticamente',
  'controls.combat': 'Combate e interacción',
  'controls.target': 'Marcar enemigo',
  'controls.spells': 'Lanzar hechizos',
  'controls.interact': 'Interactuar/Despojar',
  'controls.nameplates': 'Mostrar nombres',
  'controls.camera': 'Cámara y ratón',
  'controls.rightDrag': 'Arrastrar clic derecho',
  'controls.leftDrag': 'Arrastrar clic izquierdo',
  'controls.mouseWheel': 'Rueda del ratón',
  'controls.mouselook': 'Mirar con ratón',
  'controls.orbit': 'Rotar cámara',
  'controls.charPane': 'Panel de personaje',
  'controls.spellbook': 'Libro de hechizos',
  'controls.questLog': 'Diario de misiones',
  'controls.worldMap': 'Mapa del mundo',
  'controls.bags': 'Inventario de bolsas',
  'controls.friends': 'Amigos y hermandad',
  'controls.chat': 'Abrir chat',
  'seo.description':
    'Emprende una aventura épica en World of ClaudeCraft, un micro-MMO de estilo clásico jugable directamente en el navegador. Únete a un reino compartido, sube clases de nivel y derrota enemigos.',
  'a11y.goHome': 'Ir a la página de inicio',
  'a11y.characterActions': 'Acciones del personaje',
  'a11y.githubProject': 'Abrir el proyecto World of ClaudeCraft en GitHub',
  'loading.enteringWorld': 'Entrando en el mundo...',
  'loading.assetsFailed': 'Error al cargar recursos: prueba a recargar. {error}',
  'loading.rendererFailed': 'No se pudo iniciar el renderizador: prueba a recargar. {error}',
  'loading.enterTimeout':
    'No se pudo entrar en el mundo. La conexión agotó el tiempo de espera. ¿Está funcionando el servidor del juego?',
  'errors.nothingInteract': 'No hay nada con lo que interactuar.',
  'errors.characterNameInvalid':
    'El nombre debe tener 2-16 caracteres, empezar por una letra y contener solo letras, espacios, guiones o apóstrofes.',
  'errors.api.tooManyAttempts': 'Demasiados intentos. Espera un minuto y vuelve a intentarlo.',
  'errors.api.accountBanned': 'Esta cuenta ha sido vetada.',
  'errors.api.renameBeforeEntering':
    'Este personaje debe cambiar de nombre antes de entrar en el mundo.',
  'classDetails.lore.warrior':
    'Los guerreros son combatientes curtidos que generan ira al infligir o recibir daño. Absorben grandes golpes o aplastan enemigos con armas pesadas.',
  'classDetails.lore.hunter':
    'Los cazadores son especialistas a distancia que combaten junto a una bestia domada, acribillan a los enemigos con disparos certeros y veloces, los ralentizan con picaduras y fuego conmocionante, y cambian de aspecto según lo exija el momento.',
  'classDetails.lore.rogue':
    'Los pícaros son asesinos sigilosos que gastan energía y puntos de combo en puñaladas y golpes finales desde las sombras.',
  'classDetails.lore.shaman':
    'Los chamanes dominan los elementos, imbuyen armas con poder, golpean con relámpagos y restauran a sus aliados.',
  'classDetails.lore.warlock':
    'Los brujos invocan demonios, lanzan maldiciones y daño en el tiempo, y drenan vida para resistir.',
  'classDetails.lore.druid':
    'Los druidas canalizan la naturaleza, curan heridas, enredan enemigos y cambian a formas animales para defender o dañar.',
  'mobilePreflight.baseLandscape': 'Gira el dispositivo a horizontal antes de entrar en el mundo.',
  'mobilePreflight.basePerformance':
    'El rendimiento móvil puede degradarse. Cierra pestañas extra y baja la calidad de renderizado si el juego va lento.',
  'mobilePreflight.iosInstallDetail':
    'Para pantalla completa real en iPhone o iPad, instala primero esta página en tu pantalla de inicio.',
  'mobilePreflight.iosShareStep': 'En Safari, toca Compartir y luego Añadir a pantalla de inicio.',
  'mobilePreflight.androidStandaloneDetail':
    'Estás en modo de app a pantalla completa. Mantén el dispositivo en horizontal.',
  'mobilePreflight.androidInstallDetail':
    'Para pantalla completa en Android, instala esta página o añádela a la pantalla de inicio primero.',
  'mobilePreflight.androidInstallStep':
    'En Chrome, toca el menú y luego Instalar app o Añadir a pantalla de inicio.',
  'mobilePreflight.otherInstallDetail':
    'Instala o añade esta página a la pantalla de inicio para la mejor experiencia móvil a pantalla completa.',
  // Quest-tracker header toggle hover hint (es_ES uses "seguimiento" vs es-LatAm
  // "rastreador"); the count badge inherits es (identical "({count})").
  'hudChrome.questTracker.collapseHint': 'Contraer el seguimiento de misiones',
  'hudChrome.questTracker.expandHint': 'Expandir el seguimiento de misiones',
  // v0.13.0 release i18n fill: bug report, chat window, character takeover, admin bug reports
  'hudChrome.bugReport.failed': 'No se pudo enviar el informe de error. Inténtalo de nuevo.',
  'hudChrome.bugReport.menuButton': 'Informar de un error',
  'hudChrome.bugReport.rateLimited':
    'Has enviado varios informes hace poco. Espera un momento antes de enviar otro.',
  'hudChrome.bugReport.screenshotAlt':
    'Captura de pantalla de la vista actual adjunta a este informe de error',
  'hudChrome.bugReport.submit': 'Enviar informe',
  'hudChrome.bugReport.submitted': 'Informe de error enviado. ¡Gracias!',
  'hudChrome.bugReport.submittedNoShot':
    'Informe de error enviado, pero la captura de pantalla era demasiado grande para incluirla.',
  'hudChrome.bugReport.tooLarge':
    'Ese informe es demasiado grande para enviarlo. Inténtalo de nuevo sin la captura de pantalla.',
  'delveUi.affix.bad_air': 'Aire viciado',
  'delveUi.affix.candleblind': 'Cegavelas',
  'delveUi.affix.cult_remnants': 'Vestigios del culto',
  'delveUi.affix.flooded_paths': 'Senderos inundados',
  'delveUi.affix.grave_tax': 'Tributo sepulcral',
  'delveUi.affix.old_mechanisms': 'Mecanismos viejos',
  'delveUi.affix.restless_graves': 'Tumbas inquietas',
  'delveUi.affix.unstable_roof': 'Techo inestable',
  'delveUi.blessing.chapel_candle':
    'Vela de capilla: incursión más segura, una Marca menos al completarla.',
  'delveUi.board.enter': 'Entrar en la Profundidad',
  'delveUi.board.enterAria': 'Entrar en {delve} en dificultad {tier}',
  'delveUi.board.marks': 'Marcas de Profundidad: {count}',
  'delveUi.board.openDelveAria': 'Abrir el Tablón de Profundidades desde {name}',
  'delveUi.board.title': 'Tablón de Profundidades',
  'delveUi.boss.varric.bell.log': 'El Diácono Varric empieza a tañer la campana funeraria.',
  'delveUi.boss.varric.bell.warning': '¡Apártate del Diácono Varric!',
  'delveUi.boss.varric.mid30': 'La campana funeraria responde a cada nombre que pronuncia.',
  'delveUi.boss.varric.mid60':
    'El Diácono Varric lee nombres del registro con un júbilo tembloroso.',
  'delveUi.boss.varric.pull':
    'Pisas el polvo sagrado con un propósito impuro. Arrodíllate y deja que te cuenten.',
  'delveUi.boss.varric.raise.emote': '¡El Diácono Varric invoca nombres desde las tumbas rotas!',
  'delveUi.boss.varric.raise.interrupt_ok': 'El rito sepulcral vacila.',
  'delveUi.boss.varric.raise.log': 'El Diácono Varric empieza a alzar a los muertos.',
  'delveUi.boss.varric.raise.object': 'La tumba agrietada se estremece con un aliento robado.',
  'delveUi.boss.varric.raise.warning': '¡Detén el rito sepulcral!',
  'delveUi.companion.tessa.combat_start':
    'Afírmate, {playerName}. Aquí los muertos están inquietos.',
  'delveUi.companion.tessa.low_hp': 'Respira. Aún me quedan oraciones para ti.',
  'delveUi.companion.tessa.rank.1': 'Novicia de la capilla',
  'delveUi.companion.tessa.rank.2': 'Portavelas',
  'delveUi.companion.tessa.rank.4': 'Testigo del clamor sepulcral',
  'delveUi.companion.tessa.rank.5': 'Custodia de la capilla',
  'delveUi.companion.tessa.trap_spotted': 'Espera... algo en el suelo recuerda las pisadas.',
  'delveUi.death.warning': 'Una muerte más acabará con esta incursión a la Profundidad.',
  'delveUi.intro.heroic':
    'Las puertas se cierran con un quejido a tu espalda. Los nombres rascan la piedra como uñas. La vela de Tessa arde azul. "Ya no están llamando a los muertos, {playerName}. Están respondiendo a algo."',
  'delveUi.intro.normal':
    'La escalera es fría y oscura. Piedras sagradas rotas cubren el descenso, y una suave nota de campana flota en el aire húmedo. La Acólita Tessa susurra: "El relicario no debería estar abierto tan abajo. No te alejes, {playerName}."',
  'delveUi.lore.bell_below':
    'Nota al margen de Tessa: "Hay una segunda campana bajo el relicario. Tañe por los traspapelados, no por los muertos."',
  'delveUi.lore.first_collapse':
    'Los registros de la capilla anotan el primer hundimiento: piedras sagradas resquebrajadas, estantes inclinados y una nota de campana oída desde bajo tierra.',
  'delveUi.lore.gravecaller_mark':
    'Un sigilo raspado en la madera de un ataúd, no el sello de Morthen, sino una marca de invocasepulcros más antigua, anterior a la Cripta Hueca.',
  'delveUi.lore.tessa_note':
    'Un retazo doblado con la letra de Tessa: "Si los registros cambian mientras estamos abajo, fíate de la vela, no de las voces."',
  'delveUi.module.reliquary_saintless_hall':
    'Estatuas con los rostros cincelados con un odio meticuloso.',
  'delveUi.module.reliquary_sunken_ossuary':
    'El agua se filtra por los estantes funerarios, arrastrando vieja ceniza en arroyos de plata y negro.',
  'delveUi.npc.halven.greeting':
    'El relicario de abajo ha vuelto a moverse. Oímos cánticos a través del suelo pasada la medianoche, y la Acólita Tessa jura que los registros funerarios cambian su propia tinta. Si tienes valor suficiente, {playerName}, coge una vela y baja. No confíes en cada voz que oigas ahí abajo. Algunas conocían tu nombre antes de que nacieras.',
  'delveUi.run.failed':
    'La incursión a la Profundidad ha fracasado. Vuelves con el Hermano Halven.',
  'delveUi.summary.marks': '{count} Marcas de Profundidad obtenidas',
  'delveUi.summary.title': 'Profundidad completada',
  'delveUi.tracker.affix': 'Afijos',
  'delveUi.tracker.complete': 'Completada',
  'delveUi.tracker.marks': 'Marcas de Profundidad: {count}',
  'delveUi.tracker.title': 'Profundidad',
  'entities.delves.collapsed_reliquary.leaveText':
    'Trepas de vuelta hasta el Hermano Halven, en la ruina del relicario.',
  'entities.mobs.reliquary_bonewalker.name': 'Caminahuesos alzado',
  'entities.mobs.reliquary_gravecall_acolyte.name': 'Acólito invocasepulcros',
  'entities.npcs.brother_halven.greeting': 'El relicario de abajo ha vuelto a moverse.',
  'sim.delve.alreadyInDelve': 'Ya estás en una Profundidad.',
  'sim.delve.bossChest':
    'El jefe cae. Un cofre de relicario protegido se alza en el estrado. Fuerza su cerradura para reclamar tu botín.',
  'sim.delve.cannotAffordCompanionUpgrade': 'No puedes permitirte esta mejora.',
  'sim.delve.cannotEnterNow': 'No puedes entrar en una Profundidad ahora mismo.',
  'sim.delve.companionMarksRequired':
    'Necesitas {marks} Marcas de Profundidad para mejorar a {name}.',
  'sim.delve.complete': '{name} completada.',
  'sim.delve.duringArena': 'No puedes entrar en una Profundidad durante un combate de arena.',
  'sim.delve.duringDuel': 'No puedes entrar en una Profundidad durante un duelo.',
  'sim.delve.graveFalters': 'El rito sepulcral vacila.',
  'sim.delve.levelRequired': 'Debes ser nivel {level} para entrar en {name}.',
  'sim.delve.mechanismOpen':
    'Un mecanismo se abre con un chasquido cerca. Se abre un pasaje hacia el norte. Busca el portal de salida más adelante.',
  'sim.delve.moveCloserChest': 'Acércate más al cofre.',
  'sim.delve.moveCloserPassage': 'Acércate más al pasaje.',
  'sim.delve.moveCloserStairs': 'Acércate más a las escaleras.',
  'sim.delve.notInDelve': 'No estás en una Profundidad.',
  'sim.delve.nothingHappens': 'No pasa nada.',
  'sim.delve.raiseDead': '{name} empieza a alzar a los muertos.',
  'sim.delve.runFailed': 'La incursión a {name} ha fracasado.',
  'sim.delve.strikeWall': 'Golpea el muro para abrirte paso.',
  'sim.delve.tombstoneHint':
    'Un pasaje de lápida se abre hacia el norte cuando la sala queda despejada.',
  'sim.delve.tombstoneOpen':
    'Un pasaje de lápida sellado se abre con un chirrido hacia el norte. Entra en él para continuar.',
  'sim.delve.unknownTier': 'Nivel de Profundidad desconocido.',
  'sim.delve.whileTrading': 'No puedes entrar en una Profundidad mientras comercias.',
  'sim.lockpick.alreadyInProgress': 'Alguien ya está forzando la cerradura.',
  'sim.lockpick.lastPickSnaps':
    'La última ganzúa se parte. La cerradura se atasca: el cofre se pierde a menos que vuelvas a superar la Profundidad.',
  'sim.lockpick.lockJammed':
    'La cerradura está demasiado atascada para forzarla. Vuelve a superar la Profundidad para otro intento.',
  'sim.lockpick.noAttempt': 'No hay ningún intento de forzar la cerradura en curso.',
  'sim.lockpick.tierPremium': 'Premium',
  'sim.lockpick.toolSlips': 'Esa herramienta resbala en esta cerradura.',
  // Aura effect tooltip summaries.
  'hudChrome.auraEffect.dot': 'Provoca {value} de daño de {school} cada {interval} s',
  'hudChrome.auraEffect.hot': 'Recupera {value} de salud cada {interval} s',
  'hudChrome.auraEffect.absorb': 'Bloquea {value} de daño',
  'hudChrome.auraEffect.healAbsorb': 'Bloquea {value} de sanación recibida',
  'hudChrome.auraEffect.thorns': 'Provoca {value} de daño de {school} a los atacantes',
  'hudChrome.auraEffect.slow': 'Disminuye la velocidad de movimiento un {pct}%',
  'hudChrome.auraEffect.speed': 'Incrementa la velocidad de movimiento un {pct}%',
  'hudChrome.auraEffect.attackSpeedSlow': 'Disminuye la velocidad de ataque un {pct}%',
  'hudChrome.auraEffect.attackSpeedFast': 'Incrementa la velocidad de ataque un {pct}%',
  'hudChrome.auraEffect.haste': 'Incrementa la velocidad de ataque y lanzamiento un {pct}%',
  'hudChrome.auraEffect.tongues': 'Incrementa el tiempo de lanzamiento un {pct}%',
  'hudChrome.auraEffect.increase.ap': 'Incrementa el poder de ataque en {value}',
  'hudChrome.auraEffect.increase.armor': 'Incrementa la armadura en {value}',
  'hudChrome.auraEffect.increase.int': 'Incrementa el intelecto en {value}',
  'hudChrome.auraEffect.increase.agi': 'Incrementa la agilidad en {value}',
  'hudChrome.auraEffect.increase.sta': 'Incrementa el aguante en {value}',
  'hudChrome.auraEffect.increase.spi': 'Incrementa el espíritu en {value}',
  'hudChrome.auraEffect.increase.allStats': 'Incrementa todos los atributos en {value}',
  'hudChrome.auraEffect.reduce.ap': 'Disminuye el poder de ataque en {value}',
  'hudChrome.auraEffect.reduce.armor': 'Disminuye la armadura en {value}',
  'hudChrome.auraEffect.reduce.int': 'Disminuye el intelecto en {value}',
  'hudChrome.auraEffect.reduce.agi': 'Disminuye la agilidad en {value}',
  'hudChrome.auraEffect.reduce.sta': 'Disminuye el aguante en {value}',
  'hudChrome.auraEffect.reduce.spi': 'Disminuye el espíritu en {value}',
  'hudChrome.auraEffect.reduce.allStats': 'Disminuye todos los atributos en {value}',
  'hudChrome.auraEffect.dodge': 'Incrementa la probabilidad de esquivar un {pct}%',
  'hudChrome.auraEffect.dodgeReduce': 'Disminuye la probabilidad de esquivar un {pct}%',
  'hudChrome.auraEffect.armorFlat': 'Disminuye la armadura en {value}',
  'hudChrome.auraEffect.armorFlatStacks':
    'Disminuye la armadura en {value} ({stacks} acumulaciones)',
  'hudChrome.auraEffect.mortalWound': 'Disminuye la sanación recibida un {pct}%',
  'hudChrome.auraEffect.vulnerability': 'Incrementa el daño recibido un {pct}%',
  'hudChrome.auraEffect.physVuln': 'Incrementa el daño físico recibido un {pct}%',
  'hudChrome.auraEffect.spellVuln': 'Incrementa el daño mágico recibido un {pct}%',
  'hudChrome.auraEffect.critVuln':
    'Incrementa la probabilidad de recibir golpes críticos un {pct}%',
  'hudChrome.auraEffect.costTax': 'Incrementa los costes de habilidades un {pct}%',
  'hudChrome.auraEffect.stun': 'Aturdimiento: no puede actuar',
  'hudChrome.auraEffect.root': 'Inmovilizado: no puede moverse',
  'hudChrome.auraEffect.incapacitate': 'Incapacitación: no puede actuar',
  'hudChrome.auraEffect.polymorph': 'Polimorfia: no puede actuar',
  'hudChrome.auraEffect.hex': 'Disminuye el daño y la sanación realizados un {pct}%',
  'hudChrome.auraEffect.blind': 'Ceguera: no puede actuar',
  'hudChrome.auraEffect.silence': 'Silencio: no puede lanzar hechizos',
  'hudChrome.auraEffect.disarm': 'Desarme: no puede usar ataques con arma',
  'hudChrome.auraEffect.lockout': 'Escuela mágica bloqueada',
  'hudChrome.auraEffect.imbue': 'Arma encantada con efectos adicionales',
  'hudChrome.auraEffect.imbueRange': 'Arma encantada: {min} a {max} de daño adicional al juzgar',
  'hudChrome.auraEffect.stealth': 'Encubierto; velocidad de movimiento reducida un {pct}%',
  'hudChrome.auraEffect.formBear': 'Forma de oso, salud y armadura aumentadas',
  'hudChrome.auraEffect.formCat': 'Forma felina, daño cuerpo a cuerpo y energía',
  'hudChrome.auraEffect.formTravel': 'Forma de viaje, velocidad de movimiento aumentada un {pct}%',
  'hudChrome.auraEffect.defensiveStance': 'Actitud defensiva, daño recibido reducido, más amenaza',
  'hudChrome.auraEffect.righteousFury': 'Furia recta, amenaza de daño Sagrado muy aumentada',
  'hudChrome.auraEffect.scale': 'Talla aumentado un {pct}%',
  'hudChrome.auraEffect.jump': 'Salto aumentada un {pct}%',
  'hudChrome.auraEffect.school.physical': 'Daño físico',
  'hudChrome.auraEffect.school.fire': 'Ígneo',
  'hudChrome.auraEffect.school.frost': 'Hielo',
  'hudChrome.auraEffect.school.arcane': 'Arcana',
  'hudChrome.auraEffect.school.shadow': 'Sombra',
  'hudChrome.auraEffect.school.holy': 'Sagrada',
  'hudChrome.auraEffect.school.nature': 'Natural',
  'entities.abilities.holy_shock.name': 'Choque Sagrado',
  'entities.abilities.holy_shock.description':
    'Sacude a un objetivo amistoso con energía Sagrada y lo sana por {damage}. (habilidad distintiva de Sagrado)',
  'entities.abilities.holy_shield.name': 'Escudo Sagrado',
  'entities.abilities.holy_shield.description':
    'Te protege con poder Sagrado durante 10 s, aumenta la armadura en 90 y golpea a los atacantes cuerpo a cuerpo con 12 de daño Sagrado. (habilidad distintiva de Protección)',
  'entities.abilities.repentance.name': 'Arrepentimiento',
  'entities.abilities.repentance.description':
    'Pone al enemigo en estado de meditación hasta 6 s. Cualquier daño rompe el efecto. (habilidad distintiva de Reprensión)',
  'entities.abilities.bestial_wrath.name': 'Cólera de las bestias',
  'entities.abilities.bestial_wrath.description':
    'Te lanza a una ira bestial, aumentando el poder de ataque en 55 durante 15 s. (habilidad distintiva de Dominio de bestias)',
  'entities.abilities.trueshot_aura.name': 'Aura de disparo certero',
  'entities.abilities.trueshot_aura.description':
    'Inspira a los aliados cercanos, aumentando el poder de ataque en 35 durante 5 min. (habilidad distintiva de Puntería)',
  'entities.abilities.wyvern_sting.name': 'Picadura de dracoleón',
  'entities.abilities.wyvern_sting.description':
    'Pica al enemigo a distancia y lo incapacita hasta 4 s. Cualquier daño rompe el efecto. (habilidad distintiva de Supervivencia)',
  'entities.abilities.arcane_power.name': 'Poder Arcano',
  'entities.abilities.arcane_power.description':
    'Te llena de poder Arcano, aumentando el poder con hechizos en 28 durante 12 s. (habilidad distintiva de Arcano)',
  'entities.abilities.combustion.name': 'Combustión',
  'entities.abilities.combustion.description':
    'Concentra tu magia de fuego para que tu siguiente ataque sea un golpe crítico. (habilidad distintiva de Fuego)',
  'entities.abilities.cone_of_cold.name': 'Cono de frío',
  'entities.abilities.cone_of_cold.description':
    'Azota a los enemigos cercanos con escarcha e inflige {damage} de daño de Escarcha. (habilidad distintiva de Escarcha)',
  'entities.abilities.cold_blood.name': 'Sangre fría',
  'entities.abilities.cold_blood.description':
    'Concentra tu intención asesina para que tu siguiente ataque sea un golpe crítico. (habilidad distintiva de Asesinato)',
  'entities.abilities.blade_flurry.name': 'Aluvión de acero',
  'entities.abilities.blade_flurry.description':
    'Desata una ráfaga de hojas, aumentando la velocidad de ataque un 20% durante 12 s. (habilidad distintiva de Combate)',
  'entities.abilities.hemorrhage.name': 'Hemorragia',
  'entities.abilities.hemorrhage.description':
    'Golpea al enemigo con daño de arma más {damage} y causa daño de sangrado durante 12 s. Otorga 1 punto de combo. (habilidad distintiva de Sutileza)',
  'entities.abilities.power_infusion.name': 'Infusión de poder',
  'entities.abilities.power_infusion.description':
    'Infunde poder a un objetivo amistoso, aumentando el poder con hechizos en 28 durante 15 s. (habilidad distintiva de Disciplina)',
  'entities.abilities.holy_nova.name': 'Nova Sagrada',
  'entities.abilities.holy_nova.description':
    'Provoca una explosión de luz Sagrada, sana a los aliados cercanos por {damage} y daña a los enemigos cercanos. (habilidad distintiva de Sagrado)',
  'entities.abilities.shadowform.name': 'Forma de las Sombras',
  'entities.abilities.shadowform.description':
    'Adopta Forma de las Sombras, potenciando la magia de sombras hasta que vuelvas a cambiar. Lánzalo otra vez para volver a la forma normal. (habilidad distintiva de Sombras)',
  'entities.abilities.elemental_mastery.name': 'Maestría elemental',
  'entities.abilities.elemental_mastery.description':
    'Invoca la maestría elemental, haciendo que tu siguiente hechizo sea instantáneo. (habilidad distintiva de Elemental)',
  'entities.abilities.shamanistic_rage.name': 'Ira del chamán',
  'entities.abilities.shamanistic_rage.description':
    'Libera ira chamánica y restaura 160 de maná. (habilidad distintiva de Mejora)',
  'entities.abilities.natures_swiftness.name': 'Presteza de la Naturaleza',
  'entities.abilities.natures_swiftness.description':
    'Invoca a la naturaleza para hacer que tu siguiente hechizo sea instantáneo. (habilidad distintiva de Restauración)',
  'entities.abilities.siphon_life.name': 'Succionar vida',
  'entities.abilities.siphon_life.description':
    'Absorbe vida del enemigo, inflige {damage} de daño de las Sombras durante 30 s y te sana por el daño causado. (habilidad distintiva de Aflicción)',
  'entities.abilities.fel_domination.name': 'Dominación vil',
  'entities.abilities.fel_domination.description':
    'Domina energías viles, haciendo que tu siguiente hechizo sea instantáneo. (habilidad distintiva de Demonología)',
  'entities.abilities.conflagrate.name': 'Conflagrar',
  'entities.abilities.conflagrate.description':
    'Consume tu Inmolar en el enemigo para prenderlo e infligir {damage} de daño de Fuego. (habilidad distintiva de Destrucción)',
  'entities.abilities.moonkin_form.name': 'Forma de lechúcico lunar',
  'entities.abilities.moonkin_form.description':
    'Adopta Forma de lechúcico lunar, potenciando el lanzamiento de hechizos hasta que vuelvas a cambiar. Lánzalo otra vez para volver a la forma normal. (habilidad distintiva de Equilibrio)',
  'entities.abilities.feral_charge.name': 'Carga feral',
  'entities.abilities.feral_charge.description':
    'Carga contra un enemigo y lo enraíza durante 1 s. Alcance de 8-25 m. (habilidad distintiva de Feral)',
  'entities.abilities.swiftmend.name': 'Alivio presto',
  'entities.abilities.swiftmend.description':
    'Consume un efecto de sanación en el tiempo sobre un objetivo amistoso para sanarlo por {damage}. (habilidad distintiva de Restauración)',
  'entities.abilities.heroic_leap.name': 'Salto heroico',
  'entities.abilities.heroic_leap.description':
    'Salta al área objetivo e inflige {damage} de daño físico a los enemigos cercanos. (Talento de guerrero)',
  'entities.abilities.pummel.name': 'Zurrar',
  'entities.abilities.pummel.description':
    'Interrumpe el lanzamiento de hechizos e impide lanzar hechizos de esa escuela durante 4 s. (Talento de guerrero)',
  'entities.abilities.shield_wall.name': 'Muro de escudo',
  'entities.abilities.shield_wall.description':
    'Alza tu muro de escudo y aumenta mucho la armadura durante 10 s. (Talento de guerrero)',
  'entities.abilities.last_stand.name': 'Última carga',
  'entities.abilities.last_stand.description':
    'Aumenta temporalmente el Aguante durante 15 s, lo que aumenta la salud máxima. (Talento de guerrero)',
  'entities.abilities.bladestorm.name': 'Filotormenta',
  'entities.abilities.bladestorm.description':
    'Te conviertes en una tormenta de acero y golpeas a los enemigos cercanos cada segundo por {damage}. (Talento de guerrero)',
  'entities.abilities.avatar.name': 'Avatar',
  'entities.abilities.avatar.description':
    'Te transformas en un coloso y aumentas el poder de ataque durante 20 s. (Talento de guerrero)',
  'entities.abilities.rallying_cry.name': 'Grito de convocación',
  'entities.abilities.rallying_cry.description':
    'Sueltas un grito de convocación que aumenta el poder de ataque de los aliados cercanos durante 10 s. (Talento de guerrero)',
  'entities.abilities.counterspell.name': 'Contrahechizo',
  'entities.abilities.counterspell.description':
    'Contrarresta el lanzamiento enemigo e impide lanzar hechizos de esa escuela durante 6 s. (Talento de mago)',
  'entities.abilities.ice_lance.name': 'Lanza de hielo',
  'entities.abilities.ice_lance.description':
    'Lanza un fragmento de hielo que inflige {damage} de daño de Escarcha. Inflige triple daño a objetivos enraizados. (Talento de mago)',
  'entities.abilities.presence_of_mind.name': 'Presencia mental',
  'entities.abilities.presence_of_mind.description':
    'Hace que tu siguiente hechizo con tiempo de lanzamiento sea instantáneo. Dura 60 s. (Talento de mago)',
  'entities.abilities.blink.name': 'Traslación',
  'entities.abilities.blink.description':
    'Te teletransporta 15 m hacia delante y rompe raíces. (Talento de mago)',
  'entities.abilities.ice_block.name': 'Bloque de hielo',
  'entities.abilities.ice_block.description':
    'Te encierra en hielo y absorbe una enorme cantidad de daño durante 8 s. (Talento de mago)',
  'entities.abilities.deep_freeze.name': 'Congelación profunda',
  'entities.abilities.deep_freeze.description':
    'Congela profundamente al objetivo, inflige {damage} de daño de Escarcha y lo aturde durante 4 s. (Talento de mago)',
  'entities.abilities.meteor.name': 'Meteoro',
  'entities.abilities.meteor.description':
    'Invoca un meteoro en el área objetivo, inflige {damage} de daño de Fuego y quema el suelo. (Talento de mago)',
  'entities.abilities.evocation.name': 'Evocación',
  'entities.abilities.evocation.description': 'Restaura maná rápidamente. (Talento de mago)',
  'entities.abilities.rebuke.name': 'Rebuke',
  'entities.abilities.rebuke.description':
    'Interrupts spellcasting and prevents any spell in that school from being cast for 4 sec. (Paladin talent)',
  'entities.abilities.crusader_strike.name': 'Crusader Strike',
  'entities.abilities.crusader_strike.description':
    'Strikes the target for weapon damage plus {damage} Holy damage. (Paladin talent)',
  'entities.abilities.holy_wrath.name': 'Holy Wrath',
  'entities.abilities.holy_wrath.description':
    'Unleashes holy power, damaging nearby enemies for {damage}. (Paladin talent)',
  'entities.abilities.divine_shield.name': 'Divine Shield',
  'entities.abilities.divine_shield.description':
    'Shields you with holy power, absorbing a massive amount of damage for 8 sec. (Paladin talent)',
  'entities.abilities.avenging_wrath.name': 'Avenging Wrath',
  'entities.abilities.avenging_wrath.description':
    'Calls down avenging power, increasing attack power and spell power for 20 sec. (Paladin talent)',
  'entities.abilities.hammer_of_wrath.name': 'Hammer of Wrath',
  'entities.abilities.hammer_of_wrath.description':
    'Hurls a holy hammer at the enemy for {damage} Holy damage. (Paladin talent)',
  'entities.abilities.counter_shot.name': 'Counter Shot',
  'entities.abilities.counter_shot.description':
    'Interrupts spellcasting and prevents any spell in that school from being cast for 4 sec. (Hunter talent)',
  'entities.abilities.frost_trap.name': 'Frost Trap',
  'entities.abilities.frost_trap.description':
    'Freezes enemies at the target area in place for 3 sec. (Hunter talent)',
  'entities.abilities.mend_pet.name': 'Mend Pet',
  'entities.abilities.mend_pet.description':
    'Heals a friendly target for {damage} over 15 sec. (Hunter talent)',
  'entities.abilities.multi_shot.name': 'Multi-Shot',
  'entities.abilities.multi_shot.description':
    'Fires several missiles, striking nearby enemies for {damage}. (Hunter talent)',
  'entities.abilities.deterrence.name': 'Deterrence',
  'entities.abilities.deterrence.description':
    'Increases your dodge chance by 50% for 10 sec. (Hunter talent)',
  'entities.abilities.aspect_of_the_wild.name': 'Aspect of the Wild',
  'entities.abilities.aspect_of_the_wild.description':
    'Inspires nearby allies with wild strength, increasing attack power for 5 min. (Hunter talent)',
  'entities.abilities.kick.name': 'Kick',
  'entities.abilities.kick.description':
    'Interrupts spellcasting and prevents any spell in that school from being cast for 4 sec. (Rogue talent)',
  'entities.abilities.preparation.name': 'Preparation',
  'entities.abilities.preparation.description':
    'Finishes the cooldown on Sprint, Evasion, and Vanish. (Rogue talent)',
  'entities.abilities.ghostly_strike.name': 'Ghostly Strike',
  'entities.abilities.ghostly_strike.description':
    'Strikes the enemy for weapon damage plus {damage} and briefly increases dodge. Awards 1 combo point. (Rogue talent)',
  'entities.abilities.cloak_of_shadows.name': 'Cloak of Shadows',
  'entities.abilities.cloak_of_shadows.description':
    'Wraps you in shadows, absorbing damage for 5 sec. (Rogue talent)',
  'entities.abilities.shadowstep.name': 'Shadowstep',
  'entities.abilities.shadowstep.description':
    'Steps through the shadows toward your target. (Rogue talent)',
  'entities.abilities.silence.name': 'Silence',
  'entities.abilities.silence.description': 'Silences the target for 4 sec. (Priest talent)',
  'entities.abilities.psychic_scream.name': 'Psychic Scream',
  'entities.abilities.psychic_scream.description':
    'Frightens nearby enemies for up to 4 sec. Damage may break the effect. (Priest talent)',
  'entities.abilities.inner_focus.name': 'Inner Focus',
  'entities.abilities.inner_focus.description':
    'Makes your next spell free. Lasts 60 sec. (Priest talent)',
  'entities.abilities.desperate_prayer.name': 'Desperate Prayer',
  'entities.abilities.desperate_prayer.description':
    'Instantly heals you for {damage}. (Priest talent)',
  'entities.abilities.prayer_of_healing.name': 'Prayer of Healing',
  'entities.abilities.prayer_of_healing.description':
    'Heals nearby allies for {damage}. (Priest talent)',
  'entities.abilities.mind_sear.name': 'Mind Sear',
  'entities.abilities.mind_sear.description':
    'Channels shadow energy, damaging nearby enemies each second for {damage}. (Priest talent)',
  'entities.abilities.earthbind.name': 'Earthbind',
  'entities.abilities.earthbind.description':
    'Binds nearby enemies to the earth, rooting them for 2 sec. (Shaman talent)',
  'entities.abilities.healing_stream.name': 'Healing Stream',
  'entities.abilities.healing_stream.description':
    'Restores a friendly target over 12 sec. (Shaman talent)',
  'entities.abilities.chain_lightning.name': 'Chain Lightning',
  'entities.abilities.chain_lightning.description':
    'Hurls lightning at the target area, damaging nearby enemies for {damage}. (Shaman talent)',
  'entities.abilities.bloodlust.name': 'Bloodlust',
  'entities.abilities.bloodlust.description':
    'Whips nearby allies into a frenzy, increasing attack speed for 15 sec. (Shaman talent)',
  'entities.abilities.spell_lock.name': 'Spell Lock',
  'entities.abilities.spell_lock.description':
    'Interrupts spellcasting and prevents any spell in that school from being cast for 5 sec. (Warlock talent)',
  'entities.abilities.howl_of_terror.name': 'Howl of Terror',
  'entities.abilities.howl_of_terror.description':
    'Frightens nearby enemies for up to 3 sec. Damage may break the effect. (Warlock talent)',
  'entities.abilities.curse_of_exhaustion.name': 'Curse of Exhaustion',
  'entities.abilities.curse_of_exhaustion.description':
    'Curses the target, slowing movement by 30% for 12 sec. (Warlock talent)',
  'entities.abilities.death_coil.name': 'Death Coil',
  'entities.abilities.death_coil.description':
    'Horrifies the enemy and drains life back to you over a brief moment. (Warlock talent)',
  'entities.abilities.chaos_bolt.name': 'Chaos Bolt',
  'entities.abilities.chaos_bolt.description':
    'Hurls a bolt of chaotic fire for {damage} Fire damage. (Warlock talent)',
  'entities.abilities.metamorphosis.name': 'Metamorphosis',
  'entities.abilities.metamorphosis.description':
    'Assume demonic power, increasing armor and attack power for 20 sec. (Warlock talent)',
  'entities.abilities.skull_bash.name': 'Skull Bash',
  'entities.abilities.skull_bash.description':
    'Interrupts spellcasting and prevents any spell in that school from being cast for 4 sec. (Druid talent)',
  'entities.abilities.innervate.name': 'Innervate',
  'entities.abilities.innervate.description':
    'Instantly restores a large amount of mana. (Druid talent)',
  'entities.abilities.frenzied_regeneration.name': 'Frenzied Regeneration',
  'entities.abilities.frenzied_regeneration.description':
    'Regenerates health over 10 sec. Bear Form only. (Druid talent)',
  'entities.abilities.berserk.name': 'Berserk',
  'entities.abilities.berserk.description':
    'Increases attack power for 15 sec. (Druid talent)',
  'entities.abilities.tranquility.name': 'Tranquility',
  'entities.abilities.tranquility.description':
    'Channels restorative energy, healing nearby allies each second. (Druid talent)',
};
