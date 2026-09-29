# Plan de implementación: oficinas de Claude y Codex

> **Para agentes implementadores:** SUBHABILIDAD OBLIGATORIA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans`. Ejecutar las tareas en orden y marcar cada paso con casillas.

**Objetivo:** Incorporar una pantalla de inicio y dos oficinas locales independientes, manteniendo intacta la oficina actual de Claude y añadiendo una oficina Codex que reutilice la sesión local existente sin mezclar datos ni permisos.

**Arquitectura:** Un lanzador local supervisa dos procesos independientes de oficina. Cada proceso fija proveedor, configuración y rutas de estado al arrancar; solo se comparte el código y los recursos de distribución de solo lectura. La oficina Codex usa el SDK oficial cuando las capacidades documentadas permiten aplicar el directorio de trabajo, modelo, sandbox y política de aprobación requeridos; su estado de progreso debe reflejar únicamente eventos reales disponibles.

**Tecnologías:** Node.js `>=20`, módulos ES, `node:test`, servidor HTTP existente, `@openai/codex-sdk` (versión a fijar después de validar el contrato requerido), Playwright para pruebas de interfaz cuando esté disponible.

**Especificación:** [`docs/superpowers/specs/2026-09-28-dual-offices-design.md`](../specs/2026-09-28-dual-offices-design.md)

## Restricciones globales

- Mantener Claude en el puerto predeterminado `4520`; reservar `4519` para el lanzador y `4521` para Codex. Los tres puertos son configurables y deben validarse como únicos.
- Usar por defecto `office.config.local.json`, `data/` y el brain actual para Claude; para Codex usar `office.config.codex.local.json`, `data-codex/` y `brain-codex/`. El lanzador entrega `AO_OFFICE`, `AO_CONFIG_PATH`, `AO_DATA_ROOT`, `AO_BRAIN` y `PORT` a cada hijo; `CODEX_HOME` se hereda sin reescritura.
- Mantener los valores actuales de Claude para datos, configuración, brain, roster, personalizaciones y habilidades en sus rutas actuales; la inicialización no migra, mueve, reescribe, deduplica ni elimina esos archivos.
- Cada oficina tiene raíces de configuración y datos de escritura separadas; validar rutas canónicas distintas antes de crear o modificar estado.
- Los recursos de aplicación distribuidos se comparten solo como entradas de lectura. La autenticación, el estado de runtime y las credenciales nunca se copian entre proveedores; nunca registrar contenido de tokens.
- Reutilizar el `CODEX_HOME` explícito, si existe; en su ausencia, dejar que Codex elija su ubicación local predeterminada. Un home separado solo se configura tras una decisión explícita del usuario.
- No redirigir errores de una oficina al proveedor sano: ausencia de proveedor, falta de sesión, permisos insuficientes, límites, colisiones y fallos de proceso son estados visibles y específicos.
- Navegar entre oficinas cambia solo el destino del navegador: no detiene ni cancela la oficina de origen.
- TDD estricto: cada tarea empieza con prueba RED observada, sigue con implementación mínima GREEN y refactorización con la suite pertinente en verde.
- Los cambios se entregan en commits convencionales por unidad de comportamiento, con pruebas junto al código; no se reduce código o pruebas para cumplir un umbral de tamaño.

## Enfoque de revisión

1. Colisión de rutas o puertos, incluidos enlaces simbólicos: impedir arranque y preservar byte por byte el estado existente; fijar en las pruebas de rutas y configuración.
2. Error de una oficina mientras la otra está activa: aislar reinicio, salud y tareas; fijar en pruebas de lanzador con procesos controlados.
3. Usuario Codex ya autenticado y `CODEX_HOME` personalizado: reutilizar la configuración normal sin iniciar sesión, leer credenciales ni registrar tokens; fijar con doble de SDK e inspección de argumentos de proceso sin examinar archivos de auth.
4. Solicitud de permiso o evento que el SDK no puede expresar: mantener la tarea pendiente/bloqueada con causa explícita y no ampliar permisos; fijar en pruebas del adaptador y contrato.
5. Muerte abrupta del hijo durante una tarea: preservar el último estado persistido y comunicar si es seguro reintentar, sin cambiar de proveedor; fijar en pruebas de recuperación del lanzador.

---

## Mapa de archivos

| Archivo | Responsabilidad prevista |
|---|---|
| `config.mjs` | Conservar `loadConfig()` sin argumentos para Claude; admitir selector y rutas por proceso para el lanzador sin reinterpretar la configuración existente. |
| `office-paths.mjs` (nuevo) | Resolver y validar identidad, puertos y raíces de escritura de cada oficina; exponer rutas canónicas sin crear archivos durante la validación. |
| `launcher.mjs` (nuevo) | Servir la página de inicio; iniciar, sondear y detener exclusivamente los procesos hijos que posee; informar salud individual. |
| `home.html` (nuevo) | Presentar los enlaces de entrada y salud de cada oficina; no servir ni agregar APIs de tareas. |
| `.gitignore` | Ignorar solo los nuevos archivos de configuración local y las raíces de estado Codex; preservar reglas existentes. |
| `codex-provider.mjs` (nuevo) | Adaptar el SDK Codex a la interfaz interna de ejecución, modelos/capacidades reportadas, errores, permisos y progreso real. |
| `serve.mjs` | Mantener el arranque Claude existente y aceptar contexto de oficina inyectado para configuración, almacenamiento, proveedor, salud y cierre sin compartir singletons entre procesos. |
| `src/shell.html` | Añadir navegación persistente y accesible a la otra oficina, con destino derivado de configuración runtime. |
| `build.mjs` | Incluir la navegación de oficina en la salida de distribución existente; conservar la generación actual de `dist/command-centre-v2.html`. |
| `package.json`, `package-lock.json` | Añadir el SDK solo tras validar controles requeridos y fijar dependencia reproducible. |
| `test/office-paths.test.mjs` (nuevo) | Contratos de rutas, defaults heredados, unicidad y no destrucción. |
| `test/office-server.test.mjs` (nuevo) | Identidad de proceso, proveedor fijado, estado/health y aislamiento API/almacenamiento. |
| `test/codex-provider.test.mjs` (nuevo) | Traducción del SDK, modelos, permisos, errores, autenticación reutilizada y progreso honesto. |
| `test/launcher.test.mjs` (nuevo) | Inicio simultáneo, salud independiente, fallos, puertos y parada escalonada de hijos propios. |
| `test/office-navigation.test.mjs` (nuevo) | Inicio, enlaces directos, accesibilidad básica y destino runtime en home y oficina. |

Los archivos de estado reales se crean bajo directorios temporales de prueba; no versionar fixtures de datos personales. No editar el HTML generado directamente: el punto de edición es `src/shell.html` y el resultado se produce mediante `build.mjs`.

## Aislamiento de ejecución y protección del estado existente

- Antes de la primera edición de implementación, crear una rama de trabajo `feat/dual-offices` desde el `HEAD` actual y un worktree aislado dentro de `/home/julian/proyectos/agents-office-worktrees/dual-offices` (directorio hermano del repositorio, nunca `/tmp`). Preferir el worktree nativo del entorno cuando respete esa ubicación; si no, usar `git worktree` en esa ruta. Si se usa CodeGraph, inicializar un índice propio dentro de ese worktree; nunca copiar ni enlazar el `.codegraph/` del checkout fuente.
- La revisión de estado que motivó este plan encontró cambios sin commit en el checkout fuente: `.gitignore`, `dist/command-centre-v2.html`, `package-lock.json`, `src/braingraph.js` y `.codegraph/` sin seguimiento. El worktree nuevo parte del `HEAD` y esos cambios no se copian. No limpiar, mover, incluir ni editar esos cambios desde el checkout fuente.
- La implementación futura debe hacer instalación, pruebas, build y `npm run check` únicamente dentro del worktree aislado; `npm run check` puede volver a generar/modificar `dist/command-centre-v2.html`, de modo que nunca se ejecuta en el checkout con cambios del usuario. La configuración/índice propios del CodeGraph también deben quedarse dentro de ese worktree.
- Antes de integrar/entregar la rama, detenerse y reconciliar explícitamente con el usuario los tres archivos con solapamiento conocido (`.gitignore`, `dist/command-centre-v2.html` y `package-lock.json`). Comparar las versiones del checkout fuente con las de la rama; no copiar por encima ni descartar ninguna. Preservar también los cambios independientes a `src/braingraph.js` y `.codegraph/`. Sin una estrategia de reconciliación autorizada, no integrar.
- Cada ejemplo de commit de este plan asume cwd del worktree limpio y usa `git add` con la lista exacta de archivos de esa unidad. No usar `git add -A`, `git add .` ni staging masivo; los cambios del checkout fuente quedan fuera de esos commits.

## Puerta previa obligatoria: validar el contrato del SDK Codex

Antes de Tarea 1 o de cualquier modificación de fuente, leer documentación primaria y typings públicos de la versión candidata de `@openai/codex-sdk`; no instalar dependencias, autenticar, inspeccionar archivos de credenciales ni invocar el proveedor. Registrar en el PR/bitácora de implementación la versión evaluada y la operación/campo documentado que acredita cada control: herencia de `CODEX_HOME` y reutilización del login local; `cwd` por tarea; selección de modelo; sandbox; política de aprobación; forma de informar falta de autenticación; y superficie real de eventos/progreso. Para un control no documentado como soportado, registrarlo como no disponible, no inferirlo de defaults.

Si no se demuestra que SDK/runtime permiten fijar de forma segura `cwd`, modelo, sandbox y aprobación para cada tarea, detener TODA la implementación antes de iniciar Tarea 1 y volver al usuario con la capacidad concreta ausente y la necesidad de rediseño técnico; no empezar tareas parciales ni sustituir con fallback de permisos. Si los controles de seguridad sí están documentados pero no existen eventos intermedios, registrar esa limitación y fijar el alcance en estados honestos queued/running/final/error, sin progreso de herramientas simulado. La Tarea 3 consume esta evidencia aprobada y no vuelve a descubrir el contrato.

## Tarea 1: Resolver y validar las raíces independientes de oficina

**Archivos:**
- Modificar: `config.mjs`
- Crear: `office-paths.mjs`
- Crear: `test/office-paths.test.mjs`

**Interfaces:**
- Consume: `loadConfig()` actual, `ROOT`, valores de entorno y defaults existentes (`brain`, puerto `4520`).
- Produce: `resolveOfficePaths({ office, env, root }) -> { office, port, configPath, dataRoot, brainPath, codexHome }` y `validateOfficePair(claude, codex, launcherPort) -> { ok, errors }`. Claude sin variables adicionales conserva `office.config.local.json`, `data/`, `cfg.brainPath` y `4520`; Codex usa `office.config.codex.local.json`, `data-codex/`, `brain-codex/` y `4521`, con override por variables anteriores. La resolución debe ser pura: no crea directorios ni abre configuraciones locales de Codex.

- [ ] **Paso 1: Escribir pruebas fallidas** `test/office-paths.test.mjs`: `loadConfig_withoutOffice_keepsClaudeDefaults`, `resolveOfficePaths_usesSeparateCodexWritableRoots`, `resolveOfficePaths_honorsPerOfficeConfigDataAndBrainOverrides`, `validateOfficePair_rejectsCanonicalPathAliases`, `validateOfficePair_rejectsDuplicatePorts`, `validateOfficePair_doesNotTouchExistingClaudeFiles`, `resolveOfficePaths_inheritsExplicitCodexHomeOnlyForCodex`.
- [ ] **Paso 2: Confirmar RED**

Ejecutar: `node --test test/office-paths.test.mjs`
Esperado: fallos por exportaciones ausentes/contratos nuevos; la prueba de no destrucción crea archivos centinela temporales y comprueba mismo contenido y metadatos antes/después.

- [ ] **Paso 3: Implementar resolución pura y compatibilidad** en `office-paths.mjs` y `config.mjs`. Mantener `loadConfig()` sin argumentos con la semántica de Claude actual; usar parámetros/env explícitos para las instancias gestionadas. Resolver rutas con `realpath` para padres existentes y normalización para rutas aún inexistentes; detectar alias de rutas entre configuración, datos y brains de escritura. Añadir únicamente a `.gitignore` las rutas de estado/config local Codex nuevas.
- [ ] **Paso 4: GREEN y refactor**

Ejecutar: `node --test test/office-paths.test.mjs`
Esperado: PASS; cubrir puerto base `4519/4520/4521`, puertos personalizados únicos, rechazo de rutas superpuestas, compatibilidad de llamadas existentes y ausencia de escrituras durante la resolución.

- [ ] **Paso 5: Commit**

```bash
git add config.mjs office-paths.mjs .gitignore test/office-paths.test.mjs
git commit -m "feat: resolve isolated office state paths"
```

## Tarea 2: Hacer el servidor una instancia aislada por proceso

**Archivos:**
- Modificar: `serve.mjs`
- Crear: `test/office-server.test.mjs`

**Interfaces:**
- Consume: `resolveOfficePaths()` y `validateOfficePair()` de la Tarea 1; el comportamiento Claude actual de `runServerTask`, almacenamiento, health y cierre.
- Produce: `createOfficeRuntime({ officeConfig, provider, dataRoot, brainPath }) -> { server, start(), close({ graceMs }) }`; proceso Claude sin argumentos sigue usando defaults actuales. Health responde con `office` y `provider` fijados al arranque y nunca usa un valor de identidad aportado por la petición para elegir raíces/proveedor.

- [ ] **Paso 1: Escribir pruebas fallidas** `test/office-server.test.mjs`: `createOfficeRuntime_bindsProviderAndOfficeIdentityAtStart`, `server_routesReadOnlyIntoItsOwnDataRoot`, `server_rejectsCallerSuppliedOfficeAsRoutingOverride`, `server_reportsOfficeProviderInHealth`, `server_shutdownStopsAcceptingWorkAndPersistsTaskState`, `claudeDefaultStartup_preservesExistingConfigAndDataPaths`.
- [ ] **Paso 2: Confirmar RED**

Ejecutar: `node --test test/office-server.test.mjs`
Esperado: fallos en las nuevas interfaces. Pruebas HTTP deben asignar puertos efímeros en el test, usar raíces temporales y verificar que una escritura en la oficina A no aparece ni modifica B.

- [ ] **Paso 3: Extraer contexto de instancia sin cambiar la semántica de Claude** de `serve.mjs`. Inyectar rutas/proveedor al iniciar cada proceso; pasar el mismo `dataRoot` a tareas, rutinas, entrevistas, feedback y uso. Identidad de oficina deriva exclusivamente de la configuración de proceso.
- [ ] **Paso 4: GREEN, refactor y compatibilidad**

Ejecutar: `node --test test/office-server.test.mjs`
Esperado: PASS; la ruta antigua `http://localhost:4520` sigue entregando Claude y las APIs de ambos tests quedan aisladas por instancia.

- [ ] **Paso 5: Commit**

```bash
git add serve.mjs test/office-server.test.mjs
git commit -m "refactor: isolate office server runtime state"
```

## Tarea 3: Añadir el adaptador Codex condicionado a una validación del SDK

**Archivos:**
- Crear: `codex-provider.mjs`
- Modificar: `serve.mjs`
- Modificar: `package.json`, `package-lock.json` (solo después de superar el punto de validación)
- Crear: `test/codex-provider.test.mjs`

**Interfaces:**
- Consume: interfaz `provider.runTask`, identidad/rutas de la Tarea 2 y API pública instalada de `@openai/codex-sdk`.
- Produce: `createCodexProvider({ sdk, codexHome, workspaceRoot, policy }) -> { capabilities(), runTask({ taskId, prompt, cwd, model, approvalPolicy, onEvent }), close() }`. `capabilities()` devuelve solo modelos, controles, herramientas y disponibilidad que el runtime confirma; `runTask()` entrega `{ status, threadId, text, usage, error }` y eventos solo si son emitidos realmente por el SDK.

**Precondición:** la puerta previa confirma los controles obligatorios y documenta la superficie de eventos. Consume esa evidencia (versión, API y límites); no revalidar mediante instalación, autenticación o ejecución real.

- [ ] **Paso 1: Escribir pruebas fallidas** `test/codex-provider.test.mjs`: `codexProvider_reusesSdkLocalLoginWithoutReadingCredentials`, `codexProvider_pinsWorkspaceModelSandboxAndApprovalPolicy`, `codexProvider_exposesOnlyRuntimeReportedModelsAndTools`, `codexProvider_marksUnsupportedApprovalAsPendingWithoutBroadeningPolicy`, `codexProvider_doesNotInventIntermediateProgressWhenSdkReturnsOnlyFinal`, `codexProvider_preservesTaskOnMissingLoginRateLimitAndProviderError`, `codexProvider_neverFallsBackToClaude`.
- [ ] **Paso 2: Confirmar RED**

Ejecutar: `node --test test/codex-provider.test.mjs`
Esperado: los tests fallan por adaptador ausente. SDK se sustituye por un doble inyectado; no usar ni inspeccionar archivos de credenciales.

- [ ] **Paso 3: Implementar el adaptador y fijar dependencia** con las APIs públicas efectivamente validadas. Reutilizar el entorno local del proceso sin leer tokens; guardar solo thread IDs y metadatos de tareas en `dataRoot` Codex. No traducir aliases Claude a modelos Codex. Fallos son específicos de Codex, persistentes y reintentables solo con razón explícita; permisos no concedidos permanecen bloqueados.
- [ ] **Paso 4: GREEN, refactor y regresión enfocada**

Ejecutar: `node --test test/codex-provider.test.mjs test/office-server.test.mjs`
Esperado: PASS; ninguna condición de auth, sandbox, aprobación o red mueve la tarea al proveedor Claude.

- [ ] **Paso 5: Commit**

```bash
git add codex-provider.mjs serve.mjs package.json package-lock.json test/codex-provider.test.mjs
git commit -m "feat: add local Codex provider adapter"
```

## Tarea 4: Crear el lanzador, home y supervisión de procesos

**Archivos:**
- Crear: `launcher.mjs`
- Crear: `home.html`
- Modificar: `office-paths.mjs`
- Crear: `test/launcher.test.mjs`

**Interfaces:**
- Consume: validación de pares de oficinas de Tarea 1 y entrypoint de proceso de Tarea 2.
- Produce: `createLauncher({ config, spawnProcess, fetchHealth, graceMs }) -> { server, start(), close() }`; health local `GET /api/health` indica estado y URL efectiva de cada oficina. Launcher solo conserva handles/PIDs de hijos que inició; no busca ni mata procesos por puerto/PID de terceros.

- [ ] **Paso 1: Escribir pruebas fallidas** `test/launcher.test.mjs`: `launcher_startsBothOfficesWithProviderSpecificEnvironment`, `launcher_healthIsIndependentWhenOneChildFails`, `launcher_reportsPortCollisionWithoutReassigningState`, `launcher_doesNotKillUnownedProcess`, `launcher_gracefullyStopsOwnedChildrenAndPreservesUnfinishedTask`, `launcher_exposesNoTaskOrChatProxyRoutes`.
- [ ] **Paso 2: Confirmar RED**

Ejecutar: `node --test test/launcher.test.mjs`
Esperado: fallo por exportaciones ausentes; hijos y health simulados por dobles inyectables, sin lanzar procesos reales contra los puertos predeterminados.

- [ ] **Paso 3: Implementar home HTTP y arranque coordinado** en `launcher.mjs`. Por defecto iniciar Claude en `4520` y Codex en `4521`, con home en `4519`; validar los tres puertos antes de iniciar, reportar readiness/causa independiente y no convertir el launcher en proxy de APIs de tarea/chat.
- [ ] **Paso 4: Implementar cierre escalonado**: dejar de aceptar nuevas solicitudes, esperar hasta el grace period, persistir último estado del hijo cuando la interfaz de servidor lo permite y reportar tareas interrumpidas. Apagar o fallar un hijo no termina al otro.
- [ ] **Paso 5: GREEN y refactor**

Ejecutar: `node --test test/launcher.test.mjs test/office-paths.test.mjs test/office-server.test.mjs`
Esperado: PASS; rutas/puertos se validan antes de escribir estado y una falla de Codex no afecta el proceso Claude (y viceversa).

- [ ] **Paso 6: Commit**

```bash
git add launcher.mjs home.html office-paths.mjs test/launcher.test.mjs
git commit -m "feat: launch and supervise isolated offices"
```

## Tarea 5: Añadir navegación directa y controles por proveedor en la interfaz

**Archivos:**
- Modificar: `src/shell.html`
- Modificar: `build.mjs`
- Modificar: `src/tasks.js`
- Crear: `test/office-navigation.test.mjs`
- Actualizar artefacto generado mediante build: `dist/command-centre-v2.html`

**Interfaces:**
- Consume: nombres, proveedor y URL actual de `/api/health` de Tarea 2; URLs separadas que publica el home de Tarea 4; `models`, capacidades y fuente de uso específica publicados por la oficina.
- Produce: navegación persistente con etiqueta accesible `Switch office`, destino basado en health/runtime, y controles que renderizan solo las capacidades soportadas por proveedor. Al cambiar de oficina se navega a la URL indicada sin emitir cancelación ni detener procesos.

- [ ] **Paso 1: Escribir pruebas fallidas** `test/office-navigation.test.mjs`: `home_showsSeparateReadinessAndEntriesForBothOffices`, `office_switchLinkUsesRuntimeTargetRatherThanHardcodedURL`, `office_switchLinkHasAccessibleName`, `navigationDoesNotCallTaskCancellation`, `codexControlsExcludeClaudeAliasesAndUnsupportedTools`, `usageLabelsIdentifyProviderSource`.
- [ ] **Paso 2: Confirmar RED**

Ejecutar: `node --test test/office-navigation.test.mjs`
Esperado: fallo por navegación/contratos ausentes. Usar parseo DOM o las utilidades de test existentes; no aceptar únicamente pruebas de substring si pueden comprobarse href, etiqueta y control visible.

- [ ] **Paso 3: Añadir links runtime en shell y home** sin alterar los defaults ni textos de Claude innecesariamente. El target no es un puerto fijo del HTML; leer datos runtime y mostrar error de destino no disponible sin alterar salud de la oficina de origen.
- [ ] **Paso 4: Filtrar opciones UI por capacidades**: Claude conserva los modelos actuales; Codex muestra identificadores reportados por su runtime, herramientas Codex disponibles y su fuente de uso, ocultando funciones que Codex no ofrece. Mantener visible la razón de una aprobación pendiente o de progreso limitado.
- [ ] **Paso 5: GREEN y regenerar distribución**

Ejecutar: `node --test test/office-navigation.test.mjs` y `npm run build`
Esperado: PASS y `dist/command-centre-v2.html` contiene la navegación generada desde `src/shell.html`.

- [ ] **Paso 6: Commit**

```bash
git add src/shell.html build.mjs src/tasks.js dist/command-centre-v2.html test/office-navigation.test.mjs
git commit -m "feat: add office launcher and cross-office navigation"
```

## Tarea 6: Integrar y verificar escenarios completos de ambas oficinas

**Archivos:**
- Modificar: `test/office-server.test.mjs`
- Modificar: `test/launcher.test.mjs`
- Modificar: `test/office-paths.test.mjs`
- Modificar: `test/office-navigation.test.mjs`
- Modificar: `check.mjs`

**Interfaces:**
- Consume: contratos de las Tareas 1–5 y el smoke test existente de servidor en `check.mjs`.
- Produce: cobertura de aceptación local para coexistencia, aislamiento, continuidad de Claude, auth Codex simulada, health/fallo y navegación; `npm run check` conserva los smoke tests actuales y ejecuta o invoca explícitamente el conjunto nuevo, sin acceder a proveedores reales.

- [ ] **Paso 1: Añadir los tests de integración RED** `launcher_twoOfficesRunIndependentTasksAtOnce`, `claudeSnapshotIsByteIdenticalAfterCodexStartup`, `healthAndStorageDoNotCrossOfficeBoundaries`, `launcherNavigationKeepsBothProcessesAlive`, `codexProviderFailureLeavesClaudeAvailable`, `restartingOneOfficePreservesOtherOfficeAndOwnTaskHistory`.
- [ ] **Paso 2: Confirmar RED**

Ejecutar: `node --test test/office-paths.test.mjs test/office-server.test.mjs test/codex-provider.test.mjs test/launcher.test.mjs test/office-navigation.test.mjs`
Esperado: fallo inicial que reproduce la integración sin estar conectado a ninguna cuenta externa. La instantánea Claude se genera bajo carpeta temporal de fixture; nunca usar datos personales locales.

- [ ] **Paso 3: Completar solo las costuras necesarias** para satisfacer las pruebas; no ampliar APIs launcher a proxy ni añadir un selector global de proveedor.
- [ ] **Paso 4: Ejecutar el ciclo GREEN/refactor y las verificaciones del proyecto**

Ejecutar: `node --test test/office-paths.test.mjs test/office-server.test.mjs test/codex-provider.test.mjs test/launcher.test.mjs test/office-navigation.test.mjs`, `node --test test/*.test.mjs`, `npm run build` y `npm run check`.
Esperado: PASS en cada comando. `npm run check` podrá ejercer smoke test local ya existente, pero no debe autenticar ni llamar proveedores en vivo; `npm run check:live` queda fuera de la verificación predeterminada.

- [ ] **Paso 5: Revisión final y commit**

Comprobar `git diff --check`, verificar que no cambian rutas/bytes del fixture de Claude, y revisar `git diff --stat`. Registrar la salida observada de cada comando. Si el cambio de implementación excede el presupuesto de PR vigente, separar por commits funcionales completos; no recortar pruebas o documentación.

```bash
git add check.mjs test/office-paths.test.mjs test/office-server.test.mjs test/codex-provider.test.mjs test/launcher.test.mjs test/office-navigation.test.mjs
git commit -m "test: verify independent Claude and Codex offices"
```

## Auto-revisión contra la especificación

- Inicio, accesos, links cruzados y readiness individual: Tareas 4–5.
- Tareas simultáneas sin cancelación por navegación: Tareas 4–6.
- Separación de tasks, rutinas, notas, brain, roster, skills, config, uso y estado UI: Tareas 1–2 y pruebas integradas de Tarea 6; toda ruta de escritura debe aceptar una raíz de instancia explícita.
- Continuidad no destructiva del Claude actual y URL `4520`: Tareas 1–2 y 6.
- Reutilización de autenticación Codex existente sin tocar secretos, incluido `CODEX_HOME`: Tarea 3; prueba solo con doble de SDK y contrato de herencia de entorno.
- Modelos, herramientas, permisos, progreso y uso propios del proveedor, más fallo visible sin fallback: Tareas 3 y 5.
- Colisión de puerto/ruta, hijo muerto, almacenamiento fallido, retry y apagado acotado: Tareas 1, 4 y 6.
- Validación no resuelta: superficie exacta de SDK (controles/eventos), cerrada como puerta previa a Tarea 1; si falla cualquiera de los controles obligatorios, se detiene toda implementación y se solicita rediseño técnico.
- Seguridad de ejecución: el plan parte de worktree hermano en `$HOME`, no copia los cambios del checkout fuente, ejecuta allí todos los checks potencialmente mutantes y exige reconciliar los tres archivos compartidos antes de integrar.

## Handoff de ejecución

Este documento es un plan para revisión. Su existencia NO autoriza implementación. Tras autorizarla, preparar primero el worktree descrito arriba; ejecutar luego la puerta técnica del SDK antes de Tarea 1. Si supera la puerta, elegir un método de ejecución y continuar en orden; si falla un control de seguridad obligatorio, detener todo el plan y devolver el bloqueo para rediseño. No ejecutar pruebas, builds o checks en el checkout fuente con cambios del usuario.
