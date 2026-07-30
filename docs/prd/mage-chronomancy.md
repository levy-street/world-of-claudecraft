# Mago: Cronomancia healer

Estado: DIRECCIÓN CERRADA (Opción A), aprobada por el operador el 2026-07-12. Lo bloqueado es
únicamente el RUMBO de la especialización. Las mecánicas, los nombres y los números siguen siendo
provisionales y se afinarán por fases.

## 0. Decisión de dirección (cerrada 2026-07-12)

Cronomancia es la tercera especialización del mago y su rol es HEALER OFENSIVO: sana convirtiendo
su daño Arcano en curación. Sustituye a Arcano como DPS dedicado.

Debe tener IDENTIDAD PROPIA y no copiar directamente a un sacerdote de Disciplina. Su
diferenciación se apoya en tres ideas:

- Preparar el futuro: marcar y proteger por adelantado con Eco, Convergencia, Barrera y Ancla.
- Sostener: mantener al grupo con una rotación Arcana sujeta a presión de maná, nunca curación
  gratuita ni automática.
- Corregir: revertir daño reciente con Rebobinar.

Con esta decisión, el documento pasa a ser la fuente de verdad del rediseño del mago. Las
secciones de `talents-2.0.md` donde Arcano siga definido como DPS deberán actualizarse cuando esa
fase se aborde. Los nombres y números de las secciones siguientes son provisionales.

## 1. Propuesta de especializaciones

Dirección recomendada:

- Piromancia, DPS a distancia: críticos, explosiones, quemaduras y movilidad ofensiva.
- Criomancia, DPS a distancia y control: congelaciones, combos contra objetivos inmovilizados,
  barreras y supervivencia.
- Cronomancia, healer: preparación de aliados, ecos de curación, escudos y reversión del daño.

Cronomancia sustituiría la fantasía de Arcano como DPS dedicado, pero puede conservar parte de su
kit y estética. Misiles Arcanos, Explosión Arcana, manipulación de maná y magia del éter siguen
siendo apropiados para un sanador temporal.

Alternativa más radical, no recomendada para la primera versión:

- Piromancia, DPS.
- Criomancia, tank mediante barreras y mitigación con maná.
- Cronomancia, healer.

Esta alternativa daría al mago los tres roles, pero incrementaría mucho el coste de balance y
reduciría la identidad exclusiva de otras clases. Este documento asume la primera opción.

## 2. Fantasía y pilares de Cronomancia

Cronomancia no debe sentirse como un sacerdote con efectos visuales arcanos. Su identidad se basa
en cuatro pilares:

1. Preparar: marcar aliados antes de que llegue el daño.
2. Replicar: copiar una cura sobre varios objetivos preparados mediante Eco.
3. Prevenir: ganar tiempo con barreras y mitigación temporal.
4. Revertir: recuperar parte del daño registrado mediante Rebobinar.

El healer debe seguir siendo funcional cuando no haya un enemigo disponible. El daño arcano puede
contribuir a la curación, pero no puede ser su única fuente de sanación.

### Ciclo de juego esperado

1. El mago coloca Eco en los aliados que espera que reciban daño.
2. Protege al objetivo prioritario con una barrera o un ancla temporal.
3. Lanza una cura directa sobre el aliado que más la necesita.
4. La cura se replica sobre todos los objetivos marcados y consume sus Ecos.
5. Ante una ráfaga peligrosa, activa Rebobinar para recuperar daño registrado.
6. Entre ventanas de daño, usa hechizos arcanos, regenera maná y vuelve a preparar Ecos.

## 3. Mecánica central: Eco

### Comportamiento recomendado para v1

Eco realiza una cura inicial pequeña y deja una marca temporal sobre un aliado. La siguiente cura
directa de Cronomancia replica el 70% de su potencia sobre todos los aliados que tengan un Eco del
mismo mago. Después, esas marcas se consumen.

Reglas propuestas:

- Duración provisional de la marca: 15 segundos.
- La marca pertenece al mago que la aplicó.
- Un mismo mago puede marcar a varios aliados.
- Varios magos pueden marcar al mismo aliado sin pisarse entre sí.
- Volver a lanzar Eco sobre el mismo aliado refresca su marca.
- Solo las curas directas de Cronomancia activan Eco.
- HoTs, escudos, pociones, regeneración y curas recibidas de otros personajes no lo activan.
- Las copias no pueden activar ni volver a replicar Ecos.
- Las copias no realizan una tirada de crítico independiente.
- La copia parte de la potencia resuelta de la cura antes de limitarla por overhealing.
- Cada receptor aplica normalmente su reducción de curación y su límite de vida.
- Los Ecos se consumen antes de aplicar las copias para impedir recursión.
- Los objetivos se resuelven en orden estable de identificador para preservar determinismo.
- Inicialmente no hay un máximo artificial de marcas. El coste global y el tiempo de lanzamiento de
  Eco ya limitan cuántos aliados puede preparar el jugador.

### Decisiones todavía abiertas

- Porcentaje final replicado: 50%, 70% o 100%.
- Duración final de la marca.
- Coste de maná y tiempo de reutilización global.
- Si el aliado debe seguir dentro de alcance cuando la cura activa los Ecos.
- Si una cura de área puede consumir Ecos. La recomendación inicial es que no.
- Si Eco debe curar al aplicarse o limitarse a colocar la marca.

## 4. Mecánica central: Rebobinar

Rebobinar es el cooldown de sanación más fuerte de Cronomancia. La versión completa que examina
libremente los últimos segundos de cada personaje es posible, pero requiere almacenar un historial
móvil de daño y resolver muchos casos especiales. No se recomienda para v1.

### Rebobinar mediante Ancla, recomendado para v1

1. Ancla temporal aplica una marca a un aliado durante una ventana corta.
2. La marca acumula solamente la vida realmente perdida durante esa ventana.
3. El daño absorbido o reducido no cuenta como vida perdida.
4. Rebobinar consume las Anclas válidas y cura un porcentaje del daño registrado.

Este modelo consigue la fantasía de anticipar y revertir el daño sin mantener un historial global
permanente para todas las entidades.

Reglas propuestas:

- Ancla temporal registra daño después de mitigaciones y absorciones.
- No registra más daño que la vida que el objetivo tenía antes del golpe.
- La curación de Rebobinar no puede resucitar a un objetivo muerto.
- La cantidad registrada tiene un límite basado en la vida máxima del objetivo.
- Rebobinar consume el registro aunque parte de su curación sea overhealing.
- Cada Ancla conserva el identificador del mago que la aplicó.
- Dos Cronomantes pueden mantener Anclas independientes sobre el mismo aliado.
- El orden de resolución debe ser determinista.

### Rebobinado libre, posible para una fase posterior

Una versión futura podría recuperar un porcentaje de toda la salud perdida durante los últimos 4
segundos sin exigir Ancla previa. Esto requeriría una cola temporal de impactos por entidad y reglas
específicas para:

- Golpes letales y resurrección.
- Duelos que detienen al jugador a 1 de vida.
- Arena y Fiesta.
- Cambios de vida máxima.
- Absorciones y reducciones de daño.
- Daño periódico.
- Desconexión, muerte y limpieza del historial.

Esta variante se considera de dificultad alta y queda fuera de la primera implementación.

## 5. Kit provisional

### Signatura y maestría

- Rebobinar, signatura provisional: consume las Anclas temporales y restaura una parte del daño que
  han registrado. Cooldown largo, orientado a emergencias de grupo.
- Ecos del porvenir, maestría provisional: incrementa la potencia de las copias de Eco o añade una
  pequeña repetición retardada a las curas directas. Debe elegirse una sola versión para evitar que
  la maestría tenga dos identidades.

### Habilidades principales

- Remiendo temporal: cura directa eficiente y fiable. Es la herramienta básica cuando no hay un
  enemigo disponible.
- Eco: pequeña cura y marca que replica la siguiente cura directa.
- Ancla temporal: comienza a registrar la vida perdida por el aliado.
- Rebobinar: gran cooldown que consume el daño registrado.
- Barrera temporal: escudo preventivo sobre un aliado.
- Eco benévolo: curación retardada de un solo pulso. Puede ser una habilidad o un talento, no es
  imprescindible si la maestría ya repite curaciones.
- Baliza del éter: parte del daño arcano del mago cura a un aliado marcado. Mecánica opcional para
  aportar actividad durante ventanas tranquilas.
- Aceleración: utilidad temporal que mejora brevemente el lanzamiento o el movimiento de un aliado.
- Estasis: almacena una cura para liberarla después. Interesante, pero se reserva para una fase
  posterior por su mayor complejidad.

### Supervivencia y utilidad compartidas

Cronomancia puede conservar herramientas compartidas como Polimorfia, Blink, Intelecto Arcano y
una selección limitada de hechizos ofensivos. El kit debe usar gating por spec siguiendo el
precedente del warrior. Al comprometer Cronomancia, el personaje no puede conservar a la vez todo
el arsenal completo de Piromancia y Criomancia junto a sus curas.

## 6. Viabilidad técnica en el juego actual

### Infraestructura que ya existe

El motor ya dispone de:

- Curas directas con crítico, modificadores de salida y entrada, absorción de curación y amenaza.
- HoTs con ticks deterministas.
- Escudos de absorción.
- Auras con duración, valor, escuela e identificador de lanzador.
- Auras iguales de lanzadores distintos sobre un mismo objetivo.
- Efectos que consumen auras.
- Daño que genera curación como precedente.
- Gating de habilidades por spec.
- Eventos de curación, auras y efectos visuales compartidos por offline y online.

### Trabajo nuevo para Eco

Eco es una mecánica de dificultad media-baja:

1. Añadir una marca de aura de Eco.
2. Resolver todos los Ecos pertenecientes al lanzador después de una cura directa válida.
3. Separar la potencia resuelta de la curación efectiva para que el overhealing del objetivo
   principal no reduzca las copias a cero.
4. Aplicar las copias sin una nueva tirada de crítico y sin permitir recursión.
5. Consumir las marcas y emitir los eventos de aura y curación correspondientes.
6. Añadir VFX, tooltips, i18n y pruebas.

### Trabajo nuevo para Rebobinar con Ancla

Rebobinar mediante Ancla es una mecánica de dificultad media:

1. Añadir un aura de Ancla que almacene el daño registrado.
2. Insertar un hook estrecho después de que el núcleo de daño conozca la vida realmente perdida.
3. Acumular ese valor solamente en las Anclas aplicables.
4. Consumir el registro desde Rebobinar y pasarlo por la canalización normal de curación.
5. Cubrir explícitamente muerte, absorciones, duelo, arena, Fiesta y expiración.

### Arquitectura recomendada

- Crear `src/sim/combat/chronomancy.ts` para toda la lógica de Eco, Ancla y Rebobinar.
- Mantener en `combat/heal.ts` y `combat/damage.ts` solo hooks breves hacia ese módulo.
- El estado temporal permanece en las auras de las entidades, nunca en variables globales del
  módulo.
- Extender `SimContext` solamente con las llamadas que realmente necesite el nuevo módulo.
- Mantener toda la resolución en el sim autoritativo y determinista.
- No usar `delayedEvents` para ejecutar curación. Actualmente esa cola programa eventos de salida,
  no callbacks de gameplay. Una curación retardada debe usar un aura o un sistema temporal propio.
- Reutilizar los eventos y snapshots existentes cuando sea posible. Solo añadir superficie a
  `IWorld` si la interfaz necesita consultar información temporal que las auras no transporten.

## 7. Riesgos y protecciones

### Eco

- Recursión: una copia no puede activar otra ronda de copias.
- Explosión con AoE: las curas de área no deben activar Eco en v1.
- Orden no determinista: ordenar receptores por identificador.
- Overhealing: copiar potencia resuelta, no curación efectiva del primer objetivo.
- Varios lanzadores: filtrar siempre por `sourceId`.
- Objetivos muertos o desaparecidos: ignorarlos y consumir su marca de forma consistente.
- Amenaza: cada copia genera amenaza según su curación efectiva.

### Rebobinar

- Daño absorbido: no debe entrar en el registro.
- Daño letal: registrar como máximo la vida disponible, pero no permitir resurrección.
- PvP: limitar el porcentaje y la cantidad máxima recuperable.
- Vida máxima temporal: fijar si el tope se calcula al aplicar Ancla o al lanzar Rebobinar. La
  recomendación es calcularlo al lanzar Rebobinar usando la vida máxima actual.
- Expiración: un Ancla expirada pierde su registro.
- Muerte: limpiar Anclas y Ecos según la política normal de auras al morir.

### Balance de rol

- Cronomancia necesita al menos una cura directa fiable.
- El daño arcano no puede ser obligatorio para mantener vivo al grupo.
- Tampoco debe aportar simultáneamente la curación completa de un healer y el daño completo de un
  DPS.
- Eco debe recompensar preparación, pero no hacer que una sola cura elimine todo el daño de raid.
- Rebobinar debe ser potente sin borrar gratuitamente cada error del grupo.

## 8. Filas de talentos y gating

Las seis filas del borrador actual del mago en `talents-2.0.md` están diseñadas para tres specs DPS.
No bastan para una spec healer.

Dirección recomendada:

- Las filas compartidas ofrecen movilidad, control, maná, supervivencia y utilidad que sirven a
  las tres specs.
- La identidad healer vive en el kit exclusivo, la signatura y la maestría de Cronomancia.
- Los talentos que mejoren curación deben tener una alternativa útil para Piromancia y Criomancia,
  o pertenecer a una capa específica de spec si el sistema consolidado finalmente la permite.
- Al comprometer una spec, el libro de hechizos elimina las habilidades reservadas a las otras dos,
  como ya ocurre en el rediseño del warrior.

No se deben adaptar las filas hasta que la alineación final de specs y el kit base estén aprobados.

## 9. Plan de implementación sugerido

### Fase 1: spec y curación convencional

- Definir Cronomancia como healer.
- Añadir Remiendo temporal y Barrera temporal.
- Aplicar gating del kit compartido.
- Añadir signatura y maestría provisionales.
- Validar selección de spec, loadouts, persistencia y hosts.

### Fase 2: Eco

- Implementar la marca multiobjetivo.
- Implementar consumo y copias sin recursión.
- Añadir eventos visuales e indicadores de aura.
- Ajustar coste, duración y porcentaje mediante pruebas de combate.

### Fase 3: Ancla y Rebobinar

- Registrar vida realmente perdida.
- Consumir Anclas con el gran cooldown.
- Cubrir interacciones con absorciones, muerte y PvP.
- Añadir VFX legibles que distingan Ancla, registro y Rebobinar.

### Fase 4: refinamiento

- Baliza del éter y contribución mediante daño, si el ciclo necesita más actividad.
- Revisión de las seis filas de talentos del mago.
- Balance de maná, throughput, burst y amenaza.
- Estasis o rebobinado libre solamente si el kit básico ya está verde y necesita más profundidad.

## 10. Pruebas mínimas requeridas

### Eco

- Un Eco se consume con la siguiente cura directa válida.
- Varios aliados marcados reciben una copia.
- Un aliado sin marca no la recibe.
- Las marcas de otro mago no se consumen.
- La copia no vuelve a activar Eco.
- HoTs, escudos, regeneración y curas ajenas no consumen la marca.
- Overhealing en el objetivo principal no reduce la potencia base de las copias.
- Cada copia se limita por la vida que le falta a su receptor.
- Amenaza de curación usa solamente la curación efectiva.
- La misma semilla y secuencia producen un resultado idéntico.

### Rebobinar

- Ancla registra daño que reduce vida.
- No registra daño absorbido.
- Respeta el límite configurado.
- Rebobinar cura y consume el registro.
- Un Ancla expirada no puede rebobinarse.
- Un objetivo muerto no resucita.
- Dos magos mantienen registros independientes.
- Duelos, Arena y Fiesta conservan sus reglas de derrota.
- Offline, servidor y cliente online observan los mismos resultados.

## 11. Decisiones necesarias antes de bloquear el diseño

1. Confirmar la alineación Piromancia DPS, Criomancia DPS/control y Cronomancia healer.
2. Confirmar que Cronomancia sustituye a Arcano DPS.
3. Confirmar Rebobinar mediante Ancla para v1 en lugar de historial libre.
4. Confirmar las reglas de Eco: porcentaje, duración, alcance y hechizos que lo activan.
5. Elegir la maestría entre potenciar Eco o repetir curaciones de forma retardada.
6. Decidir qué habilidades arcanas permanecen compartidas y cuáles son exclusivas de Cronomancia.
7. Aprobar los nombres finales de la spec y sus hechizos.
8. Rediseñar las filas del mago solamente después de cerrar los puntos anteriores.

## 12. Veredicto técnico

La propuesta es viable con la arquitectura actual.

- Eco: dificultad media-baja y riesgo localizado.
- Rebobinar mediante Ancla: dificultad media y riesgo controlable con pruebas del núcleo de daño.
- Ambas mecánicas juntas: alcance razonable para una spec completa.
- Rebobinado libre, Estasis genérica y daño diferido: dificultad alta, reservar para fases futuras.

La combinación de Eco, Ancla y Rebobinar ofrece una identidad healer clara sin exigir un sistema
temporal general para todo el juego. Es la mejor relación entre fantasía, profundidad y coste
técnico para la primera versión de Cronomancia.

## 13. Revisión recomendada: sanación mediante daño Arcano

Esta revisión incorpora la dirección conversada después del primer borrador. Mantiene Ancla,
Rebobinar, las barreras y una cura directa fiable, pero propone que el ciclo habitual de
Cronomancia gire alrededor de infligir daño Arcano para sanar aliados preparados.

La referencia conceptual es un healer ofensivo, pero la implementación y el balance deben ser
propios de World of Claudecraft. Cronomancia no puede aportar simultáneamente el daño completo de
una especialización DPS y la curación completa de un healer.

### 13.1 Nueva mecánica central: Eco temporal

Cronomancia aplica `Eco temporal` sobre un aliado. Mientras la marca permanece activa, una parte
del daño Arcano realmente infligido por ese mago se convierte en curación para el aliado marcado.

Valores provisionales para el primer playtest:

- Duración: 15 segundos.
- Conversión de daño Arcano de objetivo único: 35%.
- Un objetivo marcado de base.
- Eco temporal realiza una pequeña cura inicial al aplicarse.
- Cada impacto Arcano válido produce su propia curación.
- Si el impacto original es crítico, la curación usa esa potencia ya resuelta; no realiza una
  segunda tirada de crítico independiente.
- El daño de área usa una conversión reducida provisional del 15%.
- La curación genera amenaza según la curación efectiva realizada.
- Volver a aplicar Eco temporal sobre el mismo aliado refresca su duración.
- La marca pertenece al mago que la aplicó. Dos Cronomantes pueden mantener marcas independientes
  sobre el mismo aliado.

Los porcentajes son puntos de partida para simulación y playtest, no valores bloqueados.

### 13.2 Convergencia temporal: preparación de grupo

`Convergencia temporal` es la versión grupal de Eco temporal:

- Aplica Eco temporal a los aliados cercanos del grupo.
- Tiene un cooldown provisional de 20 a 30 segundos.
- Tiene un coste de maná elevado para impedir que sustituya permanentemente la preparación
  individual.
- Respeta un radio y un número máximo de objetivos que deben cerrarse mediante pruebas.
- No aumenta la conversión por tener varias marcas del mismo mago sobre un objetivo.

La intención es responder a ventanas de daño grupal anunciadas, no mantener a toda la banda
marcada durante todo el encuentro.

### 13.3 Ciclo de juego esperado

1. El Cronomante coloca Eco temporal sobre el tanque o el aliado que espera que reciba daño.
2. Usa hechizos arcanos para producir sanación de mantenimiento mientras contribuye daño.
3. Decide cuánto maná comprometer acumulando Explosión Arcana.
4. Misiles Arcanos estabiliza la vida mediante varios pulsos de curación pequeños y constantes.
5. Si no puede atacar o un aliado necesita atención inmediata, usa Remiendo temporal.
6. Antes de una ráfaga peligrosa, coloca Ancla temporal sobre el objetivo prioritario.
7. Después del impacto, utiliza Rebobinar para recuperar parte de la vida realmente perdida.
8. Entre ventanas peligrosas, recupera maná, refresca marcas y prepara el siguiente ciclo.

Cronomancia combina así dos familias de sanación:

- Daño Arcano convertido en curación para el mantenimiento activo.
- Preparación, prevención y reversión temporal para responder a ráfagas.

El healer debe seguir siendo funcional cuando no existe un enemigo válido o una mecánica impide
atacar. Eco temporal es su vía más eficiente y dinámica, pero no su única fuente de sanación.

### 13.4 Explosión Arcana y presión de maná

Explosión Arcana debe ser la principal decisión de riesgo y recompensa de la especialización.

Propuesta provisional:

- Cada lanzamiento concede una acumulación que aumenta un 20% el daño de la siguiente Explosión
  Arcana y, por extensión, la curación producida mediante Eco temporal.
- Cada acumulación incrementa considerablemente el coste de maná del siguiente lanzamiento.
- Máximo de cuatro acumulaciones.
- Misiles Arcanos consume o reduce las acumulaciones.
- Dejar de lanzar Explosión Arcana durante una ventana corta elimina las acumulaciones.
- Las acumulaciones modifican el daño antes de calcular la conversión de Eco temporal.

La pregunta jugable debe ser: ¿gasto una parte enorme de mi maná para salvar al tanque ahora o
mantengo una rotación eficiente y conservo recursos para la siguiente mecánica?

Sin esta presión de maná, la sanación mediante daño se volvería demasiado automática y no tendría
una contrapartida real.

### 13.5 Papel de Misiles Arcanos

Misiles Arcanos es la herramienta de estabilización eficiente:

- Sus múltiples impactos producen curaciones pequeñas y frecuentes sobre los Ecos temporales.
- Ofrece una curva de sanación más suave que Explosión Arcana.
- Puede recibir procs que reduzcan su tiempo de canalización o su coste, pero no debe convertirse
  permanentemente en un hechizo instantáneo y gratuito.
- Puede reducir o consumir acumulaciones de Explosión Arcana para cerrar el ciclo de maná.

Un proc equivalente a una ráfaga de misiles sería apropiado como talento o pasiva de
especialización, siempre que sus curaciones respeten las mismas reglas de conversión y no puedan
activar recursión.

### 13.6 Kit recomendado revisado

- `Eco temporal`: pequeña cura inicial y marca individual que convierte daño Arcano en curación.
- `Convergencia temporal`: aplicación grupal y costosa de Eco temporal.
- `Explosión Arcana`: fuente de daño y sanación fuerte con coste creciente por acumulaciones.
- `Misiles Arcanos`: estabilización eficiente mediante múltiples impactos.
- `Remiendo temporal`: cura directa fiable para emergencias y situaciones sin enemigo.
- `Preservación cronostática`: prepara una cura que puede almacenarse y liberarse después de forma
  instantánea. Su primera versión puede tener una duración y una sola carga claramente limitadas.
- `Ancla temporal`: registra la vida realmente perdida por el aliado durante una ventana corta.
- `Rebobinar`: consume Anclas y restaura una parte del daño registrado.
- `Barrera temporal`: escudo preventivo individual.
- `Aetherwell`: recuperación de maná y preparación de la siguiente ventana ofensiva.

Preservación cronostática es atractiva como botón de pánico, pero sigue siendo de una fase
posterior si almacenar una cura arbitraria amplía demasiado el primer corte. La v1 puede salir con
Remiendo temporal como respuesta inmediata y añadir Preservación cuando el núcleo esté verde.

### 13.7 Relación con el Eco del primer borrador

La versión inicial de este documento hacía que Eco replicara la siguiente cura directa sobre todos
los aliados marcados. Esa mecánica es válida, pero compite con Eco temporal por ser el núcleo de la
especialización.

Dirección recomendada:

- Eco temporal y la conversión de daño Arcano pasan a ser el ciclo central constante.
- Ancla y Rebobinar conservan la identidad de manipulación del tiempo.
- La replicación de curas directas deja de ser una segunda mecánica central.
- Esa replicación puede sobrevivir como talento o maestría futura, con límites claros y sin
  recursión.

El objetivo es evitar que Cronomancia tenga que administrar simultáneamente tres minijuegos
centrales: conversión de daño, consumo de marcas de cura y registro de daño.

### 13.8 Maestría recomendada

La maestría debe reforzar una sola identidad. Con Eco temporal como núcleo, la opción recomendada
es aumentar modestamente su porcentaje de conversión o mejorar su cura inicial.

No debe al mismo tiempo:

- aumentar la conversión;
- replicar curas directas;
- y repetir curaciones de forma retardada.

Una maestría sencilla mantiene legible el balance y permite que la profundidad venga de la
rotación, el maná, Ancla y Rebobinar.

### 13.9 Protecciones obligatorias de balance

- La conversión usa daño realmente infligido, nunca daño teórico previo a mitigación.
- No convierte daño contra objetivos invulnerables.
- No cuenta daño que exceda la vida restante del enemigo.
- Las curaciones producidas por Eco temporal no pueden activar nuevas curaciones, copias ni procs
  de conversión.
- El daño periódico, los canales y los proyectiles deben atribuirse al lanzador original.
- El daño de área tiene un coeficiente de conversión reducido.
- La cantidad de aliados marcados queda limitada por la aplicación individual, el coste, el
  cooldown grupal y, si fuera necesario, un máximo explícito.
- PvP usa una reducción específica de conversión y puede aplicar un límite por impacto.
- Las marcas se limpian correctamente al morir, abandonar el grupo, desconectarse o desaparecer la
  entidad.
- Varios Cronomantes filtran siempre sus marcas por `sourceId`.
- La misma semilla y secuencia de acciones debe producir el mismo resultado.

### 13.10 Objetivo de daño y curación

Como dirección de balance inicial, un Cronomante ejecutado correctamente debería aportar
aproximadamente entre el 50% y el 65% del daño de una especialización DPS pura con equipo y
condiciones equivalentes.

Su curación completa debe exigir:

- preparar Eco temporal antes del daño;
- mantener una rotación Arcana válida;
- administrar las acumulaciones y el maná;
- y usar Ancla, Rebobinar, barreras y curas directas en las ventanas correctas.

Remiendo temporal y las herramientas convencionales deben mantener al grupo con vida cuando no se
puede atacar, pero ser menos eficientes que el ciclo ofensivo bien ejecutado. Piromancia y
Criomancia siempre deben superar claramente a Cronomancia en daño sostenido.

### 13.11 Viabilidad técnica adicional

El motor ya tiene precedentes de daño que genera curación, impactos canalizados, auras por
lanzador, amenaza de curación y resolución determinista. Eco temporal sigue siendo una mecánica de
dificultad media con riesgo localizado.

El módulo `src/sim/combat/chronomancy.ts` debería:

1. Identificar impactos arcanos válidos después de conocer el daño efectivo.
2. Buscar Ecos temporales pertenecientes al lanzador en orden estable de entidad.
3. Calcular la conversión según objetivo único, área, PvE o PvP.
4. Aplicar la cura por la canalización normal sin permitir recursión.
5. Emitir eventos de curación, amenaza y VFX compartidos por offline y online.

Explosión Arcana debe almacenar sus acumulaciones en un aura del lanzador. No debe usar estado
global ni temporizadores fuera del sim. Preservación cronostática, si se implementa, debe guardar
una cantidad resuelta y limitada en un aura propia, nunca una función o callback diferido.

### 13.12 Plan de implementación revisado

#### Fase 1: rol y herramientas independientes

- Definir Cronomancia como healer y aplicar gating por especialización.
- Añadir Remiendo temporal y Barrera temporal.
- Conservar una selección limitada de hechizos arcanos ofensivos.
- Validar selección de spec, loadouts, persistencia, barra y hosts.

#### Fase 2: Eco temporal

- Implementar la marca individual y la cura inicial.
- Convertir daño Arcano efectivo de objetivo único.
- Añadir el coeficiente reducido para área.
- Cubrir atribución, amenaza, críticos, overhealing, muerte, PvP y múltiples lanzadores.
- Añadir indicadores de aura y VFX legibles.

#### Fase 3: rotación Arcana y maná

- Implementar acumulaciones y coste creciente de Explosión Arcana.
- Integrar Misiles Arcanos como estabilizador y consumidor de acumulaciones.
- Añadir Convergencia temporal para ventanas de grupo.
- Medir daño, HPS, overhealing y tiempo hasta agotar maná.

#### Fase 4: Ancla y Rebobinar

- Registrar vida realmente perdida tras mitigación y absorciones.
- Consumir Anclas mediante Rebobinar.
- Cubrir daño letal, muerte, duelos, Arena, Fiesta y varios Cronomantes.

#### Fase 5: refinamiento

- Añadir Aetherwell y cerrar el ciclo de recuperación de maná.
- Evaluar Preservación cronostática como herramienta almacenada.
- Considerar replicación de curas como talento o maestría, no como segundo núcleo.
- Ajustar filas de talentos, VFX, i18n y tooltips.

### 13.13 Pruebas mínimas adicionales

- El daño Arcano efectivo cura al aliado marcado según el porcentaje configurado.
- El daño no Arcano no activa Eco temporal.
- El daño absorbido o negado sobre el enemigo no produce curación ficticia.
- El daño superior a la vida restante no aumenta la curación.
- Un crítico no realiza una segunda tirada de crítico para la cura.
- El daño de área usa su coeficiente reducido.
- Las marcas de otro Cronomante no se activan ni consumen.
- La cura de Eco temporal no puede activar otra conversión.
- Explosión Arcana aumenta daño, curación y coste por acumulación.
- Misiles Arcanos reduce o consume las acumulaciones según la regla final.
- Quedarse sin un enemigo no impide utilizar Remiendo temporal, barreras o Rebobinar.
- Convergencia temporal respeta grupo, alcance, máximo de objetivos y cooldown.
- PvP aplica su reducción sin cambiar el resultado PvE.
- El daño y la curación coinciden entre offline, servidor y cliente online.

### 13.14 Decisiones que siguen abiertas

1. Nombre final de Eco temporal y Convergencia temporal.
2. Porcentaje de conversión individual y de área.
3. Duración, coste y alcance de las marcas.
4. Máximo de aliados marcados y objetivos de Convergencia temporal.
5. Incrementos exactos de daño y coste de Explosión Arcana.
6. Regla exacta con la que Misiles Arcanos consume acumulaciones.
7. Reducción y límites específicos para PvP.
8. Si Preservación cronostática entra en v1 o en una fase posterior.
9. Si la maestría mejora la conversión o la cura inicial de Eco temporal.
10. Qué habilidades arcanas conserva Cronomancia después del gating.

### 13.15 Veredicto revisado

La sanación mediante daño Arcano encaja mejor como ciclo habitual de Cronomancia que la
replicación constante de curas directas. La combinación recomendada es:

- Eco temporal para mantenimiento ofensivo.
- Explosión Arcana y Misiles Arcanos para riesgo, eficiencia y gestión de maná.
- Remiendo temporal y Barrera temporal como herramientas independientes del enemigo.
- Ancla y Rebobinar como identidad fuerte de manipulación temporal.
- Aetherwell como recuperación y preparación de la siguiente ventana.

Esta dirección produce un healer proactivo y reconocible sin convertirlo en un DPS completo que
también cura gratis. Sigue siendo viable con la arquitectura actual y puede construirse por fases
con riesgo controlado.

## 14. Registro de implementacion: Fase 1 (2026-07-11, rama mage/frost-spec)

Estado: Fase 1 IMPLEMENTADA en esta rama. Esta seccion registra las decisiones tomadas al
construirla. Los numeros son de playtest, no definitivos.

### 14.1 Decision del ID interno

La especializacion conserva el id interno estable `arcane`. Un barrido completo de `src/` y
`server/` confirmo que ningun codigo lo trata como un caso especial (solo se consume de forma
generica via `SpecDef.id`, `alloc.spec`, `mods.spec` y `def.specs.includes`), y no existe una
migracion probada de ids de spec persistidos, asi que personajes, builds y loadouts existentes
sobreviven sin tocarse. La presentacion cambia por completo: nombre `Chronomancy` /
`Cronomancia`, rol `healer` (la tarjeta de especializacion ya lo muestra via el `roleLabel`
generico), y descripcion centrada en reparar, prevenir y revertir.

### 14.2 Kit Fase 1 y valores provisionales

Remiendo temporal (`temporal_mend`, signatura de la spec, concedida al comprometer):
cura directa aliado/uno mismo, alcance 30 (el estandar de todas las curas), casteo 2.0 s,
sin cooldown, escuela arcana, critico y amenaza por la canalizacion normal (`applyHeal`).
Rangos: n1 (5) 62-74 por 45 mana; n2 (12) 105-125 por 70; n3 (18) 150-178 por 95.
Justificacion: a nivel 20 queda entre la Ola de sanacion del chaman (2.5 s, 90 mana,
138-164) y el Toque de sanacion del druida (3.0 s, 110, 175-208), con el casteo de 2.0 s
pedido; su HPS (~82/s antes de poder de hechizo) es deliberadamente algo menor que el de la
Plegaria solemne del sacerdote (~100/s), el healer de referencia.

Barrera temporal (`temporal_barrier`): escudo individual aliado/uno mismo, instantaneo y
DENTRO del GCD, cooldown 12 s, duracion 10 s, alcance 30, escuela arcana, canalizacion normal
de absorciones (aura kind `absorb`). Rangos: n1 (5) 55 por 50 mana; n2 (12) 100 por 75;
n3 (18) 160 por 105. Justificacion: el Salmo de proteccion del sacerdote absorbe 145 con 6 s
de cooldown y ventana de 30 s; la Barrera absorbe un bloque mayor con la mitad de cadencia y
una ventana corta de 10 s, encajando el rol preventivo pedido. Regla de relanzamiento (el
patron existente de absorciones): el MISMO lanzador REEMPLAZA su escudo por uno fresco a valor
completo (nunca se acumula consigo mismo); lanzadores DISTINTOS coexisten. El dano absorbido
nunca reduce vida, asi que queda fuera del registro del futuro Ancla por construccion.

### 14.3 Signatura y maestria provisionales

- Signatura: `temporal_mend` (sustituye a `arcane_power` en el slot de signatura). DEUDA:
  `arcane_power` (Aether Surge) queda definido pero sin referencia; se decidira su destino en
  la revision de filas.
- Maestria provisional: `Chronoweave` / `Cronotejido`, `{ global: { healPct: 0.15 } }`
  ("Increases all healing you do by 15%."), escalada por nivel/20 como toda maestria. Es el
  mismo campo generico que usa la maestria del sacerdote sagrado; en la practica solo toca el
  kit de curacion de Cronomancia porque es la unica fuente de curas de la spec. NOTA: el motor
  aplica `healPct` tambien al valor de las absorciones propias (la Barrera se beneficia, 160
  base -> 184 a nivel 20 con maestria completa), registrado en tests. Esta maestria es un
  marcador de posicion hasta que Eco temporal exista (seccion 13.8).
- No se creo `src/sim/combat/chronomancy.ts`: la Fase 1 se resuelve entera con `AbilityDef` y
  los efectos existentes (`heal`, `absorb`) sin logica especifica. El modulo nacera con Eco
  temporal (Fase 2), como recomienda la seccion 6.

### 14.4 Inventario y clasificacion del gating

Mecanismo: `specs: ['fire', 'frost']` en las definiciones excluye SOLO al healer preservando
byte a byte los libros de Fuego y Escarcha; `specs: ['arcane']` marca el kit exclusivo del
healer. Los talentos de filas (utilidad compartida) son independientes de la spec y no se
tocaron; Cold Snap y la fila Warded/Overflowing Power reconocen ahora `temporal_barrier` en el
slot de barrera personal, asi que ninguna opcion de fila queda muerta para Cronomancia.

| Habilidad | Clasificacion | Nota |
|---|---|---|
| fireball, frostbolt | Compartida | relleno basico de leveleo (niveles 1-4 sin spec) |
| frost_armor, arcane_intellect, conjure_food/water | Compartida | sostenimiento y buffs |
| arcane_missiles, arcane_explosion | Compartida | nucleo arcano de fases futuras (13.4/13.5) |
| polymorph, blink, frost_nova | Compartida | control/escape; frost_nova AMBIGUA, ver 14.5 |
| fire_blast, scorch, pyroblast, flamestrike | Piromancia+Criomancia | kit ofensivo, fuera del healer |
| ice_barrier | Piromancia+Criomancia | barrera personal DPS; el healer usa la suya |
| ice_lance, flurry, frozen_orb, blizzard, water elemental, pasivas frost | Criomancia | ya gateadas |
| meteor, blazing_barrier, ignition, hot_streak | Piromancia | ya gateadas |
| combustion / icy_veins | signaturas fire/frost | concedidas por spec, sin cambio |
| temporal_mend, temporal_barrier | Cronomancia | nuevo kit Fase 1 |
| filas (evocation, presence_of_mind, ice_floes, greater_invisibility, rings_of_frost, cold_snap, mass_barrier, overload, power_echo, rune_of_power, etc.) | Compartida via filas | utilidad para las tres specs |
| cone_of_cold, counterspell, deep_freeze, ice_block | HUERFANAS | definidas pero inaprendibles hoy (deuda previa, sin cambio) |

### 14.5 Casos ambiguos pendientes de decision del operador

Clasificados de forma conservadora como COMPARTIDOS (no se excluye nada ambiguo sin
confirmacion): (1) `frost_nova`, escape universal clasico pero de sabor escarcha; (2)
`fireball`/`frostbolt` completos hasta el rango maximo (una alternativa seria congelar al
healer en rangos bajos); (3) las filas de sabor escarcha (`ice_floes`, `rings_of_frost`)
siguen elegibles para el healer. Cambiar cualquiera es un ajuste de una linea.

## 15. Registro de implementacion: Fase 2 (2026-07-12, rama mage/frost-spec)

Estado: Fase 2 (Eco temporal) IMPLEMENTADA en esta rama, sobre la Fase 1. Esta seccion registra
las decisiones tomadas al construirla. Los numeros son de playtest, no definitivos.

### 15.1 Eco temporal es DIRECTO, sin proyectil

Al lanzarse, Eco temporal NO dispara ninguna onda ni proyectil que viaje hasta el aliado. Aparece
directamente un glifo temporal breve SOBRE el objetivo (evento `spellfx` con `fx: 'temporalGlyph'`,
anclado al `targetId`, color arcano, reutilizando `wardBloom` + un pulso discreto en el renderer).
La marca queda como un aura de buff discreta (icono propio de `temporal_echo`). Cada curacion de
conversion emite un `heal2` que produce el numero flotante y un pulso pequeno de curacion sobre el
aliado (el `healGlow` estandar), sin proyectil hacia el, evitando ruido con Misiles Arcanos. El
proyectil de Misiles Arcanos sigue viajando al ENEMIGO como siempre; solo la curacion aparece
directa sobre el aliado marcado.

### 15.2 Kit Fase 2 y valores provisionales

Eco temporal (`temporal_echo`): exclusivo de Cronomancia (`specs: ['arcane']`), en el libro base
(gateado por spec, NO concedido, para que el filtro de spec aplique). Instantaneo, dentro del GCD,
sin cooldown, alcance 30, escuela arcana, `targetType: 'friendly'` (aliado o uno mismo). Se
construye con DOS efectos: un `heal` normal (la cura inicial, alimenta `$d` y puede critear como
cualquier cura directa) y un efecto nuevo minimo `temporalEcho` (solo lleva `duration`, alimenta
`$t` y coloca la marca). Rangos: n1 (5) cura 24-30 por 40 mana; n2 (12) 40-50 por 60; n3 (18)
58-70 por 85. Marca: 15 s. Justificacion: la cura inicial es deliberadamente pequena (~40% de
Remiendo temporal) porque el grueso de la sanacion viene de la conversion; el maná moderado y el
GCD, mas la regla de una sola marca propia, limitan el spameo.

Conversion de dano Arcano efectivo (constantes, no almacenadas en la marca): objetivo unico 35%,
area 15%. Se aplica al dano REALMENTE INFLIGIDO (`preHp - target.hp` en `dealDamage`, es decir tras
mitigacion, tras absorciones y tras recortar el overkill), de modo que el dano absorbido, evitado,
inmunizado o que excede la vida del enemigo NO fabrica curacion. Redondeo por impacto (Misiles
Arcanos cura por cada misil). El daño de wand (arma a distancia del mago, escuela arcana) tambien
convierte al 35% por ser dano Arcano real del mago; es marginal y coherente.

### 15.3 Arquitectura

- Modulo nuevo `src/sim/combat/chronomancy.ts`: `placeTemporalEcho` (mueve la marca del mismo
  lanzador y coloca la nueva + glifo), `chronomancyConvertArcaneDamage` (el hook de conversion) y
  `stripTemporalEchoes` (limpieza por `sourceId`). Todo el estado vive en auras, nunca en variables
  globales del modulo.
- Hook en el nucleo de dano: una sola llamada en `dealDamage` (damage.ts), justo tras conocer el
  dano aplicado. `dealDamage` recibe un parametro nuevo opcional `aoe` (por defecto `false`) que
  distingue objetivo unico de area; el loop de `aoeDamage` (Aetherburst) lo pasa `true`. Cualquier
  otro llamante queda byte-identico.
- Determinismo: la curacion de conversion NO dibuja rng (el critico del dano ya esta resuelto; la
  cura nunca tira su propio critico). Se aplica por una funcion propia sin critico (`applyEchoHeal`,
  reutilizando `healingTakenMult`/`consumeHealAbsorb`/`healingThreat` de heal.ts), nunca por
  `dealDamage`, asi que no puede recursar ni activar otra conversion. La curacion de Eco no puede
  curar ni resucitar objetivos muertos (guarda `ally.dead`).
- Separacion por `sourceId`: la marca lleva el id del mago; dos Cronomantes mantienen marcas
  independientes sobre el mismo aliado y cada uno solo convierte con la suya.
- Limpieza: al cambiar de spec fuera de Cronomancia (`applyTalentAllocation`) y al morir el mago
  (`handleDeath`) se retiran las marcas que ese mago coloco (por `sourceId`); la marca sobre un
  aliado que MUERE ya la retira `aurasSurvivingDeath` por el camino normal de muerte.
- Paridad offline/online: todo son eventos (`heal2`, `aura`, `spellfx`) y estado de aura que viajan
  al cliente verbatim (sin allowlist), y una marca nueva se pinta como buff automaticamente. El
  `fx: 'temporalGlyph'` nuevo se anade a la union en types.ts y a una rama en el renderer.

### 15.4 Maestria y conversion

La maestria de Fase 1 (Chronoweave, `global.healPct`) se aplica dentro de `applyHeal` (curas
directas y absorciones propias), pero NO se aplica a la curacion de conversion de Eco temporal:
la conversion usa `Math.round(danoEfectivo * tasa)` limpio. Es una decision consciente para
mantener el numero de conversion legible y testeable (100 de Arcano single -> 35 exacto) y porque
la maestria de Fase 1 se definio como refuerzo de la curacion DIRECTA. Cuando se cierre la maestria
definitiva de Cronomancia (seccion 13.8, potenciar Eco), se decidira si la conversion escala.

### 15.5 No implementado en Fase 2 (deuda por fases posteriores)

Convergencia temporal (aplicacion grupal), acumulaciones nuevas de Explosion Arcana y su presion de
maná, Misiles Arcanos consumiendo acumulaciones, Ancla temporal, Rebobinar, Preservacion
cronostatica, reduccion especifica de PvP para la conversion (los early-returns PvP de `dealDamage`,
duelo/fiesta/arena, NO convierten hoy) y la revision completa de filas de talentos del mago.
