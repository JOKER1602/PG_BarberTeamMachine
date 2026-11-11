# Auditoría de preparación para producción

> **Actualización 8 de noviembre de 2026:** esta auditoría es anterior a la conversión SaaS. La guía vigente es [PRODUCTION_LAUNCH.md](PRODUCTION_LAUNCH.md). Desde entonces quedaron resueltos en el código: límite de intentos (punto 8, en memoria para una instancia), carpeta de subidas persistente configurable (`UPLOADS_DIR`, punto 7), CSP y demás cabeceras, salud con base de datos, respaldos con `npm run db:backup` y dependencias sin vulnerabilidades. Siguen siendo tareas de despliegue los puntos 1, 2, 5, 6 y 9.

Fecha de revisión: 5 de noviembre de 2026.

## Corregido durante la auditoría

- La sesión se guarda en cookie `HttpOnly`, `SameSite=Lax` y `Secure` cuando `NODE_ENV=production`; el token ya no queda expuesto en `localStorage`.
- La API limita CORS al origen configurado, bloquea cambios desde orígenes ajenos y agrega cabeceras básicas de seguridad.
- Los comprobantes de pago dejan de ser archivos públicos: se registran por propietario, se consumen una sola vez y solo Administración puede verlos mediante una ruta protegida.
- El frontend usará `/api` en una compilación de producción, por lo que funciona con un proxy HTTPS en el mismo dominio. Para una API en otro dominio se configura `VITE_API_URL` al compilar.
- Se eliminó una dependencia y recursos sin uso detectados en la revisión.

## Obligatorio antes de publicar

1. Configurar `NODE_ENV=production`, un `JWT_SECRET` aleatorio de al menos 32 bytes y `FRONTEND_URL` con el dominio HTTPS exacto.
2. Servir todo por HTTPS. Si hay un proxy confiable delante de Node, usar `TRUST_PROXY=true`.
3. Ejecutar `database/012_secure_payment_proofs.sql` en cada entorno que no tenga la tabla `payment_proofs`. Ya fue aplicada en la base local revisada.
4. Compilar el frontend con `npm run build`; usar `VITE_API_URL=https://api.tudominio.com/api` solo si frontend y API estarán en dominios diferentes.
5. No guardar `.env`, contraseñas de correo, tokens de Meta ni JWT en Git. Rotar de inmediato cualquier token o contraseña que se hubiera compartido.
6. Usar una cuenta MySQL exclusiva de la aplicación, con permisos mínimos, contraseñas robustas y copias de seguridad verificadas.
7. Mover `uploads/` a almacenamiento persistente privado (por ejemplo S3, Cloudinary o Supabase Storage). El disco local se pierde al redeplegar o escalar servidores.
8. Añadir limitación de intentos para inicio de sesión y recuperación de contraseña en el proxy o en un servicio compartido (Redis), además de monitoreo y registro de errores.
9. Probar en el dominio final: registro, login/logout, recuperación, reserva, QR, revisión de pago, cancelación, reseña y recordatorio de WhatsApp.

## Estado

El código ya cubre los controles críticos identificados en esta auditoría y supera las pruebas automatizadas del repositorio. No debe declararse listo para clientes reales hasta completar la lista de despliegue anterior, especialmente HTTPS, secretos, almacenamiento persistente, copias de seguridad y limitación de intentos.
