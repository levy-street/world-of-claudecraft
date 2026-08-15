<div align="center">

[English](../../CONTRIBUTING.md) · **Español** · [Español (España)](CONTRIBUTING.es_ES.md) · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Čeština](CONTRIBUTING.cs_CZ.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

</div>

# Contribuir a World of ClaudeCraft

Antes que nada, gracias por estar aquí. World of ClaudeCraft lo construye una
comunidad de personas que aman los MMO clásicos, y cada aporte, grande o pequeño,
lo hace mejor. Corregir un error de tipeo, traducir el juego, reportar un bug,
construir una mazmorra completamente nueva: todo cuenta, y aquí eres bienvenido.

Esta guía te ayudará a configurar tu entorno y a que tu primera contribución
salga sin contratiempos. No necesitas ser una persona experta. Si algo no queda
claro, pregunta en [Discord](https://discord.com/invite/worldofclaudecraft) y alguien estará feliz
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

Necesitarás [Node.js 26](https://nodejs.org/) y **pnpm 10.34.x** (el pin exacto está en `package.json` bajo `packageManager`, hoy `pnpm@10.34.5`). Las versiones mayores anteriores de Node no están probadas. Para el servidor multijugador también querrás [Docker](https://www.docker.com/) para ejecutar Postgres.

**Corepack no es obligatorio.** Instala pnpm una vez con el npm que trae Node. El mismo camino sirve en macOS, Linux y Windows.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Install pnpm once (same command on macOS, Linux, Windows)
#    Match the packageManager pin in package.json (today: 10.34.5).
npm install -g pnpm@10.34.5
pnpm --version   # should print 10.34.5 (or the pin in package.json)

# 3. Install dependencies (uses the global content-addressable store)
pnpm install --frozen-lockfile

# 4. Point git at the repository hooks (once per clone)
git config core.hooksPath .githooks

# 5. Run the offline client (no server or database needed)
pnpm run dev         # open the URL it prints (usually http://localhost:5173)
```

`npm run <script>` sigue funcionando después de instalar con pnpm (Node trae npm), pero **la instalación y las actualizaciones del lockfile deben hacerse con pnpm**. No subas un `package-lock.json`; la única fuente de verdad es `pnpm-lock.yaml`.

Con eso basta para jugar el mundo offline y trabajar en la mayoría de las cosas.
Para ejecutar el stack online completo necesitas antes una contraseña de base de
datos en tu entorno:

```bash
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
pnpm run db:up       # start Postgres 16 in Docker (dev DB on port 5433)
pnpm run server      # build and run the authoritative game server on :8787
pnpm run dev         # in another terminal; the client proxies to the server
```

Si piensas ejecutar la verificación completa que se describe más abajo, instala
una vez el navegador que utiliza: `pnpm exec playwright install chromium`.

El [README](README.es.md) tiene la guía completa para alojar, desarrollar y jugar, y
los archivos `CLAUDE.md` repartidos por el repo documentan las convenciones de
cada área.

### Cadena de herramientas de TypeScript

El chequeo de tipos corre sobre TypeScript 7, el compilador nativo:
`npx tsc --noEmit` funciona exactamente igual que antes, y un chequeo completo del
repo ahora toma unos pocos segundos en lugar de decenas de segundos. La instalación
usa el alias doble oficial: el paquete `typescript` resuelve la API de JavaScript de
TypeScript 6 (mediante el envoltorio `@typescript/typescript6`) porque `svelte-check`
todavía consume esa API, mientras que `@typescript/native` provee el binario `tsc`.
Cosas que conviene saber:

- **Editores.** VS Code necesita la extensión "TypeScript 7" del marketplace
  (`TypeScriptTeam.native-preview`) para el soporte nativo del servicio de lenguaje
  hasta que llegue el soporte integrado; se activa con la opción
  `js/ts.experimental.useTsgo`, y su comando "Disable TypeScript 7 Language Server"
  es la alternativa autorizada para volver al tsserver de TypeScript 6. Los IDE de
  JetBrains detectan automáticamente el servidor nativo solo bajo el nombre de
  paquete `@typescript/native-preview`, así que no lo tomarán del alias
  `@typescript/native` de este repo; su soporte integrado de TypeScript 6 funciona
  bien.
- **Flags útiles de tsc.** `--checkers N` define la cantidad de procesos paralelos de
  chequeo de tipos (4 por defecto; los resultados son idénticos con cualquier
  cantidad): bájala para limitar la memoria en un runner ajustado, súbela en una
  máquina con muchos núcleos, y mide en ambos casos, porque más no siempre es más
  rápido. `--singleThreaded` desactiva todo el paralelismo. Chequear un solo archivo
  de forma puntual (`npx tsc somefile.ts`) da error cuando el directorio tiene un
  `tsconfig.json`; pasa `--ignoreConfig` para recuperar el comportamiento anterior.
- **Archivo de bloqueo.** El lockfile es `pnpm-lock.yaml` (pnpm 10 / lockfileVersion 9). Actualízalo solo con `pnpm install`, `pnpm add` o `pnpm update` desde la raíz de este repo (nunca a mano). Sube `pnpm-lock.yaml` junto con los cambios de `package.json`. CI instala con `pnpm install --frozen-lockfile`; un lockfile obsoleto falla. No introduzcas un segundo lockfile (`package-lock.json` / yarn.lock): los lockfiles duales divergen en silencio y están prohibidos. El ruido de peers de árboles opcionales de wallet/solana se tolera vía `.npmrc` (`strict-peer-dependencies=false`); no lo aflojes más sin medir.
- **Cuándo revisarlo.** Colapsa el alias doble de vuelta a una sola dependencia
  `typescript` cuando se cumplan AMBAS condiciones: que haya salido la API de
  JavaScript estable de TypeScript 7.1 (TypeScript 7.0 no incluye ninguna API de
  JavaScript; el reemplazo se sigue en el issue 2824 de microsoft/typescript-go) y que
  el issue 3063 de sveltejs/language-tools se haya cerrado con una versión publicada
  de `svelte-check` que la adopte. Los modos experimentales `--tsgo` de svelte-check
  no eliminan su dependencia de la API de TypeScript 6, y su carga en curso de
  TypeScript 7 (PR 3073 de language-tools) lee el alias `@typescript/native` que este
  repo ya usa, así que no hace falta ningún renombrado.

## Cómo hacer tu cambio

1. **Parte de la rama de release más reciente, nunca de `main`.** El trabajo activo
   se integra en una rama `release/vX.Y.Z`; `main` va por detrás y no es la base para
   las contribuciones. Busca la más nueva y crea tu rama a partir de ella:

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # the newest release branch
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   Ejecuta siempre esa búsqueda en lugar de copiar un número de versión de esta
   guía: las ramas de lanzamiento se renuevan seguido, y la más nueva cambia con
   cada lanzamiento. Las ramas se nombran `feature/<short-slug>` o
   `fix/<short-slug>`.
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
- **La lógica nueva llega como su propio módulo pequeño y probado detrás de una
  costura existente**, en lugar de agregarse a uno de los grandes archivos
  coordinadores. Los datos que leen el renderizador o el HUD cruzan la interfaz
  `IWorld` (`src/world_api/`) y se implementan tanto en el mundo offline como en el
  online; un sistema de simulación nuevo va detrás de `SimContext`; un endpoint REST
  nuevo es un módulo de ruta que puedes generar con `pnpm run new:endpoint`.
- **No edites a mano los archivos generados** como `*.generated.ts`. Vuelve a
  generarlos a través del build.
- **Estilo de redacción de la casa: sin rayas, guiones largos ni emojis** en ninguna
  parte, ni en el código, ni en los comentarios, ni en la documentación, ni en los
  mensajes de commit, ni en el texto de los PR, ni en el texto de cara al jugador.
  Usa comas, dos puntos, paréntesis o "a" para los rangos. Una verificación previa
  al push analiza tu diff y bloquea el push si encuentra alguno.
- **Nunca subas secretos** ni un archivo `.env`, y nunca habilites
  `ALLOW_DEV_COMMANDS` en una ruta de producción, ya que desbloquea trampas.

### Estilo de código

El formateo lo hace [Biome](https://biomejs.dev/), configurado en `biome.json`:
sangría de 2 espacios, líneas de 100 columnas, comillas simples y comas finales.
Formatea solo los archivos que tocaste
(`npx @biomejs/biome check --write <your-file.ts>`) y verifícalos con
`pnpm run ci:changed`. CI solo revisa los archivos modificados, así que, por favor,
no reformatees el resto del árbol: una corrida sobre todo el repo saca a la luz
deuda antigua que no te toca a ti arreglar.

## Antes de abrir un pull request

Ejecuta la verificación del repositorio en tu máquina. Es el mismo contrato que
impone CI:

```bash
pnpm run gate
```

Mientras iteras, ejecuta una sola suite (`npx vitest run tests/sim.test.ts`) y
`pnpm run ci:changed` para el formateo; `pnpm test` lo ejecuta todo, y el mapa de
suites está en `tests/CLAUDE.md`. El `pnpm run gate` completo cubre la frescura de
los artefactos generados, el escaneo de malware, el formateo de los archivos
modificados, la verificación de conformidad de los efectos de sonido, toda la suite
de pruebas, una pasada de regresión en un navegador real, el chequeo estricto de
tipos y los builds de cliente, servidor y headless. Las verificaciones por capas,
desde el mínimo previo al push hacia arriba, se describen en
[`docs/qa-gate.md`](../qa-gate.md).

Luego prueba tu cambio tanto en escritorio como en móvil, incluyendo un viewport
del tamaño de un teléfono en vertical y horizontal, si toca algo que los jugadores
ven. Los objetivos táctiles deben mantenerse en al menos 40x40px y los campos de
formulario en al menos 16px de fuente. Los estándares de la interfaz están
documentados en [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Abrir el pull request

Sube tu rama y abre un PR **apuntando a la misma rama `release/vX.Y.Z` más reciente
de la que partiste. Nunca apuntes a `main`**, que es una rama de integración para el
momento de la publicación y no la base de las contribuciones. GitHub suele
preseleccionar `main` por ti, así que cambia la rama base antes de enviarlo. La
[plantilla de pull request](../../.github/PULL_REQUEST_TEMPLATE.md) te guiará por una
lista de verificación corta. Por favor, complétala:

- Describe **qué** cambió y **por qué**.
- Enlaza cualquier issue relacionado (por ejemplo, "Closes #123").
- Agrega **capturas de pantalla o un clip para cambios de interfaz**, en escritorio
  y móvil.
- Confirma que `pnpm run gate` pasa y que las cadenas nuevas de cara al jugador siguen
  la política de "primero el inglés" para quienes contribuyen que se describe más
  abajo.

En tu PR, CI ejecuta el formateo y el linting sobre los archivos que modificaste, la
suite de pruebas completa repartida en cuatro particiones paralelas, una pasada de
regresión en navegador, y el chequeo de tipos junto con los builds de cliente,
servidor y headless. Eso coincide con lo que ejecuta `pnpm run gate` en tu máquina,
así que una verificación local en verde predice bastante bien un PR en verde.

Lo que buscamos antes de fusionar es una corrida de CI en verde y una lista de
verificación completa. Es posible que una persona mantenedora sugiera cambios. Eso
es una parte normal y colaborativa del proceso, no un rechazo. Buscamos ser amables
y constructivos en la revisión, y te pedimos lo mismo.

> Los mensajes de commit y los títulos de PR siguen [Conventional Commits](https://www.conventionalcommits.org/)
> con un scope (`feat(talents): ...`, `fix(net): ...`). Cada commit lleva además un
> cuerpo: después de una línea en blanco, de una a cuatro frases sencillas que digan
> qué cambió y por qué, con un ancho cercano a 72 columnas. Un título por sí solo no
> alcanza.

<a id="localization"></a>

## Localización

World of ClaudeCraft se publica en muchos idiomas. Cada cadena visible para los
jugadores debe ser una clave de traducción, mientras que quien contribuye una
función normalmente solo agrega el original en inglés.

- Todo el texto de cara al usuario es una clave `t()`. Agrega el texto nuevo en
  inglés al módulo por dominio que corresponda dentro de
  [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) (el cromo nuevo del HUD va en
  `hud_chrome.ts`), y luego renderízalo con `t('dotted.key', values)`. Que esté solo
  en inglés es exactamente lo correcto en un PR de función: la persona mantenedora
  completa el resto de los idiomas al momento de la publicación, así que no edites
  las superposiciones de `src/ui/i18n.locales/` y nunca dejes en ellas un marcador de
  posición en inglés ni un `// TODO`. La excepción M16 es un valor nuevo en inglés
  con mucho texto, que además necesita los cinco rellenos no latinos que se describen
  en [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).
- Los números, el dinero, las fechas, las unidades y los porcentajes pasan por los
  formateadores (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) en lugar
  de armar cadenas a mano.
- El texto de cara a los jugadores que emiten `src/sim/` o `server/`, que se
  mantienen agnósticos al idioma, debe relocalizarse en la frontera del cliente
  dentro del mismo cambio. La prueba de guarda
  `npx vitest run tests/localization_fixes.test.ts` lo hace cumplir.
- Después de agregar o cambiar cualquier cadena, ejecuta `pnpm run i18n:gen` y sube
  los paquetes regenerados en el mismo cambio. Tanto la verificación local como CI
  comparan los artefactos subidos contra una regeneración limpia, así que un paquete
  desactualizado hace fallar el build.

Así que agrega tus cadenas en inglés y abre el PR; no hace falta que las traduzcas
tú. Si quieres ayudar con las traducciones, mira la sección siguiente.

<a id="translating-the-game"></a>

## Traducir el juego

¿Quieres mejorar un idioma o ayudar a llevar el juego a uno nuevo? No necesitas
escribir nada de código de juego para hacerlo:

1. La mayoría de las traducciones de cara a los jugadores viven en los archivos de
   superposición por idioma dentro de
   [`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) (uno por idioma), que reflejan
   las claves en inglés de [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/). El
   texto que emiten la simulación y el servidor se traduce en `src/ui/sim_i18n.ts` y
   `src/ui/server_i18n.ts`, el texto de talentos en los módulos `talent_i18n`, y el
   panel de administración tiene su propio conjunto en `src/admin/i18n.locales/`.
2. Mejora las traducciones existentes, o completa cualquiera que se lea forzada.
3. Ejecuta `pnpm run i18n:gen`, sube los paquetes regenerados junto con tu cambio en
   la superposición, ejecuta después las suites de localización
   (`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`)
   y abre un PR. Un chequeo de tipos por sí solo no te dirá si falta una clave,
   porque las superposiciones son deliberadamente dispersas.

Para proponer un idioma totalmente nuevo, o para conversar sobre tono y
terminología, inicia un hilo en [Discord](https://discord.com/invite/worldofclaudecraft) y te
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
- **Vulnerabilidades de seguridad.** Por favor, no abras un issue público. Repórtalas
  en privado siguiendo [SECURITY.md](../../SECURITY.md), y trabajaremos contigo en la
  corrección y en la divulgación.

## Cómo conseguir ayuda

¿Atascado, o solo quieres saludar? Únete al
[Discord de la comunidad](https://discord.com/invite/worldofclaudecraft). Ninguna pregunta es
demasiado pequeña, y las personas que contribuyen por primera vez siempre son
bienvenidas.

## Licencia

Al contribuir código, aceptas que tus contribuciones de código queden licenciadas
bajo la [Licencia MIT](../../LICENSE) del proyecto, la misma licencia que cubre el
proyecto.

La Licencia MIT dice lo que dice: cualquiera puede usar, modificar y redistribuir el
código, con fines comerciales o no. Nuestros
[Términos del Servicio](https://worldofclaudecraft.com/terms) rigen el juego alojado
que operamos en worldofclaudecraft.com (cuentas, conducta, objetos virtuales) y no
restringen los derechos que la Licencia MIT te otorga a ti ni a nadie más sobre este
código. Los nombres y la marca de "World of ClaudeCraft" y "Levy Street" no están
cubiertos por la Licencia MIT.

Los recursos creativos originales (grabaciones de sonido, música, arte y obras de
autoría similares) son la excepción. Si contribuyes un recurso original creado por
ti, puedes conservar los derechos de autor y aportarlo bajo la licencia que
prefieras (por ejemplo, CC BY-NC 4.0), siempre que:

- la licencia, las rutas de los recursos que cubre y tu atribución queden
  registradas en la tabla de licencias de [CREDITS.md](../../CREDITS.md) dentro del
  mismo pull request, y
- incluya como mínimo una cesión perpetua y libre de regalías a Levy Street para
  usar los recursos comercialmente en World of ClaudeCraft, incluidas las
  publicaciones oficiales y la tienda dentro del juego.

Para los recursos que figuran en la tabla de CREDITS.md, esa licencia registrada
prevalece sobre la licencia MIT por defecto del proyecto.

**Los recursos multimedia que no tengan una entrada en CREDITS.md no están
licenciados bajo MIT.** El registro todavía se está completando, así que una entrada
faltante significa que las condiciones no están registradas, no que el recurso sea
libre de tomar. Esto es deliberado: evita que una contribución sin registrar se ceda
por defecto. Con el código ocurre lo contrario, y todo lo que no esté excluido en
CREDITS.md es MIT.

Justamente por eso la entrada en el registro no es papeleo opcional. Si contribuyes
un recurso sin una fila en CREDITS.md, nadie aguas abajo puede usarlo y no tenemos
constancia de qué nos cediste. Completa también con honestidad la columna
**Redistribution**. Es lo que le dice a alguien que bifurque este proyecto si puede
transmitir tu recurso, y algunas filas están marcadas como "No, permission required"
precisamente porque no puede.

---

Gracias por contribuir a World of ClaudeCraft. No vemos la hora de ver lo que
construirás con nosotros.
