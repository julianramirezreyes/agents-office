# Migrar `agents-office` a un fork personal

Preparar la migración de `ajsahni/agents-office` al fork público `julianramirezreyes/agents-office`, integrando primero el estado más reciente observado del upstream y las ramas locales en el orden solicitado. Conservar el vínculo `upstream` para futuras sincronizaciones. FM-01 verificó las refs con fetch anónimo y FM-04 creó/verificó el fork y configuró los remotos. Todavía no se han fusionado ni publicado ramas.

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
| Worktree de esta rama al inicio de FM-01 | `feat/dual-offices` en `e9da6f958cb72ebc93f00cdb0e7b7d7b347b833d`; conserva la base funcional conocida `d7ad60b` y añade solo commits documentales del plan. |
| `main` local / caché | `main` en `51f9973f411f50c36ab94a01300c6239e8dd49cc`; `origin/main` cacheado en `2d4700189ee0900060a97ff3ab79f9eb0386ca23`. |
| Remotos al inicio de FM-01 | `origin` apuntaba a `https://github.com/ajsahni/agents-office.git`; `upstream` se agregó entonces con esa URL pública. La configuración actual, posterior a FM-04, está en “Evidencia FM-04”. |

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

- [x] **FM-01 — Obtener y comparar el upstream**. Verificar el estado de ambos worktrees y cambios locales; agregar/verificar `upstream` sin alterar el destino de `origin`, hacer un fetch anónimo de todas las heads/tags y registrar puntas, divergencias y merge-bases. Evidencia exacta en “Evidencia FM-01”.
- [ ] **FM-02 — Integrar upstream en una worktree limpia de migración**. Incorporar primero la punta upstream verificada en una rama temporal aislada, sin sobrescribir los cambios sucios de `feat/live-translation`. Registrar los commits y revisar conflictos; no trasladar la punta a la rama nombrada hasta resolver cómo preservar el checkout original.
- [ ] **FM-03 — Fusionar las ramas propias en el orden solicitado**. Fusionar `feat/dual-offices` en `feat/live-translation` y, después de verificar el resultado, fusionar `feat/live-translation` en `main`. Mantener los worktrees y el checkout fuente en estados identificables; no hacer reset para forzar una fusión.
- [x] **FM-04 — Crear y configurar el fork personal**. Fork público creado y verificado para `julianramirezreyes/agents-office`; `origin` apunta al fork, `upstream` al repo original y el push a upstream está deshabilitado. Evidencia en “Evidencia FM-04”. No se han publicado ramas.
- [ ] **FM-05 — Publicar las ramas propias y comprobar sincronización futura**. Publicar únicamente las ramas aprobadas al fork personal; comprobar que las ramas remotas tienen las puntas esperadas y documentar el flujo futuro: fetch de `upstream`, comparación/revisión y fusión explícita de actualizaciones. No afirmar que ese flujo fue probado hasta observarlo.

## Criterios de aceptación

- [ ] No se pierde ni modifica silenciosamente ningún cambio local preexistente; cualquier bloqueo por archivos sucios queda registrado y se detiene sin limpieza destructiva.
- [x] Se consultó upstream antes de crear el fork; el fetch observó dos commits upstream no contenidos en `main` local. No hay commits upstream nuevos respecto de `origin/main` cacheado.
- [ ] Se integran los cambios remotos solo desde las referencias verificadas.
- [ ] Las fusiones se completan en este orden: upstream a `feat/live-translation`, `feat/dual-offices` a `feat/live-translation`, y `feat/live-translation` a `main`.
- [x] `origin` apunta al fork personal y `upstream` al repo original; el fork es público y conserva su relación upstream.
- [ ] Solo ramas propias se publican al fork; no hay PR ni push al upstream original.
- [ ] Las puntas finales, commits de fusión y cualquier conflicto/resolución están anotados y verificables.
- [ ] El flujo futuro para traer upstream está explicado y evita mezclarlo automáticamente o sobrescribir trabajo local.

## Verificación aplicable

Ejecutar y registrar la salida observada en cada paso; las comprobaciones locales no sustituyen evidencia remota:

```bash
git status --short --branch
git worktree list --porcelain
git remote -v
# Ejecutar solo con configuración aislada, sin credenciales/helpers/askpass/headers:
env -i PATH=/usr/bin:/bin HOME=/nonexistent LC_ALL=C \
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 \
  GIT_ASKPASS=/bin/false SSH_ASKPASS=/bin/false GIT_OPTIONAL_LOCKS=0 \
  GCM_INTERACTIVE=Never git -c credential.helper= -c core.askPass=/bin/false \
  -c http.extraHeader= -c http.https://github.com/.extraHeader= fetch upstream \
  'refs/heads/*:refs/remotes/upstream/*' 'refs/tags/*:refs/tags/*'
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

- **Estado:** FM-01 y FM-04 completas; FM-02, FM-03 y FM-05 pendientes. No se han fusionado ni publicado ramas.
- **Documento local:** `odd/tasks/fork-migration.md`.
- **Comprobaciones de preparación:** ambas worktrees identificadas; estado fuente y objetivo se capturó antes y después del fetch (`GIT_OPTIONAL_LOCKS=0`). El checkout fuente se mantuvo en `feat/live-translation` (`10da3d7d99b7659dc0539b5898ba20633eb2582a`) con `.gitignore`, `dist/command-centre-v2.html`, `package-lock.json`, `src/braingraph.js` modificados y `.codegraph/`, `AGENTS.md` no rastreados. El worktree de tarea se mantuvo en `feat/dual-offices` (`e9da6f958cb72ebc93f00cdb0e7b7d7b347b833d`) con `.codegraph/` no rastreado.

## Evidencia FM-01

- **Autorización aplicada:** una sola lectura/fetch anónimo al upstream público `https://github.com/ajsahni/agents-office.git`; no se usó `gh`, cuenta GitHub, proveedor ni credencial. Antes del fetch, la configuración local no tenía claves `http.*.extraheader`, `credential.*` ni `url.*.insteadOf`. No se imprimieron valores de credenciales.
- **Aislamiento del fetch:** `env -i`, HOME inexistente, configuración system/global deshabilitada, prompts/askpass/helpers y `http.extraHeader` deshabilitados. Se solicitaron todas las refs `refs/heads/*` y `refs/tags/*`. Exit 0, sin retry. Se recibió solo la head pública `main`; se actualizaron 18 tags. `origin` no se alteró.
- **Puntas observadas:** local `main` `51f9973f411f50c36ab94a01300c6239e8dd49cc`; `feat/live-translation` `10da3d7d99b7659dc0539b5898ba20633eb2582a`; `feat/dual-offices` `e9da6f958cb72ebc93f00cdb0e7b7d7b347b833d`; `origin/main` cacheado `2d4700189ee0900060a97ff3ab79f9eb0386ca23`; `upstream/main` recién obtenido `2d4700189ee0900060a97ff3ab79f9eb0386ca23`.
- **Divergencia** (`upstream/main...<ref>`; primero commits solo upstream, luego solo en rama local): `main` `2 / 0`; `feat/live-translation` `2 / 14`; `feat/dual-offices` `2 / 69`. Merge-base de upstream/main con las tres refs: `51f9973f411f50c36ab94a01300c6239e8dd49cc`.
- **Upstream contra caché:** `origin/main...upstream/main` `0 / 0`; son la misma punta. No aparecieron commits nuevos desde `origin/main` cacheado. Los dos commits de upstream que faltan a `main` local son `a915a509df633f066e953ac7f73d867929de746a` (“Add view-image-mcp: fetch any public image URL as base64 vision block”) y `2d4700189ee0900060a97ff3ab79f9eb0386ca23` (“Merge pull request #9 from T3g-ceo/claude/nifty-mcclintock-18fbb3”).
- **Efecto local:** status del checkout fuente idéntico antes/después; los archivos sucios no fueron editados. Solo se añadió el remoto local `upstream`; `origin` permanece igual. No hubo merge/rebase/reset/stash/checkout ni publicación.
- **Resultado:** FM-01 completa; FM-02 no iniciada. Dado que el checkout fuente continúa sucio, antes de integrar upstream hay que diseñar una protección no destructiva que mantenga esos cambios de usuario intactos; detenerse si eso requiere mover/guardar/commitear cambios o si no puede garantizarse.
- **TDD/verificación del producto:** pendiente para la ejecución de integración; modo estricto del proyecto indicado como habilitado, runner `node --test test/*.test.mjs`.
- **Commit de introducción del documento:** `3bd37ada89eed0b5aad3604ddc3d00e6df4b5ba3` (`docs: plan personal fork migration`).

## Evidencia FM-04

- **Fork:** `https://github.com/julianramirezreyes/agents-office`, creado con `gh repo fork`; cuenta verificada `julianramirezreyes`.
- **Verificación REST:** `fork=true`, `parent=ajsahni/agents-office`, `private=false`, rama predeterminada `main`.
- **Remotos locales:** `origin` tiene fetch y push hacia el fork personal; `upstream` tiene fetch hacia `https://github.com/ajsahni/agents-office.git` y push deshabilitado (`NO_PUSH_TO_UPSTREAM`). `remote.pushDefault=origin`.
- **Límites:** no se hizo push de ramas, PR ni merge. El checkout fuente de `feat/live-translation` conserva sin cambio sus archivos sucios previos.

## Siguiente paso y bloqueo

FM-02/FM-03 siguen pendientes porque el checkout `feat/live-translation` está sucio en `.gitignore`, `dist/command-centre-v2.html` y `package-lock.json`, los mismos archivos que cambia `feat/dual-offices`. No integrar directamente en ese worktree ni limpiar sus cambios. La vía recomendada es preparar una worktree limpia sobre una rama temporal y aplicar allí, en orden, `upstream/main` y luego `feat/dual-offices`. Se necesita resolver cómo entregar luego esa punta a la rama nombrada `feat/live-translation` sin perder ni reubicar cambios de usuario sin autorización. FM-05 queda pendiente hasta que las ramas estén integradas; aún no se ha publicado ninguna.

El upstream verificado coincide con `origin/main` cacheado, pero `main` local está dos commits detrás.
