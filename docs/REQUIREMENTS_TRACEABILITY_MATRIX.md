# Matriz de trazabilidad — requisitos, implementación y pruebas

Esta matriz relaciona el alcance del perfil de proyecto con los módulos implementados y las pruebas de la Fase 8. Sirve para demostrar qué requisito se valida, sin afirmar que una prueba manual aún no ejecutada ya está aprobada.

| ID | Requisito del alcance | Implementación principal | Casos de Fase 8 | Tipo de evidencia |
| --- | --- | --- | --- | --- |
| RT-01 | Registro, inicio/cierre de sesión, perfiles y roles. | `auth.js`, `middleware/auth.js`, `ClientArea.jsx`. | F8-AUT-01 a F8-AUT-04. | Respuestas API, JWT, capturas. |
| RT-02 | Recuperación y cambio de contraseña. | `auth.js`, `PasswordRecoveryPage.jsx`. | F8-AUT-05, F8-AUT-06. | Flujo completo, token usado una vez. |
| RT-03 | Administrar servicios, precio, duración y categorías. | `services.js`, `AdminPortal.jsx`. | F8-CAT-01, F8-CAT-02. | Catálogo, BD y API. |
| RT-04 | Registrar y administrar barberos, fotos y servicios asociados. | `barbers.js`, carga de imágenes, `AdminPortal.jsx`. | F8-BAR-01. | Imagen, relaciones y vista pública. |
| RT-05 | Jornadas, descansos, bloqueos y disponibilidad. | `barber_working_hours`, `schedule_blocks`, `appointment-availability.js`. | F8-BAR-02, F8-AGE-01 a F8-AGE-04; `availability.test.js`. | Slots de API y pruebas unitarias. |
| RT-06 | Registrar citas y evitar conflictos. | `appointments.js`, bloqueo por barbero, `availability.js`. | F8-AGE-02, F8-RES-01. | Transacción, respuestas `201/409`, DB. |
| RT-07 | Confirmar, cancelar, reprogramar y estados de citas. | `appointments.js`, `barber-portal.js`. | F8-PAG-03, F8-PAG-04, F8-RES-02 a F8-BAR-05. | Historial, campos de trazabilidad, notificaciones. |
| RT-08 | Historial del cliente y reserva a partir de una atención anterior. | `GET /api/appointments/mine`, `ClientArea.jsx`. | F8-RES-02, recorrido punta a punta. | Historial en UI y API. |
| RT-09 | Pago por QR con revisión administrativa. | `payments.js`, `appointments.js`, `settings.js`. | F8-PAG-01 a F8-PAG-04. | Comprobante, referencia, monto, estado. |
| RT-10 | Reseñas verificadas después de la atención. | `reviews.js`, tabla `reviews`. | F8-REV-01, F8-REV-02. | Restricción de estado y unicidad. |
| RT-11 | Recomendación de horarios con disponibilidad real. | `recommendations.js`, `appointment-availability.js`. | F8-REC-01, F8-REC-02. | Opciones disponibles y explicación. |
| RT-12 | Recomendación/personalización de servicios según historial. | `recommendations.js`. | F8-REC-01, F8-REC-02. | Respuesta con historial o fallback popular. |
| RT-13 | Notificaciones por confirmación, cancelación y cambios. | `notifications.js`, `reminders.js`, `email.js`. | F8-NOT-01, F8-NOT-02. | `notifications`, `reminder_jobs`, correo de prueba. |
| RT-14 | Asistente de reservas con lenguaje natural. | `assistant.js`, `booking-assistant.js`, `BookingPage.jsx`. | F8-ASIS-01, F8-ASIS-02; `booking-assistant.test.js`. | Interpretación y slots reales. |
| RT-15 | Administración de usuarios y permisos. | `admin.js`, `middleware/auth.js`. | F8-AUT-03, F8-BAR-05; `authorization.test.js`. | Respuestas `401/403/404` y token por rol. |
| RT-16 | Indicadores, gráficos, filtros y reportes. | `admin.js`, `AdminPortal.jsx`. | F8-REP-01, F8-REP-02. | Panel, filtros y CSV. |
| RT-17 | Interfaz adaptable y comprensible. | Componentes React y `styles.css`. | Protocolo SUS y tareas de sección 8. | Cuestionarios, observaciones, capturas móvil/escritorio. |
| RT-18 | Tiempo de respuesta y estabilidad de consultas. | API Express, consultas MySQL, configuración de red. | `k6-smoke.js`, sección 9. | Resumen k6 y logs. |

## Cobertura de seguridad por rol

| Riesgo | Prueba asociada | Resultado esperado |
| --- | --- | --- |
| Un usuario no autenticado intenta crear reserva o cargar comprobante. | F8-PAG-01 / F8-PAG-02. | La API rechaza la operación. |
| Cliente intenta leer agenda administrativa. | Matriz de autorización, F8-AUT-03. | No accede a `/api/appointments/admin` ni `/api/admin/*`. |
| Barbero intenta modificar cita no asignada. | F8-BAR-05 y `authorization.test.js`. | No modifica estado ni información. |
| Administrador intenta actuar como cliente en rutas exclusivas. | `authorization.test.js`. | Las rutas `CLIENTE` no aceptan otro rol. |
| Se intenta duplicar correo o reseña. | F8-AUT-02 / F8-REV-02. | Restricción de unicidad y respuesta controlada. |
| Dos solicitudes ocupan el mismo slot. | F8-AGE-02 / `availability.test.js`. | Una sola reserva gana; la otra se rechaza. |

## Evidencias que se deben archivar

1. Salida de `npm test` y `npm run build --workspace frontend`.
2. Exportación JSON/texto de la prueba k6 y su fecha.
3. Capturas de las tareas de cliente, barbero y administrador.
4. CSV generado por el panel con filtros identificables.
5. Hoja de resultados SUS, cálculo y observaciones anonimizadas.
6. Lista de defectos con estado, severidad y corrección verificada.

