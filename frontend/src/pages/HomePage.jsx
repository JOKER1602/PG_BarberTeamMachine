import { useEffect, useState } from 'react';
import { api, saveSession } from '../api.js';
import { brandInitials, passwordRecoveryHref, tenantBrand, tenantHref } from '../tenant.js';
import BrandMark from '../components/BrandMark.jsx';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const namePattern = /^[\p{L}]+(?:[ '-][\p{L}]+)*$/u;
const phonePattern = /^[67]\d{7}$/;

function cleanName(value) {
  return value.replace(/[^\p{L}\s'-]/gu, '').replace(/\s+/g, ' ').replace(/^\s/, '');
}

function fieldStatus(value, isValid) {
  return !value ? 'neutral' : isValid ? 'valid' : 'invalid';
}

function RegistrationField({ label, status, helper, children, action }) {
  return <label className={`registration-field ${status}`}><span>{label}</span><span className="registration-control">{children}{action}{status !== 'neutral' && <i aria-hidden="true">{status === 'valid' ? '✓' : '!'}</i>}</span>{helper && <small>{helper}</small>}</label>;
}

function UnifiedLoginModal({ onClose }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [registration, setRegistration] = useState({ firstName: '', lastName: '', phone: '', email: '', password: '' });
  const [mode, setMode] = useState('login');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginSubmitted, setLoginSubmitted] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const loginChecks = { email: emailPattern.test(form.email), password: form.password.length > 0 };
  const loginIsValid = loginChecks.email && loginChecks.password;
  const registrationChecks = {
    firstName: namePattern.test(registration.firstName.trim()),
    lastName: namePattern.test(registration.lastName.trim()),
    phone: phonePattern.test(registration.phone),
    email: emailPattern.test(registration.email),
    passwordLength: registration.password.length >= 8,
    passwordLower: /[a-z]/.test(registration.password),
    passwordUpper: /[A-Z]/.test(registration.password),
    passwordNumber: /\d/.test(registration.password)
  };
  const passwordIsValid = registrationChecks.passwordLength && registrationChecks.passwordLower && registrationChecks.passwordUpper && registrationChecks.passwordNumber;
  const registrationIsValid = registrationChecks.firstName && registrationChecks.lastName && registrationChecks.phone && registrationChecks.email && passwordIsValid;

  function openMode(nextMode) {
    setMode(nextMode);
    setError('');
    setLoginSubmitted(false);
  }

  function continueToAccount(result) {
    saveSession(result);
    const destination = result.user.role === 'ADMINISTRADOR' ? '/admin' : result.user.role === 'BARBERO' ? '/barbero' : '/mi-cuenta?tab=historial';
    window.location.assign(tenantHref(destination));
  }

  async function submit(event) {
    event.preventDefault();
    setLoginSubmitted(true);
    if (!loginIsValid) {
      setError('Revisa los campos marcados para continuar.');
      return;
    }
    setError(''); setLoading(true);
    try {
      const result = await api.login(form);
      continueToAccount(result);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }

  async function register(event) {
    event.preventDefault();
    if (!registrationIsValid) {
      setError('Revisa los campos marcados antes de crear tu cuenta.');
      return;
    }
    setError(''); setLoading(true);
    try {
      const result = await api.register(registration);
      continueToAccount(result);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }

  const isRegistering = mode === 'register';
  return <div className="home-login-backdrop" role="dialog" aria-modal="true" aria-label={isRegistering ? 'Crear cuenta' : 'Iniciar sesión'}><section className="home-login-modal"><button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar">×</button><p className="section-label">{isRegistering ? 'Nueva cuenta' : 'Acceso'}</p><h2>{isRegistering ? 'Crea tu cuenta' : 'Inicia sesión'}</h2><p>{isRegistering ? 'Regístrate como cliente para reservar y consultar tus citas.' : 'Usa el correo y la contraseña de tu cuenta. El sistema abrirá automáticamente tu espacio correspondiente.'}</p>{isRegistering ? <form className="home-registration-form" noValidate onSubmit={register}><div className="home-registration-names"><RegistrationField label="Nombre" status={fieldStatus(registration.firstName, registrationChecks.firstName)} helper={registration.firstName && !registrationChecks.firstName ? 'Usa solo letras.' : ''}><input type="text" required autoComplete="given-name" value={registration.firstName} onChange={(event) => setRegistration({ ...registration, firstName: cleanName(event.target.value) })}/></RegistrationField><RegistrationField label="Apellido" status={fieldStatus(registration.lastName, registrationChecks.lastName)} helper={registration.lastName && !registrationChecks.lastName ? 'Usa solo letras.' : ''}><input type="text" required autoComplete="family-name" value={registration.lastName} onChange={(event) => setRegistration({ ...registration, lastName: cleanName(event.target.value) })}/></RegistrationField></div><RegistrationField label="Celular" status={fieldStatus(registration.phone, registrationChecks.phone)} helper={registration.phone && !registrationChecks.phone ? 'Ingresa 8 dígitos; debe comenzar con 6 o 7.' : 'Número móvil boliviano de 8 dígitos.'}><input type="tel" required inputMode="numeric" autoComplete="tel-national" placeholder="7XXXXXXX" maxLength="8" value={registration.phone} onChange={(event) => setRegistration({ ...registration, phone: event.target.value.replace(/\D/g, '').slice(0, 8) })}/></RegistrationField><RegistrationField label="Correo electrónico" status={fieldStatus(registration.email, registrationChecks.email)} helper={registration.email && !registrationChecks.email ? 'Ingresa un correo válido.' : ''}><input type="email" required autoComplete="email" placeholder="usuario@ejemplo.com" value={registration.email} onChange={(event) => setRegistration({ ...registration, email: event.target.value.replace(/\s/g, '') })}/></RegistrationField><RegistrationField label="Contraseña" status={fieldStatus(registration.password, passwordIsValid)} helper="Usa mayúscula, minúscula, número y 8 caracteres o más."><input type="password" required autoComplete="new-password" value={registration.password} onChange={(event) => setRegistration({ ...registration, password: event.target.value })}/></RegistrationField><ul className="password-checklist" aria-label="Requisitos de contraseña"><li className={registrationChecks.passwordLength ? 'valid' : ''}>8 caracteres o más</li><li className={registrationChecks.passwordUpper ? 'valid' : ''}>Una mayúscula</li><li className={registrationChecks.passwordLower ? 'valid' : ''}>Una minúscula</li><li className={registrationChecks.passwordNumber ? 'valid' : ''}>Un número</li></ul>{error && <p className="home-login-error">{error}</p>}<button className="hero-cta" disabled={loading}>{loading ? 'Creando cuenta...' : 'Crear cuenta'} <span>↗</span></button></form> : <form className="home-login-form" noValidate onSubmit={submit}><RegistrationField label="Correo electrónico" status={loginSubmitted && !form.email ? 'invalid' : fieldStatus(form.email, loginChecks.email)} helper={loginSubmitted && !form.email ? 'Ingresa tu correo electrónico.' : form.email && !form.email.includes('@') ? 'Falta el símbolo @ en tu correo.' : form.email && !loginChecks.email ? 'Completa un correo válido.' : ''}><input type="email" autoComplete="email" placeholder="usuario@ejemplo.com" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value.replace(/\s/g, '') })}/></RegistrationField><RegistrationField label="Contraseña" status={loginSubmitted && !form.password ? 'invalid' : 'neutral'} helper={loginSubmitted && !form.password ? 'Ingresa tu contraseña.' : ''} action={<button className="password-visibility-toggle" type="button" onClick={() => setShowLoginPassword((visible) => !visible)} aria-label={showLoginPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} title={showLoginPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2.5 12s3.4-5.5 9.5-5.5S21.5 12 21.5 12s-3.4 5.5-9.5 5.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.6"/>{showLoginPassword && <path d="M4 4l16 16"/>}</svg></button>}><input type={showLoginPassword ? 'text' : 'password'} autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })}/></RegistrationField>{error && <p className="home-login-error">{error}</p>}<button className="hero-cta" disabled={loading}>{loading ? 'Ingresando...' : 'Continuar'} <span>↗</span></button></form>}{isRegistering ? <p className="home-login-switch">¿Ya tienes cuenta? <button type="button" onClick={() => openMode('login')}>Inicia sesión</button></p> : <><button className="home-login-create" type="button" onClick={() => openMode('register')}>Crear cuenta</button><a className="home-login-recovery" href={passwordRecoveryHref()}>¿Olvidaste tu contraseña?</a></>}</section></div>;
}

export default function HomePage({ services = [], barbersCount, settings, onReserve, session, initialLogin = false }) {
  const business = settings ?? { businessName: tenantBrand().name, address: '', city: tenantBrand().city, country: '', phone: '', whatsapp: '', hoursText: '', mapsUrl: null, description: 'Precisión, técnica y estilo para cada visita.' };
  const servicesCount = services.length;
  const tickerRepeats = servicesCount ? Math.max(1, Math.ceil(160 / services.reduce((length, service) => length + service.name.length + 3, 0))) : 0;
  const tickerServices = Array.from({ length: tickerRepeats }, () => services).flat();
  const [showLogin, setShowLogin] = useState(initialLogin);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const items = document.querySelectorAll('.reveal-on-scroll');
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add('reveal-visible'); observer.unobserve(entry.target); }
    }), { threshold: 0.14 });
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);
  const roleDestination = session?.role === 'ADMINISTRADOR' ? '/admin' : session?.role === 'BARBERO' ? '/barbero' : '/mi-cuenta?tab=historial';
  return <>
    <nav className="home-nav" aria-label="Navegación principal"><div><a className="brand-mark" href="#inicio"><BrandMark/></a><div className="home-nav-links"><a href="#nosotros">Nosotros</a><a href="#servicios">Servicios</a><a href="#ubicacion">Ubicación</a></div><div className="home-nav-actions">{session ? <a className="home-client-access" href={tenantHref(roleDestination)}>{session.role === 'CLIENTE' ? 'Mis citas' : 'Mi panel'} <span>↗</span></a> : <button className="home-client-access" type="button" onClick={() => setShowLogin(true)}>Iniciar sesión <svg className="header-login-icon" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.25"/><path d="M5.5 20c.65-3.35 3.05-5.1 6.5-5.1s5.85 1.75 6.5 5.1"/></svg></button>}<button className="home-mobile-menu-toggle" type="button" aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={menuOpen} aria-controls="home-mobile-menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? '×' : '☰'}</button></div><div id="home-mobile-menu" className="home-mobile-menu" hidden={!menuOpen}><a href="#nosotros" onClick={() => setMenuOpen(false)}>Nosotros</a><a href="#servicios" onClick={() => setMenuOpen(false)}>Servicios</a><a href="#ubicacion" onClick={() => setMenuOpen(false)}>Ubicación</a></div></div></nav>
    <section className="landing-hero" id="inicio"><div className="hero-copy"><p className="hero-kicker">Barbería{tenantBrand().city ? ` · ${tenantBrand().city}` : ''}</p><h1>PRECISIÓN<br/>PARA TU<br/><em>MEJOR ESTILO.</em></h1><p>Todo lo que necesitas para salir con una imagen cuidada: corte, barba y cejas, atendidos con técnica y atención al detalle.</p><div className="hero-actions"><button className="hero-cta" onClick={onReserve}>Reserva tu cita <span>↗</span></button><a className="secondary-home-cta" href="#nosotros">Conócenos ↓</a></div></div><div className="hero-side"><div><strong>{servicesCount || '—'}</strong><span>Servicios</span></div><i/><div><strong>{barbersCount || '—'}</strong><span>Barberos</span></div><i/><div><strong>6/7</strong><span>Días abiertos</span></div></div><div className="hero-meta"><span>{tenantBrand().name.toLocaleUpperCase('es')}{tenantBrand().city ? ` / ${tenantBrand().city}` : ''}</span><span>Desliza para descubrir ↓</span></div></section>
    <div className="service-ticker reveal-on-scroll" role="region" aria-label={servicesCount ? `Servicios: ${services.map((service) => service.name).join(', ')}` : 'Servicios'}>{servicesCount ? <div className="ticker-track" aria-hidden="true">{[0, 1].map((copy) => <span key={copy}>{tickerServices.map((service, index) => <span className="ticker-item" key={`${service.id}-${index}`}>{service.name}<b>•</b></span>)}</span>)}</div> : <div className="ticker-empty">Descubre nuestros servicios en línea</div>}</div>
    <section className="manifesto-section" id="nosotros"><div className="manifesto-title reveal-on-scroll"><p className="section-label">Nosotros</p><h2>NO ES SOLO<br/>UN CORTE.<br/><em>ES TU <span>EXPERIENCIA.</span></em></h2></div><aside className="monogram-panel reveal-on-scroll">{tenantBrand().logoUrl ? <img src={tenantBrand().logoUrl} alt={`Logo de ${tenantBrand().name}`}/> : <div className="brand-monogram-fallback" role="img" aria-label={`Logo de ${tenantBrand().name}`}>{brandInitials()}</div>}<p>{business.businessName}<br/>{business.city}, {business.country}<br/><br/>Corte · Barba · Cejas</p></aside><div className="manifesto-copy reveal-on-scroll"><p className="lead-copy"><strong>{business.businessName}</strong> es un espacio para hombres que entienden que cuidarse es una forma de mostrarse seguros.</p><p>{business.description}</p><p className="manifesto-quote">“Tu estilo habla antes que las palabras.”</p><div className="home-numbers"><div><b>{servicesCount || '—'}</b><span>Servicios</span></div><div><b>{barbersCount || '—'}</b><span>Barberos</span></div><div><b>6/7</b><span>Días abiertos</span></div><div><b>10AM</b><span>Apertura</span></div></div></div></section>
    <section className="value-strip" id="servicios"><article className="reveal-on-scroll"><b>01</b><h3>Obsesión por el detalle</h3><p>Cada corte, cada barba y cada perfilado se ejecuta con precisión y cuidado.</p></article><article className="reveal-on-scroll"><b>02</b><h3>Experiencia clara</h3><p>Un servicio directo, una agenda ordenada y tiempo bien aprovechado.</p></article><article className="reveal-on-scroll"><b>03</b><h3>Tu mejor versión</h3><p>Atención personalizada para que tu imagen transmita exactamente lo que buscas.</p></article></section>
    <section className="booking-invite" id="reservas"><div className="reveal-on-scroll"><p className="section-label">Agenda tu cita</p><h2>NUESTRO MENÚ<br/><em>EN LÍNEA.</em></h2><p>{servicesCount ? `Consulta los ${servicesCount} servicios disponibles, conoce al equipo y elige el horario que mejor se adapte a tu día.` : 'Conoce nuestros servicios y reserva en línea.'}</p><div className="hero-actions booking-actions"><button className="hero-cta" onClick={onReserve}>Reservar en {tenantBrand().name} <span>↗</span></button>{business.phone && <a className="secondary-home-cta" href={`tel:+591${String(business.phone ?? '').replace(/D/g, '').replace(/^591/, '')}`}>Llamar ahora ↗</a>}</div></div></section>
    <section className="location-section" id="ubicacion"><div className="reveal-on-scroll"><p className="section-label">Encuéntranos</p><h2>VISÍTANOS EN<br/><em>{business.city.toUpperCase()}.</em></h2></div><div className="location-content reveal-on-scroll"><iframe title={`Ubicación de ${business.businessName}`} src={`https://maps.google.com/maps?q=${encodeURIComponent(`${business.address}, ${business.city}, ${business.country}`)}&z=16&output=embed`} loading="lazy"/><div className="location-details"><article><b>Dirección</b><p>{business.address}<br/>{business.city}, {business.country}</p></article><article><b>Horario</b><p>{business.hoursText}</p></article><article><b>Contacto</b><p>+591 {business.phone}<br/><a href={business.mapsUrl} target="_blank" rel="noreferrer">Cómo llegar ↗</a></p></article></div><div className="location-actions"><a className="hero-cta" href={business.mapsUrl} target="_blank" rel="noreferrer">Cómo llegar <span>↗</span></a><button className="hero-cta" onClick={onReserve}>Reservar cita <span>↗</span></button></div></div><p className="closing-line reveal-on-scroll">Tu próximo buen corte está a una cita de distancia.</p></section>
    <footer className="home-footer"><div className="reveal-on-scroll"><a className="brand-mark" href="#inicio"><BrandMark/></a><p>{business.description}</p></div><div className="reveal-on-scroll"><b>Navegación</b><a href="#nosotros">Nosotros</a><a href="#ubicacion">Ubicación</a><a href="#reservas">Reservar</a></div><div className="reveal-on-scroll"><b>Servicios</b><a href="#servicios">Corte normal</a><a href="#servicios">Perfilado de barba</a><a href="#servicios">Perfilado de cejas</a></div><div className="reveal-on-scroll"><b>Contacto</b><span>{business.address}</span><span>{business.city}, {business.country}</span><a href={`tel:+591${business.phone}`}>+591 {business.phone}</a></div><small className="reveal-on-scroll">© 2026 {business.businessName}. Todos los derechos reservados.</small></footer>
    {showLogin && <UnifiedLoginModal onClose={() => setShowLogin(false)}/>}
  </>;
}
