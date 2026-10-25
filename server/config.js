import { validateJwtSecret } from './auth.js'

const localCorsOrigins = ['http://localhost:5173', 'http://localhost:5176']

function parsePort(value) {
  if (value === undefined || value === '') return 5000
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.')
  }
  return port
}

function parseCorsOrigins(value, isProduction) {
  if (!value?.trim()) {
    if (isProduction) throw new Error('CORS_ORIGINS must explicitly list the deployed frontend origin in production.')
    return localCorsOrigins
  }

  const origins = value.split(',').map((origin) => origin.trim()).filter(Boolean)
  if (!origins.length) throw new Error('CORS_ORIGINS must contain at least one origin.')

  for (const origin of origins) {
    let parsed
    try {
      parsed = new URL(origin)
    } catch {
      throw new Error('CORS_ORIGINS must contain valid HTTP(S) origins without paths.')
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      (isProduction && parsed.protocol !== 'https:') ||
      parsed.origin !== origin
    ) {
      throw new Error(isProduction
        ? 'Production CORS_ORIGINS must contain HTTPS origins without paths.'
        : 'CORS_ORIGINS must contain valid HTTP(S) origins without paths.')
    }
  }

  return [...new Set(origins)]
}

function parseDatabaseUrl(value, isProduction) {
  if (!value || value.includes('REPLACE_') || value.includes('YOUR_') || value.includes('CLOUD_DATABASE_HOST')) {
    throw new Error('DATABASE_URL must be configured with a PostgreSQL connection URL.')
  }

  let databaseUrl
  try {
    databaseUrl = new URL(value)
  } catch {
    throw new Error('DATABASE_URL must be configured with a valid PostgreSQL connection URL.')
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || !databaseUrl.hostname) {
    throw new Error('DATABASE_URL must be configured with a valid PostgreSQL connection URL.')
  }
  if (isProduction && ['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname)) {
    throw new Error('DATABASE_URL must point to the deployed PostgreSQL database in production.')
  }
  if (isProduction && !['require', 'verify-ca', 'verify-full'].includes(databaseUrl.searchParams.get('sslmode'))) {
    throw new Error('DATABASE_URL must require TLS for PostgreSQL connections in production.')
  }
}

export function getBackendConfig(environment = process.env) {
  const isProduction = environment.NODE_ENV === 'production'
  const port = parsePort(environment.PORT)
  parseDatabaseUrl(environment.DATABASE_URL, isProduction)
  validateJwtSecret(environment.JWT_SECRET)

  return {
    port,
    host: environment.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1'),
    isProduction,
    corsOrigins: parseCorsOrigins(environment.CORS_ORIGINS, isProduction),
  }
}

export function isLoopbackDatabaseUrl(value) {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(value).hostname)
  } catch {
    return true
  }
}
