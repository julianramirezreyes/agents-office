# Informe de implementación — DO-06

## Resultado

Se agregaron los seis escenarios de integración pedidos, usando directorios temporales independientes, dobles de runtime/provider y puertos efímeros. La cobertura comprueba tareas simultáneas; preservación byte-identical de la configuración, tareas y nota fixture Claude al iniciar Codex; health y almacenamiento separados; navegación sin señalizar children propios; fallo del provider Codex sin dejar fuera de servicio la tarea Claude; y reinicio de Claude con historial de ambas oficinas intacto.

La inspección completa del runner previo mostró que `npm run check` llamaba `build.mjs` (que reescribe `src/braingraph.js` desde el brain del checkout) y arrancaba `serve.mjs` con la configuración Claude del checkout, para consultar `/api/usage` y `/api/mcp`. Eso no ofrecía garantía de aislamiento de datos ni de no tocar estado provider/auth local. Se sustituyó el check predeterminado por `node --test` sobre todos los `test/*.test.mjs`, una suite local de fixtures/dobles. `CHECK_LIVE=1` se rechaza explícitamente; no se ejecutó `npm run check:live`. El build permanece como verificación separada.

## TDD

- Los contratos de integración ya estaban implementados en las tareas 1–5; no se necesitó modificar comportamiento de producción. Los seis casos nuevos se ejecutaron contra esos contratos existentes y pasaron.
- La primera corrida completa encontró un error en el harness del caso Codex-failure: `taskRunner` se había pasado dentro de `runtimeOptions`, por lo que Claude siguió el flujo normal local. Se corrigió la inyección del doble; no se llamó un provider ni se autenticó. La corrida enfocada posterior confirmó los seis escenarios en verde.
- Las pruebas usan datos sintéticos de fixtures temporales. No leen el checkout fuente como fixture ni usan provider/auth real, `codex login status`, procesos reales Claude/Codex o puertos predeterminados.

## Verificación observada

- `node --test test/office-paths.test.mjs test/office-server.test.mjs test/codex-provider.test.mjs test/launcher.test.mjs test/office-navigation.test.mjs` — **76/76 pasan**.
- `node --test test/*.test.mjs` — **132/132 pasan**.
- `npm run check` — **132/132 pasan**; `check.mjs` ejecuta exclusivamente los tests locales. No inicia el servidor del checkout, no compila ni consulta uso/MCP.
- `npm run build` — **exit 0**; produjo `dist/command-centre-v2.html` (1491 KB). El build regeneró `src/braingraph.js` (35 notas, 34 vinculadas); se restauró únicamente ese archivo incidental. Los artefactos `dist/` se conservaron y sus hashes no cambiaron.
- `git diff --check` — limpio para el commit de código/tests; volverá a ejecutarse después de este informe.
- No se usó `npm run check:live`; el runner anterior mezclaba smoke de UI/build y server contra estado del checkout, por lo que esos pasos no se conservaron como ejecución predeterminada. La suite local cubre los contratos de la aplicación sin ese límite de privacidad.

## Archivos y decisiones

- `test/office-server.test.mjs` — tareas concurrentes, snapshot Claude byte-identical, health/storage no cruzados y reinicio preservando historias.
- `test/codex-provider.test.mjs` — fallo Codex no impide que Claude complete su tarea.
- `test/launcher.test.mjs` — destinos de navegación runtime no señalizan los dos children simulados.
- `check.mjs` — check predeterminado seguro de fixtures que invoca la suite completa; el modo live queda rechazado explícitamente.
- `odd/tasks/dual-offices.md` — DO-06 marcado completo con evidencia y siguiente paso.

## Commit y rollback

- Commit de tests/check: `ac5962edab2ef518a297ea17b1726f10e5a3c048` — `test: verify independent Claude and Codex offices`.
- Rollback: revertir ese commit para retirar los escenarios y el runner fixture-only; esto restauraría el runner anterior, que sí accedía al server/config/estado Claude del checkout en `npm run check`.
- Runtime harness: N/A para provider real; las integraciones se ejercieron con runtimes in-process, doubles y raíces temporales.
- `skill_resolution: paths-injected` — TDD, work-unit-commits y verification-before-completion se leyeron de las rutas indicadas.
