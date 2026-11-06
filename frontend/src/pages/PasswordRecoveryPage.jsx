import { useEffect, useState } from 'react';
import { api, clearSession } from '../api.js';
import { tenantHref } from '../tenant.js';

function useAutoDismiss(message, dismiss, delay = 4500) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => dismiss(''), delay);
    return () => window.clearTimeout(timer);
  }, [message, dismiss, delay]);
}

export default function PasswordRecoveryPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useAutoDismiss(message, setMessage, 6000);

  async function submit(event) {
    event.preventDefault();
    setError(''); setMessage(''); setLoading(true);
    try {
      if (token) {
        if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');
        const result = await api.resetPassword({ token, password });
        clearSession();
        setMessage(`${result.message} Ya puedes iniciar sesión.`);
      } else {
        const result = await api.requestPasswordReset(email);
        setMessage(result.message);
      }
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }

  return <main className="password-recovery-page"><section className="password-recovery-card">
    <a className="recovery-logo" href={tenantHref('/')}>EMPYREAN<span> STUDIO</span></a>
    <p className="section-label">Acceso seguro</p>
    <h1>{token ? 'Crea una nueva contraseña' : 'Recupera tu contraseña'}</h1>
    <p>{token ? 'Elige una contraseña nueva para volver a ingresar a tu cuenta.' : 'Escribe tu correo y te enviaremos un enlace válido por 30 minutos.'}</p>
    {message ? <><div className="recovery-message success">{message}</div>{token && <a className="wizard-primary recovery-login-cta" href={tenantHref('/?login=1')}>Iniciar sesión</a>}</> : <form onSubmit={submit}>
      {token ? <><label>Nueva contraseña<input type="password" minLength="8" required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)}/></label><label>Confirmar contraseña<input type="password" minLength="8" required autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/></label></> : <label>Correo electrónico<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)}/></label>}
      {error && <div className="recovery-message error">{error}</div>}
      <button className="wizard-primary" disabled={loading}>{loading ? 'Procesando...' : token ? 'Actualizar contraseña' : 'Enviar enlace'}</button>
    </form>}
    <a className="recovery-back" href={token ? '/?login=1' : '/'}>← Volver</a>
  </section></main>;
}
