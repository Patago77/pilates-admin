---
allowed-tools: Read, Grep, Glob, Bash(git diff *)
description: Audita aislamiento multi-tenant en pilates-admin
---

## Archivos modificados
!`git diff --name-only HEAD~1`

## Cambios completos
!`git diff HEAD~1`

## Checklist de aislamiento multi-tenant

Revisá TODO archivo que toque la base de datos buscando:

1. **Queries sin pool de tenant**: cualquier query mysql2 que NO use
   `req.db` (el pool obtenido vía middleware de studio). Si encontrás
   una conexión directa a una DB global o hardcodeada, es CRÍTICO.

2. **Middleware salteado**: rutas/handlers nuevos que acceden a datos pero
   no pasan por el middleware que setea `req.db`. Verificá que esté en la
   cadena de middlewares de cada endpoint nuevo.

3. **IDs cruzados**: cualquier lugar donde un `studio_id`, `tenant_id` o
   similar venga del body/query del request en vez de derivarse del JWT/sesión
   autenticada. Esto es la vulnerabilidad más común: confiar en un ID que
   manda el cliente.

4. **Joins o subqueries**: si hay queries con JOIN a tablas que podrían
   pertenecer a otro tenant, confirmá que el filtro de aislamiento esté en
   TODAS las tablas del join, no solo la principal.

5. **Caché o estado compartido**: variables globales, caches en memoria,
   o cualquier estructura que no esté namespaced por studio y pueda
   filtrar datos entre tenants.

## Output

Para cada hallazgo: archivo, línea, severidad (CRÍTICO/ALTO/MEDIO), y el
fix concreto. Si no hay nada, decilo explícitamente — no inventes hallazgos.
No toques el código todavía, solo reportá.
