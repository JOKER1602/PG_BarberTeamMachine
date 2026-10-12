# Barber Team Machine

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

## Fases 1 a 4 implementadas

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

## Ejecución local

1. Copiar `backend/.env.example` como `backend/.env` y definir una clave JWT segura.
2. Para una instalación nueva, ejecutar en orden `database/001_initial_schema.sql`, `database/002_barber_role.sql` y `database/007_service_categories.sql` en MySQL. Las demás migraciones ya están incorporadas en el esquema inicial y se conservan únicamente para actualizar instalaciones antiguas.
3. Ejecutar `npm run dev` desde la raíz.

Las pruebas unitarias se ejecutan con `npm test` y la compilación de producción del cliente con `npm run build --workspace frontend`.
