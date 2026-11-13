import { useEffect, useState } from 'react';
import { api, clearSession, getStoredSession, saveSession } from '../api.js';
import { brandWords, passwordRecoveryHref, tenantBrand, tenantHref } from '../tenant.js';
import BrandMark from '../components/BrandMark.jsx';
import { bolivianPhonePattern, cleanBolivianPhone } from '../phone.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const namePattern = /^[\p{L}]+(?:[ '\-][\p{L}]+)*$/u;
// Celular boliviano: el servidor lo exige al crear la cuenta.
const phonePattern = bolivianPhonePattern;

function cleanName(value) {
  return value.replace(/[^\p{L}\s'-]/gu, '').replace(/\s+/g, ' ').replace(/^\s/, '');
}

function fieldStatus(value, valid) {
  return !value ? 'neutral' : valid ? 'valid' : 'invalid';
}

function ReservationAuthField({ label, status, helper, action, children }) {
  return <label className={`registration-field ${status}`}><span>{label}</span><span className="registration-control">{children}{action}{status !== 'neutral' && <i aria-hidden="true">{status === 'valid' ? '✓' : '!'}</i>}</span>{helper && <small>{helper}</small>}</label>;
}

function normalizedBolivianPhone(value) {
  return String(value ?? '').replace(/\D/g, '').replace(/^591/, '');
}

function hasValidBolivianPhone(value) {
  return /^[67]\d{7}$/.test(normalizedBolivianPhone(value));
}

function useAutoDismiss(message, dismiss, delay = 4500) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => dismiss(''), delay);
    return () => window.clearTimeout(timer);
  }, [message, dismiss, delay]);
}

export default function ReservationWizard() {
  const reservationParams = new URLSearchParams(window.location.search);
  const selectedFromUrl = reservationParams.get('service') ?? '';
  const rescheduleId = reservationParams.get('reschedule');
  const repeatBooking = reservationParams.get('repeat') === '1';
  const sessionExpired = reservationParams.get('session') === 'expired';
  const directAccountAccess = reservationParams.get('login') === '1';
  const initialBarberId = reservationParams.get('barber') ?? '';
  const suggestedSlotStart = reservationParams.get('slot');
  const initialBookingDate = reservationParams.get('date') ?? new Date().toLocaleDateString('en-CA');
  const [services, setServices] = useState([]);
  const [barbers, setBarbers] = useState([]);
  const [settings, setSettings] = useState(null);
  const [session, setSession] = useState(() => getStoredSession()?.user ?? null);
  const [serviceId, setServiceId] = useState(selectedFromUrl);
  // Al reprogramar una reserva de varios servicios llegan los servicios
  // adicionales para buscar horarios con la duración total de la reserva.
  const [extraServiceIds, setExtraServiceIds] = useState(() => (reservationParams.get('extra') ?? '').split(',').filter((value) => /^\d+$/.test(value)));
  const [step, setStep] = useState(initialBarberId ? 2 : 1);
  const [selection, setSelection] = useState({ barberId: initialBarberId, date: initialBarberId ? initialBookingDate : '' });
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(suggestedSlotStart ? { startsAt: suggestedSlotStart } : null);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ email: '', password: '', firstName: '', lastName: '', phone: '' });
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [authSubmitted, setAuthSubmitted] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(sessionExpired ? 'Tu sesión expiró. Inicia sesión nuevamente para continuar.' : '');
  const [showProfessionalModal, setShowProfessionalModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(reservationParams.get('login') === '1');
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [professionalQuery, setProfessionalQuery] = useState('');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [serviceQuery, setServiceQuery] = useState('');
  const [paymentProofFile, setPaymentProofFile] = useState(null);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [recommendations, setRecommendations] = useState({ serviceSuggestions: [], timeSuggestions: [], basedOnHistory: false });
  const [barberReviews, setBarberReviews] = useState({ summary: { total: 0, average: 0 }, reviews: [] });
  useAutoDismiss(notice, setNotice);

  useEffect(() => {
    Promise.all([api.services(), api.barbers(), api.businessSettings()])
      .then(([serviceResult, barberResult, settingsResult]) => {
        setServices(serviceResult.services);
        setBarbers(barberResult.barbers);
        setSettings(settingsResult.settings);
      })
      .catch((requestError) => setError(requestError.message));
  }, []);

  useEffect(() => { let active = true; api.me().then((result) => { if (active) { saveSession(result); setSession(result.user); } }).catch(() => { if (active) setSession(null); }); return () => { active = false; }; }, []);

  const selectedServiceIds = [serviceId, ...extraServiceIds].filter(Boolean).map(String);
  const selectedServices = services.filter((service) => selectedServiceIds.includes(String(service.id)));
  const selectedService = selectedServices[0];
  const selectedBarber = barbers.find((barber) => String(barber.id) === String(selection.barberId));
  const totalPrice = selectedServices.reduce((total, service) => total + Number(service.price), 0);
  const depositAmount = totalPrice / 2;
  const remainingBalance = totalPrice - depositAmount;
  const totalDuration = selectedServices.reduce((total, service) => total + service.durationMinutes, 0);
  const filteredBarbers = barbers.filter((barber) => {
    const profile = `${barber.displayName} ${barber.services || ''}`.toLowerCase();
    return selectedServices.every((service) => profile.includes(service.name.toLowerCase())) && profile.includes(professionalQuery.trim().toLowerCase());
  });
  const visibleServices = services.filter((service) => {
    const categoryMatches = serviceFilter === 'all' || service.categorySlug === serviceFilter;
    return categoryMatches && service.name.toLowerCase().includes(serviceQuery.trim().toLowerCase());
  });
  const serviceCategories = [...new Map(services.filter((service) => service.categorySlug).map((service) => [service.categorySlug, { slug: service.categorySlug, name: service.categoryName }])).values()];
  const authChecks = {
    email: emailPattern.test(authForm.email),
    firstName: namePattern.test(authForm.firstName.trim()),
    lastName: namePattern.test(authForm.lastName.trim()),
    phone: phonePattern.test(authForm.phone),
    passwordLength: authForm.password.length >= 8,
    passwordLower: /[a-z]/.test(authForm.password),
    passwordUpper: /[A-Z]/.test(authForm.password),
    passwordNumber: /\d/.test(authForm.password)
  };
  const newPasswordIsValid = authChecks.passwordLength && authChecks.passwordLower && authChecks.passwordUpper && authChecks.passwordNumber;
  const authIsValid = authMode === 'login'
    ? authChecks.email && Boolean(authForm.password)
    : authChecks.email && authChecks.firstName && authChecks.lastName && authChecks.phone && newPasswordIsValid;
  const bookingDates = Array.from({ length: 14 }, (_, index) => {
    const value = new Date();
    value.setDate(value.getDate() + index);
    return value.toLocaleDateString('en-CA');
  });

  useEffect(() => {
    if (!selectedBarber?.id) {
      setBarberReviews({ summary: { total: 0, average: 0 }, reviews: [] });
      return undefined;
    }
    let current = true;
    api.reviews(selectedBarber.id)
      .then((result) => { if (current) setBarberReviews(result); })
      .catch(() => { if (current) setBarberReviews({ summary: { total: 0, average: 0 }, reviews: [] }); });
    return () => { current = false; };
  }, [selectedBarber?.id]);

  useEffect(() => {
    if (!session) {
      setRecommendations({ serviceSuggestions: [], timeSuggestions: [], basedOnHistory: false });
      return undefined;
    }
    let current = true;
    api.recommendations(selectedServiceIds)
      .then((result) => { if (current) setRecommendations(result); })
      .catch(() => { if (current) setRecommendations({ serviceSuggestions: [], timeSuggestions: [], basedOnHistory: false }); });
    return () => { current = false; };
  }, [session?.id, selectedServiceIds.join(',')]);
  function toggleService(id) {
    const value = String(id);
    setSelectedSlot(null);
    if (selectedServiceIds.includes(value)) {
      if (String(serviceId) === value) {
        const [next, ...remaining] = extraServiceIds;
        setServiceId(next ?? '');
        setExtraServiceIds(remaining);
      } else {
        setExtraServiceIds((items) => items.filter((item) => String(item) !== value));
      }
    } else if (!serviceId) {
      setServiceId(value);
    } else {
      setExtraServiceIds((items) => [...items, value]);
    }
  }

  function chooseProfessional(barberId) {
    setSelectedSlot(null);
    setSelection({ ...selection, barberId: String(barberId), date: selection.date || bookingDates[0] });
    setShowProfessionalModal(false);
    setStep(2);
  }

  function chooseRandomProfessional() {
    const randomBarber = filteredBarbers[Math.floor(Math.random() * filteredBarbers.length)];
    if (randomBarber) chooseProfessional(randomBarber.id);
  }

  function chooseSuggestedTime(suggestion) {
    setSelectedSlot({ startsAt: suggestion.startsAt, endsAt: suggestion.endsAt });
    setSelection({ barberId: String(suggestion.barberId), date: new Date(suggestion.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' }) });
    setStep(2);
  }

  async function authenticate(event) {
    event.preventDefault();
    setAuthSubmitted(true);
    if (!authIsValid) {
      setError('Revisa los campos marcados para continuar.');
      return;
    }
    setError('');
    try {
      const result = authMode === 'login'
        ? await api.login({ email: authForm.email, password: authForm.password })
        : await api.register(authForm);
      saveSession(result);
      setSession(result.user);
      if (directAccountAccess) {
        window.location.assign(tenantHref('/mi-cuenta?tab=historial'));
        return;
      }
      setShowAuthModal(false);
      const savedPhone = normalizedBolivianPhone(result.user.phone);
      const needsPhone = !hasValidBolivianPhone(result.user.phone);
      setPhoneInput(savedPhone);
      setShowPhoneModal(needsPhone);
      if (needsPhone) {
        setNotice('Sesión iniciada. Añade tu teléfono para continuar.');
      } else {
        setStep(3);
        setNotice('Sesión iniciada. Revisa y confirma tu cita.');
      }
    } catch (authError) {
      setError(authError.message);
    }
  }

  function beginCheckout() {
    setError('');
    if (session) {
      const savedPhone = normalizedBolivianPhone(session.phone);
      setPhoneInput(savedPhone);
      if (hasValidBolivianPhone(session.phone)) {
        setStep(3);
      } else {
        setShowPhoneModal(true);
      }
      return;
    }
    setShowAuthModal(true);
  }

  async function savePhone(event) {
    event.preventDefault();
    const phone = phoneInput.replace(/\D/g, '');
    if (phone.length < 8 || phone.length > 12) {
      setError('Ingresa un número de teléfono válido.');
      return;
    }
    try {
      const result = await api.updateProfile({ firstName: session.firstName, lastName: session.lastName, phone: `+591 ${phone}` });
      setSession(result.user);
      saveSession(result);
      setShowPhoneModal(false);
      setStep(3);
      setNotice('Teléfono guardado. Revisa los datos antes de confirmar tu cita.');
    } catch (profileError) {
      if (/token|sesión|autoriz/i.test(profileError.message)) {
        clearSession();
        setSession(null);
        setShowPhoneModal(false);
        setShowAuthModal(true);
      } else {
        setError(profileError.message);
      }
    }
  }

  async function getSlots({ preserveSelection = false } = {}) {
    try {
      const nextSlots = (await api.availability(selection.barberId, selectedServiceIds, selection.date)).slots;
      setSlots(nextSlots);
      setSelectedSlot((current) => preserveSelection && current ? nextSlots.find((slot) => slot.startsAt === current.startsAt) ?? null : null);
    } catch (availabilityError) {
      setError(availabilityError.message);
    }
  }

  async function reserve() {
    if (!selectedSlot) return;
    if (!paymentProofFile) { setError('Sube el comprobante de pago para enviar la reserva.'); return; }
    try {
      setSubmittingPayment(true);
      const { proofId } = await api.uploadPaymentProof(paymentProofFile);
      await api.createAppointments({ barberId: selection.barberId, serviceIds: selectedServiceIds, startsAt: selectedSlot.startsAt, paymentProofId: proofId });
      window.location.assign(tenantHref('/mi-cuenta?tab=historial'));
    } catch (reservationError) {
      if (/token|sesión|autoriz/i.test(reservationError.message)) {
        clearSession();
        setSession(null);
        setError('');
        setShowAuthModal(true);
      } else {
        setError(reservationError.message);
      }
    } finally { setSubmittingPayment(false); }
  }

  async function continueWithSelectedTime() {
    if (!selectedSlot) return;
    if (!rescheduleId) {
      beginCheckout();
      return;
    }
    try {
      await api.rescheduleAppointment(rescheduleId, selectedSlot.startsAt);
      window.location.assign(tenantHref('/mi-cuenta?tab=historial'));
    } catch (rescheduleError) {
      setError(rescheduleError.message);
    }
  }

  useEffect(() => {
    if (step === 2 && selection.barberId && selection.date && selectedServiceIds.length) getSlots({ preserveSelection: Boolean(selectedSlot) });
  }, [step, selection.barberId, selection.date, selectedServiceIds.join(',')]);

  useEffect(() => {
    if (step !== 2 || !selection.barberId || !selection.date || !selectedServiceIds.length) return undefined;
    const refreshAvailability = () => getSlots({ preserveSelection: true });
    const timer = window.setInterval(refreshAvailability, 15000);
    window.addEventListener('focus', refreshAvailability);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refreshAvailability); };
  }, [step, selection.barberId, selection.date, selectedServiceIds.join(',')]);

  return <main className="reservation-wizard">
    {step !== 4 && <header className="wizard-header">
      <a href={tenantHref('/reservar')} aria-label="Volver a servicios" title="Volver a servicios"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg></a>
      <a className="wizard-logo" href={tenantHref('/')}><BrandMark/></a>
      <nav className="wizard-steps" aria-label="Progreso de la reserva">
        <span className={step >= 1 ? 'active' : ''}><b>1</b><em>Servicios</em></span><i aria-hidden="true"/>
        <span className={step >= 2 ? 'active' : ''}><b>2</b><em>Detalles</em></span><i aria-hidden="true"/>
        <span className={step >= 3 ? 'active' : ''}><b>3</b><em>Confirma</em></span>
      </nav>
    </header>}
    {error && <p className="wizard-notice error">{error}</p>}
    {notice && <p className="wizard-notice success wizard-feedback" role="status" aria-live="polite"><span aria-hidden="true">✓</span>{notice}</p>}

    {step === 1 && <section className="wizard-content">
      <div className="wizard-selection">
        <h1>Seleccionar servicios</h1>
        <label className="service-search">⌕<input value={serviceQuery} placeholder="Buscar servicios..." onChange={(event) => setServiceQuery(event.target.value)}/></label>
        <div className="service-filters">
          <button className={serviceFilter === 'all' ? 'active' : ''} onClick={() => setServiceFilter('all')}>Todos los servicios <b>{services.length}</b></button>
          {serviceCategories.map((category) => <button key={category.slug} className={serviceFilter === category.slug ? 'active' : ''} onClick={() => setServiceFilter(category.slug)}>{category.name}</button>)}
        </div>
        <div className="wizard-service-list">
          {visibleServices.length ? visibleServices.map((service) => <article className={selectedServiceIds.includes(String(service.id)) ? 'chosen' : ''} key={service.id}>
            <div className="wizard-service-art">{service.name.slice(0, 1)}</div>
            <div><h2>{service.name}</h2><p>{service.description || 'Servicio personalizado para cuidar tu estilo.'}</p><small>◷ &nbsp;{service.durationMinutes} min</small></div>
            <strong>Bs {Number(service.price).toFixed(0)}</strong>
            {selectedServiceIds.includes(String(service.id)) ? <button className="remove-service" onClick={() => toggleService(service.id)}>− Quitar</button> : <button className="add-service" onClick={() => toggleService(service.id)}>＋ Añadir</button>}
          </article>) : <p className="empty-state">No hay servicios en esta categoría.</p>}
        </div>
        {session && recommendations.serviceSuggestions.length > 0 && <section className="recommendation-panel">
          <div><p className="section-label">Para ti</p><h2>Servicios recomendados</h2><span>{recommendations.basedOnHistory ? 'Basados en tus citas atendidas.' : 'Opciones populares mientras creas tu historial.'}</span></div>
          <div className="recommendation-services">{recommendations.serviceSuggestions.map((service) => <button key={service.id} type="button" onClick={() => toggleService(service.id)}><b>{service.name}</b><small>{service.reason} · {service.durationMinutes} min · Bs {Number(service.price).toFixed(0)}</small><i>{selectedServiceIds.includes(String(service.id)) ? '✓ Añadido' : '+ Añadir'}</i></button>)}</div>
        </section>}
      </div>
      <aside className="wizard-summary">
        <h2>Resumen</h2>
        {selectedServices.length ? <div className="summary-services">{selectedServices.map((service) => <div className="summary-service" key={service.id}><div className="wizard-service-art">{service.name.slice(0, 1)}</div><div><b>{service.name}</b><span>◷ &nbsp;{service.durationMinutes} min</span></div><strong>Bs {Number(service.price).toFixed(0)}</strong></div>)}</div> : <p>Elige uno o más servicios para continuar.</p>}
        <div className="summary-total"><span>Total · {totalDuration} min</span><b>Bs {totalPrice.toFixed(0)}</b></div>
        <button className="wizard-primary" disabled={!selectedServices.length} onClick={() => setShowProfessionalModal(true)}>Continuar</button>
        <small>Todos los servicios se reservarán de forma consecutiva al elegir un horario.</small>
      </aside>
    </section>}

    {step === 2 && <section className="wizard-content wizard-details">
      <aside className="wizard-professional-card">
        <p className="professional-card-label">Profesional seleccionado</p>
        <button className="professional-card-person" onClick={() => setShowProfessionalModal(true)} aria-label="Cambiar profesional">
          {selectedBarber?.photoUrl ? <img src={selectedBarber.photoUrl} alt={selectedBarber.displayName}/> : <b>{selectedBarber?.displayName.slice(0, 1)}</b>}
          <span className="professional-online" aria-hidden="true"/>
        </button>
        <strong>{selectedBarber?.displayName}</strong>
        <span className="professional-card-role">Barbero profesional</span>
        <button className="professional-change" onClick={() => setShowProfessionalModal(true)}>Cambiar profesional <i>⌄</i></button>
        <div className="professional-card-divider"/>
        <section className="professional-card-about">
          <b>Especialidad</b>
          <p>{selectedBarber?.bio || selectedBarber?.services || 'Atención personalizada para cuidar tu estilo.'}</p>
        </section>
        <section className="professional-card-reviews" aria-label={`Reseñas de ${selectedBarber?.displayName ?? 'este profesional'}`}>
          <div><b>Reseñas verificadas</b><span>{Number(barberReviews.summary?.total ?? 0) ? `★ ${Number(barberReviews.summary.average).toFixed(1)} · ${barberReviews.summary.total}` : 'Aún sin reseñas'}</span></div>
          {barberReviews.reviews?.length ? <ul>{barberReviews.reviews.slice(0, 2).map((review) => <li key={review.id}><span>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span>{review.comment ? <p>“{review.comment}”</p> : <small>{review.clientName} calificó su atención.</small>}</li>)}</ul> : <p className="professional-card-no-reviews">Las opiniones de clientes aparecerán aquí después de citas atendidas.</p>}
        </section>
        <p className="professional-card-note">Tu profesional atenderá los servicios seleccionados de manera consecutiva.</p>
      </aside>
      <div className="wizard-selection wizard-availability-stage">
        <div className="availability-heading"><span aria-hidden="true">▣</span><div><h1>{rescheduleId ? 'Cambiar fecha y hora' : repeatBooking ? 'Reservar nuevamente' : 'Horarios disponibles'}</h1><p>{rescheduleId ? 'Elige un nuevo día y horario para tu cita.' : repeatBooking ? `Reutilizamos ${selectedService?.name ?? 'tu servicio'} con ${selectedBarber?.displayName ?? 'tu profesional'}.` : `${selectedServices.length} servicio(s) · ${totalDuration} min en total`}</p></div></div>
        <div className="availability-panel">
          <div className="availability-section-heading"><span aria-hidden="true">▣</span><h2>Elige un día</h2></div>
          <div className="date-picker" role="group" aria-label="Selecciona una fecha">{bookingDates.map((date) => {
            const view = new Date(`${date}T12:00:00`);
            return <button type="button" className={selection.date === date ? 'active' : ''} key={date} aria-pressed={selection.date === date} aria-label={view.toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} onClick={() => { setSelectedSlot(null); setSelection({ ...selection, date }); }}><small>{view.toLocaleDateString('es-BO', { weekday: 'short' })}</small><b>{view.getDate()}</b><span>{view.toLocaleDateString('es-BO', { month: 'short' })}</span></button>;
          })}</div>
          <div className="availability-section-heading slot-heading"><span aria-hidden="true">◷</span><h2>Selecciona un horario</h2><p>{selection.date && new Date(`${selection.date}T12:00:00`).toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
          <div className="wizard-slots">{slots.length ? slots.map((slot) => <button className={selectedSlot?.startsAt === slot.startsAt ? 'selected' : ''} key={slot.startsAt} onClick={() => setSelectedSlot(slot)}>{new Date(slot.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</button>) : <p className="empty-state">No hay horarios disponibles para este día. Elige otra fecha.</p>}</div>
        </div>
        {session && recommendations.timeSuggestions.length > 0 && <section className="recommendation-panel time-recommendations">
          <div><p className="section-label">Disponibilidad inteligente</p><h2>Horarios sugeridos</h2><span>{recommendations.basedOnHistory ? 'Priorizados según tu historial y la agenda real.' : 'Las primeras opciones disponibles para tus servicios.'}</span></div>
          <div className="recommendation-times">{recommendations.timeSuggestions.map((suggestion) => <button key={`${suggestion.barberId}-${suggestion.startsAt}`} type="button" onClick={() => chooseSuggestedTime(suggestion)}><b>{new Date(suggestion.startsAt).toLocaleDateString('es-BO', { weekday: 'short', day: 'numeric', month: 'short' })} · {new Date(suggestion.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</b><small>{suggestion.barberName} · {suggestion.reason}</small></button>)}</div>
        </section>}
      </div>
      <div className="wizard-summary-column">
      <aside className="wizard-summary">
        <h2>Resumen</h2>
        {selectedServices.map((service) => <div className="summary-service" key={service.id}><div className="wizard-service-art">{service.name.slice(0, 1)}</div><div><b>{service.name}</b><span>◷ &nbsp;{service.durationMinutes} min</span></div><strong>Bs {Number(service.price).toFixed(0)}</strong></div>)}
        {selectedSlot && <p className="summary-selected-time">Horario elegido: <b>{new Date(selectedSlot.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</b></p>}
        <div className="summary-total"><span>Total · {totalDuration} min</span><b>Bs {totalPrice.toFixed(0)}</b></div>
        {selectedSlot ? <button className="wizard-primary" onClick={continueWithSelectedTime}>{rescheduleId ? 'Guardar nuevo horario' : 'Continuar'}</button> : <small>Selecciona un horario para continuar.</small>}
      </aside>
      <section className="wizard-trust-panel" aria-label={`Información de ${tenantBrand().name}`}><div className="wizard-trust-highlight"><span aria-hidden="true">✦</span><p>Vive la experiencia<br/><b>{brandWords().first} <i>{brandWords().rest}</i></b></p><small>Tu cita queda organizada con disponibilidad real y atención profesional.</small></div><div className="wizard-trust-stats"><span><b>▣</b>Citas<br/>confiables</span><span><b>◇</b>Profesionales<br/>certificados</span><span><b>☆</b>Ambiente<br/>premium</span></div></section>
      </div>
    </section>}

    {step === 3 && <section className="checkout-stage">
      <div className="checkout-main">
        <p className="checkout-crumbs">Servicios &nbsp;›&nbsp; Profesional &nbsp;›&nbsp; Hora &nbsp;›&nbsp; <b>Confirmar</b></p>
        <h1>Revisar y confirmar</h1>
        <h2>Anticipo por QR</h2>
        <article className="checkout-card payment-checkout-card"><b>Realiza el anticipo exacto de Bs {depositAmount.toFixed(2)}</b><p>El anticipo corresponde al 50 % del total de tu reserva. Escanea el QR, realiza el pago y sube una captura o foto de tu comprobante. La reserva quedará pendiente hasta que el equipo lo revise.</p>{settings?.paymentQrUrl ? <img className="payment-qr-image" src={settings.paymentQrUrl} alt="Código QR para pago"/> : <p className="payment-qr-missing">El QR de pagos aún no fue configurado. Comunícate con la barbería.</p>}<label className="payment-proof-input">Comprobante del anticipo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPaymentProofFile(event.target.files?.[0] ?? null)}/><small>{paymentProofFile ? `${paymentProofFile.name} listo para enviar` : 'JPG, PNG o WEBP · máximo 5 MB'}</small></label></article>
        <h2>Más detalles</h2>
        <article className="checkout-card"><b>Política de anticipo y asistencia</b><p>Para confirmar tu reserva se requiere un anticipo equivalente al 50 % del valor total. Este importe asegura el horario seleccionado y se descuenta del saldo a pagar el día de tu atención. En caso de inasistencia, el anticipo no es reembolsable.</p></article>
      </div>
      <aside className="checkout-summary">
        <h2>{tenantBrand().name}{tenantBrand().city ? ` · ${tenantBrand().city}` : ''}</h2>
        <p>📅 {selection.date && new Date(`${selection.date}T12:00:00`).toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <p>◷ {selectedSlot && new Date(selectedSlot.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })} · {totalDuration} min</p>
        <hr/>
        {selectedServices.map((service) => <p className="checkout-item" key={service.id}><span>{service.name}<small>Con {selectedBarber?.displayName}</small></span><b>Bs {Number(service.price).toFixed(0)}</b></p>)}
        <p className="checkout-total"><b>Total del servicio</b><b>Bs {totalPrice.toFixed(2)}</b></p>
        <p className="checkout-deposit"><span>Anticipo para confirmar (50 %)</span><b>Bs {depositAmount.toFixed(2)}</b></p>
        <p className="checkout-balance"><span>Saldo el día de la cita</span><b>Bs {remainingBalance.toFixed(2)}</b></p>
        <button className="checkout-primary" disabled={!settings?.paymentQrUrl || !paymentProofFile || submittingPayment} onClick={reserve}>{submittingPayment ? 'Enviando comprobante...' : 'Enviar anticipo y reservar'}</button>
      </aside>
    </section>}

    {step === 4 && <section className="appointment-confirmed"><div><span>✓</span><h1>Cita confirmada</h1><p>Te esperamos en {tenantBrand().name}.</p><a href={tenantHref('/reservar')}>Volver a la barbería</a></div></section>}

    {showProfessionalModal && <div className="professional-modal-backdrop" role="dialog" aria-modal="true" aria-label="Elegir profesional">
      <section className="professional-modal">
        <button className="modal-close" onClick={() => setShowProfessionalModal(false)} aria-label="Cerrar">×</button>
        <p>Elige tu profesional</p>
        <h1>{selectedServices.length > 1 ? `${selectedServices.length} servicios seleccionados` : selectedService?.name}</h1>
        <label className="service-search">⌕<input value={professionalQuery} onChange={(event) => setProfessionalQuery(event.target.value)} placeholder="Buscar por nombre o especialidad..."/></label>
        <h2>Elige una opción</h2>
        <div className="professional-list">
          {filteredBarbers.length > 0 && <button className="random-professional" onClick={chooseRandomProfessional}><b>✦</b><strong>Cualquier profesional</strong><span>Te asignamos uno al azar entre los disponibles</span><i>Elegir esta opción</i></button>}
          {filteredBarbers.map((barber) => <button key={barber.id} onClick={() => chooseProfessional(barber.id)}>{barber.photoUrl ? <img className="barber-avatar-photo" src={barber.photoUrl} alt=""/> : <b>{barber.displayName.slice(0, 1)}</b>}<strong>{barber.displayName}</strong><span>{barber.services || 'Barbero'}</span><i>★ Profesional {tenantBrand().name}</i></button>)}
          {!filteredBarbers.length && <span className="empty-state">No hay profesionales que realicen todos los servicios seleccionados.</span>}
        </div>
        <footer>Los profesionales mostrados están habilitados para atender las reservas de {tenantBrand().name}.</footer>
      </section>
    </div>}

    {showAuthModal && <div className="auth-modal-backdrop" role="dialog" aria-modal="true" aria-label="Iniciar sesión o registrarse">
      <section className="auth-modal">
        <button className="modal-close" onClick={() => setShowAuthModal(false)} aria-label="Cerrar">×</button>
        <p className="section-label">Reserva</p>
        <h1>Inicia sesión o regístrate para reservar</h1>
        <p>Para continuar, verificaremos que eres tú.</p>
        <form className="reservation-auth-form" noValidate onSubmit={authenticate}>
          {authMode === 'register' && <><ReservationAuthField label="Nombre" status={fieldStatus(authForm.firstName, authChecks.firstName)} helper={authForm.firstName && !authChecks.firstName ? 'Usa solo letras.' : ''}><input type="text" required autoComplete="given-name" value={authForm.firstName} onChange={(event) => { setAuthForm({ ...authForm, firstName: cleanName(event.target.value) }); setError(''); }}/></ReservationAuthField><ReservationAuthField label="Apellido" status={fieldStatus(authForm.lastName, authChecks.lastName)} helper={authForm.lastName && !authChecks.lastName ? 'Usa solo letras.' : ''}><input type="text" required autoComplete="family-name" value={authForm.lastName} onChange={(event) => { setAuthForm({ ...authForm, lastName: cleanName(event.target.value) }); setError(''); }}/></ReservationAuthField><ReservationAuthField label="Celular" status={fieldStatus(authForm.phone, authChecks.phone)} helper={authForm.phone && !authChecks.phone ? 'Celular boliviano de 8 dígitos que empiece con 6 o 7.' : 'Para avisarte sobre tu reserva.'}><input type="tel" required inputMode="numeric" autoComplete="tel" placeholder="Ej.: 71234567" value={authForm.phone} onChange={(event) => { setAuthForm({ ...authForm, phone: cleanBolivianPhone(event.target.value) }); setError(''); }}/></ReservationAuthField></>}
          <ReservationAuthField label="Correo electrónico" status={authSubmitted && !authForm.email ? 'invalid' : fieldStatus(authForm.email, authChecks.email)} helper={authSubmitted && !authForm.email ? 'Ingresa tu correo electrónico.' : authForm.email && !authForm.email.includes('@') ? 'Falta el símbolo @ en tu correo.' : authForm.email && !authChecks.email ? 'Ingresa un correo válido.' : ''}><input type="email" required autoComplete="email" placeholder="usuario@ejemplo.com" value={authForm.email} onChange={(event) => { setAuthForm({ ...authForm, email: event.target.value.replace(/\s/g, '') }); setError(''); }}/></ReservationAuthField>
          <ReservationAuthField label="Contraseña" status={authMode === 'login' ? (authSubmitted && !authForm.password ? 'invalid' : 'neutral') : fieldStatus(authForm.password, newPasswordIsValid)} helper={authMode === 'login' ? (authSubmitted && !authForm.password ? 'Ingresa tu contraseña.' : '') : 'Usa mayúscula, minúscula, número y 8 caracteres o más.'} action={<button className="wizard-password-toggle" type="button" onClick={() => setShowAuthPassword((visible) => !visible)} aria-label={showAuthPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} title={showAuthPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2.5 12s3.4-5.5 9.5-5.5S21.5 12 21.5 12s-3.4 5.5-9.5 5.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.6"/>{showAuthPassword && <path d="M4 4l16 16"/>}</svg></button>}><input type={showAuthPassword ? 'text' : 'password'} required autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={authForm.password} onChange={(event) => { setAuthForm({ ...authForm, password: event.target.value }); setError(''); }}/></ReservationAuthField>
          {authMode === 'register' && <ul className="password-checklist" aria-label="Requisitos de contraseña"><li className={authChecks.passwordLength ? 'valid' : ''}>8 caracteres o más</li><li className={authChecks.passwordUpper ? 'valid' : ''}>Una mayúscula</li><li className={authChecks.passwordLower ? 'valid' : ''}>Una minúscula</li><li className={authChecks.passwordNumber ? 'valid' : ''}>Un número</li></ul>}
          {error && <p className="reservation-auth-error">{error}</p>}
          <button className="wizard-primary">{authMode === 'login' ? 'Continuar' : 'Crear cuenta'}</button>
        </form>
        {authMode === 'login' && <a className="forgot-password-link" href={passwordRecoveryHref()}>¿Olvidaste tu contraseña?</a>}
        <button type="button" className="text-button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthSubmitted(false); setError(''); }}>{authMode === 'login' ? 'Crear una cuenta' : 'Ya tengo una cuenta'}</button>
      </section>
    </div>}

    {showPhoneModal && <div className="auth-modal-backdrop" role="dialog" aria-modal="true" aria-label="Añadir teléfono">
      <section className="auth-modal phone-modal">
        <button className="modal-close" onClick={() => setShowPhoneModal(false)} aria-label="Cerrar">×</button>
        <h1>Añadir teléfono</h1>
        <p>Introduce tu número de teléfono para confirmar la cita.</p>
        <form onSubmit={savePhone}>
          <label>Número de teléfono<div className="phone-field"><span>+591</span><input type="tel" inputMode="numeric" minLength="8" required autoFocus value={phoneInput} onChange={(event) => { setPhoneInput(cleanBolivianPhone(event.target.value)); }}/></div></label>
          <button className="wizard-primary">Continuar</button>
        </form>
      </section>
    </div>}
  </main>;
}

