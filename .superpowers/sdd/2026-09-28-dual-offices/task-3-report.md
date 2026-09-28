# DO-03 — Informe de implementación (parcial)

## Resultado

Se implementaron `createCodexProvider` y la costura de tareas en `serve.mjs`. El adaptador inyectable consume el `runStreamed` documentado, fija `workingDirectory`, `model`, `sandboxMode` y `approvalPolicy`, persiste el `threadId` y el uso solo cuando aparecen en eventos reales, y reenvía únicamente eventos recibidos. Los modelos/herramientas quedan desconocidos (`null`) cuando el runtime no los enumera. Una política inválida o un cwd fuera del workspace queda bloqueado sin iniciar el SDK. Errores y aprobaciones no compatibles permanecen en la oficina Codex; no hay fallback a Claude.

La Tarea queda **parcial**: el paquete `@openai/codex-sdk@0.157.1` no está instalado ni está disponible en la caché npm local. La actualización permitida `npm install --package-lock-only --offline --ignore-scripts --save-exact @openai/codex-sdk@0.157.1` falló con `ENOTCACHED` antes de modificar manifests. No se fabricaron cambios a `package.json`/`package-lock.json`; sin declarar y fijar la dependencia real no se afirma que el SDK pueda cargarse en producción. La casilla DO-03 sigue abierta.

## TDD

- **RED inicial:** `node --test test/codex-provider.test.mjs` falló al importar `codex-provider.mjs`, que aún no existía (`ERR_MODULE_NOT_FOUND`).
- **RED de política:** la prueba `codexProvider_blocksInvalidConfiguredPolicyWithoutReplacingItWithBroaderDefaults` falló cuando la política inválida terminaba en `failed` tras intentar cargar el SDK, en vez de bloquear antes de iniciar; luego pasó al validar controles antes de crear el cliente.
- **Pruebas con doble:** herencia de entorno sin opciones/credenciales, workspace/model/sandbox/aprobación, capacidades desconocidas, política incompatible, eventos finales únicamente, errores del proveedor y no-fallback.

## Corrección posterior a revisión independiente

- **RED — cwd con symlink:** una raíz temporal del workspace contenía un symlink a un directorio temporal externo. La llamada llegaba al doble del SDK y terminaba `failed` en vez de `blocked`; la prueba también cuenta las construcciones del SDK y llamadas a `startThread`.
- **GREEN — cwd canónico:** antes del SDK, `realpathSync` resuelve la raíz y el cwd solicitado, no crea directorios y evalúa contención sobre rutas canónicas. Si cualquiera no existe/no es resoluble, se bloquea sin empezar hilo. El SDK recibe el cwd canónico.
- **RED — aprobación:** el doble de provider devolvió `blocked` tras `/approve`, y el test observó `approved: true` pese al error.
- **GREEN — aprobación diferida:** solo un resultado sin error y distinto de `blocked`/`pending` persiste `approved: true`. Error/blocked/pending conserva `approved: false` y elimina `approvedAt`; no cambia política ni busca otro provider.
- **Commit correctivo:** `27aac42` (`fix: contain Codex cwd and defer approval state`).

## Verificación observada

- `node --test test/codex-provider.test.mjs test/office-server.test.mjs` — **22/22**, tras la corrección independiente.
- `node --test test/*.test.mjs` — **90/90**, tras la corrección independiente.
- Runtime harness `node --test test/codex-provider.test.mjs` — injected SDK double plus local HTTP/ephemeral port and temporary data/brain roots; **9/9** (covered by the observed combined run).
- `npm install --package-lock-only --offline --ignore-scripts --save-exact @openai/codex-sdk@0.157.1` — **bloqueado por ENOTCACHED**; no instaló ni cambió manifests.
- `git diff --check` — limpio antes del commit correctivo.
- Build/check no ejecutados: la comprobación de servidor existente puede recorrer lógica de proveedor; build recompone artefactos generados fuera de este alcance. No se ejecutaron auth, `codex login status`, proveedores reales ni red.

## Alcance y preservación

- Cambios limitados al adaptador, su prueba y `serve.mjs`; manifests intactos por falta de caché del paquete.
- `serve.mjs` deriva el proveedor únicamente de la identidad de proceso. En Codex evita la ruta de router/teams/chat/traducción de Claude y no expone modelos/herramientas Claude en health/roster.
- Los tests corrieron contra un SDK doble, HTTP local con puerto efímero y roots temporales; `d3-force` ausente usó el layout incorporado y no afectó los resultados.
- No se leyeron credenciales ni se inició sesión o proveedor real.

## Próximo paso

Resolver disponibilidad autorizada del paquete sin añadir un lock inventado; entonces declarar la dependencia con su lockfile válido, ejecutar las mismas verificaciones locales y cerrar DO-03 solo después de observar el resultado.

## Commit y rollback

- Commit de implementación: `5143072` (`feat: add local Codex provider adapter`).
- Rollback: revertir `5143072`; afecta solo al adaptador Codex, su integración de servidor, sus pruebas y el registro DO-03; no modifica datos del usuario, configuración de Claude ni manifests.

## skill_resolution

`paths-injected` — se leyeron los cuatro `SKILL.md` exactos indicados para DO-03: TDD, verificación, work-unit-commits y OpenAI Docs.
