<div align="center">

[English](../../CONTRIBUTING.md) · **Español** · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# Contribuir a World of ClaudeCraft

Antes que nada, gracias por estar aquí. World of ClaudeCraft lo construye una
comunidad de personas que aman los MMO clásicos, y cada aporte, grande o pequeño,
lo hace mejor. Corregir un error de tipeo, traducir el juego, reportar un bug,
construir una mazmorra completamente nueva: todo cuenta, y aquí eres bienvenido.

Esta guía te ayudará a configurar tu entorno y a que tu primera contribución
salga sin contratiempos. No necesitas ser una persona experta. Si algo no queda
claro, pregunta en [Discord](https://discord.gg/GjhnUsBtw) y alguien estará feliz
de ayudarte.

Al participar, aceptas seguir nuestro [Código de Conducta](../../CODE_OF_CONDUCT.md).

## Formas de contribuir

Aquí hay un lugar para todas las personas:

- **Código.** Corrige un bug, agrega una función o mejora el rendimiento. Los
  issues etiquetados como
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  y [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  son buenos puntos de partida.
- **Traducciones.** Ayuda a jugadores de todo el mundo mejorando o completando un
  idioma. Consulta [Traducir el juego](#translating-the-game) más abajo. Esta es
  una de las maneras más fáciles y de mayor impacto para empezar.
- **Reportes de bugs e ideas de funciones.** Abre un [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose).
  Un reporte de bug claro es una contribución real.
- **Documentación.** Guías como esta, el README y los documentos de diseño en
  `docs/` siempre se pueden mejorar.
- **Pruebas de juego y comentarios.** Juega, cuéntanos qué se siente raro y
  comparte ideas en Discord.

## Primeros pasos

Necesitarás [Node.js 22+](https://nodejs.org/) y npm. Para el servidor multijugador
también querrás [Docker](https://www.docker.com/) para ejecutar Postgres.

```bash
# 1. Haz un fork del repo en GitHub y luego clona tu fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Instala las dependencias
npm ci

# 3. Ejecuta el cliente offline (sin servidor ni base de datos)
npm run dev          # abre la URL que imprime (normalmente http://localhost:5173)
```

Con eso basta para jugar el mundo offline y trabajar en la mayoría de las cosas.
Para ejecutar el stack online completo:

```bash
npm run db:up        # inicia Postgres 16 en Docker (base de datos de dev en el puerto 5433)
npm run server       # compila y ejecuta el servidor de juego autoritativo en :8787
npm run dev          # en otra terminal; el cliente hace proxy hacia el servidor
```

El [README](../../README.md) tiene la guía completa para alojar, desarrollar y jugar, y
los archivos `CLAUDE.md` repartidos por el repo documentan las convenciones de
cada área.

## Cómo hacer tu cambio

1. **Crea una rama** a partir de `main`: `feature/<short-slug>` o `fix/<short-slug>`.
2. **Haz commits enfocados.** Los cambios más pequeños y autocontenidos son más
   fáciles de revisar y fusionar que los grandes.
3. **Agrega o actualiza pruebas** para cualquier comportamiento que cambies en
   `src/sim/` o `server/`.
4. **Mantén traducible el texto visible para los jugadores.** Consulta
   [Localización](#localization) y [Traducir el juego](#translating-the-game).

### Cosas para tener en cuenta

Estas son las reglas fundamentales del código. El detalle completo vive en el
[`CLAUDE.md`](../../CLAUDE.md) raíz, pero la versión corta es:

- **El núcleo de simulación (`src/sim/`) es la fuente de verdad**, y se mantiene
  puro, sin imports de DOM, navegador ni Three.js, de modo que el mismo código
  exacto corre offline, en el servidor y en el entorno headless de RL.
- **La simulación es determinista.** Corre con un tick fijo de 20 Hz, y toda la
  aleatoriedad pasa por `Rng`, nunca por `Math.random`, `Date.now` ni
  `performance.now` en la lógica de la sim. La misma semilla siempre produce el
  mismo mundo.
- **La matemática de juego sigue las fórmulas de los MMO de la era clásica** (furia,
  tablas de impacto, armadura, curvas de XP). Por favor, no inventes números de
  balance. En su lugar, cita la fórmula.
- **No edites a mano los archivos generados** como `*.generated.ts`. Vuelve a
  generarlos a través del build.
- **Nunca subas secretos** ni un archivo `.env`, y nunca habilites
  `ALLOW_DEV_COMMANDS` en una ruta de producción, ya que desbloquea trampas.

## Antes de abrir un pull request

Por favor, ejecuta esto localmente. Son las mismas verificaciones que corre CI:

```bash
npm test                    # suite de Vitest
npx tsc --noEmit            # chequeo de tipos de TypeScript (el proyecto es strict)
npm run build               # build de cliente de producción
```

Si cambiaste código del servidor o headless, ejecuta también `npm run build:server`
y `npm run build:env`.

Luego prueba tu cambio tanto en escritorio como en móvil, incluyendo un viewport
del tamaño de un teléfono en vertical y horizontal, si toca algo que los jugadores
ven. Los objetivos táctiles deben mantenerse en al menos 40x40px y los campos de
formulario en al menos 16px de fuente. Los estándares de la interfaz están
documentados en [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Abrir el pull request

Sube tu rama y abre un PR contra `main`. La
[plantilla de pull request](../../.github/PULL_REQUEST_TEMPLATE.md) te guiará por una
lista de verificación corta. Por favor, complétala:

- Describe **qué** cambió y **por qué**.
- Enlaza cualquier issue relacionado (por ejemplo, "Closes #123").
- Agrega **capturas de pantalla o un clip para cambios de interfaz**, en escritorio
  y móvil.
- Confirma que las pruebas, el chequeo de tipos y el build pasan, y que las cadenas
  nuevas están traducidas.

Lo que buscamos antes de fusionar es una corrida de CI en verde y una lista de
verificación completa. Es posible que una persona mantenedora sugiera cambios. Eso
es una parte normal y colaborativa del proceso, no un rechazo. Buscamos ser amables
y constructivos en la revisión, y te pedimos lo mismo.

> Los mensajes de commit y los títulos de PR siguen [Conventional Commits](https://www.conventionalcommits.org/)
> con un scope cuando aplica (`feat(talents): ...`, `fix(net): ...`). Es una
> convención que nos gusta, más que un requisito estricto. Importan más los
> mensajes claros y descriptivos que el formato perfecto.

<a id="localization"></a>

## Localización

World of ClaudeCraft se publica en muchos idiomas, y lo mantenemos así a medida que
el juego crece. Cada cadena visible para los jugadores se traduce a cada idioma
admitido.

- Todo el texto de cara al usuario es una clave `t()` definida en
  [`src/ui/i18n.ts`](../../src/ui/i18n.ts). Agrega una cadena nueva al idioma `en`
  primero, y luego provee una traducción real en cada uno de los demás idiomas de
  `supportedLanguages`. Nada de marcadores de posición en inglés, ni de
  `// TODO`.
- Los números, el dinero, las fechas, las unidades y los porcentajes pasan por los
  formateadores (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) en lugar
  de armar cadenas a mano.
- El texto de cara a los jugadores que emiten `src/sim/` o `server/`, que se
  mantienen agnósticos al idioma, debe relocalizarse en la frontera del cliente
  dentro del mismo cambio. La prueba de guarda
  `npx vitest run tests/localization_fixes.test.ts` lo hace cumplir.

Si tu cambio agrega una cadena y solo puedes escribirla en algunos idiomas, no hay
problema. Abre el PR y pide ayuda con el resto en la descripción. Preferimos mucho
más ayudarte a terminar que verte contenerte.

<a id="translating-the-game"></a>

## Traducir el juego

¿Quieres mejorar un idioma o ayudar a llevar el juego a uno nuevo? No necesitas
escribir nada de código de juego para hacerlo:

1. Abre [`src/ui/i18n.ts`](../../src/ui/i18n.ts) y busca el idioma en el que quieres
   trabajar. Cada objeto de idioma lista las mismas claves que `en`.
2. Mejora las traducciones existentes, o completa cualquiera que se lea forzada.
3. Ejecuta `npx tsc --noEmit` para confirmar que no falte nada, y luego abre un PR.

Para proponer un idioma totalmente nuevo, o para conversar sobre tono y
terminología, inicia un hilo en [Discord](https://discord.gg/GjhnUsBtw) y te
ayudaremos a conectarlo. Las personas hablantes nativas y fluidas son
especialmente bienvenidas. Las buenas traducciones hacen que el juego se sienta
como en casa para jugadores de todas partes.

## Reportar bugs y solicitar funciones

Por favor, usa las [plantillas de issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose):

- **Reporte de bug.** Busca primero en los
  [issues existentes](https://github.com/levy-street/world-of-claudecraft/issues)
  para evitar duplicados, y luego incluye los pasos para reproducirlo, lo que
  esperabas, lo que pasó y tu entorno (offline u online, navegador, escritorio o
  móvil).
- **Solicitud de función.** Describe el problema que intentas resolver, no solo la
  solución. El contexto nos ayuda a diseñar lo correcto.

## Cómo conseguir ayuda

¿Atascado, o solo quieres saludar? Únete al
[Discord de la comunidad](https://discord.gg/GjhnUsBtw). Ninguna pregunta es
demasiado pequeña, y las personas que contribuyen por primera vez siempre son
bienvenidas.

## Licencia

Al contribuir, aceptas que tus contribuciones queden bajo la
[Licencia MIT](../../LICENSE) del proyecto, la misma licencia que cubre el proyecto.

---

Gracias por contribuir a World of ClaudeCraft. No vemos la hora de ver lo que
construirás con nosotros.
