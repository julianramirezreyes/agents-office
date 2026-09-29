# Informe de corrección — DO-06

## Estado

**Parcial; requiere decisión de alcance sobre la cobertura heredada no portada.** La revisión de la primera entrega detectó una reducción del runner `check.mjs` (623 líneas en `f69e19c`) y escenarios cuya configuración, roster, launcher o navegación no estaban conectados al código ejercitado. Esta corrección restaura las categorías de build, UI/browser y HTTP con fixtures aislados, y corrige esas integraciones; no afirma equivalencia total con cada smoke assertion histórica.

## Correcciones verificadas

- `npm run check` ejecuta `npm run build` en una copia temporal controlada que contiene solamente las entradas necesarias, un brain sintético enlazado, `node_modules` de solo lectura y configuración npm temporal/offline. El build escribe sus salidas únicamente en la copia temporal; no compila desde el brain del worktree ni toca `src/braingraph.js`/`dist` del checkout.
- La categoría de UI intenta abrir el HTML local generado con `playwright-core`. Resultado observado: **skipped**, porque no hay ejecutable de navegador Playwright local; no se descargó ni instaló uno.
- La categoría HTTP crea `createOfficeRuntime` Codex desde un `loadConfig({root: fixture})` y roster sintéticos, consulta health, tasks, usage, MCP y roster en `127.0.0.1`/puerto efímero `0`; SDK/provider, usage y MCP son dobles. El sentinel Codex del roster aparece en la respuesta del runtime, demostrando que el fixture se consumió. Sus contadores de invocación permanecen `0/0/0`.
- `test/check-smoke.test.mjs` deja config, roster local, brain y data sentinel byte-identical al ejecutar el smoke sobre un root de control; el runner no resuelve ni lee esos archivos como configuración.
- Todas las invocaciones de `loadConfig` en las pruebas usan roots/env sintéticos explícitos. El runtime ahora permite inyectar `rosterLoader`; las pruebas Claude aportan uno sintético en vez de consultar `office.agents.local.json` del checkout.
- `claudeSnapshotIsByteIdenticalAfterCodexStartup` lee la configuración con `loadConfig` desde el fixture, observa su modelo/ruta resueltos y usa el roster sintético como entrada consumida por el runtime; luego compara config, tareas, nota y roster byte a byte.
- `launcher_twoOfficesRunIndependentTasksAtOnce` ahora instancia `createLauncher` con dobles de child, enlaza health a dos runtimes HTTP de fixture y prueba tareas simultáneas mientras ambos handles siguen intactos.
- `navigationDoesNotCallTaskCancellation` ejecuta `updateOfficeSwitch`, sigue el `href` producido hasta un servidor HTTP local y verifica el destino; no hay llamada de cancelación.

## Cobertura heredada no portada

Aunque se restauraron las categorías principales solicitadas (build, browser/UI local y servidor HTTP), no se migraron como smoke assertions dedicadas todas las comprobaciones del runner legado de roster/conectores, rutinas, modelos/uso, equipos, calendario y cada ruta de UI. Algunas tienen pruebas unitarias en la suite, pero no son sustituto demostrado de todas las aserciones de smoke que fueron retiradas. Por eso DO-06 permanece **parcial** y necesita confirmación del responsable sobre si portar esas categorías restantes a fixtures, o aceptar la cobertura focal restaurada junto con las pruebas unitarias existentes.

## Verificación observada

- RED: `node --test test/check-smoke.test.mjs` falló primero porque `runSafeSmoke` no existía; la prueba también reprodujo la fuga al roster real del checkout (`office.agents.json`) antes de inyectar `rosterLoader`.
- GREEN enfocado: con HOME temporal y limpio, `node --test test/office-paths.test.mjs test/office-server.test.mjs test/codex-provider.test.mjs test/launcher.test.mjs test/office-navigation.test.mjs test/check-smoke.test.mjs` — **78/78 pasan**.
- Suite completa: `node --test test/*.test.mjs` — **134/134 pasan**.
- Runner default: `npm run check` — smoke de build **passed**, UI/browser **skipped** (sin ejecutable local), HTTP **passed**, contadores provider/usage/MCP **0/0/0**, suite **134/134 pasa**.
- `npm run build` del smoke se ejecutó en la copia temporal con `NPM_CONFIG_OFFLINE=true` y `.npmrc` vacíos temporales; no se invocó el build contra el brain ni los artefactos de este worktree. Se conservaron sus `dist/` y `src/braingraph.js` existentes.
- `git diff --check` — limpio para el commit de código; se repetirá después de actualizar este informe.
- No se ejecutó `npm run check:live`; no hubo instalación, red, autenticación/credenciales, comandos Claude/Codex, procesos reales de oficina ni puertos por defecto.

## Archivos principales

- `check.mjs` — smokes aislados de build, browser local opcional y HTTP; suite completa con HOME/config npm temporales.
- `serve.mjs` — costura inyectable `rosterLoader` para pruebas sin roster local.
- `test/check-smoke.test.mjs` — centinelas y contadores que prueban aislamiento del runner.
- `test/office-server.test.mjs` — configuración/roster consumidos, launcher real con children dobles y concurrencia.
- `test/office-navigation.test.mjs` — enlace producido seguido a HTTP local.
- `test/office-paths.test.mjs`, `test/codex-provider.test.mjs` — configuración de fixture explícita; elimina llamadas a `loadConfig()` sin root.

## Commit y rollback

- Commit anterior de la primera implementación: `ac5962e` (`test: verify independent Claude and Codex offices`).
- Commit de corrección de código/tests: `3f6854c` (`test: harden fixture-only dual office checks`).
- Rollback de esta corrección: revertir `3f6854c`; conserva los commits y archivos anteriores sin tocar datos del checkout fuente.
- `skill_resolution: paths-injected` — TDD, work-unit-commits y verification-before-completion leídos desde las rutas requeridas.
