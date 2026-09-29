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
- [x] **DO-03 — Añadir proveedor local Codex** (Plan, Tarea 3). Adaptador SDK testeable con doble, controles/capacidades reales, progreso no simulado, fallos visibles y sin leer secretos ni fallback. Dependencia exacta `@openai/codex-sdk@0.157.1` declarada y bloqueada desde registry público npm; import del SDK verificado sin crear cliente ni ejecutar proveedor. Ver «Evidencia de DO-03».
- [x] **DO-04 — Crear launcher, home y supervisión** (Plan, Tarea 4). Home local en `4519`, oficinas Claude/Codex independientes en `4520`/`4521` por defecto, validación de puertos/rutas antes de spawn, readiness y URLs efectivas por oficina, gestión solo de handles propios y cierre acotado que informa trabajo pendiente. Evidencia en «Evidencia de DO-04».
- [x] **DO-05 — Implementar navegación y controles de UI** (Plan, Tarea 5). El enlace accesible «Switch office» consulta el launcher configurado y usa la URL loopback validada de la oficina lista; muestra el motivo si el destino no está disponible y no llama cancelación. La interfaz Codex oculta modelos/controles no confirmados y aliases Claude, etiqueta el proveedor de uso/estado y conserva los motivos comunicados. Home mantiene readiness independiente. Correcciones de revisión: CORS de salud limitado a puertos configurados y hosts loopback admitidos, modelos escapados, errores de envío sin tarea ficticia, y copy/marca neutrales por proveedor. Commits: `e03dd6e`, `82206d5`, `76131e4` y correcciones subsiguientes; evidencia: `.superpowers/sdd/2026-09-28-dual-offices/task-5-report.md`.
- [ ] **DO-06 — Integrar y verificar coexistencia** (Plan, Tarea 6) — **parcial, pendiente de decisión de cobertura**. Las categorías de build, UI/browser local opcional y HTTP se reintrodujeron con proyecto/brain/config/roster/data sintéticos; `launcher_twoOfficesRunIndependentTasksAtOnce` ahora crea `createLauncher` con children dobles y runtimes HTTP fixture; el test de navegación sigue el enlace generado, y snapshots config/roster pasan por `loadConfig`/runtime de fixture. `npm run check` ejecuta `npm run build` en copia temporal offline y suite fixture-only; smoke: build/HTTP PASS, browser SKIP (sin binario local), provider/usage/MCP 0/0/0; suite 134/134. No lee configuración/roster/data del checkout. Corrección código/tests: `3f6854c` (`test: harden fixture-only dual office checks`). No se portaron todas las aserciones smoke heredadas de conectores, rutinas, modelos/uso, equipos, calendario y rutas UI, por lo que DO-06 no se marca completa. Ver `.superpowers/sdd/2026-09-28-dual-offices/task-6-report.md`; siguiente: decidir si se portan esas categorías restantes a fixtures o se acepta la cobertura focal junto a la suite unitaria.

## Ruta, presupuesto y entrega

- **Ruta de implementación:** delegada. El mapeo necesario cruza cuatro o más archivos y cada unidad involucra varios archivos no triviales (servidor, rutas/config, lanzador, proveedor, UI y pruebas); evitar preparar una escritura multarchivo mediante exploración inline amplia.
- **Pronóstico:** alto, más de 400 líneas authored entre código y pruebas. El plan se ejecuta en unidades coherentes y commits de trabajo; no recortar pruebas/documentación ni hacer code-golf para cumplir un presupuesto.
- **Estrategia de entrega:** `single-pr` con `size:exception` autorizada expresamente por el usuario el 2026-09-28. Mantener commits de trabajo revisables y no recortar pruebas ni documentación para ajustar el tamaño. Push, creación de PR y merge siguen sin autorización.
- **Límite de commit:** cada unidad implementada debe cerrar con su commit convencional de trabajo en la rama de feature, incluyendo pruebas y documentación relevantes; push, PR y merge siguen siendo decisiones del usuario.

## Progreso y siguiente paso

- Progreso: documento de recuperación creado antes de la primera edición de código. Baseline reportada: 56 pruebas pasan. `size:exception` aprobada. DO-01 implementada con RED → GREEN; revisiones independientes encontraron defaults y capacidades Claude heredados en Codex, además de fallback silencioso de `AO_CODEX_PORT` inválido al default. Las correcciones fueron verificadas independientemente; un puerto `not-a-port` ahora permanece inválido y `validateOfficePair` lo rechaza, mientras Claude conserva su normalización legacy. Suite actual 68/68. `npm run check` quedó en 19/22 en la verificación anterior, por dependencias ambientales y fallo de arranque; `npm run build` confirmó que falta `esbuild`. No se instalaron dependencias ni se invocaron proveedores/auth. Commits DO-01: `03d8098326a33fec089d84644bce55439391d665`, `dc98d799c4ddfb02654e3c1e3854a2406e6c18ca`, `16a1181fdf9afa9511489de4f3962398e9f44d1f`, `5dd42b7e771c088bd5c1cbaa26bf617d0a21535f`; revisión nativa no aplicable porque RDD está desactivado globalmente.
- Progreso: DO-02 implementada en `58c6a976990118a4c70954db81a79d1bab33aa94` (`refactor: isolate office server runtime state`) y `52e8b9a26a55a2e217874dc5d8a4b223fffb2419` (`fix: isolate Codex roster customizations`), con correcciones de revisión registradas abajo. Pruebas HTTP con puertos efímeros y raíces temporales. No se llamó proveedor ni se ejecutó auth. Suite completa final: 79/79; evidencia final abajo.
- Progreso: DO-04 implementada y corregida tras revisión independiente con RED → GREEN → REFACTOR; el informe `.superpowers/sdd/2026-09-28-dual-offices/task-4-report.md` registra los ciclos. Un repro P1 adicional confirmó que un health en vuelo podía ocultar `spawn ENOENT`; ahora el error del handle invalida el resultado tardío y se conserva la causa original. La revisión independiente confirmó el cierre: fallos `error`/`exit` conservan `failed`, y el caso normal conserva `ready`. Pruebas enfocadas launcher/path/server 37/37 y suite completa 105/105; `git diff --check` limpio. El launcher valida identidad/URL de salud, exige bind loopback, no sondea puertos ajenos, solo señaliza handles propios y no expone proxies de tareas/chat. DO-05 se cerró con RED → GREEN, build regenerado y suite total 126/126; revisión independiente cerró CORS de `localhost`/`[::1]`, escape de modelos y copy específico de proveedor. Siguiente: DO-06.
- Revisión del orquestador rechazó la primera entrega DO-06 por reducir 623 líneas del smoke legado y por pruebas sin cableado real de configuración/roster, navegación y launcher. Corrección código/tests `3f6854c`: smokes build/browser/HTTP sintéticos y pruebas de wiring pasan; browser omitido por ausencia de binario, categorías legacy restantes sin portar; DO-06 permanece parcial hasta decisión. `node --test` enfocado 78/78; suite y `npm run check` 134/134; diff-check limpio. Evidencia y límites actualizados en `.superpowers/sdd/2026-09-28-dual-offices/task-6-report.md`.

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
- **TDD GREEN:** `node --test test/office-server.test.mjs` — 11/11 al cierre. Los casos usan HTTP local con puertos `0`, `dataRoot`/`brainPath` temporales, validan identidad fijada, lectura/borrado aislado de tareas, rechazo de `office` en body/query, health/no uso Claude, apagado con tarea in-flight, body HTTP parcial dentro del plazo y persistencia posterior; roster Codex consulta solo su brain.
- **Verificación final:** `node --test test/*.test.mjs` — 79/79; `git diff --check` — sin errores. `npm run build` no ejecutado: recompone `src/braingraph.js` desde el brain del workspace y sobrescribe `dist/*`; no era una verificación segura/no mutante de esta tarea. `npm run check` no ejecutado: su smoke server puede iniciar lógica de proveedor/uso y queda fuera del límite de no-provider/auth.
- **Self-review:** el runtime fija `OFFICE` y `PROVIDER` como constantes antes del handler; request no puede seleccionar identidad por query/body. Task, usage, rutinas, onboarding, traducción usan el `dataRoot`; notas, feedback, roster custom, skills personalizadas y grafo usan el `brainPath`. Los recursos `skills/` distribuidos y de solo lectura siguen compartidos. Codex no invoca usage/MCP Claude ni anuncia modelo/herramientas/Chrome/equipos Claude. `close({graceMs})` deja trabajos activos completar y persistir; nunca se llama `process.exit`. Si un provider no-Claude intenta pasar por `askX` antes de tener su adaptador, falla explícitamente en vez de ejecutar Claude como fallback.
- **Runtime harness:** `node --test test/office-server.test.mjs` — HTTP local de dos runtimes, puertos efímeros y raíces temporales; sin servidor/proveedor externo. Build/smoke no ejecutados por las razones anteriores.
- **Rollback:** revertir los commits DO-02 en orden inverso; no se requieren cambios en launcher/UI/Codex SDK.
- **Commits:** `58c6a976990118a4c70954db81a79d1bab33aa94` (`refactor: isolate office server runtime state`), `52e8b9a26a55a2e217874dc5d8a4b223fffb2419` (`fix: isolate Codex roster customizations`).
- **Seguimiento commits:** `c8667aa` (`fix: isolate provider endpoints and drain shutdown work`), `2ff77b7` (`test: assert clean Claude shutdown result`), `c8ff4dd` (`docs: record DO-02 review corrections`), `ea3f627` (`docs: add DO-02 follow-up commit evidence`), `0e5883f` (`fix: enforce shutdown deadline for partial HTTP requests`) y `dd51e02` (`docs: record HTTP shutdown deadline evidence`). La revisión independiente cerró el hallazgo de fuga hacia Claude y confirmó que un cuerpo HTTP parcial respeta `graceMs` (22 ms con plazo de 20 ms) sin cancelar tareas activas; RDD nativo permanece desactivado.
- **Skill resolution:** `paths-injected` — se cargaron los tres SKILL.md exigidos (TDD, work-unit-commits, verification-before-completion).
- **Hash seguimiento:** `serve.mjs` `bb70d1d20be05474a1668091f10d3799791692eb9b6c1cb9deed740e038a23a4`; `test/office-server.test.mjs` `539d320c065e725e2290f2b072f829cec6b54916314138ad517eb5d38a5aa78a`.

## Evidencia de DO-03

- **Ruta:** delegated direct, unidad DO-03 en el worktree `agents-office-worktrees/dual-offices`; sin subagentes adicionales.
- **TDD:** RED inicial falló por ausencia de `codex-provider.mjs`; la prueba de configuración de política inválida también falló primero al intentar cargar el SDK en vez de bloquear; ambas pasaron tras el adapter/cierre de controles. En correcciones independientes, RED reprodujo la fuga por symlink hacia fuera del workspace (sin SDK/thread iniciado), aprobación prematura para `blocked` y también para `failed` con `error: null` (incluida escritura de nota). GREEN canonicaliza root/cwd con `realpathSync` sin crear directorios y permite aprobación/efectos solo ante resultado exitoso: Codex exige `providerStatus: completed`. Resultados no completados mantienen `approved: false`, quitan `approvedAt` y no escriben nota.
- **Implementación:** `codex-provider.mjs` consume SDK inyectable, configura cwd/model/sandbox/aprobación, persiste el ID de hilo y uso/eventos únicamente si son reportados. Health deja modelos/herramientas como desconocidos al no haber enumeración runtime. El server integra tareas por proveedor y evita rutas Claude para capacidades no implementadas.
- **Dependencia:** `@openai/codex-sdk@0.157.1` instalada desde `https://registry.npmjs.org` con acceso público anónimo, `--ignore-scripts --no-audit --no-fund --save-exact`; `NPM_TOKEN` y `NODE_AUTH_TOKEN` removidos del entorno y configuración user/global aislada. `package.json` fija la versión exacta y `package-lock.json` incluye URL oficial e integridad legítima. `npm ls --depth=0 --offline` confirma la versión instalada. No se ejecutaron scripts de instalación.
- **Import seguro:** `import('@openai/codex-sdk')` resolvió el export `Codex` como función. No se construyó el cliente, no se inició CLI/hilo y no se llamó proveedor/auth.
- **Verificación:** `node --test test/codex-provider.test.mjs test/office-server.test.mjs` — 23/23; `node --test test/*.test.mjs` — 91/91; `git diff --check` — limpio. RED focal observó primero cada defecto. Sin auth, proveedor real, lectura de credenciales, ni `codex login status`.
- **No ejecutado:** build recompone artefactos generados fuera del alcance; `npm run check` puede iniciar lógica de proveedor/uso y no se necesitó para instalar/importar con seguridad. `--ignore-scripts` significa que no se verificó la ejecución del CLI empaquetado; no se habilitó ningún script.
- **Commits de trabajo:** `5143072` (`feat: add local Codex provider adapter`), `27aac42` (`fix: contain Codex cwd and defer approval state`) y `2300a02` (`fix: require completed Codex approval result`). Rollback: revertirlos en orden inverso; limita el rollback al adaptador/servidor/pruebas/documentos DO-03 sin tocar rutas ni datos Claude.
- **Commit de dependencia/cierre:** `21f2f37` (`feat: add Codex SDK dependency`), incluye manifest/lock y esta actualización de evidencia.
- **Informe:** `.superpowers/sdd/2026-09-28-dual-offices/task-3-report.md`.
- **Hallazgos de revisión independiente corregidos:** symlink interno a directorio externo superaba el control léxico, y `/approve` podía persistir `approved: true` y una nota para estados `blocked` y `failed` sin error. Las pruebas usan SDK/provider dobles; no se amplió política ni se añadió fallback.
- **Cierre:** DO-03 queda completa en su alcance local: dependencia fijada, SDK importable y pruebas Node enfocadas/completas en verde. La revisión independiente confirmó manifest, lock, API y pruebas. No se probó la ejecución real del CLI, proveedor ni autenticación; build/check siguen pendientes por sus efectos y límites descritos.
- **skill_resolution:** `paths-injected` — cuatro rutas exactas de TDD, verificación, work-unit-commits y OpenAI Docs.

## Evidencia de DO-04

- **Ruta:** delegated direct, unidad DO-04 en el worktree `agents-office-worktrees/dual-offices`; sin subagentes adicionales. Se modificaron launcher/home, configuración de rutas, CLI del servidor para consumir la identidad env asignada por el launcher y pruebas. El ajuste mínimo al entrypoint permite arrancar Codex con su provider y raíces correctos y conserva el arranque Claude no gestionado.
- **TDD:** RED original falló porque `launcher.mjs` no existía; luego la colisión mostró que puertos configurables no alimentaban al validador. La revisión reprodujo en RED identidad errónea/URL `javascript:`, probe tardío sobre salida, fuga de listener/children al cerrar durante startup y deriva de URL de probe. Ese run se interrumpió tras confirmar el listener abierto. Pruebas añadidas luego también fallaron en RED para health sin `ok: true` y bind home wildcard. No hubo hijos reales. GREEN pasó todos los repros.
- **Implementación:** `launcher.mjs` sirve home local, arranca cada `serve.mjs` con identidad/provider/rutas/puerto de oficina, exige bind home loopback y publica health solo con `office`/`provider` coincidentes y `ok: true`. URLs efectivas solo se publican con esquema HTTP(S), sin credenciales y mismo origen/puerto loopback configurado. Tradeoff: se rechazan URLs runtime aunque sean locales si alteran origen o puerto; se conserva fallback loopback seguro y la oficina no queda ready. El probe usa base inmutable separada. Respuestas atrasadas no pisan salida del child. `close()` bloquea nuevos starts, espera un start existente y cierra solo listener/handles propios. `serve.mjs` conserva defaults Claude al margen del launcher.
- **Verificación:** `node --test test/launcher.test.mjs` — 13/13; `node --test test/launcher.test.mjs test/office-paths.test.mjs test/office-server.test.mjs` — 36/36; `node --test test/*.test.mjs` — 104/104; `git diff --check` — limpio. No se ejecutó `npm run check:live`, ni descarga/install/auth o proveedor/CLI real. Build omitido: no se alteraron artefactos generados.
- **Runtime harness:** dobles `spawnProcess` y `fetchHealth`; home se sirvió por HTTP en puerto efímero, con puertos de oficinas nunca ligados por la prueba. No se inspeccionaron ni finalizaron procesos ajenos.
- **Rollback:** revertir los commits DO-04 para retirar `launcher.mjs`, `home.html`, `test/launcher.test.mjs` y revertir cambios DO-04 en `office-paths.mjs`, `serve.mjs`, este documento y el informe, sin alterar datos Claude existentes ni estado de oficina.
- **Commits:** `ec9a846130bd98668b6eab9b45ffcf869d040341` (`feat: launch and supervise isolated offices`) y `351e60cc767dc68b9fc0b52ecc78234fb35f8c77` (`fix: harden launcher health and lifecycle`). Evidencia actualizada en commit documental separado.
- **Skill resolution:** `paths-injected` — TDD, work-unit-commits y verification-before-completion se leyeron desde las rutas exactas indicadas.
- **Corrección P1 residual:** RED de `launcher_doesNotLetAnInFlightHealthProbeOverwriteChildSpawnError` reprodujo el estado incorrecto (`ready` en vez de `failed`) al emitir `error: spawn ENOENT` durante un probe diferido. El listener del child ahora invalida resultados/capturas posteriores para ese handle y conserva su primer fallo aunque ocurra después un `exit`. GREEN: launcher/path/server 37/37 y suite 105/105; commit `7209f1b6781a1f83c946c910faa17fa6f158ac17` (`fix: preserve launcher spawn errors across health checks`). Se usaron dobles de child/health, sin procesos reales ni puertos default.
