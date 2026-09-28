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

- [x] **DO-01 — Resolver rutas y configuración aisladas** (Plan, Tarea 1). `resolveOfficePaths` y `validateOfficePair` preservan los defaults de Claude, separan config/data/brain Codex, honran overrides y `CODEX_HOME` explícitos, canonicalizan alias y rechazan rutas superpuestas o puertos duplicados. Prueba centinela confirma que no se modifican archivos Claude ni se crean raíces Codex durante la resolución. Evidencia: `node --test test/office-paths.test.mjs` (8/8) y `node --test test/*.test.mjs` (64/64); commit de unidad registrado abajo.
- [ ] **DO-02 — Aislar el servidor por proceso** (Plan, Tarea 2). Runtime con proveedor/identidad fijados al inicio, todas las escrituras en la raíz de instancia, health y apagado acotado; rechazar identidad caller como override.
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

- Progreso: documento de recuperación creado antes de la primera edición de código. Baseline reportada: 56 pruebas pasan. `size:exception` aprobada. DO-01 implementada con RED → GREEN; suite actual 64/64. `npm run check` quedó en 19/22 por build sin `esbuild`, smoke sin `playwright-core` y fallo de arranque del servidor; `npm run build` confirma dependencia `esbuild` ausente. No se instalaron dependencias ni se invocaron proveedores. Pendiente registrar el hash del commit de DO-01 y revisión nativa.
- Pendiente: continuar con DO-02 en el worktree aprobado. Antes de integrar con el checkout fuente, reconciliar sus cambios locales; no sobreescribirlos.

## Archivos de referencia

- `docs/superpowers/specs/2026-09-28-dual-offices-design.md` — arquitectura y criterios aprobados para las dos oficinas.
- `docs/superpowers/plans/2026-09-28-dual-offices.md` — Tareas 1–6, pasos TDD y límites de ejecución.
- `odd/tasks/dual-offices.md` — documento vivo de objetivo, alcance, tareas, evidencia y continuidad.

## Evidencia de DO-01

- **Ruta:** delegated direct; trigger: el cambio modifica `config.mjs`, añade el resolvedor y sus pruebas, y depende del mapa de configuración del proceso.
- **TDD:** RED confirmó módulo `office-paths.mjs` ausente; una prueba posterior reprodujo `TypeError` en `loadConfig()` con `AO_CLAUDE_PORT`, corregido con compatibilidad de ruta legacy y verificado GREEN.
- **Verificación:** `node --test test/office-paths.test.mjs` — 8/8; `node --test test/*.test.mjs` — 64/64; `git diff --check` — sin errores. `npm run check` — 19/22, bloqueado por `esbuild`, `playwright-core` ausente y servidor que no inicia; `npm run build` — no puede importar `esbuild` (`ERR_MODULE_NOT_FOUND`). No instalar dependencias por alcance explícito.
- **Rollback:** revertir el commit de DO-01, que contiene solo resolución/configuración de rutas, ignore rules, pruebas y esta evidencia; no requiere revertir trabajo ajeno.
- **Runtime harness:** N/A — unidad pura de resolución/validación de rutas, sin servidor ni proveedor.
- **Commit:** pendiente de crear en esta ejecución.
- **Revisión nativa:** pendiente del orquestador; no ejecutada por esta unidad.
