import { useEffect, useState } from 'react';
import { api, clearSession, getStoredSession, saveSession } from './api.js';
import HomePage from './pages/HomePage.jsx';
import PasswordRecoveryPage from './pages/PasswordRecoveryPage.jsx';
import BookingPage from './pages/BookingPage.jsx';
import ReservationWizard from './pages/ReservationWizard.jsx';
import ClientArea from './pages/ClientArea.jsx';
import AdminPortal from './pages/AdminPortal.jsx';
import BarberPortal from './pages/BarberPortal.jsx';

function App() {
  const path = window.location.pathname;
  const protectedRoutes = { '/mi-cuenta': 'CLIENTE', '/admin': 'ADMINISTRADOR', '/barbero': 'BARBERO' };
  const requiredRole = protectedRoutes[path];
  const [hasAccess, setHasAccess] = useState(() => !requiredRole ? true : null);

  useEffect(() => {
    if (!requiredRole) return undefined;
    let active = true;
    const validateAccess = async () => {
      setHasAccess(null);
      try {
        const result = await api.me();
        if (!active) return;
        saveSession(result);
        const allowed = result.user.role === requiredRole;
        setHasAccess(allowed);
        if (!allowed) window.location.replace('/?login=1');
      } catch {
        if (!active) return;
        clearSession();
        setHasAccess(false);
        window.location.replace('/?login=1');
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

  if (requiredRole && hasAccess !== true) return <main className="app-shell" aria-busy="true" />;
  if (path === '/recuperar-contrasena') return <PasswordRecoveryPage />;
  if (path === '/reservar/cita') return <ReservationWizard />;
  if (path === '/reservar') return <BookingPage />;
  if (path === '/mi-cuenta') return <ClientArea />;
  if (path === '/admin') return <AdminPortal />;
  if (path === '/barbero') return <BarberPortal />;

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

  const goToBooking = () => window.location.assign('/reservar');
  const initialLogin = new URLSearchParams(window.location.search).get('login') === '1';

  return <main className="app-shell">
    {error && <p className="notification home-load-error">{error}</p>}
    <HomePage services={services} barbersCount={barbers.length} settings={settings} onReserve={goToBooking} session={session} initialLogin={initialLogin}/>
  </main>;
}

export default App;
