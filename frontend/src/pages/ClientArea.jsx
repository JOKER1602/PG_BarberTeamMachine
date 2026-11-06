import { useEffect, useState } from 'react';
import { api, getStoredSession, logoutToHome, saveSession } from '../api.js';
import { tenantHref } from '../tenant.js';

function useAutoDismiss(message, dismiss, delay = 4500) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => dismiss(''), delay);
    return () => window.clearTimeout(timer);
  }, [message, dismiss, delay]);
}

function rescheduleUrl(appointment, bookingAppointments) {
  // Una reserva de varios servicios se reprograma completa: la disponibilidad
  // debe calcularse con la duración de todos sus servicios activos.
  const booking = bookingAppointments.filter((item) => item.status === 'CONFIRMED');
  const [first = appointment, ...rest] = booking.length ? booking : [appointment];
  const query = new URLSearchParams({ service: String(first.serviceId), barber: String(appointment.barberId), reschedule: String(first.id) });
  if (rest.length) query.set('extra', rest.map((item) => item.serviceId).join(','));
  return tenantHref(`/reservar/cita?${query.toString()}`);
}

function AppointmentDetail({ appointment, bookingAppointments = [appointment], statusLabel, onCancel, settings }) {
  const business = settings ?? { businessName: 'Empyrean Studio', address: 'Buenos Aires 130', city: 'Cochabamba', country: 'Bolivia', phone: '77469963', whatsapp: '59177469963', mapsUrl: 'https://maps.app.goo.gl/At4qrWe6P2KrDCyW9' };
  const startsAt = new Date(appointment.startsAt);
  const endsAt = new Date(appointment.endsAt);
  const dateLabel = startsAt.toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  const timeLabel = startsAt.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
  const isUpcoming = startsAt.getTime() > Date.now();
  const canCancel = isUpcoming && ['PENDING', 'CONFIRMED'].includes(appointment.status);
  const canReschedule = isUpcoming && appointment.status === 'CONFIRMED';
  const paymentWasRejected = appointment.status === 'CANCELLED' && Boolean(appointment.paymentReference);
  const bookingTotal = Number(appointment.bookingTotal ?? appointment.price ?? 0);
  const depositAmount = Number(appointment.paymentAmount ?? 0);
  const hasDeposit = Boolean(appointment.paymentReference) && depositAmount > 0;
  const remainingBalance = Math.max(bookingTotal - depositAmount, 0);
  const [review, setReview] = useState(() => ({ id: appointment.reviewId, rating: appointment.reviewRating }));
  const [reviewing, setReviewing] = useState(false);
  async function saveReview(data) {
    const result = await api.createReview(data);
    setReview({ id: result.review.id, rating: result.review.rating });
    setReviewing(false);
  }
  return <><aside className="appointment-detail">
    <div className="appointment-banner">{appointment.barberPhotoUrl ? <img className="appointment-barber-photo" src={appointment.barberPhotoUrl} alt={`Barbero ${appointment.barberName}`}/> : <span>ES</span>}<b>EMPYREAN<br/>STUDIO</b><small>{appointment.barberName}</small></div>
    <div className="appointment-detail-body">
      <p className={`appointment-status ${appointment.status.toLowerCase()}`}>{statusLabel[appointment.status] ?? appointment.status}</p>
      <h2>{dateLabel} a las {timeLabel}</h2>
      <p className="appointment-duration">◷ {Math.round((endsAt - startsAt) / 60000)} min de duración</p>
      <div className="appointment-summary-section"><h3>Resumen</h3><p><span>{appointment.serviceName}<small>Duración: {Math.round((endsAt - startsAt) / 60000)} min · Con {appointment.barberName}</small></span><b>Bs {Number(appointment.price ?? 0).toFixed(0)}</b></p><p className="appointment-total"><b>Total de la reserva</b><b>Bs {bookingTotal.toFixed(2)}</b></p>{hasDeposit && <><p className="appointment-payment-line deposit"><span>Anticipo enviado<small>{appointment.status === 'PENDING' ? 'Comprobante en revisión' : 'Anticipo confirmado'}</small></span><b>Bs {depositAmount.toFixed(2)}</b></p><p className="appointment-payment-line"><span>Saldo a cancelar en la cita</span><b>Bs {remainingBalance.toFixed(2)}</b></p></>}</div>
      <div className="appointment-policy"><h3>Más detalles</h3><b>{appointment.status === 'CANCELLED' ? 'Reserva cancelada' : appointment.status === 'PENDING' ? 'Anticipo en revisión' : isUpcoming ? 'Política de anticipo y asistencia' : 'Cita finalizada'}</b><p>{appointment.status === 'CANCELLED' ? 'Esta reserva ya no puede cancelarse ni reprogramarse.' : appointment.status === 'PENDING' ? 'Recibimos tu comprobante de anticipo. El equipo lo revisará para confirmar tu reserva.' : isUpcoming ? 'El anticipo equivale al 50 % del valor total, asegura tu horario y se descuenta del saldo a pagar el día de la atención. En caso de inasistencia, el anticipo no es reembolsable.' : 'Esta cita forma parte de tu historial y ya no puede modificarse.'}</p><div>{appointment.status === 'COMPLETED' && <>{review.id ? <p className="appointment-review-status">★ {review.rating}/5 · Reseña enviada</p> : <button className="appointment-review-button" onClick={() => setReviewing(true)}><ActionIcon name="star"/><span>Calificar experiencia</span><i>›</i></button>}<a href={tenantHref(`/reservar/cita?service=${appointment.serviceId}&barber=${appointment.barberId}&repeat=1`)}><ActionIcon name="repeat"/><span>Reservar nuevamente</span><i>›</i></a></>}{canReschedule && <a href={rescheduleUrl(appointment, bookingAppointments)}><ActionIcon name="edit"/><span>Cambiar cita</span><i>›</i></a>}{canCancel && <button onClick={() => onCancel(appointment)}><ActionIcon name="cancel"/><span>Cancelar cita</span><i>›</i></button>}</div></div>
      {paymentWasRejected && <aside className="payment-rejected-notice"><b>Tu pago no pudo ser validado</b><p>La reserva fue cancelada. Comunícate con {business.businessName} para recibir ayuda o realizar una nueva reserva.</p><a href={`tel:+591${business.phone}`}>Llamar al +591 {business.phone}</a>{business.whatsapp && <a href={`https://wa.me/${String(business.whatsapp).replace(/\D/g, '')}`} target="_blank" rel="noreferrer">Escribir por WhatsApp</a>}</aside>}
      <div className="appointment-location"><h3>Cómo llegar</h3><iframe className="map-preview" title={`Ubicación de ${business.businessName}`} src={`https://maps.google.com/maps?q=${encodeURIComponent(`${business.address}, ${business.city}, ${business.country}`)}&z=16&output=embed`} loading="lazy"/><b>{business.address}, {business.city}, {business.country}</b><a href={business.mapsUrl} target="_blank" rel="noreferrer">Cómo llegar ↗</a></div>
      <small className="appointment-reference">Referencia de reserva #{appointment.id}</small>
    </div>
  </aside>{reviewing && <ReviewModal appointment={appointment} onClose={() => setReviewing(false)} onSubmit={saveReview}/>}</>;
}

function ReviewModal({ appointment, onClose, onSubmit }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!rating) { setError('Elige una calificación de una a cinco estrellas.'); return; }
    setSaving(true); setError('');
    try { await onSubmit({ appointmentId: appointment.id, rating, comment }); }
    catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  }

  return <div className="review-modal-backdrop" role="dialog" aria-modal="true" aria-label="Calificar experiencia">
    <form className="review-modal" onSubmit={submit}>
      <button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar">×</button>
      <p className="section-label">Después de tu cita</p>
      <h2>¿Cómo fue tu experiencia?</h2>
      <p>Califica tu {appointment.serviceName.toLowerCase()} con {appointment.barberName}. Tu reseña podrá aparecer en la página de reservas.</p>
      <div className="review-star-picker" role="radiogroup" aria-label="Calificación en estrellas">
        {[1, 2, 3, 4, 5].map((star) => <button key={star} className={star <= rating ? 'active' : ''} type="button" onClick={() => setRating(star)} aria-label={`${star} estrella${star === 1 ? '' : 's'}`} aria-pressed={star === rating}>★</button>)}
      </div>
      <label>Cuéntanos un poco <small>Opcional</small><textarea maxLength="1500" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="¿Qué fue lo que más te gustó?"/></label>
      {error && <p className="review-modal-error">{error}</p>}
      <button className="client-primary" disabled={saving}>{saving ? 'Publicando...' : 'Publicar reseña'}</button>
    </form>
  </div>;
}

function CancelAppointmentModal({ appointment, onClose, onConfirm }) {
  const startsAt = new Date(appointment.startsAt);
  return <div className="cancel-modal-backdrop" role="dialog" aria-modal="true" aria-label="Cancelar cita">
    <section className="cancel-modal">
      <div className="cancel-modal-actions"><button onClick={onClose}>Volver</button><button onClick={onConfirm}>Sí, cancelar</button></div>
      <div className="cancel-modal-content">
        <p className="section-label">Gestionar cita</p>
        <h1>¿Estás seguro de que deseas cancelar?</h1>
        <article><div className="cancel-brand">ES</div><div><b>Empyrean Studio</b><span>{startsAt.toLocaleDateString('es-BO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} a las {startsAt.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</span><small>Bs {Number(appointment.price ?? 0).toFixed(0)} · {appointment.serviceName}</small></div></article>
        <p>¿No estás seguro? Ponte en contacto directamente con Empyrean Studio.</p>
        <a href="tel:+59177469963">☎ &nbsp; Llamar</a>
      </div>
    </section>
  </div>;
}

function ChangePasswordModal({ onClose, onSave }) {
  const [form, setForm] = useState({ currentPassword: '', password: '', confirmation: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event) {
    event.preventDefault(); setError('');
    if (form.password !== form.confirmation) { setError('Las contraseñas nuevas no coinciden.'); return; }
    setSaving(true);
    try { await onSave({ currentPassword: form.currentPassword, password: form.password }); onClose(); }
    catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  }
  return <div className="password-change-backdrop" role="dialog" aria-modal="true" aria-label="Cambiar contraseña"><section className="password-change-modal">
    <button className="modal-close" onClick={onClose} aria-label="Cerrar">×</button>
    <p className="section-label">Seguridad</p><h2>Cambiar contraseña</h2><p>Para proteger tu cuenta, confirma tu contraseña actual antes de guardar una nueva.</p>
    <form onSubmit={submit}><label>Contraseña actual<input type="password" required minLength="8" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}/></label><label>Nueva contraseña<input type="password" required minLength="8" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })}/></label><label>Confirmar nueva contraseña<input type="password" required minLength="8" autoComplete="new-password" value={form.confirmation} onChange={(event) => setForm({ ...form, confirmation: event.target.value })}/></label>{error && <p className="password-change-error">{error}</p>}<button className="client-primary" disabled={saving}>{saving ? 'Guardando...' : 'Actualizar contraseña'}</button></form>
  </section></div>;
}

function ProfileView({ session, profile, setProfile, onSave, onChangePassword }) {
  const [editing, setEditing] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  async function submit(event) {
    if (await onSave(event)) setEditing(false);
  }
  return <section className="profile-view">
    <p className="section-label">Perfil</p>
    <h1>Mi perfil</h1>
    <article className="profile-card-new">
      <button className="profile-edit" onClick={() => setEditing(!editing)}>{editing ? 'Cerrar edición' : 'Editar'}</button>
      <div className="profile-avatar">{`${session.firstName?.[0] ?? ''}${session.lastName?.[0] ?? ''}`}</div>
      <h2>{session.firstName} {session.lastName}</h2>
      <p className="profile-email">{session.email}</p>
      <hr/>
      {editing ? <form onSubmit={submit}>
        <label>Nombre<input required value={profile.firstName} onChange={(event) => setProfile({ ...profile, firstName: event.target.value })}/></label>
        <label>Apellido<input required value={profile.lastName} onChange={(event) => setProfile({ ...profile, lastName: event.target.value })}/></label>
        <label>Número de teléfono<div className="client-phone"><span>+591</span><input inputMode="numeric" maxLength="12" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value.replace(/[^0-9]/g, ''), whatsappConsent: false })}/></div></label>
        <label className="whatsapp-consent"><input type="checkbox" checked={profile.whatsappConsent} onChange={(event) => setProfile({ ...profile, whatsappConsent: event.target.checked })}/><span>Acepto recibir por WhatsApp un recordatorio 2 horas antes de mis citas confirmadas.</span></label>
        <label>Correo electrónico<input value={session.email} disabled/></label>
        <button className="client-primary">Guardar cambios</button>
      </form> : <>
        <section className="profile-phone-card"><b>Teléfono de contacto</b><p>{profile.phone ? `+591 ${profile.phone}` : 'Aún no registraste un número.'}</p><span>{profile.whatsappConsent ? 'Recordatorios por WhatsApp activados.' : 'Recordatorios por WhatsApp desactivados. Puedes activarlos desde Editar.'}</span></section>
        <dl className="profile-details"><div><dt>Nombre</dt><dd>{session.firstName}</dd></div><div><dt>Apellido</dt><dd>{session.lastName}</dd></div><div><dt>Número de teléfono</dt><dd>{profile.phone ? `+591 ${profile.phone}` : 'No registrado'}</dd></div><div><dt>Correo electrónico</dt><dd>{session.email}</dd></div></dl>
        <button className="profile-password-button" onClick={() => setShowPasswordModal(true)}>⌑ &nbsp; Cambiar contraseña</button>
      </>}
    </article>
    {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} onSave={onChangePassword}/>} 
  </section>;
}

function ActionIcon({ name }) {
  const paths = {
    edit: <><path d="m4 16.5-.8 3.3 3.3-.8L18 7.5l-2.6-2.6L4 16.5Z"/><path d="m13.8 6.5 2.6 2.6"/></>,
    cancel: <><circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6m0-6-6 6"/></>,
    repeat: <><path d="M19 8V4l2.7 2.7L19 9.4V8h-7a4 4 0 1 0 3.5 5.9"/><path d="M5 16v4l-2.7-2.7L5 14.6V16h7a4 4 0 1 0-3.5-5.9"/></>,
    star: <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.8-5.4 2.8 1-6.1-4.4-4.3 6.1-.9L12 3Z"/>
  };
  return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function ClientArea() {
  const [session, setSession] = useState(() => getStoredSession()?.user ?? null);
  const [settings, setSettings] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState(null);
  const [appointmentToCancel, setAppointmentToCancel] = useState(null);
  const [activeTab, setActiveTab] = useState(() => new URLSearchParams(window.location.search).get('tab') === 'perfil' ? 'perfil' : 'historial');
  const [historyView, setHistoryView] = useState('programadas');
  const [profile, setProfile] = useState(() => ({ firstName: session?.firstName ?? '', lastName: session?.lastName ?? '', phone: session?.phone?.replace(/^\+591\s?/, '') ?? '', whatsappConsent: Boolean(session?.whatsappConsent) }));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useAutoDismiss(message, setMessage);

  useEffect(() => {
    if (!session) return;
    api.appointments().then((result) => setAppointments(result.appointments)).catch((requestError) => setError(requestError.message));
  }, [session]);

  useEffect(() => { api.businessSettings().then((result) => setSettings(result.settings)).catch((requestError) => setError(requestError.message)); }, []);

  function changeTab(tab) {
    setActiveTab(tab);
    window.history.replaceState(null, '', tenantHref(`/mi-cuenta?tab=${tab}`));
  }

  async function saveProfile(event) {
    event.preventDefault();
    try {
      const result = await api.updateProfile({ ...profile, phone: profile.phone ? `+591 ${profile.phone.replace(/\D/g, '')}` : null });
      setSession(result.user);
      saveSession(result);
      setMessage('Perfil actualizado correctamente.');
      return true;
    } catch (profileError) {
      setError(profileError.message);
      return false;
    }
  }

  async function changePassword(data) {
    const result = await api.updatePassword(data);
    setMessage(result.message);
  }

  async function cancelAppointment(appointment) {
    try {
      const result = await api.cancelAppointment(appointment.id);
      const cancelledIds = new Set((result?.cancelledIds ?? [appointment.id]).map(String));
      setAppointments((items) => items.map((item) => cancelledIds.has(String(item.id)) ? { ...item, status: 'CANCELLED' } : item));
      setAppointmentToCancel(null);
      setMessage('La cita fue cancelada.');
    } catch (cancelError) {
      setError(cancelError.message);
    }
  }

  if (!session) return <main className="client-auth-empty"><h1>Inicia sesión para ver tu perfil e historial.</h1><a href={tenantHref('/reservar/cita')}>Ir a reservas</a></main>;
  const now = new Date();
  const programmed = appointments.filter((appointment) => ['PENDING', 'CONFIRMED'].includes(appointment.status) && new Date(appointment.endsAt) > now);
  const pastAppointments = appointments.filter((appointment) => !programmed.some((item) => item.id === appointment.id));
  const appointmentsByView = { programadas: programmed, historial: pastAppointments };
  const visibleAppointments = appointmentsByView[historyView];
  const selectedAppointment = visibleAppointments.find((appointment) => String(appointment.id) === String(selectedAppointmentId)) ?? visibleAppointments[0] ?? null;
  const statusLabel = { PENDING: 'Anticipo en revisión', CONFIRMED: 'Confirmada', COMPLETED: 'Atendida', CANCELLED: 'Cancelada', NO_SHOW: 'No asistió' };

  return <main className="client-area">
    <header className="client-header"><a href={tenantHref('/')}>EMPYREAN<span> STUDIO</span></a><div><span>{session.firstName} {session.lastName}</span><button onClick={logoutToHome}>Cerrar sesión</button></div></header>
    <div className="client-layout">
      <aside className="client-menu"><p>MI CUENTA</p><strong>{session.firstName} {session.lastName}</strong><button className={activeTab === 'perfil' ? 'active' : ''} onClick={() => changeTab('perfil')}>◉ &nbsp; Perfil</button><button className={activeTab === 'historial' ? 'active' : ''} onClick={() => changeTab('historial')}>◷ &nbsp; Historial</button></aside>
      <section className="client-content">
        {error && <p className="client-notice error">{error}</p>}{message && <p className="client-notice success">{message}</p>}
        {activeTab === 'perfil' && <ProfileView session={session} profile={profile} setProfile={setProfile} onSave={saveProfile} onChangePassword={changePassword}/>} 
        {activeTab === 'historial' && <div className="client-history"><p className="section-label">Mi cuenta</p><h1>Mis citas</h1><div className="history-filters"><button className={historyView === 'programadas' ? 'active' : ''} onClick={() => setHistoryView('programadas')}>Programadas <b>{programmed.length}</b></button><button className={historyView === 'historial' ? 'active' : ''} onClick={() => setHistoryView('historial')}>Historial <b>{pastAppointments.length}</b></button></div><h2>{historyView === 'programadas' ? 'Citas programadas' : 'Citas anteriores'} <span>{visibleAppointments.length}</span></h2>{appointments.length ? visibleAppointments.length ? <div className="history-grid"><div className="history-list">{visibleAppointments.map((appointment) => <button className={selectedAppointment?.id === appointment.id ? 'active' : ''} key={appointment.id} onClick={() => setSelectedAppointmentId(appointment.id)}><b>{appointment.serviceName}</b><span>{new Date(appointment.startsAt).toLocaleDateString('es-BO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · {new Date(appointment.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</span><small>Con {appointment.barberName} · {statusLabel[appointment.status]}</small></button>)}</div>{selectedAppointment && <AppointmentDetail appointment={selectedAppointment} bookingAppointments={selectedAppointment.paymentReference ? appointments.filter((item) => item.paymentReference === selectedAppointment.paymentReference).sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt)) : [selectedAppointment]} statusLabel={statusLabel} onCancel={setAppointmentToCancel} settings={settings}/>}</div> : <div className="history-empty"><b>◷</b><h2>No hay citas en este apartado.</h2><p>{historyView === 'programadas' ? 'Tus reservas pendientes de pago o confirmadas aparecerán aquí.' : 'Aquí verás tus citas finalizadas, atendidas, canceladas o no asistidas.'}</p></div> : <div className="history-empty"><b>◷</b><h2>Aún no tienes citas.</h2><p>Cuando confirmes una reserva aparecerá aquí.</p><a href={tenantHref('/reservar')}>Reservar una cita</a></div>}</div>}
      </section>
    </div>
    {appointmentToCancel && <CancelAppointmentModal appointment={appointmentToCancel} onClose={() => setAppointmentToCancel(null)} onConfirm={() => cancelAppointment(appointmentToCancel)}/>} 
  </main>;
}

