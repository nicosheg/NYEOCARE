// lib/db.js
import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';

const { Pool } = pg;
const deploymentEnvironment = process.env.VERCEL_ENV || 'development';
const previewDatabaseBlocked =
  deploymentEnvironment === 'preview' &&
  process.env.NYEOCARE_PREVIEW_DATABASE_ISOLATED !== 'true';

function createPreviewBlockedPool() {
  const createBlockedError = () => Object.assign(
    new Error(
      'NYEOCARE Preview is disabled until DATABASE_URL is verified against an isolated staging database and NYEOCARE_PREVIEW_DATABASE_ISOLATED=true.'
    ),
    {
      code: 'NYEOCARE_PREVIEW_DATABASE_ISOLATION_REQUIRED',
      status: 503,
    }
  );

  const rejectAccess = callback => {
    const error = createBlockedError();
    if (typeof callback === 'function') {
      queueMicrotask(() => callback(error));
      return undefined;
    }
    return Promise.reject(error);
  };

  const blockedPool = {
    query: (...args) => rejectAccess(args.findLast?.(value => typeof value === 'function')),
    connect: callback => rejectAccess(callback),
    on: () => blockedPool,
    end: async () => undefined,
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
    options: { max: 1 },
  };

  return blockedPool;
}

function createConfiguredPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const configuredPool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    family: 4,
    max: 1,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 3000,
    keepAlive: true,
    allowExitOnIdle: true,
    maxUses: 500,
  });

  attachDatabasePool(configuredPool);
  configuredPool.on('error', error => {
    console.error('[DB] Unexpected idle client error:', error);
  });

  return configuredPool;
}

// The guard must not throw while Next.js imports route modules during build.
// An unisolated Preview receives an inert pool whose query/connect methods
// reject immediately. It has no Production connection string and no way to
// connect to the Production database. Health/API handlers can return a
// controlled unavailable response from their normal error handling.
const pool = previewDatabaseBlocked
  ? createPreviewBlockedPool()
  : createConfiguredPool();

export default pool;
