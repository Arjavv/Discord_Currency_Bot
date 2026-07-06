const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const { promisify } = require('util');
require('dotenv').config();

const dnsLookup = promisify(dns.lookup);

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('CRITICAL ERROR: DATABASE_URL environment variable is not defined in .env file.');
  process.exit(1);
}

let pool;

/**
 * Creates the pg Pool, resolving the hostname to IPv4 first.
 * This prevents ENETUNREACH errors on IPv4-only hosts (e.g. Hugging Face Spaces).
 */
async function createPool() {
  if (pool) return pool;

  let finalConnectionString = connectionString;

  try {
    const url = new URL(connectionString);
    const hostname = url.hostname;

    // Resolve hostname to IPv4 address
    const { address } = await dnsLookup(hostname, { family: 4 });
    console.log(`Resolved database host ${hostname} -> ${address} (IPv4)`);

    // Replace hostname with resolved IPv4 address in connection string
    url.hostname = address;
    finalConnectionString = url.toString();
  } catch (err) {
    console.warn('DNS IPv4 resolution failed, falling back to original connection string:', err.message);
  }

  pool = new Pool({
    connectionString: finalConnectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle client:', err);
  });

  return pool;
}

/**
 * Initializes the database by executing schema.sql.
 */
async function initDatabase() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found at: ${schemaPath}`);
  }

  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  const activePool = await createPool();
  const client = await activePool.connect();
  try {
    console.log('Running database migrations...');
    await client.query('BEGIN');
    await client.query(schemaSql);
    await client.query('COMMIT');
    console.log('Database schema migrations completed successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to run database migrations:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Returns the active pool (creates it if needed).
 */
async function getPool() {
  return createPool();
}

module.exports = {
  get pool() {
    // Synchronous access for existing query code — pool will be set after createPool() runs
    return pool;
  },
  getPool,
  initDatabase
};
