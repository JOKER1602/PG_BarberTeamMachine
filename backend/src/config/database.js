import pg from 'pg';

const { Pool, types } = pg;

// Conexión a PostgreSQL (Supabase).
//
// Expone la misma interfaz que usan las rutas: pool.execute / pool.query /
// pool.getConnection, con parámetros "?" y resultados [filas] o
// [{ affectedRows, insertId }]. Las consultas son SQL de PostgreSQL.

// BIGINT (ids, COUNT) como número: el volumen de datos no se acerca al límite
// seguro de JavaScript y el código compara ids numéricamente.
types.setTypeParser(types.builtins.INT8, (value) => Number(value));

const SCHEMA = process.env.DATABASE_SCHEMA || 'reservas';
if (!/^[a-z_][a-z0-9_]*$/.test(SCHEMA)) throw new Error('DATABASE_SCHEMA no es válido');

function sslConfig() {
  if (String(process.env.DATABASE_SSL).toLowerCase() !== 'true') return undefined;
  return {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
    ...(process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT.replaceAll('\\n', '\n') } : {})
  };
}

// DATABASE_POOL_MAX: conexiones por instancia. La suma de todas las instancias
// debe quedar bajo el "pool size" de Supabase en modo sesión (15 en Micro):
// 10 con una instancia, 7 con dos.
function connectionConfig() {
  const common = { max: Number(process.env.DATABASE_POOL_MAX ?? 10), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, ssl: sslConfig() };
  if (process.env.DATABASE_URL) {
    // sslmode en la URL anularía la configuración TLS de arriba.
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.delete('sslmode');
    return { ...common, connectionString: url.toString() };
  }
  return {
    ...common,
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: Number(process.env.DATABASE_PORT ?? 5432),
    database: process.env.DATABASE_NAME ?? 'postgres',
    user: process.env.DATABASE_USER ?? 'postgres',
    password: process.env.DATABASE_PASSWORD ?? ''
  };
}

const pgPool = new Pool(connectionConfig());
// Un error en una conexión inactiva (reinicio de la base) no debe tumbar la API.
pgPool.on('error', (error) => console.error('Conexión inactiva de PostgreSQL perdida:', error.message));

// Un corte de red al abrir una conexión (frecuente con el pooler de Supabase
// tras un rato inactivo) se reintenta dos veces antes de responder error. No se
// reintenta si el pool está lleno ("timeout exceeded"): eso agregaría carga.
const TRANSIENT_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN']);
export const isTransientConnectError = (error) => TRANSIENT_CODES.has(error?.code)
  || /Connection terminated unexpectedly|socket disconnected|Connection terminated due to connection timeout/i.test(error?.message ?? '');
async function connectWithRetry(attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await pgPool.connect();
    } catch (error) {
      if (attempt >= attempts || !isTransientConnectError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
}

// Cada conexión fija su esquema antes de la primera consulta.
const prepared = new WeakSet();
async function acquire() {
  const client = await connectWithRetry();
  if (!prepared.has(client)) {
    try {
      await client.query(`SET search_path TO ${SCHEMA}`);
    } catch (error) {
      client.release(error);
      throw error;
    }
    prepared.add(client);
  }
  return client;
}

// Convierte "?" en $1, $2... sin tocar los que estén dentro de comillas.
const translated = new Map();
function toPositional(sql) {
  const cached = translated.get(sql);
  if (cached) return cached;
  let output = '';
  let index = 0;
  let quote = null;
  for (const character of sql) {
    if (quote) {
      if (character === quote) quote = null;
      output += character;
    } else if (character === "'" || character === '"') {
      quote = character;
      output += character;
    } else if (character === '?') {
      index += 1;
      output += `$${index}`;
    } else {
      output += character;
    }
  }
  translated.set(sql, output);
  return output;
}

function adaptResult(result) {
  if (result.command === 'SELECT') return [result.rows, result.fields];
  return [{ affectedRows: result.rowCount ?? 0, insertId: result.rows?.[0]?.id ?? 0, rows: result.rows ?? [] }, result.fields];
}

const run = async (executor, sql, values = []) => adaptResult(await executor.query(toPositional(sql), values.map((value) => (value === undefined ? null : value))));

async function runOnce(sql, values) {
  const client = await acquire();
  try {
    return await run(client, sql, values);
  } finally {
    client.release();
  }
}

const pool = {
  execute: runOnce,
  query: runOnce,
  async getConnection() {
    const client = await acquire();
    let broken;
    return {
      execute: (sql, values) => run(client, sql, values),
      query: (sql, values) => run(client, sql, values),
      beginTransaction: () => client.query('BEGIN'),
      commit: () => client.query('COMMIT'),
      async rollback() {
        // Si la conexión ya se perdió no hay nada que deshacer: el error
        // original es el que debe llegar al manejador.
        await client.query('ROLLBACK').catch((error) => { broken = error; });
      },
      release: () => client.release(broken)
    };
  },
  end: () => pgPool.end()
};

export default pool;
