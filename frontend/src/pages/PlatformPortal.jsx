import { useEffect, useState } from 'react';
import { api, clearSession } from '../api.js';

// Panel de los operadores de la plataforma: alta de barberías y cambio de
// estado. No muestra datos de clientes ni de citas de ninguna barbería.
const statusLabels = { TRIAL: 'Prueba', ACTIVE: 'Activa', SUSPENDED: 'Suspendida', CANCELLED: 'Dada de baja' };
const emptyForm = { displayName: '', slug: '', city: '', phone: '', address: '', status: 'TRIAL', ownerEmail: '', ownerFirstName: '', ownerLastName: '', ownerPassword: '' };

function slugify(value) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function PlatformLogin({ onLogin, notice }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(notice ?? '');
  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      const result = await api.login(form);
      if (!result.user.isPlatformAdmin) { setError('Esta cuenta no es operadora de la plataforma.'); return; }
      onLogin(result.user);
    } catch (loginError) { setError(loginError.message); }
  }
  return <main className="admin-login-page"><section>
    <p className="section-label">Plataforma</p>
    <h1>Acceso de operadores</h1>
    <p>Gestiona las barberías de la plataforma: altas, pruebas y suspensiones.</p>
    <form className="admin-form platform-login" onSubmit={submit}>
      <label>Correo electrónico<input type="email" required autoComplete="username" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })}/></label>
      <label>Contraseña<input type="password" required minLength="8" autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })}/></label>
      {error && <p className="password-change-error">{error}</p>}
      <button>Ingresar</button>
    </form>
  </section></main>;
}

export default function PlatformPortal() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [tenants, setTenants] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [slugTouched, setSlugTouched] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Plataforma';
    api.me().then((result) => setUser(result.user.isPlatformAdmin ? result.user : null)).catch(() => setUser(null)).finally(() => setChecking(false));
  }, []);

  const reload = () => api.platformTenants().then((result) => setTenants(result.tenants)).catch((requestError) => setError(requestError.message));
  useEffect(() => { if (user) reload(); }, [user]);

  async function createTenant(event) {
    event.preventDefault();
    setError(''); setMessage('');
    try {
      const result = await api.createTenant({
        slug: form.slug, displayName: form.displayName, status: form.status, city: form.city, phone: form.phone, address: form.address || undefined,
        owner: { email: form.ownerEmail, firstName: form.ownerFirstName || undefined, lastName: form.ownerLastName || undefined, temporaryPassword: form.ownerPassword || undefined }
      });
      setMessage(`${result.tenant.displayName} creada en /t/${result.tenant.slug}. ${result.owner.accountCreated ? 'Se creó la cuenta del dueño: deberá cambiar la contraseña temporal al entrar.' : 'El dueño ya tenía cuenta y ahora administra la barbería.'}`);
      setForm(emptyForm); setSlugTouched(false);
      await reload();
    } catch (requestError) { setError(requestError.message); }
  }

  async function changeStatus(tenant, status) {
    const warning = status === 'SUSPENDED' ? 'Su página y sus paneles dejarán de estar disponibles y no se enviarán recordatorios.'
      : status === 'CANCELLED' ? 'La barbería dejará de existir para clientes y personal (los datos se conservan).' : 'La barbería volverá a estar disponible.';
    if (!window.confirm(`¿Cambiar ${tenant.displayName} a «${statusLabels[status]}»?\n\n${warning}`)) return;
    setError(''); setMessage('');
    try {
      await api.updateTenant(tenant.slug, { status });
      setMessage(`${tenant.displayName}: ${statusLabels[status]}.`);
      await reload();
    } catch (requestError) { setError(requestError.message); }
  }

  async function logout() {
    await api.logout().catch(() => undefined);
    clearSession();
    setUser(null);
  }

  if (checking) return <main className="app-shell" aria-busy="true" />;
  if (!user) return <PlatformLogin onLogin={setUser}/>;

  return <main className="admin-portal platform-portal">
    <header><a href="/platform">PLATAFORMA<span> DE RESERVAS</span></a><div><span>Operador: {user.firstName}</span><button onClick={logout}>Cerrar sesión</button></div></header>
    <div className="admin-portal-heading"><p className="section-label">Operación del SaaS</p><h1>Barberías</h1><p>Da de alta barberías, gestiona su periodo de prueba y suspéndelas si es necesario. Desde aquí no se accede a sus clientes ni a sus citas.</p></div>
    {message && <p className="client-notice success">{message}</p>}
    {error && <p className="client-notice error">{error}</p>}
    <section className="admin-card platform-tenants">
      <h3>{tenants.length} barbería(s)</h3>
      <div className="platform-table" role="table" aria-label="Barberías de la plataforma">
        <div className="platform-row platform-head" role="row"><span>Barbería</span><span>Dirección</span><span>Dueños</span><span>Barberos / citas</span><span>Estado</span><span>Acciones</span></div>
        {tenants.map((tenant) => <div className="platform-row" role="row" key={tenant.slug}>
          <span><b>{tenant.displayName}</b><small>{tenant.city || '—'}</small></span>
          <span><a href={`/t/${tenant.slug}`} target="_blank" rel="noreferrer">/t/{tenant.slug}</a></span>
          <span>{tenant.owners || 'Sin dueño'}</span>
          <span>{tenant.activeBarbers} / {tenant.appointments}</span>
          <span><i className={`platform-status ${tenant.status.toLowerCase()}`}>{statusLabels[tenant.status]}</i></span>
          <span className="platform-actions">
            {tenant.status !== 'ACTIVE' && tenant.status !== 'CANCELLED' && <button onClick={() => changeStatus(tenant, 'ACTIVE')}>Activar</button>}
            {['ACTIVE', 'TRIAL'].includes(tenant.status) && <button className="danger" onClick={() => changeStatus(tenant, 'SUSPENDED')}>Suspender</button>}
            {tenant.status === 'SUSPENDED' && <button className="danger" onClick={() => changeStatus(tenant, 'CANCELLED')}>Dar de baja</button>}
            {tenant.status === 'CANCELLED' && <button onClick={() => changeStatus(tenant, 'SUSPENDED')}>Recuperar</button>}
          </span>
        </div>)}
      </div>
    </section>
    <section className="admin-card">
      <h3>Nueva barbería</h3>
      <form className="admin-form platform-form" onSubmit={createTenant}>
        <label>Nombre comercial<input required minLength="2" maxLength="160" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value, slug: slugTouched ? form.slug : slugify(event.target.value) })}/></label>
        <label>Dirección web<span className="platform-slug"><small>/t/</small><input required pattern="[a-z0-9](?:[a-z0-9\-]{0,78}[a-z0-9])?" title="Minúsculas, números y guiones internos" value={form.slug} onChange={(event) => { setSlugTouched(true); setForm({ ...form, slug: event.target.value.toLowerCase() }); }}/></span></label>
        <label>Ciudad<input required minLength="2" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })}/></label>
        <label>Teléfono<input required minLength="6" maxLength="30" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })}/></label>
        <label>Dirección <small>Opcional</small><input maxLength="255" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })}/></label>
        <label>Estado inicial<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="TRIAL">Prueba</option><option value="ACTIVE">Activa</option></select></label>
        <fieldset className="platform-owner"><legend>Dueño</legend>
          <label>Correo del dueño<input type="email" required value={form.ownerEmail} onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })}/></label>
          <p>Si el correo ya tiene cuenta, basta con él. Si es nuevo, completa nombre, apellido y una contraseña temporal; deberá cambiarla en su primer acceso.</p>
          <label>Nombre <small>Si es cuenta nueva</small><input value={form.ownerFirstName} onChange={(event) => setForm({ ...form, ownerFirstName: event.target.value })}/></label>
          <label>Apellido <small>Si es cuenta nueva</small><input value={form.ownerLastName} onChange={(event) => setForm({ ...form, ownerLastName: event.target.value })}/></label>
          <label>Contraseña temporal <small>Si es cuenta nueva</small><input type="password" autoComplete="new-password" minLength="8" value={form.ownerPassword} onChange={(event) => setForm({ ...form, ownerPassword: event.target.value })}/></label>
        </fieldset>
        <button>Crear barbería</button>
      </form>
    </section>
  </main>;
}
