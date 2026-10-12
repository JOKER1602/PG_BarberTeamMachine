# Esquema y migraciones

Para crear una base de datos nueva, ejecutar solamente estos archivos y en este orden:

1. `001_initial_schema.sql`
2. `002_barber_role.sql`
3. `007_service_categories.sql`

El archivo inicial contiene el modelo vigente de citas, pagos por QR, reseñas, configuraciones y recordatorios. Las migraciones `003` a `009` se mantienen como historial para instalaciones creadas en versiones anteriores; no deben volver a ejecutarse sobre una base creada con el esquema inicial actual.

Antes de aplicar una migración a una base ya existente, verificar qué cambios ya fueron aplicados. Así se evita intentar crear columnas o tablas duplicadas.
