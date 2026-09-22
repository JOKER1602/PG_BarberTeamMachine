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

## Fases 1 a 3 implementadas

- Autenticación con JWT, contraseñas cifradas y roles `CLIENTE`/`ADMINISTRADOR`.
- Gestión administrativa de usuarios, servicios, barberos y la relación barbero-servicio.
- Horarios laborales, bloqueos de agenda y cálculo de disponibilidad en zona horaria `America/La_Paz`.
- Reservas, cancelación, reprogramación, historial, reserva nuevamente y estados administrativos.
- La API guarda fechas en UTC y presenta/valida la agenda con horario de Cochabamba (UTC−4).

## Ejecución local

1. Copiar `backend/.env.example` como `backend/.env` y definir una clave JWT segura.
2. Ejecutar `database/001_initial_schema.sql` en MySQL.
3. Ejecutar `npm run dev` desde la raíz.

Las pruebas unitarias se ejecutan con `npm test` y la compilación de producción del cliente con `npm run build --workspace frontend`.
