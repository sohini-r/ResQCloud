import bcrypt from 'bcrypt'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import net from 'node:net'
import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.ts'
import { signAccessToken } from '../auth.js'
import { provisionInitialAdmins } from './provision-admins.js'

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

const roles = ['CITIZEN', 'AUTHORITY_ADMINISTRATOR', 'VOLUNTEER', 'SHELTER_MANAGER']
const marker = `RESQCLOUD_AUTH_API_TEST_${randomBytes(8).toString('hex')}`
const password = `${randomBytes(20).toString('base64url')}A1!`
const testUsers = []
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})
let serverProcess
let baseUrl
let ipv6BaseUrl
let response
let payload
const testJwtSecret = randomBytes(48).toString('base64url')

function assert(condition, description) {
  if (!condition) throw new Error(`${description} failed`)
  console.log(`${description}: passed`)
}

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
  ipv6BaseUrl = `http://[::1]:${port}`
  serverProcess = spawn(process.execPath, ['index.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      JWT_SECRET: testJwtSecret,
    },
    stdio: 'ignore',
  })

  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Test API server exited early with code ${serverProcess.exitCode}`)
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
      continue
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Timed out while starting the test API server')
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return
  await new Promise((resolve) => {
    serverProcess.once('exit', resolve)
    serverProcess.kill()
  })
}

async function postJson(path, body, token) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function patchJson(path, body, token) {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

try {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('REPLACE_WITH_LOCAL_PASSWORD')) {
    throw new Error('Configure DATABASE_URL in server/.env before running this test')
  }

  const passwordHash = await bcrypt.hash(password, 12)
  let provisionedAdmins
  const existingAdmins = await prisma.user.findMany({
    where: { role: 'AUTHORITY_ADMINISTRATOR' },
    select: { id: true, email: true, role: true, accountStatus: true },
  })
  if (existingAdmins.length === 0) {
    const adminSetupEnvironment = {}
    for (const number of [1, 2, 3]) {
      adminSetupEnvironment[`INITIAL_ADMIN_${number}_NAME`] = `${marker} Initial Administrator ${number}`
      adminSetupEnvironment[`INITIAL_ADMIN_${number}_EMAIL`] = `${marker.toLowerCase()}-initial-admin-${number}@localhost.invalid`
      adminSetupEnvironment[`INITIAL_ADMIN_${number}_PASSWORD`] = password
    }
    const firstProvision = await provisionInitialAdmins(prisma, adminSetupEnvironment)
    const secondProvision = await provisionInitialAdmins(prisma, adminSetupEnvironment)
    assert(firstProvision.created === 3 && firstProvision.total === 3, 'Three initial administrator accounts provisioned')
    assert(secondProvision.created === 0 && secondProvision.total === 3, 'Administrator provisioning is repeat-safe')
    provisionedAdmins = await prisma.user.findMany({
      where: { email: { in: [1, 2, 3].map((number) => adminSetupEnvironment[`INITIAL_ADMIN_${number}_EMAIL`]) } },
      select: { id: true, email: true, role: true, accountStatus: true },
      orderBy: { email: 'asc' },
    })
    testUsers.push(...provisionedAdmins)
    provisionedAdmins = provisionedAdmins.map((admin) => ({ ...admin, testPassword: password }))
  } else {
    const configuredAdmins = [1, 2, 3].map((number) => ({
      email: process.env[`INITIAL_ADMIN_${number}_EMAIL`]?.trim().toLowerCase(),
      password: process.env[`INITIAL_ADMIN_${number}_PASSWORD`],
    }))
    if (
      existingAdmins.length !== 3 ||
      configuredAdmins.some(({ email, password }) => !email || !password) ||
      new Set(configuredAdmins.map(({ email }) => email)).size !== 3 ||
      existingAdmins.some(({ email, accountStatus }) =>
        accountStatus !== 'ACTIVE' || !configuredAdmins.some((configured) => configured.email === email)
      )
    ) {
      throw new Error('Cannot run admin login tests safely: configure credentials matching exactly the three existing active administrator accounts.')
    }
    provisionedAdmins = existingAdmins.map((admin) => ({
      ...admin,
      testPassword: configuredAdmins.find((configured) => configured.email === admin.email).password,
    }))
    console.log('Using the three existing active administrators; no administrator records will be created or removed.')
  }

  for (const role of ['VOLUNTEER', 'SHELTER_MANAGER']) {
    const user = await prisma.user.create({
      data: {
        name: `${marker} Existing ${role}`,
        email: `${marker.toLowerCase()}-existing-${role.toLowerCase()}@localhost.invalid`,
        passwordHash,
        role,
        accountStatus: 'ACTIVE',
      },
      select: { id: true, email: true, role: true },
    })
    testUsers.push(user)
    user.testPassword = password
  }

  await startServer()

  response = await fetch(`${ipv6BaseUrl}/api/health`)
  payload = await response.json()
  assert(response.status === 200 && payload.database === 'connected', 'localhost IPv6 loopback health')

  for (const origin of ['http://localhost:5173', 'http://localhost:5176']) {
    response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,authorization',
      },
    })
    const allowHeaders = response.headers.get('access-control-allow-headers') || ''
    const allowMethods = response.headers.get('access-control-allow-methods') || ''
    assert(
      response.status === 204 &&
        response.headers.get('access-control-allow-origin') === origin &&
        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].every((method) => allowMethods.includes(method)) &&
        allowHeaders.toLowerCase().includes('content-type') &&
        allowHeaders.toLowerCase().includes('authorization'),
      `CORS preflight allowed for ${origin}`,
    )
  }

  response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      origin: 'http://localhost:5174',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,authorization',
    },
  })
  assert(!response.headers.has('access-control-allow-origin'), 'Unlisted frontend origin rejected by CORS')

  const registrationEmail = `${marker.toLowerCase()}-citizen@localhost.invalid`
  response = await postJson('/api/auth/register', {
    name: `${marker} Citizen`,
    email: registrationEmail,
    password,
    role: 'CITIZEN',
  })
  payload = await response.json()
  assert(response.status === 201 && payload.user?.role === 'Citizen' && payload.user?.accountStatus === 'Active' && payload.token, 'Citizen registration activates immediately')
  assert(!JSON.stringify(payload).includes('passwordHash'), 'Registration response excludes password hash')
  testUsers.push({ id: payload.user.id, email: registrationEmail, role: 'CITIZEN' })

  response = await postJson('/api/auth/register', {
    name: `${marker} Invalid`,
    email: `${marker.toLowerCase()}-invalid@localhost.invalid`,
    password: 'short',
  })
  assert(response.status === 400, 'Invalid registration input rejected')

  response = await postJson('/api/auth/register', {
    name: `${marker} Privilege Escalation`,
    email: `${marker.toLowerCase()}-escalation-admin@localhost.invalid`,
    password,
    role: 'AUTHORITY_ADMINISTRATOR',
  })
  assert(response.status === 403, 'Public administrator registration is rejected')

  response = await postJson('/api/auth/register', {
    name: `${marker} Status Escalation`,
    email: `${marker.toLowerCase()}-escalation-status@localhost.invalid`,
    password,
    role: 'VOLUNTEER',
    requestedRole: 'AUTHORITY_ADMINISTRATOR',
    accountStatus: 'ACTIVE',
  })
  assert(response.status === 400, 'Public registration cannot set approval status or requested role')

  const applicationUsers = []
  for (const [role, decision] of [
    ['VOLUNTEER', 'approved'],
    ['VOLUNTEER', 'rejected'],
    ['SHELTER_MANAGER', 'approved'],
    ['SHELTER_MANAGER', 'rejected'],
  ]) {
    const email = `${marker.toLowerCase()}-application-${role.toLowerCase()}-${decision}@localhost.invalid`
    response = await postJson('/api/auth/register', {
      name: `${marker} Applicant ${role} ${decision}`,
      email,
      password,
      role,
    })
    payload = await response.json()
    assert(
      response.status === 202 &&
        payload.application?.status === 'PENDING' &&
        payload.application?.requestedRole === (role === 'VOLUNTEER' ? 'Volunteer' : 'Shelter Manager') &&
        payload.application?.submittedAt &&
        !payload.token &&
        payload.user?.role === 'Citizen' &&
        payload.user?.accountStatus === 'Pending',
      `${role} ${decision} registration creates a pending citizen-level application`,
    )
    applicationUsers.push({ id: payload.user.id, email, role, decision })
    testUsers.push({ id: payload.user.id, email, role: 'CITIZEN' })
    response = await postJson('/api/auth/login', { email, password })
    payload = await response.json()
    assert(response.status === 403 && payload.code === 'ACCOUNT_PENDING', `${role} login is blocked pending review`)
    const pendingApplicant = applicationUsers[applicationUsers.length - 1]
    const pendingToken = signAccessToken(pendingApplicant.id, testJwtSecret)
    response = await fetch(`${baseUrl}/api/incidents`, { headers: { authorization: `Bearer ${pendingToken}` } })
    assert(response.status === 403, `${role} pending account cannot access protected incidents`)
  }

  response = await postJson('/api/auth/login', { email: registrationEmail, password })
  payload = await response.json()
  assert(response.status === 200 && payload.user?.id === testUsers.find((user) => user.email === registrationEmail)?.id && payload.token, 'Successful login')
  assert(!JSON.stringify(payload).includes('passwordHash'), 'Login response excludes password hash')
  const citizenToken = payload.token

  response = await fetch(`${baseUrl}/api/admin/applications`, {
    headers: { authorization: `Bearer ${citizenToken}` },
  })
  assert(response.status === 403, 'Citizens cannot review applications')
  response = await postJson('/api/admin/applications/not-an-application/approve', {}, citizenToken)
  assert(response.status === 403, 'Unauthorized approval attempts are denied')

  const firstAdmin = provisionedAdmins[0]
  response = await postJson('/api/auth/login', { email: firstAdmin.email, password: firstAdmin.testPassword })
  payload = await response.json()
  assert(response.status === 200 && payload.user?.role === 'Authority Administrator', 'Provisioned administrator can sign in')
  const adminToken = payload.token

  response = await postJson('/api/incidents', {
    type: 'FLOOD',
    description: `${marker}_STATUS_UPDATE`,
    location: 'Automated auth test (not a real incident)',
    severity: 'LOW',
  }, citizenToken)
  payload = await response.json()
  assert(response.status === 201, 'Create isolated incident for administrator status update')
  const statusIncidentId = payload.incident.id

  response = await patchJson(`/api/incidents/${statusIncidentId}/status`, { status: 'VERIFIED' })
  assert(response.status === 401, 'Unauthenticated incident status update is rejected')
  response = await patchJson(`/api/incidents/${statusIncidentId}/status`, { status: 'VERIFIED' }, citizenToken)
  assert(response.status === 403, 'Citizen cannot update incident status')
  response = await patchJson(`/api/incidents/${statusIncidentId}/status`, { status: 'NOT_A_STATUS' }, adminToken)
  assert(response.status === 400, 'Invalid incident status is rejected')
  response = await patchJson(`/api/incidents/${statusIncidentId}/status`, {
    status: 'VERIFIED',
    administratorId: testUsers[0].id,
  }, adminToken)
  assert(response.status === 400, 'Client-supplied administrator identity is rejected')
  response = await patchJson('/api/incidents/not!an!id/status', { status: 'VERIFIED' }, adminToken)
  assert(response.status === 400, 'Malformed incident ID is rejected')
  response = await patchJson('/api/incidents/c000000000000000000000000/status', { status: 'VERIFIED' }, adminToken)
  assert(response.status === 404, 'Nonexistent incident ID is rejected')

  response = await patchJson(`/api/incidents/${statusIncidentId}/status`, { status: 'UNDER_VERIFICATION' }, adminToken)
  payload = await response.json()
  assert(
    response.status === 200 &&
      payload.incident?.id === statusIncidentId &&
      payload.incident?.status === 'UNDER_VERIFICATION',
    'Administrator can update incident status',
  )
  response = await fetch(`${baseUrl}/api/incidents/${statusIncidentId}`, {
    headers: { authorization: `Bearer ${adminToken}` },
  })
  payload = await response.json()
  assert(
    response.status === 200 && payload.incident?.status === 'UNDER_VERIFICATION',
    'Updated incident status persists when fetched again',
  )

  response = await fetch(`${baseUrl}/api/admin/applications?status=PENDING`, {
    headers: { authorization: `Bearer ${adminToken}` },
  })
  payload = await response.json()
  assert(response.status === 200 && applicationUsers.every((applicant) => payload.applications.some((item) => item.id === applicant.id)), 'Administrator can list pending applications')
  assert(!JSON.stringify(payload).includes('passwordHash'), 'Application list excludes password hashes')

  const volunteerApplication = applicationUsers.find(({ role, decision }) => role === 'VOLUNTEER' && decision === 'approved')
  response = await fetch(`${baseUrl}/api/admin/applications/${volunteerApplication.id}`, {
    headers: { authorization: `Bearer ${adminToken}` },
  })
  payload = await response.json()
  assert(response.status === 200 && payload.application?.requestedRole === 'Volunteer', 'Administrator can view one application')
  assert(!JSON.stringify(payload).includes('passwordHash'), 'Application detail excludes password hashes')

  response = await postJson(`/api/admin/applications/${volunteerApplication.id}/approve`, {}, adminToken)
  payload = await response.json()
  assert(
    response.status === 200 &&
    payload.application?.accountStatus === 'APPROVED' &&
    payload.application?.applicationReviewedAt &&
    payload.application?.applicationReviewedById === firstAdmin.id,
    'Approval records the reviewing administrator',
  )

  response = await postJson('/api/auth/login', { email: volunteerApplication.email, password })
  payload = await response.json()
  assert(response.status === 200 && payload.user?.role === 'Volunteer' && payload.user?.accountStatus === 'Approved', 'Approved applicant can sign in to volunteer role')
  const approvedVolunteerToken = payload.token

  const shelterApplication = applicationUsers.find(({ role, decision }) => role === 'SHELTER_MANAGER' && decision === 'approved')
  response = await postJson(`/api/admin/applications/${shelterApplication.id}/approve`, {}, adminToken)
  payload = await response.json()
  assert(
    response.status === 200 &&
      payload.application?.requestedRole === 'Shelter Manager' &&
      payload.application?.accountStatus === 'APPROVED' &&
      payload.application?.applicationReviewedAt &&
      payload.application?.applicationReviewedById === firstAdmin.id,
    'Shelter Manager approval records the reviewing administrator',
  )
  response = await postJson('/api/auth/login', { email: shelterApplication.email, password })
  payload = await response.json()
  assert(response.status === 200 && payload.user?.role === 'Shelter Manager' && payload.user?.accountStatus === 'Approved', 'Approved applicant can sign in to Shelter Manager role')

  const rejectedVolunteerApplication = applicationUsers.find(({ role, decision }) => role === 'VOLUNTEER' && decision === 'rejected')
  const rejectedShelterApplication = applicationUsers.find(({ role, decision }) => role === 'SHELTER_MANAGER' && decision === 'rejected')
  response = await postJson(`/api/admin/applications/${rejectedVolunteerApplication.id}/reject`, { reason: 'Volunteer application test rejection reason' }, adminToken)
  payload = await response.json()
  assert(
    response.status === 200 &&
      payload.application?.accountStatus === 'REJECTED' &&
      payload.application?.applicationRejectionReason === 'Volunteer application test rejection reason' &&
      payload.application?.applicationReviewedById === firstAdmin.id,
    'Volunteer rejection records reason and reviewing administrator',
  )
  response = await postJson('/api/auth/login', { email: rejectedVolunteerApplication.email, password })
  payload = await response.json()
  assert(response.status === 403 && payload.code === 'ACCOUNT_REJECTED', 'Rejected Volunteer cannot sign in')

  response = await postJson(`/api/admin/applications/${rejectedShelterApplication.id}/reject`, { reason: '   ' }, adminToken)
  assert(response.status === 400, 'Application rejection requires a non-empty reason')
  response = await postJson(`/api/admin/applications/${rejectedShelterApplication.id}/reject`, { reason: 'Shelter Manager application test rejection reason' }, adminToken)
  payload = await response.json()
  assert(
    response.status === 200 &&
      payload.application?.accountStatus === 'REJECTED' &&
      payload.application?.applicationReviewedAt &&
      payload.application?.applicationRejectionReason === 'Shelter Manager application test rejection reason' &&
      payload.application?.applicationReviewedById === firstAdmin.id,
    'Shelter Manager rejection records reason and reviewing administrator',
  )

  response = await postJson('/api/auth/login', { email: rejectedShelterApplication.email, password })
  payload = await response.json()
  assert(
    response.status === 403 &&
      payload.code === 'ACCOUNT_REJECTED' &&
      payload.reason === 'Shelter Manager application test rejection reason',
    'Rejected Shelter Manager cannot sign in',
  )
  const rejectedToken = signAccessToken(rejectedShelterApplication.id, testJwtSecret)
  response = await fetch(`${baseUrl}/api/incidents`, { headers: { authorization: `Bearer ${rejectedToken}` } })
  assert(response.status === 403, 'Rejected applicant cannot access protected incidents')

  for (const status of ['APPROVED', 'REJECTED']) {
    response = await fetch(`${baseUrl}/api/admin/applications?status=${status}`, {
      headers: { authorization: `Bearer ${adminToken}` },
    })
    payload = await response.json()
    const expectedIds = applicationUsers
      .filter((application) => application.decision.toUpperCase() === status)
      .map((application) => application.id)
    assert(
      response.status === 200 && expectedIds.every((id) => payload.applications.some((application) => application.id === id)),
      `Administrator can view ${status.toLowerCase()} applications`,
    )
  }
  const persistedApproved = await prisma.user.findUnique({
    where: { id: volunteerApplication.id },
    select: { role: true, accountStatus: true, applicationReviewedAt: true, applicationReviewedById: true },
  })
  const persistedRejected = await prisma.user.findUnique({
    where: { id: rejectedShelterApplication.id },
    select: { role: true, accountStatus: true, applicationReviewedAt: true, applicationReviewedById: true, applicationRejectionReason: true },
  })
  assert(
    persistedApproved.role === 'VOLUNTEER' &&
      persistedApproved.accountStatus === 'APPROVED' &&
      persistedApproved.applicationReviewedAt &&
      persistedApproved.applicationReviewedById === firstAdmin.id,
    'Approved Volunteer decision persists in PostgreSQL',
  )
  assert(
    persistedRejected.role === 'CITIZEN' &&
      persistedRejected.accountStatus === 'REJECTED' &&
      persistedRejected.applicationReviewedAt &&
      persistedRejected.applicationReviewedById === firstAdmin.id &&
      persistedRejected.applicationRejectionReason === 'Shelter Manager application test rejection reason',
    'Rejected Shelter Manager decision persists in PostgreSQL',
  )
  const persistedVolunteerRejection = await prisma.user.findUnique({
    where: { id: rejectedVolunteerApplication.id },
    select: { accountStatus: true, applicationReviewedAt: true, applicationReviewedById: true, applicationRejectionReason: true },
  })
  const persistedShelterApproval = await prisma.user.findUnique({
    where: { id: shelterApplication.id },
    select: { role: true, accountStatus: true, applicationReviewedAt: true, applicationReviewedById: true },
  })
  assert(
    persistedVolunteerRejection.accountStatus === 'REJECTED' &&
      persistedVolunteerRejection.applicationReviewedAt &&
      persistedVolunteerRejection.applicationReviewedById === firstAdmin.id &&
      persistedVolunteerRejection.applicationRejectionReason === 'Volunteer application test rejection reason',
    'Rejected Volunteer decision persists in PostgreSQL',
  )
  assert(
    persistedShelterApproval.role === 'SHELTER_MANAGER' &&
      persistedShelterApproval.accountStatus === 'APPROVED' &&
      persistedShelterApproval.applicationReviewedAt &&
      persistedShelterApproval.applicationReviewedById === firstAdmin.id,
    'Approved Shelter Manager decision persists in PostgreSQL',
  )

  await prisma.user.update({ where: { id: volunteerApplication.id }, data: { accountStatus: 'REJECTED' } })
  response = await fetch(`${baseUrl}/api/incidents`, {
    headers: { authorization: `Bearer ${approvedVolunteerToken}` },
  })
  payload = await response.json()
  assert(response.status === 403 && payload.code === 'ACCOUNT_REJECTED', 'Existing token is blocked after later rejection')
  await prisma.user.update({ where: { id: volunteerApplication.id }, data: { accountStatus: 'SUSPENDED' } })
  response = await fetch(`${baseUrl}/api/incidents`, {
    headers: { authorization: `Bearer ${approvedVolunteerToken}` },
  })
  payload = await response.json()
  assert(response.status === 403 && payload.code === 'ACCOUNT_SUSPENDED', 'Existing token is blocked after suspension')
  await prisma.user.update({ where: { id: volunteerApplication.id }, data: { accountStatus: 'APPROVED' } })

  response = await postJson('/api/auth/login', { email: registrationEmail, password: `${password}wrong` })
  assert(response.status === 401, 'Invalid credentials rejected')

  response = await fetch(`${baseUrl}/api/incidents`, {
    headers: { authorization: 'Bearer invalid-token' },
  })
  assert(response.status === 401, 'Invalid bearer token rejected')

  for (const [method, path, body] of [
    ['GET', '/api/incidents'],
    ['GET', '/api/incidents/not-an-id'],
    ['POST', '/api/incidents', { type: 'FLOOD' }],
  ]) {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    assert(response.status === 401, `Unauthenticated ${method} ${path} rejected`)
  }

  const accessUsers = [
    ...provisionedAdmins,
    ...testUsers.filter((user) => user.role === 'VOLUNTEER' || user.role === 'SHELTER_MANAGER')
      .map((user) => ({ ...user, testPassword: password })),
    { ...testUsers.find((user) => user.email === registrationEmail), testPassword: password },
  ]
  for (const user of accessUsers) {
    const loginResponse = await postJson('/api/auth/login', { email: user.email, password: user.testPassword })
    const login = await loginResponse.json()
    assert(loginResponse.status === 200, `${user.role} login`)
    const token = user.role === 'CITIZEN' ? citizenToken : login.token

    response = await fetch(`${baseUrl}/api/incidents`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const list = await response.json()
    assert(response.status === 200 && Array.isArray(list.incidents), `${user.role} can view incidents`)

    const description = `${marker}_${user.role}_INCIDENT`
    response = await postJson('/api/incidents', {
      type: 'FLOOD',
      description,
      location: 'Automated auth test (not a real incident)',
      severity: 'LOW',
      affected: 0,
    }, token)
    const incident = await response.json()
    assert(response.status === 201 && incident.incident?.reporterId === user.id, `${user.role} can create incident as self`)
    assert(incident.incident?.reporter?.id === user.id && incident.incident?.reporter?.name, `${user.role} reporter summary is linked safely`)
    assert(!JSON.stringify(incident).includes('passwordHash'), `${user.role} incident response excludes password hash`)

    response = await fetch(`${baseUrl}/api/incidents/${incident.incident.id}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const detail = await response.json()
    assert(response.status === 200 && detail.incident?.reporterId === user.id, `${user.role} can retrieve incident`)
  }

  response = await postJson('/api/incidents', {
    type: 'FLOOD',
    description: `${marker}_FORGED_REPORTER`,
    location: 'Automated auth test',
    severity: 'LOW',
    reporterId: testUsers[0].id,
  }, citizenToken)
  assert(response.status === 400, 'Client-supplied reporterId is rejected')

  response = await postJson('/api/incidents', {
    type: 'INVALID',
    description: `${marker}_INVALID_INPUT`,
    location: 'Automated auth test',
    severity: 'LOW',
  }, citizenToken)
  assert(response.status === 400, 'Invalid incident input rejected for authenticated user')

  console.log('Authentication and incident authorization checks passed.')
} catch (error) {
  console.error(`Authentication API test failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await stopServer()
  try {
    const userIds = testUsers.map((user) => user.id)
    if (userIds.length > 0) {
      await prisma.$transaction(async (transaction) => {
        await transaction.incident.deleteMany({
          where: {
            reporterId: { in: userIds },
            description: { startsWith: marker },
          },
        })
        await transaction.user.deleteMany({ where: { id: { in: userIds } } })
      })
    }
    console.log('Authentication API test data cleanup: passed')
  } catch (error) {
    console.error(`Authentication test cleanup failed for isolated marker ${marker}: ${error.message}`)
    process.exitCode = 1
  }
  await prisma.$disconnect()
}
