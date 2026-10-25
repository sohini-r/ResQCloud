import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'

const originalFetch = globalThis.fetch
const originalWindow = globalThis.window
const api = await import('../src/api.js')

beforeEach(() => {
  api.clearAccessToken()
})

after(() => {
  globalThis.fetch = originalFetch
  if (originalWindow === undefined) delete globalThis.window
  else globalThis.window = originalWindow
})

test('incident list sends bearer token and maps Prisma enums to UI labels', async () => {
  let request
  api.setAccessToken('test-bearer-token')
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({
      incidents: [{
        id: 'incident-1',
        type: 'FLOOD',
        severity: 'MEDIUM',
        status: 'UNDER_VERIFICATION',
        reporterId: 'user-1',
        reporter: { id: 'user-1', name: 'Test Reporter' },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  const incidents = await api.fetchIncidents()

  assert.equal(request.url, 'http://localhost:5000/api/incidents')
  assert.equal(request.options.headers.Authorization, 'Bearer test-bearer-token')
  assert.equal(incidents[0].type, 'Flood')
  assert.equal(incidents[0].severity, 'Medium')
  assert.equal(incidents[0].status, 'Under Verification')
  assert.equal(incidents[0].reporter, 'Test Reporter')
})

test('incident creation maps labels and never sends reporter identity', async () => {
  let requestBody
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body)
    return new Response(JSON.stringify({
      incident: {
        id: 'incident-2',
        type: 'EARTHQUAKE',
        severity: 'HIGH',
        status: 'REPORTED',
        reporterId: 'authenticated-user',
        reporter: { id: 'authenticated-user', name: 'Authenticated User' },
      },
    }), { status: 201, headers: { 'content-type': 'application/json' } })
  }

  const incident = await api.createIncident({
    type: 'Earthquake',
    severity: 'High',
    description: 'Verified test payload',
    location: 'Test location',
    affected: 2,
    reporterId: 'forged-user',
  })

  assert.equal(requestBody.type, 'EARTHQUAKE')
  assert.equal(requestBody.severity, 'HIGH')
  assert.equal(Object.hasOwn(requestBody, 'reporterId'), false)
  assert.equal(incident.type, 'Earthquake')
})

test('incident status updates send an authenticated PATCH and map the returned record', async () => {
  let request
  api.setAccessToken('test-bearer-token')
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({
      incident: {
        id: 'incident-3',
        type: 'FLOOD',
        severity: 'HIGH',
        status: 'VERIFIED',
        reporterId: 'user-1',
        reporter: { id: 'user-1', name: 'Test Reporter' },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  const incident = await api.updateIncidentStatus('incident/3', 'Verified')

  assert.equal(request.url, 'http://localhost:5000/api/incidents/incident%2F3/status')
  assert.equal(request.options.method, 'PATCH')
  assert.ok(request.options.headers.Authorization?.startsWith('Bearer '))
  assert.deepEqual(JSON.parse(request.options.body), { status: 'VERIFIED' })
  assert.equal(incident.status, 'Verified')
  assert.equal(incident.reporter, 'Test Reporter')
})

test('failed incident status updates return an error without a success-shaped record', async () => {
  api.setAccessToken('admin-test-token')
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Incident not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  })

  await assert.rejects(api.updateIncidentStatus('missing-incident', 'Verified'), {
    status: 404,
    message: 'Incident not found',
  })
})

test('expired bearer token is cleared and authentication-expired event is dispatched', async () => {
  let authorizationHeader
  const events = []
  globalThis.window = { dispatchEvent: (event) => events.push(event.type) }
  api.setAccessToken('expired-test-token')
  globalThis.fetch = async (_url, options) => {
    authorizationHeader = options.headers.Authorization
    return new Response(JSON.stringify({ error: 'Invalid or expired authentication token' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  await assert.rejects(api.fetchIncidents(), { status: 401 })
  assert.equal(authorizationHeader, 'Bearer expired-test-token')
  assert.deepEqual(events, ['resqcloud:authentication-expired'])
})

test('registration forwards the selected role and preserves the pending application response', async () => {
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({
      application: { status: 'PENDING', requestedRole: 'Volunteer' },
    }), { status: 202, headers: { 'content-type': 'application/json' } })
  }

  const result = await api.registerAccount({
    name: 'Test Volunteer',
    email: 'volunteer@example.test',
    password: 'not-a-real-password',
    role: 'VOLUNTEER',
  })

  assert.equal(request.url, 'http://localhost:5000/api/auth/register')
  assert.equal(JSON.parse(request.options.body).role, 'VOLUNTEER')
  assert.equal(result.application.status, 'PENDING')
  assert.equal(result.token, undefined)
})

test('application review requests use authenticated admin endpoints', async () => {
  const requests = []
  api.setAccessToken('admin-test-token')
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return new Response(JSON.stringify({ applications: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  await api.fetchApplications('REJECTED')
  await api.approveApplication('application/1')
  await api.rejectApplication('application-2', 'Insufficient information')

  assert.equal(requests[0].url, 'http://localhost:5000/api/admin/applications?status=REJECTED')
  assert.equal(requests[0].options.headers.Authorization, 'Bearer admin-test-token')
  assert.equal(requests[1].url, 'http://localhost:5000/api/admin/applications/application%2F1/approve')
  assert.equal(requests[2].url, 'http://localhost:5000/api/admin/applications/application-2/reject')
  assert.deepEqual(JSON.parse(requests[2].options.body), { reason: 'Insufficient information' })
})

test('rejected or suspended accounts clear an existing bearer token', async () => {
  const events = []
  globalThis.window = { dispatchEvent: (event) => events.push(event.type) }
  api.setAccessToken('revoked-test-token')
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: 'This account is not active',
    code: 'ACCOUNT_SUSPENDED',
  }), { status: 403, headers: { 'content-type': 'application/json' } })

  await assert.rejects(api.fetchIncidents(), { status: 403 })
  assert.deepEqual(events, ['resqcloud:authentication-expired'])
})

test('logout token clearing leaves subsequent protected requests without a bearer token', async () => {
  let authorizationHeader
  api.setAccessToken('active-session-token')
  api.clearAccessToken()
  globalThis.fetch = async (_url, options) => {
    authorizationHeader = options.headers.Authorization
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  await assert.rejects(api.fetchIncidents(), { status: 401 })
  assert.equal(authorizationHeader, undefined)
})
