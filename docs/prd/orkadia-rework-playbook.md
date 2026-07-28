# Playbook del rework de Orkadia

Para una segunda aplicacion deliberadamente distinta de este contrato de campo abierto, consulta
`docs/prd/wildheart-basin-open-field-dungeon.md`.

Este documento conserva el proceso seguido para convertir Orkadia en la primera dungeon
instanciada de campo abierto de World of ClaudeCraft. Es a la vez un registro histórico y una
receta para futuros agentes que tengan que rehacer un espacio, generar un kit 3D coherente o
añadir criaturas riggeadas.

El registro económico y los identificadores de cada generación viven en
`docs/prd/orkadia-open-world-assets.md`. Las normas generales del generador están en
`scripts/asset_pipeline/CLAUDE.md`. Este playbook explica el razonamiento, el orden de trabajo,
los fallos y las comprobaciones que hicieron que el resultado final funcionase como un todo.

## 1. Resultado que se perseguía

La interpretación correcta fue:

- Orkadia sigue siendo una dungeon normal e instanciada.
- Mantiene puerta en el overworld, teletransporte, slots por grupo, Heroico y deeds.
- Solo cambia la naturaleza del interior: deja de ser una sala o corredor cerrado y pasa a ser
  un campo de guerra al aire libre.
- El campo debe contar una historia espacial: llegada, campamento, asedio, ritual, prisión,
  puerta interior y fortaleza del jefe.
- El relieve, los props, las colisiones y los encuentros deben formar una sola composición.

La primera interpretación, convertir Orkadia en un campamento no instanciado del overworld,
era incorrecta y se revirtió. La lección es importante: antes de modelar, escribir una frase
que separe claramente lo que se conserva de lo que cambia.

La frase de control usada para este trabajo fue:

> Dungeon instanciada normal por fuera, campo de guerra orco abierto por dentro.

## 2. Principios que guiaron el trabajo

### 2.1 Diseñar un lugar, no repartir props

Un campo grande con objetos sueltos sigue pareciendo vacío. Cada prop debe pertenecer a un
distrito con una función visible:

- La puerta exterior establece escala y lenguaje visual.
- El bivouac tiene tiendas, suministros, armas y tambores.
- El patio de asedio tiene catapultas, barricadas y torres.
- El centro ritual tiene tótems, fuego vil y chamanes.
- La empalizada de prisioneros tiene jaulas, postes y guardianes.
- La segunda puerta marca el cambio hacia el tramo del jefe.
- La fortaleza, el trono y el anillo de combate cierran la composición.

El jugador debe poder explicar qué ocurre en una zona solo mirándola.

### 2.2 Una silueta dominante por plano

La lectura se construyó en capas:

1. Camino y combatientes en primer plano.
2. Tiendas, máquinas de asedio y empalizadas en plano medio.
3. Riscos basálticos y torres como marco.
4. Fortaleza y montaña trasera como destino.

Las banderas rojas, el fuego verde y el basalto negro se reservaron como señales repetidas.
La paleta evita que cada asset compita con todos los demás.

### 2.3 Gameplay primero

La ruta central tenía que ser continua, las puertas transitables y los pulls legibles. Ninguna
captura bonita justificaba una colisión falsa, una cámara bloqueada o un spawn dentro de un
prop.

### 2.4 Fuente única de verdad

`src/sim/orkadia_field.ts` contiene los símbolos que comparten sim y render:

- `ORKADIA_FIELD_PLACEMENTS`
- `ORKADIA_FIELD_WALLS`
- `ORKADIA_FIELD_BOUNDS`
- `ORKADIA_FIELD_COLLIDER_SPECS`
- `orkadiaRouteCenter()`
- `orkadiaFieldHeight()`

El render consume esa tabla. Los colliders se derivan de esa tabla. `groundHeight()` consume la
misma función de altura. Así se evita que lo visible, lo pisable y lo bloqueable diverjan.

## 3. Restricciones técnicas descubiertas antes de modelar

### 3.1 Banda de instancias

Las instancias se separan cada 500 yd en el eje Z. Las coordenadas locales deben mantenerse
dentro de `abs(z) < 250`. Si se cruza ese límite, `instanceLocal()` y `instanceSlotForZ()`
clasifican el punto como otra instancia. El resultado sería terreno o colisiones del slot
vecino.

Por eso `ORKADIA_FIELD_BOUNDS` deja margen antes del límite. Nunca se debe ampliar este mapa
solo cambiando el tamaño del plano renderizado.

### 3.2 Sim determinista

Todo lo que afecta al gameplay vive en `src/sim/` y no puede importar Three.js, DOM ni render.
No se usa `Math.random`. El ruido visual puede ser determinista y cosmético, pero la altura y
las colisiones deben ser reproducibles en cliente, servidor y entorno headless.

### 3.3 Assets de props

Para este kit se conservaron estas reglas:

- Base en `y=0`.
- Frente hacia `+Z`.
- Texturas WebP.
- Compresión Meshopt.
- Nunca Draco.
- Escala en yardas del mundo, no una corrección arbitraria en cada placement.
- Presupuesto compacto para no degradar la primera entrada a la instancia.

### 3.4 Deeds ya publicados

No se reescriben triggers de deeds publicados. El rework conservó los deeds normal y Heroico
de Orkadia. La estructura espacial no necesitaba alterar sus contratos.

## 4. Fase de concepto

### 4.1 Tres imágenes antes de generar modelos

El concepto se resolvió de lo general a lo particular:

1. Un blockout cenital profesional con ruta, distritos y arena final.
2. Una vista objetivo de gameplay que fijase paleta, atmósfera y escala.
3. Una lámina modular con los elementos principales del kit.

Gemini se usó para producir esas vistas y luego para aislar cada módulo sobre un fondo neutro.
El generador de imágenes se usó además para intentar abrir por completo el hueco de la puerta.

La secuencia fue deliberada. Generar props antes del blockout suele producir una colección
bonita pero incoherente. El blockout decide qué piezas hacen falta y cuántas funciones debe
cubrir el kit.

### 4.2 Reglas de los conceptos de props

Cada concepto individual pedía:

- Un solo objeto.
- Cámara ortográfica de tres cuartos.
- Fondo gris claro.
- Luz de estudio plana.
- Sin suelo, sombra, personajes, texto ni marca de agua.
- Sin emblemas, escudos de armas ni insignias de facción reconocibles de otro juego.
- Silueta gruesa y legible.
- Detalle visual concentrado en hueso, hierro, madera quemada, tela roja y brillo verde.

Esto reduce la probabilidad de que el modelo 3D incorpore paisaje, peanas o elementos flotantes.

La regla de los emblemas no es teórica: `orkadia_war_drum` se generó con el escudo de una
facción de otro juego pintado en el parche del tambor, y pasó el QA porque ninguna comprobación
miraba lo que la textura representaba. Ver la remediación en
`docs/prd/orkadia-open-world-assets.md`.

### 4.3 Reglas de los conceptos de criaturas

Todos los humanoides se diseñaron con:

- Cuerpo completo y pies visibles.
- T-pose simétrica estricta.
- Brazos perfectamente horizontales.
- Manos vacías y palmas hacia abajo.
- Piernas separadas.
- Cámara frontal ortográfica.
- Proporciones chibi heroicas compatibles con el juego.
- Accesorios pegados al cuerpo y sin cruzar brazos o piernas.

La T-pose limpia fue una decisión de producción, no una preferencia estética. Un concepto con
arma en mano, capa cruzando el brazo o pose dinámica perjudica el rig, los pesos y el retarget.

## 5. Generación y QA de los props

### 5.1 Kit estructural regenerado

El rework generó o sustituyó estos módulos:

| Asset | Papel |
| --- | --- |
| `orkadia_volcanic_cliff` | Pared modular y marco del cañón |
| `orkadia_palisade` | Cerramiento de distritos y fortificación |
| `orkadia_war_gate` | Puerta monumental exterior e interior |
| `orkadia_war_hall` | Landmark y fortaleza del jefe |
| `orkadia_war_tent` | Vivienda y puesto de mando |
| `orkadia_catapult` | Identidad del patio de asedio |

Patrón de generación:

```bash
node scripts/asset_pipeline/pipeline.mjs prop \
  --name orkadia_war_tent \
  --height 6.5 \
  --image /ruta/al/concepto.png
```

Después de cada job:

```bash
node scripts/asset_pipeline/pipeline.mjs qa --job <job_id>
node scripts/asset_pipeline/pipeline.mjs prop --job <job_id> --apply
```

Nunca se aplicó un asset solo porque el comando terminase. Se inspeccionaron `front`, `right`,
`back`, `left` y `hero` dentro de `tmp/asset_pipeline/<job>/preview/`.

### 5.2 Normalización final

Los GLB aplicados se volvieron a optimizar cuando el resultado del pipeline no encajó en el
presupuesto específico del kit:

```bash
npx gltf-transform optimize entrada.glb salida.glb \
  --compress meshopt \
  --texture-compress webp \
  --texture-size 512 \
  --simplify-ratio 1
```

La tienda usó una textura menor para entrar en presupuesto sin perder su lectura. Después de
optimizar se volvió a renderizar el GLB público, no el artefacto intermedio, y se comprobó que
la compresión no hubiese roto materiales, frente o base.

La validación final debía confirmar:

- Extensión `EXT_meshopt_compression` presente.
- Ausencia de Draco.
- Base en `y=0`.
- Tamaño y bounding box razonables.
- Sin errores del validador glTF.
- Ningún emblema, insignia ni texto de terceros en el mapa de color base.

Esta última comprobación se añadió después de que `orkadia_war_drum` llegara a producción con
un escudo de facción ajeno pintado en la piel del tambor. Las cinco anteriores son
estructurales y ninguna mira el contenido de la textura, así que hay que inspeccionarla
aparte: extraer el mapa de color del GLB y verlo a resolución completa, no solo mirar el
render del prop, donde un emblema de 25 px pasa desapercibido.

### 5.3 La puerta cerrada y la solución compositiva

Aunque el prompt exigía un hueco abierto, las generaciones de Tripo insistieron en producir
una hoja cerrada. Seguir gastando créditos no garantizaba resolverlo.

La solución fue usar el asset como bastión lateral:

- `buildPassableWarGate()` en `src/render/orkadia_props.ts` clona el módulo a ambos lados.
- Una copia se refleja.
- Las dos copias se separan para dejar una ruta central real.
- Un dintel procedural completa la silueta por encima de la altura del jugador.
- El collider usa varios postes laterales y no un círculo que cierre el centro.

Esta solución conserva el arte bueno del asset y elimina su defecto funcional. La regla general
es componer un modelo imperfecto cuando su silueta sirve, en lugar de confiar en que una nueva
tirada repita todo lo bueno y arregle solo un detalle.

## 6. Construcción del terreno

### 6.1 Altura jugable

`orkadiaFieldHeight()` combina:

- Zona de llegada aplanada.
- Relieve pequeño determinista.
- Ascenso por terrazas a lo largo de la ruta.
- Hombros elevados del cañón.
- Plataformas laterales para los distritos.
- Hondonada ritual.
- Meseta final plana para el jefe.

`src/sim/world.ts` detecta el interior `orkadia`, convierte a coordenadas locales mediante el
slot correcto y añade esa altura a `DUNGEON_FLOOR_Y`.

### 6.2 Malla renderizada

`buildOrkadiaTerrain()` en `src/render/orkadia_terrain.ts` crea una malla subdividida y evalúa
`orkadiaFieldHeight()` en cada vértice. También construye:

- Color por vértice según ruta, ceniza y hombros de basalto.
- Textura procedural determinista de ceniza.
- Camino continuo que sigue `orkadiaRouteCenter()`.
- Fisuras verdes con borde y glow.
- Costillas basálticas laterales.
- Anillo de la arena del jefe.
- Montaña trasera y cúpula de tormenta.

El primer camino estaba hecho con losas separadas. En juego parecían piezas flotantes y
dominaban la imagen. Se sustituyó por una cinta continua asentada sobre la misma función de
altura. La lección es revisar el resultado desde la cámara real, no solo desde una vista cenital.

### 6.3 Materiales e iluminación

La primera captura del rework estaba demasiado oscura. Había dos causas:

- La textura de ceniza multiplicaba colores de vértice ya oscuros.
- La atmósfera volcánica dependía demasiado del negro para parecer peligrosa.

Se corrigió aclarando la base de la textura, neutralizando el suelo hacia gris pardo y dejando
que los detalles oscuros viviesen en los riscos y props. La iluminación final combina:

- HemisphereLight local para lectura de siluetas.
- DirectionalLight cálida como relleno.
- Rig exterior específico en `src/render/renderer.ts`.
- Niebla verde gris con mayor distancia.
- Luces y decals verdes en braseros, antorchas, puertas y dais.

Oscuro no significa negro. Una escena peligrosa necesita contraste suficiente para leer
enemigos, rutas y objetivos.

## 7. Layout, placements y colisiones

### 7.1 Tabla autoritativa

Cada prop se coloca una sola vez en `ORKADIA_FIELD_PLACEMENTS`, con `kind`, `x`, `z`, `rot` y
una escala opcional. El render recorre la tabla y asienta cada objeto en
`orkadiaFieldHeight(x, z)`.

`ORKADIA_FIELD_COLLIDER_SPECS` se deriva de la misma tabla y de los footprints por clase de
prop. La escala del placement afecta también al radio y la altura del collider.

### 7.2 Props visuales sin collider local

Los riscos repetidos forman una carcasa visual, pero el perímetro jugable se resuelve con cuatro
OBB autoritativos. Esto evita llenar la sim de docenas de círculos caros o dejar huecos entre
rocas irregulares.

### 7.3 Auditoría de spawns

`tests/orkadia.test.ts` calcula la distancia de cada spawn a cada collider derivado. Un spawn
debe conservar una holgura suficiente, no limitarse a estar fuera por una fracción mínima.

Cuando se ensancharon las alas de la puerta, se movieron los spawns próximos y se repitió el
audit. Cada cambio de escala o footprint debe volver a ejecutar esta prueba.

## 8. Las cinco criaturas nuevas

### 8.1 Diseñar primero el papel de combate

Cada silueta se vinculó a una función del campamento y a una mecánica:

| Mob | Distrito y función | Mecánica principal |
| --- | --- | --- |
| Bloodtusk Axethrower | Aproximación y patrullas | Ataque físico a distancia |
| Ashenbone Fel Shaman | Hondonada ritual | Proyectil de sombra y cura de aliados |
| Ironhide Warbeast Handler | Jaulas y patrullas | Sangrado y grito de celeridad |
| Orkadia Siege Brute | Patio de asedio | Raro élite con stomp, cleave y enrage |
| Black Banner Captain | Mando y puerta interior | Raro élite con rally y ward de grupo |

Esto evita crear cinco skins que se comporten igual. El modelo, el distrito y la mecánica deben
contar la misma historia.

### 8.2 Pipeline de criatura

Patrón usado:

```bash
node scripts/asset_pipeline/pipeline.mjs creature \
  --name orkadia_axethrower \
  --image /ruta/al/concepto_tpose.png \
  --rig-type biped \
  --height 2.4
```

El pipeline ejecutó:

1. Modelo desde imagen.
2. Preview del modelo sin rig.
3. Rig biped.
4. Retarget de presets.
5. Ensamblado de clips con nombres del juego.
6. Preview de modelo y clips.
7. Validación estructural.
8. QA obligatorio.
9. Aplicación al directorio público.

El vocabulario final de cada criatura es:

- `Idle`
- `Walk`
- `Run`
- `Attack`
- `Hit`
- `Death`
- `Cast`
- `Jump`

Los presets biped usados fueron idle, walk, run, slash, hit to body, defeat, cast a spell y
jump. El ensamblado se revisó para confirmar que cada clip tenía canales y que ningún hueso se
había omitido.

### 8.3 QA visual de animaciones

`qa --job` verifica rig y clips, pero no sustituye la inspección humana. Para cada criatura se
abrieron:

- Cuatro vistas ortogonales y hero.
- Un frame de cada uno de los ocho clips.
- Especial atención a `Attack`, `Death`, `Cast` y `Jump`.

Las cinco muertes nuevas son colapsos articulados reales. No reutilizan la caída procedural en
T-pose de los orcos antiguos.

### 8.4 Recuperación de un job incompleto

El primer retarget del chamán recibió un error 429 y dejó clips sin descargar. No se regeneró el
modelo ni se pagó otra vez el rig. Se reanudó el mismo comando de criatura, conservando sus
argumentos originales, y se añadieron estas opciones para repetir desde retarget:

```bash
--job creature_orkadia_fel_shaman_mrv14kn1 --redo retarget
```

El ledger de `tmp/asset_pipeline/<job>/job.json` es la fuente para reanudar trabajos. Nunca se
debe crear un job nuevo solo porque un polling se interrumpa.

### 8.5 Integración en el juego

La integración de una criatura no termina al copiar el GLB:

- Definir el mob y sus mecánicas en `src/sim/content/orkadia.ts`.
- Añadir spawns con sentido espacial.
- Registrar el `VisualDef` en `src/render/characters/manifest.ts`.
- Añadir la entrada de `MOB_KEYS`.
- Mantener un tint muy bajo para conservar materiales y rango visual.
- Añadir el id a `src/ui/world_entity_i18n.ts`.
- Añadir nombres en los overlays mantenidos por la rama.
- Generar el retrato en `public/ui/mobs/`.
- Regenerar el media manifest.
- Regenerar el contenido de wiki y comprobar si el modelo necesita still.

Los retratos se produjeron con:

```bash
ONLY=orkadia_axethrower,orkadia_fel_shaman,orkadia_beast_handler,orkadia_siege_brute,orkadia_banner_captain \
  BROWSER_PATH=/ruta/a/chromium \
  node scripts/render_finder_portraits.mjs
```

## 9. La muerte de los orcos antiguos

Antes del rework se intentó generar una muerte real para los GLB originales
`black_orc.glb`, `blue_orc.glb` y `red_orc.glb`. Tripo produjo un rig biped de 41 joints,
mientras que los originales usan un esqueleto Mixamo distinto de 22 joints.

Copiar curvas de animación entre esqueletos con nombres, bind poses y jerarquías distintas no
es un retarget válido. Re-riggear el modelo completo arreglaba la muerte, pero deformaba o hacía
raros los ataques existentes, por lo que se revirtió.

`scripts/graft_orc_death.mjs` solo se debe usar cuando exista una animación retargeteada al rig
original compatible. La regla general es no injertar clips entre esqueletos incompatibles por
parecido visual.

## 10. Captura y revisión dentro del juego

### 10.1 Bucle visual

El ciclo correcto fue:

1. Arrancar Vite en el worktree.
2. Entrar offline.
3. Teletransportarse a la puerta.
4. Capturar portal, interior, especialista y jefe.
5. Crear un montage.
6. Revisar composición, no solo errores técnicos.
7. Corregir y repetir.

Comando:

```bash
GAME_URL=http://localhost:5180 \
BROWSER_PATH=/ruta/a/chromium \
node scripts/orkadia_shots.mjs
```

El script final fija `renderer.camYaw` además de `player.facing`. Cambiar solo el facing del
jugador no cambia necesariamente la cámara de persecución. También posiciona la cámara del jefe
después de la puerta interior para que el propio bastión no tape la arena.

### 10.2 SwiftShader

En render software, esperar muchos `requestAnimationFrame` puede tardar minutos y hacer que el
runner mate el proceso. El script usa pocos frames porque los assets ya se precargan al entrar.
También oculta el aviso de GPU solo en la captura.

Los errores 502 de `/api/project-stats` durante el modo offline son esperables cuando no está
levantado el servidor local. No indican un fallo de la dungeon.

### 10.3 Problemas detectados solo por las capturas

Las primeras capturas revelaron:

- Escena demasiado negra.
- Camino de losas flotantes.
- Portal de salida dominando la vista interior.
- Cámara del jefe dentro de la fortificación.
- Especialista tapado por una patrulla situada detrás del jugador.

Ninguno de esos problemas habría fallado TypeScript o Vitest. El QA visual es una prueba real,
no material promocional opcional.

## 11. Localización y ficheros generados

Los nombres visibles de los nuevos mobs se conectan mediante el matcher de entidades. Después
de editar catálogos y overlays:

```bash
npm run i18n:gen
npm run wiki:content
node scripts/build_media_manifest.mjs generate
```

No se editan manualmente `*.generated.ts` ni los bundles resueltos.

La comprobación de frescura de i18n del gate compara con el índice de Git. Los bundles
regenerados deben estar staged antes de ejecutar el gate:

```bash
git add src/ui/i18n.resolved.generated \
  src/admin/i18n.resolved.generated \
  src/ui/i18n.catalog/translation_keys.generated.ts
```

Este detalle produjo el único corte inicial del gate final. No era un error de traducción.

## 12. Pruebas y gate

### 12.1 Batería rápida durante la iteración

```bash
npx vitest run \
  tests/orkadia.test.ts \
  tests/dungeon_entry_clearance.test.ts \
  tests/render_glb_replacement_assets.test.ts \
  tests/architecture.test.ts \
  tests/dungeons.test.ts \
  tests/door_portal.test.ts \
  tests/delves.test.ts \
  tests/deeds_content.test.ts \
  tests/visual_manifest.test.ts \
  tests/target_portrait_view.test.ts
```

También se ejecutaron:

```bash
npx tsc --noEmit
npm run ci:changed
git diff --check
```

### 12.2 Qué fija `tests/orkadia.test.ts`

La prueba específica cubre:

- DungeonDef, puerta, interior y roster.
- Mecánicas de los especialistas y élites raros.
- Aparición de cada especialista en el spawn list.
- Clasificación del origen de instancia.
- Colliders derivados de los placements.
- Igualdad entre `groundHeight()` y `orkadiaFieldHeight()`.
- Elevación de la terraza del jefe.
- Bounds de todos los spawns.
- Holgura entre spawns y colliders.
- Deeds normal y Heroico.

### 12.3 Gate final

```bash
npm run gate
```

El gate verde incluyó seguridad, Biome de ficheros cambiados, SFX, suite completa, regresiones
de navegador, TypeScript, Svelte y builds de entorno, servidor y cliente.

Si el terminal corta una ejecución larga, primero comprobar con `pgrep` si `gate.mjs` y Vitest
siguen activos. No lanzar un segundo gate encima del primero. Los traps de restauración de dos
gates simultáneos pueden competir por los artefactos de i18n.

## 13. Coste y trazabilidad

El saldo de Tripo pasó de 2660 a 1485 créditos durante el rework. La diferencia, 1175 créditos,
es la medida autoritativa porque la API no devolvió precio para todos los tasks.

Cada asset conserva:

- Job id del pipeline.
- Task ids de Tripo.
- Ledger de pasos.
- Informe estructural.
- Previews.
- `qa.json`.
- Fila de atribución en `CREDITS.md`.

No se escribieron credenciales en el repositorio. Las claves se inyectaron desde ficheros de
configuración locales y variables de entorno.

## 14. Fallos que no se deben repetir

1. No cambiar el producto por una interpretación rápida. Instancia abierta no significa
   contenido no instanciado.
2. No duplicar el tamaño de un plano y llamarlo relieve.
3. No repartir props al azar. Diseñar distritos y rutas antes de generar modelos.
4. No confiar en que un prompt de puerta abierta produzca una puerta abierta.
5. No crear altura solo en render. La sim, el servidor y el cliente deben compartirla.
6. No crear colliders manuales separados de los placements.
7. No aplicar un GLB sin revisar todos los ángulos.
8. No dar por buena una criatura porque tenga ocho nombres de clips. Mirar los frames.
9. No regenerar un job pagado si el ledger permite reanudarlo.
10. No injertar animaciones entre rigs incompatibles.
11. No usar negro absoluto como sustituto de atmósfera.
12. No validar una escena visual solo con tests unitarios.
13. No editar ficheros generados a mano.
14. No ampliar Orkadia más allá del contrato de slots de 500 yd.

## 15. Checklist reutilizable para un futuro rework

### Visión

- [ ] Escribir una frase de control con lo que cambia y lo que se conserva.
- [ ] Definir fantasía, paleta, landmarks y ritmo de encuentros.
- [ ] Crear blockout cenital antes de generar assets.
- [ ] Crear una vista objetivo desde la cámara real del juego.

### Arquitectura

- [ ] Identificar límites de coordenadas e instancias.
- [ ] Elegir una fuente única para placements, altura y colliders.
- [ ] Mantener gameplay fuera de render.
- [ ] Definir ruta y distritos antes de poblar.

### Assets

- [ ] Generar conceptos aislados y limpios.
- [ ] Revisar modelo crudo antes de gastar en rig.
- [ ] Ejecutar `qa --job` para cada asset.
- [ ] Revisar todos los previews.
- [ ] Confirmar orientación, base, tamaño, compresión y extensiones.
- [ ] Regenerar manifest y comprobar créditos.

### Criaturas

- [ ] Dar a cada criatura una función visual y mecánica.
- [ ] Usar T-pose estricta y manos vacías.
- [ ] Confirmar rig y todos los clips.
- [ ] Mirar especialmente Attack, Death, Cast y Jump.
- [ ] Registrar VisualDef, MOB_KEYS, i18n, retrato y spawns.
- [ ] Probar que ningún spawn colisiona.

### QA

- [ ] Capturar portal, plano general, especialista y jefe.
- [ ] Revisar iluminación, ruta, escala y oclusión de cámara.
- [ ] Ejecutar tests específicos después de cada cambio de layout.
- [ ] Ejecutar TypeScript y Biome de cambiados.
- [ ] Regenerar y stagear artefactos requeridos.
- [ ] Ejecutar `npm run gate` una sola vez y esperar a que termine.

## 16. Prompts exactos de los seis módulos

Estos prompts se conservaron desde los ficheros temporales usados en la generación.

### Risco volcánico

```text
Create one isolated game-ready stylized low-poly volcanic basalt cliff wall module matching
the attached Orkadia kit sheet. Tall broad jagged black rock buttress with several chunky
vertical columns and restrained toxic-green glowing cracks, strong irregular silhouette,
thick enough to form a canyon wall. Single object only, front three-quarter orthographic view,
centered, fills 80 percent of frame, neutral light-gray background, flat studio lighting, no
ground shadow, no scenery, no characters, no text, no watermark.
```

### Empalizada

```text
Create one isolated game-ready stylized low-poly orc palisade wall module matching the
attached Orkadia kit sheet. Long continuous wall of charred heavy timber planks reinforced
with dark iron bands, rivets and stone feet, uneven sharpened stakes along the top, two bone
tusk accents and one small torn dark-red hide banner. Broad horizontal silhouette, thick
sturdy base, single object only, front three-quarter orthographic view, centered, fills 80
percent of frame, neutral light-gray background, flat studio lighting, no ground shadow, no
scenery, no characters, no text, no watermark.
```

### Puerta de guerra

```text
Create one isolated game-ready stylized low-poly monumental orc gatehouse matching the
attached Orkadia kit sheet. Huge open central doorway wide enough for several warriors,
charred timber and dark basalt construction, iron bands and rivets, giant horned beast skull
over the lintel, asymmetrical bone tusks and spikes, thick side towers, restrained toxic-green
braziers. The passage must be visibly open through the model, strong front-facing silhouette.
Single object only, front three-quarter orthographic view, centered, fills 85 percent of frame,
neutral light-gray background, flat studio lighting, no ground shadow, no scenery, no
characters, no text, no watermark.
```

### Fortaleza

```text
Create one isolated game-ready stylized low-poly orc warlord fortress matching the attached
Orkadia kit sheet. Compact layered citadel built on a chunky black basalt podium, central
dark-wood longhouse with a high peaked roof, two uneven watchtowers, spiked palisade parapets,
iron gates, bone tusks, torn dark-red banners and four restrained toxic-green braziers. Broad
and tall hero landmark with a clear front entrance and readable stacked silhouette, not a flat
facade. Single object only, front three-quarter orthographic view, centered, fills 85 percent
of frame, neutral light-gray background, flat studio lighting, no ground shadow, no scenery,
no characters, no text, no watermark.
```

### Tienda de guerra

```text
Create one isolated game-ready stylized low-poly orc war tent matching the attached Orkadia
kit sheet. Large round command tent of patched tan and dark-red hide stretched over thick
charred poles, irregular layered flaps, many bone tusks and horned skull ornaments, heavy rope
lashings, a clearly open dark entrance, broad chunky silhouette. Single object only, front
three-quarter orthographic view, centered, fills 80 percent of frame, neutral light-gray
background, flat studio lighting, no ground shadow, no scenery, no characters, no text, no
watermark.
```

### Catapulta

```text
Create one isolated game-ready stylized low-poly orc siege catapult matching the attached
Orkadia kit sheet. Crude heavy charred-timber frame, four iron-bound wooden wheels, thick
throwing arm, bone and spike reinforcements, basket holding one glowing toxic-green fel
boulder, exaggerated chunky readable mechanics. Single object only, front three-quarter
orthographic view, centered, fills 80 percent of frame, neutral light-gray background, flat
studio lighting, no ground shadow, no scenery, no characters, no text, no watermark.
```

## 17. Prompts exactos de las cinco criaturas

### Bloodtusk Axethrower

```text
Create one isolated full-body 3D character concept for a Bloodtusk Axethrower, a lean cunning
green-skinned orc scout for a stylized low-poly classic fantasy MMO. Chibi heroic proportions
matching the attached Orkadia world, oversized head and hands, short powerful legs, dark
leather jerkin, red hide sash, bone necklace, small throwing axes strapped flat across the
back, empty hands. Strict symmetrical T-pose with both arms perfectly horizontal, palms down,
legs apart, front-facing orthographic camera, entire body and feet visible, subject fills 82
percent of frame, neutral light-gray background, flat studio lighting, no ground shadow, no
scenery, no text, no watermark, no weapon in hands.
```

### Ashenbone Fel Shaman

```text
Create one isolated full-body 3D character concept for an Ashenbone Fel Shaman, a sinister
green-skinned orc spellcaster for a stylized low-poly classic fantasy MMO. Chibi heroic
proportions matching the attached Orkadia world, oversized head and hands, hunched tusked face,
layered charcoal and dark-red hide robes split for leg movement, skull headdress, bone charms,
restrained toxic-green runes on bracers and belt, empty hands. Strict symmetrical T-pose with
both arms perfectly horizontal, palms down, legs apart, front-facing orthographic camera,
entire body and feet visible, subject fills 82 percent of frame, neutral light-gray background,
flat studio lighting, no ground shadow, no scenery, no text, no watermark, no staff or weapon.
```

### Ironhide Warbeast Handler

```text
Create one isolated full-body 3D character concept for an Ironhide Warbeast Handler, a broad
green-skinned orc beastmaster for a stylized low-poly classic fantasy MMO. Chibi heroic
proportions matching the attached Orkadia world, oversized head and hands, scarred one-eyed
face, patchwork iron and leather armor, one spiked shoulder guard, thick chain coils and animal
fangs hanging from belt, fur mantle, empty hands. Strict symmetrical T-pose with both arms
perfectly horizontal, palms down, legs apart, front-facing orthographic camera, entire body and
feet visible, subject fills 82 percent of frame, neutral light-gray background, flat studio
lighting, no ground shadow, no scenery, no text, no watermark, no weapon in hands.
```

### Orkadia Siege Brute

```text
Create one isolated full-body 3D character concept for an Orkadia Siege Brute, a towering elite
green-skinned orc shock trooper for a stylized low-poly classic fantasy MMO. Very chunky chibi
boss-like proportions matching the attached Orkadia world, enormous shoulders, forearms and
tusked head, shorter legs, black basalt plate armor reinforced with rusted iron, huge spiked
gauntlets, horned back plate, toxic-green cracks in two armor plates, empty open hands. Strict
symmetrical T-pose with both arms perfectly horizontal, palms down, legs apart, front-facing
orthographic camera, entire body and feet visible, subject fills 84 percent of frame, neutral
light-gray background, flat studio lighting, no ground shadow, no scenery, no text, no
watermark, no weapon.
```

### Black Banner Captain

```text
Create one isolated full-body 3D character concept for a Black Banner Captain, an elite veteran
green-skinned orc commander for a stylized low-poly classic fantasy MMO. Chibi heroic
proportions matching the attached Orkadia world, oversized stern tusked head and hands, heavy
dark iron lamellar armor, asymmetrical horned helmet, crimson half-cape, skull belt, broad
decorated shoulder plates, small torn black-and-red banner mounted close behind one shoulder
without crossing the arms, empty hands. Strict symmetrical T-pose with both arms perfectly
horizontal, palms down, legs apart, front-facing orthographic camera, entire body and feet
visible, subject fills 82 percent of frame, neutral light-gray background, flat studio lighting,
no ground shadow, no scenery, no text, no watermark, no weapon in hands.
```

## 18. Mapa final de ficheros

| Responsabilidad | Ruta o símbolo estable |
| --- | --- |
| Layout, altura y colliders | `src/sim/orkadia_field.ts` |
| Definiciones, mecánicas y spawns | `src/sim/content/orkadia.ts` |
| Aplicación de altura al mundo | `src/sim/world.ts` `groundHeight()` |
| Registro de colliders | `src/sim/colliders.ts` `INTERIOR_COLLIDERS.orkadia` |
| Terreno y atmósfera procedural | `src/render/orkadia_terrain.ts` |
| Props, gate y warpyres | `src/render/orkadia_props.ts` |
| Routing de interiores | `src/render/dungeon.ts` |
| Luz y niebla | `src/render/renderer.ts` `orkadiaField` |
| Modelos y clips de criaturas | `src/render/characters/manifest.ts` |
| Nombres localizados | `src/ui/world_entity_i18n.ts` y catálogos i18n |
| Tests del contrato | `tests/orkadia.test.ts` |
| Captura visual | `scripts/orkadia_shots.mjs` |
| Registro de jobs y coste | `docs/prd/orkadia-open-world-assets.md` |

## 19. Definición de terminado

Un rework de este tipo solo está terminado cuando se cumplen juntas estas condiciones:

- La fantasía se entiende sin explicación.
- La ruta se lee desde la cámara de juego.
- El terreno afecta realmente a gameplay.
- Cada distrito tiene función, silueta y encuentro.
- Props y colliders coinciden.
- Todas las puertas se atraviesan.
- Ningún spawn intersecta geometría.
- Las criaturas tienen identidad mecánica y visual.
- Cada clip ha sido revisado.
- Los nombres, retratos, manifests y créditos están integrados.
- Las capturas reales son legibles.
- Los tests específicos y el gate completo están verdes.

Esa combinación, y no una sola generación espectacular, fue lo que convirtió Orkadia en un
resultado cohesionado.
