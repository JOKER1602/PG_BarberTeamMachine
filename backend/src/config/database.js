import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: Number(process.env.DATABASE_PORT ?? 3306),
  database: process.env.DATABASE_NAME ?? 'barber_team_machine',
  user: process.env.DATABASE_USER ?? 'root',
  password: process.env.DATABASE_PASSWORD ?? '',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z'
});

export default pool;
