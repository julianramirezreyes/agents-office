# Informe de implementación — DO-05

## Resultado

Se añadió navegación directa entre las oficinas con etiqueta accesible `Switch office`. Cada oficina obtiene la URL efectiva de su launcher desde configuración del proceso; la página consulta la salud de la otra oficina y muestra el destino solo cuando identidad, proveedor, readiness y URL loopback son válidos. Un destino fallido conserva disponible la oficina actual y presenta el motivo.

Los controles de Codex ahora permanecen ocultos salvo que el runtime reporte capacidades compatibles. Los modelos se muestran con su identificador exacto, se descartan aliases Claude, y no se habilitan controles de esfuerzo o equipos sin confirmación. Estado y uso se etiquetan por proveedor; los motivos de uso no disponible y las limitaciones reportadas quedan visibles. El home existente conserva la readiness y la entrada independientes de Claude y Codex.

## Diseño y alcance

- El launcher inyecta `AO_LAUNCHER_URL` en cada proceso hijo después de escuchar; por eso el valor refleja el puerto realmente enlazado, incluso si la configuración usa `0`. `/api/health` de la oficina publica ese origen configurado. No se infiere el destino a partir de una solicitud ni se fija un puerto en el HTML.
- El enlace solo hace una consulta GET de salud al launcher. No invoca endpoints de tareas/cancelación ni altera procesos.
- `src/office-ui.js` centraliza la validación loopback, la resolución del destino y las reglas de controles confirmados. La URL publicada del destino ya pasa además la validación del launcher.
- `build.mjs` no necesitó cambios: ya empaqueta imports de `src/main.js` y reemplaza `<!--APP-->` en el shell. `npm run build` actualizó `dist/command-centre-v2.html`. El build también regeneró `src/braingraph.js` a partir del brain local; ese cambio no era parte de DO-05 y se restauró, sin tocar el checkout fuente.

## TDD y verificación

- **RED:** la primera prueba focal confirmó que faltaba `src/office-ui.js`. Nuevos repros fallaron antes de corregirse para IPv6 (`[::1]` no se reconocía por la representación con corchetes de `URL.hostname`) y para un identificador `claude-sonnet-5` reportado entre modelos Codex.
- **GREEN:** `node --test test/office-navigation.test.mjs` — 10/10. Casos: tarjetas/readiness separadas, enlace runtime, destino no disponible con razón, nombre accesible, URL IPv6, ausencia de llamadas de cancelación, capacidades Codex, compatibilidad de controles Claude, proveedor desconocido y etiqueta del uso.
- **Launcher:** `node --test test/launcher.test.mjs` cubierto dentro de la suite; incluye verificación de que `AO_LAUNCHER_URL` coincide con el puerto real del home.
- **Suite completa:** `node --test test/*.test.mjs` — 115/115.
- **Build:** `npm run build` — terminó correctamente y generó `dist/command-centre-v2.html` (1490 KB).
- **Diff:** `git diff --check` — limpio.
- **No ejecutado:** `npm run check:live`; no se usaron providers, cuentas, autenticación ni procesos reales de Codex/Claude. Los tests de launcher usan dobles y puerto local efímero.

## Harness, rollback y entrega

- **Runtime harness:** N/A — la navegación se prueba con un fetcher doble; la propagación de URL se prueba mediante los dobles de spawn/health existentes y un home enlazado al puerto efímero.
- **Rollback:** revertir los commits de DO-05 para retirar el helper, navegación, cambios de presentación, pruebas y artefacto generado, preservando las tareas y cambios anteriores.
- **Commit de implementación:** `e03dd6e` (`feat: add cross-office navigation controls`).
- **Resolución de skills:** `paths-injected`; se leyeron los archivos exactos de `test-driven-development`, `work-unit-commits` y `verification-before-completion`. No se usaron subagentes.

## Corrección tras revisión independiente

- **CORS (P1):** `/api/health` añade `Access-Control-Allow-Origin` solo cuando `Origin` coincide exactamente con el origen de una de las URL loopback configuradas para las oficinas. Incluye `Vary: Origin`; no emite wildcard ni permite credenciales. El helper rechaza valores `null`, rutas, orígenes malformados y hosts/puertos no configurados. La prueba envía `Origin` HTTP real a un launcher local y verifica permiso para ambos puertos, rechazo de un origen externo y ausencia de credenciales.
- **XSS por modelos runtime (P1):** se centralizó escape HTML para `& < > " '` y se aplica en cada etiqueta HTML que muestra identificadores runtime: hints, estado de tarea, fila/tarjeta de rutina y tablero. El caso de prueba usa `<img src=x onerror="alert(1)">` y confirma que se escapan delimitadores y comillas.
- **Copy/errores Codex (P2):** estados de progreso, creación y error usan el nombre del proveedor activo; el calendario obtiene el proveedor del runtime. Si falla el envío, no se añade una tarea demo: se informa que no se creó ninguna y se conserva el texto para reintentar.
- **Logo Codex (P2):** la respuesta MCP expone identidad de proveedor hasta el cliente. La capa de modelos mantiene la presentación existente para Claude y no muestra logos de Claude ni ChatGPT en Codex o cuando el proveedor servido no puede determinarse; el modo `file://` conserva la demo.
- **TDD:** RED del test HTTP observó ausencia de ACAO; RED del payload falló al faltar el helper de escape; RED de copy/logo detectó exports inexistentes y la prueba de fallback devolvió `null` al perderse la identidad al fallar MCP. GREEN verificó el helper y la integración.
- **Verificación final:** `node --test test/office-navigation.test.mjs` — 17/17; `node --test test/*.test.mjs` — 124/124; `npm run build` — correcto, `dist/command-centre-v2.html` actualizado (1491 KB); `git diff --check` — limpio. El build regeneró únicamente la fecha de `src/braingraph.js`, cambio de datos locales ajeno a la tarea, y se restauró. No se ejecutaron proveedores, autenticación, procesos reales, instalaciones ni `npm run check:live`.
- **Runtime harness:** launcher HTTP local con puertos efímeros y dobles de child/health; no se arrancaron oficinas ni providers reales.
- **Rollback:** revertir el commit de correcciones DO-05 para restaurar el contrato CORS anterior, renderizado de modelos, textos de proveedor, presentación MCP y su artefacto `dist`; no revertir commits previos DO-05 ni tocar el checkout fuente.
- **Commit de corrección:** `82206d5` (`fix: address DO-05 review findings`). Este ajuste se limita a launcher/servidor/UI MCP y tareas, pruebas de regresión y HTML compilado. El commit documental registra esta evidencia por separado.
