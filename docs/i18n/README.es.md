<div align="center">

# World of ClaudeCraft

**Haz misiones, forma grupo e incursiona en un mundo hecho a mano, gratis en tu navegador. De código abierto, web3 y en línea ahora mismo.**

**Sitio web oficial: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.27.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.es.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.com/invite/worldofclaudecraft)

[English](../../README.md) · **Español** · [Español (España)](README.es_ES.md) · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Jugar ahora](https://worldofclaudecraft.com/) · [Aloja tu propio mundo](#host-your-own-world-one-command) · [Entrena un agente](#train-an-agent-headless-rl) · [Web3](#web3) · [Contribuir](CONTRIBUTING.es.md) · [Discord](https://discord.com/invite/worldofclaudecraft)

![Pantalla de título de World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## ¿Qué es esto?

World of ClaudeCraft es un MMO completo de la era clásica que puedes jugar ahora mismo en tu navegador, alojar tú mismo con un solo comando e incluso usar para entrenar agentes de IA que aprendan a jugar. Es gratis, de código abierto y está en línea en [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Un mismo mundo compartido corre en tres lugares, todos desde el mismo núcleo de juego:

- el **mundo offline del navegador**, donde haces clic en Play Offline y ya estás dentro,
- el **servidor multijugador autoritativo**, donde las cuentas respaldadas por Postgres comparten un mundo en vivo,
- el **entorno de RL headless**, donde Python controla el juego real a través de una interfaz Gym.

Misma semilla, mismo mundo, en todas partes. Y casi nada es un recurso prefabricado: los pueblos, las criaturas, los iconos de hechizos y el sonido se generan todos en tiempo de ejecución.

## Lo destacado

- **Nueve clases clásicas**, cada una con un kit auténtico al estilo vanilla que gana rangos a medida que subes de nivel, más un **sistema de talentos** completo (tres especializaciones por clase, 27 especializaciones en total).
- **Tres zonas de mundo abierto** del nivel 1 al 20, casi 80 misiones y una sola línea argumental conectada sobre la conspiración de los Gravecaller.
- **Cinco mazmorras instanciadas**, cuatro de ellas incursiones de élite para cinco jugadores y una cripta en solitario, con escalado de élites, mecánicas de jefe de área y botín según el arquetipo de clase.
- **Delves escalables**, un modo de grupo pequeño para uno o dos jugadores más un compañero de IA, reconstruidos a partir de cámaras aleatorias en cada partida entre los niveles Normal y Heroico.
- **The Ashen Coliseum**, una arena de PvP clasificatorio con escalas de 1v1 y 2v2 más un modo Fiesta 2v2 (mejoras recogibles, un anillo que se reduce, el primero en llegar a quince derribos).
- **Multijugador real**: grupos, intercambio, duelos, derechos de botín, XP repartida en grupo, susurros, estado de ausencia y un servidor que es dueño de cada tirada de combate.
- **Todo procedimental**: pueblos con entramado de madera, familias de criaturas con esqueleto animado, iconos de hechizos pintados en canvas, sonido WebAudio, clima por bioma y sombras en tiempo real. Sin archivos de modelos 3D para el mundo.
- **Localizado en 21 idiomas** mediante una canalización determinista en la que la sim emite claves.
- **Entorno de RL headless** con enlaces de Gymnasium, modelado de recompensas y un modo de benchmark.
- **Nativo de web3**: vincula una cartera de Solana para mostrar tu saldo de $WOC y una insignia cosmética de poseedor, totalmente opcional y no custodial.

## Capturas

![Un grupo se reúne frente a la botica en Eastbrook](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Anochecer en la fogata de Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Anochecer en la fogata de Eastbrook* | ![Pulls de élite en the Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Pulls de élite a la luz de las antorchas en the Hollow Crypt* |
| ![Los muertos inquietos en la capilla en ruinas](../../docs/screenshots/restless-dead.jpg)<br>*Los muertos inquietos en la capilla en ruinas* | ![Una refriega con los Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*En inferioridad numérica en el campamento de bandidos* |
| ![Old Greyjaw cazado en el camino del norte](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, el spawn raro, abatido en el camino del norte* | ![Interfaz de vendedor y bolsas](../../docs/screenshots/vendor-and-bags.jpg)<br>*Equipándose en lo de Smith Haldren, con tooltips, bolsas y monedas* |
| ![El portal lunar en la orilla de Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Los ahogados trepan a la superficie en el portal lunar de Glimmermere* | ![Ysolei en el altar de the Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Moonfire y el altar de the Drowned Temple* |

El clima está impulsado por el bioma y es solo de renderizado, así que nunca toca la sim determinista:

| | | |
|:---:|:---:|:---:|
| ![Cielos despejados sobre Eastbrook Vale](../../docs/screenshots/weather-vale_clear.jpg)<br>*Despejado sobre el Vale* | ![Lluvia sobre Mirefen Marsh](../../docs/screenshots/weather-marsh_rain.jpg)<br>*Lluvia sobre Mirefen Marsh* | ![Nieve en Thornpeak Heights](../../docs/screenshots/weather-peaks_snow.jpg)<br>*Nieve en Thornpeak Heights* |

## Juégalo

Tienes dos formas de entrar, y ambas ejecutan el mismo mundo.

### Offline, en tu navegador

```bash
npm install
npm run dev        # then open http://localhost:5173 and click Play Offline
```

Ponle nombre a tu personaje, elige cualquiera de las nueve clases y comienzas en **Eastbrook Vale** (niveles 1-7), un pueblo de mercado rodeado por seis enclaves: senderos de lobos al norte, praderas de jabalíes al este, el Webwood al oeste, Mirror Lake al noroeste, una mina de cobre de kobolds al suroeste y una capilla en ruinas de muertos inquietos al noreste, con el campamento de bandidos de Gorrak al sureste. El camino del norte sube por un paso de montaña hacia **Mirefen Marsh** (6-13, enclave Fenbridge) y más arriba hasta **Thornpeak Heights** (13-20, enclave Highwatch). La semilla del mundo está fijada en `src/main.ts`, así que es el mismo lugar en cada visita.

### En línea, con otros jugadores

Consulta [Aloja tu propio mundo](#host-your-own-world-one-command) más abajo para levantar el juego cliente/servidor real con cuentas y personajes persistentes.

<a id="host-your-own-world-one-command"></a>

## Aloja tu propio mundo (un solo comando)

```bash
cp .env.example .env
# edit .env and set a long random POSTGRES_PASSWORD
docker compose up -d --build     # postgres + game server, fully built
# open http://localhost:8787 for accounts, characters, and the whole world
```

Para **alojamiento remoto**, coloca el stack de compose en cualquier VPS, define un `POSTGRES_PASSWORD` real en el entorno y pon el puerto 8787 detrás de un proxy inverso con TLS. Caddy hace esto en dos líneas (`your.domain { reverse_proxy localhost:8787 }`); los WebSockets se enrutan por proxy automáticamente y el cliente selecciona por su cuenta `wss://` en páginas https. Los endpoints de autenticación tienen límite de tasa por IP, las contraseñas se cifran con scrypt y los tokens expiran tras 7 días. Nunca definas `ALLOW_DEV_COMMANDS=1` en producción, ya que habilita los trucos de nivel y teletransporte que usan los bots de prueba. Consulta [DEPLOY.md](../../DEPLOY.md) para la guía completa de producción.

<a id="develop-online-with-hot-reload"></a>

### Desarrolla en línea con recarga en caliente

```bash
npm install
cp .env.example .env
# set POSTGRES_PASSWORD and point DATABASE_URL at the same password
npm run db:up        # postgres 16 in docker (port 5433, volume-persisted)
npm run server       # authoritative game server on :8787 (REST + WebSocket)
npm run dev          # client dev server on :5173 (proxies /api and /ws)
```

Abre http://localhost:5173, elige **Play Online**, crea una cuenta, crea un personaje y entra con Enter World. Abre una segunda pestaña e inicia sesión de nuevo para verse el uno al otro en el pueblo. `Enter` abre el chat. Junto al stack de Docker Compose se levanta una wiki real de jugadores con MediaWiki en http://localhost:8080/wiki/; sus páginas iniciales se generan a partir del contenido actual del juego con `npm run wiki:seed`.

Qué persiste y cómo el servidor mantiene el control:

- **Cuentas**: contraseñas cifradas con scrypt y tokens bearer de 7 días (`auth_tokens`).
- **Personajes**: hasta 10 por cuenta; nivel, equipo, bolsas, misiones, talentos, posición y dinero persisten como JSONB en Postgres, guardados cada 30 segundos, al cerrar sesión y al apagar el servidor. Los nombres son globalmente únicos, solo letras, al estilo clásico.
- **El servidor es autoritativo**: los clientes transmiten intención de movimiento y comandos a 20 Hz; el servidor ejecuta la única `Sim` compartida y devuelve snapshots delimitados por interés (~120 yd) más eventos por jugador. Cada tirada de combate, caída de botín, crédito de misión y transacción con vendedor se resuelve en el servidor. El cliente es un renderizador.

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

env = WoWClassicEnv(player_class="warrior")   # warrior or mage
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **Los espacios de observación y acción se derivan del contenido.** Consúltalos desde la respuesta `info` del entorno al inicio en lugar de codificarlos a mano; crecen con el juego. Hoy el espacio de acción es `Discrete(44)` (movimiento, objetivo, ataque, el kit completo de habilidades, interactuar, comer/beber) y la observación es una `Box` de 276 flotantes (uno mismo, habilidades, objetivo, mobs cercanos, interactuable más cercano, progreso de misiones).
- **La recompensa** es una suma ponderada de deltas de contadores por tick (XP, daño infligido y recibido, muertes propias y ajenas, progreso de misiones, subidas de nivel), ajustable en cada reset. Cada `step` aplica una acción y avanza cinco ticks de sim por defecto, así que aproximadamente cuatro decisiones por segundo simulado.
- **Determinista por construcción.** Sin reloj de pared, sin `Math.random`. Siembra el reset y el episodio se repite exactamente igual.

El protocolo y los enlaces están documentados en `headless/CLAUDE.md` y `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft es nativo de web3 en torno a **$WOC**, nuestro token comunitario en Solana. Conecta una cartera de Solana, vincúlala a tu cuenta con una sola firma (no custodial, sin transacción que aprobar), y tu saldo de $WOC de solo lectura aparece en el HUD junto a una insignia cosmética de nivel de poseedor.

Es solo cosmética y no hace falta para jugar. Nada se gasta ni se gana dentro del juego, no hay pago para ganar, y todo el juego funciona perfectamente sin conectar jamás una cartera.

**Dirección del contrato de $WOC (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Más sobre el token en [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Un recorrido por el mundo

### Las nueve clases

Cada clase usa mecánicas auténticas al estilo vanilla y aprende hechizos por rangos a lo largo de los niveles 1-20 (Lightning Bolt R2 al 8, R3 al 14, R4 al 20, con habilidades de banda alta como Execute, Kidney Shot, Flash Heal, Stormstrike y Starfire que llegan en su nivel clásico).

- **Warrior**: ira, Heroic Strike (al siguiente golpe, fuera del GCD), Battle Shout, Charge, Rend, Thunder Clap, Hamstring, Bloodrage, Overpower (proc por esquivar).
- **Paladin**: Seal of Righteousness desatado por Judgement, Holy Light, Devotion Aura, Blessing of Might, Divine Protection (absorción), Hammer of Justice (aturdimiento), Lay on Hands.
- **Hunter**: Auto Shot a distancia (8-35 yd con la zona muerta clásica), Raptor Strike, Aspect of the Hawk, Serpent Sting, Arcane Shot, Concussive Shot, Mongoose Bite, Wing Clip y una mascota domesticable desde el nivel 10.
- **Rogue**: energía y puntos de combo, Sinister Strike, Eviscerate, Backstab (por la espalda, con daga), Gouge, Evasion, Slice and Dice, Sprint.
- **Priest**: Smite, Lesser Heal, Power Word: Fortitude, Shadow Word: Pain, Power Word: Shield (absorción), Renew (HoT), Mind Blast.
- **Shaman**: Lightning Bolt, Rockbiter Weapon (imbuir), Healing Wave, Earth Shock, Lightning Shield (espinas), Flame Shock.
- **Mage**: Fireball, Frost Armor, Arcane Intellect, Frostbolt, Conjure Water, Fire Blast, Arcane Missiles (canalizado), Polymorph, Frost Nova.
- **Warlock**: Shadow Bolt, Demon Skin, Immolate, Corruption, Life Tap, Curse of Agony, Drain Life y siete demonios invocables desde el Imp hasta el Doomguard.
- **Druid**: Wrath, Healing Touch, Mark of the Wild, Moonfire, Rejuvenation, Thorns, Entangling Roots, Bear Form al 10.

Las curaciones y mejoras alcanzan a los miembros del grupo, la sanación puede dar crítico y los escudos de absorción aguantan el daño antes que la vida. Gasta puntos en **tres especializaciones de talentos por clase** (Arms/Fury/Protection, Balance/Feral/Restoration, y demás); la asignación se valida en el servidor y se puede exportar como cadena de build.

### Mazmorras

La línea argumental de los Gravecaller transcurre a través de cuatro instancias de élite para cinco jugadores, y una cripta en solitario queda a un lado para los exploradores.

- **The Hollow Crypt** (5 jugadores) bajo la Fallen Chapel: basura de élite en parejas, el minijefe Sexton Marrow y Morthen the Gravecaller, que suelta un Shadow Pulse de área cada diez segundos. La puerta de la cripta teletransporta a tu grupo a una copia privada de la instancia que se reinicia tras cinco minutos vacía.
- **The Sunken Bastion** (5 jugadores, alrededor del nivel 13, sureste de Mirefen): Vael the Mistcaller invoca oleadas de Drowned Thralls al 60% y al 30% de vida.
- **Gravewyrm Sanctum** (5 jugadores, nivel 20, bajo Thornpeak): tres cámaras de guardiahuesos de élite y drakonids, Korgath the Bound (entra en furia por debajo del 30%), Grand Necromancer Velkhar y Korzul the Gravewyrm, donde caen armas épicas.
- **The Drowned Temple** (5 jugadores) a través del portal lunar de Glimmermere: una instancia pálida de color violeta lunar que conduce a Choirmother Selthe y luego a Ysolei, Avatar of the Drowned Moon, que pulsa Lunar Tide cada nueve segundos e invoca Moonspawn al 60% y al 30%.
- **The Abandoned Crypt** (en solitario) en Thornpeak: una inmersión tranquila de llave maestra y diario para una persona, cuyo rastro abre la puerta real hacia **Nythraxis, Scourge of Thornpeak**, un final de incursión para diez jugadores que se libra a lo largo de tres piedras de guardia de almas.

Las cadenas de misiones previas se pueden hacer en solitario, así que la historia nunca queda bloqueada tras encontrar grupo. Nuestra incursión automatizada de cinco bots (warrior, paladin, priest, mage, hunter con fuego concentrado e IA de sanador) limpia the Hollow Crypt en unos cinco minutos (`node scripts/crypt_raid.mjs`, requiere `ALLOW_DEV_COMMANDS=1`).

### Delves

Los delves son un modo aparte, escalable y de grupo pequeño para uno o dos jugadores. **The Collapsed Reliquary** (nivel 7 en adelante) es una cripta reconstruida a partir de cámaras aleatorias en cada partida, que termina en Deacon Varric. Hazla en solitario y una compañera de IA, Tessa, lucha a tu lado. Brother Halven, en la ruina del relicario, lleva el tablero de delves, donde Normal o Heroico es tu elección: el Heroico sube los niveles de los enemigos y agrega un afijo aleatorio para recompensas más ricas.

### The Ashen Coliseum (PvP clasificatorio)

Pulsa `G` o el botón de arena para entrar en cola. El emparejamiento teletransporta a los luchadores a un foso privado iluminado por antorchas, una cuenta atrás corta sana y reinicia a todos para un comienzo justo, y el combate termina cuando un bando se rinde con 1 hp. Nadie muere, y vuelves exactamente donde entraste en cola.

- **Escalas clasificatorias de 1v1 y 2v2**, cada una con una puntuación persistente al estilo Elo (todos empiezan en 1500) y una tabla de clasificación de todos los tiempos (`GET /api/arena/leaderboard`).
- **Fiesta 2v2**, un modo de grupo más animado: el primer equipo en llegar a quince derribos gana dentro de un límite de seis minutos, los jugadores reaparecen con temporizadores crecientes, las mejoras recogibles reparten poder a lo largo de tres oleadas y un anillo que se cierra fuerza la pelea.

### Jugando juntos

- **Grupos** de hasta 5: haz clic derecho en un jugador e Invitar al grupo. Los miembros comparten derechos de botín y crédito de misiones, reparten XP con las bonificaciones de grupo vanilla reales (1.166 / 1.3 / 1.43 para 3/4/5) y aparecen como puntos en el minimapa. `/p` para el chat de grupo, `/roll` para repartir el botín.
- **Intercambio**: clic derecho e Intercambiar. Ambos lados colocan objetos y dinero, ambos deben aceptar, y el intercambio es atómico y validado en el servidor. Los objetos de misión no se pueden intercambiar, y alejarse lo cancela.
- **Duelos**: clic derecho y Desafiar a un duelo. Una cuenta atrás de 3 segundos, luego se pelea hasta que un bando llega a 1 hp; el ganador se anuncia en toda la zona y alejarse corriendo 60 yardas significa rendirse.
- **Derechos de botín y estado de ausencia**: el primer jugador en dañar a un mob es dueño de su botín, XP y crédito de misión; `/afk` y `/dnd` te marcan como ausente con una respuesta automática a los susurros.

### Mundo y sistemas

- **Comer y beber**: siéntate para recuperarte durante 18 segundos, interrumpido por daño o por levantarte, y sí, puedes comer y beber a la vez.
- **Vendedores** que compran comida y agua y venden equipo blanco honesto, con las monedas mostradas en oro, plata y cobre.
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
| `C` `P` `L` `M` `B` `G` | personaje, libro de hechizos, registro de misiones, mapa del mundo, bolsas, arena |
| `V` / `R` / `Esc` | placas de nombre, autocorrer, cerrar ventanas o limpiar objetivo |

Los controles táctiles (un stick de movimiento, arrastre de cámara y botones de acción en pantalla) aparecen automáticamente en móvil.

## Arquitectura (una sim, tres anfitriones)

Tres ideas mantienen unido al proyecto:

- **Una sim, tres anfitriones.** El mismo código de `src/sim/` corre el mundo offline del navegador, el servidor en línea y el entorno de RL. El comportamiento debe ser idéntico en todas partes, y las pruebas existen para mantenerlo así.
- **`IWorld` es la única costura.** `src/world_api.ts` define `IWorld`. La `Sim` offline lo satisface estructuralmente y la `ClientWorld` en línea lo implementa reflejando los snapshots del servidor. El renderizador y el HUD hablan solo con `IWorld`, nunca con un mundo concreto, así que una nueva funcionalidad primero extiende la interfaz y luego ambos mundos.
- **El servidor es autoritativo.** Los clientes envían intención; el servidor decide los resultados. El cliente nunca resuelve combate, botín ni economía por su cuenta.

La sim es un tick fijo de 20 Hz (`DT = 1/20`), toda la aleatoriedad fluye a través de un único `Rng` sembrado, y `src/sim/` no acarrea ningún import de DOM, navegador ni Three.js. Eso es lo que permite que el mismo código se empaquete en un servidor de entorno Node, en un bucle de juego autoritativo y en una pestaña de navegador sin cambiar una sola línea.

### Disposición del proyecto

| Ruta | Qué es |
|---|---|
| `src/sim/` | Núcleo determinista del juego, la fuente de verdad. Sin dependencias de DOM ni Three. |
| `src/sim/content/` | Datos como código: las nueve clases, habilidades, zonas, mazmorras, objetos, talentos. |
| `src/render/` | Renderizador Three.js (geometría, texturas y VFX procedimentales). Lee el mundo, nunca lo muta. |
| `src/game/` | Entrada local, cámara, atajos de teclado, controles móviles, WebAudio procedimental. |
| `src/ui/` | HUD clásico (marcos, ventanas, tooltips, mapa, texto de combate flotante), iconos procedimentales, i18n. |
| `src/net/` | Cliente en línea: autenticación REST más un espejo del mundo por WebSocket (`ClientWorld`). |
| `src/admin/` | SPA del panel de administración (entrada `admin.html` separada). |
| `server/` | Servidor autoritativo: HTTP y WS, bucle del mundo, Postgres, autenticación, social, moderación. |
| `headless/` + `python/` | Servidor del entorno de RL (`env_server.ts`) y enlaces de Python para Gym. |
| `tests/` | Suite de Vitest. |
| `scripts/` | Build de recursos más scripts de E2E en navegador, capturas e integración. |
| `public/` · `docs/` | Recursos estáticos (modelos GLB, texturas, HDRIs) y documentos de diseño. |

La mayoría de los directorios llevan su propio `CLAUDE.md` con convenciones locales. El conjunto completo de invariantes del proyecto vive en el [`CLAUDE.md`](../../CLAUDE.md) raíz.

## Construido como los clásicos

El combate, la subida de nivel y la amenaza corren todos sobre reglas auténticas de la era clásica: ira y energía, tablas de impacto y esquiva, mitigación por armadura, la curva de XP real, los temporizadores de golpe y el enfriamiento global. Se siente como lo recuerdas en lugar de aproximarlo. Los números exactos viven en `src/sim/` si quieres leerlos.

Y casi nada de ello es un recurso prefabricado. El mundo se dibuja desde el código:

- Pueblos, criaturas, terreno, agua, clima y sombras en tiempo real procedimentales, sin archivos de modelos 3D para el mundo.
- Doce familias de criaturas con esqueleto animado y animaciones completas de caminar, atacar, lanzar, sentarse y morir.
- Iconos de hechizos, objetos y mejoras pintados en canvas en tiempo de ejecución.
- Un HUD clásico completo (marcos de unidad, barras de acción, tooltips, registro de misiones, mapa del mundo, minimapa, texto de combate flotante) y WebAudio procedimental para cada sonido.

## Desarrollo

```bash
npm test                        # vitest: formulas, combat, AI, quests, all 9 classes, parties, duels, trades, dungeons
npm run build                   # production web build
node scripts/smoke_browser.mjs  # warrior end-to-end (needs npm run dev)
node scripts/smoke_mage.mjs     # mage: casting, polymorph, conjure and drink, death and release
node scripts/visual_tour.mjs    # screenshot tour of the zone and UI into tmp/
node scripts/tour_temple.mjs    # screenshot tour of the Glimmermere and Drowned Temple into tmp/
node scripts/mp_integration.mjs # API, WS, and persistence checks (server running)
node scripts/social_e2e.mjs     # trade and duel over the wire (ALLOW_DEV_COMMANDS=1)
node scripts/arena_visual.mjs   # two clients queue and fight a ranked 1v1
node scripts/crypt_raid.mjs     # five bots clear the Hollow Crypt (ALLOW_DEV_COMMANDS=1)
```

Las pruebas de lógica y unitarias usan Vitest. Mientras iteras, ejecuta un solo archivo: `npx vitest run tests/sim.test.ts`. Los scripts de E2E y visuales controlan navegadores reales mediante `puppeteer-core` y necesitan `npm run dev` en ejecución (a menudo también `npm run server`). Los agentes de navegador pueden controlar el movimiento a través de `window.__game.controller` en lugar de simular teclas presionadas, por ejemplo `controller.move({ forward: true }, facingRadians)` o banderas compactas como `{ f: 1, sr: 1 }`.

Para los comandos del servidor consulta [Desarrolla en línea](#develop-online-with-hot-reload) más arriba, [DEPLOY.md](../../DEPLOY.md) para producción y [CREDITS.md](../../CREDITS.md) para las licencias de los recursos.

## Localización

Cada cadena visible para el jugador se resuelve a través de `t()`, y el juego se distribuye en **21 idiomas** (inglés, dos variantes de español, dos de francés, inglés de Canadá, italiano, alemán, chino simplificado y tradicional, coreano, japonés, portugués de Brasil, ruso, neerlandés, polaco, indonesio, turco, sueco, vietnamita y danés). La sim y el servidor se mantienen agnósticos al idioma: emiten claves estables o inglés que el cliente vuelve a localizar en la frontera, lo que mantiene intacta la determinación. Los contribuyentes agregan solo inglés; el mantenedor rellena en lote los demás idiomas antes de cada lanzamiento. El flujo de trabajo está documentado en `docs/i18n-scaling/translation-workflow.md`.

## Contribuir

Las contribuciones de todo tipo son bienvenidas: código, traducciones, reportes de errores y documentación. Empieza con [CONTRIBUTING.md](CONTRIBUTING.es.md) para la configuración, lee el [Código de Conducta](../../CODE_OF_CONDUCT.md) y revisa [SECURITY.md](../../SECURITY.md) antes de reportar una vulnerabilidad. ¿Nuevo por aquí? Busca issues etiquetados como [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), abre un [issue](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) o saluda en [Discord](https://discord.com/invite/worldofclaudecraft).

<div align="center">

![World of Claude](../../worldofclaude.png)

![Comunidad de World of ClaudeCraft](../../woc_community.png)

</div>

## Licencia

El código tiene [licencia MIT](../../LICENSE), así que bifúrcalo, remézclalo y aloja tu propio mundo.

Los recursos artísticos de terceros incluidos (modelos, texturas, HDRIs) conservan sus propias licencias, todas de dominio público CC0 salvo los mapas de normales de agua con licencia MIT, documentados por paquete en [CREDITS.md](../../CREDITS.md).
