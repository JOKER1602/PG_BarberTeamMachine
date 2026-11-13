import { useState } from 'react';

// Campo de contraseña con botón para mostrarla u ocultarla (el "ojito").
// Recibe las mismas props que un <input>; el tipo lo controla el botón.
export default function PasswordInput(props) {
  const [visible, setVisible] = useState(false);
  const label = visible ? 'Ocultar contraseña' : 'Mostrar contraseña';
  return (
    <span className="password-input">
      <input {...props} type={visible ? 'text' : 'password'}/>
      <button className="password-visibility-toggle" type="button" onClick={() => setVisible((current) => !current)} aria-label={label} aria-pressed={visible} title={label}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2.5 12s3.4-5.5 9.5-5.5S21.5 12 21.5 12s-3.4 5.5-9.5 5.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.6"/>{visible && <path d="M4 4l16 16"/>}</svg>
      </button>
    </span>
  );
}
