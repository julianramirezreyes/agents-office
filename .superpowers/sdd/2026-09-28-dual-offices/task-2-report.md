# DO-02 — Informe de implementación

## Resultado

Se extrajo `createOfficeRuntime({ officeConfig, provider, dataRoot, brainPath })` para que cada proceso fije su oficina/proveedor al arrancar y use raíces de escritura explícitas. El CLI de Claude conserva el arranque sin argumentos: `loadConfig()` mantiene el puerto `4520`, el brain legado y `data/`.

`GET /api/health` expone la identidad estable `office`/`provider`. Los requests no pueden elegir una oficina mediante `office` en query o body. Se rechazó esa identidad explícitamente con HTTP 400 en vez de ignorarla como selector potencial.

Tasks, rutinas, uso, entrevistas y traducciones derivan su persistencia de `dataRoot`; notas, feedback, brain, roster personalizado y skills personalizados usan `brainPath`. CodeGraph indicó que el roster también cargaba el archivo global `office.agents.json`; por ello Codex ahora consulta solo el roster de su brain aislado. Claude conserva el orden y las fuentes existentes. Los assets de `skills/` compartidos permanecen como entradas distribuidas de solo lectura.

El apagado marca el servidor como cerrándose, detiene el scheduler y deja de aceptar solicitudes. Espera trabajos activos hasta `graceMs`; al vencer, cierra sockets HTTP pendientes, retorna el conteo de tareas activas y las deja completar/persistir de forma natural. El entrypoint no usa `process.exit`. Si un proveedor distinto de Claude alcanza el camino Claude antes de que exista su adaptador, la operación falla explícitamente; no se hace fallback a Claude.

## TDD

- **RED inicial:** `node --test test/office-server.test.mjs` falló con `SyntaxError`: el módulo aún no exportaba `createOfficeRuntime`.
- **RED de aislamiento del roster:** `node --test --test-name-pattern='codexRoster_usesOnlyItsIsolatedBrainCustomization' test/office-server.test.mjs` falló porque el roster Codex incluía `office.agents.json` además de la personalización en su brain.
- **GREEN:** el test del roster pasó `1/1` después del cambio. La prueba enfocada final pasó `7/7`.
- RED de fuga Claude: al forzar temporalmente `health` a anunciar el backend Claude, `codexRuntime_neverCallsClaudeUsageOrMcpAndDoesNotAdvertiseClaude` falló al detectar `backend: claude-cli`.
- RED de shutdown: `officeRuntime_closeReportsPendingDetachedTaskAndLetsItPersistAfterGrace` falló con el lifecycle anterior, que no devolvía `{ drained, pendingWork }`; el test prueba que el trabajo in-flight termina y persiste tras expirar el plazo.
- RED del entrypoint: el test falló primero porque `attachShutdownHandlers` aún no existía; tras implementarlo, verifica que `SIGTERM` no llame `process.exit` y registre trabajo pendiente.
- Los tests HTTP usan puertos efímeros (`port: 0`) y raíces temporales. Cubren identidad/proveedor, separación de lectura y escritura de tareas entre A/B, rechazo de identidad proporcionada por el cliente, health, no invocación de usage/MCP Claude, apagado/persistencia y continuidad de defaults Claude.

## Verificación

- `node --test test/office-server.test.mjs` — **10/10 pasan**.
- `node --test test/*.test.mjs` — **78/78 pasan**.
- `git diff --check` — **sin errores**.
- `npm run build` — omitido deliberadamente: `build.mjs` regenera `src/braingraph.js` desde el brain del workspace y escribe `dist/*`; no era un check seguro/no mutante para este alcance.
- `npm run check` — omitido deliberadamente porque ejecuta un smoke server y el alcance prohíbe invocar lógica de proveedor/auth. No se usó `npm run check:live`.
- No se instalaron dependencias, no se usó red ni se iniciaron proveedores o autenticación. Durante el test enfocado, `graph-build` avisó que `d3-force` no está instalado y usó su layout incorporado; todos los tests pasaron.

## Auto-revisión

- La identidad (`OFFICE`, `PROVIDER`) queda en constantes del cierre del runtime; no hay selector de oficina por request.
- El estado mutable de las rutas rutinarias, onboarding, uso y tareas emplea `DATA` que resuelve al `dataRoot`; las salidas de notas, brain, entrevistas/feedback, roster y skills propios usan `BRAIN`.
- Se encontró y corrigió una fuga de configuración no obvia: `loadRoster()` incorporaba el roster de aplicación común también en Codex. La opción `{ office: 'codex' }` limita sus fuentes al brain de la instancia.
- El objeto de proveedor recibido fija identidad; el adaptador ejecutable Codex pertenece a DO-03. Hasta entonces, el camino Claude falla explícitamente para proveedores no-Claude; no hay fallback.
- La prueba de cierre verifica que el listener deja de servir y que las tareas persistidas permanecen. El cierre acotado limita las conexiones HTTP; el trabajo de provider no es cancelado aquí.

## Commits y rollback

- `58c6a976990118a4c70954db81a79d1bab33aa94` — `refactor: isolate office server runtime state`
- `52e8b9a26a55a2e217874dc5d8a4b223fffb2419` — `fix: isolate Codex roster customizations`
- Commits correctivos se consignan en la sección de seguimiento.
- Rollback: revertir los commits DO-02 en orden inverso; no requiere cambios a launcher, UI, SDK Codex ni datos del checkout fuente.

## Handoff

- **Siguiente tarea:** DO-03 — adaptar proveedor Codex con doble inyectable, sin leer credenciales ni usar proveedor real.
- **skill_resolution:** `paths-injected` — TDD, work-unit-commits y verification-before-completion fueron leídos desde sus rutas instruidas.

## Seguimiento de revisión DO-02

- **Causa P1:** endpoints `/api/usage` y `/api/mcp` ejecutaban servicios Claude sin verificar el proveedor; health publicaba modelo, herramientas, Chrome y equipos Claude. `PROVIDER` también caía a `claude` cuando `office: codex` no inyectaba un proveedor.
- **Corrección P1:** el proveedor por omisión deriva de la oficina; Codex no crea SDK Anthropic, ni ejecuta uso/MCP, ni expone capacidades Claude en health. Health anuncia `backend: codex`, modelo nulo, listas de modelos vacías, herramientas/equipos desactivados y resumen MCP vacío. Las inyecciones de test espían llamadas y bloquean lecturas de credenciales.
- **Causa P2:** `close()` sólo esperaba conexiones; el entrypoint terminaba con `process.exit(0)`, pudiendo matar tareas detached antes de guardar su resultado.
- **Corrección P2:** `close({graceMs})` deja de aceptar requests, detiene rutinas, espera promesas activas; al vencer cierra sockets HTTP y devuelve `{ drained, pendingWork }`. Las tareas no se cancelan y persisten cuando terminan. `attachShutdownHandlers` informa el conteo pendiente y permite que Node salga naturalmente, sin `process.exit`; el caso Claude idle conserva cierre natural.
- **GREEN:** `node --test test/office-server.test.mjs` — 10/10; `node --test test/*.test.mjs` — 78/78; `git diff --check` — limpio.
- El cierre sin tareas conserva el resultado `{ drained: true, pendingWork: 0 }`; el test Claude existente verifica esta semántica.
- **Límites ambientales:** `graph-build` informó que `d3-force` no está instalado y usó layout incorporado. No se ejecutaron proveedores/auth, `npm run check:live`, instalaciones ni red. Build/smoke siguen omitidos por los motivos arriba descritos.
- **Commits de seguimiento:** `c8667aa` (`fix: isolate provider endpoints and drain shutdown work`), `2ff77b7` (`test: assert clean Claude shutdown result`), `c8ff4dd` (`docs: record DO-02 review corrections`).
- **Hash evidencia código/tests:** `serve.mjs` `7a2593a3963ce5a713029137f1d5b598f3f42ab443bbf9e87b9284a015b14485`; `test/office-server.test.mjs` `45ba78b1bc0829f8c24c02c81c3a5d7f1e487f781d94355fe0a7b35d2d8b6300`.
