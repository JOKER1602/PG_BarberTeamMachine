import { useEffect, useState } from 'react';
import { api, clearSession } from '../api.js';
import { tenantHref } from '../tenant.js';
import BrandMark from '../components/BrandMark.jsx';

function useAutoDismiss(message, dismiss, delay = 4500) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => dismiss(''), delay);
    return () => window.clearTimeout(timer);
  }, [message, dismiss, delay]);
}

// Tras cambiar la contraseña, la pestaña (abierta desde el correo) se cierra
// sola. Los navegadores solo dejan cerrar pestañas abiertas por un script, así
// que si no se puede, se lleva a la persona al inicio de sesión de su barbería.
export const CLOSE_AFTER_SECONDS = 5;

export function closeOrGoToLogin({ win = window, loginHref = tenantHref('/?login=1'), wait = 300 } = {}) {
  try { win.close(); } catch { /* el navegador no lo permite */ }
  win.setTimeout(() => { if (!win.closed) win.location.assign(loginHref); }, wait);
}

function useCloseCountdown(active) {
  const [seconds, setSeconds] = useState(CLOSE_AFTER_SECONDS);
  useEffect(() => {
    if (!active) return undefined;
    if (seconds <= 0) { closeOrGoToLogin(); return undefined; }
    const timer = window.setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [active, seconds]);
  return seconds;
}

export default function PasswordRecoveryPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // done: la contraseña ya se cambió. Ese aviso no se oculta solo.
  const [done, setDone] = useState(false);
  useAutoDismiss(done ? '' : message, setMessage, 6000);
  const secondsLeft = useCloseCountdown(done);

  async function submit(event) {
    event.preventDefault();
    setError(''); setMessage(''); setLoading(true);
    try {
      if (token) {
        if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');
        const result = await api.resetPassword({ token, password });
        clearSession();
        setMessage(`${result.message} Ya puedes iniciar sesión.`);
        setDone(true);
      } else {
        const result = await api.requestPasswordReset(email);
        setMessage(result.message);
      }
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }

  return <main className="password-recovery-page"><section className="password-recovery-card">
    <a className="recovery-logo" href={tenantHref('/')}><BrandMark/></a>
    <p className="section-label">Acceso seguro</p>
    <h1>{token ? 'Crea una nueva contraseña' : 'Recupera tu contraseña'}</h1>
    <p>{token ? 'Elige una contraseña nueva para volver a ingresar a tu cuenta.' : 'Escribe tu correo y te enviaremos un enlace válido por 30 minutos.'}</p>
    {message ? <><div className="recovery-message success" role="status">{message}</div>{done && <><p className="recovery-closing" aria-live="polite">{secondsLeft > 0 ? `Esta pestaña se cerrará en ${secondsLeft} s.` : 'Cerrando…'}</p><a className="wizard-primary recovery-login-cta" href={tenantHref('/?login=1')}>Iniciar sesión ahora</a></>}</> : <form onSubmit={submit}>
      {token ? <><label>Nueva contraseña<input type="password" minLength="8" required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)}/></label><label>Confirmar contraseña<input type="password" minLength="8" required autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/></label></> : <label>Correo electrónico<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)}/></label>}
      {error && <div className="recovery-message error">{error}</div>}
      <button className="wizard-primary" disabled={loading}>{loading ? 'Procesando...' : token ? 'Actualizar contraseña' : 'Enviar enlace'}</button>
    </form>}
    <a className="recovery-back" href={tenantHref(token ? '/?login=1' : '/')}>← Volver</a>
  </section></main>;
}
