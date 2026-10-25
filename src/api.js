const isDevelopment = import.meta.env?.DEV ?? typeof window === 'undefined'
const configuredApiBaseUrl = import.meta.env?.VITE_API_BASE_URL?.trim()
const API_BASE_URL = (configuredApiBaseUrl || (isDevelopment ? 'http://localhost:5000/api' : '')).replace(/\/+$/, '')
let accessToken = null

const enumLabels = {
  FLOOD: 'Flood',
  EARTHQUAKE: 'Earthquake',
  FIRE: 'Fire',
  CYCLONE: 'Cyclone',
  LANDSLIDE: 'Landslide',
  OTHER: 'Other',
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
  REPORTED: 'Reported',
  UNDER_VERIFICATION: 'Under Verification',
  VERIFIED: 'Verified',
  RESPONSE_DISPATCHED: 'Response Dispatched',
  RESOLVED: 'Resolved',
  REJECTED: 'Rejected',
}

const enumValues = Object.fromEntries(Object.entries(enumLabels).map(([value, label]) => [label, value]))

export class ApiError extends Error {
  constructor(message, status, details = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

export function setAccessToken(token) {
  accessToken = token || null
}

export function clearAccessToken() {
  accessToken = null
}

async function request(path, { method = 'GET', body, authenticated = false } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (authenticated && accessToken) headers.Authorization = `Bearer ${accessToken}`

  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('Unable to reach the ResQCloud backend. Check that the server is running and try again.')
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    payload = {}
  }

  if (authenticated && (
    response.status === 401 ||
    (response.status === 403 && typeof payload.code === 'string' && payload.code.startsWith('ACCOUNT_'))
  )) {
    clearAccessToken()
    window.dispatchEvent(new Event('resqcloud:authentication-expired'))
  }
  if (!response.ok) {
    const details = Array.isArray(payload.details) ? payload.details : []
    const message = details.length
      ? `${payload.error || 'Request failed'}: ${details.join('; ')}`
      : [payload.error, payload.reason].filter(Boolean).join(': ') || `Request failed with status ${response.status}`
    throw new ApiError(message, response.status, details)
  }
  return payload
}

export async function registerAccount(account) {
  return request('/auth/register', { method: 'POST', body: account })
}

export async function loginAccount(credentials) {
  return request('/auth/login', { method: 'POST', body: credentials })
}

export async function fetchIncidents() {
  const payload = await request('/incidents', { authenticated: true })
  return payload.incidents.map(fromApiIncident)
}

export async function createIncident(incident) {
  const payload = await request('/incidents', {
    method: 'POST',
    authenticated: true,
    body: {
      type: enumValues[incident.type],
      description: incident.description,
      location: incident.location,
      lat: incident.lat,
      lng: incident.lng,
      severity: enumValues[incident.severity],
      affected: incident.affected,
    },
  })
  return fromApiIncident(payload.incident)
}

export async function updateIncidentStatus(incidentId, status) {
  const payload = await request(`/incidents/${encodeURIComponent(incidentId)}/status`, {
    method: 'PATCH',
    authenticated: true,
    body: { status: enumValues[status] },
  })
  return fromApiIncident(payload.incident)
}

export async function fetchApplications(status = 'PENDING') {
  const payload = await request(`/admin/applications?status=${encodeURIComponent(status)}`, { authenticated: true })
  return payload.applications
}

export async function approveApplication(applicationId) {
  const payload = await request(`/admin/applications/${encodeURIComponent(applicationId)}/approve`, {
    method: 'POST',
    authenticated: true,
  })
  return payload.application
}

export async function rejectApplication(applicationId, reason) {
  const payload = await request(`/admin/applications/${encodeURIComponent(applicationId)}/reject`, {
    method: 'POST',
    authenticated: true,
    body: { reason },
  })
  return payload.application
}

function fromApiIncident(incident) {
  return {
    ...incident,
    type: enumLabels[incident.type] || incident.type,
    severity: enumLabels[incident.severity] || incident.severity,
    status: enumLabels[incident.status] || incident.status,
    reporter: incident.reporter?.name || incident.reporterId,
  }
}
