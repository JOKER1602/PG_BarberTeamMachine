import { useEffect, useState } from 'react';
import { api, clearSession, getStoredSession, saveSession } from './api.js';
import { legacyRedirectTarget, parseTenantPath, setTenantBrand, tenantHref } from './tenant.js';
import HomePage from './pages/HomePage.jsx';
import PasswordRecoveryPage from './pages/PasswordRecoveryPage.jsx';
import BookingPage from './pages/BookingPage.jsx';
import ReservationWizard from './pages/ReservationWizard.jsx';
import ClientArea from './pages/ClientArea.jsx';
import AdminPortal from './pages/AdminPortal.jsx';
import BarberPortal from './pages/BarberPortal.jsx';

// Rutas de cada barbería, relativas a /t/:slug. Las protegidas exigen el rol
// efectivo de la persona EN ESA barbería (ver tenant.js#accessRoleFor).
const protectedRoutes = { '/mi-cuenta': 'CLIENTE', '/admin': 'ADMINISTRADOR', '/barbero': 'BARBERO' };

function TenantUnavailable({ status }) {
  const suspended = status === 403;
  return <main className="admin-login-page">
    <section>
      <p className="section-label">{suspended ? 'Barbería no disponible' : 'Barbería no encontrada'}</p>
      <h1>{suspended ? 'Esta barbería no está disponible temporalmente' : 'No encontramos esta barbería'}</h1>
      <p>{suspended ? 'Vuelve a intentarlo más tarde o comunícate directamente con la barbería.' : 'Revisa la dirección que abriste. Puede que el enlace esté incompleto o que la barbería haya cambiado de dirección.'}</p>
    </section>
  </main>;
}

function ProtectedRoute({ requiredRole, children }) {
  const [hasAccess, setHasAccess] = useState(null);

  useEffect(() => {
    let active = true;
    const validateAccess = async () => {
      setHasAccess(null);
      try {
        const result = await api.me();
        if (!active) return;
        saveSession(result);
        const allowed = result.user.role === requiredRole;
        setHasAccess(allowed);
        if (!allowed) window.location.replace(tenantHref('/?login=1'));
      } catch {
        if (!active) return;
        clearSession();
        setHasAccess(false);
        window.location.replace(tenantHref('/?login=1'));
      }
    };
    validateAccess();
    window.addEventListener('pageshow', validateAccess);
    window.addEventListener('storage', validateAccess);
    return () => {
      active = false;
      window.removeEventListener('pageshow', validateAccess);
      window.removeEventListener('storage', validateAccess);
    };
  }, [requiredRole]);

  if (hasAccess !== true) return <main className="app-shell" aria-busy="true" />;
  return children;
}

function HomeRoute() {
  const [services, setServices] = useState([]);
  const [barbers, setBarbers] = useState([]);
  const [settings, setSettings] = useState(null);
  const [session, setSession] = useState(() => getStoredSession()?.user ?? null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.services(), api.barbers(), api.businessSettings()])
      .then(([serviceResult, barberResult, settingsResult]) => {
        setServices(serviceResult.services);
        setBarbers(barberResult.barbers);
        setSettings(settingsResult.settings);
      })
      .catch((requestError) => setError(requestError.message));
  }, []);

  useEffect(() => {
    let active = true;
    api.me().then((result) => {
      if (!active) return;
      saveSession(result);
      setSession(result.user);
    }).catch(() => {
      if (!active) return;
      clearSession();
      setSession(null);
    });
    return () => { active = false; };
  }, []);

  const goToBooking = () => window.location.assign(tenantHref('/reservar'));
  const initialLogin = new URLSearchParams(window.location.search).get('login') === '1';

  return <main className="app-shell">
    {error && <p className="notification home-load-error">{error}</p>}
    <HomePage services={services} barbersCount={barbers.length} settings={settings} onReserve={goToBooking} session={session} initialLogin={initialLogin}/>
  </main>;
}

function TenantRoutes({ path }) {
  const [tenantStatus, setTenantStatus] = useState('loading');

  // Antes de mostrar la barbería se confirma que el slug existe y está activo.
  useEffect(() => {
    let active = true;
    fetchTenantStatus().then((status) => { if (active) setTenantStatus(status); });
    return () => { active = false; };
  }, []);

  if (tenantStatus === 'loading') return <main className="app-shell" aria-busy="true" />;
  if (tenantStatus !== 200) return <TenantUnavailable status={tenantStatus}/>;

  const requiredRole = protectedRoutes[path];
  const page = {
    '/reservar/cita': <ReservationWizard />,
    '/reservar': <BookingPage />,
    '/mi-cuenta': <ClientArea />,
    '/admin': <AdminPortal />,
    '/barbero': <BarberPortal />
  }[path] ?? <HomeRoute />;
  return requiredRole ? <ProtectedRoute requiredRole={requiredRole}>{page}</ProtectedRoute> : page;
}

async function fetchTenantStatus() {
  try {
    setTenantBrand(await api.tenant());
    return 200;
  } catch (error) {
    return /no está disponible/i.test(error.message) ? 403 : 404;
  }
}

// Página global: usa la marca de la barbería de origen (?t=slug) si existe; si
// no, se muestra con la marca genérica en lugar de la de otra barbería.
function RecoveryRoute() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    api.tenant().then(setTenantBrand).catch(() => setTenantBrand()).finally(() => setReady(true));
  }, []);
  if (!ready) return <main className="app-shell" aria-busy="true" />;
  return <PasswordRecoveryPage />;
}

function App() {
  const { pathname, search, hash } = window.location;
  if (pathname === '/recuperar-contrasena') return <RecoveryRoute />;

  const tenantPath = parseTenantPath(pathname);
  if (!tenantPath) {
    // Rutas antiguas sin slug (/reservar, /admin, ...) → barbería por defecto.
    const target = legacyRedirectTarget({ pathname, search, hash });
    if (target) window.location.replace(target);
    return <main className="app-shell" aria-busy="true" />;
  }
  return <TenantRoutes path={tenantPath.path} />;
}

export default App;
