# DO-03 — Informe de implementación (parcial)

## Resultado

Se implementaron `createCodexProvider` y la costura de tareas en `serve.mjs`. El adaptador inyectable consume el `runStreamed` documentado, fija `workingDirectory`, `model`, `sandboxMode` y `approvalPolicy`, persiste el `threadId` y el uso solo cuando aparecen en eventos reales, y reenvía únicamente eventos recibidos. Los modelos/herramientas quedan desconocidos (`null`) cuando el runtime no los enumera. Una política inválida o un cwd fuera del workspace queda bloqueado sin iniciar el SDK. Errores y aprobaciones no compatibles permanecen en la oficina Codex; no hay fallback a Claude.

La tarea queda **completa**. Tras autorización explícita, `@openai/codex-sdk@0.157.1` se instaló desde registry npm público anónimo con scripts deshabilitados, se declaró como dependencia exacta y se generó un lock legítimo con URL e integridad del registry. El import del módulo verifica que el export `Codex` existe, sin instanciarlo, iniciar CLI/hilo ni llamar proveedor o auth.

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
- **RED — estado failed sin error:** un provider doble devolvió `{ status: 'failed', text: 'provider output', error: null }`; antes del arreglo la tarea persistía `approved: true` y escribía una nota.
- **GREEN — éxito explícito:** para resultados que reportan estado de provider, el runtime solo ejecuta efectos de aprobación/notas con `providerStatus: 'completed'`; otros estados dejan `approved: false`, limpian `approvedAt` y no generan nota. Proveedores legacy sin estado reportado mantienen el flujo existente.
- **Commit correctivo:** `2300a02` (`fix: require completed Codex approval result`).
- **Instalación autorizada:** `npm install --save-exact --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org @openai/codex-sdk@0.157.1` — exit 0, 15 paquetes añadidos. `NPM_TOKEN` y `NODE_AUTH_TOKEN` se quitaron del entorno; user/global config se aisló sin leer archivos de configuración npm ni credenciales.

## Verificación observada

- `node --input-type=module -e ...` — manifest y lock coinciden en `0.157.1`, URL corresponde a `registry.npmjs.org`, lock contiene integridad.
- `npm ls @openai/codex-sdk --depth=0 --offline --registry=https://registry.npmjs.org` — versión instalada `0.157.1`.
- `node --input-type=module -e "import('@openai/codex-sdk')..."` — `Codex` exportado como función; no instancia cliente ni llama proveedor.
- `node --test test/codex-provider.test.mjs test/office-server.test.mjs` — **23/23**.
- `node --test test/*.test.mjs` — **91/91**.
- Runtime harness `node --test test/codex-provider.test.mjs` — injected SDK double plus local HTTP/ephemeral port and temporary data/brain roots; **9/9** (covered by the observed combined run).
- `git diff --check` — limpio.
- Build/check no ejecutados: la comprobación de servidor existente puede recorrer lógica de proveedor; build recompone artefactos generados fuera de este alcance. La dependencia se instaló por la única operación de red autorizada. No se ejecutaron auth, `codex login status`, proveedores reales ni se construyó el SDK.

## Alcance y preservación

- Cambios limitados al adaptador, su prueba, `serve.mjs`, `package.json` y `package-lock.json`; el paquete se obtuvo solo desde el registry público autorizado, sin scripts ni credenciales.
- `serve.mjs` deriva el proveedor únicamente de la identidad de proceso. En Codex evita la ruta de router/teams/chat/traducción de Claude y no expone modelos/herramientas Claude en health/roster.
- Los tests corrieron contra un SDK doble, HTTP local con puerto efímero y roots temporales; `d3-force` ausente usó el layout incorporado y no afectó los resultados.
- No se leyeron credenciales ni se inició sesión o proveedor real.

## Próximo paso

DO-03 está cerrada en el tracker ODD tras observar dependencia fijada, import del SDK y pruebas locales. Quedan fuera de alcance autenticación, llamadas reales al proveedor, construcción del SDK y workflows de build/check potencialmente mutantes.

## Commit y rollback

- Commit de implementación: `5143072` (`feat: add local Codex provider adapter`).
- Rollback: revertir `5143072`; afecta solo al adaptador Codex, su integración de servidor, sus pruebas y el registro DO-03; no modifica datos del usuario, configuración de Claude ni manifests.

## skill_resolution

`paths-injected` — se leyeron los cuatro `SKILL.md` exactos indicados para DO-03: TDD, verificación, work-unit-commits y OpenAI Docs.
