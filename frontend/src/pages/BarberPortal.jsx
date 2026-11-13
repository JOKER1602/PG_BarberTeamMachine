import { useEffect, useState } from 'react';
import { api, getStoredSession, logoutToHome } from '../api.js';
import { tenantHref } from '../tenant.js';
import BrandMark from '../components/BrandMark.jsx';
import RequiredPasswordChange from '../components/RequiredPasswordChange.jsx';

const appointmentStatusLabel = { PENDING: 'Anticipo en revisión', CONFIRMED: 'Confirmada', COMPLETED: 'Atendida', CANCELLED: 'Cancelada', NO_SHOW: 'No asistió' };

function BarberStatusModal({ change, onClose, onConfirm }) {
  const isCancellation = change.status === 'CANCELLED';
  return <div className="barber-status-backdrop" role="dialog" aria-modal="true" aria-labelledby="barber-status-title">
    <section className="barber-status-modal">
      <button className="barber-status-close" onClick={onClose} aria-label="Cerrar">×</button>
      <p className="section-label">Actualizar cita</p>
      <h2 id="barber-status-title">{isCancellation ? '¿Cancelar esta cita?' : '¿Marcar como no asistió?'}</h2>
      <p>La cita de <b>{change.appointment.clientName}</b> quedará registrada como {isCancellation ? 'cancelada' : 'no asistida'} y se notificará al cliente.</p>
      {isCancellation && <label>Motivo de cancelación <small>Opcional</small><textarea value={change.reason} maxLength="255" placeholder="Ej.: inconveniente de horario" onChange={(event) => change.setReason(event.target.value)}/></label>}
      <div className="barber-status-modal-actions"><button onClick={onClose}>Volver</button><button className={isCancellation ? 'cancel' : 'no-show'} onClick={onConfirm}>{isCancellation ? 'Sí, cancelar' : 'Confirmar no asistió'}</button></div>
    </section>
  </div>;
}

const timeLabel = (value) => new Date(value).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });

function BarberAppointmentActions({ appointment, now, onComplete, onRequestStatus, onUndo }) {
  // Deshacer: durante unos minutos el barbero puede revertir su propio
  // «Atendida» o «No asistió» si tocó el botón equivocado.
  const undoUntil = appointment.undoUntil ? new Date(appointment.undoUntil) : null;
  if (undoUntil && undoUntil > now) {
    const minutesLeft = Math.max(1, Math.ceil((undoUntil - now) / 60000));
    return <div className="barber-appointment-actions">
      <button className="barber-undo" onClick={() => onUndo(appointment)}>↶ Deshacer · {minutesLeft} min</button>
    </div>;
  }
  // El comprobante pendiente todavía debe ser validado por administración.
  // El barbero solo puede gestionar una cita ya confirmada.
  if (appointment.status !== 'CONFIRMED') return null;
  // La asistencia se marca desde la hora de inicio; cancelar, en cualquier momento.
  const hasStarted = new Date(appointment.startsAt) <= now;
  return <div className="barber-appointment-actions">
    {hasStarted
      ? <><button className="barber-complete" onClick={() => onComplete(appointment)}>Atendida</button>
        <button className="barber-no-show" onClick={() => onRequestStatus(appointment, 'NO_SHOW')}>No asistió</button></>
      : <small className="attendance-locked">Asistencia desde las {timeLabel(appointment.startsAt)}</small>}
    <button className="barber-cancel" onClick={() => onRequestStatus(appointment, 'CANCELLED')}>Cancelar</button>
  </div>;
}

export default function BarberPortal() {
  const [session, setSession] = useState(() => getStoredSession()?.user ?? null);
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState('');
  const [statusChange, setStatusChange] = useState(null);
  const [notice, setNotice] = useState('');
  // Reloj de la página: habilita los botones al llegar la hora de la cita y
  // descuenta el tiempo para deshacer.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const isBarber = session?.role === 'BARBERO';

  useEffect(() => {
    if (!isBarber) {
      window.location.replace(tenantHref('/?login=1'));
      return;
    }
    api.barberDashboard().then(setDashboard).catch((requestError) => setError(requestError.message));
  }, [isBarber]);

  if (!isBarber) return <main className="admin-login-page"><a className="admin-login-brand" href={tenantHref('/')}><BrandMark/></a><section><p className="section-label">Acceso único</p><h1>Redirigiendo al inicio de sesión</h1><p>Usa el botón «Iniciar sesión» del encabezado. El sistema abrirá tu agenda si tu cuenta es de barbero.</p><a className="admin-back-home" href={tenantHref('/?login=1')}>Ir al inicio de sesión →</a></section></main>;
  if (session?.mustChangePassword) return <RequiredPasswordChange session={session} onComplete={setSession}/>;

  const appointments = dashboard?.appointments ?? [];
  const today = appointments.filter((appointment) => new Date(appointment.startsAt).toDateString() === now.toDateString());
  const upcoming = appointments.filter((appointment) => new Date(appointment.startsAt) >= now && !['CANCELLED', 'NO_SHOW'].includes(appointment.status));
  async function refreshDashboard() { setDashboard(await api.barberDashboard()); }
  const undoMinutes = dashboard?.undoWindowMinutes ?? 10;
  async function markAsCompleted(appointment) {
    try {
      setError('');
      await api.completeBarberAppointment(appointment.id);
      await refreshDashboard();
      setNow(new Date());
      setNotice(`${appointment.clientName}: marcada como atendida. ¿Te equivocaste? Puedes deshacerlo durante ${undoMinutes} minutos.`);
    } catch (requestError) { setError(requestError.message); }
  }
  async function undoChange(appointment) {
    try {
      setError('');
      await api.undoBarberAppointment(appointment.id);
      await refreshDashboard();
      setNow(new Date());
      setNotice(`${appointment.clientName}: cambio deshecho, la cita vuelve a estar confirmada.`);
    } catch (requestError) { setError(requestError.message); await refreshDashboard().catch(() => {}); }
  }
  function requestStatusChange(appointment, status) {
    setStatusChange({ appointment, status, reason: '' });
  }
  async function confirmStatusChange() {
    if (!statusChange) return;
    try {
      setError('');
      await api.updateBarberAppointmentStatus(statusChange.appointment.id, { status: statusChange.status, reason: statusChange.reason || undefined });
      const { appointment, status } = statusChange;
      setStatusChange(null);
      await refreshDashboard();
      setNow(new Date());
      setNotice(status === 'NO_SHOW'
        ? `${appointment.clientName}: marcada como no asistió. ¿Te equivocaste? Puedes deshacerlo durante ${undoMinutes} minutos.`
        : `${appointment.clientName}: cita cancelada.`);
    } catch (requestError) { setError(requestError.message); }
  }
  return <main className="barber-portal">
    <header><a href={tenantHref('/')}><BrandMark/></a><div><span>{dashboard?.barber.displayName}</span><button onClick={logoutToHome}>Cerrar sesión</button></div></header>
    <section className="barber-hero"><p className="section-label">Mi agenda</p><h1>Hola, {dashboard?.barber.displayName?.split(' ')[0]}.</h1><p>Estas son exclusivamente las citas asignadas a ti.</p><div><article><b>{today.length}</b><span>Citas de hoy</span></article><article><b>{upcoming.length}</b><span>Próximas citas</span></article><article><b>{dashboard?.services.length ?? 0}</b><span>Servicios asignados</span></article></div></section>
    {error && <p className="barber-error">{error}</p>}
    {notice && !error && <p className="barber-notice" role="status">{notice}<button type="button" aria-label="Cerrar aviso" onClick={() => setNotice('')}>×</button></p>}
    <section className="barber-dashboard"><div><h2>Agenda de hoy</h2>{today.length ? <div className="barber-appointments">{today.map((appointment) => <article key={appointment.id}><time>{new Date(appointment.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</time><div><b>{appointment.clientName}</b><span>{appointment.serviceName} · {appointment.durationMinutes} min</span>{appointment.adminNotes && <p className="barber-appointment-note internal"><b>Nota del equipo:</b> {appointment.adminNotes}</p>}</div><i className={appointment.status.toLowerCase()}>{appointmentStatusLabel[appointment.status] ?? appointment.status}</i><BarberAppointmentActions appointment={appointment} now={now} onComplete={markAsCompleted} onRequestStatus={requestStatusChange} onUndo={undoChange}/></article>)}</div> : <p className="barber-empty">No tienes citas para hoy.</p>}</div><aside><h2>Mi información</h2><b>Servicios</b><p>{dashboard?.services.map((service) => service.name).join(' · ') || 'Sin servicios asignados'}</p><b>Horario laboral</b><p>{dashboard?.workingHours.length ? 'Configurado por administración' : 'Sin horario configurado'}</p></aside></section>
    <section className="barber-upcoming"><h2>Próximas citas</h2>{upcoming.length ? upcoming.map((appointment) => <article key={appointment.id}><div><b>{appointment.serviceName}</b><span>{appointment.clientName}</span>{appointment.adminNotes && <p className="barber-appointment-note internal"><b>Nota del equipo:</b> {appointment.adminNotes}</p>}</div><time>{new Date(appointment.startsAt).toLocaleDateString('es-BO', { weekday: 'short', day: 'numeric', month: 'short' })} · {new Date(appointment.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</time><i className={appointment.status.toLowerCase()}>{appointmentStatusLabel[appointment.status] ?? appointment.status}</i><BarberAppointmentActions appointment={appointment} now={now} onComplete={markAsCompleted} onRequestStatus={requestStatusChange} onUndo={undoChange}/></article>) : <p className="barber-empty">No tienes próximas citas.</p>}</section>
    {statusChange && <BarberStatusModal change={{ ...statusChange, setReason: (reason) => setStatusChange((current) => ({ ...current, reason })) }} onClose={() => setStatusChange(null)} onConfirm={confirmStatusChange}/>} 
  </main>;
}
