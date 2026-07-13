<div align="center">

# World of ClaudeCraft

**Completa misiones, forma grupos y haz incursiones en un mundo hecho a mano, gratis en tu navegador. De código abierto, web3 y en línea ahora mismo.**

**Sitio web oficial: https://worldofclaudecraft.com/**

[![CI](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/levy-street/world-of-claudecraft/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r165-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4.1-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Gymnasium](https://img.shields.io/badge/Gymnasium-RL%20env-0C7BDC)](https://gymnasium.farama.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Version](https://img.shields.io/badge/version-0.25.0-blue)](../../package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.es_ES.md)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/GjhnUsBtw)

[English](../../README.md) · [Español](README.es.md) · **Español (España)** · [Français](README.fr_FR.md) · [Français (Canada)](README.fr_CA.md) · [Italiano](README.it_IT.md) · [Deutsch](README.de_DE.md) · [简体中文](README.zh_CN.md) · [繁體中文](README.zh_TW.md) · [한국어](README.ko_KR.md) · [日本語](README.ja_JP.md) · [Português (Brasil)](README.pt_BR.md) · [Русский](README.ru_RU.md) · [Nederlands](README.nl_NL.md) · [Polski](README.pl_PL.md) · [Bahasa Indonesia](README.id_ID.md) · [Türkçe](README.tr_TR.md) · [Svenska](README.sv_SE.md) · [Tiếng Việt](README.vi_VN.md) · [Dansk](README.da_DK.md)

[Jugar ahora](https://worldofclaudecraft.com/) · [Aloja tu propio mundo](#host-your-own-world-one-command) · [Entrena un agente](#train-an-agent-headless-rl) · [Web3](#web3) · [Contribuir](CONTRIBUTING.es_ES.md) · [Discord](https://discord.gg/GjhnUsBtw)

![Pantalla de título de World of ClaudeCraft](../../docs/screenshots/title-screen.jpg)

</div>

## Qué es esto

World of ClaudeCraft es un MMO completo de la era clásica que puedes jugar ahora mismo en tu navegador, alojar tú mismo con un solo comando e incluso usar para entrenar agentes de IA que aprendan a jugar. Es gratis, de código abierto y está en línea en [worldofclaudecraft.com](https://worldofclaudecraft.com/).

Un mismo mundo compartido se ejecuta en tres lugares, todos a partir del mismo núcleo de juego:

- el **mundo offline en el navegador**, donde haces clic en Play Offline y ya estás dentro,
- el **servidor multijugador autoritativo**, donde cuentas respaldadas por Postgres comparten un mundo en vivo,
- el **entorno de RL sin interfaz**, donde Python maneja el juego real a través de una interfaz Gym.

Misma semilla, mismo mundo, en todas partes. Y casi nada es un recurso prefabricado: los pueblos, las criaturas, los iconos de hechizos y el sonido se generan todos en tiempo de ejecución.

## Lo destacado

- **Nueve clases clásicas**, cada una con un auténtico repertorio al estilo vanilla que gana rangos a medida que subes de nivel, más un completo **sistema de talentos** (tres especializaciones por clase, 27 especializaciones en total).
- **Tres zonas de mundo abierto** del nivel 1 al 20, casi 80 misiones y una única historia conectada sobre la conspiración del Gravecaller.
- **Cinco mazmorras instanciadas**, cuatro de ellas incursiones de élite para cinco jugadores y una cripta en solitario, con escalado de élite, mecánicas de jefe en área y botín por arquetipo de clase.
- **Delves escalables**, un modo para grupos pequeños de uno o dos jugadores más un compañero de IA, reconstruidos a partir de cámaras aleatorias en cada partida entre los niveles Normal y Heroico.
- **El Ashen Coliseum**, una arena PvP clasificatoria con escaleras 1v1 y 2v2 más un modo 2v2 Fiesta (recogidas de mejoras, un anillo que se encoge, el primero en lograr quince derribos).
- **Multijugador de verdad**: grupos, intercambios, duelos, derechos de botín, XP repartida en grupo, susurros, estado de ausencia y un servidor que posee cada tirada de combate.
- **Todo procedimental**: pueblos con entramado de madera, familias de criaturas con esqueleto, iconos de hechizos pintados en canvas, sonido WebAudio, clima por bioma y sombras en tiempo real. Sin archivos de modelos 3D para el mundo.
- **Localizado en 21 idiomas** mediante una canalización determinista en la que el sim emite claves.
- **Entorno de RL sin interfaz** con enlaces de Gymnasium, modelado de recompensas y un modo de benchmark.
- **Nativo de web3**: vincula una cartera de Solana para mostrar tu saldo de $WOC y una insignia cosmética de poseedor, totalmente opcional y sin custodia.

## Capturas

![Un grupo se reúne fuera del boticario en Eastbrook](../../docs/screenshots/party-questing.jpg)

| | |
|:---:|:---:|
| ![Anochecer junto a la hoguera de Eastbrook](../../docs/screenshots/eastbrook-dusk.jpg)<br>*Anochecer junto a la hoguera de Eastbrook* | ![Pulls de élite en la Hollow Crypt](../../docs/screenshots/hollow-crypt.jpg)<br>*Pulls de élite a la luz de las antorchas en la Hollow Crypt* |
| ![Los muertos inquietos en la capilla en ruinas](../../docs/screenshots/restless-dead.jpg)<br>*Los muertos inquietos en la capilla en ruinas* | ![Una refriega con los Vale Bandits](../../docs/screenshots/vale-bandits.jpg)<br>*Superados en número en el campamento de bandidos* |
| ![Old Greyjaw acorralado en el camino del norte](../../docs/screenshots/old-greyjaw.jpg)<br>*Old Greyjaw, el spawn raro, acorralado en el camino del norte* | ![Interfaz de vendedor y bolsas](../../docs/screenshots/vendor-and-bags.jpg)<br>*Equipándote en la tienda de Smith Haldren, con descripciones, bolsas y monedas* |
| ![El portal lunar en la orilla de Glimmermere](../../docs/screenshots/glimmermere-moongate.jpg)<br>*Los ahogados salen del agua en el portal lunar de Glimmermere* | ![Ysolei en el altar del Drowned Temple](../../docs/screenshots/drowned-temple-altar.jpg)<br>*Fuego lunar y el altar del Drowned Temple* |

El clima está impulsado por el bioma y es solo de renderizado, así que nunca toca el sim determinista:

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

Pon nombre a tu personaje, elige cualquiera de las nueve clases y empezarás en **Eastbrook Vale** (niveles 1-7), un pueblo mercado rodeado por seis enclaves: senderos de lobos al norte, praderas de jabalíes al este, el Webwood al oeste, Mirror Lake al noroeste, una mina de cobre de kobolds al suroeste y una capilla en ruinas de muertos inquietos al noreste, con el campamento de bandidos de Gorrak al sureste. El camino del norte asciende por un paso de montaña hasta **Mirefen Marsh** (6-13, enclave Fenbridge) y sigue hacia arriba hasta **Thornpeak Heights** (13-20, enclave Highwatch). La semilla del mundo está fijada en `src/main.ts`, así que es el mismo lugar en cada visita.

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

Para **alojamiento remoto**, pon la pila de compose en cualquier VPS, define un `POSTGRES_PASSWORD` real en el entorno y coloca delante del puerto 8787 un proxy inverso con TLS. Caddy lo resuelve en dos líneas (`your.domain { reverse_proxy localhost:8787 }`); los WebSockets se redirigen automáticamente y el cliente selecciona `wss://` por su cuenta en páginas https. Los endpoints de autenticación tienen límite de tasa por IP, las contraseñas se cifran con scrypt y los tokens caducan tras 7 días. Nunca pongas `ALLOW_DEV_COMMANDS=1` en producción, ya que activa los trucos de nivel y teletransporte que usan los bots de prueba. Consulta [DEPLOY.md](../../DEPLOY.md) para la guía completa de producción.

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

Abre http://localhost:5173, elige **Play Online**, crea una cuenta, crea un personaje y pulsa Enter World. Abre una segunda pestaña e inicia sesión de nuevo para veros el uno al otro en el pueblo. `Enter` abre el chat. Junto a la pila de Docker Compose se levanta una wiki de jugadores en MediaWiki real en http://localhost:8080/wiki/; sus páginas iniciales se generan a partir del contenido actual del juego con `npm run wiki:seed`.

Qué se conserva y cómo mantiene el servidor el control:

- **Cuentas**: contraseñas cifradas con scrypt y tokens portadores de 7 días (`auth_tokens`).
- **Personajes**: hasta 10 por cuenta; nivel, equipo, bolsas, misiones, talentos, posición y dinero persisten como JSONB en Postgres, guardados cada 30 segundos, al cerrar sesión y al apagar el servidor. Los nombres son globalmente únicos, solo letras, al estilo clásico.
- **El servidor es autoritativo**: los clientes transmiten intención de movimiento y comandos a 20 Hz; el servidor ejecuta el único `Sim` compartido y devuelve instantáneas con alcance de interés (~120 yd) más eventos por jugador. Cada tirada de combate, caída de botín, crédito de misión y transacción con vendedor se resuelve en el lado del servidor. El cliente es un renderizador.

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

env = WoWClassicEnv(player_class="warrior")   # warrior or mage
obs, info = env.reset(seed=42)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())
env.close()
```

- **Los espacios de observación y acción se derivan del contenido.** Consúltalos desde la respuesta `info` del entorno al arrancar en lugar de codificarlos a mano; crecen con el juego. Hoy el espacio de acción es `Discrete(44)` (movimiento, objetivo, ataque, el repertorio completo de habilidades, interactuar, comer/beber) y la observación es un `Box` de 276 floats (uno mismo, habilidades, objetivo, mobs cercanos, el interactuable más cercano, progreso de misiones).
- **La recompensa** es una suma ponderada de deltas de contadores por tick (XP, daño infligido y recibido, muertes propias y ajenas, progreso de misiones, subidas de nivel), ajustable en cada reset. Cada `step` aplica una acción y avanza cinco ticks del sim por defecto, así que aproximadamente cuatro decisiones por segundo simulado.
- **Determinista por construcción.** Sin reloj de pared, sin `Math.random`. Siembra el reset y el episodio se reproduce exactamente igual.

El protocolo y los enlaces están documentados en `headless/CLAUDE.md` y `python/CLAUDE.md`.

<a id="web3"></a>

## Web3

World of ClaudeCraft es nativo de web3 en torno a **$WOC**, nuestro token comunitario en Solana. Conecta una cartera de Solana, vincúlala a tu cuenta con una sola firma (sin custodia, sin transacción que aprobar) y tu saldo de $WOC en modo solo lectura aparecerá en el HUD junto a una insignia cosmética de nivel de poseedor.

Es solo cosmético y no hace falta para jugar. No se gasta ni se gana nada dentro del juego, no hay pago por ganar y todo el juego funciona perfectamente sin conectar jamás una cartera.

**Dirección del contrato de $WOC (Solana):**

```
3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth
```

Más sobre el token en [worldofclaudecraft.com](https://worldofclaudecraft.com/).

## Un recorrido por el mundo

### Las nueve clases

Cada clase usa mecánicas auténticas al estilo vanilla y aprende hechizos por rangos a lo largo de los niveles 1-20 (Lightning Bolt R2 en el 8, R3 en el 14, R4 en el 20, con habilidades de banda alta como Execute, Kidney Shot, Flash Heal, Stormstrike y Starfire que llegan en su nivel clásico).

- **Warrior**: rage, Heroic Strike (en el siguiente golpe, fuera del GCD), Battle Shout, Charge, Rend, Thunder Clap, Hamstring, Bloodrage, Overpower (proc de esquiva).
- **Paladin**: Seal of Righteousness liberado por Judgement, Holy Light, Devotion Aura, Blessing of Might, Divine Protection (absorción), Hammer of Justice (aturdimiento), Lay on Hands.
- **Hunter**: Auto Shot a distancia (8-35 yd con la zona muerta clásica), Raptor Strike, Aspect of the Hawk, Serpent Sting, Arcane Shot, Concussive Shot, Mongoose Bite, Wing Clip y una mascota domable a partir del nivel 10.
- **Rogue**: energía y puntos de combo, Sinister Strike, Eviscerate, Backstab (por detrás, con daga), Gouge, Evasion, Slice and Dice, Sprint.
- **Priest**: Smite, Lesser Heal, Power Word: Fortitude, Shadow Word: Pain, Power Word: Shield (absorción), Renew (HoT), Mind Blast.
- **Shaman**: Lightning Bolt, Rockbiter Weapon (encantamiento), Healing Wave, Earth Shock, Lightning Shield (espinas), Flame Shock.
- **Mage**: Fireball, Frost Armor, Arcane Intellect, Frostbolt, Conjure Water, Fire Blast, Arcane Missiles (canalizado), Polymorph, Frost Nova.
- **Warlock**: Shadow Bolt, Demon Skin, Immolate, Corruption, Life Tap, Curse of Agony, Drain Life y siete demonios invocables desde el Imp hasta el Doomguard.
- **Druid**: Wrath, Healing Touch, Mark of the Wild, Moonfire, Rejuvenation, Thorns, Entangling Roots, Bear Form en el 10.

Las sanaciones y mejoras afectan a los miembros del grupo, la sanación puede ser crítica y los escudos de absorción encajan daño antes que la salud. Reparte puntos entre **tres especializaciones de talento por clase** (Arms/Fury/Protection, Balance/Feral/Restoration, etc.); la asignación se valida en el servidor y se puede exportar como una cadena de build.

### Mazmorras

La historia del Gravecaller transcurre a través de cuatro instancias de élite para cinco jugadores, y una cripta en solitario aparte para los exploradores.

- **The Hollow Crypt** (5 jugadores) bajo la Fallen Chapel: basura de élite emparejada, el minijefe Sexton Marrow y Morthen the Gravecaller, que lanza un Shadow Pulse en área cada diez segundos. La puerta de la cripta teletransporta a tu grupo a una copia privada de la instancia que se reinicia tras cinco minutos vacía.
- **The Sunken Bastion** (5 jugadores, en torno al nivel 13, sureste de Mirefen): Vael the Mistcaller invoca oleadas de Drowned Thralls al 60% y al 30% de salud.
- **Gravewyrm Sanctum** (5 jugadores, nivel 20, bajo Thornpeak): tres cámaras de guardia ósea de élite y drakónidos, Korgath the Bound (enfurece por debajo del 30%), Grand Necromancer Velkhar y Korzul the Gravewyrm, donde caen armas épicas.
- **The Drowned Temple** (5 jugadores) a través del portal lunar de Glimmermere: una instancia pálida de color violeta lunar que conduce a Choirmother Selthe y luego a Ysolei, Avatar of the Drowned Moon, que pulsa Lunar Tide cada nueve segundos e invoca Moonspawn al 60% y al 30%.
- **The Abandoned Crypt** (en solitario) en Thornpeak: un descenso tranquilo de llave maestra y diario para uno solo cuyo rastro abre la puerta real hacia **Nythraxis, Scourge of Thornpeak**, un final de incursión para diez jugadores que se libra a través de tres piedras guardianas de almas.

Las cadenas de misiones previas se pueden completar en solitario, así que la historia nunca queda bloqueada por tener que encontrar grupo. Nuestra incursión automatizada de cinco bots (warrior, paladin, priest, mage, hunter con fuego concentrado e IA de sanador) limpia la Hollow Crypt en unos cinco minutos (`node scripts/crypt_raid.mjs`, requiere `ALLOW_DEV_COMMANDS=1`).

### Delves

Los delves son un modo aparte y escalable para grupos pequeños de uno o dos jugadores. **The Collapsed Reliquary** (nivel 7 en adelante) es una cripta reconstruida a partir de cámaras aleatorias en cada partida, que termina con Deacon Varric. Juégala en solitario y una compañera de IA, Tessa, lucha a tu lado. Brother Halven, en la ruina del relicario, lleva el tablón de delves, donde Normal o Heroico es tu decisión: el Heroico sube los niveles de los enemigos y añade un afijo aleatorio para recompensas más ricas.

### El Ashen Coliseum (PvP clasificatorio)

Pulsa `G` o el botón de arena para entrar en cola. El emparejamiento teletransporta a los luchadores a un foso privado iluminado por antorchas, una breve cuenta atrás sana y reinicia a todos para un comienzo justo, y el combate termina cuando un bando se rinde a 1 hp. Nadie muere, y vuelves exactamente al lugar donde entraste en cola.

- **Escaleras clasificatorias 1v1 y 2v2**, cada una con una puntuación persistente al estilo Elo (todos empiezan en 1500) y una clasificación de todos los tiempos (`GET /api/arena/leaderboard`).
- **2v2 Fiesta**, un modo de grupo más animado: el primer equipo en lograr quince derribos gana dentro de un límite de seis minutos, los jugadores reaparecen con temporizadores crecientes, las recogidas de mejoras reparten poder a lo largo de tres oleadas y un anillo que se cierra fuerza a juntar la pelea.

### Jugar juntos

- **Grupos** de hasta 5: haz clic derecho sobre un jugador e Invitar al grupo. Los miembros comparten derechos de botín y crédito de misión, reparten la XP con las auténticas bonificaciones de grupo vanilla (1.166 / 1.3 / 1.43 para 3/4/5) y aparecen como puntos en el minimapa. `/p` para el chat de grupo, `/roll` para repartir el botín.
- **Intercambios**: clic derecho e Intercambiar. Ambas partes preparan objetos y dinero, ambas deben aceptar, y el intercambio es atómico y validado en el servidor. Los objetos de misión no se pueden intercambiar, y alejarse cancela.
- **Duelos**: clic derecho y Desafiar a duelo. Una cuenta atrás de 3 segundos, y luego se lucha hasta que un bando llega a 1 hp; el ganador se anuncia en toda la zona y huir a 60 yardas supone rendirse.
- **Derechos de botín y estado de ausencia**: el primer jugador en dañar a un mob posee su botín, XP y crédito de misión; `/afk` y `/dnd` te marcan como ausente con una respuesta automática a los susurros.

### Mundo y sistemas

- **Comer y beber**: siéntate para recuperarte a lo largo de 18 segundos, interrumpido por daño o por levantarte, y sí, puedes comer y beber a la vez.
- **Vendedores** que compran comida y agua y venden equipo blanco honrado, con monedas mostradas en oro, plata y cobre.
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
| `C` `P` `L` `M` `B` `G` | personaje, libro de hechizos, registro de misiones, mapa del mundo, bolsas, arena |
| `V` / `R` / `Esc` | placas de nombre, autocorrer, cerrar ventanas o quitar objetivo |

Los controles táctiles (un stick de movimiento, arrastre de cámara y botones de acción en pantalla) aparecen automáticamente en móvil.

## Arquitectura (un sim, tres anfitriones)

Tres ideas mantienen unido el proyecto:

- **Un sim, tres anfitriones.** El mismo código de `src/sim/` ejecuta el mundo offline en el navegador, el servidor en línea y el entorno de RL. El comportamiento debe ser idéntico en todas partes, y las pruebas existen para mantenerlo así.
- **`IWorld` es la única costura.** `src/world_api.ts` define `IWorld`. El `Sim` offline lo satisface estructuralmente y el `ClientWorld` en línea lo implementa reflejando las instantáneas del servidor. El renderizador y el HUD hablan solo con `IWorld`, nunca con un mundo concreto, así que una nueva característica primero extiende la interfaz y luego ambos mundos.
- **El servidor es autoritativo.** Los clientes envían intención; el servidor decide los resultados. El cliente nunca resuelve combate, botín ni economía por su cuenta.

El sim es un tick fijo de 20 Hz (`DT = 1/20`), toda la aleatoriedad fluye a través de un único `Rng` sembrado, y `src/sim/` no lleva ninguna importación de DOM, navegador ni Three.js. Eso es lo que permite que el mismo código se empaquete en un servidor de entorno Node, en un bucle de juego autoritativo y en una pestaña de navegador sin cambiar una sola línea.

### Estructura del proyecto

| Ruta | Qué es |
|---|---|
| `src/sim/` | Núcleo determinista del juego, la fuente de la verdad. Sin dependencias de DOM ni Three. |
| `src/sim/content/` | Datos como código: las nueve clases, habilidades, zonas, mazmorras, objetos, talentos. |
| `src/render/` | Renderizador Three.js (geometría, texturas, VFX procedimentales). Lee el mundo, nunca lo muta. |
| `src/game/` | Entrada local, cámara, asignación de teclas, controles móviles, WebAudio procedimental. |
| `src/ui/` | HUD clásico (marcos, ventanas, descripciones, mapa, texto de combate flotante), iconos procedimentales, i18n. |
| `src/net/` | Cliente en línea: autenticación REST más un espejo del mundo por WebSocket (`ClientWorld`). |
| `src/admin/` | SPA del panel de administración (entrada `admin.html` aparte). |
| `server/` | Servidor autoritativo: HTTP y WS, bucle del mundo, Postgres, autenticación, social, moderación. |
| `headless/` + `python/` | Servidor del entorno de RL (`env_server.ts`) y enlaces de Python Gym. |
| `tests/` | Conjunto de pruebas Vitest. |
| `scripts/` | Compilación de recursos más scripts de E2E en navegador, capturas e integración. |
| `public/` · `docs/` | Recursos estáticos (modelos GLB, texturas, HDRIs) y documentos de diseño. |

La mayoría de los directorios llevan su propio `CLAUDE.md` con convenciones locales. El conjunto completo de invariantes del proyecto vive en el [`CLAUDE.md`](../../CLAUDE.md) raíz.

## Construido como los clásicos

El combate, la subida de nivel y la amenaza funcionan todos sobre reglas auténticas de la era clásica: rage y energía, tablas de acierto y esquiva, mitigación por armadura, la auténtica curva de XP, los temporizadores de golpe y el enfriamiento global. Se siente como lo recuerdas en lugar de aproximarlo. Los números exactos viven en `src/sim/` si quieres leerlos.

Y casi nada de ello es un recurso prefabricado. El mundo se dibuja a partir de código:

- Pueblos, criaturas, terreno, agua, clima y sombras en tiempo real procedimentales, sin archivos de modelos 3D para el mundo.
- Doce familias de criaturas con esqueleto y animaciones completas de andar, atacar, lanzar, sentarse y morir.
- Iconos de hechizos, objetos y mejoras pintados en canvas en tiempo de ejecución.
- Un HUD clásico completo (marcos de unidad, barras de acción, descripciones, registro de misiones, mapa del mundo, minimapa, texto de combate flotante) y WebAudio procedimental para cada sonido.

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

Las pruebas de lógica y unitarias usan Vitest. Mientras iteras, ejecuta un solo archivo: `npx vitest run tests/sim.test.ts`. Los scripts de E2E y visuales manejan navegadores reales mediante `puppeteer-core` y necesitan que `npm run dev` esté en marcha (a menudo `npm run server` también). Los agentes de navegador pueden manejar el movimiento a través de `window.__game.controller` en lugar de simular teclas pulsadas, por ejemplo `controller.move({ forward: true }, facingRadians)` o banderas compactas como `{ f: 1, sr: 1 }`.

Para los comandos del servidor consulta [Desarrolla en línea](#develop-online-with-hot-reload) más arriba, [DEPLOY.md](../../DEPLOY.md) para producción y [CREDITS.md](../../CREDITS.md) para las licencias de los recursos.

## Localización

Cada cadena visible para el jugador se resuelve a través de `t()`, y el juego se distribuye en **21 idiomas** (inglés, dos españoles, dos franceses, inglés de Canadá, italiano, alemán, chino simplificado y tradicional, coreano, japonés, portugués de Brasil, ruso, neerlandés, polaco, indonesio, turco, sueco, vietnamita y danés). El sim y el servidor se mantienen agnósticos respecto al idioma: emiten claves estables o inglés que el cliente vuelve a localizar en la frontera, lo que mantiene intacto el determinismo. Los colaboradores añaden solo inglés; el mantenedor rellena por lotes los demás idiomas antes de cada lanzamiento. El flujo de trabajo está documentado en `docs/i18n-scaling/translation-workflow.md`.

## Contribuir

Las contribuciones de todo tipo son bienvenidas: código, traducciones, informes de errores y documentación. Empieza con [CONTRIBUTING.md](CONTRIBUTING.es_ES.md) para la configuración, lee el [Código de conducta](../../CODE_OF_CONDUCT.md) y consulta [SECURITY.md](../../SECURITY.md) antes de informar de una vulnerabilidad. ¿Nuevo por aquí? Busca incidencias etiquetadas como [`good first issue`](https://github.com/levy-street/world-of-claudecraft/labels/good%20first%20issue), abre una [incidencia](https://github.com/levy-street/world-of-claudecraft/issues/new/choose) o saluda en [Discord](https://discord.gg/GjhnUsBtw).

<div align="center">

![World of Claude](../../worldofclaude.png)

![Comunidad de World of ClaudeCraft](../../woc_community.png)

</div>

## Licencia

El código tiene [licencia MIT](../../LICENSE), así que bifúrcalo, remézclalo y aloja tu propio mundo.

Los recursos artísticos de terceros incluidos (modelos, texturas, HDRIs) conservan sus propias licencias, todas de dominio público CC0 salvo los mapas normales de agua con licencia MIT, documentados por paquete en [CREDITS.md](../../CREDITS.md).
