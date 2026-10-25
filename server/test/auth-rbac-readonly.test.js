import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import jwt from 'jsonwebtoken'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.ts'
import { signAccessToken } from '../auth.js'

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true })

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const serverDirectory = fileURLToPath(new URL('..', import.meta.url))
let serverProcess
let baseUrl

async function getFreePort() {
  const probe = net.createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const { port } = probe.address()
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
  return port
}

async function startServer() {
  const port = await getFreePort()
  baseUrl = `http://127.0.0.1:${port}`
  serverProcess = spawn(process.execPath, ['index.js'], {
    cwd: serverDirectory,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  })

  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) throw new Error('Read-only auth test server exited early')
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200))
      continue
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Timed out waiting for the read-only auth test server')
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return
  await new Promise((resolve) => {
    serverProcess.once('exit', resolve)
    serverProcess.kill()
  })
}

async function postJson(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

try {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be configured for read-only auth tests')
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET must be configured for read-only auth tests')

  await startServer()

  const users = await prisma.user.findMany({
    select: { id: true, role: true, accountStatus: true },
  })
  const citizen = users.find(({ role, accountStatus }) => role === 'CITIZEN' && accountStatus === 'ACTIVE')
  const activeAdmins = users.filter(({ role, accountStatus }) =>
    role === 'AUTHORITY_ADMINISTRATOR' && accountStatus === 'ACTIVE'
  )

  const rolesPresent = new Set(users.map(({ role }) => role))
  for (const role of ['CITIZEN', 'AUTHORITY_ADMINISTRATOR', 'VOLUNTEER', 'SHELTER_MANAGER']) {
    console.log(`Database account available for ${role}: ${rolesPresent.has(role) ? 'yes' : 'no'}`)
  }

  for (const number of [1, 2, 3]) {
    const email = process.env[`INITIAL_ADMIN_${number}_EMAIL`]?.trim().toLowerCase()
    const password = process.env[`INITIAL_ADMIN_${number}_PASSWORD`]
    if (!email || !password) continue
    const databaseAccount = await prisma.user.findUnique({
      where: { email },
      select: { role: true, accountStatus: true },
    })
    assert.equal(databaseAccount?.role, 'AUTHORITY_ADMINISTRATOR', `configured administrator ${number} exists with administrator role`)
    assert.equal(databaseAccount?.accountStatus, 'ACTIVE', `configured administrator ${number} is active`)
    const response = await postJson('/api/auth/login', { email, password })
    const payload = await response.json()
    assert.equal(response.status, 200, `configured initial administrator ${number} can log in`)
    assert.equal(payload.user.role, 'Authority Administrator')
    assert.equal(payload.user.accountStatus, 'Active')
    assert.equal(Object.hasOwn(payload.user, 'passwordHash'), false)
    console.log(`Initial administrator ${number} login loads database role: passed`)
  }

  const unauthorizedRoutes = [
    ['GET', '/api/incidents'],
    ['GET', '/api/incidents/not-an-id'],
    ['GET', '/api/admin/applications'],
  ]
  for (const [method, path] of unauthorizedRoutes) {
    const response = await fetch(`${baseUrl}${path}`, { method })
    assert.equal(response.status, 401, `missing token denied for ${method} ${path}`)
    console.log(`Missing token rejected for ${method} ${path}: passed`)
  }

  const invalid = await fetch(`${baseUrl}/api/incidents`, {
    headers: { authorization: 'Bearer invalid-token' },
  })
  assert.equal(invalid.status, 401)
  console.log('Invalid token rejected: passed')

  const expiredToken = jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: citizen?.id || activeAdmins[0]?.id || 'nonexistent-test-user',
    issuer: 'resqcloud-server',
    audience: 'resqcloud-api',
    expiresIn: -1,
  })
  const expired = await fetch(`${baseUrl}/api/incidents`, {
    headers: { authorization: `Bearer ${expiredToken}` },
  })
  assert.equal(expired.status, 401)
  console.log('Expired token rejected: passed')

  if (citizen) {
    const citizenToken = signAccessToken(citizen.id, process.env.JWT_SECRET)
    const incidents = await fetch(`${baseUrl}/api/incidents`, {
      headers: { authorization: `Bearer ${citizenToken}` },
    })
    assert.equal(incidents.status, 200, 'existing active Citizen account is authorized for incident list')
    console.log('Database-backed Citizen role loads from current account: passed')

    const tamperedIncident = await fetch(`${baseUrl}/api/incidents`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${citizenToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        type: 'FLOOD',
        description: 'Read-only tamper validation; rejected before insert',
        location: 'Not a real incident',
        severity: 'LOW',
        reporterId: 'forged-user-id',
        userId: 'forged-user-id',
        role: 'AUTHORITY_ADMINISTRATOR',
        accountStatus: 'ACTIVE',
      }),
    })
    assert.equal(tamperedIncident.status, 400, 'incident identity and role fields are rejected before persistence')
    console.log('Forged reporter, identity, role, and status fields rejected before insert: passed')

    const adminList = await fetch(`${baseUrl}/api/admin/applications`, {
      headers: { authorization: `Bearer ${citizenToken}` },
    })
    assert.equal(adminList.status, 403, 'Citizen denied admin application list')
    console.log('Citizen denied admin application list: passed')

    const approve = await fetch(`${baseUrl}/api/admin/applications/nonexistent/approve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${citizenToken}`,
        'content-type': 'application/json',
      },
      body: '{}',
    })
    assert.equal(approve.status, 403, 'Citizen denied direct admin approval attempt')
    console.log('Citizen denied direct approval attempt: passed')

    const spoofedRole = jwt.sign({ role: 'AUTHORITY_ADMINISTRATOR' }, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      subject: citizen.id,
      issuer: 'resqcloud-server',
      audience: 'resqcloud-api',
      expiresIn: '1m',
    })
    const spoofedAdmin = await fetch(`${baseUrl}/api/admin/applications`, {
      headers: { authorization: `Bearer ${spoofedRole}` },
    })
    assert.equal(spoofedAdmin.status, 403, 'JWT role claim cannot override database role')
    console.log('JWT role claim cannot promote Citizen: passed')
  }

  const publicAdminRegistration = await postJson('/api/auth/register', {
    name: 'Read-only auth verification',
    email: `read-only-${Date.now()}@example.invalid`,
    password: 'not-a-real-password-and-never-stored',
    role: 'AUTHORITY_ADMINISTRATOR',
  })
  assert.equal(publicAdminRegistration.status, 403)
  console.log('Public administrator registration denied without database write: passed')
} catch (error) {
  console.error(`Read-only authentication verification failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await stopServer()
  await prisma.$disconnect()
}
