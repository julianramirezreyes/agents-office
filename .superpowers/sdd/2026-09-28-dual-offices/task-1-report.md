# Informe de implementación — DO-01

## Estado

Implementada en `feat/dual-offices` dentro del alcance de la Tarea 1. Además de aislar defaults y capacidades de Claude, esta corrección P2 conserva el puerto Codex inválido para que la validación lo rechace en lugar de reemplazarlo silenciosamente por `4521`. No se iniciaron proveedores ni se inspeccionaron credenciales. La resolución de rutas sigue siendo pura: no crea directorios ni lee archivos de configuración local Codex.

## Archivos

- `config.mjs` — conserva `loadConfig()` sin argumentos para Claude y añade configuración efectiva por oficina; Codex omite `brain`, `port`, `model`, `mcp`, `tools` y `teams` del config compartido; no activa capacidades no confirmadas aunque aparezcan en el local Codex; convierte puertos Codex sin ocultar valores inválidos.
- `office-paths.mjs` — resuelve rutas Claude/Codex y valida colisiones de puertos y solapamiento de rutas canonizadas.
- `.gitignore` — excluye las nuevas raíces y configuración local Codex.
- `test/office-paths.test.mjs` — pruebas de compatibilidad, aislamiento, overrides, alias, puertos, no escritura y `CODEX_HOME`.
- `odd/tasks/dual-offices.md` — marca DO-01 y conserva evidencia, verificación, rollback y siguiente paso.

## RED → GREEN → REFACTOR

- **RED — contrato ausente inicial:** `node --test test/office-paths.test.mjs` falló porque no existía `office-paths.mjs`; el fallo correspondió a la API nueva faltante. La regresión `AO_CLAUDE_PORT` sin opciones reprodujo `TypeError` antes de su arreglo.
- **RED — revisión P1 de defaults:** `loadConfig_codexDoesNotInheritClaudeProviderDefaults` observó `4520 !== 4521` sobre un fixture con config Claude (`brain: ./brain`, `model: sonnet`). La prueba de colisión usa la configuración efectiva: un `port: 4520` explícito en `office.config.codex.local.json` se detecta contra el puerto efectivo de Claude.
- **RED — revisión P1 de capacidades:** `loadConfig_codexDoesNotInheritClaudeCapabilities` observó `mcp.allow` con el conector de Gmail Claude al cargar Codex; el fixture fuerza además browser y teams en base y config local. La expectativa define la frontera del spec: configuración Codex vacía para MCP, web/browser desactivados y teams desactivado hasta que el runtime confirme esas capacidades.
- **RED — puerto inválido P2:** `loadConfig_codexInvalidEnvironmentPortRemainsInvalidForValidation` falló al observar `4521` en vez de conservar la entrada inválida `AO_CODEX_PORT=not-a-port`.
- **GREEN — focalizado:** `node --test test/office-paths.test.mjs` — 12 pruebas, 12 aprobadas, 0 fallidas.
- **GREEN — suite:** `node --test test/*.test.mjs` — 68 pruebas, 68 aprobadas, 0 fallidas.
- **Formato del diff:** `git diff --check` — sin errores.
- **Comprobación del proyecto:** `npm run check` — 19/22 en la pasada previa; no pasaron build por `esbuild` ausente, smoke por `playwright-core` ausente y `server: starts`. No se repitió en esta corrección para respetar el límite explícito de no invocar rutas auth/provider. `npm run build` (ejecución actual) — `ERR_MODULE_NOT_FOUND` para `esbuild`. No se instalaron dependencias.

## Autorrevisión

- `loadConfig()` mantiene por defecto `office.config.local.json`, `data/`, el brain calculado desde `cfg.brain`, modelo `sonnet` y puerto `4520`; `PORT` y `AO_BRAIN` legacy siguen aplicando y la coerción legacy Claude permanece sin cambios.
- `loadConfig({ office: 'codex' })` usa `office.config.codex.local.json`, `data-codex/`, `brain-codex/`, `4521` y no fuerza un modelo Claude; conserva overrides locales/de entorno Codex permitidos y sus puertos efectivos participan en `validateOfficePair`. MCP, web/browser y teams quedan vacíos/desactivados hasta que el runtime confirme soporte.
- Rutas existentes se canonizan con `realpath` del ancestro existente; rutas no existentes se normalizan sin crear entradas. La prueba de centinelas verifica contenido, inodo, tamaño y `mtime` Claude sin cambios y la ausencia de raíces Codex creadas.
- El test de alias usa enlace simbólico hacia la misma carpeta, no solo dos cadenas lexicalmente equivalentes.
- Sin bloqueo funcional conocido en T1. La verificación ampliada sigue limitada por dependencias de entorno; no se instalaron porque está prohibido.

## Commit

- Mensaje: `feat: resolve isolated office state paths`
- Hash de implementación: `03d8098326a33fec089d84644bce55439391d665`.
- Commit de corrección P1: `dc98d799c4ddfb02654e3c1e3854a2406e6c18ca` (`fix: isolate effective Codex config defaults`).
- Commit de corrección de capacidades: `16a1181fdf9afa9511489de4f3962398e9f44d1f` (`fix: isolate Codex capabilities from Claude`).
- Commit de corrección P2 para puertos inválidos: pendiente de crear.
- Revisión nativa: pendiente del orquestador.

## Riesgos y seguimiento

- Los flujos runtime que consuman la nueva configuración son trabajo de tareas posteriores; este cambio solo resuelve y valida rutas.
- `npm run check` y `npm run build` requieren dependencias de desarrollo no instaladas (`esbuild` y `playwright-core`).
- `skill_resolution: paths-injected`
