# Consolidación del espacio de trabajo

## Resultado buscado

Dejar un único worktree Git en `/home/julian/proyectos/agents-office`, sobre `main`, sin perder el estado local de las oficinas Claude y Codex. Las ramas de funcionalidad ya son ancestros de `main`; no se vuelve a integrar código de producto.

## Alcance y límites

- Conservar sin sobrescribir la configuración y los datos ignorados del checkout principal, `AGENTS.md`, `.atl/`, `.codegraph/` y cualquier otro contenido local.
- Trasladar desde `dual-offices` únicamente la configuración local de Codex, su archivo de tareas, su archivo de agentes y nueve artefactos SDD ignorados. Verificar cada copia por hash antes de retirar el original.
- Eliminar en los worktrees secundarios solo las copias ya verificadas y las cachés regenerables autorizadas. Usar `git worktree remove` sin `--force`; detenerse ante archivos nuevos o una negativa de Git.
- Cambiar el checkout principal a `main` sin limpiar ni descartar sus archivos locales; integrar la rama operativa localmente. No ejecutar proveedores, operaciones remotas, `git clean`, `reset`, `stash`, push ni PR. No detener el proceso `node serve.mjs` existente.
- No modificar código de producto ni scripts de `package.json`.

## Plan y evidencia

- [ ] **WC-01 — Consolidar estado local y worktrees.** Confirmar ramas, ancestros, estados y manifiestos; crear la rama operativa desde `main`; copiar con destino exclusivo y verificar hashes; retirar solo originales verificados y cachés autorizadas; eliminar ambos worktrees secundarios sin forzar; integrar el registro operativo en `main`.
  - Ruta: delegada, por múltiples ubicaciones y operaciones con riesgo de pérdida de datos.
  - Evidencia inicial: `feat/dual-offices` y `feat/live-translation` son ancestros de `main`; los tres worktrees y sus estados se inspeccionaron antes de modificar archivos.
  - Criterios de aceptación: un solo worktree en el checkout principal sobre `main`; archivos preservados con hashes idénticos; ramas de funcionalidad ancestrales; ningún archivo local ajeno sobrescrito; commit convencional de este registro.
  - Verificación: `git diff --check`, `npm run check` sin proveedor y aislado de CLI; `git worktree list --porcelain`; `git status --porcelain=v1 -uall`; hashes y comprobación de la expresión `createLauncher` existente. Registrar aquí los resultados exactos, incluidos fallos u omisiones.
  - Límite de reversión: el commit solo agrega este registro; los datos locales preservados son ignorados y no forman parte del commit.

## Configuración de trabajo

- TDD estricto: habilitado por las instrucciones del proyecto. No hay cambio de comportamiento que permita un ciclo RED → GREEN → REFACTOR; la comprobación funcional aplicable es `npm run check`.
- Estrategia de entrega: `ask-on-risk`; pronóstico de cambios escritos menor a 400 líneas. Sin entrega remota solicitada.
- Estado del espejo Engram: creado bajo `odd/workspace-consolidation/tasks`; requiere sincronización al cerrar la tarea.

## Resultados observados en la rama operativa

- Los tres worktrees se inspeccionaron antes del traslado. `feat/dual-offices` y `feat/live-translation` son ancestros de `main`; por ello no se repitió ninguna integración de producto.
- Se copiaron con creación exclusiva y se compararon por SHA-256 los 12 archivos únicos: configuración, tareas y agentes de Codex, y nueve artefactos SDD ignorados. No hubo colisiones ni sobrescrituras. Solo después se retiraron esos originales y las cachés secundarias `.codegraph/`, `node_modules/`, `dist/app.js` y `dist/dev.html`.
- `git worktree remove` terminó sin `--force` para `dual-offices` y `main-migration`. El documento ODD se transfirió al checkout principal con comparación SHA-256 antes de retirar su original. En `main-migration` no existían cachés ignoradas ni los dos archivos de compilación desechables.
- El cambio de rama del checkout principal preservó por hash siete archivos protegidos de la oficina Claude y mantuvo `.codegraph/` y sus archivos no rastreados. El contenido de Codex permanece separado en sus rutas locales.
- En la rama operativa, `npm run check` con `PATH` limitado, `HOME` y configuraciones de CLI temporales, y sin claves de proveedor terminó con código 0: compilación, navegador y HTTP aprobados; 139 pruebas aprobadas, 0 fallidas; llamadas a proveedor, uso y MCP: 0/0/0. `git diff --check` terminó con código 0.
- `launcher.mjs` sigue exportando `createLauncher` como función. El script `start` sigue siendo `node serve.mjs`; esta operación no cambió el comando de inicio ni ejecutó el launcher.
- Pendiente para el cierre: commit convencional de este registro, integración local explícita en `main` y repetición de las comprobaciones en el resultado final.

## Siguiente paso

Integrar la rama operativa en `main`, repetir las comprobaciones y registrar el resultado final.
