# Dual Offices: plan de trabajo ODD

Construir un home local que permita usar en paralelo las oficinas existentes de Claude y una oficina nueva de Codex, con procesos, estado de aplicación y navegación separados. El objetivo es habilitar trabajo simultáneo sin migrar ni alterar los datos ni la URL actuales de Claude.

## Problema y motivación

El servidor actual fija configuración y proveedor al iniciar, y usa raíces compartidas para tareas, rutinas y otros estados. Un segundo panel dentro del mismo proceso no garantizaría aislamiento. La solución aprobada separa las oficinas por proceso y raíces escribibles, manteniendo la continuidad de Claude y aprovechando la instalación local de Codex sin inspeccionar credenciales.

## Alcance aprobado

- Lanzador/home local con readiness independiente para cada oficina.
- Procesos independientes de Claude y Codex; ninguna oficina actúa como proxy de tareas/chat de la otra.
- Raíces distintas de configuración, datos, brain y personalizaciones; assets distribuidos compartidos solo como entradas inmutables.
- Conservación no destructiva de las rutas y estado existentes de Claude, y enlaces directos entre oficinas basados en URLs efectivas de runtime.
- Adaptador Codex basado en `@openai/codex-sdk`, autenticación local reutilizada por defecto, capacidades reportadas por el runtime y errores visibles sin fallback al otro proveedor.
- Verificación funcional local con dobles, sin requerir autenticación ni llamadas a proveedores reales.

## Restricciones y decisiones

| Área | Restricción / decisión |
|---|---|
| Claude | Conservar datos, configuración, brain, roster, skills y URL existentes; no mover, renombrar, limpiar ni reescribirlos. Puerto predeterminado existente: `4520`. |
| Codex | Estado app-owned separado (`office.config.codex.local.json`, `data-codex/`, `brain-codex/` por defecto); reutilizar la configuración/home local Codex existente, incluida `CODEX_HOME` explícita. No leer, copiar, exportar ni registrar tokens. |
| Aislamiento | Los procesos tienen proveedor/raíces fijos al arrancar. No compartir archivos JSON/DB, colas, schedulers, cachés mutables, brains escribibles ni overlays. Los enlaces cambian solo la navegación y no cancelan tareas. |
| Home y enlaces | Defaults de puertos: launcher `4519`, Claude `4520`, Codex `4521`; validar unicidad y usar URLs efectivas de runtime, no destinos hardcodeados en la UI. |
| Auth y permisos | Reutilizar login válido local sin provocar login inesperado. No ampliar sandbox/permisos ni activar full access como alternativa. Si no está autenticado o una aprobación no se puede representar con seguridad, informar y dejar pendiente/bloqueado; nunca fallback a Claude. |
| Diagnóstico | No buscar, matar ni reutilizar procesos, PIDs, puertos o credenciales ajenos. El lanzador solo supervisa procesos que inició. No realizar probes remotos, auth real ni transferencia de archivos. |
| Integración | El plan parte del worktree hermano `agents-office-worktrees/dual-offices`; antes de integrar, reconciliar los archivos compartidos con el checkout fuente que tiene cambios locales. No ejecutar verificaciones potencialmente mutantes en ese checkout. |

## Puerta técnica

**GO condicionado para implementar** con la API pública de `@openai/codex-sdk` en la versión validada `0.157.1`: usar únicamente controles y eventos que el SDK exponga, mostrar progreso honesto y conservar la política de workspace/sandbox/aprobación. La autenticación tipada no está soportada por el SDK validado; no simularla ni leer credenciales. Las pruebas del adaptador usarán un SDK doble inyectado. Si aparece una dependencia de errores de autenticación tipados o de capacidades no confirmadas, detener ese alcance y devolverlo para rediseño, sin sustituirlo por probes de cuenta.

## TDD y verificación

- **Strict TDD:** activo (`true`), según `AGENTS.md` / contexto del proyecto.
- **Runner exacto:** `node --test test/*.test.mjs`.
- **Baseline observada:** `56` pruebas pasan antes de la implementación.
- Aplicar RED → GREEN → REFACTOR para cada unidad. Las verificaciones planeadas por el plan incluyen pruebas enfocadas, suite completa, `npm run build`, `npm run check` y `git diff --check`; registrar resultados observados y no inferidos.
- No usar `npm run check:live` ni llamar proveedores/cuentas reales como parte de la verificación predeterminada.

## Criterios de aceptación

- [ ] El home permite entrar a Claude o Codex y cada oficina enlaza directamente a la otra.
- [ ] Ambas oficinas mantienen tareas simultáneas; cambiar de vista no cancela ni detiene procesos.
- [ ] Configuración, tareas/chats, rutinas, notes/brain, roster, skills, uso y estado de UI son independientes entre oficinas.
- [ ] Claude conserva su comportamiento, URL y datos preexistentes sin migración ni escrituras destructivas.
- [ ] Un login Codex local válido se reutiliza sin prompting inesperado, lectura o copia de tokens.
- [ ] Codex expone únicamente modelos, herramientas, controles y eventos que el runtime confirma; auth/permisos/errores quedan visibles y no hay fallback de proveedor.
- [ ] Colisiones de puertos/rutas, fallas de hijos y de almacenamiento se informan por oficina sin afectar a la otra ni importar/limpiar su estado.
- [ ] Pruebas cubren resolución de rutas, unicidad de puertos, aislamiento, concurrencia, navegación, fallas, no-fallback y preservación del estado Claude.

## Tareas estables

Cada tarea corresponde a la tarea numerada equivalente del plan `docs/superpowers/plans/2026-09-28-dual-offices.md`. Las casillas se marcan solo tras observar implementación y evidencia de verificación.

- [x] **DO-01 — Resolver rutas y configuración aisladas** (Plan, Tarea 1). `resolveOfficePaths` y `validateOfficePair` preservan los defaults de Claude, separan config/data/brain Codex, honran overrides y `CODEX_HOME` explícitos, canonicalizan alias y rechazan rutas superpuestas o puertos duplicados. Prueba centinela confirma que no se modifican archivos Claude ni se crean raíces Codex durante la resolución. Evidencia final: `node --test test/office-paths.test.mjs` (12/12) y `node --test test/*.test.mjs` (68/68); commits de unidad registrados abajo y correcciones revisadas independientemente.
- [x] **DO-02 — Aislar el servidor por proceso** (Plan, Tarea 2). Runtime con proveedor/identidad fijados al inicio, rutas mutables separadas por `dataRoot`/`brainPath`, health con identidad estable, cierre controlado y rechazo de identidad caller. Codex ya no hereda personalizaciones de `office.agents.json` de Claude. Evidencia en «Evidencia de DO-02».
- [ ] **DO-03 — Añadir proveedor local Codex** (Plan, Tarea 3, sujeto a la puerta técnica). Adaptador SDK testeable con doble, controles/capacidades reales, progreso no simulado, fallos visibles y sin leer secretos ni fallback.
- [ ] **DO-04 — Crear launcher, home y supervisión** (Plan, Tarea 4). Arranque/readiness independiente, puertos validados, manejo solo de hijos propios y cierre escalonado con preservación de tareas.
- [ ] **DO-05 — Implementar navegación y controles de UI** (Plan, Tarea 5). Enlaces accesibles derivados del runtime, capacidades específicas de proveedor y navegación sin cancelación; actualizar artefacto generado.
- [ ] **DO-06 — Integrar y verificar coexistencia** (Plan, Tarea 6). Escenarios completos con fixtures temporales, continuidad de Claude y ejecución de suite/build/check local.

## Ruta, presupuesto y entrega

- **Ruta de implementación:** delegada. El mapeo necesario cruza cuatro o más archivos y cada unidad involucra varios archivos no triviales (servidor, rutas/config, lanzador, proveedor, UI y pruebas); evitar preparar una escritura multarchivo mediante exploración inline amplia.
- **Pronóstico:** alto, más de 400 líneas authored entre código y pruebas. El plan se ejecuta en unidades coherentes y commits de trabajo; no recortar pruebas/documentación ni hacer code-golf para cumplir un presupuesto.
- **Estrategia de entrega:** `single-pr` con `size:exception` autorizada expresamente por el usuario el 2026-09-28. Mantener commits de trabajo revisables y no recortar pruebas ni documentación para ajustar el tamaño. Push, creación de PR y merge siguen sin autorización.
- **Límite de commit:** cada unidad implementada debe cerrar con su commit convencional de trabajo en la rama de feature, incluyendo pruebas y documentación relevantes; push, PR y merge siguen siendo decisiones del usuario.

## Progreso y siguiente paso

- Progreso: documento de recuperación creado antes de la primera edición de código. Baseline reportada: 56 pruebas pasan. `size:exception` aprobada. DO-01 implementada con RED → GREEN; revisiones independientes encontraron defaults y capacidades Claude heredados en Codex, además de fallback silencioso de `AO_CODEX_PORT` inválido al default. Las correcciones fueron verificadas independientemente; un puerto `not-a-port` ahora permanece inválido y `validateOfficePair` lo rechaza, mientras Claude conserva su normalización legacy. Suite actual 68/68. `npm run check` quedó en 19/22 en la verificación anterior, por dependencias ambientales y fallo de arranque; `npm run build` confirmó que falta `esbuild`. No se instalaron dependencias ni se invocaron proveedores/auth. Commits DO-01: `03d8098326a33fec089d84644bce55439391d665`, `dc98d799c4ddfb02654e3c1e3854a2406e6c18ca`, `16a1181fdf9afa9511489de4f3962398e9f44d1f`, `5dd42b7e771c088bd5c1cbaa26bf617d0a21535f`; revisión nativa no aplicable porque RDD está desactivado globalmente.
- Progreso: DO-02 implementada en `58c6a976990118a4c70954db81a79d1bab33aa94` (`refactor: isolate office server runtime state`) y `52e8b9a26a55a2e217874dc5d8a4b223fffb2419` (`fix: isolate Codex roster customizations`). Pruebas HTTP con puertos efímeros y raíces temporales. No se llamó proveedor ni se ejecutó auth. Suite completa final: 75/75; evidencia final abajo.
- Pendiente: continuar con DO-03 en el worktree aprobado. Antes de integrar con el checkout fuente, reconciliar sus cambios locales; no sobreescribirlos.

## Archivos de referencia

- `docs/superpowers/specs/2026-09-28-dual-offices-design.md` — arquitectura y criterios aprobados para las dos oficinas.
- `docs/superpowers/plans/2026-09-28-dual-offices.md` — Tareas 1–6, pasos TDD y límites de ejecución.
- `odd/tasks/dual-offices.md` — documento vivo de objetivo, alcance, tareas, evidencia y continuidad.

## Evidencia de DO-01

- **Ruta:** delegated direct; trigger: el cambio modifica `config.mjs`, añade el resolvedor y sus pruebas, y depende del mapa de configuración del proceso.
- **TDD:** RED original confirmó módulo `office-paths.mjs` ausente; pruebas previas capturaron `TypeError` por `AO_CLAUDE_PORT` sin opciones, defaults Claude heredados y filtración de capabilities. En esta corrección P2, RED observó `loadConfig({ office: 'codex', env: { AO_CODEX_PORT: 'not-a-port' } }).port` como `4521`; GREEN preserva `NaN` como inválido para el validador. La normalización legacy de Claude no cambia.
- **Verificación:** `node --test test/office-paths.test.mjs` — 12/12; `node --test test/*.test.mjs` — 68/68; `git diff --check` — sin errores. `npm run check` — 19/22 en la verificación previa, bloqueado por `esbuild`, `playwright-core` ausente y servidor que no inicia; no se repitió para evitar cualquier ruta de auth/provider prohibida. `npm run build` había confirmado `ERR_MODULE_NOT_FOUND` para `esbuild`. No instalar dependencias.
- **Rollback:** revertir el commit de DO-01, que contiene solo resolución/configuración de rutas, ignore rules, pruebas y esta evidencia; no requiere revertir trabajo ajeno.
- **Runtime harness:** N/A — unidad pura de resolución/validación de rutas, sin servidor ni proveedor.
- **Commits:** `03d8098326a33fec089d84644bce55439391d665` (`feat: resolve isolated office state paths`), `dc98d799c4ddfb02654e3c1e3854a2406e6c18ca` (`fix: isolate effective Codex config defaults`), `16a1181fdf9afa9511489de4f3962398e9f44d1f` (`fix: isolate Codex capabilities from Claude`) y `5dd42b7e771c088bd5c1cbaa26bf617d0a21535f` (`fix: reject invalid Codex port configuration`).
- **Revisión:** independiente y acotada por tarea, con los hallazgos P1/P2 corregidos y revalidados. RDD nativo desactivado globalmente; no se inició su ciclo.

## Evidencia de DO-02

- **Diseño mínimo:** convertir el servidor singleton en `createOfficeRuntime({ officeConfig, provider, dataRoot, brainPath })`, manteniendo los datos por cierre de proceso. `start()` abre el listener y el tick de rutinas; `close({ graceMs })` deja de aceptar solicitudes, detiene el tick, espera el cierre del HTTP server hasta el plazo y conserva `tasks.json`. El entrypoint CLI sigue cargando `loadConfig()` sin argumentos y arranca ese runtime.
- **TDD RED:** `node --test test/office-server.test.mjs` falló por la exportación `createOfficeRuntime` ausente. Una ampliación posterior falló porque Codex aún reportaba `office.agents.json` como fuente compartida; se aisló el roster. En el seguimiento, health forzado a capacidades Claude hizo fallar la prueba de fuga; close anterior hizo fallar la prueba de reporte de trabajo pendiente; y el test de signal detectó la exportación de handler ausente.
- **TDD GREEN:** `node --test test/office-server.test.mjs` — 10/10 al cierre. Los casos usan HTTP local con puertos `0`, `dataRoot`/`brainPath` temporales, validan identidad fijada, lectura/borrado aislado de tareas, rechazo de `office` en body/query, health/no uso Claude, apagado con tarea in-flight y persistencia posterior; roster Codex consulta solo su brain.
- **Verificación final:** `node --test test/*.test.mjs` — 78/78; `git diff --check` — sin errores. `npm run build` no ejecutado: recompone `src/braingraph.js` desde el brain del workspace y sobrescribe `dist/*`; no era una verificación segura/no mutante de esta tarea. `npm run check` no ejecutado: su smoke server puede iniciar lógica de proveedor/uso y queda fuera del límite de no-provider/auth.
- **Self-review:** el runtime fija `OFFICE` y `PROVIDER` como constantes antes del handler; request no puede seleccionar identidad por query/body. Task, usage, rutinas, onboarding, traducción usan el `dataRoot`; notas, feedback, roster custom, skills personalizadas y grafo usan el `brainPath`. Los recursos `skills/` distribuidos y de solo lectura siguen compartidos. Codex no invoca usage/MCP Claude ni anuncia modelo/herramientas/Chrome/equipos Claude. `close({graceMs})` deja trabajos activos completar y persistir; nunca se llama `process.exit`. Si un provider no-Claude intenta pasar por `askX` antes de tener su adaptador, falla explícitamente en vez de ejecutar Claude como fallback.
- **Runtime harness:** `node --test test/office-server.test.mjs` — HTTP local de dos runtimes, puertos efímeros y raíces temporales; sin servidor/proveedor externo. Build/smoke no ejecutados por las razones anteriores.
- **Rollback:** revertir los commits DO-02 en orden inverso; no se requieren cambios en launcher/UI/Codex SDK.
- **Commits:** `58c6a976990118a4c70954db81a79d1bab33aa94` (`refactor: isolate office server runtime state`), `52e8b9a26a55a2e217874dc5d8a4b223fffb2419` (`fix: isolate Codex roster customizations`).
- **Skill resolution:** `paths-injected` — se cargaron los tres SKILL.md exigidos (TDD, work-unit-commits, verification-before-completion).
- **Hash seguimiento:** `serve.mjs` `7a2593a3963ce5a713029137f1d5b598f3f42ab443bbf9e87b9284a015b14485`; `test/office-server.test.mjs` `4b30729769797f961ef8051a6639238f3b60e1b929034fa483e6ca78afe2f181`.
