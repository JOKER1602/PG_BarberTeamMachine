import { useEffect, useState } from 'react';
import { api, getStoredSession, logoutToHome, saveSession } from '../api.js';

const weekdays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function useAutoDismiss(message, dismiss, delay = 4500) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => dismiss(''), delay);
    return () => window.clearTimeout(timer);
  }, [message, dismiss, delay]);
}

const statusLabels = { PENDING: 'Anticipo en revisión', CONFIRMED: 'Confirmada', COMPLETED: 'Atendida', CANCELLED: 'Cancelada', NO_SHOW: 'No asistió' };
const money = (value) => `Bs ${Number(value ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const percentage = (part, total) => total ? `${Math.round((Number(part ?? 0) / Number(total)) * 100)}%` : '0%';
const cleanPersonName = (value) => value.replace(/[^\p{L}\s'-]/gu, '').replace(/\s{2,}/g, ' ').replace(/^\s/, '');
const cleanBolivianPhone = (value) => value.replace(/\D/g, '').slice(0, 8);
const isBolivianPhone = (value) => !value || /^[67]\d{7}$/.test(value);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const namePattern = /^[\p{L}]+(?:[ '\-][\p{L}]+)*$/u;
const fieldStatus = (value, valid) => !value ? 'neutral' : valid ? 'valid' : 'invalid';
const localDateTimeMinimum = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

function AdminValidationField({ label, status, helper, children }) {
  return <label className={`admin-validation-field ${status}`}><span>{label}</span><span className="admin-validation-control">{children}{status !== 'neutral' && <i aria-hidden="true">{status === 'valid' ? '✓' : '!'}</i>}</span>{helper && <small>{helper}</small>}</label>;
}

function AdminPanel({ services, barbers, categories, reloadCatalog }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [appointments, setAppointments] = useState([]); const [users, setUsers] = useState([]); const [dashboard, setDashboard] = useState(null); const [message, setMessage] = useState('');
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', barberId: '', serviceId: '', status: '' });
  const [barberId, setBarberId] = useState(''); const [assignedServices, setAssignedServices] = useState([]); const [hours, setHours] = useState([]); const [blocks, setBlocks] = useState([]);
  const [service, setService] = useState({ name: '', description: '', price: '', durationMinutes: '', categoryId: '' }); const [category, setCategory] = useState({ name: '', slug: '' }); const [editingService, setEditingService] = useState(null);
  const [barber, setBarber] = useState({ displayName: '', bio: '' }); const [barberPhotoFile, setBarberPhotoFile] = useState(null); const [barberPhotoInputKey, setBarberPhotoInputKey] = useState(0); const [editingBarber, setEditingBarber] = useState(null); const [editingBarberPhotoFile, setEditingBarberPhotoFile] = useState(null); const [barberEditorTab, setBarberEditorTab] = useState('perfil');
  const [createAccessNow, setCreateAccessNow] = useState(false); const [newBarberAccount, setNewBarberAccount] = useState({ email: '', password: '', phone: '' });
  const [hour, setHour] = useState({ weekday: '1', startTime: '10:00', endTime: '19:00' }); const [block, setBlock] = useState({ startsAt: '', endsAt: '', reason: '' });
  const [staffAccount, setStaffAccount] = useState({ email: '', password: '', phone: '' });
  const [barberToggleTarget, setBarberToggleTarget] = useState(null);
  const [pendingConfirmation, setPendingConfirmation] = useState(null);
  const [confirmingAction, setConfirmingAction] = useState(false);
  const [reschedule, setReschedule] = useState({ id: '', startsAt: '' });
  const [adminNoteDrafts, setAdminNoteDrafts] = useState({});
  const [paymentProofPreview, setPaymentProofPreview] = useState(null);
  const [paymentView, setPaymentView] = useState('pending');
  const [paymentQrFile, setPaymentQrFile] = useState(null);
  const [businessSettings, setBusinessSettings] = useState({ businessName: '', address: '', city: '', country: '', phone: '', whatsapp: '', hoursText: '', mapsUrl: '', instagramUrl: '', facebookUrl: '', description: '' });
  useAutoDismiss(message, setMessage);
  const barberNameStatus = fieldStatus(barber.displayName, namePattern.test(barber.displayName.trim()));
  const newAccountEmailStatus = fieldStatus(newBarberAccount.email, emailPattern.test(newBarberAccount.email));
  const newAccountPhoneStatus = fieldStatus(newBarberAccount.phone, isBolivianPhone(newBarberAccount.phone));
  const minimumBlockDate = localDateTimeMinimum();

  const makeQuery = (source = filters, includeStatus = true) => {
    const query = new URLSearchParams();
    Object.entries(source).forEach(([key, value]) => { if (value && (includeStatus || key !== 'status')) query.set(key, value); });
    return query.toString();
  };
  const refresh = async (source = filters) => {
    const [appointmentsResult, usersResult, dashboardResult] = await Promise.all([
      api.adminAppointments(makeQuery(source)), api.adminUsers(), api.adminDashboard(makeQuery(source, false))
    ]);
    setAppointments(appointmentsResult.appointments); setUsers(usersResult.users); setDashboard(dashboardResult);
  };
  useEffect(() => { refresh().catch((error) => setMessage(error.message)); }, []);
  useEffect(() => { api.businessSettings().then((result) => result.settings && setBusinessSettings(result.settings)).catch((error) => setMessage(error.message)); }, []);
  useEffect(() => { if (barberId) Promise.all([api.workingHours(barberId), api.blocks(barberId)]).then(([working, schedule]) => { setHours(working.workingHours); setBlocks(schedule.blocks); }).catch((error) => setMessage(error.message)); }, [barberId]);
  useEffect(() => { if (editingBarber) setBarberEditorTab('perfil'); }, [editingBarber?.id]);

  const saveMessage = (text) => setMessage(text);
  const requestConfirmation = (title, description, confirmLabel, action, tone = 'primary') => setPendingConfirmation({ title, description, confirmLabel, action, tone });
  const confirmPendingAction = async () => {
    if (!pendingConfirmation) return;
    setConfirmingAction(true);
    try { await pendingConfirmation.action(); setPendingConfirmation(null); }
    finally { setConfirmingAction(false); }
  };
  const updateStatus = async (id, status, reason) => { try { await api.updateAppointmentStatus(id, { status, ...(reason ? { reason } : {}) }); await refresh(); saveMessage('Estado de la cita actualizado.'); } catch (error) { saveMessage(error.message); } };
  const saveAdminNote = async (id) => { try { await api.updateAppointmentAdminNotes(id, adminNoteDrafts[id] ?? null); await refresh(); saveMessage('Nota interna guardada.'); } catch (error) { saveMessage(error.message); } };
  const createService = (event) => { event.preventDefault(); requestConfirmation('¿Crear este servicio?', 'El servicio quedará disponible en el catálogo según su categoría y duración.', 'Sí, crear servicio', async () => { try { await api.createService({ ...service, categoryId: Number(service.categoryId), price: Number(service.price), durationMinutes: Number(service.durationMinutes) }); setService({ name: '', description: '', price: '', durationMinutes: '', categoryId: '' }); await reloadCatalog(); await refresh(); saveMessage('Servicio creado correctamente.'); } catch (error) { saveMessage(error.message); } }); };
  const createCategory = (event) => { event.preventDefault(); requestConfirmation('¿Crear esta categoría?', 'Podrás usarla inmediatamente para organizar nuevos servicios.', 'Sí, crear categoría', async () => { try { await api.createServiceCategory(category); setCategory({ name: '', slug: '' }); await reloadCatalog(); saveMessage('Categoría creada. Ya puedes asignarla a un servicio.'); } catch (error) { saveMessage(error.message); } }); };
  const saveService = (event) => { event.preventDefault(); requestConfirmation('¿Guardar cambios del servicio?', 'La información actualizada se reflejará en el catálogo y en futuras reservas.', 'Sí, guardar cambios', async () => { try { await api.updateService(editingService.id, { name: editingService.name, description: editingService.description || undefined, categoryId: Number(editingService.categoryId), price: Number(editingService.price), durationMinutes: Number(editingService.durationMinutes), isActive: editingService.isActive }); setEditingService(null); await reloadCatalog(); await refresh(); saveMessage('Servicio actualizado.'); } catch (error) { saveMessage(error.message); } }); };
  const deleteService = () => { if (!editingService) return; requestConfirmation('¿Eliminar este servicio?', `“${editingService.name}” dejará de estar disponible. Esta acción no se puede deshacer.`, 'Sí, eliminar', async () => { try { await api.deleteService(editingService.id); setEditingService(null); await reloadCatalog(); await refresh(); saveMessage('Servicio eliminado.'); } catch (error) { saveMessage(error.message); } }, 'danger'); };
  const createBarber = (event) => { event.preventDefault(); if (!barberPhotoFile) { saveMessage('Debes subir una foto del profesional antes de crear su perfil.'); return; } requestConfirmation('¿Registrar este profesional?', createAccessNow ? 'También se creará su acceso temporal al sistema.' : 'Podrás completar después sus servicios, horario y acceso.', 'Sí, registrar profesional', async () => { try { const created = await api.createBarber(barber); await api.uploadBarberPhoto(created.id, barberPhotoFile); if (createAccessNow) await api.createBarberAccount({ ...newBarberAccount, barberId: Number(created.id) }); setBarber({ displayName: '', bio: '' }); setBarberPhotoFile(null); setBarberPhotoInputKey((value) => value + 1); setCreateAccessNow(false); setNewBarberAccount({ email: '', password: '', phone: '' }); await reloadCatalog(); await refresh(); saveMessage(createAccessNow ? 'Barbero y cuenta de acceso creados correctamente. Deberá cambiar su contraseña al iniciar sesión.' : 'Barbero registrado correctamente. Puedes completar su configuración desde su ficha.'); } catch (error) { saveMessage(error.message); } }); };
  const saveBarber = (event) => { event.preventDefault(); requestConfirmation('¿Guardar cambios del profesional?', 'Se actualizarán sus datos, foto y disponibilidad.', 'Sí, guardar cambios', async () => { try { await api.updateBarber(editingBarber.id, { displayName: editingBarber.displayName, bio: editingBarber.bio || undefined, isActive: editingBarber.isActive }); if (editingBarberPhotoFile) await api.uploadBarberPhoto(editingBarber.id, editingBarberPhotoFile); setEditingBarber(null); setEditingBarberPhotoFile(null); await reloadCatalog(); saveMessage('Información del barbero actualizada.'); } catch (error) { saveMessage(error.message); } }); };
  const toggleBarberActive = async () => {
    if (!barberToggleTarget) return;
    const item = barberToggleTarget;
    const nextStatus = !item.isActive;
    try {
      await api.updateBarber(item.id, { isActive: nextStatus });
      await reloadCatalog(); await refresh();
      setBarberToggleTarget(null);
      saveMessage(nextStatus ? 'Profesional y cuenta reactivados.' : 'Profesional desactivado y acceso al sistema bloqueado.');
    } catch (error) { saveMessage(error.message); }
  };
  const addHour = async (event) => { event.preventDefault(); try { await api.createWorkingHour(barberId, { ...hour, weekday: Number(hour.weekday) }); setHours((await api.workingHours(barberId)).workingHours); saveMessage('Horario laboral agregado.'); } catch (error) { saveMessage(error.message); } };
  const addBlock = async (event) => { event.preventDefault(); try { await api.createBlock(barberId, { ...block, startsAt: new Date(block.startsAt).toISOString(), endsAt: new Date(block.endsAt).toISOString() }); setBlocks((await api.blocks(barberId)).blocks); setBlock({ startsAt: '', endsAt: '', reason: '' }); saveMessage('Bloqueo de agenda creado.'); } catch (error) { saveMessage(error.message); } };
  const createAccount = async (event) => { event.preventDefault(); if (!editingBarber) return; try { await api.createBarberAccount({ ...staffAccount, barberId: Number(editingBarber.id) }); setStaffAccount({ email: '', password: '', phone: '' }); setEditingBarber({ ...editingBarber, userId: true }); await reloadCatalog(); await refresh(); saveMessage('Cuenta de acceso creada. El profesional deberá cambiar su contraseña al iniciar sesión.'); } catch (error) { saveMessage(error.message); } };
  const reprogramAppointment = async (event) => { event.preventDefault(); try { await api.rescheduleAppointment(reschedule.id, new Date(reschedule.startsAt).toISOString()); setReschedule({ id: '', startsAt: '' }); await refresh(); saveMessage('Cita reprogramada y confirmada automáticamente.'); } catch (error) { saveMessage(error.message); } };
  const saveBusinessSettings = async (event) => { event.preventDefault(); try { const normalised = Object.fromEntries(Object.entries(businessSettings).map(([key, value]) => [key, value || null])); const result = await api.updateBusinessSettings(normalised); setBusinessSettings(result.settings); saveMessage('Configuración del negocio actualizada.'); } catch (error) { saveMessage(error.message); } };
  const savePaymentQr = async (event) => { event.preventDefault(); if (!paymentQrFile) { saveMessage('Selecciona la imagen de tu QR.'); return; } try { const result = await api.uploadPaymentQr(paymentQrFile); setBusinessSettings(result.settings); setPaymentQrFile(null); saveMessage('QR de pagos actualizado.'); } catch (error) { saveMessage(error.message); } };
  const exportReport = () => {
    const rows = [
      ['Reporte de Empyrean Studio'],
      ['Generado', new Date().toLocaleString('es-BO')],
      ['Filtros', `Desde: ${filters.dateFrom || 'sin límite'} | Hasta: ${filters.dateTo || 'sin límite'} | Barbero: ${barbers.find((item) => String(item.id) === String(filters.barberId))?.displayName || 'todos'} | Servicio: ${services.find((item) => String(item.id) === String(filters.serviceId))?.name || 'todos'}`],
      [],
      ['Indicador', 'Valor'],
      ['Citas registradas', metrics.appointments ?? 0],
      ['Citas atendidas', metrics.completed ?? 0],
      ['Tasa de atención', percentage(metrics.completed, metrics.appointments)],
      ['Cancelaciones', metrics.cancelled ?? 0],
      ['Inasistencias', metrics.noShow ?? 0],
      ['Ingresos confirmados', money(metrics.confirmedRevenue)],
      ['Horas ocupadas', (Number(metrics.occupiedMinutes ?? 0) / 60).toFixed(1)],
      [],
      ['Cliente', 'Servicio', 'Barbero', 'Fecha y hora', 'Estado', 'Monto (Bs)'],
      ...appointments.map((item) => [item.clientName, item.serviceName, item.barberName, new Date(item.startsAt).toLocaleString('es-BO'), statusLabels[item.status] ?? item.status, Number(item.paymentAmount ?? item.price ?? 0).toFixed(2)])
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })); link.download = 'reporte-empyrean-studio-analitica.csv'; link.click(); URL.revokeObjectURL(link.href);
  };
  const clients = users.filter((user) => user.role === 'CLIENTE');
  const accountableBarbers = barbers.filter((item) => !item.userId);
  const metrics = dashboard?.metrics ?? {};
  const paymentReviews = Object.values(appointments.filter((item) => item.paymentProofUrl).reduce((groups, item) => {
    const key = item.paymentReference || `appointment-${item.id}`;
    if (!groups[key]) groups[key] = { ...item, services: [] };
    groups[key].services.push(item.serviceName);
    return groups;
  }, {})).sort((first, second) => new Date(second.startsAt) - new Date(first.startsAt));
  const pendingPaymentReviews = paymentReviews.filter((item) => item.status === 'PENDING');
  const visiblePaymentReviews = paymentView === 'pending' ? pendingPaymentReviews : paymentReviews.filter((item) => item.status !== 'PENDING');

  return <section className="admin-section admin-workspace">
    {message && <div className="admin-feedback" role="status" aria-live="polite"><span aria-hidden="true">✓</span><p>{message}</p><button type="button" aria-label="Cerrar mensaje" onClick={() => setMessage('')}>×</button></div>}
    {pendingConfirmation && <div className="admin-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !confirmingAction) setPendingConfirmation(null); }}><section className="admin-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title"><p className="section-label">Confirmar acción</p><h2 id="admin-confirm-title">{pendingConfirmation.title}</h2><p>{pendingConfirmation.description}</p><div><button type="button" className="quiet" disabled={confirmingAction} onClick={() => setPendingConfirmation(null)}>Volver</button><button type="button" className={pendingConfirmation.tone === 'danger' ? 'admin-confirm-danger' : ''} disabled={confirmingAction} onClick={confirmPendingAction}>{confirmingAction ? 'Guardando…' : pendingConfirmation.confirmLabel}</button></div></section></div>}
    {paymentProofPreview && <div className="payment-proof-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaymentProofPreview(null); }}><section className="payment-proof-modal" role="dialog" aria-modal="true" aria-labelledby="payment-proof-title"><div><div><p className="section-label">Comprobante de pago</p><h2 id="payment-proof-title">{paymentProofPreview.clientName}</h2><p>{paymentProofPreview.services.join(' + ')} · {money(paymentProofPreview.paymentAmount)}</p></div><button type="button" aria-label="Cerrar comprobante" onClick={() => setPaymentProofPreview(null)}>×</button></div><img src={paymentProofPreview.paymentProofUrl} alt={`Comprobante de pago de ${paymentProofPreview.clientName}`}/></section></div>}
    <nav className="admin-tabs" aria-label="Secciones administrativas">{[['dashboard', 'Dashboard'], ['agenda', 'Agenda y citas'], ['pagos', pendingPaymentReviews.length ? `Pagos (${pendingPaymentReviews.length})` : 'Pagos'], ['servicios', 'Servicios'], ['equipo', 'Barberos y horarios'], ['clientes', 'Clientes'], ['reportes', 'Reportes'], ['configuracion', 'Configuración']].map(([id, label]) => <button key={id} className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>{label}</button>)}</nav>
    {activeTab === 'dashboard' && <div className="admin-filterbar"><label>Desde<input type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })}/></label><label>Hasta<input type="date" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })}/></label><label>Barbero<select value={filters.barberId} onChange={(event) => setFilters({ ...filters, barberId: event.target.value })}><option value="">Todos</option>{barbers.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label><label>Servicio<select value={filters.serviceId} onChange={(event) => setFilters({ ...filters, serviceId: event.target.value })}><option value="">Todos</option>{services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button onClick={() => refresh().catch((error) => saveMessage(error.message))}>Aplicar filtros</button><button className="quiet" onClick={() => { const clean = { dateFrom: '', dateTo: '', barberId: '', serviceId: '', status: '' }; setFilters(clean); refresh(clean).catch((error) => saveMessage(error.message)); }}>Limpiar</button></div>}

    {activeTab === 'dashboard' && <div className="admin-dashboard"><div className="admin-metrics"><AdminMetric label="Citas registradas" value={metrics.appointments ?? 0} note="Según los filtros actuales"/><AdminMetric label="Citas atendidas" value={metrics.completed ?? 0} note={`${percentage(metrics.completed, metrics.appointments)} de efectividad`}/><AdminMetric label="Ingresos confirmados" value={money(metrics.confirmedRevenue)} note={`${money(metrics.completedRevenue)} ya atendidos`}/><AdminMetric label="Tiempo ocupado" value={`${(Number(metrics.occupiedMinutes ?? 0) / 60).toFixed(1)} h`} note="Pendientes, confirmadas y atendidas"/></div><div className="admin-dashboard-grid"><AdminBars title="Servicios más reservados" data={dashboard?.serviceUsage ?? []} empty="Aún no hay reservas para mostrar."/><AdminBars title="Horas con mayor demanda" data={dashboard?.busyHours ?? []} empty="Aún no hay horas registradas."/><section className="admin-card admin-status-card"><h3>Estado de citas</h3>{Object.entries(statusLabels).map(([status, label]) => <p key={status}><span className={`admin-status-dot ${status.toLowerCase()}`}></span>{label}<b>{Number((dashboard?.statuses ?? []).find((item) => item.status === status)?.total ?? 0)}</b></p>)}<small className="admin-status-footnote">Cancelación: {percentage(metrics.cancelled, metrics.appointments)} · Inasistencia: {percentage(metrics.noShow, metrics.appointments)}</small></section></div><div className="admin-analysis-grid"><AdminTrendChart data={dashboard?.dailyAppointments ?? []}/><AdminBarberPerformance data={dashboard?.barberPerformance ?? []}/><RecurringClients data={dashboard?.recurringClients ?? []}/></div></div>}

    {activeTab === 'agenda' && <div className="admin-agenda-layout"><section className="admin-card"><div className="admin-card-heading"><div><h3>Agenda centralizada</h3><p>{appointments.length} cita(s) encontradas.</p></div></div><div className="admin-appointment-list">{appointments.length ? appointments.map((item) => <article key={item.id}><time><b>{new Date(item.startsAt).toLocaleDateString('es-BO', { day: '2-digit', month: 'short' })}</b><span>{new Date(item.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</span></time><div><strong>{item.clientName}</strong><p>{item.serviceName} · {item.barberName}</p>{item.cancellationReason && <p className="appointment-note cancellation"><b>Motivo de cancelación:</b> {item.cancellationReason}</p>}</div><span className={`admin-status ${item.status.toLowerCase()}`}>{statusLabels[item.status]}</span><div className="admin-appointment-actions">{item.status === 'CONFIRMED' && <><button onClick={() => updateStatus(item.id, 'COMPLETED')}>Atendida</button><button onClick={() => updateStatus(item.id, 'NO_SHOW')}>No asistió</button><button className="danger" onClick={() => updateStatus(item.id, 'CANCELLED')}>Cancelar</button><button className="quiet" onClick={() => setReschedule({ id: item.id, startsAt: new Date(item.startsAt).toISOString().slice(0, 16) })}>Reprogramar</button></>}{item.status === 'PENDING' && item.paymentProofUrl && <small className="payment-awaiting">Esperando revisión del comprobante.</small>}</div><div className="admin-note-editor"><label>Nota interna<textarea value={adminNoteDrafts[item.id] ?? item.adminNotes ?? ''} onChange={(event) => setAdminNoteDrafts({ ...adminNoteDrafts, [item.id]: event.target.value })} placeholder="Solo visible para administración y barbero."/></label><button className="quiet" onClick={() => saveAdminNote(item.id)}>Guardar nota</button></div></article>) : <p className="admin-empty">No hay citas con estos filtros.</p>}</div></section>{reschedule.id && <aside className="admin-card reschedule-card"><h3>Reprogramar cita</h3><p>Solo las citas confirmadas pueden reprogramarse.</p><form onSubmit={reprogramAppointment}><input type="datetime-local" required value={reschedule.startsAt} onChange={(event) => setReschedule({ ...reschedule, startsAt: event.target.value })}/><button>Guardar nueva fecha</button><button type="button" className="quiet" onClick={() => setReschedule({ id: '', startsAt: '' })}>Cancelar</button></form></aside>}</div>}

    {activeTab === 'pagos' && <section className="admin-card payment-review-list"><p className="section-label">Cobros</p><h3>Comprobantes y pagos</h3><p>Consulta pagos pendientes e historial de comprobantes aprobados, rechazados o asociados a citas ya atendidas.</p><div className="payment-view-tabs" role="tablist" aria-label="Vista de pagos"><button type="button" role="tab" aria-selected={paymentView === 'pending'} className={paymentView === 'pending' ? 'active' : ''} onClick={() => setPaymentView('pending')}>Pendientes <b>{pendingPaymentReviews.length}</b></button><button type="button" role="tab" aria-selected={paymentView === 'history'} className={paymentView === 'history' ? 'active' : ''} onClick={() => setPaymentView('history')}>Historial <b>{paymentReviews.length - pendingPaymentReviews.length}</b></button></div>{visiblePaymentReviews.length ? visiblePaymentReviews.map((payment) => <article key={`payment-${payment.paymentReference ?? payment.id}`}><div><b>{payment.clientName} · {payment.services.join(' + ')}</b><span>Bs {Number(payment.paymentAmount ?? 0).toFixed(0)} · {new Date(payment.startsAt).toLocaleString('es-BO')} · {payment.services.length} servicio(s)</span></div><span className={`payment-history-status ${payment.status.toLowerCase()}`}>{statusLabels[payment.status]}</span><button className="quiet payment-proof-trigger" type="button" onClick={() => setPaymentProofPreview(payment)}>Ver comprobante</button>{paymentView === 'pending' && <><button onClick={() => updateStatus(payment.id, 'CONFIRMED')}>Aprobar pago</button><button className="danger" onClick={() => updateStatus(payment.id, 'CANCELLED', 'Pago rechazado')}>Rechazar pago</button></>}</article>) : <p className="admin-empty">{paymentView === 'pending' ? 'No hay comprobantes pendientes de revisión.' : 'Aún no hay pagos revisados en el historial.'}</p>}</section>}

    {activeTab === 'servicios' && <div className="services-management">
      <section className="admin-card services-overview">
        <div><p className="section-label">Catálogo</p><h3>Servicios y categorías</h3><p>Organiza primero las categorías y después agrega los servicios que el cliente podrá reservar.</p></div>
        <div className="services-summary"><span><b>{categories.length}</b> categorías</span><span><b>{services.length}</b> servicios</span></div>
      </section>
      <div className="services-workspace">
        <section className="admin-card service-create-card">
          <div className="service-card-heading"><p className="section-label">Paso 1</p><h3>Crea una categoría</h3><p>Ejemplo: Cortes, Barba, Tratamientos o Combos.</p></div>
          <form onSubmit={createCategory} className="admin-form"><input placeholder="Nombre, por ejemplo: Tratamientos" required value={category.name} onChange={(event) => setCategory({ ...category, name: event.target.value })}/><input placeholder="Identificador, por ejemplo: tratamientos" required pattern="[a-z0-9-]{2,80}" value={category.slug} onChange={(event) => setCategory({ ...category, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}/><button>Crear categoría</button></form>
          <div className="service-divider"/>
          <div className="service-card-heading"><p className="section-label">Paso 2</p><h3>Agrega un servicio</h3><p>Elige la categoría, define el precio y el tiempo que ocupará en agenda.</p></div>
          <form onSubmit={createService} className="admin-form"><select required value={service.categoryId} onChange={(event) => setService({ ...service, categoryId: event.target.value })}><option value="">Selecciona categoría</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input placeholder="Nombre del servicio" required value={service.name} onChange={(event) => setService({ ...service, name: event.target.value })}/><textarea placeholder="Descripción breve" value={service.description} onChange={(event) => setService({ ...service, description: event.target.value })}/><div><input type="number" min="0" step="0.01" placeholder="Precio en Bs" required value={service.price} onChange={(event) => setService({ ...service, price: event.target.value })}/><input type="number" min="1" placeholder="Duración (min)" required value={service.durationMinutes} onChange={(event) => setService({ ...service, durationMinutes: event.target.value })}/></div><button disabled={!categories.length}>Crear servicio</button></form>
          {!categories.length && <p className="service-helper">Primero crea al menos una categoría para poder registrar servicios.</p>}
        </section>
        <section className="admin-card service-catalog-card">
          <div className="service-catalog-heading"><div><p className="section-label">Paso 3</p><h3>Revisa tu catálogo</h3><p>Los servicios se agrupan por categoría para encontrarlos y editarlos rápidamente.</p></div><span>{services.length} en total</span></div>
          <div className="service-category-groups">{categories.length ? categories.map((categoryItem) => { const categoryServices = services.filter((item) => String(item.categoryId) === String(categoryItem.id)); return <section className="service-category-group" key={categoryItem.id}><header><h4>{categoryItem.name}</h4><span>{categoryServices.length} {categoryServices.length === 1 ? 'servicio' : 'servicios'}</span></header>{categoryServices.length ? categoryServices.map((item) => <article className="service-catalog-item" key={item.id}><div><b>{item.name}</b><span>Bs {Number(item.price).toFixed(0)} · {item.durationMinutes} min</span><small className={item.isActive ? 'service-available' : 'service-unavailable'}>{item.isActive ? 'Disponible para reservar' : 'No disponible'}</small></div><button className="quiet" onClick={() => setEditingService({ ...item })}>Editar</button></article>) : <p className="service-empty-category">Aún no hay servicios en esta categoría.</p>}</section>; }) : <p className="admin-empty">Crea tu primera categoría para empezar a organizar el catálogo.</p>}</div>
        </section>
      </div>
      {editingService && <div className="service-edit-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingService(null); }}><section className="admin-card service-edit-card" role="dialog" aria-modal="true" aria-labelledby="service-edit-title"><div className="service-catalog-heading"><div><p className="section-label">Edición</p><h3 id="service-edit-title">Editar servicio</h3><p>Actualiza los datos o desactiva temporalmente el servicio.</p></div><button type="button" className="service-edit-close" aria-label="Cerrar edición" onClick={() => setEditingService(null)}>×</button></div><form onSubmit={saveService} className="admin-form"><select required value={editingService.categoryId} onChange={(event) => setEditingService({ ...editingService, categoryId: event.target.value })}>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input required value={editingService.name} onChange={(event) => setEditingService({ ...editingService, name: event.target.value })}/><textarea value={editingService.description ?? ''} onChange={(event) => setEditingService({ ...editingService, description: event.target.value })}/><div><input type="number" min="0" step="0.01" required value={editingService.price} onChange={(event) => setEditingService({ ...editingService, price: event.target.value })}/><input type="number" min="1" required value={editingService.durationMinutes} onChange={(event) => setEditingService({ ...editingService, durationMinutes: event.target.value })}/></div><label className="admin-check"><input type="checkbox" checked={editingService.isActive} onChange={(event) => setEditingService({ ...editingService, isActive: event.target.checked })}/> Servicio disponible para reservas</label><div className="service-edit-actions"><button type="button" className="service-delete" onClick={deleteService}>Eliminar servicio</button><span/><button type="button" className="quiet" onClick={() => setEditingService(null)}>Cancelar</button><button>Guardar cambios</button></div></form></section></div>}
    </div>}

    {activeTab === 'equipo' && <div className="barber-management-page">
      <section className="admin-card barber-management-intro"><p className="section-label">Equipo</p><h3>Gestiona cada profesional desde un solo lugar</h3><p>Primero registra a un barbero. Luego, desde su ficha, podrás darle acceso, elegir sus servicios y configurar su disponibilidad.</p></section>
      <div className="barber-start-grid">
        <section className="admin-card"><p className="section-label">1 · Nuevo profesional</p><h3>Registrar barbero</h3><form onSubmit={createBarber} className="admin-form"><div className="barber-basic-data"><AdminValidationField label="Nombre del barbero" status={barberNameStatus} helper={barber.displayName && barberNameStatus === 'invalid' ? 'Usa solo letras, espacios, apóstrofes o guiones.' : 'Escribe el nombre con el que aparecerá en el equipo.'}><input placeholder="Ej.: Andrés Aranibar" required minLength="2" maxLength="120" value={barber.displayName} onChange={(event) => setBarber({ ...barber, displayName: cleanPersonName(event.target.value) })}/></AdminValidationField><label>Descripción o especialidad<textarea maxLength="2000" placeholder="Ej.: Especialista en cortes clásicos y perfilado" value={barber.bio} onChange={(event) => setBarber({ ...barber, bio: event.target.value })}/></label></div><label className={`photo-upload-field ${barberPhotoFile ? 'has-photo' : 'photo-required'}`}>Foto del barbero <b>Obligatoria</b><input key={barberPhotoInputKey} required type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setBarberPhotoFile(event.target.files?.[0] ?? null)}/><small>{barberPhotoFile ? `${barberPhotoFile.name} lista para subir` : 'Selecciona una imagen JPG, PNG o WEBP · máximo 5 MB'}</small></label><label className="create-access-toggle"><input type="checkbox" checked={createAccessNow} onChange={(event) => setCreateAccessNow(event.target.checked)}/><span><b>Crear también su acceso al sistema</b><small>El barbero podrá iniciar sesión y consultar su propia agenda.</small></span></label>{createAccessNow && <div className="new-barber-account"><p className="section-label">Datos de acceso</p><AdminValidationField label="Correo electrónico" status={newAccountEmailStatus} helper={newBarberAccount.email && newAccountEmailStatus === 'invalid' ? 'Ingresa un correo válido.' : ''}><input type="email" autoComplete="email" placeholder="correo@ejemplo.com" required value={newBarberAccount.email} onChange={(event) => setNewBarberAccount({ ...newBarberAccount, email: event.target.value.replace(/\s/g, '') })}/></AdminValidationField><label className="admin-account-field">Contraseña temporal<input type="password" autoComplete="new-password" minLength="8" maxLength="120" placeholder="Contraseña temporal" required value={newBarberAccount.password} onChange={(event) => setNewBarberAccount({ ...newBarberAccount, password: event.target.value })}/><small>El profesional creará su contraseña segura al iniciar sesión por primera vez.</small></label><AdminValidationField label="Teléfono boliviano" status={newAccountPhoneStatus} helper={newBarberAccount.phone && newAccountPhoneStatus === 'invalid' ? 'Completa 8 dígitos e inicia con 6 o 7.' : 'Opcional · móvil boliviano de 8 dígitos.'}><input type="tel" inputMode="numeric" autoComplete="tel" maxLength="8" pattern="[67][0-9]{7}" placeholder="Ej.: 77469963" value={newBarberAccount.phone} onChange={(event) => setNewBarberAccount({ ...newBarberAccount, phone: cleanBolivianPhone(event.target.value) })}/></AdminValidationField></div>}<button disabled={barberNameStatus !== 'valid' || !barberPhotoFile || (createAccessNow && (newAccountEmailStatus !== 'valid' || !newBarberAccount.password || newAccountPhoneStatus === 'invalid'))}>{createAccessNow ? 'Crear barbero y acceso' : 'Crear perfil de barbero'}</button></form></section>
        <section className="admin-card barber-directory-card"><div className="barber-directory-heading"><div><p className="section-label">2 · Equipo registrado</p><h3>Selecciona un profesional</h3><p>Abre su ficha para terminar de configurar sus servicios, agenda y acceso.</p></div><span>{barbers.length} registrados</span></div><div className="barber-directory-list">{barbers.length ? barbers.map((item) => <article key={item.id}>{item.photoUrl ? <img className="admin-barber-photo" src={item.photoUrl} alt=""/> : <div className="admin-barber-placeholder">{item.displayName.slice(0, 1)}</div>}<div><b>{item.displayName}</b><span>{item.serviceIds?.length ?? 0} servicio(s) · {item.isActive ? 'Activo' : 'Inactivo'}</span><small>{item.isActive ? (item.userId ? 'Tiene acceso al sistema' : 'Aún no tiene acceso') : 'Ficha y acceso bloqueados hasta reactivarlo'}</small></div><div className="barber-directory-actions">{Boolean(item.isActive) && <button className="quiet" onClick={() => { setEditingBarber({ ...item }); setEditingBarberPhotoFile(null); setBarberId(String(item.id)); setAssignedServices(item.serviceIds ?? []); }}>Abrir ficha</button>}<button className={item.isActive ? 'barber-deactivate' : 'barber-reactivate'} onClick={() => setBarberToggleTarget(item)}>{item.isActive ? 'Desactivar' : 'Reactivar'}</button></div></article>) : <p className="admin-empty">Aún no hay profesionales registrados.</p>}</div></section>
      </div>
      {editingBarber && <div className="barber-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingBarber(null); }}>
        <section className="barber-editor-modal" data-tab={barberEditorTab} role="dialog" aria-modal="true" aria-labelledby="barber-editor-title">
          <header className="barber-editor-header"><div><p className="section-label">Ficha del profesional</p><h3 id="barber-editor-title">{editingBarber.displayName}</h3><p>Gestiona su perfil, servicios, agenda y acceso desde un solo lugar.</p></div><button type="button" className="service-edit-close" aria-label="Cerrar ficha" onClick={() => setEditingBarber(null)}>×</button></header>
          <nav className="barber-editor-tabs" aria-label="Apartados del profesional">{[['perfil', 'Perfil'], ['servicios', 'Servicios'], ['horario', 'Horario'], ['bloqueos', 'Permisos'], ['acceso', 'Acceso']].map(([id, label]) => <button type="button" key={id} className={barberEditorTab === id ? 'active' : ''} onClick={() => setBarberEditorTab(id)}>{label}</button>)}</nav>
          <div className="barber-editor-grid">
            <section className="admin-card"><p className="section-label">Perfil</p><h3>Datos y foto</h3><form onSubmit={saveBarber} className="admin-form"><label>Nombre del profesional<input required minLength="2" maxLength="120" value={editingBarber.displayName} onChange={(event) => setEditingBarber({ ...editingBarber, displayName: cleanPersonName(event.target.value) })}/></label><label>Descripción o especialidad<textarea maxLength="2000" value={editingBarber.bio ?? ''} onChange={(event) => setEditingBarber({ ...editingBarber, bio: event.target.value })}/></label><label className="photo-upload-field">Actualizar foto<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setEditingBarberPhotoFile(event.target.files?.[0] ?? null)}/><small>{editingBarberPhotoFile ? `${editingBarberPhotoFile.name} lista para subir` : 'Deja el campo vacío para conservar la foto actual.'}</small></label><button>Guardar perfil</button></form></section>
            <section className="admin-card"><p className="section-label">Servicios</p><h3>¿Qué puede atender?</h3><div className="admin-service-checks">{services.filter((item) => item.isActive).map((item) => <label key={item.id}><input type="checkbox" checked={assignedServices.includes(item.id)} onChange={(event) => setAssignedServices(event.target.checked ? [...assignedServices, item.id] : assignedServices.filter((id) => id !== item.id))}/>{item.name}</label>)}</div><button onClick={async () => { try { await api.setBarberServices(barberId, assignedServices); await reloadCatalog(); saveMessage('Servicios asignados al barbero.'); } catch (error) { saveMessage(error.message); } }}>Guardar servicios</button></section>
            <section className="admin-card"><p className="section-label">Horario</p><h3>Disponibilidad semanal</h3><form onSubmit={addHour} className="admin-form horizontal"><select value={hour.weekday} onChange={(event) => setHour({ ...hour, weekday: event.target.value })}>{weekdays.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select><input type="time" value={hour.startTime} onChange={(event) => setHour({ ...hour, startTime: event.target.value })}/><input type="time" value={hour.endTime} onChange={(event) => setHour({ ...hour, endTime: event.target.value })}/><button>Agregar</button></form>{hours.map((item) => <p className="admin-line-item" key={item.id}>{weekdays[item.weekday - 1]} · {String(item.startTime).slice(0, 5)}–{String(item.endTime).slice(0, 5)}<button className="quiet" onClick={async () => { await api.deleteWorkingHour(barberId, item.id); setHours((await api.workingHours(barberId)).workingHours); }}>Eliminar</button></p>)}</section>
            <section className="admin-card"><p className="section-label">Permisos</p><h3>Registrar permiso o descanso</h3><form onSubmit={addBlock} className="admin-form"><label>Inicio del permiso<input type="datetime-local" min={minimumBlockDate} required value={block.startsAt} onChange={(event) => setBlock({ ...block, startsAt: event.target.value, endsAt: block.endsAt && block.endsAt < event.target.value ? event.target.value : block.endsAt })}/></label><label>Fin del permiso<input type="datetime-local" min={block.startsAt || minimumBlockDate} required value={block.endsAt} onChange={(event) => setBlock({ ...block, endsAt: event.target.value })}/></label><input maxLength="255" placeholder="Motivo (permiso, descanso, vacaciones, etc.)" value={block.reason} onChange={(event) => setBlock({ ...block, reason: event.target.value })}/><button>Registrar permiso</button></form>{blocks.map((item) => <p className="admin-line-item" key={item.id}>{new Date(item.startsAt).toLocaleString('es-BO')}<small>{item.reason || 'Sin motivo'}</small><button className="quiet" onClick={async () => { await api.deleteBlock(barberId, item.id); setBlocks((await api.blocks(barberId)).blocks); }}>Eliminar</button></p>)}</section>
          </div>
          {editingBarber.userId ? <section className="admin-card barber-access-card barber-access-ready"><div><p className="section-label">Acceso al sistema</p><h3>Acceso configurado</h3><p>{editingBarber.displayName} ya tiene una cuenta para iniciar sesión y consultar su agenda.</p></div><span className="barber-access-status">✓ Cuenta activa</span></section> : <section className="admin-card barber-access-card"><div><p className="section-label">Acceso al sistema</p><h3>Crear acceso para este profesional</h3><p>Usa una contraseña temporal. El profesional deberá reemplazarla en su primer inicio de sesión.</p></div><form onSubmit={createAccount} className="admin-form"><label className="admin-account-field">Correo electrónico<input type="email" autoComplete="email" required value={staffAccount.email} onChange={(event) => setStaffAccount({ ...staffAccount, email: event.target.value.trimStart() })}/></label><label className="admin-account-field">Contraseña temporal<input type="password" autoComplete="new-password" minLength="8" maxLength="120" required value={staffAccount.password} onChange={(event) => setStaffAccount({ ...staffAccount, password: event.target.value })}/><small>Usa al menos 8 caracteres.</small></label><label className={`admin-account-field ${staffAccount.phone && !isBolivianPhone(staffAccount.phone) ? 'invalid' : ''}`}>Teléfono boliviano <small>Opcional · 8 dígitos, inicia con 6 o 7.</small><input type="tel" inputMode="numeric" autoComplete="tel" maxLength="8" pattern="[67][0-9]{7}" title="Ingresa un móvil boliviano de 8 dígitos que empiece con 6 o 7" placeholder="Ej.: 77469963" value={staffAccount.phone} onChange={(event) => setStaffAccount({ ...staffAccount, phone: cleanBolivianPhone(event.target.value) })}/>{staffAccount.phone && !isBolivianPhone(staffAccount.phone) && <small className="field-error">Completa 8 dígitos e inicia con 6 o 7.</small>}</label><button>Crear cuenta de acceso</button></form></section>}
        </section>
      </div>}
      {barberToggleTarget && <div className="barber-toggle-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setBarberToggleTarget(null); }}><section className="barber-toggle-modal" role="dialog" aria-modal="true" aria-labelledby="barber-toggle-title"><p className="section-label">Gestión del equipo</p><h2 id="barber-toggle-title">¿Deseas {barberToggleTarget.isActive ? 'desactivar' : 'reactivar'} a {barberToggleTarget.displayName}?</h2><p>{barberToggleTarget.isActive ? 'Se retirará de reservas y su acceso al sistema quedará bloqueado.' : 'Volverá a estar disponible para reservas y recuperará su acceso al sistema.'}</p><div><button type="button" className="quiet" onClick={() => setBarberToggleTarget(null)}>Volver</button><button type="button" className={barberToggleTarget.isActive ? 'barber-deactivate' : 'barber-reactivate'} onClick={toggleBarberActive}>{barberToggleTarget.isActive ? 'Sí, desactivar' : 'Sí, reactivar'}</button></div></section></div>}
    </div>}

    {activeTab === 'clientes' && <section className="admin-card"><div className="admin-card-heading"><div><h3>Clientes registrados</h3><p>{clients.length} cliente(s) en el sistema.</p></div></div><div className="admin-users-table">{clients.map((item) => <article key={item.id}><div className="user-avatar">{item.firstName?.slice(0, 1)}{item.lastName?.slice(0, 1)}</div><div><b>{item.firstName} {item.lastName}</b><span>{item.email}</span><small>{item.phone || 'Sin teléfono registrado'} · {item.appointmentCount ?? 0} cita(s)</small></div><span className={item.isActive ? 'user-active' : 'user-inactive'}>{item.isActive ? 'Activo' : 'Inactivo'}</span><button className="quiet" onClick={async () => { try { await api.setUserActive(item.id, !item.isActive); await refresh(); saveMessage(`Cliente ${item.isActive ? 'desactivado' : 'activado'}.`); } catch (error) { saveMessage(error.message); } }}>{item.isActive ? 'Desactivar' : 'Activar'}</button></article>)}</div></section>}

    {activeTab === 'reportes' && <div className="admin-report-grid"><section className="admin-card"><p className="section-label">Reporte de citas</p><h3>Exporta el período filtrado</h3><p>El archivo incluye los indicadores, filtros aplicados y el detalle de las {appointments.length} citas consultadas.</p><button onClick={exportReport}>Descargar CSV completo</button></section><section className="admin-card"><p className="section-label">Resumen operativo</p><h3>Decisiones rápidas</h3><ul className="admin-insights"><li><b>{dashboard?.serviceUsage?.[0]?.name || 'Sin datos'}</b> es el servicio con mayor demanda.</li><li><b>{dashboard?.busyHours?.[0]?.label || 'Sin datos'}</b> es la franja con más reservas.</li><li><b>{dashboard?.barberPerformance?.[0]?.name || 'Sin datos'}</b> concentra más citas en este período.</li><li>{percentage(metrics.cancelled, metrics.appointments)} de las citas fueron canceladas.</li></ul><button className="quiet" onClick={() => setActiveTab('dashboard')}>Ver dashboard</button></section></div>}

    {activeTab === 'configuracion' && <div className="business-settings-layout"><section className="admin-card business-settings-card"><p className="section-label">Datos públicos</p><h3>Configuración de la barbería</h3><p>Estos datos se usan en las páginas públicas y en los correos de recordatorio.</p><form className="admin-form" onSubmit={saveBusinessSettings}><div><input placeholder="Nombre comercial" required value={businessSettings.businessName ?? ''} onChange={(event) => setBusinessSettings({ ...businessSettings, businessName: event.target.value })}/><input placeholder="Teléfono" required value={businessSettings.phone ?? ''} onChange={(event) => setBusinessSettings({ ...businessSettings, phone: event.target.value })}/></div><div><input placeholder="Dirección" required value={businessSettings.address ?? ''} onChange={(event) => setBusinessSettings({ ...businessSettings, address: event.target.value })}/><input placeholder="Ciudad" required value={businessSettings.city ?? ''} onChange={(event) => setBusinessSettings({ ...businessSettings, city: event.target.value })}/></div><div><input placeholder="País" required value={businessSettings.country ?? ''} onChange={(event) => setBusinessSettings({ ...businessSettings, country: event.target.value })}/><input placeholder="WhatsApp" required value={businessSettings.whatsapp ?? ''} onChange={(event) => setBusinessSettings({ ...businessSettings, whatsapp: event.target.value })}/></div><input placeholder="Horario general" required value={businessSettings.hoursText ?? ''} onChange={(event) => setBusinessSettings({ ...businessSettings, hoursText: event.target.value })}/><input type="url" placeholder="Enlace de Google Maps" value={businessSettings.mapsUrl ?? ''} onChange={(event) => setBusinessSettings({ ...businessSettings, mapsUrl: event.target.value })}/><input type="url" placeholder="Instagram (opcional)" value={businessSettings.instagramUrl ?? ''} onChange={(event) => setBusinessSettings({ ...businessSettings, instagramUrl: event.target.value })}/><input type="url" placeholder="Facebook (opcional)" value={businessSettings.facebookUrl ?? ''} onChange={(event) => setBusinessSettings({ ...businessSettings, facebookUrl: event.target.value })}/><textarea placeholder="Descripción corta" value={businessSettings.description ?? ''} onChange={(event) => setBusinessSettings({ ...businessSettings, description: event.target.value })}/><button>Guardar configuración</button></form></section><aside className="admin-card payment-qr-admin"><div className="payment-qr-heading"><span aria-hidden="true">⌁</span><div><p className="section-label">Cobros</p><h3>QR para pagos</h3></div></div><p>Esta imagen se muestra al cliente al confirmar su reserva. Luego podrás revisar su comprobante en <b>Pagos</b>.</p>{businessSettings.paymentQrUrl ? <img src={businessSettings.paymentQrUrl} alt="QR de pagos actual"/> : <div className="payment-qr-empty"><b>QR pendiente</b><span>Sube la imagen para habilitar pagos por QR.</span></div>}<form className="admin-form" onSubmit={savePaymentQr}><label className="photo-upload-field">Actualizar imagen QR<input type="file" required accept="image/jpeg,image/png,image/webp" onChange={(event) => setPaymentQrFile(event.target.files?.[0] ?? null)}/><small>{paymentQrFile ? paymentQrFile.name : 'JPG, PNG o WEBP · máximo 5 MB'}</small></label><button>{businessSettings.paymentQrUrl ? 'Reemplazar QR' : 'Subir QR de pago'}</button></form></aside></div>}
  </section>;
}

function AdminMetric({ label, value, note }) { return <article className="admin-metric"><span>{label}</span><b>{value}</b><small>{note}</small></article>; }

function AdminBars({ title, data, empty }) {
  const maximum = Math.max(...data.map((item) => Number(item.total)), 1);
  return <section className="admin-card admin-bars"><h3>{title}</h3>{data.length ? <div>{data.map((item) => <article key={item.name ?? item.label}><div><span>{item.name ?? item.label}</span><b>{item.total}</b></div><i><em style={{ width: `${(Number(item.total) / maximum) * 100}%` }}></em></i></article>)}</div> : <p className="admin-empty">{empty}</p>}</section>;
}

function AdminTrendChart({ data }) {
  const maximum = Math.max(...data.map((item) => Number(item.total)), 1);
  return <section className="admin-card admin-trend-chart"><div className="admin-card-heading"><div><h3>Comportamiento de reservas</h3><p>Registros por día dentro del período seleccionado.</p></div></div>{data.length ? <div className="trend-bars">{data.map((item) => <div key={item.date} title={`${item.date}: ${item.total} reserva(s)`}><b style={{ height: `${Math.max(10, (Number(item.total) / maximum) * 100)}%` }}></b><span>{item.date.slice(5).replace('-', '/')}</span></div>)}</div> : <p className="admin-empty">Aún no hay reservas para graficar.</p>}</section>;
}

function AdminBarberPerformance({ data }) {
  return <section className="admin-card admin-performance"><h3>Uso por profesional</h3>{data.length ? data.map((item) => <article key={item.id}><div><b>{item.name}</b><span>{item.total} cita(s) · {Number(item.occupiedMinutes / 60).toFixed(1)} h ocupadas</span></div><strong>{money(item.revenue)}</strong></article>) : <p className="admin-empty">Aún no hay actividad de profesionales.</p>}</section>;
}

function RecurringClients({ data }) {
  return <section className="admin-card admin-recurring"><h3>Clientes recurrentes</h3>{data.length ? data.map((item) => <article key={item.id}><span>{item.name.split(' ').map((name) => name[0]).join('').slice(0, 2)}</span><div><b>{item.name}</b><small>{item.total} reservas · última: {new Date(item.lastVisit).toLocaleDateString('es-BO')}</small></div></article>) : <p className="admin-empty">Aún no hay clientes con dos o más reservas.</p>}</section>;
}

function ActionIcon({ name }) {
  const paths = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18M8 14h3M8 17h3"/></>,
    directions: <><path d="M12 21s7-5.1 7-11A7 7 0 0 0 5 10c0 5.9 7 11 7 11Z"/><circle cx="12" cy="10" r="2.3"/></>,
    location: <><path d="M4 7.5 12 4l8 3.5-8 3-8-3Z"/><path d="m4 12 8 3 8-3M4 16.5l8 3 8-3"/></>,
    edit: <><path d="m4 16.5-.8 3.3 3.3-.8L18 7.5l-2.6-2.6L4 16.5Z"/><path d="m13.8 6.5 2.6 2.6"/></>,
    cancel: <><circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6m0-6-6 6"/></>,
    repeat: <><path d="M19 8V4l2.7 2.7L19 9.4V8h-7a4 4 0 1 0 3.5 5.9"/><path d="M5 16v4l-2.7-2.7L5 14.6V16h7a4 4 0 1 0-3.5-5.9"/></>,
    star: <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.8-5.4 2.8 1-6.1-4.4-4.3 6.1-.9L12 3Z"/>
  };
  return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function AdminPortal() {
  const [session, setSession] = useState(() => getStoredSession()?.user ?? null);
  const [services, setServices] = useState([]);
  const [barbers, setBarbers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(() => new URLSearchParams(window.location.search).get('session') === 'expired' ? 'Tu sesión expiró. Ingresa nuevamente para continuar.' : '');

  const isAdmin = session?.role === 'ADMINISTRADOR';
  const reloadCatalog = async () => {
    const [serviceResult, barberResult, categoryResult] = await Promise.all([api.adminServices(), api.adminBarbers(), api.serviceCategories()]);
    setServices(serviceResult.services);
    setBarbers(barberResult.barbers);
    setCategories(categoryResult.categories);
  };

  useEffect(() => {
    if (isAdmin) reloadCatalog().catch((requestError) => setError(requestError.message));
  }, [isAdmin]);

  useEffect(() => {
    if (session?.role === 'BARBERO') window.location.replace('/barbero');
    else if (!isAdmin) window.location.replace('/?login=1');
  }, [session, isAdmin]);

  async function login(event) {
    event.preventDefault();
    setError('');
    try {
      const result = await api.login(form);
      if (!['ADMINISTRADOR', 'BARBERO'].includes(result.user.role)) {
        setError('Esta es una cuenta de cliente. Inicia sesión al momento de reservar tu cita; no tiene acceso al panel del equipo.');
        return;
      }
      saveSession(result);
      setSession(result.user);
      if (result.user.role === 'BARBERO') window.location.assign('/barbero');
    } catch (loginError) {
      setError(loginError.message);
    }
  }

  if (!isAdmin && session?.role !== 'BARBERO') return <main className="admin-login-page">
    <a className="admin-login-brand" href="/">EMPYREAN<span> STUDIO</span></a>
    <section>
      <p className="section-label">Acceso único</p>
      <h1>Inicia sesión desde el encabezado</h1>
      <p>El acceso se realiza desde el botón «Iniciar sesión» de la página principal. Según tus credenciales, se abrirá automáticamente el panel correcto.</p>
      <a className="admin-back-home" href="/?login=1">Ir al inicio de sesión →</a>
    </section>
  </main>;

  return <main className="admin-portal">
    <header><a href="/">EMPYREAN<span> STUDIO</span></a><div><span>Administrador: {session.firstName}</span><button onClick={logoutToHome}>Cerrar sesión</button></div></header>
    <div className="admin-portal-heading"><p className="section-label">Panel de administración</p><h1>Gestión de Empyrean Studio</h1><p>Administra la agenda, los servicios, el equipo y los usuarios desde un solo lugar.</p></div>
    <AdminPanel services={services} barbers={barbers} categories={categories} reloadCatalog={reloadCatalog}/>
  </main>;
}

