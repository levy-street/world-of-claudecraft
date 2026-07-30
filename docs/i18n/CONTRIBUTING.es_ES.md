<div align="center">

[English](../../CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · **Español (España)** · [Français](CONTRIBUTING.fr_FR.md) · [Français (Canada)](CONTRIBUTING.fr_CA.md) · [Italiano](CONTRIBUTING.it_IT.md) · [Deutsch](CONTRIBUTING.de_DE.md) · [简体中文](CONTRIBUTING.zh_CN.md) · [繁體中文](CONTRIBUTING.zh_TW.md) · [한국어](CONTRIBUTING.ko_KR.md) · [日本語](CONTRIBUTING.ja_JP.md) · [Português (Brasil)](CONTRIBUTING.pt_BR.md) · [Русский](CONTRIBUTING.ru_RU.md) · [Čeština](CONTRIBUTING.cs_CZ.md) · [Nederlands](CONTRIBUTING.nl_NL.md) · [Polski](CONTRIBUTING.pl_PL.md) · [Bahasa Indonesia](CONTRIBUTING.id_ID.md) · [Türkçe](CONTRIBUTING.tr_TR.md) · [Svenska](CONTRIBUTING.sv_SE.md) · [Tiếng Việt](CONTRIBUTING.vi_VN.md) · [Dansk](CONTRIBUTING.da_DK.md)

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

Necesitarás [Node.js 26](https://nodejs.org/) y npm, las versiones que usan CI y la
imagen de producción. Las versiones mayores anteriores no están probadas. Para el
servidor multijugador también te vendrá bien [Docker](https://www.docker.com/) para
ejecutar Postgres.

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/world-of-claudecraft.git
cd world-of-claudecraft

# 2. Install dependencies
npm ci

# 3. Point git at the repository hooks (once per clone)
git config core.hooksPath .githooks

# 4. Run the offline client (no server or database needed)
npm run dev          # open the URL it prints (usually http://localhost:5173)
```

Con eso basta para jugar al mundo sin conexión y trabajar en la mayoría de las
cosas. Para ejecutar la pila completa en línea necesitas antes una contraseña de
base de datos en tu entorno:

```bash
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # start Postgres 16 in Docker (dev DB on port 5433)
npm run server       # build and run the authoritative game server on :8787
npm run dev          # in another terminal; the client proxies to the server
```

Si tienes previsto ejecutar la verificación completa que se describe más abajo,
instala una vez el navegador que utiliza: `npx playwright install chromium`.

El [README](README.es_ES.md) tiene la guía completa para alojar, desarrollar y jugar, y
los archivos `CLAUDE.md` repartidos por el repositorio documentan las convenciones
de cada área.

### Cadena de herramientas de TypeScript

La comprobación de tipos se ejecuta sobre TypeScript 7, el compilador nativo:
`npx tsc --noEmit` funciona exactamente igual que antes y una comprobación completa
del repositorio tarda ahora unos pocos segundos en lugar de decenas de segundos. La
instalación usa el alias doble oficial: el paquete `typescript` resuelve la API de
JavaScript de TypeScript 6 (mediante el envoltorio `@typescript/typescript6`) porque
`svelte-check` sigue consumiendo esa API, mientras que `@typescript/native` aporta el
binario `tsc`. Cosas que conviene saber:

- **Editores.** VS Code necesita la extensión "TypeScript 7" del marketplace
  (`TypeScriptTeam.native-preview`) para el soporte nativo del servicio de lenguaje
  hasta que llegue el soporte integrado; se activa con el ajuste
  `js/ts.experimental.useTsgo`, y su comando "Disable TypeScript 7 Language Server"
  es la alternativa autorizada para volver al tsserver de TypeScript 6. Los IDE de
  JetBrains detectan automáticamente el servidor nativo solo bajo el nombre de
  paquete `@typescript/native-preview`, así que no lo cogerán del alias
  `@typescript/native` de este repositorio; su soporte integrado de TypeScript 6
  funciona bien.
- **Opciones útiles de tsc.** `--checkers N` fija el número de procesos paralelos de
  comprobación de tipos (4 por defecto; los resultados son idénticos con cualquier
  número): bájalo para limitar la memoria en un runner ajustado, súbelo en una
  máquina con muchos núcleos y mide en ambos casos, porque más no siempre es más
  rápido. `--singleThreaded` desactiva todo el paralelismo. Comprobar un único
  archivo puntualmente (`npx tsc somefile.ts`) da error cuando el directorio tiene un
  `tsconfig.json`; pasa `--ignoreConfig` para recuperar el comportamiento antiguo.
- **Archivo de bloqueo.** Regenera `package-lock.json` solo con
  `npx npm@10 install --package-lock-only`: el archivo usa la semántica de npm 10, y
  las versiones mayores más nuevas de npm (incluida la npm 11 que trae el Node 26 de
  CI) descartan en silencio las entradas anidadas de pares opcionales de
  `svelte-check`, lo que desincroniza `npm ci` en CI. `npm ci` a secas es seguro con
  cualquier versión mayor de npm. Después de regenerar, confirma que
  `npm ci --dry-run` está sincronizado tanto con npm 10 como con la npm de tu equipo.
- **Cuándo revisarlo.** Colapsa el alias doble de vuelta a una única dependencia
  `typescript` cuando se cumplan AMBAS condiciones: que haya salido la API de
  JavaScript estable de TypeScript 7.1 (TypeScript 7.0 no incluye ninguna API de
  JavaScript; el reemplazo se sigue en la incidencia 2824 de microsoft/typescript-go)
  y que la incidencia 3063 de sveltejs/language-tools se haya cerrado con una versión
  publicada de `svelte-check` que la adopte. Los modos experimentales `--tsgo` de
  svelte-check no eliminan su dependencia de la API de TypeScript 6, y su carga de
  TypeScript 7 en curso (PR 3073 de language-tools) lee el alias `@typescript/native`
  que este repositorio ya usa, así que no hace falta ningún renombrado.

## Cómo hacer tu cambio

1. **Parte de la rama de release más reciente, nunca de `main`.** El trabajo activo se
   integra en una rama `release/vX.Y.Z`; `main` va por detrás y no es la base para las
   contribuciones. Busca la más nueva y crea tu rama a partir de ella:

   ```bash
   git fetch origin
   git branch -r --list 'origin/release/*' | sort -V | tail -1   # the newest release branch
   git switch -c feature/<short-slug> origin/release/vX.Y.Z
   ```

   Ejecuta siempre esa búsqueda en lugar de copiar un número de versión de esta guía:
   las ramas de versión se renuevan a menudo, y la más nueva cambia con cada
   lanzamiento. Las ramas se llaman `feature/<short-slug>` o `fix/<short-slug>`.
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
- **La lógica nueva llega como su propio módulo pequeño y probado detrás de una
  costura existente**, en lugar de añadirse a uno de los grandes archivos
  coordinadores. Los datos que leen el renderizador o el HUD cruzan la interfaz
  `IWorld` (`src/world_api/`) y se implementan tanto en el mundo sin conexión como en
  el mundo en línea; un sistema de simulación nuevo va detrás de `SimContext`; un
  endpoint REST nuevo es un módulo de ruta que puedes generar con
  `npm run new:endpoint`.
- **No edites a mano los archivos generados** como `*.generated.ts`. Vuelve a
  generarlos a través de la compilación.
- **Estilo de redacción de la casa: nada de rayas, guiones largos ni emojis** en
  ninguna parte, ni en el código, ni en los comentarios, ni en la documentación, ni
  en los mensajes de commit, ni en el texto de los PR, ni en el texto de cara al
  jugador. Usa comas, dos puntos, paréntesis o "a" para los rangos. Una comprobación
  previa al push analiza tu diff y lo bloquea si encuentra alguno.
- **Nunca subas secretos** ni un archivo `.env`, y no actives nunca
  `ALLOW_DEV_COMMANDS` en una ruta de producción, ya que desbloquea trucos.

### Estilo de código

El formateo lo hace [Biome](https://biomejs.dev/), configurado en `biome.json`:
sangría de 2 espacios, líneas de 100 columnas, comillas simples y comas finales.
Formatea solo los archivos que hayas tocado
(`npx @biomejs/biome check --write <your-file.ts>`) y compruébalos con
`npm run ci:changed`. CI solo verifica los archivos modificados, así que, por favor,
no reformatees el resto del árbol: una ejecución sobre todo el repositorio saca a la
luz deuda antigua que no te toca a ti arreglar.

## Antes de abrir un pull request

Ejecuta la verificación del repositorio en tu equipo. Es el mismo contrato que
impone CI:

```bash
npm run gate
```

Mientras iteras, ejecuta una sola suite (`npx vitest run tests/sim.test.ts`) y
`npm run ci:changed` para el formateo; `npm test` lo ejecuta todo, y el mapa de
suites está en `tests/CLAUDE.md`. El `npm run gate` completo cubre la frescura de los
artefactos generados, el escaneo de malware, el formateo de los archivos modificados,
la comprobación de conformidad de los efectos de sonido, toda la suite de pruebas, una
pasada de regresión en un navegador real, la comprobación estricta de tipos y las
compilaciones del cliente, del servidor y de la versión sin interfaz. Las
comprobaciones por capas, desde el mínimo previo al push hacia arriba, se describen en
[`docs/qa-gate.md`](../qa-gate.md).

Después, prueba tu cambio tanto en escritorio como en móvil, incluido un viewport
del tamaño de un teléfono en vertical y en horizontal, si toca algo que los
jugadores ven. Los objetivos táctiles deben mantenerse en al menos 40x40px y los
campos de formulario en una fuente de al menos 16px. Las normas de la interfaz
están documentadas en [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).

## Abrir el pull request

Sube tu rama y abre un PR **apuntando a la misma rama `release/vX.Y.Z` más reciente
de la que partiste. Nunca apuntes a `main`**, que es una rama de integración para el
momento de la publicación y no la base de las contribuciones. GitHub suele
preseleccionar `main` por ti, así que cambia la rama base antes de enviarlo. La
[plantilla de pull request](../../.github/PULL_REQUEST_TEMPLATE.md) te guiará por una
breve lista de comprobación. Por favor, rellénala:

- Describe **qué** cambió y **por qué**.
- Enlaza cualquier incidencia relacionada (por ejemplo, "Closes #123").
- Añade **capturas o un clip para los cambios de interfaz**, en escritorio y móvil.
- Confirma que `npm run gate` pasa y que las cadenas nuevas de cara al jugador siguen
  la política de "primero el inglés" para quienes contribuyen que se describe más
  abajo.

En tu PR, CI ejecuta el formateo y el linting sobre los archivos que has modificado,
la suite de pruebas completa repartida en cuatro particiones paralelas, una pasada de
regresión en navegador, y la comprobación de tipos junto con las compilaciones del
cliente, del servidor y de la versión sin interfaz. Eso coincide con lo que ejecuta
`npm run gate` en tu equipo, así que una verificación local en verde predice bastante
bien un PR en verde.

Una ejecución de CI en verde y una lista de comprobación completa son lo que
buscamos antes de fusionar. Puede que un responsable del proyecto te sugiera
cambios. Eso es una parte normal y colaborativa del proceso, no un rechazo.
Procuramos ser amables y constructivos en las revisiones, y te pedimos lo mismo a
ti.

> Los mensajes de commit y los títulos de los PR siguen
> [Conventional Commits](https://www.conventionalcommits.org/) con un ámbito
> (`feat(talents): ...`, `fix(net): ...`). Cada commit lleva además un cuerpo:
> después de una línea en blanco, de una a cuatro frases sencillas que digan qué
> cambió y por qué, con un ancho cercano a 72 columnas. Un título por sí solo no
> basta.

<a id="localization"></a>

## Localización

World of ClaudeCraft se distribuye en muchos idiomas. Cada cadena visible para el
jugador debe ser una clave de traducción, mientras que quien contribuye una
funcionalidad normalmente solo añade el original en inglés.

- Todo el texto de cara al usuario es una clave `t()`. Añade el texto nuevo en inglés
  al módulo por dominio que corresponda dentro de
  [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/) (el cromo nuevo del HUD va en
  `hud_chrome.ts`) y luego renderízalo con `t('dotted.key', values)`. Que esté solo en
  inglés es exactamente lo correcto en un PR de funcionalidad: el responsable del
  proyecto rellena el resto de idiomas en el momento de la publicación, así que no
  edites las superposiciones de `src/ui/i18n.locales/` y nunca dejes en ellas un
  marcador de posición en inglés ni un `// TODO`. La excepción M16 es un valor nuevo
  en inglés con mucho texto, que además necesita los cinco rellenos no latinos que se
  describen en [`src/ui/CLAUDE.md`](../../src/ui/CLAUDE.md).
- Los números, el dinero, las fechas, las unidades y los porcentajes pasan por los
  formateadores (`formatNumber`, `formatMoney`, `formatDateTime`, `Intl`) en lugar
  de construir cadenas a mano.
- El texto de cara al jugador emitido desde `src/sim/` o `server/`, que se
  mantienen agnósticos al idioma, debe volver a localizarse en la frontera del
  cliente dentro del mismo cambio. La prueba de protección
  `npx vitest run tests/localization_fixes.test.ts` lo garantiza.
- Después de añadir o cambiar cualquier cadena, ejecuta `npm run i18n:gen` y sube los
  paquetes regenerados en el mismo cambio. Tanto la verificación local como CI
  comparan los artefactos subidos con una regeneración limpia, así que un paquete
  desactualizado hace fallar la compilación.

Así que añade tus cadenas en inglés y abre el PR; no hace falta que las traduzcas tú.
Si te apetece ayudar con las traducciones, mira la sección siguiente.

<a id="translating-the-game"></a>

## Traducir el juego

¿Quieres mejorar un idioma o ayudar a llevar el juego a uno nuevo? No necesitas
escribir nada de código de juego para hacerlo:

1. La mayoría de las traducciones de cara al jugador viven en los archivos de
   superposición por idioma dentro de
   [`src/ui/i18n.locales/`](../../src/ui/i18n.locales/) (uno por idioma), que reflejan
   las claves en inglés de [`src/ui/i18n.catalog/`](../../src/ui/i18n.catalog/). El
   texto emitido por la simulación y por el servidor se traduce en
   `src/ui/sim_i18n.ts` y `src/ui/server_i18n.ts`, el texto de talentos en los módulos
   `talent_i18n`, y el panel de administración tiene su propio conjunto en
   `src/admin/i18n.locales/`.
2. Mejora las traducciones existentes o completa las que suenen raras.
3. Ejecuta `npm run i18n:gen`, sube los paquetes regenerados junto con tu cambio en la
   superposición, ejecuta después las suites de localización
   (`npx vitest run tests/i18n_completeness.test.ts tests/localization_coverage.test.ts`)
   y abre un PR. Una comprobación de tipos por sí sola no te dirá si falta una clave,
   porque las superposiciones son deliberadamente dispersas.

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
- **Vulnerabilidades de seguridad.** Por favor, no abras una incidencia pública.
  Comunícalas en privado siguiendo [SECURITY.md](../../SECURITY.md) y trabajaremos
  contigo en la corrección y en la divulgación.

## Cómo conseguir ayuda

¿Te has atascado o solo quieres saludar? Únete al
[Discord de la comunidad](https://discord.com/invite/worldofclaudecraft). Ninguna pregunta es
demasiado pequeña, y quien contribuye por primera vez siempre es bienvenido.

## Licencia

Al contribuir código, aceptas que tus contribuciones de código se licencien bajo la
[Licencia MIT](../../LICENSE) del proyecto, la misma licencia que cubre el proyecto.

La Licencia MIT dice lo que dice: cualquiera puede usar, modificar y redistribuir el
código, con fines comerciales o no. Nuestros
[Términos del servicio](https://worldofclaudecraft.com/terms) rigen el juego alojado
que gestionamos en worldofclaudecraft.com (cuentas, conducta, objetos virtuales) y no
restringen los derechos que la Licencia MIT te otorga a ti ni a nadie sobre este
código. Los nombres y la marca de "World of ClaudeCraft" y "Levy Street" no están
cubiertos por la Licencia MIT.

Los recursos creativos originales (grabaciones de sonido, música, arte y obras de
autoría similares) son la excepción. Si contribuyes un recurso original creado por
ti, puedes conservar los derechos de autor y aportarlo bajo la licencia que prefieras
(por ejemplo, CC BY-NC 4.0), siempre que:

- la licencia, las rutas de los recursos que cubre y tu atribución queden registradas
  en la tabla de licencias de [CREDITS.md](../../CREDITS.md) dentro del mismo pull
  request, y
- incluya como mínimo una cesión perpetua y libre de regalías a Levy Street para usar
  los recursos comercialmente en World of ClaudeCraft, incluidas las publicaciones
  oficiales y la tienda dentro del juego.

Para los recursos que figuran en la tabla de CREDITS.md, esa licencia registrada
prevalece sobre la licencia MIT por defecto del proyecto.

**Los recursos multimedia que no tengan una entrada en CREDITS.md no están
licenciados bajo MIT.** El registro todavía se está completando, así que una entrada
que falta significa que las condiciones no están registradas, no que el recurso sea
libre. Es deliberado: evita que una contribución sin registrar se ceda por defecto.
Con el código ocurre lo contrario, y todo lo que no esté excluido en CREDITS.md es
MIT.

Justo por eso la entrada en el registro no es papeleo opcional. Si contribuyes un
recurso sin una fila en CREDITS.md, nadie aguas abajo puede usarlo y no tenemos
constancia de qué nos has cedido. Rellena también con honestidad la columna
**Redistribution**. Es lo que le dice a alguien que bifurque este proyecto si puede
transmitir tu recurso, y algunas filas están marcadas como "No, permission required"
precisamente porque no puede.

---

Gracias por contribuir a World of ClaudeCraft. Estamos deseando ver lo que
construyes con nosotros.
