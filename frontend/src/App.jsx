import { useEffect, useState } from 'react';
import { api, clearSession, saveSession } from './api.js';

const weekdays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function Landing({ servicesCount, barbersCount, onReserve }) {
  useEffect(() => {
    const items = document.querySelectorAll('.reveal-on-scroll');
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add('reveal-visible'); observer.unobserve(entry.target); }
    }), { threshold: 0.14 });
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);
  return <>
    <a className="public-admin-access" href="/admin">Acceso del equipo</a>
    <nav className="home-nav" aria-label="Navegación principal"><div><a className="brand-mark" href="#inicio">BTM<span>.</span></a><div className="home-nav-links"><a href="#nosotros">Nosotros</a><a href="#servicios">Servicios</a><a href="#ubicacion">Ubicación</a><a href="#reservas">Reservar</a></div></div></nav>
    <section className="landing-hero" id="inicio">
      <div className="hero-copy"><p className="hero-kicker">Barbería · Cochabamba</p><h1>PRECISIÓN<br/>PARA TU<br/><em>MEJOR ESTILO.</em></h1><p>Todo lo que necesitas para salir con una imagen cuidada: corte, barba y cejas, atendidos con técnica y atención al detalle.</p><div className="hero-actions"><button className="hero-cta" onClick={onReserve}>Reserva tu cita <span>↗</span></button><a className="secondary-home-cta" href="#nosotros">Conócenos ↓</a></div></div>
      <div className="hero-side"><div><strong>{servicesCount || '—'}</strong><span>Servicios</span></div><i/><div><strong>{barbersCount || '—'}</strong><span>Barberos</span></div><i/><div><strong>6/7</strong><span>Días abiertos</span></div></div>
      <div className="hero-meta"><span>BTM / Cochabamba</span><span>Desliza para descubrir ↓</span></div>
    </section>
    <div className="service-ticker reveal-on-scroll" aria-label="Servicios"><div className="ticker-track"><span>Corte normal <b>•</b> Perfilado de barba <b>•</b> Perfilado de cejas <b>•</b> Atención personalizada <b>•</b></span><span aria-hidden="true">Corte normal <b>•</b> Perfilado de barba <b>•</b> Perfilado de cejas <b>•</b> Atención personalizada <b>•</b></span></div></div>
    <section className="manifesto-section" id="nosotros"><div className="manifesto-title reveal-on-scroll"><p className="section-label">Nosotros</p><h2>NO ES SOLO<br/>UN CORTE.<br/><em>ES TU EXPERIENCIA.</em></h2></div><aside className="monogram-panel reveal-on-scroll"><span>BTM</span><p>Barber Team Machine<br/>Cochabamba, Bolivia<br/><br/>Corte · Barba · Cejas</p></aside><div className="manifesto-copy reveal-on-scroll"><p className="lead-copy"><strong>Barber Team Machine</strong> es un espacio para hombres que entienden que cuidarse es una forma de mostrarse seguros.</p><p>Cada visita se construye desde la conversación, la técnica y el respeto por el estilo que te representa. Ven por un corte, barba o cejas; sal con una imagen que se siente tuya.</p><p className="manifesto-quote">“Tu estilo habla antes que las palabras.”</p><div className="home-numbers"><div><b>{servicesCount || '—'}</b><span>Servicios</span></div><div><b>{barbersCount || '—'}</b><span>Barberos</span></div><div><b>6/7</b><span>Días abiertos</span></div><div><b>10AM</b><span>Apertura</span></div></div></div></section>
    <section className="value-strip" id="servicios"><article className="reveal-on-scroll"><b>01</b><h3>Obsesión por el detalle</h3><p>Cada corte, cada barba y cada perfilado se ejecuta con precisión y cuidado.</p></article><article className="reveal-on-scroll"><b>02</b><h3>Experiencia clara</h3><p>Un servicio directo, una agenda ordenada y tiempo bien aprovechado.</p></article><article className="reveal-on-scroll"><b>03</b><h3>Tu mejor versión</h3><p>Atención personalizada para que tu imagen transmita exactamente lo que buscas.</p></article></section>
    <section className="booking-invite" id="reservas"><div className="reveal-on-scroll"><p className="section-label">Agenda tu cita</p><h2>NUESTRO MENÚ<br/><em>EN LÍNEA.</em></h2><p>{servicesCount ? `Consulta los ${servicesCount} servicios disponibles, conoce al equipo y elige el horario que mejor se adapte a tu día.` : 'Conoce nuestros servicios y reserva en línea.'}</p><div className="hero-actions booking-actions"><button className="hero-cta" onClick={onReserve}>Reservar en BTM <span>↗</span></button><a className="secondary-home-cta" href="tel:+59177469963">Llamar ahora ↗</a></div></div></section>
    <section className="location-section" id="ubicacion"><div className="reveal-on-scroll"><p className="section-label">Encuéntranos</p><h2>VISÍTANOS EN<br/><em>COCHABAMBA.</em></h2></div><div className="location-content reveal-on-scroll"><iframe title="Ubicación de Barber Team Machine" src="https://maps.google.com/maps?q=Buenos%20Aires%20130%2C%20Cochabamba%2C%20Bolivia&z=16&output=embed" loading="lazy"/><div className="location-details"><article><b>Dirección</b><p>Buenos Aires 130<br/>Cochabamba, Bolivia</p></article><article><b>Horario</b><p>Lunes a sábado<br/>10:00 AM — 7:00 PM<br/>Domingo cerrado</p></article><article><b>Contacto</b><p>+591 77469963<br/><a href="https://maps.app.goo.gl/At4qrWe6P2KrDCyW9" target="_blank" rel="noreferrer">Cómo llegar ↗</a></p></article></div><div className="location-actions"><a className="hero-cta" href="https://maps.app.goo.gl/At4qrWe6P2KrDCyW9" target="_blank" rel="noreferrer">Cómo llegar <span>↗</span></a><button className="outline-link" onClick={onReserve}>Reservar cita <span>↗</span></button></div></div><p className="closing-line reveal-on-scroll">Tu próximo buen corte está a una cita de distancia.</p></section>
    <footer className="home-footer"><div className="reveal-on-scroll"><a className="brand-mark" href="#inicio">BTM<span>.</span></a><p>Precisión, técnica y estilo para cada visita.</p></div><div className="reveal-on-scroll"><b>Navegación</b><a href="#nosotros">Nosotros</a><a href="#ubicacion">Ubicación</a><a href="#reservas">Reservar</a></div><div className="reveal-on-scroll"><b>Servicios</b><a href="#servicios">Corte normal</a><a href="#servicios">Perfilado de barba</a><a href="#servicios">Perfilado de cejas</a></div><div className="reveal-on-scroll"><b>Contacto</b><span>Buenos Aires 130</span><span>Cochabamba, Bolivia</span><a href="tel:+59177469963">+591 77469963</a></div><small className="reveal-on-scroll">© 2026 Barber Team Machine. Todos los derechos reservados.</small></footer>
  </>;
}

function PasswordRecoveryPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError(''); setMessage(''); setLoading(true);
    try {
      if (token) {
        if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');
        const result = await api.resetPassword({ token, password });
        setMessage(`${result.message} Ya puedes iniciar sesión.`);
      } else {
        const result = await api.requestPasswordReset(email);
        setMessage(result.message);
      }
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }

  return <main className="password-recovery-page"><section className="password-recovery-card">
    <a className="recovery-logo" href="/">BTM<span>.</span></a>
    <p className="section-label">Acceso seguro</p>
    <h1>{token ? 'Crea una nueva contraseña' : 'Recupera tu contraseña'}</h1>
    <p>{token ? 'Elige una contraseña nueva para volver a ingresar a tu cuenta.' : 'Escribe tu correo y te enviaremos un enlace válido por 30 minutos.'}</p>
    {message ? <div className="recovery-message success">{message}</div> : <form onSubmit={submit}>
      {token ? <><label>Nueva contraseña<input type="password" minLength="8" required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)}/></label><label>Confirmar contraseña<input type="password" minLength="8" required autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/></label></> : <label>Correo electrónico<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)}/></label>}
      {error && <div className="recovery-message error">{error}</div>}
      <button className="wizard-primary" disabled={loading}>{loading ? 'Procesando...' : token ? 'Actualizar contraseña' : 'Enviar enlace'}</button>
    </form>}
    <a className="recovery-back" href={token ? '/reservar/cita' : '/'}>← Volver</a>
  </section></main>;
}

function ReservationWizard() {
  const reservationParams = new URLSearchParams(window.location.search);
  const selectedFromUrl = reservationParams.get('service') ?? '';
  const rescheduleId = reservationParams.get('reschedule');
  const initialBarberId = reservationParams.get('barber') ?? '';
  const initialBookingDate = new Date().toLocaleDateString('en-CA');
  const [services, setServices] = useState([]);
  const [barbers, setBarbers] = useState([]);
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('btm_user') ?? 'null'));
  const [serviceId, setServiceId] = useState(selectedFromUrl);
  const [extraServiceIds, setExtraServiceIds] = useState([]);
  const [step, setStep] = useState(initialBarberId ? 2 : 1);
  const [selection, setSelection] = useState({ barberId: initialBarberId, date: initialBarberId ? initialBookingDate : '' });
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ email: '', password: '', firstName: '', lastName: '' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showProfessionalModal, setShowProfessionalModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [detailView, setDetailView] = useState('schedule');
  const [firstVisit, setFirstVisit] = useState('');
  const [comment, setComment] = useState('');
  const [professionalQuery, setProfessionalQuery] = useState('');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [serviceQuery, setServiceQuery] = useState('');

  useEffect(() => {
    Promise.all([api.services(), api.barbers()])
      .then(([serviceResult, barberResult]) => {
        setServices(serviceResult.services);
        setBarbers(barberResult.barbers);
      })
      .catch((requestError) => setError(requestError.message));
  }, []);

  const selectedServiceIds = [serviceId, ...extraServiceIds].filter(Boolean).map(String);
  const selectedServices = services.filter((service) => selectedServiceIds.includes(String(service.id)));
  const selectedService = selectedServices[0];
  const selectedBarber = barbers.find((barber) => String(barber.id) === String(selection.barberId));
  const totalPrice = selectedServices.reduce((total, service) => total + Number(service.price), 0);
  const totalDuration = selectedServices.reduce((total, service) => total + service.durationMinutes, 0);
  const filteredBarbers = barbers.filter((barber) => {
    const profile = `${barber.displayName} ${barber.services || ''}`.toLowerCase();
    return selectedServices.every((service) => profile.includes(service.name.toLowerCase())) && profile.includes(professionalQuery.trim().toLowerCase());
  });
  const visibleServices = services.filter((service) => {
    const name = service.name.toLowerCase();
    const categoryMatches = serviceFilter === 'all' || (serviceFilter === 'cortes' && name.includes('corte')) || (serviceFilter === 'barba' && name.includes('barba')) || (serviceFilter === 'cejas' && name.includes('cejas'));
    return categoryMatches && name.includes(serviceQuery.trim().toLowerCase());
  });
  const bookingDates = Array.from({ length: 7 }, (_, index) => {
    const value = new Date();
    value.setDate(value.getDate() + index);
    return value.toLocaleDateString('en-CA');
  });

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

  async function authenticate(event) {
    event.preventDefault();
    try {
      const result = authMode === 'login' ? await api.login(authForm) : await api.register(authForm);
      saveSession(result);
      setSession(result.user);
      setShowAuthModal(false);
      setPhoneInput(result.user.phone?.replace(/^\+591\s?/, '') ?? '');
      setShowPhoneModal(true);
      setNotice('Sesión iniciada. Añade tu teléfono para continuar.');
    } catch (authError) {
      setError(authError.message);
    }
  }

  function beginCheckout() {
    setError('');
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
      localStorage.setItem('btm_user', JSON.stringify(result.user));
      setShowPhoneModal(false);
      setDetailView('survey');
      setNotice('Teléfono guardado. Cuéntanos un detalle antes de confirmar.');
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

  async function getSlots() {
    try {
      setSelectedSlot(null);
      setSlots((await api.availability(selection.barberId, selectedServiceIds, selection.date)).slots);
    } catch (availabilityError) {
      setError(availabilityError.message);
    }
  }

  async function reserve() {
    if (!selectedSlot) return;
    try {
      await api.createAppointments({ barberId: selection.barberId, serviceIds: selectedServiceIds, startsAt: selectedSlot.startsAt });
      window.location.assign('/mi-cuenta?tab=historial');
    } catch (reservationError) {
      if (/token|sesión|autoriz/i.test(reservationError.message)) {
        clearSession();
        setSession(null);
        setError('');
        setShowAuthModal(true);
      } else {
        setError(reservationError.message);
      }
    }
  }

  async function continueWithSelectedTime() {
    if (!selectedSlot) return;
    if (!rescheduleId) {
      beginCheckout();
      return;
    }
    try {
      await api.rescheduleAppointment(rescheduleId, selectedSlot.startsAt);
      window.location.assign('/mi-cuenta?tab=historial');
    } catch (rescheduleError) {
      setError(rescheduleError.message);
    }
  }

  useEffect(() => {
    if (step === 2 && selection.barberId && selection.date && selectedServiceIds.length) getSlots();
  }, [step, selection.barberId, selection.date, selectedServiceIds.join(',')]);

  return <main className="reservation-wizard">
    {step !== 4 && <header className="wizard-header">
      <a href="/reservar">← &nbsp; Atrás</a>
      <a className="wizard-logo" href="/">BTM<span>.</span></a>
      <div className="wizard-steps"><b className={step >= 1 ? 'active' : ''}>1 <span>Servicios</span></b><i/><b className={step >= 2 ? 'active' : ''}>2 <span>Detalles</span></b><i/><b className={step >= 3 ? 'active' : ''}>3 <span>Confirmar</span></b></div>
    </header>}
    {error && <p className="wizard-notice error">{error}</p>}
    {notice && <p className="wizard-notice success">{notice}</p>}

    {step === 1 && <section className="wizard-content">
      <div className="wizard-selection">
        <h1>Seleccionar servicios</h1>
        <label className="service-search">⌕<input value={serviceQuery} placeholder="Buscar servicios..." onChange={(event) => setServiceQuery(event.target.value)}/></label>
        <div className="service-filters">
          <button className={serviceFilter === 'all' ? 'active' : ''} onClick={() => setServiceFilter('all')}>Todos los servicios <b>{services.length}</b></button>
          <button className={serviceFilter === 'cortes' ? 'active' : ''} onClick={() => setServiceFilter('cortes')}>Cortes</button>
          <button className={serviceFilter === 'barba' ? 'active' : ''} onClick={() => setServiceFilter('barba')}>Barba</button>
          <button className={serviceFilter === 'cejas' ? 'active' : ''} onClick={() => setServiceFilter('cejas')}>Cejas</button>
        </div>
        <div className="wizard-service-list">
          {visibleServices.length ? visibleServices.map((service) => <article className={selectedServiceIds.includes(String(service.id)) ? 'chosen' : ''} key={service.id}>
            <div className="wizard-service-art">{service.name.slice(0, 1)}</div>
            <div><h2>{service.name}</h2><p>{service.description || 'Servicio personalizado para cuidar tu estilo.'}</p><small>◷ &nbsp;{service.durationMinutes} min</small></div>
            <strong>Bs {Number(service.price).toFixed(0)}</strong>
            {selectedServiceIds.includes(String(service.id)) ? <button className="remove-service" onClick={() => toggleService(service.id)}>− Quitar</button> : <button className="add-service" onClick={() => toggleService(service.id)}>＋ Añadir</button>}
          </article>) : <p className="empty-state">No hay servicios en esta categoría.</p>}
        </div>
      </div>
      <aside className="wizard-summary">
        <h2>Resumen</h2>
        {selectedServices.length ? <div className="summary-services">{selectedServices.map((service) => <div className="summary-service" key={service.id}><div className="wizard-service-art">{service.name.slice(0, 1)}</div><div><b>{service.name}</b><span>◷ &nbsp;{service.durationMinutes} min</span></div><strong>Bs {Number(service.price).toFixed(0)}</strong></div>)}</div> : <p>Elige uno o más servicios para continuar.</p>}
        <div className="summary-total"><span>Total · {totalDuration} min</span><b>Bs {totalPrice.toFixed(0)}</b></div>
        <button className="wizard-primary" disabled={!selectedServices.length} onClick={() => setShowProfessionalModal(true)}>Continuar</button>
        <small>Todos los servicios se reservarán de forma consecutiva al elegir un horario.</small>
      </aside>
    </section>}

    {step === 2 && detailView === 'schedule' && <section className="wizard-content wizard-details">
      <div className="wizard-selection">
        <button className="wizard-back" onClick={() => setStep(1)}>← Volver a servicios</button>
        <h1>{rescheduleId ? 'Cambiar fecha y hora' : 'Horarios disponibles'}</h1>
        <p className="wizard-intro">{rescheduleId ? 'Elige un nuevo día y horario para tu cita.' : `${selectedServices.length} servicio(s) · ${totalDuration} min en total`}</p>
        <div className="availability-panel">
          <p>Profesional seleccionado</p>
          <button className="selected-professional" onClick={() => setShowProfessionalModal(true)}><b>{selectedBarber?.displayName.slice(0, 1)}</b><span>{selectedBarber?.displayName}</span><i>Cambiar profesional⌄</i></button>
          <h2>Elige un día y horario</h2>
          <div className="date-picker">{bookingDates.map((date) => {
            const view = new Date(`${date}T12:00:00`);
            return <button className={selection.date === date ? 'active' : ''} key={date} onClick={() => { setSelectedSlot(null); setSelection({ ...selection, date }); }}><small>{view.toLocaleDateString('es-BO', { weekday: 'short' })}</small><b>{view.getDate()}</b></button>;
          })}</div>
          <p className="selected-date">{selection.date && new Date(`${selection.date}T12:00:00`).toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <div className="wizard-slots">{slots.length ? slots.map((slot) => <button className={selectedSlot?.startsAt === slot.startsAt ? 'selected' : ''} key={slot.startsAt} onClick={() => setSelectedSlot(slot)}>{new Date(slot.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</button>) : <p className="empty-state">No hay horarios disponibles para este día. Elige otra fecha.</p>}</div>
        </div>
      </div>
      <aside className="wizard-summary">
        <h2>Resumen</h2>
        {selectedServices.map((service) => <div className="summary-service" key={service.id}><div className="wizard-service-art">{service.name.slice(0, 1)}</div><div><b>{service.name}</b><span>◷ &nbsp;{service.durationMinutes} min</span></div><strong>Bs {Number(service.price).toFixed(0)}</strong></div>)}
        {selectedSlot && <p className="summary-selected-time">Horario elegido: <b>{new Date(selectedSlot.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</b></p>}
        <div className="summary-total"><span>Total · {totalDuration} min</span><b>Bs {totalPrice.toFixed(0)}</b></div>
        {selectedSlot ? <button className="wizard-primary" onClick={continueWithSelectedTime}>{rescheduleId ? 'Guardar nuevo horario' : 'Continuar'}</button> : <small>Selecciona un horario para continuar.</small>}
      </aside>
    </section>}

    {step === 2 && detailView === 'survey' && <section className="checkout-stage">
      <div className="checkout-main">
        <p className="checkout-crumbs">Servicios &nbsp;›&nbsp; Profesional &nbsp;›&nbsp; Hora &nbsp;›&nbsp; Confirmar</p>
        <h1>¿Es tu primera visita a Barber Team Machine?</h1>
        <div className="survey-options">
          <button className={firstVisit === 'yes' ? 'selected' : ''} onClick={() => setFirstVisit('yes')}><b>Sí</b><span>Esta es mi primera visita</span></button>
          <button className={firstVisit === 'no' ? 'selected' : ''} onClick={() => setFirstVisit('no')}><b>No</b><span>No es mi primera visita</span></button>
        </div>
      </div>
      <aside className="checkout-summary">
        <h2>BTM · Cochabamba</h2>
        <p>📅 {selection.date && new Date(`${selection.date}T12:00:00`).toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <p>◷ {selectedSlot && new Date(selectedSlot.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })} · {totalDuration} min</p>
        <hr/>
        {selectedServices.map((service) => <p className="checkout-item" key={service.id}><span>{service.name}<small>Con {selectedBarber?.displayName}</small></span><b>Bs {Number(service.price).toFixed(0)}</b></p>)}
        <p className="checkout-total"><b>Total</b><b>Bs {totalPrice.toFixed(0)}</b></p>
        <button className="checkout-primary" disabled={!firstVisit} onClick={() => { setStep(3); setNotice('Revisa los datos antes de confirmar tu cita.'); }}>Continuar →</button>
      </aside>
    </section>}

    {step === 3 && <section className="checkout-stage">
      <div className="checkout-main">
        <p className="checkout-crumbs">Servicios &nbsp;›&nbsp; Profesional &nbsp;›&nbsp; Hora &nbsp;›&nbsp; <b>Confirmar</b></p>
        <h1>Revisar y confirmar</h1>
        <h2>Más detalles</h2>
        <article className="checkout-card"><b>Política de cancelación</b><p>Cancela gratis en cualquier momento.</p></article>
        <h2>Comentarios o solicitudes</h2>
        <label className="comment-box"><span>¿Algo que quieras que sepamos?</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Escribe una solicitud opcional para tu barbero."/></label>
      </div>
      <aside className="checkout-summary">
        <h2>BTM · Cochabamba</h2>
        <p>📅 {selection.date && new Date(`${selection.date}T12:00:00`).toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <p>◷ {selectedSlot && new Date(selectedSlot.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })} · {totalDuration} min</p>
        <hr/>
        {selectedServices.map((service) => <p className="checkout-item" key={service.id}><span>{service.name}<small>Con {selectedBarber?.displayName}</small></span><b>Bs {Number(service.price).toFixed(0)}</b></p>)}
        <p className="checkout-total"><b>Total</b><b>Bs {totalPrice.toFixed(0)}</b></p>
        <button className="checkout-primary" onClick={reserve}>Confirmar cita</button>
      </aside>
    </section>}

    {step === 4 && <section className="appointment-confirmed"><div><span>✓</span><h1>Cita confirmada</h1><p>Te esperamos en Barber Team Machine.</p><a href="/reservar">Volver a la barbería</a></div></section>}

    {showProfessionalModal && <div className="professional-modal-backdrop" role="dialog" aria-modal="true" aria-label="Elegir profesional">
      <section className="professional-modal">
        <button className="modal-close" onClick={() => setShowProfessionalModal(false)} aria-label="Cerrar">×</button>
        <p>Elige tu profesional</p>
        <h1>{selectedServices.length > 1 ? `${selectedServices.length} servicios seleccionados` : selectedService?.name}</h1>
        <label className="service-search">⌕<input value={professionalQuery} onChange={(event) => setProfessionalQuery(event.target.value)} placeholder="Buscar por nombre o especialidad..."/></label>
        <h2>Elige una opción</h2>
        <div className="professional-list">
          {filteredBarbers.length > 0 && <button className="random-professional" onClick={chooseRandomProfessional}><b>✦</b><strong>Cualquier profesional</strong><span>Te asignamos uno al azar entre los disponibles</span><i>Elegir esta opción</i></button>}
          {filteredBarbers.map((barber) => <button key={barber.id} onClick={() => chooseProfessional(barber.id)}><b>{barber.displayName.slice(0, 1)}</b><strong>{barber.displayName}</strong><span>{barber.services || 'Barbero'}</span><i>★ Profesional BTM</i></button>)}
          {!filteredBarbers.length && <span className="empty-state">No hay profesionales que realicen todos los servicios seleccionados.</span>}
        </div>
        <footer>Los profesionales mostrados están habilitados para atender las reservas de Barber Team Machine.</footer>
      </section>
    </div>}

    {showAuthModal && <div className="auth-modal-backdrop" role="dialog" aria-modal="true" aria-label="Iniciar sesión o registrarse">
      <section className="auth-modal">
        <button className="modal-close" onClick={() => setShowAuthModal(false)} aria-label="Cerrar">×</button>
        <p className="section-label">Reserva</p>
        <h1>Inicia sesión o regístrate para reservar</h1>
        <p>Para continuar, verificaremos que eres tú.</p>
        <form onSubmit={authenticate}>
          <label>Correo electrónico<input type="email" required value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}/></label>
          <label>Contraseña<input type="password" minLength="8" required value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}/></label>
          {authMode === 'register' && <><label>Nombre<input required value={authForm.firstName} onChange={(event) => setAuthForm({ ...authForm, firstName: event.target.value })}/></label><label>Apellido<input required value={authForm.lastName} onChange={(event) => setAuthForm({ ...authForm, lastName: event.target.value })}/></label></>}
          <button className="wizard-primary">{authMode === 'login' ? 'Continuar' : 'Crear cuenta'}</button>
        </form>
        {authMode === 'login' && <a className="forgot-password-link" href="/recuperar-contrasena">¿Olvidaste tu contraseña?</a>}
        <button type="button" className="text-button" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>{authMode === 'login' ? 'Crear una cuenta' : 'Ya tengo una cuenta'}</button>
      </section>
    </div>}

    {showPhoneModal && <div className="auth-modal-backdrop" role="dialog" aria-modal="true" aria-label="Añadir teléfono">
      <section className="auth-modal phone-modal">
        <button className="modal-close" onClick={() => setShowPhoneModal(false)} aria-label="Cerrar">×</button>
        <h1>Añadir teléfono</h1>
        <p>Introduce tu número de teléfono para confirmar la cita.</p>
        <form onSubmit={savePhone}>
          <label>Número de teléfono<div className="phone-field"><span>+591</span><input type="tel" inputMode="numeric" minLength="8" maxLength="12" required autoFocus value={phoneInput} onChange={(event) => setPhoneInput(event.target.value.replace(/[^0-9]/g, ''))}/></div></label>
          <button className="wizard-primary">Continuar</button>
        </form>
      </section>
    </div>}
  </main>;
}

function BookingPage() {
  const [services, setServices] = useState([]); const [barbers, setBarbers] = useState([]); const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('btm_user') ?? 'null'));
  const [selection, setSelection] = useState({ serviceId: '', barberId: '', date: '' }); const [slots, setSlots] = useState([]); const [authMode, setAuthMode] = useState('login'); const [authForm, setAuthForm] = useState({ email: '', password: '', firstName: '', lastName: '' }); const [notice, setNotice] = useState(''); const [error, setError] = useState(''); const [serviceQuery, setServiceQuery] = useState('');
  useEffect(() => { Promise.all([api.services(), api.barbers()]).then(([s, b]) => { setServices(s.services); setBarbers(b.barbers); }).catch((e) => setError(e.message)); }, []);
  async function authenticate(e) { e.preventDefault(); try { const result = authMode === 'login' ? await api.login(authForm) : await api.register(authForm); saveSession(result); setSession(result.user); setNotice('Sesión iniciada. Ahora puedes elegir un horario.'); } catch (err) { setError(err.message); } }
  async function getSlots() { try { setSlots((await api.availability(selection.barberId, selection.serviceId, selection.date)).slots); } catch (err) { setError(err.message); } }
  async function reserve(slot) { try { await api.createAppointment({ barberId: selection.barberId, serviceId: selection.serviceId, startsAt: slot.startsAt }); setNotice('Solicitud de reserva registrada y pendiente de confirmación.'); setSlots((items) => items.filter((item) => item.startsAt !== slot.startsAt)); } catch (err) { setError(err.message); } }
  const filteredServices = services.filter((service) => service.name.toLowerCase().includes(serviceQuery.trim().toLowerCase()));
  return <main className="booking-page booking-experience"><header className="booking-topbar"><a className="brand-mark" href="/">BTM<span>.</span></a><div>{session ? <button className="booking-login" onClick={() => { clearSession(); setSession(null); }}>Cerrar sesión</button> : <a className="booking-login" href="/reservar/cita">Iniciar sesión</a>}</div></header>
    <section className="booking-hero"><div className="booking-hero-mark">BTM<span>.</span></div><div className="booking-profile"><h1>Barber Team Machine</h1><div><span>Barbería</span><span>Cochabamba</span></div><p>★ Atención profesional <i>•</i> Buenos Aires 130, Cochabamba</p><p>◷ Abierto: lunes a sábado, 10:00 AM — 7:00 PM</p></div></section>
    <div className="booking-layout">{error && <p className="booking-notice error">{error}</p>}{notice && <p className="booking-notice success">{notice}</p>}<nav className="booking-tabs"><a href="#servicios">Servicios</a><a href="#equipo">Equipo</a><a href="/reservar/cita">Reservar</a></nav>
      <section className="booking-about"><div><h2>Sobre nosotros</h2><div className="booking-tags"><span>Barbería</span><span>Corte y estilo</span><span>Atención personalizada</span></div><p>Precisión, técnica y estilo para acompañarte en cada visita. Elige un servicio y reserva tu horario en línea.</p></div><aside><b>⌖ &nbsp; Dirección</b><p>Buenos Aires 130<br/>Cochabamba, Bolivia</p><a href="https://maps.app.goo.gl/At4qrWe6P2KrDCyW9" target="_blank" rel="noreferrer">Ver dirección ↗</a><b>◷ &nbsp; Horario</b><p>Lunes a sábado<br/>10:00 AM — 7:00 PM</p></aside></section>
      <section className="booking-catalog" id="servicios"><h2>Servicios</h2><label className="service-search">⌕<input value={serviceQuery} onChange={(e) => setServiceQuery(e.target.value)} placeholder="Buscar servicios..."/></label><div className="service-filters"><button className="active" onClick={() => setServiceQuery('')}>Todos los servicios <b>{services.length}</b></button><button onClick={() => setServiceQuery('corte')}>Cortes</button><button onClick={() => setServiceQuery('barba')}>Barba</button><button onClick={() => setServiceQuery('cejas')}>Cejas</button></div><div className="service-cards">{filteredServices.length ? filteredServices.map((service) => <button key={service.id} className="service-card" onClick={() => { window.location.href = `/reservar/cita?service=${service.id}`; }}><div className="service-art">{service.name.slice(0, 1)}</div><div className="service-card-copy"><small>Barbería</small><strong>{service.name}</strong><p>{service.description || 'Servicio personalizado para cuidar tu estilo.'}</p><span>◷ {service.durationMinutes} min</span></div><div className="service-card-price"><b>Bs {Number(service.price).toFixed(0)}</b><i>Reservar</i></div></button>) : <p className="empty-state">No encontramos servicios con ese nombre.</p>}</div></section>
      <section className="team-section" id="equipo"><h2>Colaboradores</h2><div>{barbers.length ? barbers.map((barber) => <article key={barber.id}><b>{barber.displayName.slice(0, 1)}</b><h3>{barber.displayName}</h3><p>{barber.services || 'Barbero'}</p><span>★ Profesional BTM</span></article>) : <p className="empty-state">El equipo estará disponible pronto.</p>}</div></section>
      <section className="booking-form-section" id="agenda"><div><p className="section-label">Reserva en línea</p><h2>Elige tu horario.</h2><p>{session ? `Sesión activa: ${session.firstName}. Selecciona el servicio, profesional y fecha para ver los horarios.` : 'Inicia sesión o crea tu cuenta para confirmar tu reserva.'}</p></div>{session ? <div className="booking-form-panel"><label>Servicio<select value={selection.serviceId} onChange={(e) => setSelection({ ...selection, serviceId: e.target.value })}><option value="">Selecciona un servicio</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.durationMinutes} min</option>)}</select></label><label>Profesional<select value={selection.barberId} onChange={(e) => setSelection({ ...selection, barberId: e.target.value })}><option value="">Selecciona un profesional</option>{barbers.map((b) => <option key={b.id} value={b.id}>{b.displayName}</option>)}</select></label><label>Fecha<input type="date" value={selection.date} onChange={(e) => setSelection({ ...selection, date: e.target.value })}/></label><button className="booking-primary" disabled={!selection.serviceId || !selection.barberId || !selection.date} onClick={getSlots}>Ver horarios</button>{slots.length > 0 && <div className="booking-slots">{slots.map((slot) => <button key={slot.startsAt} onClick={() => reserve(slot)}>{new Date(slot.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</button>)}</div>}</div> : <form className="booking-auth" onSubmit={authenticate}><h3>{authMode === 'login' ? 'Inicia sesión' : 'Crea tu cuenta'}</h3><input type="email" placeholder="Correo electrónico" required value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}/><input type="password" placeholder="Contraseña" minLength="8" required value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}/>{authMode === 'register' && <><input placeholder="Nombre" required value={authForm.firstName} onChange={(e) => setAuthForm({ ...authForm, firstName: e.target.value })}/><input placeholder="Apellido" required value={authForm.lastName} onChange={(e) => setAuthForm({ ...authForm, lastName: e.target.value })}/></>}<button className="booking-primary">{authMode === 'login' ? 'Continuar' : 'Crear cuenta'}</button><button type="button" className="text-button" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>{authMode === 'login' ? 'Crear una cuenta' : 'Ya tengo una cuenta'}</button></form>}</section>
    </div><footer className="booking-footer"><div><b>Barber Team Machine</b><p>Precisión, técnica y estilo para cada visita.</p></div><div><b>Navegación</b><a href="#servicios">Servicios</a><a href="#equipo">Colaboradores</a><a href="#agenda">Reservar</a></div><div><b>Más información</b><a href="https://maps.app.goo.gl/At4qrWe6P2KrDCyW9" target="_blank" rel="noreferrer">⌖ Buenos Aires 130</a><span>◷ 10:00 AM — 7:00 PM</span></div><small>© 2026 Barber Team Machine. Todos los derechos reservados.</small></footer></main>;
}

const statusLabels = { PENDING: 'Pendiente', CONFIRMED: 'Confirmada', COMPLETED: 'Atendida', CANCELLED: 'Cancelada', NO_SHOW: 'No asistió' };

function AdminPanel({ services, barbers, reloadCatalog }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [appointments, setAppointments] = useState([]); const [users, setUsers] = useState([]); const [dashboard, setDashboard] = useState(null); const [message, setMessage] = useState('');
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', barberId: '', serviceId: '', status: '' });
  const [barberId, setBarberId] = useState(''); const [assignedServices, setAssignedServices] = useState([]); const [hours, setHours] = useState([]); const [blocks, setBlocks] = useState([]);
  const [service, setService] = useState({ name: '', description: '', price: '', durationMinutes: '' }); const [editingService, setEditingService] = useState(null);
  const [barber, setBarber] = useState({ displayName: '', bio: '' }); const [editingBarber, setEditingBarber] = useState(null);
  const [hour, setHour] = useState({ weekday: '1', startTime: '10:00', endTime: '19:00' }); const [block, setBlock] = useState({ startsAt: '', endsAt: '', reason: '' });
  const [staffAccount, setStaffAccount] = useState({ barberId: '', firstName: '', lastName: '', email: '', password: '', phone: '' });
  const [reschedule, setReschedule] = useState({ id: '', startsAt: '' });

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
  useEffect(() => { if (barberId) Promise.all([api.workingHours(barberId), api.blocks(barberId)]).then(([working, schedule]) => { setHours(working.workingHours); setBlocks(schedule.blocks); }).catch((error) => setMessage(error.message)); }, [barberId]);

  const saveMessage = (text) => setMessage(text);
  const updateStatus = async (id, status) => { try { await api.updateAppointmentStatus(id, { status }); await refresh(); saveMessage('Estado de la cita actualizado.'); } catch (error) { saveMessage(error.message); } };
  const createService = async (event) => { event.preventDefault(); try { await api.createService({ ...service, price: Number(service.price), durationMinutes: Number(service.durationMinutes) }); setService({ name: '', description: '', price: '', durationMinutes: '' }); await reloadCatalog(); await refresh(); saveMessage('Servicio creado correctamente.'); } catch (error) { saveMessage(error.message); } };
  const saveService = async (event) => { event.preventDefault(); try { await api.updateService(editingService.id, { name: editingService.name, description: editingService.description || undefined, price: Number(editingService.price), durationMinutes: Number(editingService.durationMinutes), isActive: editingService.isActive }); setEditingService(null); await reloadCatalog(); await refresh(); saveMessage('Servicio actualizado.'); } catch (error) { saveMessage(error.message); } };
  const createBarber = async (event) => { event.preventDefault(); try { await api.createBarber(barber); setBarber({ displayName: '', bio: '' }); await reloadCatalog(); saveMessage('Barbero registrado. Ahora puedes asignar sus servicios, horarios y cuenta.'); } catch (error) { saveMessage(error.message); } };
  const saveBarber = async (event) => { event.preventDefault(); try { await api.updateBarber(editingBarber.id, { displayName: editingBarber.displayName, bio: editingBarber.bio || undefined, isActive: editingBarber.isActive }); setEditingBarber(null); await reloadCatalog(); saveMessage('Información del barbero actualizada.'); } catch (error) { saveMessage(error.message); } };
  const addHour = async (event) => { event.preventDefault(); try { await api.createWorkingHour(barberId, { ...hour, weekday: Number(hour.weekday) }); setHours((await api.workingHours(barberId)).workingHours); saveMessage('Horario laboral agregado.'); } catch (error) { saveMessage(error.message); } };
  const addBlock = async (event) => { event.preventDefault(); try { await api.createBlock(barberId, { ...block, startsAt: new Date(block.startsAt).toISOString(), endsAt: new Date(block.endsAt).toISOString() }); setBlocks((await api.blocks(barberId)).blocks); setBlock({ startsAt: '', endsAt: '', reason: '' }); saveMessage('Bloqueo de agenda creado.'); } catch (error) { saveMessage(error.message); } };
  const createAccount = async (event) => { event.preventDefault(); try { await api.createBarberAccount({ ...staffAccount, barberId: Number(staffAccount.barberId) }); setStaffAccount({ barberId: '', firstName: '', lastName: '', email: '', password: '', phone: '' }); await reloadCatalog(); await refresh(); saveMessage('Cuenta de acceso del barbero creada.'); } catch (error) { saveMessage(error.message); } };
  const reprogramAppointment = async (event) => { event.preventDefault(); try { await api.rescheduleAppointment(reschedule.id, new Date(reschedule.startsAt).toISOString()); setReschedule({ id: '', startsAt: '' }); await refresh(); saveMessage('Cita reprogramada y enviada nuevamente a confirmación.'); } catch (error) { saveMessage(error.message); } };
  const exportReport = () => {
    const rows = [['Cliente', 'Servicio', 'Barbero', 'Fecha y hora', 'Estado'], ...appointments.map((item) => [item.clientName, item.serviceName, item.barberName, new Date(item.startsAt).toLocaleString('es-BO'), statusLabels[item.status] ?? item.status])];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })); link.download = 'reporte-btm-citas.csv'; link.click(); URL.revokeObjectURL(link.href);
  };
  const clients = users.filter((user) => user.role === 'CLIENTE');
  const accountableBarbers = barbers.filter((item) => !item.userId);
  const metrics = dashboard?.metrics ?? {};

  return <section className="admin-section admin-workspace">
    <div className="admin-workspace-intro"><div><p className="section-label">Administración</p><h2>Operación y análisis.</h2><p>Controla citas, disponibilidad, catálogo, equipo, clientes y reportes de Barber Team Machine.</p></div><button className="admin-refresh" onClick={() => refresh().catch((error) => saveMessage(error.message))}>↻ Actualizar datos</button></div>
    {message && <p className="admin-feedback">{message}</p>}
    <nav className="admin-tabs" aria-label="Secciones administrativas">{[['dashboard', 'Dashboard'], ['agenda', 'Agenda y citas'], ['servicios', 'Servicios'], ['equipo', 'Barberos y horarios'], ['clientes', 'Clientes'], ['reportes', 'Reportes']].map(([id, label]) => <button key={id} className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>{label}</button>)}</nav>
    <div className="admin-filterbar"><label>Desde<input type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })}/></label><label>Hasta<input type="date" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })}/></label><label>Barbero<select value={filters.barberId} onChange={(event) => setFilters({ ...filters, barberId: event.target.value })}><option value="">Todos</option>{barbers.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label><label>Servicio<select value={filters.serviceId} onChange={(event) => setFilters({ ...filters, serviceId: event.target.value })}><option value="">Todos</option>{services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{activeTab === 'agenda' && <label>Estado<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option>{Object.entries(statusLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}<button onClick={() => refresh().catch((error) => saveMessage(error.message))}>Aplicar filtros</button><button className="quiet" onClick={() => { const clean = { dateFrom: '', dateTo: '', barberId: '', serviceId: '', status: '' }; setFilters(clean); refresh(clean).catch((error) => saveMessage(error.message)); }}>Limpiar</button></div>

    {activeTab === 'dashboard' && <div className="admin-dashboard"><div className="admin-metrics"><AdminMetric label="Citas registradas" value={metrics.appointments ?? 0} note="Según los filtros actuales"/><AdminMetric label="Citas atendidas" value={metrics.completed ?? 0} note="Servicios finalizados"/><AdminMetric label="Canceladas" value={metrics.cancelled ?? 0} note="Citas anuladas"/><AdminMetric label="Clientes recurrentes" value={metrics.recurringClients ?? 0} note="Dos o más reservas"/></div><div className="admin-dashboard-grid"><AdminBars title="Servicios más reservados" data={dashboard?.serviceUsage ?? []} empty="Aún no hay reservas para mostrar."/><AdminBars title="Horas con mayor demanda" data={dashboard?.busyHours ?? []} empty="Aún no hay horas registradas."/><section className="admin-card admin-status-card"><h3>Estado de citas</h3>{Object.entries(statusLabels).map(([status, label]) => <p key={status}><span className={`admin-status-dot ${status.toLowerCase()}`}></span>{label}<b>{Number((dashboard?.statuses ?? []).find((item) => item.status === status)?.total ?? 0)}</b></p>)}</section></div></div>}

    {activeTab === 'agenda' && <div className="admin-agenda-layout"><section className="admin-card"><div className="admin-card-heading"><div><h3>Agenda centralizada</h3><p>{appointments.length} cita(s) encontradas.</p></div></div><div className="admin-appointment-list">{appointments.length ? appointments.map((item) => <article key={item.id}><time><b>{new Date(item.startsAt).toLocaleDateString('es-BO', { day: '2-digit', month: 'short' })}</b><span>{new Date(item.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</span></time><div><strong>{item.clientName}</strong><p>{item.serviceName} · {item.barberName}</p></div><span className={`admin-status ${item.status.toLowerCase()}`}>{statusLabels[item.status]}</span><div className="admin-appointment-actions">{item.status === 'PENDING' && <button onClick={() => updateStatus(item.id, 'CONFIRMED')}>Confirmar</button>}{['PENDING', 'CONFIRMED'].includes(item.status) && <><button onClick={() => updateStatus(item.id, 'COMPLETED')}>Atendida</button><button onClick={() => updateStatus(item.id, 'NO_SHOW')}>No asistió</button><button className="danger" onClick={() => updateStatus(item.id, 'CANCELLED')}>Cancelar</button><button className="quiet" onClick={() => setReschedule({ id: item.id, startsAt: new Date(item.startsAt).toISOString().slice(0, 16) })}>Reprogramar</button></>}</div></article>) : <p className="admin-empty">No hay citas con estos filtros.</p>}</div></section>{reschedule.id && <aside className="admin-card reschedule-card"><h3>Reprogramar cita</h3><p>La cita volverá al estado pendiente para que sea confirmada.</p><form onSubmit={reprogramAppointment}><input type="datetime-local" required value={reschedule.startsAt} onChange={(event) => setReschedule({ ...reschedule, startsAt: event.target.value })}/><button>Guardar nueva fecha</button><button type="button" className="quiet" onClick={() => setReschedule({ id: '', startsAt: '' })}>Cancelar</button></form></aside>}</div>}

    {activeTab === 'servicios' && <div className="admin-management-grid"><section className="admin-card"><h3>Nuevo servicio</h3><form onSubmit={createService} className="admin-form"><input placeholder="Nombre del servicio" required value={service.name} onChange={(event) => setService({ ...service, name: event.target.value })}/><textarea placeholder="Descripción breve" value={service.description} onChange={(event) => setService({ ...service, description: event.target.value })}/><div><input type="number" min="0" step="0.01" placeholder="Precio en Bs" required value={service.price} onChange={(event) => setService({ ...service, price: event.target.value })}/><input type="number" min="1" placeholder="Duración (min)" required value={service.durationMinutes} onChange={(event) => setService({ ...service, durationMinutes: event.target.value })}/></div><button>Crear servicio</button></form></section><section className="admin-card"><h3>Catálogo de servicios</h3><div className="admin-catalog-list">{services.map((item) => <article key={item.id}><div><b>{item.name}</b><span>Bs {Number(item.price).toFixed(0)} · {item.durationMinutes} min</span><small>{item.isActive ? 'Activo' : 'Inactivo'}</small></div><button className="quiet" onClick={() => setEditingService({ ...item })}>Editar</button></article>)}</div></section>{editingService && <section className="admin-card edit-card"><h3>Editar servicio</h3><form onSubmit={saveService} className="admin-form"><input required value={editingService.name} onChange={(event) => setEditingService({ ...editingService, name: event.target.value })}/><textarea value={editingService.description ?? ''} onChange={(event) => setEditingService({ ...editingService, description: event.target.value })}/><input type="number" min="0" step="0.01" required value={editingService.price} onChange={(event) => setEditingService({ ...editingService, price: event.target.value })}/><input type="number" min="1" required value={editingService.durationMinutes} onChange={(event) => setEditingService({ ...editingService, durationMinutes: event.target.value })}/><label className="admin-check"><input type="checkbox" checked={editingService.isActive} onChange={(event) => setEditingService({ ...editingService, isActive: event.target.checked })}/> Servicio disponible para reservas</label><button>Guardar cambios</button><button type="button" className="quiet" onClick={() => setEditingService(null)}>Cerrar</button></form></section>}</div>}

    {activeTab === 'equipo' && <div className="admin-team-area"><div className="admin-management-grid"><section className="admin-card"><h3>Registrar barbero</h3><form onSubmit={createBarber} className="admin-form"><input placeholder="Nombre visible" required value={barber.displayName} onChange={(event) => setBarber({ ...barber, displayName: event.target.value })}/><textarea placeholder="Biografía breve" value={barber.bio} onChange={(event) => setBarber({ ...barber, bio: event.target.value })}/><button>Registrar barbero</button></form></section><section className="admin-card"><h3>Crear acceso para barbero</h3><form onSubmit={createAccount} className="admin-form"><select required value={staffAccount.barberId} onChange={(event) => setStaffAccount({ ...staffAccount, barberId: event.target.value })}><option value="">Selecciona un barbero sin cuenta</option>{accountableBarbers.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select><div><input placeholder="Nombre" required value={staffAccount.firstName} onChange={(event) => setStaffAccount({ ...staffAccount, firstName: event.target.value })}/><input placeholder="Apellido" required value={staffAccount.lastName} onChange={(event) => setStaffAccount({ ...staffAccount, lastName: event.target.value })}/></div><input type="email" placeholder="Correo" required value={staffAccount.email} onChange={(event) => setStaffAccount({ ...staffAccount, email: event.target.value })}/><input type="password" minLength="8" placeholder="Contraseña temporal" required value={staffAccount.password} onChange={(event) => setStaffAccount({ ...staffAccount, password: event.target.value })}/><input placeholder="Teléfono (opcional)" value={staffAccount.phone} onChange={(event) => setStaffAccount({ ...staffAccount, phone: event.target.value })}/><button>Crear cuenta de acceso</button></form></section><section className="admin-card"><h3>Equipo registrado</h3><div className="admin-catalog-list">{barbers.map((item) => <article key={item.id}><div><b>{item.displayName}</b><span>{item.serviceIds?.length ?? 0} servicio(s) asignado(s)</span><small>{item.isActive ? 'Activo' : 'Inactivo'} · {item.userId ? 'Con cuenta de acceso' : 'Sin cuenta de acceso'}</small></div><button className="quiet" onClick={() => { setEditingBarber({ ...item }); setBarberId(String(item.id)); setAssignedServices(item.serviceIds ?? []); }}>Gestionar</button></article>)}</div></section></div>
      {editingBarber && <div className="admin-team-settings"><section className="admin-card"><h3>Perfil de {editingBarber.displayName}</h3><form onSubmit={saveBarber} className="admin-form"><input required value={editingBarber.displayName} onChange={(event) => setEditingBarber({ ...editingBarber, displayName: event.target.value })}/><textarea value={editingBarber.bio ?? ''} onChange={(event) => setEditingBarber({ ...editingBarber, bio: event.target.value })}/><label className="admin-check"><input type="checkbox" checked={editingBarber.isActive} onChange={(event) => setEditingBarber({ ...editingBarber, isActive: event.target.checked })}/> Barbero activo</label><button>Guardar perfil</button><button type="button" className="quiet" onClick={() => setEditingBarber(null)}>Cerrar gestión</button></form></section><section className="admin-card"><h3>Servicios que realiza</h3><div className="admin-service-checks">{services.filter((item) => item.isActive).map((item) => <label key={item.id}><input type="checkbox" checked={assignedServices.includes(item.id)} onChange={(event) => setAssignedServices(event.target.checked ? [...assignedServices, item.id] : assignedServices.filter((id) => id !== item.id))}/>{item.name}</label>)}</div><button onClick={async () => { try { await api.setBarberServices(barberId, assignedServices); await reloadCatalog(); saveMessage('Servicios asignados al barbero.'); } catch (error) { saveMessage(error.message); } }}>Guardar servicios</button></section><section className="admin-card"><h3>Horario laboral</h3><form onSubmit={addHour} className="admin-form horizontal"><select value={hour.weekday} onChange={(event) => setHour({ ...hour, weekday: event.target.value })}>{weekdays.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select><input type="time" value={hour.startTime} onChange={(event) => setHour({ ...hour, startTime: event.target.value })}/><input type="time" value={hour.endTime} onChange={(event) => setHour({ ...hour, endTime: event.target.value })}/><button>Agregar</button></form>{hours.map((item) => <p className="admin-line-item" key={item.id}>{weekdays[item.weekday - 1]} · {String(item.startTime).slice(0, 5)}–{String(item.endTime).slice(0, 5)}<button className="quiet" onClick={async () => { await api.deleteWorkingHour(barberId, item.id); setHours((await api.workingHours(barberId)).workingHours); }}>Eliminar</button></p>)}</section><section className="admin-card"><h3>Descansos y bloqueos</h3><form onSubmit={addBlock} className="admin-form"><input type="datetime-local" required value={block.startsAt} onChange={(event) => setBlock({ ...block, startsAt: event.target.value })}/><input type="datetime-local" required value={block.endsAt} onChange={(event) => setBlock({ ...block, endsAt: event.target.value })}/><input placeholder="Motivo (descanso, permiso, etc.)" value={block.reason} onChange={(event) => setBlock({ ...block, reason: event.target.value })}/><button>Bloquear horario</button></form>{blocks.map((item) => <p className="admin-line-item" key={item.id}>{new Date(item.startsAt).toLocaleString('es-BO')}<small>{item.reason || 'Sin motivo'}</small><button className="quiet" onClick={async () => { await api.deleteBlock(barberId, item.id); setBlocks((await api.blocks(barberId)).blocks); }}>Eliminar</button></p>)}</section></div>}</div>}

    {activeTab === 'clientes' && <section className="admin-card"><div className="admin-card-heading"><div><h3>Clientes registrados</h3><p>{clients.length} cliente(s) en el sistema.</p></div></div><div className="admin-users-table">{clients.map((item) => <article key={item.id}><div className="user-avatar">{item.firstName?.slice(0, 1)}{item.lastName?.slice(0, 1)}</div><div><b>{item.firstName} {item.lastName}</b><span>{item.email}</span><small>{item.phone || 'Sin teléfono registrado'} · {item.appointmentCount ?? 0} cita(s)</small></div><span className={item.isActive ? 'user-active' : 'user-inactive'}>{item.isActive ? 'Activo' : 'Inactivo'}</span><button className="quiet" onClick={async () => { try { await api.setUserActive(item.id, !item.isActive); await refresh(); saveMessage(`Cliente ${item.isActive ? 'desactivado' : 'activado'}.`); } catch (error) { saveMessage(error.message); } }}>{item.isActive ? 'Desactivar' : 'Activar'}</button></article>)}</div></section>}

    {activeTab === 'reportes' && <div className="admin-report-grid"><section className="admin-card"><p className="section-label">Reporte de citas</p><h3>Exporta la información filtrada</h3><p>Incluye cliente, servicio, barbero, fecha y estado de las {appointments.length} citas consultadas.</p><button onClick={exportReport}>Descargar CSV</button></section><section className="admin-card"><p className="section-label">Resumen operativo</p><h3>Indicadores actuales</h3><p>{metrics.completed ?? 0} citas atendidas, {metrics.cancelled ?? 0} canceladas y {metrics.recurringClients ?? 0} clientes recurrentes dentro del rango seleccionado.</p><button className="quiet" onClick={() => setActiveTab('dashboard')}>Ver dashboard</button></section></div>}
  </section>;
}

function AdminMetric({ label, value, note }) { return <article className="admin-metric"><span>{label}</span><b>{value}</b><small>{note}</small></article>; }

function AdminBars({ title, data, empty }) {
  const maximum = Math.max(...data.map((item) => Number(item.total)), 1);
  return <section className="admin-card admin-bars"><h3>{title}</h3>{data.length ? <div>{data.map((item) => <article key={item.name ?? item.label}><div><span>{item.name ?? item.label}</span><b>{item.total}</b></div><i><em style={{ width: `${(Number(item.total) / maximum) * 100}%` }}></em></i></article>)}</div> : <p className="admin-empty">{empty}</p>}</section>;
}

function ActionIcon({ name }) {
  const paths = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18M8 14h3M8 17h3"/></>,
    directions: <><path d="M12 21s7-5.1 7-11A7 7 0 0 0 5 10c0 5.9 7 11 7 11Z"/><circle cx="12" cy="10" r="2.3"/></>,
    location: <><path d="M4 7.5 12 4l8 3.5-8 3-8-3Z"/><path d="m4 12 8 3 8-3M4 16.5l8 3 8-3"/></>,
    edit: <><path d="m4 16.5-.8 3.3 3.3-.8L18 7.5l-2.6-2.6L4 16.5Z"/><path d="m13.8 6.5 2.6 2.6"/></>,
    cancel: <><circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6m0-6-6 6"/></>
  };
  return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function AdminPortal() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('btm_user') ?? 'null'));
  const [services, setServices] = useState([]);
  const [barbers, setBarbers] = useState([]);
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');

  const isAdmin = session?.role === 'ADMINISTRADOR';
  const reloadCatalog = async () => {
    const [serviceResult, barberResult] = await Promise.all([api.adminServices(), api.adminBarbers()]);
    setServices(serviceResult.services);
    setBarbers(barberResult.barbers);
  };

  useEffect(() => {
    if (isAdmin) reloadCatalog().catch((requestError) => setError(requestError.message));
  }, [isAdmin]);

  useEffect(() => {
    if (session?.role === 'BARBERO') window.location.replace('/barbero');
  }, [session]);

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

  if (!isAdmin) return <main className="admin-login-page">
    <a className="admin-login-brand" href="/">BTM<span>.</span></a>
    <section>
      <p className="section-label">Acceso del equipo</p>
      <h1>Administración y barberos</h1>
      <p>Un solo ingreso para el personal. Según tu rol, el sistema abrirá el panel administrativo o tu agenda de barbero.</p>
      {session?.role === 'CLIENTE' && <p className="admin-login-warning">Hay una sesión de cliente activa. Las cuentas de cliente solo ingresan durante la reserva.</p>}
      {error && <p className="admin-login-error">{error}</p>}
      <form onSubmit={login}>
        <label>Correo electrónico<input type="email" required autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })}/></label>
        <label>Contraseña<input type="password" required minLength="8" autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })}/></label>
        <button>Ingresar</button>
      </form>
      <a className="admin-recovery-link" href="/recuperar-contrasena">¿Olvidaste tu contraseña?</a>
      <a className="admin-back-home" href="/">← Volver al sitio público</a>
    </section>
  </main>;

  return <main className="admin-portal">
    <header><a href="/">BTM<span>.</span></a><div><span>Administrador: {session.firstName}</span><button onClick={() => { clearSession(); setSession(null); }}>Cerrar sesión</button></div></header>
    <div className="admin-portal-heading"><p className="section-label">Panel de administración</p><h1>Gestión de Barber Team Machine</h1><p>Administra la agenda, los servicios, el equipo y los usuarios desde un solo lugar.</p></div>
    <AdminPanel services={services} barbers={barbers} reloadCatalog={reloadCatalog}/>
  </main>;
}

function BarberPortal() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('btm_user') ?? 'null'));
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState('');
  const isBarber = session?.role === 'BARBERO';

  useEffect(() => {
    if (!isBarber) {
      window.location.replace('/admin');
      return;
    }
    api.barberDashboard().then(setDashboard).catch((requestError) => setError(requestError.message));
  }, [isBarber]);

  if (!isBarber) return <main className="admin-login-page"><a className="admin-login-brand" href="/">BTM<span>.</span></a><section><p className="section-label">Acceso del equipo</p><h1>Redirigiendo al acceso</h1><p>El inicio de sesión del personal se realiza desde un único formulario.</p><a className="admin-back-home" href="/admin">Ir al acceso del equipo →</a></section></main>;

  const appointments = dashboard?.appointments ?? [];
  const now = new Date();
  const today = appointments.filter((appointment) => new Date(appointment.startsAt).toDateString() === now.toDateString());
  const upcoming = appointments.filter((appointment) => new Date(appointment.startsAt) >= now && !['CANCELLED', 'NO_SHOW'].includes(appointment.status));
  return <main className="barber-portal"><header><a href="/">BTM<span>.</span></a><div><span>{dashboard?.barber.displayName}</span><button onClick={() => { clearSession(); setSession(null); }}>Cerrar sesión</button></div></header><section className="barber-hero"><p className="section-label">Mi agenda</p><h1>Hola, {dashboard?.barber.displayName?.split(' ')[0]}.</h1><p>Estas son exclusivamente las citas asignadas a ti.</p><div><article><b>{today.length}</b><span>Citas de hoy</span></article><article><b>{upcoming.length}</b><span>Próximas citas</span></article><article><b>{dashboard?.services.length ?? 0}</b><span>Servicios asignados</span></article></div></section><section className="barber-dashboard"><div><h2>Agenda de hoy</h2>{today.length ? <div className="barber-appointments">{today.map((appointment) => <article key={appointment.id}><time>{new Date(appointment.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</time><div><b>{appointment.clientName}</b><span>{appointment.serviceName} · {appointment.durationMinutes} min</span></div><i className={appointment.status.toLowerCase()}>{appointment.status}</i></article>)}</div> : <p className="barber-empty">No tienes citas para hoy.</p>}</div><aside><h2>Mi información</h2><b>Servicios</b><p>{dashboard?.services.map((service) => service.name).join(' · ') || 'Sin servicios asignados'}</p><b>Horario laboral</b><p>{dashboard?.workingHours.length ? 'Configurado por administración' : 'Sin horario configurado'}</p></aside></section><section className="barber-upcoming"><h2>Próximas citas</h2>{upcoming.length ? upcoming.map((appointment) => <article key={appointment.id}><div><b>{appointment.serviceName}</b><span>{appointment.clientName}</span></div><time>{new Date(appointment.startsAt).toLocaleDateString('es-BO', { weekday: 'short', day: 'numeric', month: 'short' })} · {new Date(appointment.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</time><i>{appointment.status}</i></article>) : <p className="barber-empty">No tienes próximas citas.</p>}</section></main>;
}

function AppointmentDetail({ appointment, statusLabel, onCancel, onAddToCalendar }) {
  const startsAt = new Date(appointment.startsAt);
  const endsAt = new Date(appointment.endsAt);
  const dateLabel = startsAt.toLocaleDateString('es-BO', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  const timeLabel = startsAt.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
  const canManage = ['PENDING', 'CONFIRMED'].includes(appointment.status);
  return <aside className="appointment-detail">
    <div className="appointment-banner"><span>BTM</span><b>BARBER TEAM<br/>MACHINE</b><small>COCHABAMBA</small></div>
    <div className="appointment-detail-body">
      <p className={`appointment-status ${appointment.status.toLowerCase()}`}>{statusLabel[appointment.status] ?? appointment.status}</p>
      <h2>{dateLabel} a las {timeLabel}</h2>
      <p className="appointment-duration">◷ {Math.round((endsAt - startsAt) / 60000)} min de duración</p>
      <div className="appointment-actions">
        <button onClick={() => onAddToCalendar(appointment)}><ActionIcon name="calendar"/><span>Añadir al calendario</span><i>›</i></button>
        <a href="https://maps.app.goo.gl/At4qrWe6P2KrDCyW9" target="_blank" rel="noreferrer"><ActionIcon name="directions"/><span>Cómo llegar</span><i>›</i></a>
        <a href="https://maps.app.goo.gl/At4qrWe6P2KrDCyW9" target="_blank" rel="noreferrer"><ActionIcon name="location"/><span>Ver ubicación</span><i>›</i></a>
      </div>
      <div className="appointment-summary-section"><h3>Resumen</h3><p><span>{appointment.serviceName}<small>{Math.round((endsAt - startsAt) / 60000)} min con {appointment.barberName}</small></span><b>Bs {Number(appointment.price ?? 0).toFixed(0)}</b></p><p className="appointment-total"><b>Total</b><b>Bs {Number(appointment.price ?? 0).toFixed(0)}</b></p></div>
      <div className="appointment-policy"><h3>Más detalles</h3><b>Política de cancelación</b><p>Puedes cancelar en cualquier momento antes de tu cita.</p>{canManage && <div><a href={`/reservar/cita?service=${appointment.serviceId}&barber=${appointment.barberId}&reschedule=${appointment.id}`}><ActionIcon name="edit"/><span>Cambiar cita</span><i>›</i></a><button onClick={() => onCancel(appointment)}><ActionIcon name="cancel"/><span>Cancelar cita</span><i>›</i></button></div>}</div>
      <div className="appointment-location"><h3>Cómo llegar</h3><iframe className="map-preview" title="Ubicación de Barber Team Machine" src="https://maps.google.com/maps?q=Buenos%20Aires%20130%2C%20Cochabamba%2C%20Bolivia&z=16&output=embed" loading="lazy"/><b>Buenos Aires 130, Cochabamba, Bolivia</b><a href="https://maps.app.goo.gl/At4qrWe6P2KrDCyW9" target="_blank" rel="noreferrer">Cómo llegar ↗</a></div>
      <small className="appointment-reference">Referencia de reserva #{appointment.id}</small>
    </div>
  </aside>;
}

function CancelAppointmentModal({ appointment, onClose, onConfirm }) {
  const startsAt = new Date(appointment.startsAt);
  return <div className="cancel-modal-backdrop" role="dialog" aria-modal="true" aria-label="Cancelar cita">
    <section className="cancel-modal">
      <div className="cancel-modal-actions"><button onClick={onClose}>Volver</button><button onClick={onConfirm}>Sí, cancelar</button></div>
      <div className="cancel-modal-content">
        <p className="section-label">Gestionar cita</p>
        <h1>¿Estás seguro de que deseas cancelar?</h1>
        <article><div className="cancel-brand">BTM</div><div><b>Barber Team Machine</b><span>{startsAt.toLocaleDateString('es-BO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} a las {startsAt.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</span><small>Bs {Number(appointment.price ?? 0).toFixed(0)} · {appointment.serviceName}</small></div></article>
        <p>¿No estás seguro? Ponte en contacto directamente con Barber Team Machine.</p>
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
        <label>Número de teléfono<div className="client-phone"><span>+591</span><input inputMode="numeric" maxLength="12" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value.replace(/[^0-9]/g, '') })}/></div></label>
        <label>Correo electrónico<input value={session.email} disabled/></label>
        <button className="client-primary">Guardar cambios</button>
      </form> : <>
        <section className="profile-phone-card"><b>Teléfono de contacto</b><p>{profile.phone ? `+591 ${profile.phone}` : 'Aún no registraste un número.'}</p><span>{profile.phone ? 'Usaremos este número para comunicarnos sobre tu cita.' : 'Añádelo desde Editar para recibir avisos.'}</span></section>
        <dl className="profile-details"><div><dt>Nombre</dt><dd>{session.firstName}</dd></div><div><dt>Apellido</dt><dd>{session.lastName}</dd></div><div><dt>Número de teléfono</dt><dd>{profile.phone ? `+591 ${profile.phone}` : 'No registrado'}</dd></div><div><dt>Correo electrónico</dt><dd>{session.email}</dd></div></dl>
        <button className="profile-password-button" onClick={() => setShowPasswordModal(true)}>⌑ &nbsp; Cambiar contraseña</button>
      </>}
    </article>
    {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} onSave={onChangePassword}/>} 
  </section>;
}

function ClientArea() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('btm_user') ?? 'null'));
  const [appointments, setAppointments] = useState([]);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState(null);
  const [appointmentToCancel, setAppointmentToCancel] = useState(null);
  const [activeTab, setActiveTab] = useState(() => new URLSearchParams(window.location.search).get('tab') === 'perfil' ? 'perfil' : 'historial');
  const [profile, setProfile] = useState(() => ({ firstName: session?.firstName ?? '', lastName: session?.lastName ?? '', phone: session?.phone?.replace(/^\+591\s?/, '') ?? '' }));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session) return;
    api.appointments().then((result) => setAppointments(result.appointments)).catch((requestError) => setError(requestError.message));
  }, [session]);

  function changeTab(tab) {
    setActiveTab(tab);
    window.history.replaceState(null, '', `/mi-cuenta?tab=${tab}`);
  }

  async function saveProfile(event) {
    event.preventDefault();
    try {
      const result = await api.updateProfile({ ...profile, phone: profile.phone ? `+591 ${profile.phone.replace(/\D/g, '')}` : null });
      setSession(result.user);
      localStorage.setItem('btm_user', JSON.stringify(result.user));
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
      await api.cancelAppointment(appointment.id);
      setAppointments((result) => result.map((item) => item.id === appointment.id ? { ...item, status: 'CANCELLED' } : item));
      setAppointmentToCancel(null);
      setMessage('La cita fue cancelada.');
    } catch (cancelError) {
      setError(cancelError.message);
    }
  }

  function addToCalendar(appointment) {
    const format = (value) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const calendar = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:btm-${appointment.id}\nDTSTAMP:${format(new Date())}\nDTSTART:${format(appointment.startsAt)}\nDTEND:${format(appointment.endsAt)}\nSUMMARY:${appointment.serviceName} - Barber Team Machine\nLOCATION:Buenos Aires 130, Cochabamba, Bolivia\nDESCRIPTION:Con ${appointment.barberName}\nEND:VEVENT\nEND:VCALENDAR`;
    const url = URL.createObjectURL(new Blob([calendar], { type: 'text/calendar' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `cita-btm-${appointment.id}.ics`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!session) return <main className="client-auth-empty"><h1>Inicia sesión para ver tu perfil e historial.</h1><a href="/reservar/cita">Ir a reservas</a></main>;
  const upcoming = appointments.filter((appointment) => new Date(appointment.startsAt) >= new Date() && !['CANCELLED', 'NO_SHOW'].includes(appointment.status));
  const selectedAppointment = appointments.find((appointment) => String(appointment.id) === String(selectedAppointmentId)) ?? upcoming[0] ?? appointments[0];
  const statusLabel = { PENDING: 'Pendiente de confirmación', CONFIRMED: 'Confirmada', COMPLETED: 'Atendida', CANCELLED: 'Cancelada', NO_SHOW: 'No asistió' };

  return <main className="client-area">
    <header className="client-header"><a href="/">BTM<span>.</span></a><div><span>{session.firstName} {session.lastName}</span><button onClick={() => { clearSession(); window.location.assign('/'); }}>Cerrar sesión</button></div></header>
    <div className="client-layout">
      <aside className="client-menu"><p>MI CUENTA</p><strong>{session.firstName} {session.lastName}</strong><button className={activeTab === 'perfil' ? 'active' : ''} onClick={() => changeTab('perfil')}>◉ &nbsp; Perfil</button><button className={activeTab === 'historial' ? 'active' : ''} onClick={() => changeTab('historial')}>◷ &nbsp; Historial</button></aside>
      <section className="client-content">
        {error && <p className="client-notice error">{error}</p>}{message && <p className="client-notice success">{message}</p>}
        {activeTab === 'perfil' && <ProfileView session={session} profile={profile} setProfile={setProfile} onSave={saveProfile} onChangePassword={changePassword}/>} 
        {activeTab === 'perfil' && <div className="client-profile"><p className="section-label">Perfil</p><h1>Tu información</h1><p>Estos datos se usan para identificar y contactar tu reserva.</p><form onSubmit={saveProfile}><label>Nombre<input required value={profile.firstName} onChange={(event) => setProfile({ ...profile, firstName: event.target.value })}/></label><label>Apellido<input required value={profile.lastName} onChange={(event) => setProfile({ ...profile, lastName: event.target.value })}/></label><label>Correo electrónico<input value={session.email} disabled/></label><label>Número celular<div className="client-phone"><span>+591</span><input inputMode="numeric" maxLength="12" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value.replace(/[^0-9]/g, '') })}/></div></label><button className="client-primary">Guardar cambios</button></form></div>}
        {activeTab === 'historial' && <div className="client-history"><p className="section-label">Historial</p><h1>Mis citas</h1><div className="history-filters"><button className="active">Citas</button><button disabled>Beneficios</button><button disabled>Favoritos</button></div><h2>Próximas <span>{upcoming.length}</span></h2>{appointments.length ? <div className="history-grid"><div className="history-list">{appointments.map((appointment) => <button className={selectedAppointment?.id === appointment.id ? 'active' : ''} key={appointment.id} onClick={() => setSelectedAppointmentId(appointment.id)}><b>{appointment.serviceName}</b><span>{new Date(appointment.startsAt).toLocaleDateString('es-BO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · {new Date(appointment.startsAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</span><small>Con {appointment.barberName}</small></button>)}</div>{selectedAppointment && <AppointmentDetail appointment={selectedAppointment} statusLabel={statusLabel} onCancel={setAppointmentToCancel} onAddToCalendar={addToCalendar}/>}</div> : <div className="history-empty"><b>◷</b><h2>Aún no tienes citas.</h2><p>Cuando confirmes una reserva aparecerá aquí.</p><a href="/reservar">Reservar una cita</a></div>}</div>}
      </section>
    </div>
    {appointmentToCancel && <CancelAppointmentModal appointment={appointmentToCancel} onClose={() => setAppointmentToCancel(null)} onConfirm={() => cancelAppointment(appointmentToCancel)}/>} 
  </main>;
}

function App() {
  if (window.location.pathname === '/recuperar-contrasena') return <PasswordRecoveryPage />;
  if (window.location.pathname === '/reservar/cita') return <ReservationWizard />;
  if (window.location.pathname === '/reservar') return <BookingPage />;
  if (window.location.pathname === '/mi-cuenta') return <ClientArea />;
  if (window.location.pathname === '/admin') return <AdminPortal />;
  if (window.location.pathname === '/barbero') return <BarberPortal />;
  const [services, setServices] = useState([]); const [barbers, setBarbers] = useState([]); const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('btm_user') ?? 'null'));
  const [appointments, setAppointments] = useState([]); const [notifications, setNotifications] = useState([]); const [selection, setSelection] = useState({ serviceId: '', barberId: '', date: '' }); const [slots, setSlots] = useState([]); const [reschedulingId, setReschedulingId] = useState(null);
  const [authMode, setAuthMode] = useState('login'); const [authForm, setAuthForm] = useState({ email: '', password: '', firstName: '', lastName: '' }); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const loadCatalog = async () => { const [s, b] = await Promise.all([api.services(), api.barbers()]); setServices(s.services); setBarbers(b.barbers); };
  useEffect(() => { loadCatalog().catch((e) => setError(e.message)); }, []);
  useEffect(() => { if (session) Promise.all([api.appointments(), api.notifications()]).then(([a, n]) => { setAppointments(a.appointments); setNotifications(n.notifications); }).catch((e) => setError(e.message)); }, [session]);
  async function authenticate(e) { e.preventDefault(); try { const result = authMode === 'login' ? await api.login(authForm) : await api.register(authForm); saveSession(result); setSession(result.user); setMessage('Sesión iniciada correctamente.'); } catch (error) { setError(error.message); } }
  async function loadSlots() { try { setSlots((await api.availability(selection.barberId, selection.serviceId, selection.date)).slots); } catch (e) { setError(e.message); } }
  async function book(slot) { try { if (reschedulingId) { await api.rescheduleAppointment(reschedulingId, slot.startsAt); setReschedulingId(null); setMessage('Reprogramación registrada y pendiente de confirmación.'); } else { await api.createAppointment({ barberId: selection.barberId, serviceId: selection.serviceId, startsAt: slot.startsAt }); setMessage('Solicitud registrada y pendiente de confirmación.'); } setAppointments((await api.appointments()).appointments); setSlots((items) => items.filter((item) => item.startsAt !== slot.startsAt)); } catch (e) { setError(e.message); } }
  const goToBooking = () => window.open('/reservar', '_blank', 'noopener');
  return <main className="app-shell"><Landing servicesCount={services.length} barbersCount={barbers.length} onReserve={goToBooking}/></main>;
}

export default App;
