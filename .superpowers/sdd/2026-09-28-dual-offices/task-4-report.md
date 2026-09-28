# Informe de implementación — DO-04

## Resultado

Se implementó el home local y el supervisor de las oficinas Claude/Codex. Los defaults continúan siendo launcher `4519`, Claude `4520` y Codex `4521`. La readiness y la causa de fallo se reportan por separado; un fallo en una oficina no detiene la otra. El launcher no proporciona rutas proxy de tareas o chat.

## Diseño y límites

- `createLauncher({ config, spawnProcess, fetchHealth, graceMs })` valida el par de oficinas y los tres puertos antes de escuchar o crear hijos. La resolución no crea directorios ni archivos. No se sondean puertos para encontrar o identificar procesos ajenos.
- Cada proceso recibe identidad/provider, puerto y rutas mutables específicos. El child de Codex recibe `CODEX_HOME` solo cuando fue configurado explícitamente/resuelto para esa oficina.
- El health del launcher mantiene los dos estados independientes y devuelve la URL del runtime cuando está reportada; en ausencia de esa propiedad, usa el destino local configurado. El home obtiene el estado y los href desde este endpoint, sin hardcodear URLs de las oficinas.
- En el cierre, el servidor del home deja de aceptar solicitudes y únicamente se envía `SIGTERM` a handles retornados por los spawn propios. Se espera hasta el plazo; el resultado identifica hijos que no terminaron y el último número conocido de trabajo pendiente. El servidor de oficina recibe el shutdown normal y conserva su propio estado.
- El entrypoint de `serve.mjs` solo activa carga de configuración gestionada si `AO_OFFICE` está definido; sin esa variable mantiene el arranque/defaults Claude previos.

## TDD y verificación

- **RED:** `node --test test/launcher.test.mjs` falló inicialmente con `ERR_MODULE_NOT_FOUND` para `launcher.mjs`, como esperado. Una falla posterior reprodujo que los puertos configurables aún no alimentaban al validador.
- **GREEN focal:** `node --test test/launcher.test.mjs` — 6/6.
- **Verificación combinada:** `node --test test/launcher.test.mjs test/office-paths.test.mjs test/office-server.test.mjs` — 29/29.
- **Suite completa:** `node --test test/*.test.mjs` — 97/97.
- **Diff:** `git diff --check` — limpio tras registrar el informe y la actualización ODD.
- `npm run build` se omitió: no se modificaron fuentes que generen `dist/` ni otro artefacto. `npm run check:live` no se ejecutó.

## Harness y seguridad

Las pruebas inyectan `spawnProcess` y `fetchHealth`; el home real del test utiliza un puerto efímero. Ningún hijo real fue lanzado, los puertos por defecto de las oficinas no se ligaron, y no se invocaron Codex, Claude, proveedor, login o auth. No se inspeccionaron ni mataron procesos ajenos, no hubo instalación/descarga ni lectura de credenciales.

## Rollback y commits

Rollback: revertir el commit funcional DO-04 y luego el commit documental que registre su identidad. El rollback abarca `launcher.mjs`, `home.html`, `test/launcher.test.mjs`, cambios de DO-04 en `office-paths.mjs`/`serve.mjs` y los registros DO-04 de ODD/este informe; no toca datos ni archivos locales de Claude.

Commit de unidad: `ec9a846130bd98668b6eab9b45ffcf869d040341` (`feat: launch and supervise isolated offices`). La actualización documental que registra esta identidad va en un commit separado.

## Resolución de skills

`paths-injected`: leídos los archivos exactos de TDD, work-unit-commits y verification-before-completion indicados en el encargo. No se usaron subagentes.

## Corrección por revisión independiente

La revisión reprodujo cuatro clases de fallo: el launcher aceptaba health de otro office/provider y copiaba `health.url` sin validar al href; un fetch en vuelo podía ocultar una salida de child; `close()` concurrente con `start()` podía retornar dejando el listener y dos children vivos; una URL efectiva de navegación alteraba la URL del siguiente probe.

- **RED:** se añadieron repros con `fetchHealth`/spawn dobles. Cinco casos fallaron contra el baseline: identidad no validada, `javascript:` aceptado, probe atrasado sobreescribiendo fallo, cierre concurrente incompleto y base de probe contaminada por navegación. El run se interrumpió después de confirmar que el repro de lifecycle dejaba el listener abierto. Después fallaron repros para payload sin `ok: true` y bind wildcard de home antes de sus fixes.
- **GREEN:** identidad debe coincidir en `office` y `provider`, y health debe tener `ok: true`. URL de navegación requiere HTTP(S), sin user/password, loopback y mismo origin/port configurado; payload inválido no reemplaza destino local seguro. Bind del home también debe ser loopback, y office probes quedan fijados a `127.0.0.1` incluso si se configura el host de escucha del home. Tradeoff: se rechazan URLs runtime aunque sean locales si alteran origen/puerto, evitando navegación cross-origin o a otro servicio; se conserva fallback local seguro y la oficina no se declara ready. El probe usa una base inmutable separada. Se descartan resultados asíncronos tras `exit`; `close()` bloquea nuevos starts y espera un start en curso antes de cerrar listener y children propios.
- **Verificación focal:** `node --test test/launcher.test.mjs` — 13/13. **Combinada:** `node --test test/launcher.test.mjs test/office-paths.test.mjs test/office-server.test.mjs` — 36/36. **Suite:** `node --test test/*.test.mjs` — 104/104. `git diff --check` — limpio.
- Sin puertos default ligados, procesos reales, provider/auth, instalaciones ni `check:live`; no se mataron procesos ajenos.
- Commit de corrección: pendiente. El hash se registra en este informe en un commit documental separado.
