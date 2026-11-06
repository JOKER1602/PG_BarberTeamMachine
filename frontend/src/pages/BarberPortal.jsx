import { useEffect, useState } from 'react';
import { api, getStoredSession, logoutToHome, saveSession } from '../api.js';
import { tenantHref } from '../tenant.js';

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

function BarberAppointmentActions({ appointment, onComplete, onRequestStatus }) {
  // El comprobante pendiente todavía debe ser validado por administración.
  // El barbero solo puede gestionar una cita ya confirmada.
  if (appointment.status !== 'CONFIRMED') return null;
  return <div className="barber-appointment-actions">
    <button className="barber-complete" onClick={() => onComplete(appointment.id)}>Atendida</button>
    <button className="barber-no-show" onClick={() => onRequestStatus(appointment, 'NO_SHOW')}>No asistió</button>
    <button className="barber-cancel" onClick={() => onRequestStatus(appointment, 'CANCELLED')}>Cancelar</button>
  </div>;
}

function RequiredPasswordChange({ session, onComplete }) {
  const [form, setForm] = useState({ temporaryPassword: '', password: '', confirmation: '' });
  const [error, setError] = useState('');
  const [temporaryPasswordError, setTemporaryPasswordError] = useState('');
  const [newPasswordError, setNewPasswordError] = useState('');
  const [saving, setSaving] = useState(false);
  const checks = { length: form.password.length >= 8, lower: /[a-z]/.test(form.password), upper: /[A-Z]/.test(form.password), number: /\d/.test(form.password) };
  const passwordIsValid = Object.values(checks).every(Boolean);
  const fieldStatus = (value, valid) => !value ? 'neutral' : valid ? 'valid' : 'invalid';
  async function submit(event) {
    event.preventDefault();
    setError(''); setTemporaryPasswordError(''); setNewPasswordError('');
    if (form.password !== form.confirmation) { setNewPasswordError('Las contraseñas nuevas no coinciden.'); return; }
    if (!passwordIsValid) { setNewPasswordError('Tu nueva contraseña todavía no cumple todos los requisitos.'); return; }
    setSaving(true);
    try {
      await api.updatePassword({ currentPassword: form.temporaryPassword, password: form.password });
      const user = { ...session, mustChangePassword: false };
      saveSession({ user });
      onComplete(user);
    } catch (requestError) {
      if (/contrase[ñn]a actual/i.test(requestError.message)) setTemporaryPasswordError('La contraseña temporal no es correcta.');
      else setError(requestError.message);
    }
    finally { setSaving(false); }
  }
  return <main className="required-password-page"><section className="required-password-card">
    <p className="section-label">Primer acceso</p><h1>Crea tu contraseña personal</h1><p>Tu administrador te entregó una contraseña temporal. Debes reemplazarla antes de consultar tu agenda.</p>
    <form onSubmit={submit}>
      <label className={`required-password-field required-temporary-password ${temporaryPasswordError ? 'invalid' : ''}`}><span>Contraseña temporal</span><span className="required-password-control"><input type="password" required minLength="8" autoComplete="current-password" value={form.temporaryPassword} onChange={(event) => { setForm({ ...form, temporaryPassword: event.target.value }); setTemporaryPasswordError(''); }}/></span>{temporaryPasswordError && <small>{temporaryPasswordError}</small>}</label>
      <label className={`required-password-field ${fieldStatus(form.password, passwordIsValid)}`}><span>Nueva contraseña</span><span className="required-password-control"><input type="password" required minLength="8" autoComplete="new-password" value={form.password} onChange={(event) => { setForm({ ...form, password: event.target.value }); setNewPasswordError(''); }}/>{form.password && <i aria-hidden="true">{passwordIsValid ? '✓' : '!'}</i>}</span><small>Usa mayúscula, minúscula, número y 8 caracteres o más.</small></label>
      <ul className="password-checklist required-password-checklist" aria-label="Requisitos de contraseña"><li className={checks.length ? 'valid' : ''}>8 caracteres o más</li><li className={checks.upper ? 'valid' : ''}>Una mayúscula</li><li className={checks.lower ? 'valid' : ''}>Una minúscula</li><li className={checks.number ? 'valid' : ''}>Un número</li></ul>
      <label className={`required-password-field ${fieldStatus(form.confirmation, form.confirmation === form.password && passwordIsValid)}`}><span>Confirmar nueva contraseña</span><span className="required-password-control"><input type="password" required minLength="8" autoComplete="new-password" value={form.confirmation} onChange={(event) => { setForm({ ...form, confirmation: event.target.value }); setNewPasswordError(''); }}/>{form.confirmation && <i aria-hidden="true">{form.confirmation === form.password && passwordIsValid ? '✓' : '!'}</i>}</span>{newPasswordError ? <small>{newPasswordError}</small> : form.confirmation && form.confirmation !== form.password && <small>Las contraseñas no coinciden.</small>}</label>
      {error && <p className="password-change-error">{error}</p>}<button disabled={saving}>{saving ? 'Guardando...' : 'Guardar y continuar'}</button>
    </form>
  </section></main>;
}

export default function BarberPortal() {
  const [session, setSession] = useState(() => getStoredSession()?.user ?? null);
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState('');
  const [statusChange, setStatusChange] = useState(null);
  const isBarber = session?.role === 'BARBERO';

  useEffect(() => {
    if (!isBarber) {
      window.location.replace(tenantHref('/?login=1'));
      return;
    }
    api.barberDashboard().then(setDashboard).catch((requestError) => setError(requestError.message));
  }, [isBarber]);

  if (!isBarber) return <main className="admin-login-page"><a className="admin-login-brand" href={tenantHref('/')}>EMPYREAN<span> STUDIO</span></a><section><p className="section-label">Acceso único</p><h1>Redirigiendo al inicio de sesión</h1><p>Usa el botón «Iniciar sesión» del encabezado. El sistema abrirá tu agenda si tu cuenta es de barbero.</p><a className="admin-back-home" href={tenantHref('/?login=1')}>Ir al inicio de sesión →</a></section></main>;
  if (session?.mustChangePassword) return <RequiredPasswordChange session={session} onComplete={setSession}/>;

  const appointments = dashboard?.appointments ?? [];
  const now = new Date();
  const today = appointments.filter((appointment) => new Date(appointment.startsAt).toDateString() === now.toDateString());
  const upcoming = appointments.filter((appointment) => new Date(appointment.startsAt) >= now && !['CANCELLED', 'NO_SHOW'].includes(appointment.status));
  async function refreshDashboard() { setDashboard(await api.barberDashboard()); }
  async function markAsCompleted(id) {
    try { setError(''); await api.completeBarberAppointment(id); await refreshDashboard(); }
    catch (requestError) { setError(requestError.message); }
  }
  function requestStatusChange(appointment, status) {
    setStatusChange({ appointment, status, reason: '' });
  }
  async function confirmStatusChange() {
    if (!statusChange) return;
    try {
      setError('');
      await api.updateBarberAppointmentStatus(statusChange.appointment.id, { status: statusChange.status, reason: statusChange.reason || undefined });
      setStatusChange(null);
      await refreshDashboard();
    } catch (requestError) { setError(requestError.message); }
  }
  return <main className="barber-portal">
    <header><a href={tenantHref('/')}>EMPYREAN<span> STUDIO</span></a><div><span>{dashboard?.barber.displayName}</span><button onClick={logoutToHome}>Cerrar sesión</button></div></header>
    <section className="barber-hero"><p className="section-label">Mi agenda</p><h1>Hola, {dashboard?.barber.displayName?.split(' ')[0]}.</h1><p>Estas son exclusivamente las citas asignadas a ti.</p><div><article><b>{today.length}</b><span>Citas de hoy</span></article><article><b>{upcoming.length}</b><span>Próximas citas</span></article><article><b>{dashboard?.services.length ?? 0}</b><span>Servicios asignados</span></article></div></section>
    {error && <p className="barber-error">{error}</p>}
    <section className="barber-dashboard"><div><h2>Agenda de hoy</h2>{today.length ? <div className="barber-appointments">{today.map((appointment) => <article key={appointment.id}><time>{new Date(appointment.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</time><div><b>{appointment.clientName}</b><span>{appointment.serviceName} · {appointment.durationMinutes} min</span>{appointment.adminNotes && <p className="barber-appointment-note internal"><b>Nota del equipo:</b> {appointment.adminNotes}</p>}</div><i className={appointment.status.toLowerCase()}>{appointmentStatusLabel[appointment.status] ?? appointment.status}</i><BarberAppointmentActions appointment={appointment} onComplete={markAsCompleted} onRequestStatus={requestStatusChange}/></article>)}</div> : <p className="barber-empty">No tienes citas para hoy.</p>}</div><aside><h2>Mi información</h2><b>Servicios</b><p>{dashboard?.services.map((service) => service.name).join(' · ') || 'Sin servicios asignados'}</p><b>Horario laboral</b><p>{dashboard?.workingHours.length ? 'Configurado por administración' : 'Sin horario configurado'}</p></aside></section>
    <section className="barber-upcoming"><h2>Próximas citas</h2>{upcoming.length ? upcoming.map((appointment) => <article key={appointment.id}><div><b>{appointment.serviceName}</b><span>{appointment.clientName}</span>{appointment.adminNotes && <p className="barber-appointment-note internal"><b>Nota del equipo:</b> {appointment.adminNotes}</p>}</div><time>{new Date(appointment.startsAt).toLocaleDateString('es-BO', { weekday: 'short', day: 'numeric', month: 'short' })} · {new Date(appointment.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</time><i className={appointment.status.toLowerCase()}>{appointmentStatusLabel[appointment.status] ?? appointment.status}</i><BarberAppointmentActions appointment={appointment} onComplete={markAsCompleted} onRequestStatus={requestStatusChange}/></article>) : <p className="barber-empty">No tienes próximas citas.</p>}</section>
    {statusChange && <BarberStatusModal change={{ ...statusChange, setReason: (reason) => setStatusChange((current) => ({ ...current, reason })) }} onClose={() => setStatusChange(null)} onConfirm={confirmStatusChange}/>} 
  </main>;
}

