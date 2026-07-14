<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · **Español (España)** · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# Cómo contribuir a World of ClaudeCraft

Antes de nada, gracias por estar aquí. World of ClaudeCraft lo construye una
comunidad de personas a las que nos encantan los MMO clásicos, y cada aportación,
grande o pequeña, lo mejora. Corregir una errata, traducir el juego, informar de un
fallo, crear una mazmorra entera: todo cuenta, y aquí eres bienvenido.

Esta guía te ayudará a ponerte en marcha y a que tu primera contribución salga
rodada. No hace falta que seas un experto. Si algo no queda claro, pregunta en
[Discord](https://discord.com/invite/worldofclaudecraft) y alguien estará encantado de echarte una
mano.

Al participar, aceptas seguir nuestro [Código de conducta](../../CODE_OF_CONDUCT.md).

## Formas de contribuir

Aquí hay un sitio para todo el mundo:

- **Código.** Corrige un fallo, añade una funcionalidad o mejora el rendimiento.
  Las incidencias etiquetadas como
  [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue)
  y [`help wanted`](https://github.com/levy-street/world-of-claudecraft/labels/help%20wanted)
  son un buen punto de partida.
- **Traducciones.** Ayuda a jugadores de todo el mundo mejorando o completando un
  idioma. Consulta [Traducir el juego](#translating-the-game) más abajo. Es una de
  las formas más fáciles y de mayor impacto para empezar.
- **Informes de fallos e ideas de funcionalidades.** Abre una
  [incidencia](https://github.com/levy-street/world-of-claudecraft/issues/new/choose).
  Un informe de fallo claro es una contribución de verdad.
- **Documentación.** Guías como esta, el README y los documentos de diseño de
  `docs/` siempre se pueden mejorar.
- **Pruebas de juego y opiniones.** Juega, cuéntanos qué te chirría y comparte tus
  ideas en Discord.

## Primeros pasos

Necesitarás [Node.js 22+](https://nodejs.org/) y npm. Para el servidor multijugador
también te vendrá bien [Docker](https://www.docker.com/) para ejecutar Postgres.

```bash
# 1. Haz un fork del repositorio en GitHub y luego clona tu fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Instala las dependencias
npm ci

# 3. Ejecuta el cliente sin conexion (no hace falta servidor ni base de datos)
npm run dev          # abre la URL que imprime (normalmente http://localhost:5173)
```

Con eso basta para jugar al mundo sin conexión y trabajar en la mayoría de las
cosas. Para ejecutar la pila completa en línea:

```bash
npm run db:up        # arranca Postgres 16 en Docker (BD de desarrollo en el puerto 5433)
npm run server       # compila y ejecuta el servidor de juego autoritativo en :8787
npm run dev          # en otra terminal; el cliente hace de proxy hacia el servidor
```

El [README](../../README.md) tiene la guía completa para alojar, desarrollar y jugar, y
los archivos `CLAUDE.md` repartidos por el repositorio documentan las convenciones
de cada área.

## Cómo hacer tu cambio

1. **Crea una rama** a partir de `main`: `feature/<short-slug>` o
   `fix/<short-slug>`.
2. **Haz commits enfocados.** Los cambios pequeños y autocontenidos son más fáciles
   de revisar y fusionar que los grandes.
3. **Añade o actualiza pruebas** para cualquier comportamiento que modifiques en
   `src/sim/` o `server/`.
4. **Mantén traducible el texto visible para el jugador.** Consulta
   [Localización](#localization) y [Traducir el juego](#translating-the-game).

### Cosas que conviene tener presentes

Estas son las reglas que sostienen el código base. Todo el detalle vive en el
[`CLAUDE.md`](../../CLAUDE.md) raíz, pero en resumen:

- **El núcleo de simulación (`src/sim/`) es la fuente de la verdad**, y se mantiene
  puro, sin importaciones de DOM, navegador ni Three.js, de modo que exactamente el
  mismo código se ejecuta sin conexión, en el servidor y en el entorno de RL sin
  interfaz.
- **La simulación es determinista.** Funciona con un tick fijo a 20 Hz, y toda la
  aleatoriedad pasa por `Rng`, nunca por `Math.random`, `Date.now` o
  `performance.now` en la lógica de la simulación. La misma semilla produce siempre
  el mismo mundo.
- **Las matemáticas de juego siguen las fórmulas de los MMO de la época clásica**
  (ira, tablas de impacto, armadura, curvas de XP). Por favor, no inventes números
  de equilibrio. Cita la fórmula en su lugar.
- **No edites a mano los archivos generados** como `*.generated.ts`. Vuelve a
  generarlos a través de la compilación.
- **Nunca subas secretos** ni un archivo `.env`, y no actives nunca
  `ALLOW_DEV_COMMANDS` en una ruta de producción, ya que desbloquea trucos.

## Antes de abrir un pull request

Por favor, ejecuta esto en tu equipo. Son las mismas comprobaciones que ejecuta CI:

```bash
npm test                    # suite de Vitest
npx tsc --noEmit            # comprobacion de tipos de TypeScript (el proyecto es strict)
npm run build               # compilacion de produccion del cliente
```

Si has cambiado código del servidor o sin interfaz, ejecuta también
`npm run build:server` y `npm run build:env`.

Después, prueba tu cambio tanto en escritorio como en móvil, incluido un viewport
del tamaño de un teléfono en vertical y en horizontal, si toca algo que los
jugadores ven. Los objetivos táctiles deben mantenerse en al menos 40x40px y los
campos de formulario en una fuente de al menos 16px. Las normas de la interfaz
están documentadas en [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Abrir el pull request

Sube tu rama y abre un PR contra `main`. La
[plantilla de pull request](../../.github/PULL_REQUEST_TEMPLATE.md) te guiará por una
breve lista de comprobación. Por favor, rellénala:

- Describe **qué** cambió y **por qué**.
- Enlaza cualquier incidencia relacionada (por ejemplo, "Closes #123").
- Añade **capturas o un clip para los cambios de interfaz**, en escritorio y móvil.
- Confirma que pasan las pruebas, la comprobación de tipos y la compilación, y que
  las cadenas nuevas están traducidas.

Una ejecución de CI en verde y una lista de comprobación completa son lo que
buscamos antes de fusionar. Puede que un responsable del proyecto te sugiera
cambios. Eso es una parte normal y colaborativa del proceso, no un rechazo.
Procuramos ser amables y constructivos en las revisiones, y te pedimos lo mismo a
ti.

> Los mensajes de commit y los títulos de los PR siguen
> [Conventional Commits](https://www.conventionalcommits.org/) con un ámbito cuando
> encaja (`feat(talents): ...`, `fix(net): ...`). Es una convención que nos gusta
> más que un requisito estricto. Importan más los mensajes claros y descriptivos
> que un formato perfecto.

<a id="localization"></a>

## Localización

World of ClaudeCraft se distribuye en muchos idiomas, y lo mantenemos así a medida
que el juego crece. Cada cadena visible para el jugador se traduce a todos los
idiomas admitidos.

- Todo el texto de cara al usuario es una clave `t()` definida en
  [`src/ui/i18n.ts`](../../src/ui/i18n.ts). Añade primero la cadena nueva al idioma `en`
  y luego proporciona una traducción de verdad en todos los demás idiomas de
  `supportedLanguages`. Nada de marcadores de posición en inglés ni de `// TODO`.
- Los números, el dinero, las fechas, las unidades y los porcentajes pasan por los
  formateadores (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) en lugar
  de construir cadenas a mano.
- El texto de cara al jugador emitido desde `src/sim/` o `server/`, que se
  mantienen agnósticos al idioma, debe volver a localizarse en la frontera del
  cliente dentro del mismo cambio. La prueba de protección
  `npx vitest run tests/localization_fixes.test.ts` lo garantiza.

Si tu cambio añade una cadena y solo puedes escribirla en algunos idiomas, no pasa
nada. Abre el PR y pide ayuda con el resto en la descripción. Preferimos con creces
ayudarte a terminarla que verte echar el freno.

<a id="translating-the-game"></a>

## Traducir el juego

¿Quieres mejorar un idioma o ayudar a llevar el juego a uno nuevo? No necesitas
escribir nada de código de juego para hacerlo:

1. Abre [`src/ui/i18n.ts`](../../src/ui/i18n.ts) y busca el idioma en el que quieras
   trabajar. Cada objeto de idioma enumera las mismas claves que `en`.
2. Mejora las traducciones existentes o completa las que suenen raras.
3. Ejecuta `npx tsc --noEmit` para confirmar que no falta nada y luego abre un PR.

Para proponer un idioma totalmente nuevo, o para hablar del tono y la terminología,
abre un hilo en [Discord](https://discord.com/invite/worldofclaudecraft) y te ayudaremos a montarlo.
Los hablantes nativos y los que dominan el idioma son especialmente bienvenidos.
Una buena traducción hace que el juego se sienta como en casa para los jugadores de
todas partes.

## Informar de fallos y solicitar funcionalidades

Por favor, usa las
[plantillas de incidencia](https://github.com/levy-street/world-of-claudecraft/issues/new/choose):

- **Informe de fallo.** Busca primero entre las
  [incidencias existentes](https://github.com/levy-street/world-of-claudecraft/issues)
  para evitar duplicados, y luego incluye los pasos para reproducirlo, lo que
  esperabas, lo que ocurrió y tu entorno (sin conexión o en línea, navegador,
  escritorio o móvil).
- **Solicitud de funcionalidad.** Describe el problema que intentas resolver, no
  solo la solución. El contexto nos ayuda a diseñar lo correcto.

## Cómo conseguir ayuda

¿Te has atascado o solo quieres saludar? Únete al
[Discord de la comunidad](https://discord.com/invite/worldofclaudecraft). Ninguna pregunta es
demasiado pequeña, y quien contribuye por primera vez siempre es bienvenido.

## Licencia

Al contribuir, aceptas que tus contribuciones se licencien bajo la
[Licencia MIT](../../LICENSE) del proyecto, la misma licencia que cubre el proyecto.

---

Gracias por contribuir a World of ClaudeCraft. Estamos deseando ver lo que
construyes con nosotros.
