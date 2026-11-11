# Evidencia automatizada — Fase 8

**Fecha:** 13 de octubre de 2026  
**Ambiente:** desarrollo local Windows, Node.js y Vite.  
**Alcance:** regresión automatizada y compilación de producción. No se utilizaron credenciales ni datos personales.

## Resultado

| Verificación | Resultado | Detalle |
| --- | --- | --- |
| `npm test` — backend | Aprobado | 19 pruebas aprobadas, 0 fallos. Incluye disponibilidad, límites de agenda, autorización/JWT, dashboard, asistente y smoke HTTP de la API. |
| `npm test` — frontend | Aprobado | 6 pruebas aprobadas. Incluye almacenamiento de sesión, cabeceras de autenticación, disponibilidad, errores y expiración de sesión. |
| `npm run build --workspace frontend` | Aprobado | Compilación Vite de producción completada sin errores. |
| `git diff --check` | Aprobado | Sin errores de espacios o marcadores de conflicto en los cambios revisados. |
| k6 | Pendiente de ejecución local | El script está listo en `tests/performance/k6-smoke.js`, pero la herramienta k6 no está instalada en este ambiente. |

## Interpretación

La versión candidata supera la regresión automática disponible y compila correctamente. Antes de una entrega académica o producción faltan las evidencias manuales que requieren MySQL, una sesión real de navegador, carga de archivos, correo SMTP y participantes para la encuesta SUS. Esas pruebas están enumeradas en `PHASE_8_TEST_PLAN.md` y se registran en `TEST_EXECUTION_RECORD.md`.

## Próximo comando de rendimiento

Con la API y una base de datos de prueba activas:

```powershell
k6 run -e BASE_URL=http://localhost:3002 -e VUS=3 -e ITERATIONS=5 tests/performance/k6-smoke.js
```
