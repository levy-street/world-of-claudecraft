<div align="center">

# World of ClaudeCraft

**Completa misiones, forma grupos y haz incursiones en un mundo hecho a mano, gratis en tu navegador. De código abierto, web3 y en línea ahora mismo.**

**Sitio web oficial: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.33.1-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.es_ES.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · [Español](README.es.md) · **Español (España)** · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Čeština](README.cs_CZ.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Jugar ahora](https://worldofclaudecraft.com/) · [Aloja tu propio mundo](#host-your-own-world-one-command) · [Entrena un agente](#train-an-agent-headless-rl) · [Web3](#web3) · [Contribuir](CONTRIBUTING.es_ES.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![Pantalla de título de World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## Qué es esto

World of ClaudeCraft es un MMO completo de la era clásica que puedes jugar ahora mismo en tu navegador, alojar tú mismo con un solo comando e incluso usar para entrenar agentes de IA que aprendan a jugar. Es gratis, de código abierto y está en línea en [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Un mismo mundo compartido se ejecuta en tres lugares, todos a partir del mismo núcleo de juego:

- el **servidor multijugador autoritativo**, el mundo en vivo en el que juegas en worldofclaudecraft.com, donde cuentas respaldadas por Postgres comparten un único reino persistente,
- el **mundo offline en el navegador**, un Sim local para un jugador que obtienes del servidor de desarrollo, útil para desarrollar y para leer el núcleo del juego de principio a fin,
- el **entorno de RL sin interfaz**, donde Python maneja el juego real a través de una interfaz Gym.

Misma semilla, mismo mundo, en todas partes. Buena parte de lo que ves se sigue dibujando desde el código en tiempo de ejecución, y el resto es un conjunto de recursos curados que viene con el proyecto, así que un fork funciona nada más clonarlo.

## Lo destacado

- **Nueve clases clásicas**, cada una con un repertorio completo al estilo de la era clásica que gana rangos a medida que subes de nivel, más un completo **sistema de talentos** (tres especializaciones por clase, 27 especializaciones en total).
- **Tres zonas de mundo abierto** del nivel 1 al 20, más de 90 misiones y una única historia conectada sobre la conspiración del Gravecaller.
- **Cinco mazmorras instanciadas**, cuatro de ellas incursiones de élite para cinco jugadores y una cripta en solitario, con escalado de élite, mecánicas de jefe en área, botín por arquetipo de clase que se reúne en conjuntos de nivel y un **nivel de dificultad Heroico** con mejores recompensas, además de **jefes de mundo** al aire libre y un final de incursión para diez jugadores.
- **Dos delves escalables**, un modo para grupos pequeños de uno o dos jugadores más un compañero de IA, reconstruidos a partir de cámaras aleatorias en cada partida entre los niveles Normal y Heroico.
- **PvP clasificatorio** en dos mapas de arena: escaleras 1v1 y 2v2, un modo 2v2 Fiesta más animado y **Protect Yumi**, un modo por objetivos 3v3 y 5v5. El juego clasificatorio paga Honor, que compra un conjunto de equipo exclusivo de PvP que nunca supera al botín de mazmorra en PvE.
- **La Vale Cup**, una liga de boarball que se juega en su propio estadio al sur de Eastbrook, y **Card Duel**, un juego de cartas rápido cara a cara que se aloja en el pueblo.
- **Un Book of Deeds**: un diario de logros con títulos cosméticos, bordes de insignia y Renown, con Chronicles por zona que llevan NPC Chronicler dentro del mundo y una clasificación histórica.
- **Una economía de profesiones profunda**: cuatro oficios de recolección alimentan diez oficios de creación, desde la cocina y la alquimia hasta la joyería, la creación de armas y el encantamiento, con herramientas por niveles, mesas de trabajo en los pueblos, calidad de obra maestra y encargos, todo alimentando un **World Market** dirigido por los jugadores y el servicio de correo **Ravenpost**.
- **Multijugador de verdad**: grupos e incursiones, hermandades, intercambios, duelos, derechos de botín, XP repartida en grupo, susurros, estado de ausencia y un **Dungeon Finder** con colas por rol y anuncios de grupos formados.
- **Creado en código, no en un editor 3D**: el terreno, el agua, el clima, la distribución de los pueblos, las sombras en tiempo real y los efectos se generan en tiempo de ejecución, y los modelos que sí se distribuyen los construyen fábricas procedimentales y una biblioteca de recursos curada en lugar de esculpirse a mano.
- **Localizado en 22 idiomas** mediante una canalización determinista en la que el sim emite claves.
- **Una wiki complementaria en `/wiki`**, generada directamente a partir del contenido vivo del juego, así que no puede desviarse del mundo que documenta.
- **Aplicaciones nativas en todas las plataformas**: instaladores de escritorio firmados para Windows, Linux y macOS con actualizaciones automáticas y reflejo opcional de logros de Steam, más compilaciones de iOS y Android, todas compartiendo el cliente de navegador y el mismo mundo en línea.
- **Se adapta a la máquina que tengas**: los ajustes preestablecidos de gráficos y un regulador automático de fotogramas cambian riqueza visual por fluidez, y están sujetos a una regla de imparcialidad que les impide ocultar jamás algo a lo que el jugador reacciona.
- **Entorno de RL sin interfaz** con enlaces de Gymnasium, modelado de recompensas y un modo de benchmark.
- **Utilidad de $WOC, totalmente opcional**: vincula una cartera de Solana para obtener distintivo de poseedor, Daily Rewards y una opción de pago con descuento en la tienda cosmética. El juego sigue siendo gratuito y sin custodia.
- **Season 1 Armory**: colecciona aspectos cosméticos de armas a través de la WOC Store, usando Claudium comprado con dinero fiat, SOL, USDC o $WOC. Los cosméticos nunca aportan poder de combate.

## Capturas

![La plaza del pueblo de Eastbrook, la hoguera y los que dan misiones](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Anochecer junto a la hoguera de Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Anochecer junto a la hoguera de Eastbrook* | ![Pulls de élite en la Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Pulls de élite a la luz de las antorchas en la Hollow Crypt* |
| ![Los muertos inquietos en la capilla en ruinas](../../docs/screenshots/restless-dead.jpg)<br>*Los muertos inquietos en la capilla en ruinas* | ![Una refriega con los Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*Superados en número en el campamento de bandidos* |
| ![Old Greyjaw acorralado en el camino del norte](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, el spawn raro, acorralado en el camino del norte* | ![Interfaz de vendedor y bolsas](../../docs/screenshots/vendor-and-bags.jpg)<br>*Equipándote en la tienda de Trader Wilkes, con el vendedor y las bolsas abiertos* |
| ![El portal lunar en la orilla de Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Los ahogados salen del agua en el portal lunar de Glimmermere* | ![Ysolei en el altar del Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Lunar Tempest y el altar del Drowned Temple* |

El clima está impulsado por el bioma y es solo de renderizado, así que nunca toca el sim determinista:

| | | |
|:---:|:---:|:---:|
| ![Cielos despejados sobre Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Despejado sobre el Vale* | ![Lluvia sobre Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Lluvia sobre Mirefen Marsh* | ![Nieve en Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Nieve en Thornpeak Heights* |

## Juégalo

Juega en tu navegador en [worldofclaudecraft.com](https://worldofclaudecraft.com/), o instala la aplicación nativa para Windows, Linux, macOS, iOS o Android. Todos los clientes se conectan al mismo mundo en línea.

### En línea, con otros jugadores

Crea una cuenta, crea un personaje y entra en el mundo en vivo. Para levantar tú mismo esa misma pila cliente/servidor, consulta [Aloja tu propio mundo](#host-your-own-world-one-command) más abajo.

### Offline, en el servidor de desarrollo

El modo offline es un mundo local para un jugador sin cuenta y sin autoridad de servidor, así que solo se incluye en las compilaciones de desarrollo. Ejecuta el servidor de desarrollo y aparecerá en el selector de modo:

```bash
npm install
npm run dev        # then open http://localhost:5173 and choose Play Offline
```

Pon nombre a tu personaje, elige cualquiera de las nueve clases y empezarás en **Eastbrook Vale** (niveles 1-7), un pueblo mercado rodeado de enclaves: senderos de lobos al norte, praderas de jabalíes al este, los bosques de Sableweb al oeste, Mirror Lake al noroeste, una excavación de cobre plagada de excavadores al suroeste y una capilla en ruinas de muertos inquietos al noreste, con el campamento de bandidos de Gorrak al sureste. El camino del norte asciende por un paso de montaña hasta **Mirefen Marsh** (6-13, enclave Fenbridge) y sigue hacia arriba hasta **Thornpeak Heights** (13-20, enclave Highwatch). La semilla del mundo está fijada en `src/main.ts`, así que es el mismo lugar en cada visita.

### Aplicaciones de escritorio para Windows, Linux y macOS

World of ClaudeCraft se distribuye como aplicación de escritorio completa para las tres grandes plataformas de escritorio: instaladores firmados de Windows, paquetes AppImage y deb de Linux, y compilaciones universales de macOS firmadas y notarizadas. Usan el mismo cliente de juego y el mismo mundo en línea que el navegador, con empaquetado nativo y actualizaciones automáticas.

El inicio de sesión en línea es solo con Discord y correo electrónico, exactamente igual que en la web: el correo y la contraseña inician sesión dentro de la aplicación, y "Continue with Discord" abre tu navegador predeterminado en la página `/desktop-login`, que devuelve a la aplicación un código de un solo uso a través de un enlace profundo `worldofclaudecraft://` que la aplicación canjea por un token de sesión normal de World of ClaudeCraft.

```bash
npm run electron:dev          # Vite + Electron dev shell
npm run electron:pack         # local unpacked desktop app
npm run electron:build        # website-channel installers (self-updating)
npm run electron:build:steam  # SteamPipe depot layouts (in-app updater off)
```

Apunta el contenedor a otra API con `VITE_DESKTOP_API_ORIGIN`, por ejemplo un servidor local o un host de preproducción:

```bash
VITE_DESKTOP_API_ORIGIN=http://127.0.0.1:8787 npm run electron:dev
```

Sustituye el origen de API de producción para compilaciones de preproducción con `VITE_DESKTOP_API_ORIGIN=https://dev.worldofclaudecraft.com` (un valor de tiempo de COMPILACIÓN: se integra en el bundle y se estampa en la aplicación empaquetada, y las compilaciones instaladas lo ignoran como variable de entorno en tiempo de ejecución). Steam es un canal de distribución (el mismo bundle de Electron, subido mediante SteamPipe), y los jugadores de escritorio pueden vincular una cuenta de Steam para reflejar los deeds que consigan como logros de Steam; el inicio de sesión sigue siendo correo y Discord. El manual completo de publicación (firma, notarización, publicar una actualización automática, depots de SteamPipe, el despliegue del servidor) está en `docs/desktop-release.md`. iOS y Android se distribuyen mediante Capacitor, con su propio manual en `docs/mobile-store-release.md`.

<a id="host-your-own-world-one-command"></a>

## Aloja tu propio mundo (un solo comando)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres and the game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Para **alojamiento remoto**, pon la pila de compose en cualquier VPS, define un `POSTGRES_PASSWORD` real en el entorno y coloca delante del puerto 8787 un proxy inverso con TLS. Caddy lo resuelve en unas pocas líneas; los WebSockets se redirigen automáticamente y el cliente selecciona `wss://` por su cuenta en páginas https. Los endpoints de autenticación tienen límite de tasa, las contraseñas se cifran con scrypt y las sesiones de inicio de sesión caducan. Nunca pongas `ALLOW_DEV_COMMANDS=1` en producción, ya que activa todo el conjunto de trucos de `/dev`: los trucos de nivel y teletransporte que usan los bots de prueba, más concesión de objetos, aparición de mobs, teletransporte a instancias y la interfaz de comandos de desarrollo dentro del juego. [DEPLOY.md](../../DEPLOY.md) es la guía completa de producción, incluida la configuración del proxy inverso que mantiene los endpoints de salud y métricas fuera del borde público.

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

Abre http://localhost:5173, elige **Play Online**, crea una cuenta, crea un personaje y pulsa Enter World. La pantalla de selección de personaje muestra las últimas novedades de la versión en su panel News & Updates, con distintivos NEW para todo lo que no hayas visto. Abre una segunda pestaña e inicia sesión de nuevo para veros el uno al otro en el pueblo. `Enter` abre el chat. La wiki de jugadores es la Guide del propio repositorio, servida en http://localhost:5173/wiki y en `/wiki` en producción; su contenido se genera a partir de los datos actuales del juego con `npm run wiki:content`.

Qué se conserva y cómo mantiene el servidor el control:

- **Cuentas**: contraseñas cifradas con scrypt y tokens portadores que caducan.
- **Personajes**: hasta 10 por cuenta y reino; nivel, equipo, bolsas, cámara del banco, misiones, talentos, profesiones, progreso de PvP y de deeds, posición y dinero persisten como JSONB en Postgres, guardados por temporizador, al cerrar sesión y al apagar el servidor. Los nombres son únicos por reino y de estilo clásico.
- **El servidor es autoritativo**: los clientes transmiten intención de movimiento y comandos a 20 Hz; el servidor ejecuta el único `Sim` compartido y devuelve instantáneas con alcance de interés más eventos por jugador. Cada tirada de combate, caída de botín, crédito de misión y transacción con vendedor se resuelve en el lado del servidor. El cliente es un renderizador.

<a id="train-an-agent-headless-rl"></a>

## Entrena un agente (RL sin interfaz)

El mismo núcleo determinista se ejecuta como un entorno de [Gymnasium](https://gymnasium.farama.org/), así que un agente aprende contra el juego real, no contra una reimplementación de él. El servidor del entorno (`headless/env_server.ts`) envuelve un `Sim` y habla JSON delimitado por saltos de línea sobre stdio; los enlaces de Python en `python/` lo lanzan como un subproceso y exponen el habitual bucle `reset` / `step` / `close`.

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

- **Los espacios de observación y acción se derivan del contenido.** Consúltalos desde la respuesta `info` del entorno al arrancar en lugar de codificarlos a mano; crecen con el juego. El espacio de acción es un `Discrete` que cubre movimiento, objetivo, ataque, el repertorio completo de habilidades, interactuar y comer/beber; la observación es un `Box` que cubre uno mismo, habilidades, objetivo, mobs cercanos, el interactuable más cercano y el progreso de misiones.
- **La recompensa** es una suma ponderada de deltas de contadores por tick (XP, daño infligido y recibido, muertes propias y ajenas, progreso de misiones, subidas de nivel), ajustable en cada reset. Cada `step` aplica una acción y avanza cinco ticks del sim por defecto, así que aproximadamente cuatro decisiones por segundo simulado.
- **Determinista por construcción.** Sin reloj de pared, sin `Math.random`. Siembra el reset y el episodio se reproduce exactamente igual.

El protocolo y los enlaces están documentados en `headless/CLAUDE.md` y `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft es nativo de web3 en torno a **$WOC**, nuestro token comunitario en Solana. Conecta una cartera de Solana, vincúlala a tu cuenta con una sola firma (sin custodia, sin transacción que aprobar) y tu saldo de $WOC en modo solo lectura aparecerá en el HUD junto a una insignia cosmética de nivel de poseedor.

$WOC también tiene una utilidad opcional dentro del juego en vivo:

- **WOC Store**: compra Claudium, la moneda cosmética de un solo sentido, con dinero fiat, SOL, USDC o $WOC. La vía de pago con $WOC tiene descuento frente a las demás.
- **Season 1 Armory**: gasta Claudium en colecciones cosméticas de aspectos de armas. Las compras de la tienda no añaden estadísticas ni poder de combate.
- **Daily Rewards**: los poseedores verificados que cumplan los requisitos pueden ganar puntos con una tirada diaria y tareas rotatorias, y luego competir por una parte del bote diario.

Nada de esto hace falta para jugar. Vincular la cartera es opcional y sin custodia, no hay pago por ganar y todo el juego funciona perfectamente sin conectar jamás una cartera.

**Dirección del contrato de $WOC (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Más sobre el token en [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Un recorrido por el mundo

### Las nueve clases

Cada clase funciona sobre mecánicas de MMO de la era clásica implementadas desde los primeros principios, y aprende hechizos por rangos a lo largo de los niveles 1-20, con habilidades emblemáticas como Low Blow, Early Grave, Skyfall, Urgent Prayer y Ancestral Strike que se desbloquean en la segunda mitad del ascenso.

- **Warrior**: rage, Iron Bellow, Onrush, Quaking Blow, Maiming Strike, Gaping Wounds (un sangrado que acompaña a tus golpes), Widening Arc, Hobbling Cut, Blood Toll, Redhand (proc de esquiva).
- **Paladin**: Oathbrand liberado por Verdict, Mending Light, Steadfast Aura, Oath of Iron, Ward of Faith (absorción), Sundering Gavel (aturdimiento), Last Rite.
- **Hunter**: ataque automático a distancia (8-35 yd con una zona muerta al estilo clásico), Gutting Strike, Harrier's Guise, Venom Barb, Fell Shot, Rattling Shot, Counterfang, Fettering Slash y una mascota domable a partir del nivel 10.
- **Rogue**: energía y puntos de combo, Wicked Slash, Dirt Nap, Craven Thrust (por detrás, con daga), Eye Jab, Ghostfoot, Cutthroat Tempo, Swift Heels.
- **Priest**: Smite, Whispered Prayer, Litany of Resolve, Dirge of Decay, Psalm of Warding (absorción), Lingering Grace (HoT), Mindfracture.
- **Shaman**: Arc Bolt, Stonebound Weapon (encantamiento), Mending Waters, Earthen Jolt, Thunder Ward (espinas), Cinder Jolt.
- **Mage**: Cinderbolt, Hoarfrost Mantle, Aether Insight, Rimelance, Waterbind, Cinderfall, Aether Darts (canalizado), Bewitch, Icebind, un elemental de agua invocado y Chronomancy, una especialización de sanación basada en magia temporal.
- **Warlock**: Gloom Bolt, Fiendhide, Burning Pact, Blackrot, Hard Bargain, Hex of Anguish, Consume y siete demonios invocables desde el Emberkin hasta el Wraithborn.
- **Druid**: Wildbolt, Wildmend, Wildward, Lunar Tempest, Wildbloom, Briarguard, Gripping Roots, y transformación en Wolf Form en el 5, Bruin Form en el 8 y Moonwing Form en el 10.

Las sanaciones y mejoras afectan a los miembros del grupo, la sanación puede ser crítica y los escudos de absorción encajan daño antes que la salud. Reparte puntos entre **tres especializaciones de talento por clase** (Battlecraft/Bloodrush/Ironguard, Moongrove/Wildfang/Groveheart, etc.); la asignación se valida en el servidor y se puede exportar como una cadena de build.

### Mazmorras

La historia del Gravecaller transcurre a través de tres instancias de élite para cinco jugadores, una cuarta espera tras un portal lunar con su propia historia de ahogados, y una cripta en solitario queda aparte para los exploradores.

- **The Hollow Crypt** (5 jugadores) bajo la Fallen Chapel: basura de élite emparejada, el minijefe Sexton Marrow y Morthen the Gravecaller con su área de sombra recurrente. La puerta de la cripta teletransporta a tu grupo a una copia privada de la instancia que se reinicia en cuanto se vacía.
- **The Sunken Bastion** (5 jugadores, en torno al nivel 13, sureste de Mirefen): Vael the Fogbinder invoca oleadas de Drowned Thralls a medida que el combate se alarga.
- **Gravewyrm Sanctum** (5 jugadores, nivel 20, bajo Thornpeak): tres cámaras de guardia ósea y guardia escamosa de élite, Korgath the Bound, Grand Necromancer Velkhar y Korzul the Gravewyrm, donde caen armas épicas.
- **The Drowned Temple** (5 jugadores) a través del portal lunar de Glimmermere: una instancia pálida de color violeta lunar que conduce a Choirmother Selthe y luego a Ysolei, Avatar of the Drowned Moon, cuyas mareas lunares y Moonspawn invocados castigan a un grupo que se queda quieto.
- **The Abandoned Crypt** (en solitario) en Thornpeak: un descenso tranquilo de llave maestra y diario para uno solo cuyo rastro abre la puerta real hacia **Nythraxis, Scourge of Thornpeak**, un final de incursión para diez jugadores que se libra a través de tres piedras guardianas de almas.

Todas las instancias funcionan también en **Heroico**: enemigos de nivel superior, mecánicas más afiladas y su propio botín y moneda de vendedor. Las cadenas de misiones previas se pueden completar en solitario, así que la historia nunca queda bloqueada por tener que encontrar grupo. Nuestra incursión automatizada de cinco bots (warrior, paladin, priest, mage, hunter con fuego concentrado e IA de sanador) limpia la Hollow Crypt en unos cinco minutos (`node scripts/crypt_raid.mjs`, requiere `ALLOW_DEV_COMMANDS=1`).

### Delves

Los delves son un modo aparte y escalable para grupos pequeños de uno o dos jugadores, reconstruidos a partir de cámaras aleatorias en cada partida y que terminan en un cofre relicario cerrado que se abre con un minijuego de ganzúa en lugar de con una tirada de botín. **The Collapsed Reliquary** (nivel 7 en adelante) termina con Deacon Varric, con una compañera de IA, Tessa, luchando a tu lado si vas en solitario. **The Drowned Litany** (nivel 12 en adelante) sigue el rastro hasta un santuario inundado en el borde de Mirefen Marsh. Un tablón de delves fija el nivel: el Heroico sube los niveles de los enemigos y añade un afijo aleatorio para recompensas más ricas.

### PvP clasificatorio (el Ashen Coliseum)

Pulsa `G` o el botón de arena para entrar en cola. El emparejamiento teletransporta a los luchadores a un foso privado, una breve cuenta atrás sana y reinicia a todos para un comienzo justo, y el combate termina cuando un bando se rinde. Nadie muere, y vuelves exactamente al lugar donde entraste en cola. Protect Yumi se juega en su propio laberinto en lugar de en el foso del Coliseum.

- **Escaleras clasificatorias 1v1 y 2v2**, cada una con una puntuación persistente al estilo Elo y una clasificación de todos los tiempos.
- **2v2 Fiesta**, un modo de grupo más animado en el que los equipos corren hacia un objetivo de derribos mientras las recogidas de mejoras reparten poder y un anillo que se cierra fuerza a juntar la pelea.
- **Protect Yumi**, un modo por objetivos sin clasificar de 3v3 y 5v5 que se libra en un laberinto: cada equipo protege a un familiar felino mientras intenta derribar al del bando contrario, así que las escoltas y las cazas importan más que las bajas puras.

Las victorias clasificatorias y los derribos de Fiesta pagan **Honor**, que el intendente del pueblo cambia por un conjunto de equipo Warfare. Warfare es una estadística exclusiva de PvP, así que el conjunto gana duelos sin superar nunca al botín de mazmorra del mismo nivel en PvE.

### Jugar juntos

- **Dungeon Finder**: ábrelo con `Shift+I` para explorar mazmorras e incursiones, examinar jefes y botín, unirte a una cola automática por rol de tanque/sanador/DPS o crear un anuncio de grupo formado. Los grupos hechos con el buscador siguen viajando juntos hasta la entrada.
- **Grupos** de hasta 5, convertidos en una incursión de 10 jugadores con dos grupos cuando te quedas sin sitio: haz clic derecho sobre un jugador e Invitar al grupo. Los miembros comparten derechos de botín y crédito de misión, reparten la XP con las bonificaciones de grupo de la era clásica y aparecen como puntos en el minimapa. `/p` para el chat de grupo, `/roll` para repartir el botín.
- **Intercambios**: clic derecho e Intercambiar. Ambas partes preparan objetos y dinero, ambas deben aceptar, y el intercambio es atómico y validado en el servidor. Los objetos de misión no se pueden intercambiar, y alejarse cancela.
- **Duelos**: clic derecho y Desafiar a duelo. Una cuenta atrás de 3 segundos, y luego se lucha hasta que un bando llega a 1 hp; el ganador se anuncia en toda la zona y huir a 60 yardas supone rendirse.
- **Derechos de botín y estado de ausencia**: el primer jugador en dañar a un mob posee su botín, XP y crédito de misión; `/afk` y `/dnd` te marcan como ausente con una respuesta automática a los susurros.

### Mundo y sistemas

- **Profesiones** (`Shift+P`): cuatro oficios de recolección (minería, tala, herboristería, pesca) alimentan diez oficios de creación, desde la cocina y la alquimia hasta la creación de armas, la joyería y el encantamiento. Las herramientas de recolección vienen por niveles que deciden qué nodos puedes trabajar, la creación se hace en las mesas de trabajo del pueblo con una probabilidad de calidad de obra maestra que lleva tu marca de artesano, y hay un sistema de arquetipos por descubrir a medida que te especializas.
- **El World Market**: una casa de subastas dirigida por los jugadores para equipo, materiales y consumibles, consultable desde los pueblos principales.
- **Correo Ravenpost**: envía objetos y monedas a otros personajes, con los adjuntos guardados a salvo hasta que se reclaman.
- **Hermandades**: cartas fundacionales, listas de miembros, rangos y chat de hermandad.
- **The Guide**: una wiki interna y buscable en `/wiki` que cubre clases, criaturas, zonas y deeds, generada directamente a partir del contenido vivo del juego, así que no puede desviarse del mundo que documenta.
- **La Vale Cup y Card Duel**: boarball en el estadio de Sowfield al sur de Eastbrook, en formatos desde 1v1 hasta 5v5, y un juego de cartas rápido cara a cara que aloja el Card Master en el pueblo.
- **Daily Rewards**: los poseedores verificados de $WOC pueden ganar puntos de clasificación con una tirada diaria y tareas rotatorias, con pagos automáticos desde el bote diario.
- **WOC Store y Season 1 Armory**: compra Claudium con dinero fiat, SOL, USDC o $WOC, y luego gástalo en aspectos de armas puramente cosméticos.
- **Comer y beber**: siéntate para recuperarte, se interrumpe con el daño o al levantarte, y sí, puedes comer y beber a la vez.
- **Vendedores** que compran comida y agua y venden equipo blanco honrado, con monedas mostradas en oro, plata y cobre.
- **Un banco personal** (el Gilded Strongbox): los tesoreros de cada pueblo principal guardan una cámara por personaje, de 24 espacios hasta 96 con ampliaciones compradas con monedas, más espacios extra que se consiguen en línea por verificar el correo, vincular cuentas y traer referidos.
- **El Book of Deeds**: un diario de logros (`Shift+Z` por defecto) de misiones, muertes, limpiezas y curiosidades, que paga títulos cosméticos que puedes lucir en tu placa de nombre, en el chat y en las clasificaciones, más un rastreador en el HUD para los deeds que persigues, Chronicles por zona que llevan los NPC Chronicler y una clasificación histórica de Renown; la lista pública vive en `/wiki/deeds`.
- **IA de los mobs**: deambular, agresividad por proximidad según la diferencia de nivel, llamadas sociales, persecución, atadura y reinicio, saqueo de cadáveres y reapariciones, con un spawn raro (Old Greyjaw) en un temporizador largo.
- **Lugares de pesca** con sus propias tablas de botín y capturas raras.
- **Aspectos cosméticos** con tiradas de rareza poco común, rara y épica, puramente estéticos.
- **Muerte y recuperación**: libera tu espíritu hacia el cementerio, recibe daño por caída y reduce la velocidad al nadar.
- **Clima por bioma**: despejado en el Vale, lluvia en el Marsh, nieve en los Peaks, con fundidos cruzados a medida que te mueves entre zonas.

### Controles (distribución clásica)

| Entrada | Acción |
|---|---|
| `W` / `S` | correr / retroceder. `A`/`D` giran (lateral con el botón derecho pulsado), `Q`/`E` se desplazan de lado |
| arrastrar derecho / arrastrar izquierdo | mirar con el ratón / orbitar la cámara. La rueda hace zoom, `Space` salta |
| `Tab` | rota entre los enemigos más cercanos. Clic izquierdo para fijar objetivo, clic derecho para atacar, saquear o hablar |
| `1`-`9`, `0`, `-`, `=` | barra de acción |
| `F` | interactuar (saquear un cadáver, recoger un objeto, hablar) |
| `C` `P` `L` `M` `B` `N` `T` | personaje, libro de hechizos, registro de misiones, mapa del mundo, bolsas, talentos, creación |
| `G` `O` `K` `I` `Y` `Shift+I` `Shift+P` `Shift+Z` | arena, amigos y hermandad, clasificación, calendario, Vale Cup, Dungeon Finder, profesiones, deeds |
| `Z` / `X` | envainar o desenvainar las armas, rueda de gestos |
| `V` / `R` / `Esc` | placas de nombre, autocorrer, cerrar la ventana superior (o abrir el menú del juego) |

Todas las asignaciones se pueden reasignar en el panel de teclas. Los controles táctiles (un stick de movimiento, arrastre de cámara y botones de acción en pantalla) aparecen automáticamente en móvil.

## Arquitectura (un sim, tres anfitriones)

Tres ideas mantienen unido el proyecto:

- **Un sim, tres anfitriones.** El mismo código de `src/sim/` ejecuta el mundo offline en el navegador, el servidor en línea y el entorno de RL. El comportamiento debe ser idéntico en todas partes, y las pruebas existen para mantenerlo así.
- **`IWorld` es la única costura.** `IWorld` se define como interfaces de faceta por dominio bajo `src/world_api/`, agregadas por `src/world_api.ts`. El `Sim` offline lo satisface estructuralmente y el `ClientWorld` en línea lo implementa reflejando las instantáneas del servidor. El renderizador y el HUD hablan solo con `IWorld`, nunca con un mundo concreto, así que una nueva característica primero extiende la faceta correspondiente y luego ambos mundos.
- **El servidor es autoritativo.** Los clientes envían intención; el servidor decide los resultados. El cliente nunca resuelve combate, botín ni economía por su cuenta.

El sim es un tick fijo de 20 Hz (`DT = 1/20`), toda la aleatoriedad fluye a través de un único `Rng` sembrado, y `src/sim/` no lleva ninguna importación de DOM, navegador ni Three.js. Eso es lo que permite que el mismo código se empaquete en un servidor de entorno Node, en un bucle de juego autoritativo y en una pestaña de navegador sin cambiar una sola línea.

### Estructura del proyecto

| Ruta | Qué es |
|---|---|
| `src/sim/` | Núcleo determinista del juego, la fuente de la verdad. Sin dependencias de DOM ni Three. |
| `src/sim/content/` | Datos como código: las nueve clases, habilidades, zonas, mazmorras, delves, objetos, recetas, encantamientos, talentos, profesiones, deeds. |
| `src/world_api.ts` + `src/world_api/` | `IWorld`, la costura de la que dependen el renderizador y el HUD: una interfaz de faceta por dominio. |
| `src/` (el resto) | Renderizador Three.js, HUD y estilos, entrada/audio, espejo en línea y las SPA de administración, guía y editor. |
| `server/` | Servidor autoritativo: HTTP y WS, bucle del mundo, Postgres, autenticación, social, moderación. |
| `server/http/` | La canalización de peticiones REST: enrutador por tabla, middleware y definiciones de ruta por dominio. |
| `headless/` + `python/` | Servidor del entorno de RL (`env_server.ts`) y enlaces de Python Gym. |
| `bot/` | Bot de Discord (roles, retransmisión, feed de actividad). |
| `electron/`, `android/`, `ios/` | Contenedores de escritorio (Steam) y móviles nativos. |
| `tests/` | Conjunto de pruebas Vitest. |
| `scripts/` | Herramientas de compilación, recursos, i18n, SFX, capturas y E2E en navegador. |
| `deploy/` · `mediawiki/` | Recursos de primer arranque de producción y el contenedor de la wiki de jugadores. |
| `public/` · `docs/` | Recursos estáticos (desplegados tal cual en el sitio) y documentos de diseño. |

Nada de esto depende de la buena fe: `tests/architecture.test.ts` revisa cada archivo del sim
en busca de una importación prohibida, un global del DOM o una llamada suelta al reloj o a
`Math.random`, y `tests/world_api_parity.test.ts` fija la costura para que los dos mundos no puedan desviarse.

La mayoría de los directorios llevan su propio `CLAUDE.md` con convenciones locales, y el conjunto
completo de invariantes del proyecto vive en el [`CLAUDE.md`](../../CLAUDE.md) raíz. Los agentes que
contribuyen empiezan ahí y luego cogen el punto de entrada de su entorno: [`AGENTS.md`](../../AGENTS.md) más la
[guía del operador de Codex](../codex.md) para Codex, [`GEMINI.md`](../../GEMINI.md) para Gemini. Todos
ellos desembocan en la misma arquitectura canónica.

## Construido como los clásicos

El combate, la subida de nivel y la amenaza funcionan todos sobre reglas auténticas de la era clásica: rage y energía, tablas de acierto y esquiva, mitigación por armadura, la auténtica curva de XP, los temporizadores de golpe y el enfriamiento global. Se siente como lo recuerdas en lugar de aproximarlo. Los números exactos viven en `src/sim/` si quieres leerlos.

El mundo se crea en código en lugar de en un editor 3D, y eso es lo que lo mantiene pequeño,
determinista y fácil de bifurcar:

- El terreno, el agua, el clima, el cielo, la distribución de los pueblos, las sombras en tiempo real y los efectos de combate se generan en tiempo de ejecución a partir de los propios datos del sim.
- Los modelos que sí se distribuyen se construyen igual: fábricas procedimentales bajo `scripts/assets/` exportan GLB deterministas mediante la canalización de imagen a GLB del proyecto, junto a una biblioteca curada de kits de modelos CC0. Las familias de criaturas y personajes con esqueleto llevan animaciones completas de andar, atacar, lanzar, sentarse y morir.
- Los iconos son un pintor por capas que compone arte para cualquier cosa que no tenga un archivo propio, así que nunca falta un icono, con arte pintado y curado superpuesto para habilidades, objetos y deeds.
- Un HUD clásico completo (marcos de unidad, barras de acción, descripciones, registro de misiones, mapa del mundo, minimapa, texto de combate flotante, el Book of Deeds), efectos de sonido espaciales y de interfaz muestreados, y una banda sonora compuesta de forma procedimental en el repositorio y distribuida como remasterizaciones en streaming que se funden entre zonas, pueblos, mazmorras y combate.

Cada recurso distribuido y su licencia están registrados en [CREDITS.md](../../CREDITS.md), y las
dependencias de terceros incluidas llevan sus avisos en [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Desarrollo

Además del cliente de juego, la compilación produce el panel del operador, el editor de mundo en
`/editor` y la Guide pública en `/wiki`, todo servido desde el mismo servidor de desarrollo.

Todas las rutas de FFmpeg que ejercitan la puerta de calidad y las pruebas de audio resuelven los
paquetes npm incluidos `ffmpeg-static`/`ffprobe-static`, así que una contribución normal no necesita
ninguna instalación de FFmpeg en el sistema. Las rutas que miden conformidad (`npm run sfx:check`, las
pruebas de audio, la validación de exportación del Studio) se enlazan directamente a los binarios
estáticos, sin recurso a `PATH`: vuelve a ejecutar `npm ci` si una instalación que se saltó los scripts
los dejó ausentes. Los procesos de reproducción y codificación del Studio y la comprobación previa de
`npm run gate` resuelven a través de `scripts/sfx/ffmpeg_paths.mjs`, que sí recurre a `PATH`. Algunos
scripts independientes de generación de audio (por ejemplo `scripts/gen_ui_sfx.mjs`) siguen usando por
defecto el `ffmpeg` del `PATH`.

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

Las pruebas de lógica y unitarias usan Vitest. Mientras iteras, ejecuta un solo archivo: `npx vitest run tests/sim.test.ts`. Los cambios de interfaz tienen además un conjunto opcional en navegador real que cubre accesibilidad, navegación por teclado y objetivos táctiles: `npm run test:browser`. Los scripts de capturas y humo manejan navegadores reales mediante `puppeteer-core` y necesitan que `npm run dev` esté en marcha; los scripts a nivel de cable (`mp_integration.mjs`, `social_e2e.mjs`, `crypt_raid.mjs`) hablan directamente con el servidor y necesitan `npm run server` en su lugar. Los agentes de navegador pueden manejar el movimiento a través de `window.__game.controller` en lugar de simular teclas pulsadas, por ejemplo `controller.move({ forward: true }, facingRadians)` o banderas compactas como `{ f: 1, sr: 1 }`.

Las comprobaciones se ejecutan por capas, descritas en [docs/qa-gate.md](../qa-gate.md): apunta tu
clon a los hooks compartidos con `git config core.hooksPath .githooks` y un suelo rápido se ejecutará
antes de que nada salga de tu máquina.

Para los comandos del servidor consulta [Desarrolla en línea](#develop-online-with-hot-reload) más arriba,
[CONTRIBUTING.md](CONTRIBUTING.es_ES.md) para el flujo de contribución, el
[tutorial del SFX Studio](../sfx-studio-tutorial.md) para la creación de sonido y
la exportación de artefactos, [DEPLOY.md](../../DEPLOY.md) para producción y
[CREDITS.md](../../CREDITS.md) para las licencias de los recursos.

## Localización

Cada cadena visible para el jugador se resuelve a través de `t()`, y el juego se distribuye en **22 idiomas** (inglés, dos españoles, dos franceses, inglés de Canadá, italiano, alemán, chino simplificado y tradicional, coreano, japonés, portugués de Brasil, ruso, checo, neerlandés, polaco, indonesio, turco, sueco, vietnamita y danés). El sim y el servidor se mantienen agnósticos respecto al idioma: emiten claves estables o inglés que el cliente vuelve a localizar en la frontera, lo que mantiene intacto el determinismo. Los colaboradores añaden solo inglés; el mantenedor rellena por lotes los demás idiomas antes de cada lanzamiento. El flujo de trabajo está documentado en `docs/i18n-scaling/translation-workflow.md`.

## Contribuir

Las contribuciones de todo tipo son bienvenidas: código, traducciones, informes de errores y documentación. Empieza con [CONTRIBUTING.md](CONTRIBUTING.es_ES.md) para la configuración, lee el [Código de conducta](../../CODE_OF_CONDUCT.md) y consulta [SECURITY.md](../../SECURITY.md) antes de informar de una vulnerabilidad. ¿Nuevo por aquí? Busca incidencias etiquetadas como [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), abre una [incidencia](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) o saluda en [Discord](https://discord.com/invite/worldofclaudecraft).

El desarrollo activo transcurre en la rama `release/vX.Y.Z` más reciente. Búscala en lugar de darla por supuesta, crea tu rama a partir de ella y dirige ahí tu pull request. Nunca ramifiques desde `main` ni lo pongas como destino, ya que solo recibe una rama de versión cuando esa versión se publica. [CONTRIBUTING.md](CONTRIBUTING.es_ES.md) tiene el comando de una línea que encuentra la actual.

## Licencia

**El código tiene [licencia MIT](../../LICENSE), así que bifúrcalo, remézclalo y aloja tu propio mundo.** De eso se trata, y nada más de esta página ni de nuestro sitio web se lo lleva de vuelta.

Tres cosas tienen licencia aparte, así que merece la pena dedicar treinta segundos a saber cuál es cuál:

| Qué | Licencia | ¿Puedes redistribuirlo? |
|---|---|---|
| **Código fuente**, es decir todo él salvo los recursos multimedia excluidos más abajo | [MIT](../../LICENSE) | Sí. También comercialmente. |
| **Recursos multimedia**: modelos, texturas, HDRIs, iconos, sonidos, tipografías (en su mayoría bajo `public/`) | Por recurso, registrado en [CREDITS.md](../../CREDITS.md) | En su mayoría sí (casi todos son CC0). Algunos no, mira más abajo. |
| **Nombre y marca**: "World of ClaudeCraft", "Levy Street", los logotipos | Sin licencia | No. |

**Bifúrcalo y aloja tu propio mundo. Eso funciona, y los recursos no te lo impiden.** Casi todo lo que ves es de dominio público CC0 (KayKit, Quaternius, Kenney, ambientCG, Poly Haven), y nuestros propios props, criaturas, fondos y sonidos de interfaz generados vienen con el proyecto, así que un fork funciona nada más clonarlo. Lo único que no puedes es sacarlos de ahí y venderlos como arte independiente.

Lo que tendrías que quitar o sustituir antes de redistribuir:

- los **iconos de habilidades de clase de CraftPix** bajo `public/ui/skills/` los compró Levy Street y **no se pueden redistribuir**, así que compra tu propia licencia si quieres distribuirlos;
- los **efectos de sonido de @jamiecypher** son CC BY-NC 4.0, así que compártelos sin fines comerciales y con atribución, pero la concesión comercial alcanza solo a este proyecto;
- el **arte de tienda y prestigio** (Season 1 Armory, el conjunto de Claudium, el conjunto artístico de profesiones, los iconos del Book of Deeds, el emblema del dragón de élite) es arte comercial encargado y **todos los derechos están reservados**;
- las **marcas de terceros** (Twitch, X, Kick, YouTube, Discord, Solana, USDC) son marcas registradas de sus propietarios y no nos corresponde licenciarlas;
- un puñado de **iconos y grabaciones usados con permiso** necesitan permiso para cederse.

[CREDITS.md](../../CREDITS.md) es la lista autorizada, con una columna de redistribución por recurso. Cuando un recurso figura ahí, esa licencia prevalece sobre la licencia MIT del proyecto. Ese registro aún se está completando, así que un recurso multimedia que falte en él está sin registrar, no es libre: pregunta antes de depender de él. Con el código fuente ocurre lo contrario, y todo lo que no esté excluido es MIT.

Nuestros [Términos del servicio](https://worldofclaudecraft.com/terms) cubren el juego alojado que gestionamos en worldofclaudecraft.com: cuentas, conducta, objetos virtuales. No restringen los derechos que la licencia MIT te otorga sobre este código fuente.
