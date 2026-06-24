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
    'Los cazadores dominan lo salvaje, rastrean enemigos desde lejos con arcos o armas de fuego y controlan el campo con trampas.',
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
};
