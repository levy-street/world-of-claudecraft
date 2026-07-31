<div align="center">

# World of ClaudeCraft

**Haz misiones, forma grupo e incursiona en un mundo hecho a mano, gratis en tu navegador. De código abierto, web3 y en línea ahora mismo.**

**Sitio web oficial: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.32.4-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.es.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · **Español** · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Čeština](README.cs_CZ.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Jugar ahora](https://worldofclaudecraft.com/) · [Aloja tu propio mundo](#host-your-own-world-one-command) · [Entrena un agente](#train-an-agent-headless-rl) · [Web3](#web3) · [Contribuir](CONTRIBUTING.es.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![Pantalla de título de World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## ¿Qué es esto?

World of ClaudeCraft es un MMO completo de la era clásica que puedes jugar ahora mismo en tu navegador, alojar tú mismo con un solo comando e incluso usar para entrenar agentes de IA que aprendan a jugar. Es gratis, de código abierto y está en línea en [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Un mismo mundo compartido corre en tres lugares, todos desde el mismo núcleo de juego:

- el **servidor multijugador autoritativo**, el mundo en vivo que juegas en worldofclaudecraft.com, donde las cuentas respaldadas por Postgres comparten un único reino persistente,
- el **mundo offline del navegador**, una Sim local para un solo jugador que obtienes desde el servidor de desarrollo, útil para desarrollar y para leer el núcleo del juego de principio a fin,
- el **entorno de RL headless**, donde Python controla el juego real a través de una interfaz Gym.

Misma semilla, mismo mundo, en todas partes. Buena parte de lo que ves se sigue dibujando desde el código en tiempo de ejecución, y el resto es un conjunto curado de recursos que viene con el proyecto, así que un fork funciona de inmediato.

## Lo destacado

- **Nueve clases clásicas**, cada una con un kit completo al estilo de la era clásica que gana rangos a medida que subes de nivel, más un **sistema de talentos** completo (tres especializaciones por clase, 27 especializaciones en total).
- **Tres zonas de mundo abierto** del nivel 1 al 20, más de 90 misiones y una sola línea argumental conectada sobre la conspiración de los Gravecaller.
- **Cinco mazmorras instanciadas**, cuatro de ellas incursiones de élite para cinco jugadores y una cripta en solitario, con escalado de élites, mecánicas de jefe de área, botín según el arquetipo de clase que se acumula en conjuntos de nivel y un **nivel de dificultad Heroico** con recompensas más ricas, además de **world bosses** de mundo abierto y un final de incursión para diez jugadores.
- **Dos delves escalables**, un modo de grupo pequeño para uno o dos jugadores más un compañero de IA, reconstruidos a partir de cámaras aleatorias en cada partida entre los niveles Normal y Heroico.
- **PvP clasificatorio** en dos mapas de arena: escalas de 1v1 y 2v2, un modo Fiesta 2v2 más animado y **Protect Yumi**, un modo por objetivos de 3v3 y 5v5. El juego clasificatorio paga Honor, que compra un conjunto de equipo exclusivo de PvP que nunca supera al botín de mazmorra en PvE.
- **The Vale Cup**, una liga de boarball que se juega en su propio estadio al sur de Eastbrook, y **Card Duel**, un juego de cartas rápido cara a cara que se organiza en el pueblo.
- **Un Book of Deeds**: un diario de logros con títulos cosméticos, bordes de insignia y Renown, con Chronicles por zona que llevan NPCs Chronicler dentro del mundo y una tabla de clasificación histórica.
- **Una economía de profesiones profunda**: cuatro oficios de recolección alimentan diez de creación, desde cocina y alquimia hasta joyería, armería y encantamiento, con herramientas por niveles, estaciones de trabajo en los pueblos, calidad de obra maestra y encargos, todo alimentando un **World Market** impulsado por los jugadores y el servicio de correo **Ravenpost**.
- **Multijugador real**: grupos e incursiones, hermandades, intercambio, duelos, derechos de botín, XP repartida en grupo, susurros, estado de ausencia y un **Dungeon Finder** con colas por rol y anuncios de grupos prearmados.
- **Creado en código, no en un editor 3D**: el terreno, el agua, el clima, el trazado de los pueblos, las sombras en tiempo real y los efectos se generan en tiempo de ejecución, y los modelos que sí se distribuyen los construyen fábricas procedimentales y una biblioteca curada de recursos en lugar de esculpirse a mano.
- **Localizado en 22 idiomas** mediante una canalización determinista en la que la sim emite claves.
- **Una wiki complementaria en `/wiki`**, generada directamente a partir del contenido vivo del juego, así que no puede desviarse del mundo que documenta.
- **Aplicaciones nativas en todas las plataformas**: instaladores de escritorio firmados para Windows, Linux y macOS con actualizaciones automáticas y reflejo opcional de logros en Steam, más compilaciones de iOS y Android, todas compartiendo el cliente del navegador y el mismo mundo en línea.
- **Se adapta a la máquina que tengas**: los ajustes preestablecidos de gráficos y un regulador automático de velocidad de fotogramas cambian riqueza visual por fluidez, y están sujetos a una regla de equidad que les impide ocultar jamás algo a lo que un jugador reacciona.
- **Entorno de RL headless** con enlaces de Gymnasium, modelado de recompensas y un modo de benchmark.
- **Utilidad de $WOC, totalmente opcional**: vincula una cartera de Solana para obtener distintivos de poseedor, Daily Rewards y una opción de pago con descuento en la tienda cosmética. El juego sigue siendo gratuito y no custodial.
- **Season 1 Armory**: colecciona aspectos cosméticos de armas a través de la WOC Store, usando Claudium comprado con dinero fiat, SOL, USDC o $WOC. Los cosméticos nunca otorgan poder de combate.

## Capturas

![La plaza del pueblo de Eastbrook, la fogata y los NPCs de misiones](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Anochecer en la fogata de Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Anochecer en la fogata de Eastbrook* | ![Pulls de élite en the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Pulls de élite a la luz de las antorchas en the Hollow Crypt* |
| ![Los muertos inquietos en la capilla en ruinas](../../docs/screenshots/restless-dead.jpg)<br>*Los muertos inquietos en la capilla en ruinas* | ![Una refriega con los Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*En inferioridad numérica en el campamento de bandidos* |
| ![Old Greyjaw cazado en el camino del norte](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, el spawn raro, abatido en el camino del norte* | ![Interfaz de vendedor y bolsas](../../docs/screenshots/vendor-and-bags.jpg)<br>*Equipándose en lo de Trader Wilkes, con el vendedor y las bolsas abiertos* |
| ![El portal lunar en la orilla de Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Los ahogados trepan a la superficie en el portal lunar de Glimmermere* | ![Ysolei en el altar de the Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest y el altar de the Drowned Temple* |

El clima está impulsado por el bioma y es solo de renderizado, así que nunca toca la sim determinista:

| | | |
|:---:|:---:|:---:|
| ![Cielos despejados sobre Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Despejado sobre el Vale* | ![Lluvia sobre Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Lluvia sobre Mirefen Marsh* | ![Nieve en Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Nieve en Thornpeak Heights* |

## Juégalo

Juega en tu navegador en [worldofclaudecraft.com](https://worldofclaudecraft.com/), o instala la aplicación nativa para Windows, Linux, macOS, iOS o Android. Todos los clientes se conectan al mismo mundo en línea.

### En línea, con otros jugadores

Crea una cuenta, crea un personaje y entra al mundo en vivo. Para levantar ese mismo stack cliente/servidor por tu cuenta, consulta [Aloja tu propio mundo](#host-your-own-world-one-command) más abajo.

### Offline, en el servidor de desarrollo

El modo offline es un mundo local para un solo jugador, sin cuenta y sin autoridad de servidor, así que solo se incluye en las compilaciones de desarrollo. Ejecuta el servidor de desarrollo y aparecerá en el selector de modo:

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

Ponle nombre a tu personaje, elige cualquiera de las nueve clases y comienzas en **Eastbrook Vale** (niveles 1-7), un pueblo de mercado rodeado de enclaves: senderos de lobos al norte, praderas de jabalíes al este, los bosques de Sableweb al oeste, Mirror Lake al noroeste, una excavación de cobre infestada de excavadores al suroeste y una capilla en ruinas de muertos inquietos al noreste, con el campamento de bandidos de Gorrak al sureste. El camino del norte sube por un paso de montaña hacia **Mirefen Marsh** (6-13, enclave Fenbridge) y más arriba hasta **Thornpeak Heights** (13-20, enclave Highwatch). La semilla del mundo está fijada en `src/main.ts`, así que es el mismo lugar en cada visita.

### Aplicaciones de escritorio para Windows, Linux y macOS

World of ClaudeCraft se distribuye como aplicaciones de escritorio completas para las tres plataformas principales: instaladores firmados de Windows, paquetes AppImage y deb de Linux, y compilaciones universales de macOS firmadas y notarizadas. Usan el mismo cliente de juego y el mismo mundo en línea que el navegador, con empaquetado nativo y actualizaciones automáticas.

El inicio de sesión en línea es solo con Discord y correo electrónico, exactamente el flujo web: el correo y la contraseña inician sesión dentro de la aplicación, y "Continue with Discord" abre tu navegador predeterminado en la página `/desktop-login`, que devuelve un código de un solo uso a la aplicación mediante un enlace profundo `worldofclaudecraft://` que la aplicación canjea por un token de sesión normal de World of ClaudeCraft.

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

Apunta el shell a otra API con `VITE_DESKTOP_API_ORIGIN`, por ejemplo un servidor local o un host de staging:

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

Sobrescribe el origen de la API de producción para las compilaciones de staging con `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` (un valor de tiempo de COMPILACIÓN: queda incrustado en el bundle y grabado en la aplicación empaquetada, y las compilaciones instaladas lo ignoran como variable de entorno en tiempo de ejecución). Steam es un canal de distribución (el mismo bundle de Electron, subido mediante SteamPipe), y los jugadores de escritorio pueden vincular una cuenta de Steam para reflejar los deeds que consigan como logros de Steam; el inicio de sesión en sí sigue siendo por correo y Discord. El runbook completo de lanzamiento (firma, notarización, publicación de una actualización automática, depósitos de SteamPipe, el despliegue del servidor) es `docs/desktop-release.md`. iOS y Android se distribuyen mediante Capacitor, con su propio runbook en `docs/mobile-store-release.md`.

<a id="host-your-own-world-one-command"></a>

## Aloja tu propio mundo (un solo comando)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Para **alojamiento remoto**, coloca el stack de compose en cualquier VPS, define un `POSTGRES_PASSWORD` real en el entorno y pon el puerto 8787 detrás de un proxy inverso con TLS. Con Caddy son unas pocas líneas; los WebSockets se enrutan por proxy automáticamente y el cliente selecciona por su cuenta `wss://` en páginas https. Los endpoints de autenticación tienen límite de tasa, las contraseñas se cifran con scrypt y las sesiones de inicio expiran. Nunca definas `ALLOW_DEV_COMMANDS=1` en producción, ya que habilita todo el conjunto de trucos de `/dev`: los trucos de nivel y teletransporte que usan los bots de prueba, más la concesión de objetos, la aparición de mobs, los teletransportes a instancias y la interfaz de comandos de desarrollo dentro del juego. [DEPLOY.md](../../DEPLOY.md) es la guía completa de producción, incluida la configuración del proxy inverso que mantiene los endpoints de salud y métricas fuera del borde público.

<a id="develop-online-with-hot-reload"></a>

### Desarrolla en línea con recarga en caliente

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api, /admin/api, and /ws)
```

Abre http://localhost:5173, elige **Play Online**, crea una cuenta, crea un personaje y entra con Enter World. La pantalla de selección de personaje muestra las novedades más recientes del lanzamiento en su panel News & Updates, con insignias NEW para todo lo que aún no hayas visto. Abre una segunda pestaña e inicia sesión de nuevo para verse el uno al otro en el pueblo. `Enter` abre el chat. La wiki de jugadores es la Guide del repositorio, servida en http://localhost:5173/wiki y en `/wiki` en producción; su contenido se genera a partir de los datos actuales del juego con `npm run wiki:content`.

Qué persiste y cómo el servidor mantiene el control:

- **Cuentas**: contraseñas cifradas con scrypt y tokens bearer que expiran.
- **Personajes**: hasta 10 por cuenta y por reino; nivel, equipo, bolsas, bóveda del banco, misiones, talentos, profesiones, progreso de PvP y de deeds, posición y dinero persisten como JSONB en Postgres, guardados por temporizador, al cerrar sesión y al apagar el servidor. Los nombres son únicos por reino y de estilo clásico.
- **El servidor es autoritativo**: los clientes transmiten intención de movimiento y comandos a 20 Hz; el servidor ejecuta la única `Sim` compartida y devuelve snapshots delimitados por interés más eventos por jugador. Cada tirada de combate, caída de botín, crédito de misión y transacción con vendedor se resuelve en el servidor. El cliente es un renderizador.

<a id="train-an-agent-headless-rl"></a>

## Entrena un agente (RL headless)

El mismo núcleo determinista corre como un entorno de [Gymnasium](https://gymnasium.farama.org/), así que un agente aprende contra el juego real, no contra una reimplementación de él. El servidor del entorno (`headless/env_server.ts`) envuelve una `Sim` y habla JSON delimitado por saltos de línea sobre stdio; los enlaces de Python en `python/` lo lanzan como subproceso y exponen el bucle habitual de `reset` / `step` / `close`.

```bash
npm run build:env    # bundle the env server to dist-env/env_server.cjs
npm run env          # run it directly (NDJSON on stdio)
npm run bench        # in-process throughput benchmark (no IPC)

# drive it from Python
pip install gymnasium numpy
python python/example_random_agent.py
```

```python
from wow_env import WoWClassicEnv

env = WoWClassicEnv(player_class="warrior")   # any of the nine classes
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **Los espacios de observación y acción se derivan del contenido.** Consúltalos desde la respuesta `info` del entorno al inicio en lugar de codificarlos a mano; crecen con el juego. El espacio de acción es un `Discrete` que cubre movimiento, objetivo, ataque, el kit completo de habilidades, interactuar y comer/beber; la observación es un `Box` que cubre uno mismo, habilidades, objetivo, mobs cercanos, el interactuable más cercano y el progreso de misiones.
- **La recompensa** es una suma ponderada de deltas de contadores por tick (XP, daño infligido y recibido, muertes propias y ajenas, progreso de misiones, subidas de nivel), ajustable en cada reset. Cada `step` aplica una acción y avanza cinco ticks de sim por defecto, así que aproximadamente cuatro decisiones por segundo simulado.
- **Determinista por construcción.** Sin reloj de pared, sin `Math.random`. Siembra el reset y el episodio se repite exactamente igual.

El protocolo y los enlaces están documentados en `headless/CLAUDE.md` y `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft es nativo de web3 en torno a **$WOC**, nuestro token comunitario en Solana. Conecta una cartera de Solana, vincúlala a tu cuenta con una sola firma (no custodial, sin transacción que aprobar), y tu saldo de $WOC de solo lectura aparece en el HUD junto a una insignia cosmética de nivel de poseedor.

$WOC también tiene utilidad opcional dentro del juego en vivo:

- **WOC Store**: compra Claudium, la moneda cosmética de un solo sentido, con dinero fiat, SOL, USDC o $WOC. La vía de pago con $WOC tiene descuento frente a las demás.
- **Season 1 Armory**: gasta Claudium en colecciones de aspectos cosméticos de armas. Las compras en la tienda no añaden estadísticas ni poder de combate.
- **Daily Rewards**: los poseedores verificados que califiquen pueden ganar puntos con un giro diario y tareas rotativas, y luego competir por una parte del fondo de premios diario.

Nada de esto hace falta para jugar. Vincular la cartera es opcional y no custodial, no hay pago para ganar, y todo el juego funciona perfectamente sin conectar jamás una cartera.

**Dirección del contrato de $WOC (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Más sobre el token en [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Un recorrido por el mundo

### Las nueve clases

Cada clase corre sobre mecánicas de MMO de la era clásica implementadas desde primeros principios, y aprende hechizos por rangos a lo largo de los niveles 1-20, con habilidades características como Low Blow, Early Grave, Skyfall, Urgent Prayer y Ancestral Strike que se desbloquean en la segunda mitad del ascenso.

- **Warrior**: ira, Iron Bellow, Onrush, Quaking Blow, Maiming Strike, Gaping Wounds (un sangrado que acompaña a tus golpes), Widening Arc, Hobbling Cut, Blood Toll, Redhand (proc por esquivar).
- **Paladin**: Oathbrand desatado por Verdict, Mending Light, Steadfast Aura, Oath of Iron, Ward of Faith (absorción), Sundering Gavel (aturdimiento), Last Rite.
- **Hunter**: ataque automático a distancia (8-35 yd con la zona muerta al estilo clásico), Gutting Strike, Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Counterfang, Fettering Slash y una mascota domesticable desde el nivel 10.
- **Rogue**: energía y puntos de combo, Wicked Slash, Dirt Nap, Craven Thrust (por la espalda, con daga), Eye Jab, Ghostfoot, Cutthroat Tempo, Swift Heels.
- **Priest**: Smite, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding (absorción), Lingering Grace (HoT), Mindfracture.
- **Shaman**: Arc Bolt, Stonebound Weapon (imbuir), Mending Waters, Earthen Jolt, Thunder Ward (espinas), Cinder Jolt.
- **Mage**: Cinderbolt, Hoarfrost Mantle, Aether Insight, Rimelance, Waterbind, Cinderfall, Aether Darts (canalizado), Bewitch, Icebind, un elemental de agua invocado y Chronomancy, una especialización de sanación con magia temporal.
- **Warlock**: Gloom Bolt, Fiendhide, Burning Pact, Blackrot, Hard Bargain, Hex of Anguish, Consume y siete demonios invocables desde el Emberkin hasta el Wraithborn.
- **Druid**: Wildbolt, Wildmend, Wildward, Lunar Tempest, Wildbloom, Briarguard, Gripping Roots, y transformación en Wolf Form al 5, Bruin Form al 8 y Moonwing Form al 10.

Las curaciones y mejoras alcanzan a los miembros del grupo, la sanación puede dar crítico y los escudos de absorción aguantan el daño antes que la vida. Gasta puntos en **tres especializaciones de talentos por clase** (Battlecraft/Bloodrush/Ironguard, Moongrove/Wildfang/Groveheart, y demás); la asignación se valida en el servidor y se puede exportar como cadena de build.

### Mazmorras

La línea argumental de los Gravecaller transcurre a través de tres instancias de élite para cinco jugadores, una cuarta espera tras un portal lunar con su propia historia de ahogados, y una cripta en solitario queda a un lado para los exploradores.

- **The Hollow Crypt** (5 jugadores) bajo la Fallen Chapel: basura de élite en parejas, el minijefe Sexton Marrow, y Morthen the Gravecaller con su AoE de sombras recurrente. La puerta de la cripta teletransporta a tu grupo a una copia privada de la instancia que se reinicia en cuanto queda vacía.
- **The Sunken Bastion** (5 jugadores, alrededor del nivel 13, sureste de Mirefen): Vael the Fogbinder invoca oleadas de Drowned Thralls a medida que se alarga el combate.
- **Gravewyrm Sanctum** (5 jugadores, nivel 20, bajo Thornpeak): tres cámaras de boneguard y scaleguard de élite, Korgath the Bound, Grand Necromancer Velkhar y Korzul the Gravewyrm, donde caen armas épicas.
- **The Drowned Temple** (5 jugadores) a través del portal lunar de Glimmermere: una instancia pálida de color violeta lunar que conduce a Choirmother Selthe y luego a Ysolei, Avatar of the Drowned Moon, cuyas mareas lunares y Moonspawn invocados castigan a un grupo que se queda quieto.
- **The Abandoned Crypt** (en solitario) en Thornpeak: una inmersión tranquila de piedra angular y diario para una persona, cuyo rastro abre la puerta real hacia **Nythraxis, Scourge of Thornpeak**, un final de incursión para diez jugadores que se libra a lo largo de tres piedras de guardia de almas.

Todas las instancias corren también en **Heroico**: enemigos de mayor nivel, mecánicas más exigentes y su propio botín y moneda de vendedor. Las cadenas de misiones previas se pueden hacer en solitario, así que la historia nunca queda bloqueada tras encontrar grupo. Nuestra incursión automatizada de cinco bots (warrior, paladin, priest, mage, hunter con fuego concentrado e IA de sanador) limpia the Hollow Crypt en unos cinco minutos (`node scripts/crypt_raid.mjs`, requiere `ALLOW_DEV_COMMANDS=1`).

### Delves

Los delves son un modo aparte, escalable y de grupo pequeño para uno o dos jugadores, reconstruido a partir de cámaras aleatorias en cada partida y que termina en un cofre relicario cerrado que se abre con un minijuego de ganzúas en lugar de una tirada de botín. **The Collapsed Reliquary** (nivel 7 en adelante) termina en Deacon Varric, con una compañera de IA, Tessa, luchando a tu lado si vas en solitario. **The Drowned Litany** (nivel 12 en adelante) sigue el rastro hasta un santuario inundado en el borde de Mirefen Marsh. Un tablero de delves fija el nivel: el Heroico sube los niveles de los enemigos y agrega un afijo aleatorio para recompensas más ricas.

### PvP clasificatorio (the Ashen Coliseum)

Pulsa `G` o el botón de arena para entrar en cola. El emparejamiento teletransporta a los luchadores a un foso privado, una cuenta atrás corta sana y reinicia a todos para un comienzo justo, y el combate termina cuando un bando se rinde. Nadie muere, y vuelves exactamente donde entraste en cola. Protect Yumi se libra en su propio laberinto y no en el foso del Coliseum.

- **Escalas clasificatorias de 1v1 y 2v2**, cada una con una puntuación persistente al estilo Elo y una tabla de clasificación de todos los tiempos.
- **Fiesta 2v2**, un modo de grupo más animado donde los equipos corren hacia un objetivo de derribos mientras las mejoras recogibles reparten poder y un anillo que se cierra fuerza la pelea.
- **Protect Yumi**, un modo por objetivos sin clasificación de 3v3 y 5v5 que se libra en un laberinto: cada equipo protege a un familiar felino mientras intenta derribar al del rival, así que las escoltas y las capturas importan más que las bajas puras.

Las victorias clasificatorias y los derribos en Fiesta pagan **Honor**, que el intendente del pueblo cambia por un conjunto de equipo Warfare. Warfare es una estadística exclusiva de PvP, así que el conjunto gana duelos sin superar nunca al botín de mazmorra del mismo nivel en PvE.

### Jugando juntos

- **Dungeon Finder**: ábrelo con `Shift+I` para explorar mazmorras e incursiones, inspeccionar jefes y botín, unirte a una cola automática de roles de tanque/sanador/DPS o crear un anuncio de grupo prearmado. Los grupos formados con el Finder igual viajan juntos hasta la entrada.
- **Grupos** de hasta 5, convertidos en una incursión de 10 jugadores con dos grupos una vez que te llenas: haz clic derecho en un jugador e Invitar al grupo. Los miembros comparten derechos de botín y crédito de misiones, reparten XP con las bonificaciones de grupo de la era clásica y aparecen como puntos en el minimapa. `/p` para el chat de grupo, `/roll` para repartir el botín.
- **Intercambio**: clic derecho e Intercambiar. Ambos lados colocan objetos y dinero, ambos deben aceptar, y el intercambio es atómico y validado en el servidor. Los objetos de misión no se pueden intercambiar, y alejarse lo cancela.
- **Duelos**: clic derecho y Desafiar a un duelo. Una cuenta atrás de 3 segundos, luego se pelea hasta que un bando llega a 1 hp; el ganador se anuncia en toda la zona y alejarse corriendo 60 yardas significa rendirse.
- **Derechos de botín y estado de ausencia**: el primer jugador en dañar a un mob es dueño de su botín, XP y crédito de misión; `/afk` y `/dnd` te marcan como ausente con una respuesta automática a los susurros.

### Mundo y sistemas

- **Profesiones** (`Shift+P`): cuatro oficios de recolección (minería, tala, herboristería, pesca) alimentan diez de creación, desde cocina y alquimia hasta armería, joyería y encantamiento. Las herramientas de recolección vienen en niveles que deciden qué nodos puedes trabajar, la creación se realiza en las estaciones de trabajo de los pueblos con una probabilidad de calidad de obra maestra que lleva la marca de su autor, y hay un sistema de arquetipos que descubrir a medida que te especializas.
- **The World Market**: una casa de subastas impulsada por los jugadores para equipo, materiales y consumibles, consultable desde los pueblos enclave.
- **Correo Ravenpost**: envía objetos y monedas a otros personajes, con los adjuntos guardados a salvo hasta que se reclamen.
- **Hermandades**: cartas fundacionales, listas de miembros, rangos y chat de hermandad.
- **The Guide**: una wiki interna buscable en `/wiki` que cubre clases, criaturas, zonas y deeds, generada directamente a partir del contenido vivo del juego, así que no puede desviarse del mundo que documenta.
- **The Vale Cup y Card Duel**: boarball en el estadio de Sowfield al sur de Eastbrook, en formatos desde 1v1 hasta 5v5, y un juego de cartas rápido cara a cara que organiza el Card Master en el pueblo.
- **Daily Rewards**: los poseedores verificados de $WOC pueden ganar puntos de clasificación con un giro diario y tareas rotativas, con pagos automáticos desde el fondo de premios diario.
- **WOC Store y Season 1 Armory**: compra Claudium con dinero fiat, SOL, USDC o $WOC, y luego gástalo en aspectos de armas puramente cosméticos.
- **Comer y beber**: siéntate para recuperarte, interrumpido por daño o por levantarte, y sí, puedes comer y beber a la vez.
- **Vendedores** que compran comida y agua y venden equipo blanco honesto, con las monedas mostradas en oro, plata y cobre.
- **Un banco personal** (the Gilded Strongbox): los tesoreros de cada pueblo enclave guardan una bóveda por personaje, desde 24 hasta 96 espacios con ampliaciones compradas con monedas, más espacios de bonificación que se ganan en línea por verificar el correo, vincular cuentas y traer referidos.
- **The Book of Deeds**: un diario de logros (por defecto `Shift+Z`) de misiones, muertes, limpiezas y curiosidades, que paga títulos cosméticos que puedes lucir en tu placa de nombre, en el chat y en las tablas, más un rastreador en el HUD para los deeds que persigues, Chronicles por zona que llevan NPCs Chronicler y una tabla de clasificación histórica de Renown; la lista pública vive en `/wiki/deeds`.
- **IA de mobs**: deambular, agresividad por proximidad según la diferencia de nivel, atraídas sociales, persecución, correa y reinicio, botín de cadáveres y reapariciones, con un spawn raro (Old Greyjaw) en un temporizador largo.
- **Puntos de pesca** con sus propias tablas de botín y capturas raras.
- **Aspectos cosméticos** que salen en rareza poco común, rara y épica, puramente estéticos.
- **Muerte y recuperación**: libera tu espíritu hacia el cementerio, recibe daño por caída y reduce la velocidad al nadar.
- **Clima por bioma**: despejado en el Vale, lluvia en el Marsh, nieve en los Peaks, con transiciones graduales al moverte entre zonas.

### Controles (disposición clásica)

| Entrada | Acción |
|---|---|
| `W` / `S` | correr / retroceder. `A`/`D` giran (strafe con el botón derecho del ratón presionado), `Q`/`E` hacen strafe |
| arrastrar con derecho / arrastrar con izquierdo | vista libre con ratón / orbitar la cámara. La rueda hace zoom, `Space` salta |
| `Tab` | recorrer los enemigos más cercanos. clic izquierdo para fijar objetivo, clic derecho para atacar, saquear o hablar |
| `1`-`9`, `0`, `-`, `=` | barra de acción |
| `F` | interactuar (saquear un cadáver, recoger un objeto, hablar) |
| `C` `P` `L` `M` `B` `N` `T` | personaje, libro de hechizos, registro de misiones, mapa del mundo, bolsas, talentos, creación |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | arena, amigos y hermandad, tabla de clasificación, calendario, Vale Cup, Dungeon Finder, profesiones, deeds |
| `Z` / `X` | envainar o desenvainar tus armas, rueda de emotes |
| `V` / `R` / `Esc` | placas de nombre, autocorrer, cerrar la ventana superior (o abrir el menú del juego) |

Cada atajo se puede reasignar en el panel de atajos de teclado. Los controles táctiles (un stick de movimiento, arrastre de cámara y botones de acción en pantalla) aparecen automáticamente en móvil.

## Arquitectura (una sim, tres anfitriones)

Tres ideas mantienen unido al proyecto:

- **Una sim, tres anfitriones.** El mismo código de `src/sim/` corre el mundo offline del navegador, el servidor en línea y el entorno de RL. El comportamiento debe ser idéntico en todas partes, y las pruebas existen para mantenerlo así.
- **`IWorld` es la única costura.** `IWorld` se define como interfaces de faceta por dominio bajo `src/world_api/`, agregadas por `src/world_api.ts`. La `Sim` offline lo satisface estructuralmente y la `ClientWorld` en línea lo implementa reflejando los snapshots del servidor. El renderizador y el HUD hablan solo con `IWorld`, nunca con un mundo concreto, así que una nueva funcionalidad primero extiende la faceta correspondiente y luego ambos mundos.
- **El servidor es autoritativo.** Los clientes envían intención; el servidor decide los resultados. El cliente nunca resuelve combate, botín ni economía por su cuenta.

La sim es un tick fijo de 20 Hz (`DT = 1/20`), toda la aleatoriedad fluye a través de un único `Rng` sembrado, y `src/sim/` no acarrea ningún import de DOM, navegador ni Three.js. Eso es lo que permite que el mismo código se empaquete en un servidor de entorno Node, en un bucle de juego autoritativo y en una pestaña de navegador sin cambiar una sola línea.

### Disposición del proyecto

| Ruta | Qué es |
|---|---|
| `src/sim/` | Núcleo determinista del juego, la fuente de verdad. Sin dependencias de DOM ni Three. |
| `src/sim/content/` | Datos como código: las nueve clases, habilidades, zonas, mazmorras, delves, objetos, recetas, encantamientos, talentos, profesiones, deeds. |
| `src/world_api.ts` + `src/world_api/` | `IWorld`, la costura de la que dependen el renderizador y el HUD: una interfaz de faceta por dominio. |
| `src/` (el resto) | Renderizador Three.js, HUD y estilos, entrada/audio, espejo en línea, y las SPA de administración, guía y editor. |
| `server/` | Servidor autoritativo: HTTP y WS, bucle del mundo, Postgres, autenticación, social, moderación. |
| `server/http/` | La canalización de peticiones REST: enrutador por tabla, middleware y definiciones de ruta por dominio. |
| `headless/` + `python/` | Servidor del entorno de RL (`env_server.ts`) y enlaces de Python para Gym. |
| `bot/` | Bot de Discord (roles, retransmisión, feed de actividad). |
| `electron/`, `android/`, `ios/` | Shells de escritorio (Steam) y móviles nativos. |
| `tests/` | Suite de Vitest. |
| `scripts/` | Herramientas de build, recursos, i18n, SFX, capturas y E2E en navegador. |
| `deploy/` · `mediawiki/` | Recursos de primer arranque de producción y el contenedor de la wiki de jugadores. |
| `public/` · `docs/` | Recursos estáticos (desplegados tal cual al sitio) y documentos de diseño. |

Nada de esto depende de la buena fe: `tests/architecture.test.ts` revisa cada archivo de la sim
en busca de un import prohibido, un global del DOM o una llamada suelta al reloj o a
`Math.random`, y `tests/world_api_parity.test.ts` fija la costura para que los dos mundos no puedan divergir.

La mayoría de los directorios llevan su propio `CLAUDE.md` con convenciones locales, y el
conjunto completo de invariantes del proyecto vive en el [`CLAUDE.md`](../../CLAUDE.md) raíz. Los
contribuyentes agentes empiezan ahí y luego toman el punto de entrada de su runtime:
[`AGENTS.md`](../../AGENTS.md) más la [guía del operador de Codex](../codex.md) para Codex, y
[`GEMINI.md`](../../GEMINI.md) para Gemini. Todos desembocan en la misma arquitectura canónica.

## Construido como los clásicos

El combate, la subida de nivel y la amenaza corren todos sobre reglas auténticas de la era clásica: ira y energía, tablas de impacto y esquiva, mitigación por armadura, la curva de XP real, los temporizadores de golpe y el enfriamiento global. Se siente como lo recuerdas en lugar de aproximarlo. Los números exactos viven en `src/sim/` si quieres leerlos.

El mundo se crea en código y no en un editor 3D, que es lo que lo mantiene pequeño,
determinista y fácil de bifurcar:

- El terreno, el agua, el clima, el cielo, el trazado de los pueblos, las sombras en tiempo real y los efectos de combate se generan en tiempo de ejecución a partir de los datos de la propia sim.
- Los modelos que sí se distribuyen se construyen igual: fábricas procedimentales bajo `scripts/assets/` exportan GLBs deterministas mediante la canalización de imagen a GLB del proyecto, junto a una biblioteca curada de kits de modelos CC0. Las familias de criaturas y personajes con esqueleto llevan animaciones completas de caminar, atacar, lanzar, sentarse y morir.
- Los iconos son un pintor por capas que compone arte para cualquier cosa que no tenga un archivo propio, así que nunca falta un icono, con arte pintado y curado superpuesto para habilidades, objetos y deeds.
- Un HUD clásico completo (marcos de unidad, barras de acción, tooltips, registro de misiones, mapa del mundo, minimapa, texto de combate flotante, the Book of Deeds), efectos de sonido muestreados espaciales y de interfaz, y una banda sonora compuesta procedimentalmente en el repositorio y distribuida como remasterizaciones en streaming que se funden entre zonas, pueblos, mazmorras y combate.

Cada recurso distribuido y su licencia están registrados en [CREDITS.md](../../CREDITS.md), y las
dependencias de terceros incluidas llevan sus avisos en [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Desarrollo

Además del cliente del juego, la compilación produce el panel del operador, el editor de mundo en
`/editor` y la Guide pública en `/wiki`, todos servidos desde el mismo servidor de desarrollo.

Cada ruta de FFmpeg que ejercitan el gate y las pruebas de audio resuelve los paquetes npm
incluidos `ffmpeg-static`/`ffprobe-static`, así que una contribución normal no necesita instalar
FFmpeg en el sistema. Las rutas que miden conformidad (`npm run sfx:check`, las pruebas de audio,
la validación de exportación del Studio) se enlazan directamente a los binarios estáticos, sin
recurrir a `PATH`: vuelve a ejecutar `npm ci` si una instalación con los scripts omitidos los dejó
ausentes. Los procesos de reproducción y codificación del Studio y la comprobación previa de
`npm run gate` resuelven mediante `scripts/sfx/ffmpeg_paths.mjs`, que sí recurre a `PATH`. Algunos
scripts generadores de audio independientes (por ejemplo `scripts/gen_ui_sfx.mjs`) siguen usando
por defecto el `ffmpeg` del `PATH`.

```bash
npm test                        # vitest: formulas, combat, AI, quests, all 9 classes, parties, duels, trades, dungeons
npm run gate                    # complete CI-equivalent contribution gate
npm run build                   # production web build
npm run sfx:studio              # local SFX authoring, runtime mix, and production export
node scripts/smoke_browser.mjs  # warrior end-to-end (needs npm run dev)
node scripts/smoke_mage.mjs     # mage: casting, polymorph, conjure and drink, death and release
node scripts/visual_tour.mjs    # screenshot tour of the zone and UI into tmp/
node scripts/tour_temple.mjs    # screenshot tour of the Glimmermere and Drowned Temple into tmp/
node scripts/mp_integration.mjs # API, WS, and persistence checks (server running)
node scripts/social_e2e.mjs     # trade and duel over the wire (ALLOW_DEV_COMMANDS=1)
node scripts/arena_visual.mjs   # two clients queue and fight a ranked 1v1
node scripts/crypt_raid.mjs     # five bots clear the Hollow Crypt (ALLOW_DEV_COMMANDS=1)
```

Las pruebas de lógica y unitarias usan Vitest. Mientras iteras, ejecuta un solo archivo: `npx vitest run tests/sim.test.ts`. Los cambios de interfaz también cuentan con una suite opcional en navegador real que cubre accesibilidad, navegación por teclado y objetivos táctiles: `npm run test:browser`. Los scripts de capturas y de humo controlan navegadores reales mediante `puppeteer-core` y necesitan `npm run dev` en ejecución; los scripts a nivel de cable (`mp_integration.mjs`, `social_e2e.mjs`, `crypt_raid.mjs`) hablan directamente con el servidor y necesitan `npm run server` en su lugar. Los agentes de navegador pueden controlar el movimiento a través de `window.__game.controller` en lugar de simular teclas presionadas, por ejemplo `controller.move({ forward: true }, facingRadians)` o banderas compactas como `{ f: 1, sr: 1 }`.

Las comprobaciones se ejecutan por capas, descritas en [docs/qa-gate.md](../qa-gate.md): apunta tu
clon a los hooks compartidos con `git config core.hooksPath .githooks` y un piso rápido se ejecuta
antes de que nada salga de tu máquina.

Para los comandos del servidor consulta [Desarrolla en línea](#develop-online-with-hot-reload) más
arriba, [CONTRIBUTING.md](CONTRIBUTING.es.md) para el flujo de contribución, el
[tutorial de SFX Studio](../sfx-studio-tutorial.md) para la autoría de sonido y la
exportación de artefactos, [DEPLOY.md](../../DEPLOY.md) para producción y
[CREDITS.md](../../CREDITS.md) para las licencias de los recursos.

## Localización

Cada cadena visible para el jugador se resuelve a través de `t()`, y el juego se distribuye en **22 idiomas** (inglés, dos variantes de español, dos de francés, inglés de Canadá, italiano, alemán, chino simplificado y tradicional, coreano, japonés, portugués de Brasil, ruso, checo, neerlandés, polaco, indonesio, turco, sueco, vietnamita y danés). La sim y el servidor se mantienen agnósticos al idioma: emiten claves estables o inglés que el cliente vuelve a localizar en la frontera, lo que mantiene intacto el determinismo. Los contribuyentes agregan solo inglés; el mantenedor rellena en lote los demás idiomas antes de cada lanzamiento. El flujo de trabajo está documentado en `docs/i18n-scaling/translation-workflow.md`.

## Contribuir

Las contribuciones de todo tipo son bienvenidas: código, traducciones, reportes de errores y documentación. Empieza con [CONTRIBUTING.md](CONTRIBUTING.es.md) para la configuración, lee el [Código de Conducta](../../CODE_OF_CONDUCT.md) y revisa [SECURITY.md](../../SECURITY.md) antes de reportar una vulnerabilidad. ¿Nuevo por aquí? Busca issues etiquetados como [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), abre un [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) o saluda en [Discord](https://discord.com/invite/worldofclaudecraft).

El desarrollo activo ocurre en la rama `release/vX.Y.Z` más reciente. Búscala en lugar de suponerla, y luego crea tu rama a partir de ella y dirige hacia ella tu pull request. Nunca crees ramas desde `main` ni las dirijas hacia `main`, que solo recibe una rama de lanzamiento cuando esa versión sale. [CONTRIBUTING.md](CONTRIBUTING.es.md) tiene el comando de una línea que encuentra la actual.

## Licencia

**El código tiene [licencia MIT](../../LICENSE), así que bifúrcalo, remézclalo y aloja tu propio mundo.** Ese es todo el objetivo, y nada más en esta página ni en nuestro sitio web lo revoca.

Tres cosas se licencian por separado, así que vale la pena dedicar treinta segundos a saber cuál es cuál:

| Qué | Licencia | ¿Puedes redistribuirlo? |
|---|---|---|
| **Código fuente**, es decir todo salvo los recursos multimedia excluidos más abajo | [MIT](../../LICENSE) | Sí. También comercialmente. |
| **Recursos multimedia**: modelos, texturas, HDRIs, iconos, sonidos, fuentes (en su mayoría bajo `public/`) | Por recurso, registrado en [CREDITS.md](../../CREDITS.md) | En su mayoría sí (casi todos son CC0). Algunos no, ver más abajo. |
| **Nombre y marca**: "World of ClaudeCraft", "Levy Street", los logotipos | Sin licencia | No. |

**Bifúrcalo y aloja tu propio mundo. Eso funciona, y los recursos no te lo impiden.** La mayor parte de lo que ves es dominio público CC0 (KayKit, Quaternius, Kenney, ambientCG, Poly Haven), y nuestros propios accesorios, criaturas, fondos y sonidos de interfaz generados vienen con el proyecto, así que un fork funciona de inmediato. Lo único que no puedes hacer es sacarlos de ahí y venderlos como arte independiente.

Lo que tendrías que quitar o reemplazar antes de redistribuir:

- los **iconos de habilidades de clase de CraftPix** bajo `public/ui/skills/` los compró Levy Street y **no pueden redistribuirse**, así que compra tu propia licencia si quieres distribuirlos;
- los **efectos de sonido de @jamiecypher** son CC BY-NC 4.0, así que compártelos sin fines comerciales y con crédito, pero la concesión comercial cubre solo a este proyecto;
- el **arte de tienda y prestigio** (Season 1 Armory, el conjunto de Claudium, el conjunto de arte de profesiones, los iconos del Book of Deeds, el emblema del dragón de élite) es arte comercial por encargo y **los derechos están reservados**;
- las **marcas de terceros** (Twitch, X, Kick, YouTube, Discord, Solana, USDC) son marcas registradas de sus dueños y no nos corresponde sublicenciarlas;
- un puñado de **iconos y grabaciones usados con permiso** necesitan permiso para transmitirse.

[CREDITS.md](../../CREDITS.md) es la lista autoritativa, con una columna de redistribución por recurso. Cuando un recurso figura ahí, esa licencia prevalece sobre la licencia MIT del proyecto. Ese registro todavía se está completando, así que un recurso multimedia que falte en él está sin registrar, no libre: pregunta antes de basarte en él. Con el código fuente ocurre al revés, y todo lo que no esté excluido es MIT.

Nuestros [Términos de Servicio](https://worldofclaudecraft.com/terms) cubren el juego alojado que operamos en worldofclaudecraft.com: cuentas, conducta, objetos virtuales. No restringen los derechos que la Licencia MIT te otorga sobre este código fuente.
