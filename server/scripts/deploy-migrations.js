import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isLoopbackDatabaseUrl } from '../config.js'

export function getCloudDatabaseUrl(environment = process.env) {
  const connectionString = environment.CLOUD_DATABASE_URL
  if (!connectionString) {
    throw new Error('CLOUD_DATABASE_URL is required; local DATABASE_URL will not be used for cloud migrations.')
  }

  let parsedUrl
  try {
    parsedUrl = new URL(connectionString)
  } catch {
    throw new Error('CLOUD_DATABASE_URL must be a valid PostgreSQL connection URL.')
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsedUrl.protocol) ||
    !parsedUrl.hostname ||
    !['require', 'verify-ca', 'verify-full'].includes(parsedUrl.searchParams.get('sslmode')) ||
    /REPLACE_|CLOUD_DATABASE_HOST|CLOUD_USER|CLOUD_PASSWORD|CLOUD_DATABASE/.test(connectionString) ||
    isLoopbackDatabaseUrl(connectionString)
  ) {
    throw new Error('CLOUD_DATABASE_URL must identify a non-loopback PostgreSQL database and require TLS.')
  }
  if (environment.DATABASE_URL) {
    let currentTarget
    try {
      currentTarget = new URL(environment.DATABASE_URL)
    } catch {
      currentTarget = null
    }
    if (currentTarget) {
      const sameDatabase = currentTarget.hostname.toLowerCase() === parsedUrl.hostname.toLowerCase() &&
        (currentTarget.port || '5432') === (parsedUrl.port || '5432') &&
        decodeURIComponent(currentTarget.pathname) === decodeURIComponent(parsedUrl.pathname)
      if (sameDatabase) {
        throw new Error('CLOUD_DATABASE_URL must identify a different database from DATABASE_URL.')
      }
    }
  }

  return connectionString
}

export function deployCloudMigrations(environment = process.env) {
  const cloudDatabaseUrl = getCloudDatabaseUrl(environment)
  const require = createRequire(import.meta.url)
  const prismaCli = require.resolve('prisma/build/index.js')
  const { CLOUD_DATABASE_URL: _cloudDatabaseUrl, ...childEnvironment } = environment
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: resolve(fileURLToPath(new URL('..', import.meta.url))),
    env: { ...childEnvironment, DATABASE_URL: cloudDatabaseUrl },
    stdio: 'inherit',
  })

  if (result.error) throw new Error('Unable to start the Prisma migration command.')
  if (result.status !== 0) process.exitCode = result.status || 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    deployCloudMigrations()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
