// Acceso al panel de la plataforma (/platform), visible solo para los
// operadores del SaaS (super admins). Es solo un atajo: el servidor vuelve a
// comprobar en cada petición que la cuenta sea operadora.
export default function PlatformLink({ user, className = '', onClick }) {
  if (!user?.isPlatformAdmin) return null;
  return <a className={`platform-shortcut ${className}`.trim()} href="/platform" title="Panel de plataforma" onClick={onClick}>Panel de plataforma</a>;
}
