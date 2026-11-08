import { useState } from 'react';
import { api, saveSession } from '../api.js';

// Primer acceso con contraseña temporal (barberos creados por la barbería y
// dueños creados por la plataforma): obliga a reemplazarla antes de continuar.
export default function RequiredPasswordChange({ session, onComplete, purpose = 'consultar tu agenda' }) {
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
    <p className="section-label">Primer acceso</p><h1>Crea tu contraseña personal</h1><p>Recibiste una contraseña temporal. Debes reemplazarla antes de {purpose}.</p>
    <form onSubmit={submit}>
      <label className={`required-password-field required-temporary-password ${temporaryPasswordError ? 'invalid' : ''}`}><span>Contraseña temporal</span><span className="required-password-control"><input type="password" required minLength="8" autoComplete="current-password" value={form.temporaryPassword} onChange={(event) => { setForm({ ...form, temporaryPassword: event.target.value }); setTemporaryPasswordError(''); }}/></span>{temporaryPasswordError && <small>{temporaryPasswordError}</small>}</label>
      <label className={`required-password-field ${fieldStatus(form.password, passwordIsValid)}`}><span>Nueva contraseña</span><span className="required-password-control"><input type="password" required minLength="8" autoComplete="new-password" value={form.password} onChange={(event) => { setForm({ ...form, password: event.target.value }); setNewPasswordError(''); }}/>{form.password && <i aria-hidden="true">{passwordIsValid ? '✓' : '!'}</i>}</span><small>Usa mayúscula, minúscula, número y 8 caracteres o más.</small></label>
      <ul className="password-checklist required-password-checklist" aria-label="Requisitos de contraseña"><li className={checks.length ? 'valid' : ''}>8 caracteres o más</li><li className={checks.upper ? 'valid' : ''}>Una mayúscula</li><li className={checks.lower ? 'valid' : ''}>Una minúscula</li><li className={checks.number ? 'valid' : ''}>Un número</li></ul>
      <label className={`required-password-field ${fieldStatus(form.confirmation, form.confirmation === form.password && passwordIsValid)}`}><span>Confirmar nueva contraseña</span><span className="required-password-control"><input type="password" required minLength="8" autoComplete="new-password" value={form.confirmation} onChange={(event) => { setForm({ ...form, confirmation: event.target.value }); setNewPasswordError(''); }}/>{form.confirmation && <i aria-hidden="true">{form.confirmation === form.password && passwordIsValid ? '✓' : '!'}</i>}</span>{newPasswordError ? <small>{newPasswordError}</small> : form.confirmation && form.confirmation !== form.password && <small>Las contraseñas no coinciden.</small>}</label>
      {error && <p className="password-change-error">{error}</p>}<button disabled={saving}>{saving ? 'Guardando...' : 'Guardar y continuar'}</button>
    </form>
  </section></main>;
}
