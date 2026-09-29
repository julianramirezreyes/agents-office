# Informe de implementación — DO-06

## Estado

**Completada para el alcance local seguro y sintético.** Las pruebas heredadas que requieren un proveedor real se conservan, sin cambios funcionales, detrás de `npm run check:live`; no se ejecutaron y no se declaran verificadas.

## Cambios y evidencia

- `check.mjs` vuelve a cubrir build, UI/browser y servidor HTTP sin leer el estado del checkout fuente. Exige que `projectRoot` sea un directorio temporal bajo `os.tmpdir()`, ejecuta el build en una copia temporal y usa HOME/npmrc aislados con npm offline.
- Browser smoke real con `/usr/bin/google-chrome` headless, perfil/HOME temporales de ruta corta, API fixtures y routing Playwright que permite loopback y aborta cualquier URL externa. Aserciones observadas: roster, command bar, TEAM, rutina, CALENDAR, navegación de teclado B/G y señal/estado de aprobación; un request a `example.invalid` fue bloqueado antes de red.
- HTTP smoke con `createOfficeRuntime` y `loadConfig({root: fixture})` consume config, roster, brain y tasks del fixture. Comprueba `/api/brain`, `/api/skills`, `/api/lessons`, `/api/routines`, health/tasks/usage/MCP/agents y rutas negativas; provider, usage y MCP son dobles con contadores `0/0/0`.
- Regresión de aislamiento prueba que `runSafeSmoke` rechaza el checkout como `projectRoot` antes de leerlo y que sentinels de config, roster, brain y data permanecen sin cambios (se exceptúa solo `data-codex/tasks.json`, que el runtime puede normalizar al persistir).
- `loadRoster` acepta un root explícito para Claude; snapshot prueba el roster/config sintéticos consumidos por runtime y permanece byte-identical. La navegación sigue el `href` de `updateOfficeSwitch` hasta el destino HTTP y comprueba que la tarea activa sigue intacta y que no se llamó cancelación.
- Los casos de coexistencia del worktree conservan dobles sintéticos: tareas simultáneas mediante `createLauncher` y children dobles, sin oficinas/procesos reales; storage/health sin cruce, fallo de Codex aislado, restart de una oficina que preserva la otra e historial.
- La copia previa de `check.mjs` (623 líneas) se conserva como `check.live.mjs` y solo se ofrece bajo `check:live`. El check por defecto no importa ni ejecuta este runner.

## Casos live conservados, no ejecutados

`check.live.mjs` conserva los escenarios que necesitan proveedor/auth o control externo: routing y nota de resultado de una tarea Claude real; ejecución completa de rutina periódica de dos minutos; selección/routing real de Opus y lectura de usage tras la tarea; tarea futura programada y rutina con fecha de inicio; planificación, trabajo paralelo y nota final de una tarea TEAM real; control de Chrome por agente; respuesta de chat/persona real; y el flujo completo servido en browser con llamadas al proveedor. Estos siguen sin probarse en este alcance porque requieren invocar proveedor, credenciales o Chrome del usuario. No ejecutar `npm run check:live` como verificación segura.

## Verificación observada

- RED observado durante la corrección: el runner inicial falló al comprobar que el endpoint brain tenía una nota porque el root vacío de `npm run check` no contenía fixture de brain; luego una expectativa fija `SENTINEL` no coincidía con el config sintético `Synthetic Codex Office`. Se añadieron fixtures faltantes y las aserciones se conectaron a config/roster consumidos.
- Otro RED observado: navegador abortó con `Socket path too long` al quedar el perfil bajo un HOME/root de test anidado; luego `page.goto` agotó el timeout de 8s. Perfil y HOME se aislaron en rutas cortas temporales, y navegación local tiene 20s; `node --test test/check-smoke.test.mjs` pasó 2/2 incluyendo browser real.
- Suite completa, ejecutada dentro de `npm run check` en HOME/npmrc temporales: **135/135 pasan**.
- `npm run check` con `CHECK_BROWSER_EXECUTABLE=/usr/bin/google-chrome`, `npm_config_offline=true` y HOME/npmrc temporales: build **passed**, browser **passed** (roster/command-bar/team/routine/calendar/keyboard/approval; 1 URL externa bloqueada), HTTP **passed**, provider/usage/MCP **0/0/0**, suite **135/135**, exit 0.
- `npm run build` se ejecutó en el worktree aislado con brain sintético; restauré únicamente el `src/braingraph.js` incidental generado por el build. Segundo build sin brain sintético conservó el graph original. SHA observado de `src/braingraph.js`: `81a810ca6b97223a76f682294f4c93955071211c2c66d5d6d505f46dea98ec47`; SHA de `dist/command-centre-v2.html`: `e17dc929e1351b02551b62a1e6ceaf6b0506daa284b2615f91bfffad54cc770d`. Sin cambios en `dist`.
- `git diff --check`: limpio antes de documentar; se vuelve a correr tras cambios documentales.
- No se hizo instalación ni solicitud de red, ni se usó proveedor/auth/estado de credenciales, browser profile de usuario, child real de oficina o puerto predeterminado. `check:live` no se ejecutó.

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
- Rollback acotado: revertir el commit de continuación conserva los commits previos; no borra ni modifica datos del checkout fuente.
- `skill_resolution: paths-injected` — TDD, work-unit-commits y verification-before-completion leídos en sus rutas requeridas.
