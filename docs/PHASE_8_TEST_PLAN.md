# Fase 8 — Plan de pruebas y evaluación

## 1. Propósito

Esta fase valida que Empyrean Studio cumpla sus flujos de negocio, preserve las restricciones de acceso y se comporte de forma comprensible y estable antes de una demostración o despliegue. La ejecución se divide en cuatro grupos:

1. pruebas unitarias y de regresión;
2. pruebas funcionales e integración API–base de datos–interfaz;
3. pruebas de usabilidad con usuarios representativos;
4. pruebas de rendimiento básicas sobre las rutas de consulta.

Las pruebas se realizan contra una **base de datos de prueba**, nunca contra una instalación con datos operativos reales.

## 2. Alcance y exclusiones

Incluye autenticación, roles, catálogo, agenda, pago manual por QR, reservas, estados, reseñas, notificaciones, recomendaciones, asistente y reportes administrativos. Cubre los roles `CLIENTE`, `BARBERO` y `ADMINISTRADOR`.

No valida el procesamiento bancario real: el alcance actual usa comprobante de pago y una decisión humana de administración. Tampoco garantiza entrega de correos si SMTP no está configurado; en ese caso se valida el registro de la notificación y el comportamiento de reintento.

## 3. Ambientes y datos controlados

| Elemento | Requisito |
| --- | --- |
| API | `http://localhost:3002` con `NODE_ENV=test` o configuración equivalente. |
| Cliente web | `http://localhost:5173`. |
| Base de datos | Esquema versionado y una base exclusiva, por ejemplo `barber_team_machine_test`. |
| Zona horaria | `America/La_Paz` (UTC−4). |
| Usuarios | Un cliente activo, un cliente inactivo, un administrador y dos barberos vinculados. |
| Agenda | Un barbero con jornada, otro sin disponibilidad, un bloqueo y citas con cada estado. |
| Catálogo | Dos categorías y al menos tres servicios, con diferente duración y precio. |
| Pagos | Un QR configurado y una imagen de comprobante no sensible. |

### Reglas para preparar los datos

- Usar correos de prueba y contraseñas temporales; no documentar ni reutilizar credenciales reales.
- Crear una cita futura confirmada, una pendiente de pago, una atendida, una cancelada y una inasistencia.
- Anotar los identificadores creados en la bitácora de ejecución para poder repetir los casos.
- Limpiar o recrear la base de prueba al finalizar la ronda.

## 4. Ejecución automatizada existente

Desde la raíz del repositorio:

```powershell
npm test
npm run build --workspace frontend
npm run test:smoke # con la API local iniciada
```

La suite actual protege estas reglas de alto riesgo:

| Archivo | Cobertura |
| --- | --- |
| `backend/test/availability.test.js` | Zona horaria de Cochabamba, traslapes, cierre, bloqueos y horas ya pasadas. |
| `backend/test/authorization.test.js` | Restricciones de cliente, administrador y barbero asignado. |
| `backend/test/admin-dashboard.test.js` | Protección administrativa, filtros y respuesta analítica del dashboard. |
| `backend/test/api-smoke.test.js` | Salud HTTP, validación de entrada, rutas privadas y respuesta 404. |
| `backend/test/booking-assistant.test.js` | Interpretación base de servicio, profesional, fecha y hora en español. |
| `frontend/src/api.test.js` | Sesión, cabeceras, disponibilidad, errores de API y expiración de sesión. |

Un resultado satisfactorio requiere que todas las pruebas pasen y que la compilación del frontend termine sin errores. La prueba HTTP efímera puede marcarse como omitida solo en un sandbox que prohíba conexiones loopback; se ejecuta completa en desarrollo local normal. Los casos manuales siguientes complementan las rutas que requieren MySQL, archivos cargados y validación visual.

## 5. Casos funcionales e integración

### 5.1 Autenticación y cuenta

| ID | Escenario | Resultado esperado | Evidencia |
| --- | --- | --- | --- |
| F8-AUT-01 | Registrar cliente con correo nuevo y datos válidos. | Se crea una cuenta `CLIENTE`, se cifra la contraseña y se inicia sesión. | Respuesta `201`, registro en `users`, captura. |
| F8-AUT-02 | Repetir el registro con el mismo correo, variando mayúsculas. | Se rechaza con conflicto y no se duplica la cuenta. | Respuesta `409`, conteo de usuarios. |
| F8-AUT-03 | Iniciar sesión como cliente, barbero y administrador. | Cada rol llega solo a su área permitida. | Capturas y respuestas de `/api/auth/me`. |
| F8-AUT-04 | Intentar iniciar sesión con contraseña incorrecta o cuenta inactiva. | Error controlado, sin token ni datos de cuenta. | Respuesta `401`. |
| F8-AUT-05 | Solicitar y completar recuperación de contraseña. | El token se usa una única vez y la nueva contraseña permite acceso. | Registro de correo/BD y login posterior. |
| F8-AUT-06 | Cambiar contraseña desde el perfil autenticado. | La sesión conserva el usuario y la nueva clave funciona. | Login posterior y captura. |

### 5.2 Servicios, profesionales y agenda

| ID | Escenario | Resultado esperado | Evidencia |
| --- | --- | --- | --- |
| F8-CAT-01 | Consultar catálogo y filtrar por categoría. | Solo se muestran servicios activos de la categoría elegida. | Captura y `GET /api/services`. |
| F8-CAT-02 | Administrador crea/edita/desactiva servicio y categoría. | Cambios persistidos; el servicio inactivo deja de verse al público. | Respuestas API y consulta SQL. |
| F8-BAR-01 | Administrador crea barbero, sube fotografía y asigna servicios. | La foto se almacena, el perfil aparece y solo permite sus servicios. | Captura, URL de imagen y relaciones `barber_services`. |
| F8-BAR-02 | Configurar jornada, descanso y bloqueo de agenda. | Disponibilidad refleja exactamente esos límites. | `GET /availability` antes/después. |
| F8-AGE-01 | Consultar horarios disponibles para un servicio y profesional. | Solo devuelve horarios dentro de la jornada, futuros y sin conflicto. | Respuesta `200` y lista de slots. |
| F8-AGE-02 | Intentar dos reservas simultáneas para el mismo profesional y horario. | Máximo una reserva se crea; la otra recibe `409`. | Dos respuestas y filas en `appointments`. |
| F8-AGE-03 | Intentar reservar una hora pasada del día actual. | Se rechaza y no crea registros. | Respuesta y consulta SQL. |
| F8-AGE-04 | Intentar cruzar la hora de cierre o un bloqueo. | Se rechaza con razón de no disponibilidad. | Respuesta y captura. |

### 5.3 Reserva, pago y ciclo de vida de la cita

| ID | Escenario | Resultado esperado | Evidencia |
| --- | --- | --- | --- |
| F8-RES-01 | Cliente selecciona uno o varios servicios, profesional y horario válido. | Se muestra el total correcto y se solicita comprobante QR. | Captura de resumen. |
| F8-PAG-01 | Cliente carga comprobante de imagen válido. | Se devuelve URL del archivo y no se permite subir sin autenticación de cliente. | `201` y prueba `401/403`. |
| F8-PAG-02 | Cliente confirma reserva con comprobante. | Se crean las citas agrupadas con referencia de pago, monto total y estado `PENDING`. | `201`, filas de DB y notificación. |
| F8-PAG-03 | Administrador aprueba el pago. | Todas las citas de la misma referencia pasan a `CONFIRMED`; se generan avisos/recordatorios. | Estado, `notifications`, `reminder_jobs`. |
| F8-PAG-04 | Administrador rechaza el pago con motivo. | Las citas del grupo pasan a `CANCELLED`, conservan motivo y fecha de cancelación. | Estado y campos de trazabilidad. |
| F8-RES-02 | Cliente cancela una cita pendiente o confirmada. | Se actualiza el estado, razón, fecha y notificación; se libera la disponibilidad. | Consulta posterior de slots y DB. |
| F8-RES-03 | Cliente reprograma una cita confirmada a un slot libre. | Se validan disponibilidad y duración; queda confirmada en el nuevo horario. | Registro antes/después y notificación. |
| F8-RES-04 | Cliente intenta cancelar o reprogramar cita ajena. | Se rechaza sin revelar información de otro cliente. | Respuesta de error y auditoría. |
| F8-BAR-03 | Barbero asignado marca una cita confirmada como atendida. | Solo la cita asignada pasa a `COMPLETED`, con `completed_at` y `updated_by`. | Dashboard barbero y consulta SQL. |
| F8-BAR-04 | Barbero marca una cita propia confirmada como `NO_SHOW` o `CANCELLED`. | Se guarda estado, motivo si corresponde, fecha de cancelación y aviso al cliente. | DB y notificación. |
| F8-BAR-05 | Barbero intenta operar una cita ajena o pendiente de pago. | La operación es rechazada. | Respuesta `403/404` según la API. |
| F8-REV-01 | Cliente deja reseña después de una cita atendida. | Se registra una reseña de 1–5 estrellas asociada a la cita. | `201` y fila en `reviews`. |
| F8-REV-02 | Cliente intenta reseñar una cita no atendida o por segunda vez. | La API rechaza la acción; no duplica la reseña. | Respuesta `400/409`. |

### 5.4 Recomendación, asistente, notificaciones y reportes

| ID | Escenario | Resultado esperado | Evidencia |
| --- | --- | --- | --- |
| F8-REC-01 | Cliente con historial pide recomendaciones. | Se sugieren servicios/horarios compatibles y disponibles, sin crear reserva. | Respuesta y captura. |
| F8-REC-02 | Cliente sin historial pide recomendaciones. | Se usan servicios populares como alternativa segura. | Respuesta y datos de referencia. |
| F8-ASIS-01 | Consultar: “Quiero un corte mañana con [barbero] después de las 4”. | Detecta los criterios disponibles y devuelve hasta tres horarios reales. | Respuesta de `/api/assistant/query`. |
| F8-ASIS-02 | Consultar sin servicio o con texto ambiguo. | Solicita información faltante; no falla ni crea una cita. | Respuesta `200` y cero filas nuevas. |
| F8-NOT-01 | Confirmar, cancelar y reprogramar una cita. | Se registran notificaciones del evento para el cliente. | Tabla `notifications` y bandeja de usuario. |
| F8-NOT-02 | Ejecutar el trabajador de recordatorios con SMTP configurado y sin SMTP. | Registra `SENT` o `FAILED`/canal interno de forma trazable; no bloquea la API. | `reminder_jobs` y logs controlados. |
| F8-REP-01 | Administrador aplica periodo, servicio y profesional al panel. | Indicadores, gráficas y lista usan el mismo conjunto filtrado. | Capturas y respuesta `/api/admin/dashboard`. |
| F8-REP-02 | Exportar CSV con filtros activos. | El archivo contiene filtros, resumen y detalle coherentes con el panel. | CSV archivado como evidencia. |

## 6. Matriz de autorización mínima

| Operación | Público | Cliente | Barbero | Administrador |
| --- | :---: | :---: | :---: | :---: |
| Ver catálogo, profesionales, reseñas y configuración pública | Sí | Sí | Sí | Sí |
| Crear reserva y cargar comprobante | No | Sí | No | No |
| Ver/modificar solo sus citas | No | Sí | No | No |
| Marcar citas propias confirmadas | No | No | Sí | No |
| Gestionar servicios, barberos, usuarios, pagos y panel | No | No | No | Sí |
| Ver reportes administrativos | No | No | No | Sí |

Para cada prohibición se debe probar una solicitud con token válido de otro rol, además de una solicitud sin token. El resultado nunca debe incluir datos sensibles ni permitir la modificación.

## 7. Prueba de integración de punta a punta

Ejecutar una vez por cada versión candidata:

1. Registrar un cliente nuevo e iniciar sesión.
2. Elegir un servicio y profesional que tenga jornada configurada.
3. Consultar disponibilidad y elegir un slot futuro.
4. Cargar comprobante de pago y crear la reserva pendiente.
5. Iniciar sesión como administrador, validar el comprobante y aprobar el pago.
6. Comprobar en la cuenta del cliente que la reserva aparece confirmada y tiene notificación.
7. Iniciar sesión como barbero asignado, marcar la cita como atendida.
8. Iniciar sesión de nuevo como cliente y dejar una única reseña.
9. Volver como administrador, confirmar que los indicadores y CSV incluyen la cita.

**Criterio de aprobación:** los datos creados deben conservar el mismo cliente, profesional, servicios, monto, horarios y estado a través de todo el recorrido, sin intervención manual directa en MySQL.

## 8. Evaluación de usabilidad

### Participantes y protocolo

- Recomendar al menos 5 participantes: 3 clientes, 1 barbero y 1 administrador; documentar el número real y sus perfiles.
- Entregar una tarea por vez, sin indicar los clics necesarios.
- Registrar: finalización, tiempo, errores, dudas, observaciones y severidad de los problemas.
- Ejecutar en escritorio y teléfono o emulación móvil. Probar lectores a 200 % de zoom y navegación con teclado en los flujos principales.

### Tareas por rol

| Rol | Tarea | Éxito observable |
| --- | --- | --- |
| Cliente | Reservar y cargar un comprobante. | Cita pendiente creada con total correcto. |
| Cliente | Consultar historial, cancelar o reprogramar. | El usuario comprende el estado y completa la acción segura. |
| Cliente | Usar el asistente para encontrar una opción. | Llega al flujo de reserva con datos precargados. |
| Barbero | Identificar la agenda del día y marcar una cita atendida. | Actualiza una cita propia sin tocar otra. |
| Administrador | Aprobar un pago y consultar reporte filtrado. | Estado y panel se actualizan correctamente. |

### Cuestionario SUS (System Usability Scale)

Tras las tareas, cada participante responde de 1 a 5 (1 = totalmente en desacuerdo, 5 = totalmente de acuerdo):

1. Creo que usaría este sistema frecuentemente.
2. Encontré el sistema innecesariamente complejo.
3. Consideré el sistema fácil de usar.
4. Creo que necesitaría ayuda técnica para utilizarlo.
5. Las funciones están bien integradas.
6. Encontré demasiadas inconsistencias.
7. Considero que otras personas aprenderían a usarlo rápidamente.
8. El sistema resultó incómodo de usar.
9. Me sentí seguro al utilizarlo.
10. Necesité aprender muchas cosas antes de empezar.

**Cálculo:** para ítems impares restar 1 a la respuesta; para pares restar la respuesta a 5. Sumar los diez resultados y multiplicar por 2,5. Documentar promedio, mediana, muestra y hallazgos. Como referencia de mejora, una media de 68 o más es aceptable; una menor requiere analizar los problemas observados antes de la entrega.

## 9. Rendimiento y confiabilidad

El script [tests/performance/k6-smoke.js](../tests/performance/k6-smoke.js) verifica salud y consultas públicas de bajo riesgo. Requiere [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/), que no forma parte de las dependencias del proyecto.

```powershell
# Con backend iniciado y datos de prueba cargados
k6 run tests/performance/k6-smoke.js

# Contra otra URL de API
k6 run -e BASE_URL=http://localhost:3002 tests/performance/k6-smoke.js
```

Umbrales iniciales de aceptación local:

- errores HTTP: menos de 1 %;
- verificaciones (`checks`): al menos 99 %;
- percentil 95 de las consultas públicas: menos de 700 ms;
- no deben aparecer respuestas `500` ni errores de CORS.

Para una prueba de carga posterior, aumentar gradualmente VUs sobre **una base aislada**, sin usar `POST /api/appointments/multi` repetidamente; esa ruta crea datos y requiere un caso de concurrencia controlado. Conservar el resumen exportado por k6 como evidencia.

## 10. Bitácora de resultados y criterios de salida

Para cada ejecución registrar: fecha, versión/commit, ambiente, datos utilizados, ejecutor, caso, resultado, evidencia y defecto asociado. Clasificar defectos como:

- **Crítico:** pérdida/exposición de datos, pago o reserva incorrecta, acceso no autorizado.
- **Alto:** impide terminar una tarea principal.
- **Medio:** existe alternativa, pero deteriora el flujo o la información.
- **Bajo:** detalle visual, texto o consistencia menor.

La fase queda aprobada cuando:

1. las pruebas automatizadas y la compilación pasan;
2. todos los casos críticos y altos del plan están aprobados o tienen corrección verificada;
3. la prueba punta a punta se completa sin alterar datos fuera del flujo;
4. no hay errores `500` conocidos en los flujos principales;
5. existe evidencia de usabilidad y rendimiento, con hallazgos documentados;
6. se adjunta la matriz de trazabilidad de [REQUIREMENTS_TRACEABILITY_MATRIX.md](./REQUIREMENTS_TRACEABILITY_MATRIX.md).

