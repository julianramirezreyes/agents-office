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
