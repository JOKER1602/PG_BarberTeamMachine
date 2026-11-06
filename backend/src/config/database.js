import mysql from 'mysql2/promise';

const useDatabaseSsl = String(process.env.DATABASE_SSL).toLowerCase() === 'true';

const pool = mysql.createPool({
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: Number(process.env.DATABASE_PORT ?? 3306),
  database: process.env.DATABASE_NAME ?? 'barber_team_machine',
  user: process.env.DATABASE_USER ?? 'root',
  password: process.env.DATABASE_PASSWORD ?? '',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z',
  // Los proveedores administrados suelen exigir TLS para MySQL expuesto.
  // La verificación se mantiene activa salvo que el proveedor documente lo contrario.
  ssl: useDatabaseSsl ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined
});

export default pool;
