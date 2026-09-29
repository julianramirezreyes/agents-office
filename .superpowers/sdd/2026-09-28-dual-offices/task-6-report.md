# Informe de implementación — DO-06

## Estado

**Completada para el alcance local seguro y sintético.** Las pruebas heredadas que requieren un proveedor real se conservan, sin cambios funcionales, detrás de `npm run check:live`; no se ejecutaron y no se declaran verificadas.

## Cambios y evidencia

- `check.mjs` vuelve a cubrir build, UI/browser y servidor HTTP sin leer el estado del checkout fuente. Exige un `projectRoot` canónico, realpath directo dentro de `os.tmpdir()` (rechaza symlinks/escapes antes de cualquier I/O), ejecuta el build en una copia temporal y usa HOME/npmrc aislados con npm offline.
- Browser smoke real con `/usr/bin/google-chrome` headless, perfil/HOME temporales de ruta corta y API fixtures. Playwright permite exclusivamente el origin HTTP exacto del servidor efímero; bloquea localhost aliases, otro puerto, `file:` y cualquier destino externo. Aserciones observadas: tarjetas de departamentos, panel/roster, command bar, creación TEAM con lead/pieces/chips, rutina y calendario detallado con programación/date-start, board, foco de departamento, grafo, teclado y aprobación; el request a `example.invalid` fue bloqueado antes de red.
- HTTP/domain smoke con `createOfficeRuntime` y `loadConfig({root: fixture})` consume config, roster, brain/skill y tasks del fixture. Comprueba `/api/brain`, `/api/skills`, `/api/lessons`, `/api/routines`, health/tasks/usage/MCP/agents y rutas negativas, además de roster/entrevista, validación de rutinas, precedencia de modelos/esfuerzo y parser de equipos; provider, usage y MCP son dobles con contadores `0/0/0`.
- Regresión de aislamiento prueba que `runSafeSmoke` rechaza el checkout como `projectRoot` antes de leerlo y que sentinels de config, roster, brain y data permanecen sin cambios (se exceptúa solo `data-codex/tasks.json`, que el runtime puede normalizar al persistir).
- `loadRoster` acepta un root explícito para Claude; snapshot prueba el roster/config sintéticos consumidos por runtime y permanece byte-identical. La navegación sigue el `href` de `updateOfficeSwitch` hasta el destino HTTP y comprueba que la tarea activa sigue intacta y que no se llamó cancelación.
- Los casos de coexistencia del worktree conservan dobles sintéticos: tareas simultáneas mediante `createLauncher` y children dobles, sin oficinas/procesos reales; storage/health sin cruce, fallo de Codex aislado, restart de una oficina que preserva la otra e historial. Nueva regresión de persistencia: al inyectar `ENOSPC` solo en data de Claude, DELETE responde 500 con el error visible y conserva el archivo, mientras el DELETE paralelo de Codex responde 200 y persiste su cambio. `reloadRoster` vuelve a pasar por `rosterLoader` inyectado; el default sigue siendo `loadRoster`, por lo que no cambia el comportamiento de producción Claude.
- La copia previa de `check.mjs` (623 líneas) se conserva como `check.live.mjs` y solo se ofrece bajo `check:live`. El check por defecto no importa ni ejecuta este runner.

## Casos live conservados, no ejecutados

`check.live.mjs` conserva los escenarios que necesitan proveedor/auth o control externo: routing y nota de resultado de una tarea Claude real; ejecución completa de rutina periódica de dos minutos; selección/routing real de Opus y lectura de usage tras la tarea; tarea futura programada y rutina con fecha de inicio; planificación, trabajo paralelo y nota final de una tarea TEAM real; control de Chrome por agente; respuesta de chat/persona real; y el flujo completo servido en browser con llamadas al proveedor. Estos siguen sin probarse en este alcance porque requieren invocar proveedor, credenciales o Chrome del usuario. No ejecutar `npm run check:live` como verificación segura.

## Verificación observada

- RED observado durante la corrección: el runner inicial falló al comprobar que el endpoint brain tenía una nota porque el root vacío de `npm run check` no contenía fixture de brain; luego una expectativa fija `SENTINEL` no coincidía con el config sintético `Synthetic Codex Office`. Se añadieron fixtures faltantes y las aserciones se conectaron a config/roster consumidos.
- Otro RED observado: navegador abortó con `Socket path too long` al quedar el perfil bajo un HOME/root de test anidado; luego `page.goto` agotó el timeout de 8s. Perfil y HOME se aislaron en rutas cortas temporales.
- RED de regresión P2 observado: las pruebas nuevas fallaron antes de añadir `isBrowserRequestAllowed` y `canonicalFixtureRoot`. GREEN: `node --test --test-name-pattern='browserRequestPolicy|fixtureRootRejects' test/check-smoke.test.mjs` — 2/2. El root symlink de prueba apunta a un sentinel bajo HOME y confirma que permanece intacto.
- RED de `reloadRoster` observado en ruta segura: `node --test --test-name-pattern=serverReloadsRosterThroughTheInjectedFixtureLoader test/office-server.test.mjs` falló porque el GET `/api/skills` no llamó al loader inyectado. GREEN observado tras usar `rosterLoader`: `node --test --test-name-pattern='serverReloadsRosterThroughTheInjectedFixtureLoader|storageFailureIsVisibleAndIsolatedToItsOffice' test/office-server.test.mjs` — 2/2. El failure test de almacenamiento usa tareas sembradas; ambos DELETE van a la rama directa de persistencia, con `ENOSPC` únicamente en dataRoot Claude; error HTTP 500 visible, Codex DELETE 200 y storage/health de Codex continúan bien.
- `node --test test/*.test.mjs`: **139/139 pasan** tras corregir las regresiones para no ejecutar rutas de proveedor.
- Una ejecución previa de `npm run check` terminó en exit 1: 138/139, por expectativa de storage; el entorno aislado no tenía ejecutable `claude` y respondió `Claude Code is not installed`, por lo que ese run no invocó CLI. Tras reemplazar POST Claude por GET/DELETE provider-free, se reauditaron `package.json`, todo `check.mjs`, subprocesos y las rutas de tests; la ejecución final pasó build/browser/HTTP, 0/0/0 provider/usage/MCP, 139/139, exit 0. Chromium reportó 1 URL externa bloqueada. El runtime check lee únicamente fixtures y el build corre en copia temporal; el incidente previo con POST Claude permanece como limitación no resuelta sobre posible contacto de proveedor.
- `npm run build` se ejecutó en el worktree aislado con brain sintético; restauré únicamente el `src/braingraph.js` incidental generado por el build. Segundo build sin brain sintético conservó el graph original. SHA observado de `src/braingraph.js`: `81a810ca6b97223a76f682294f4c93955071211c2c66d5d6d505f46dea98ec47`; SHA de `dist/command-centre-v2.html`: `e17dc929e1351b02551b62a1e6ceaf6b0506daa284b2615f91bfffad54cc770d`. Sin cambios en `dist`.
- `git diff --check`: limpio tras la corrección P2 y se vuelve a ejecutar tras cambios documentales.
- Incidente de verificación que debe permanecer explícito: dos ejecuciones previas con `PATH` heredado corrieron una versión transitoria de la prueba que hacía POST `/api/tasks` en oficina Claude. Código trazado: ese POST llama `route()` → `ask()` → `askX()` → `spawn('claude', args)` sin SDK. Ambas respuestas fueron HTTP 200, así que el CLI real ejecutó una ruta de routing y devolvió lo suficiente para crear la tarea; no capturé stdout/argv final ni hay evidencia suficiente para determinar si realizó auth, red o llegó a backend. No afirmo ausencia de contacto. La verificación final corrió con `npm run check` bajo HOME/npmrc offline aislados y el test ya corregido; build/browser/HTTP + suite pasaron 139/139, provider/usage/MCP 0/0/0. La prueba se reescribió a GET `/api/skills` y DELETE sobre tareas fixture: ambas rutas se auditaron como provider-free, y no se volverá a ejecutar POST/chat/approve/route en la prueba. `check:live` no se ejecutó; no se instaló nada ni se usó profile de usuario, child real de oficina o puerto predeterminado.

## Archivos principales

- `check.mjs`, `package.json` — runner por defecto sintético y live runner opt-in preservado.
- `check.live.mjs` — copia del smoke heredado con proveedor, no ejecutada.
- `roster.mjs` — root inyectable para roster Claude.
- `test/check-smoke.test.mjs` — sentinel/guard del runner y cobertura UI headless.
- `test/office-navigation.test.mjs`, `test/office-server.test.mjs` — integración navegación y config/roster/launcher fixture.
- `odd/tasks/dual-offices.md` — progreso de DO-06.

## Commit y rollback

- La primera implementación se conserva en `ac5962e` y corrección anterior de fixture en `3f6854c` (`test: harden fixture-only dual office checks`).
- Commit de continuación: `fc93541` (`test: restore fixture-safe office smoke coverage`).
- Corrección P2 de revisión: guards exact-origin/canonical-realpath y cobertura ampliada; commit `3b16146` (`test: tighten isolated office smoke guards`).
- Rollback acotado: revertir `d5efe4b` elimina el forwarding a rosterLoader y sus dos pruebas de regresión; revertir `3b16146` retira solamente los guards/cobertura local añadidos. Ningún rollback borra o modifica datos del checkout fuente.
- `skill_resolution: paths-injected` — TDD, work-unit-commits y verification-before-completion leídos en sus rutas requeridas.
