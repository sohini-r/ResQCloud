import assert from 'node:assert/strict'
import test from 'node:test'
import { getBackendConfig, isLoopbackDatabaseUrl } from '../config.js'
import { getCloudDatabaseUrl } from '../scripts/deploy-migrations.js'

const secret = 'test-only-secret-with-more-than-32-bytes'

function environment(overrides = {}) {
  return {
    DATABASE_URL: 'postgresql://demo:demo@127.0.0.1:5432/resqcloud',
    JWT_SECRET: secret,
    ...overrides,
  }
}

test('local backend keeps port 5000 and loopback defaults with local CORS origins', () => {
  assert.deepEqual(getBackendConfig(environment()), {
    port: 5000,
    host: '127.0.0.1',
    isProduction: false,
    corsOrigins: ['http://localhost:5173', 'http://localhost:5176'],
  })
})

test('production backend binds to all interfaces and requires explicit CORS origins', () => {
  const config = getBackendConfig(environment({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://demo:demo@db.example.invalid:5432/resqcloud?sslmode=require',
    CORS_ORIGINS: 'https://resqcloud.example.invalid',
  }))
  assert.equal(config.host, '0.0.0.0')
  assert.equal(config.corsOrigins[0], 'https://resqcloud.example.invalid')
  assert.equal(config.port, 5000)
})

test('invalid production configuration fails without exposing database credentials', () => {
  assert.throws(
    () => getBackendConfig(environment({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://demo:demo@db.example.invalid:5432/resqcloud?sslmode=require',
      JWT_SECRET: 'REPLACE_WITH_SECRET',
      CORS_ORIGINS: 'https://resqcloud.example.invalid',
    })),
    /JWT_SECRET/,
  )
  assert.throws(
    () => getBackendConfig(environment({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://demo:demo@db.example.invalid:5432/resqcloud?sslmode=require',
      CORS_ORIGINS: undefined,
    })),
    /CORS_ORIGINS/,
  )
  assert.throws(
    () => getBackendConfig(environment({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://private-user:private-password@localhost:5432/private-database?sslmode=require',
      CORS_ORIGINS: 'https://resqcloud.example.invalid',
    })),
    (error) => {
      assert.match(error.message, /deployed PostgreSQL/)
      assert.doesNotMatch(error.message, /private-user|private-password|private-database/)
      return true
    },
  )
})

test('PORT accepts a valid port and rejects invalid values', () => {
  assert.equal(getBackendConfig(environment({ PORT: '8080' })).port, 8080)
  for (const value of ['0', '65536', 'not-a-port']) {
    assert.throws(() => getBackendConfig(environment({ PORT: value })), /PORT/)
  }
})

test('CORS origins are exact HTTP(S) origins and duplicate entries are removed', () => {
  const config = getBackendConfig(environment({
    CORS_ORIGINS: 'https://resqcloud.example.invalid,https://resqcloud.example.invalid',
  }))
  assert.deepEqual(config.corsOrigins, ['https://resqcloud.example.invalid'])
  assert.throws(() => getBackendConfig(environment({ CORS_ORIGINS: 'https://example.invalid/path' })), /CORS_ORIGINS/)
  assert.throws(() => getBackendConfig(environment({ CORS_ORIGINS: 'null' })), /CORS_ORIGINS/)
  assert.throws(() => getBackendConfig(environment({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://demo:demo@db.example.invalid:5432/resqcloud?sslmode=require',
    CORS_ORIGINS: 'http://resqcloud.example.invalid',
  })), /HTTPS/)
})

test('cloud migration target is explicit and never falls back to local DATABASE_URL', () => {
  assert.throws(
    () => getCloudDatabaseUrl({ DATABASE_URL: 'postgresql://local:local@localhost:5432/local' }),
    /CLOUD_DATABASE_URL is required/,
  )
  assert.throws(
    () => getCloudDatabaseUrl({ CLOUD_DATABASE_URL: 'postgresql://local:local@localhost:5432/local' }),
    /non-loopback/,
  )
  assert.throws(
    () => getCloudDatabaseUrl({ CLOUD_DATABASE_URL: 'postgresql://cloud:cloud@db.example.invalid:5432/cloud' }),
    /non-loopback/,
  )
  assert.throws(
    () => getCloudDatabaseUrl({ CLOUD_DATABASE_URL: 'postgresql://CLOUD_USER:CLOUD_PASSWORD@CLOUD_DATABASE_HOST:5432/CLOUD_DATABASE' }),
    /non-loopback/,
  )

  const target = 'postgresql://cloud-user:cloud-password@db.example.invalid:5432/cloud-db?sslmode=require'
  assert.equal(getCloudDatabaseUrl({ CLOUD_DATABASE_URL: target, DATABASE_URL: 'postgresql://local@localhost:5432/local' }), target)
  assert.throws(
    () => getCloudDatabaseUrl({
      DATABASE_URL: 'postgresql://local:local@db.example.invalid:5432/cloud-db?sslmode=disable',
      CLOUD_DATABASE_URL: target,
    }),
    /different database/,
  )
  assert.equal(isLoopbackDatabaseUrl('postgresql://local@localhost:5432/local'), true)
  assert.equal(isLoopbackDatabaseUrl(target), false)
})
