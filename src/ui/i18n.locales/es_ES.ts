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
  "hudChrome.emotes.question": "¿Tío?",
  "nav.loginRegister": "Iniciar sesión/Registrarse",
  "stats.playersOnline": "Jugadores en línea",
  "stats.realmName": "Nombre del reino",
  "footer.githubLabel": "Proyecto de código abierto",
  "footer.terms": "Términos de servicio",
  "footer.privacy": "Política de privacidad",
  "highscores.title": "Tabla de clasificaciones",
  "wiki.title": "Wiki y guía del juego",
  "news.title": "Noticias y actualizaciones",
  "download.title": "Descargar lanzador de escritorio",
  "mode.onlineTitle": "Jugar en línea",
  "mode.onlineAria": "Jugar en línea: inicia sesión en el reino compartido persistente",
  "mode.offlineTitle": "Jugar en solitario",
  "mode.offlineAria": "Jugar en solitario: inicia una sesión local instantánea de un jugador",
  "auth.enterRealm": "Entrar al reino",
  "auth.logIn": "Iniciar sesión",
  "auth.createAccount": "Crear cuenta",
  "auth.realmList": "Lista de reinos",
  "auth.changeRealm": "Cambiar de reino",
  "auth.createCharacter": "Crear personaje",
  "auth.characterName": "Nombre del personaje",
  "auth.enterWorld": "Entrar al mundo",
  "auth.offlineCharacter": "Personaje en solitario",
  "controls.title": "Guía de controles",
  "controls.moveTurn": "Moverse/Girar",
  "controls.autorun": "Correr automáticamente",
  "controls.combat": "Combate e interacción",
  "controls.target": "Marcar enemigo",
  "controls.spells": "Lanzar hechizos",
  "controls.interact": "Interactuar/Despojar",
  "controls.nameplates": "Mostrar nombres",
  "controls.camera": "Cámara y ratón",
  "controls.rightDrag": "Arrastrar clic derecho",
  "controls.leftDrag": "Arrastrar clic izquierdo",
  "controls.mouseWheel": "Rueda del ratón",
  "controls.mouselook": "Mirar con ratón",
  "controls.orbit": "Rotar cámara",
  "controls.charPane": "Panel de personaje",
  "controls.spellbook": "Libro de hechizos",
  "controls.questLog": "Diario de misiones",
  "controls.worldMap": "Mapa del mundo",
  "controls.bags": "Inventario de bolsas",
  "controls.friends": "Amigos y hermandad",
  "controls.chat": "Abrir chat",
  "seo.description": "Emprende una aventura épica en World of ClaudeCraft, un micro-MMO de estilo clásico jugable directamente en el navegador. Únete a un reino compartido, sube clases de nivel y derrota enemigos.",
  "a11y.goHome": "Ir a la página de inicio",
  "a11y.characterActions": "Acciones del personaje",
  "a11y.githubProject": "Abrir el proyecto World of ClaudeCraft en GitHub",
  "loading.enteringWorld": "Entrando en el mundo...",
  "loading.assetsFailed": "Error al cargar recursos: prueba a recargar. {error}",
  "loading.rendererFailed": "No se pudo iniciar el renderizador: prueba a recargar. {error}",
  "loading.enterTimeout": "No se pudo entrar en el mundo. La conexión agotó el tiempo de espera. ¿Está funcionando el servidor del juego?",
  "errors.nothingInteract": "No hay nada con lo que interactuar.",
  "errors.characterNameInvalid": "El nombre debe tener 2-16 caracteres, empezar por una letra y contener solo letras, espacios, guiones o apóstrofes.",
  "errors.api.tooManyAttempts": "Demasiados intentos. Espera un minuto y vuelve a intentarlo.",
  "errors.api.accountBanned": "Esta cuenta ha sido vetada.",
  "errors.api.renameBeforeEntering": "Este personaje debe cambiar de nombre antes de entrar en el mundo.",
  "classDetails.lore.warrior": "Los guerreros son combatientes curtidos que generan ira al infligir o recibir daño. Absorben grandes golpes o aplastan enemigos con armas pesadas.",
  "classDetails.lore.hunter": "Los cazadores dominan lo salvaje, rastrean enemigos desde lejos con arcos o armas de fuego y controlan el campo con trampas.",
  "classDetails.lore.rogue": "Los pícaros son asesinos sigilosos que gastan energía y puntos de combo en puñaladas y golpes finales desde las sombras.",
  "classDetails.lore.shaman": "Los chamanes dominan los elementos, imbuyen armas con poder, golpean con relámpagos y restauran a sus aliados.",
  "classDetails.lore.warlock": "Los brujos invocan demonios, lanzan maldiciones y daño en el tiempo, y drenan vida para resistir.",
  "classDetails.lore.druid": "Los druidas canalizan la naturaleza, curan heridas, enredan enemigos y cambian a formas animales para defender o dañar.",
  "mobilePreflight.baseLandscape": "Gira el dispositivo a horizontal antes de entrar en el mundo.",
  "mobilePreflight.basePerformance": "El rendimiento móvil puede degradarse. Cierra pestañas extra y baja la calidad de renderizado si el juego va lento.",
  "mobilePreflight.iosInstallDetail": "Para pantalla completa real en iPhone o iPad, instala primero esta página en tu pantalla de inicio.",
  "mobilePreflight.iosShareStep": "En Safari, toca Compartir y luego Añadir a pantalla de inicio.",
  "mobilePreflight.androidStandaloneDetail": "Estás en modo de app a pantalla completa. Mantén el dispositivo en horizontal.",
  "mobilePreflight.androidInstallDetail": "Para pantalla completa en Android, instala esta página o añádela a la pantalla de inicio primero.",
  "mobilePreflight.androidInstallStep": "En Chrome, toca el menú y luego Instalar app o Añadir a pantalla de inicio.",
  "mobilePreflight.otherInstallDetail": "Instala o añade esta página a la pantalla de inicio para la mejor experiencia móvil a pantalla completa.",
};
