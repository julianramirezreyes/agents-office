# Migrar `agents-office` a un fork personal

Preparar la migración de `ajsahni/agents-office` al fork público `julianramirezreyes/agents-office`, integrando primero el estado más reciente observado del upstream y las ramas locales en el orden solicitado. Conservar el vínculo `upstream` para futuras sincronizaciones. No se ha hecho `fetch`, `merge`, cambio de remoto ni publicación en esta tarea; no afirmar que hay actualizaciones nuevas hasta verificarlas.

## Objetivo y problema

Trasladar el trabajo propio al fork personal sin perder la base upstream ni publicar al repositorio original. El clon fuente tiene cambios locales no confirmados que deben protegerse antes de cualquier integración o checkout; hay que evitar que una actualización o resolución de conflictos los sobrescriba.

## Alcance autorizado y restricciones

- Upstream original: `https://github.com/ajsahni/agents-office.git`.
- Fork público autorizado: `julianramirezreyes/agents-office`; cuenta verificada por el orquestador.
- Se autoriza fetch anónimo del upstream, crear/verificar el fork, configurar los remotos, integrar las ramas y publicar ramas propias al fork.
- No crear PR ni hacer push al repositorio original.
- No hacer reset, checkout destructivo, limpieza, stash ni commit de los cambios locales sin una decisión separada. Si impiden una operación segura, parar y pedir resolución; nunca descartarlos.
- No interpretar `origin/main` en caché como evidencia de la punta actual del upstream ni anunciar cambios nuevos antes del fetch.

## Estado inicial conocido

| Referencia | Estado conocido |
|---|---|
| Checkout fuente `/home/julian/proyectos/agents-office` | `feat/live-translation` en `10da3d7`; sucio en `.gitignore`, `dist/command-centre-v2.html`, `package-lock.json`, `src/braingraph.js`; no rastreados `.codegraph/` y `AGENTS.md`. Preservarlos íntegros. |
| Worktree de esta rama | `feat/dual-offices` en `d7ad60b`, creada exactamente desde `feat/live-translation`. |
| `main` local | `51f9973`. La referencia cacheada `origin/main` figura dos commits adelante, pero no se ha actualizado por fetch; no confirma el estado remoto actual. |
| Remoto actual | `origin` apunta a `https://github.com/ajsahni/agents-office.git`. |

Estos datos son el punto de partida reportado, no sustituyen una nueva lectura del estado antes de actuar.

## Restricciones y decisiones

| Área | Decisión |
|---|---|
| Orden de integración | Consultar el upstream primero; luego incorporar `feat/dual-offices` en `feat/live-translation` y después `feat/live-translation` en `main`. |
| Protección de datos | No sobrescribir ni mover los cambios sucios del checkout fuente; si hay riesgo de mezcla, detener el paso y conservar todas las referencias y archivos. |
| Remotos | Al terminar, `origin` será el fork personal y `upstream` el repo original para recibir actualizaciones. |
| Publicación | Solo publicar ramas propias al fork; no publicar al original ni abrir PR. |
| Evidencia | Las puntas, divergencias y conflictos se basan en refs recién obtenidas y verificadas; una referencia remota antigua no basta. |

## Tareas estables

- [ ] **FM-01 — Obtener y comparar el upstream**. Verificar el estado de los worktrees y cambios locales; agregar/verificar `upstream` sin alterar el destino de `origin`, hacer fetch anónimo del upstream y registrar las puntas/merge-bases de `main` y `feat/live-translation`. No concluir que existen novedades hasta observar el fetch. Si el checkout sucio vuelve inseguro el siguiente paso, parar sin tocar esos archivos.
- [ ] **FM-02 — Integrar upstream en `feat/live-translation`**. Incorporar la punta upstream verificada antes de crear el fork, con una operación no destructiva y sin sobrescribir cambios sucios. Revisar conflictos y conservar los cambios locales; detenerse para decisión si no se puede demostrar una resolución segura. Registrar los commits resultantes.
- [ ] **FM-03 — Fusionar las ramas propias en el orden solicitado**. Fusionar `feat/dual-offices` en `feat/live-translation` y, después de verificar el resultado, fusionar `feat/live-translation` en `main`. Mantener los worktrees y el checkout fuente en estados identificables; no hacer reset para forzar una fusión.
- [ ] **FM-04 — Crear y configurar el fork personal**. Crear o verificar el fork público autorizado `julianramirezreyes/agents-office`; configurar `origin` hacia el fork y `upstream` hacia `ajsahni/agents-office`. Confirmar URLs y relación de fork antes de publicar. No hacer PR ni push al upstream.
- [ ] **FM-05 — Publicar las ramas propias y comprobar sincronización futura**. Publicar únicamente las ramas aprobadas al fork personal; comprobar que las ramas remotas tienen las puntas esperadas y documentar el flujo futuro: fetch de `upstream`, comparación/revisión y fusión explícita de actualizaciones. No afirmar que ese flujo fue probado hasta observarlo.

## Criterios de aceptación

- [ ] No se pierde ni modifica silenciosamente ningún cambio local preexistente; cualquier bloqueo por archivos sucios queda registrado y se detiene sin limpieza destructiva.
- [ ] Se consulta upstream antes de crear el fork, y los cambios remotos incluidos se basan en referencias obtenidas por fetch durante la ejecución.
- [ ] Las fusiones se completan en este orden: upstream a `feat/live-translation`, `feat/dual-offices` a `feat/live-translation`, y `feat/live-translation` a `main`.
- [ ] `origin` apunta al fork personal y `upstream` al repo original; el fork es público y conserva su relación upstream.
- [ ] Solo ramas propias se publican al fork; no hay PR ni push al upstream original.
- [ ] Las puntas finales, commits de fusión y cualquier conflicto/resolución están anotados y verificables.
- [ ] El flujo futuro para traer upstream está explicado y evita mezclarlo automáticamente o sobrescribir trabajo local.

## Verificación aplicable

Ejecutar y registrar la salida observada en cada paso; las comprobaciones locales no sustituyen evidencia remota:

```bash
git status --short --branch
git worktree list --porcelain
git remote -v
git fetch upstream
git log --graph --oneline --decorate --left-right main...upstream/main
git merge-base main upstream/main
git diff --check
node --test test/*.test.mjs
npm run check
```

Repetir `git status --short --branch`, `git log --graph --oneline --decorate --all -n 30` y `git remote -v` tras las fusiones/configuración/publicación, según proceda. Ejecutar pruebas y `npm run check` cuando las fusiones hayan terminado y antes de declarar integración correcta; registrar fallo, omisión o bloqueo literalmente. No ejecutar una prueba en el checkout fuente si su efecto puede mutarlo o poner en riesgo los cambios locales.

## Ruta y delegación

Ruta ODD: **delegated direct** para la migración operativa, por requerir varias operaciones Git/host dependientes, proteger dos worktrees y reconciliar referencias remotas antes de fusionar. Esta sub-tarea solo prepara este documento en un worktree aislado; no realiza operaciones remotas ni modifica código. Las instrucciones no autorizan subdelegación adicional.

## Progreso y evidencia

- **Estado:** plan registrado; ninguna fusión, fetch, configuración remota, fork ni publicación realizada como parte de este documento.
- **Documento local:** `odd/tasks/fork-migration.md`.
- **Comprobaciones de preparación:** estado leído en el worktree `/home/julian/proyectos/agents-office-worktrees/dual-offices`; está en `feat/dual-offices` (`d7ad60b`) y su único elemento no rastreado observado fue `.codegraph/`.
- **TDD/verificación del producto:** pendiente para la ejecución de integración; modo estricto del proyecto indicado como habilitado, runner `node --test test/*.test.mjs`.
- **Commit de introducción del documento:** `3bd37ada89eed0b5aad3604ddc3d00e6df4b5ba3` (`docs: plan personal fork migration`).

## Siguiente paso

Comenzar FM-01 desde un estado nuevamente verificado. El checkout fuente sigue teniendo cambios de usuario sin confirmar; preservar esos archivos exactamente y solicitar una decisión si bloquean una operación segura. No anunciar actualizaciones del upstream hasta completar el fetch y comparar sus referencias.
