import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import brandTheme from './brand-theme.js';

// En desarrollo, las rutas relativas /uploads (fotos, QR, logos) y /api
// (enlaces a comprobantes) se reenvían a la API local, igual que en
// producción, donde la misma API sirve el frontend.
export default defineConfig({
  plugins: [react()],
  // Genera la capa de colores propios por barbería (ver brand-theme.js).
  css: { postcss: { plugins: [brandTheme()] } },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/uploads': 'http://localhost:3002',
      '/api': 'http://localhost:3002'
    }
  }
});
