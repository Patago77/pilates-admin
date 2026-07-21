---
allowed-tools: Read, Edit, Bash(git diff *)
description: Corrige hallazgos de aislamiento multi-tenant
argument-hint: [número de hallazgo o "todos"]
---

Corregí el/los hallazgo(s) $ARGUMENTS del último /review-tenant.
Para cada uno:
1. Aplicá el fix mínimo necesario (no refactors de más)
2. Mantené el patrón existente: req.db viene del middleware, nunca de
   parámetros del cliente
3. Mostrame el diff antes de confirmar que terminaste
