# Empyrean Studio

## Arquitectura inicial

- `frontend/`: interfaz React, rutas publicas, cliente y panel administrativo.
- `backend/`: API REST con Express, autenticacion, reglas de negocio y acceso a MySQL.
- `database/`: scripts versionados de esquema, semillas y migraciones.
- `docs/`: decisiones tecnicas, alcance y documentacion del proyecto.

## Principios

1. La API valida todas las reglas de negocio en el servidor.
2. La disponibilidad se calcula con horario laboral, bloqueos, duracion y reservas existentes.
3. Las recomendaciones nunca pueden omitir la validacion normal de disponibilidad.
4. El asistente interpreta solicitudes, pero no confirma reservas fuera del flujo normal.
5. La primera version atiende una sola barberia.

## Fases 1 a 8 implementadas

- Autenticación con JWT, contraseñas cifradas y roles `CLIENTE`/`ADMINISTRADOR`.
- Gestión administrativa de usuarios, servicios, barberos y la relación barbero-servicio.
- Horarios laborales, bloqueos de agenda y cálculo de disponibilidad en zona horaria `America/La_Paz`.
- Reservas, cancelación, reprogramación, historial, reserva nuevamente y estados administrativos.
- La API guarda fechas en UTC y presenta/valida la agenda con horario de Cochabamba (UTC−4).

## Fase 4: operación, cobros y calidad

- Pago manual por QR: el cliente ve el monto exacto, sube un comprobante y la reserva queda en estado `PENDING` (pendiente de revisión de pago).
- Administración revisa un único comprobante por reserva, incluso si contiene varios servicios; al aprobarlo, todos sus servicios quedan confirmados y se programan los recordatorios.
- Los barberos trabajan únicamente con citas `CONFIRMED`; no pueden marcar una cita pendiente de pago como atendida, cancelada o inasistente.
- Reseñas verificadas: solo se habilitan para el cliente después de una cita `COMPLETED`, una reseña por cita.
- Recordatorios en aplicación y por correo, con reintentos y registro de fallos. El canal de correo se activa al configurar SMTP.
- Limpieza del flujo de reservas: existe una sola ruta de creación (`POST /api/appointments/multi`) y una sola experiencia de reserva con pago, para evitar reservas sin comprobante.

## Fase 5: recomendación inteligente y personalización

- El cliente autenticado recibe servicios sugeridos desde sus citas atendidas; si todavía no tiene historial, se muestran los servicios más reservados.
- Para los servicios ya elegidos se generan horarios sugeridos únicamente desde disponibilidad real: jornada laboral, bloqueos, duración total y citas activas.
- Las alternativas se ordenan por preferencias observables del cliente (profesional, día y franja horaria frecuentes) y explican por qué se proponen.
- La recomendación es determinista y auditable. No crea ni confirma citas: el cliente debe seleccionar el horario y el flujo normal vuelve a validarlo antes de reservar.

## Fase 6: asistente inteligente de reservas

- En `/reservar` el cliente puede consultar en lenguaje natural, por ejemplo: “Quiero un corte mañana con Andy después de las 4”.
- El asistente identifica de forma determinista el servicio, profesional, fecha y hora cuando están presentes en la consulta.
- Las alternativas se calculan exclusivamente con disponibilidad real; no se generan citas ni se apartan horarios desde el asistente.
- Al elegir una alternativa se abre el flujo normal con el servicio, profesional, fecha y horario precargados. El pago, la validación y la confirmación continúan siendo obligatorios.

## Fase 7: analítica, visualización y reportes

- El panel administrativo incorpora filtros combinables por período, servicio y profesional. Los mismos filtros se aplican a indicadores, gráficos, agenda y exportación.
- Se visualizan citas registradas, atendidas, canceladas, inasistencias, ingresos confirmados, ingresos atendidos, tiempo ocupado y clientes recurrentes.
- El administrador puede analizar servicios más solicitados, horas de mayor demanda, evolución diaria de reservas, carga por profesional y clientes recurrentes.
- El reporte CSV incluye los filtros aplicados, el resumen de indicadores y el detalle de las citas para apoyar decisiones y conservar evidencia del período analizado.

## Fase 8: pruebas y evaluación

- El plan de pruebas reúne casos funcionales, de integración, autorización, usabilidad SUS y rendimiento para los tres roles del sistema.
- La matriz de trazabilidad relaciona el alcance académico con los módulos y evidencias de validación.
- La regresión automatizada protege disponibilidad, autorización, analítica, comprensión del asistente, sesión del cliente y rutas HTTP básicas; la compilación del cliente se valida antes de cada versión candidata.
- Se incorpora un smoke test opcional con k6 para consultas públicas de solo lectura, con umbrales de errores y tiempo de respuesta documentados.
- Los criterios de salida, severidades y evidencia requerida están definidos en `docs/PHASE_8_TEST_PLAN.md`.
- La evidencia de la última regresión automatizada se conserva en `docs/PHASE_8_AUTOMATED_EVIDENCE.md`.

## Ejecución local

1. Copiar `backend/.env.example` como `backend/.env` y definir una clave JWT segura.
2. Para una instalación nueva, ejecutar en orden `database/001_initial_schema.sql`, `database/002_barber_role.sql` y `database/007_service_categories.sql` en MySQL. Las demás migraciones ya están incorporadas en el esquema inicial y se conservan únicamente para actualizar instalaciones antiguas.
3. Ejecutar `npm run dev` desde la raíz.

Las pruebas unitarias se ejecutan con `npm test` y la compilación de producción del cliente con `npm run build --workspace frontend`.
