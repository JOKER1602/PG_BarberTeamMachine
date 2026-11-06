# Recordatorios de citas por WhatsApp

La API programa un recordatorio dos horas antes de cada cita confirmada. El trabajador revisa la cola aproximadamente cada cinco minutos. No se envían recordatorios de citas pendientes, canceladas o atendidas, ni a clientes que no aceptaron recibirlos. Una reserva con varios servicios genera un solo mensaje. Si la cita se confirma con menos de dos horas de anticipación, no se envía un recordatorio tardío; tampoco se envían trabajos vencidos tras una interrupción prolongada.

## Configuración necesaria

### Meta WhatsApp Cloud API (proveedor actual)

1. En Meta Developers, agrega cada destinatario como **número de prueba** mientras la aplicación esté en modo de prueba. Meta no entrega mensajes a teléfonos que no estén autorizados en esa lista.
2. Para comprobar la conexión, configura en `backend/.env`: `WHATSAPP_PROVIDER=meta`, `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_TEMPLATE_NAME=hello_world`, `META_WHATSAPP_TEMPLATE_LANGUAGE=en_US` y `META_WHATSAPP_TEMPLATE_USES_PARAMETERS=false`.
3. Para el recordatorio real de dos horas, crea y aprueba en WhatsApp Manager una plantilla de utilidad en español con este cuerpo y cinco variables: `Hola {{1}}, te recordamos tu cita en {{2}}: {{3}} con {{4}}, el {{5}}.` Luego usa su nombre y lenguaje en `META_WHATSAPP_TEMPLATE_NAME` y `META_WHATSAPP_TEMPLATE_LANGUAGE`, y cambia `META_WHATSAPP_TEMPLATE_USES_PARAMETERS=true`.
4. El token de acceso, el Phone Number ID y cualquier credencial se guardan solo en `backend/.env`; no se suben a Git.

### Twilio (alternativa anterior)

1. Crear una cuenta de Twilio y habilitar un remitente de WhatsApp Business o el sandbox de pruebas. En el sandbox, cada destinatario debe unirse antes de recibir mensajes.
2. Crear y obtener la aprobación de una plantilla de WhatsApp que contenga estas variables en este orden:
   `Hola {{1}}, te recordamos tu cita en {{2}}: {{3}} con {{4}}, el {{5}}.`
3. Configurar solo en `backend/.env` (no subir credenciales al repositorio): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` (por ejemplo, `+14155238886` en sandbox) y `TWILIO_WHATSAPP_CONTENT_SID` (identificador `HX...` de la plantilla aprobada).
4. Ejecutar `database/010_whatsapp_reminder_consent.sql` una sola vez en una instalación existente. Para una instalación nueva, el campo ya está en `001_initial_schema.sql`.
5. Reiniciar la API y mantenerla ejecutándose. El número del cliente debe ser un móvil boliviano válido, y el cliente debe activar el consentimiento en la reserva o en Perfil. Puede desactivarlo desde Perfil.

Sin configuración del proveedor los trabajos permanecen pendientes hasta vencer, sin registrarse como enviados. `SENT` significa que Meta o Twilio aceptó la solicitud; no confirma entrega al dispositivo. Los fallos se registran en `reminder_jobs.last_error` y se reintentan hasta tres veces. Para seguimiento de entrega y bajas por mensajes entrantes es necesario configurar webhooks y políticas del proveedor antes de producción.

La integración sigue los requisitos oficiales de [Twilio para consentimiento de WhatsApp](https://www.twilio.com/docs/whatsapp/api) y [plantillas aprobadas](https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates).
