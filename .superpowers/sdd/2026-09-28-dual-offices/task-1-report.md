# Informe de implementación — DO-01

## Estado

Implementada en `feat/dual-offices` dentro del alcance de la Tarea 1. No se iniciaron proveedores ni se inspeccionaron credenciales. La resolución es pura: no crea directorios ni lee archivos de configuración local Codex.

## Archivos

- `config.mjs` — conserva `loadConfig()` sin argumentos para Claude y añade la selección explícita de oficina, configuración local, raíces y variables de entorno.
- `office-paths.mjs` — resuelve rutas Claude/Codex y valida colisiones de puertos y solapamiento de rutas canonizadas.
- `.gitignore` — excluye las nuevas raíces y configuración local Codex.
- `test/office-paths.test.mjs` — pruebas de compatibilidad, aislamiento, overrides, alias, puertos, no escritura y `CODEX_HOME`.
- `odd/tasks/dual-offices.md` — marca DO-01 y conserva evidencia, verificación, rollback y siguiente paso.

## RED → GREEN → REFACTOR

- **RED — contrato ausente:** `node --test test/office-paths.test.mjs` falló porque no existía `office-paths.mjs`; el fallo correspondió a la API nueva faltante. Después se añadió una prueba de regresión que falló con `TypeError` en `loadConfig()` cuando `AO_CLAUDE_PORT` estaba definido sin opciones; se implementó la compatibilidad.
- **GREEN — focalizado:** `node --test test/office-paths.test.mjs` — 8 pruebas, 8 aprobadas, 0 fallidas.
- **GREEN — suite:** `node --test test/*.test.mjs` — 64 pruebas, 64 aprobadas, 0 fallidas.
- **Formato del diff:** `git diff --check` — sin errores.
- **Comprobación del proyecto:** `npm run check` — 19/22; no pasaron build por `esbuild` ausente, smoke por `playwright-core` ausente y `server: starts`. `npm run build` — `ERR_MODULE_NOT_FOUND` para `esbuild`. No se instalaron dependencias conforme al límite de la tarea.

## Autorrevisión

- `loadConfig()` mantiene por defecto `office.config.local.json`, `data/`, el brain calculado desde `cfg.brain` y el puerto `4520`; `PORT` y `AO_BRAIN` legacy siguen aplicando.
- Codex resuelve `office.config.codex.local.json`, `data-codex/`, `brain-codex/` y `4521`; solo consume `CODEX_HOME` cuando está explícito en el entorno y solo para Codex.
- Rutas existentes se canonizan con `realpath` del ancestro existente; rutas no existentes se normalizan sin crear entradas. La prueba de centinelas verifica contenido, inodo, tamaño y `mtime` Claude sin cambios y la ausencia de raíces Codex creadas.
- El test de alias usa enlace simbólico hacia la misma carpeta, no solo dos cadenas lexicalmente equivalentes.
- Sin bloqueo funcional conocido en T1. La verificación ampliada sigue limitada por dependencias de entorno; no se instalaron porque está prohibido.

## Commit

- Mensaje: `feat: resolve isolated office state paths`
- Hash de implementación: `03d8098326a33fec089d84644bce55439391d665`.
- Revisión nativa: pendiente del orquestador.

## Riesgos y seguimiento

- Los flujos runtime que consuman la nueva configuración son trabajo de tareas posteriores; este cambio solo resuelve y valida rutas.
- `npm run check` y `npm run build` requieren dependencias de desarrollo no instaladas (`esbuild` y `playwright-core`).
- `skill_resolution: paths-injected`
