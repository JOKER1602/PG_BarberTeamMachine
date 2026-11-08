# Esquema y migraciones

Para crear una base de datos nueva (producción SaaS), ejecutar solamente estos archivos y en este orden:

1. `001_initial_schema.sql`
2. `002_barber_role.sql`
3. `007_service_categories.sql`
4. `013_saas_foundation.sql`
5. `014_tenant_isolation.sql`
6. `015_tenant_branding.sql`
7. `016_relative_upload_urls.sql`

`npm run verify:fresh-install` aplica esta secuencia en una base temporal y recorre la puesta en marcha completa. Ver también `docs/PRODUCTION_LAUNCH.md`.

`016_relative_upload_urls.sql` convierte las direcciones de archivos guardadas con dominio (`http://host/uploads/...`) en rutas relativas; es idempotente y conviene aplicarla también al migrar una base existente.

El archivo inicial contiene el modelo vigente de citas, pagos por QR, reseñas, configuraciones y recordatorios. Las migraciones `003` a `009` se mantienen como historial para instalaciones creadas en versiones anteriores; no deben volver a ejecutarse sobre una base creada con el esquema inicial actual.

Antes de aplicar una migración a una base ya existente, verificar qué cambios ya fueron aplicados. Así se evita intentar crear columnas o tablas duplicadas.

Para activar el consentimiento de recordatorios por WhatsApp en una instalación existente, ejecutar una sola vez `010_whatsapp_reminder_consent.sql`. Las instalaciones nuevas ya incluyen el campo en el esquema inicial.

Para proteger los comprobantes de pago de instalaciones existentes, ejecutar una sola vez `012_secure_payment_proofs.sql`. Las reservas nuevas usarán comprobantes privados; los comprobantes históricos conservan la ruta registrada previamente.

Para actualizar una instalación existente con el cambio de marca, ejecutar `008_rename_empyrean_studio.sql` después de las migraciones previas. La migración solo cambia el nombre anterior `Barber Team Machine`, por lo que no reemplaza una personalización distinta.

El paso a SaaS multiempresa se divide en dos migraciones:

- `013_saas_foundation.sql` (Incremento 1): crea `tenants`, `tenant_memberships`, `platform_administrators` y `tenant_settings`, el tenant inicial `empyrean-studio` y las membresías de administradores (`OWNER`) y barberos (`BARBER`). **Solo agrega tablas**: la API actual no las lee y sigue funcionando igual. Es idempotente; puede ejecutarse más de una vez.
- `014_tenant_isolation.sql` (Incremento 2): agrega `tenant_id` obligatorio a los datos operativos (incluidas las categorías de servicio), vuelve a copiar la configuración y las membresías vigentes, y crea índices únicos por tenant. **No ejecutar todavía**: después de aplicarla, la API actual ya no puede crear servicios, barberos, citas, comprobantes, notificaciones ni recordatorios. Se aplica junto con el código del Incremento 2, después de respaldar MySQL y `backend/uploads` y de ensayarla sobre una copia. **No es atómica** (MySQL confirma cada `ALTER`): ante un fallo, restaurar el respaldo.

- `015_tenant_branding.sql`: logo y portada por barbería (`tenant_settings.logo_url`, `cover_url`) con las imágenes actuales de Empyrean. Solo agrega columnas; requiere 013. Aplicada en la base copia `barber_team_machine_saas`.

013 y 014 se verificaron sobre una base temporal con el esquema actual: 013 aplicada dos veces sin error, 014 deja `tenant_id NOT NULL` en todas las tablas operativas, sin filas huérfanas.
