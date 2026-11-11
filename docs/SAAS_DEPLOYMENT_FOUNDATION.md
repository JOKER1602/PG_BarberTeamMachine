# Base de despliegue SaaS

Esta etapa prepara una primera publicación segura. El proyecto actual sigue siendo de **una sola barbería**: `business_settings` y la mayoría de entidades no tienen `tenant_id`. Un dominio y HTTPS no lo convierten por sí mismos en SaaS multiempresa.

## Arquitectura recomendada para el primer SaaS

```text
clientes -> https://app.tudominio.com -> frontend React
                                      -> API Node /api
                                      -> MySQL privado
                                      -> almacenamiento privado de fotos y comprobantes
                                      -> correo y WhatsApp
```

Para iniciar, usar un único dominio de aplicación (`app.tudominio.com`) y rutas por barbería cuando se incorpore multiempresa, por ejemplo `app.tudominio.com/empyrean-studio`. Más adelante se pueden habilitar subdominios de clientes (`nombre.tudominio.com`) y dominios propios.

## Preparación incluida en el código

- `backend/.env.production.example`: variables de producción sin secretos.
- `frontend/.env.production.example`: URL de API cuando se usa un subdominio separado.
- El servidor se niega a iniciar en producción si detecta `JWT_SECRET` débil, MySQL con `root`, contraseña de base de datos vacía o frontend sin HTTPS.
- `DATABASE_SSL=true` activa TLS hacia MySQL administrado.
- `TRUST_PROXY=true` debe usarse detrás de un proxy HTTPS confiable para conservar el protocolo seguro al generar URLs.

## Pasos de primera publicación

1. Comprar un dominio principal. No usar todavía un dominio de una barbería concreta si el producto será SaaS.
2. Crear una cuenta de nube y desplegar tres componentes separados: frontend, API y MySQL administrado.
3. Crear credenciales MySQL exclusivas para la aplicación; no usar `root`.
4. Ejecutar las migraciones de `database/`, incluida `012_secure_payment_proofs.sql`.
5. Generar un JWT nuevo y colocarlo únicamente en los secretos del proveedor:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

6. Configurar el frontend con `VITE_API_URL=https://api.tudominio.com/api` si API y frontend están en subdominios distintos. Si un proxy sirve ambos bajo el mismo dominio, se puede omitir.
7. Asociar `app.tudominio.com` al frontend y `api.tudominio.com` a la API; registrar los DNS exactos que indique el proveedor.
8. Habilitar HTTPS administrado por el proveedor y usar `NODE_ENV=production`, `FRONTEND_URL=https://app.tudominio.com` y `TRUST_PROXY=true`.
9. Cambiar fotos, QR y comprobantes desde la carpeta local a almacenamiento persistente privado antes de escalar a más de una instancia.
10. Configurar backups, alertas, limitación de intentos y seguimiento de errores antes de abrir el servicio a clientes.

## Consideraciones para la siguiente fase SaaS

Para vender a varias barberías habrá que añadir al menos:

- tabla `tenants` o `businesses`;
- `tenant_id` en usuarios, servicios, barberos, citas, horarios, cobros, ajustes y archivos;
- aislamiento obligatorio por tenant en **cada** consulta y autorización;
- una cuenta propietaria por barbería;
- planes, suscripción, límites y facturación;
- almacenamiento de archivos separado por tenant;
- trabajador único para recordatorios, con bloqueo distribuido (la implementación actual ya evita duplicados mediante bloqueo MySQL).
