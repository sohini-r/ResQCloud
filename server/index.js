import 'dotenv/config'
import bcrypt from 'bcrypt'
import cors from 'cors'
import helmet from 'helmet'
import { randomBytes } from 'node:crypto'
import express from 'express'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client.ts'
import { IncidentStatus } from './generated/prisma/enums.ts'
import { accountStatusLabels, allowRoles, createAuthMiddleware, roleLabels, serializeUser, signAccessToken } from './auth.js'
import { getBackendConfig } from './config.js'

const app = express()
let config
try {
  config = getBackendConfig()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
const { port, host, isProduction, corsOrigins } = config
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
const dummyPasswordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12)

const roles = ['CITIZEN', 'AUTHORITY_ADMINISTRATOR', 'VOLUNTEER', 'SHELTER_MANAGER']
const authenticate = createAuthMiddleware(prisma, process.env.JWT_SECRET)
const incidentAccess = allowRoles(...roles)
const registrationFields = new Set(['name', 'email', 'password', 'phone', 'address', 'role'])
const incidentTypes = ['FLOOD', 'EARTHQUAKE', 'FIRE', 'CYCLONE', 'LANDSLIDE', 'OTHER']
const incidentSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
const incidentFields = new Set([
  'type',
  'description',
  'location',
  'lat',
  'lng',
  'severity',
  'affected',
])

const corsOptions = {
  origin(origin, callback) {
    if (!origin || corsOrigins.includes(origin)) {
      callback(null, true)
      return
    }
    callback(null, false)
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}
app.use(helmet())
app.use(cors(corsOptions))
app.use(express.json({ limit: '1mb' }))

const checkHealth = async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    response.json({
      status: 'ok',
      message: 'ResQCloud backend is running',
      database: 'connected',
    })
  } catch (error) {
    console.error('Database health check failed:', error?.code || error?.name || 'UnknownError')
    response.status(503).json({ status: 'error', database: 'unavailable' })
  }
}

app.get('/api/health', checkHealth)
app.get('/api/health/db', checkHealth)

const authRouter = express.Router()

authRouter.post('/register', async (request, response, next) => {
  const body = request.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    response.status(400).json({ error: 'Request body must be a JSON object' })
    return
  }
  if ('role' in body) {
    if (!['CITIZEN', 'VOLUNTEER', 'SHELTER_MANAGER'].includes(body.role)) {
      response.status(403).json({ error: 'Public registration cannot create this role' })
      return
    }
  }
  const unknownFields = Object.keys(body).filter((field) => !registrationFields.has(field))
  if (unknownFields.length > 0) {
    response.status(400).json({ error: `Unexpected field(s): ${unknownFields.join(', ')}` })
    return
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const requestedRole = body.role || 'CITIZEN'
  const password = body.password
  const passwordBytes = typeof password === 'string' ? Buffer.byteLength(password, 'utf8') : 0
  const errors = []
  if (!name || name.length > 100) errors.push('name must be a non-empty string of at most 100 characters')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) errors.push('email must be a valid email address')
  if (typeof password !== 'string' || password.length < 12 || passwordBytes > 72) {
    errors.push('password must be at least 12 characters and at most 72 UTF-8 bytes')
  }
  for (const field of ['phone', 'address']) {
    if (body[field] !== undefined && (typeof body[field] !== 'string' || body[field].length > (field === 'phone' ? 50 : 500))) {
      errors.push(`${field} must be a string of at most ${field === 'phone' ? 50 : 500} characters`)
    }
  }
  if (errors.length > 0) {
    response.status(400).json({ error: 'Invalid registration input', details: errors })
    return
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: 'CITIZEN',
        requestedRole: requestedRole === 'CITIZEN' ? null : requestedRole,
        accountStatus: requestedRole === 'CITIZEN' ? 'ACTIVE' : 'PENDING',
        applicationSubmittedAt: requestedRole === 'CITIZEN' ? null : new Date(),
        phone: body.phone?.trim() || null,
        address: body.address?.trim() || null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        accountStatus: true,
        phone: true,
        address: true,
        applicationSubmittedAt: true,
      },
    })
    if (requestedRole !== 'CITIZEN') {
      response.status(202).json({
        user: serializeUser(user),
        application: {
          status: 'PENDING',
          requestedRole: roleLabels[requestedRole],
          submittedAt: user.applicationSubmittedAt,
        },
        message: 'Your application has been submitted and is awaiting administrator review.',
      })
      return
    }
    response.status(201).json({
      user: serializeUser(user),
      token: signAccessToken(user.id, process.env.JWT_SECRET),
      tokenType: 'Bearer',
      expiresIn: 3600,
    })
  } catch (error) {
    if (error?.code === 'P2002') {
      response.status(409).json({ error: 'An account with this email already exists' })
      return
    }
    next(error)
  }
})

authRouter.post('/login', async (request, response, next) => {
  const body = request.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    response.status(400).json({ error: 'Request body must be a JSON object' })
    return
  }
  if (Object.keys(body).some((field) => !['email', 'password'].includes(field))) {
    response.status(400).json({ error: 'Login accepts only email and password' })
    return
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || typeof body.password !== 'string' || !body.password || Buffer.byteLength(body.password, 'utf8') > 72) {
    response.status(400).json({ error: 'A valid email and password are required' })
    return
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } })
    const usablePasswordHash = user && /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(user.passwordHash)
    const passwordMatches = await bcrypt.compare(
      body.password,
      usablePasswordHash ? user.passwordHash : dummyPasswordHash,
    )
    if (!user || !passwordMatches) {
      response.status(401).json({ error: 'Invalid email or password' })
      return
    }
    if (user.accountStatus === 'PENDING') {
      response.status(403).json({
        error: 'Your application is pending administrator review',
        code: 'ACCOUNT_PENDING',
        applicationStatus: 'PENDING',
      })
      return
    }
    if (user.accountStatus === 'REJECTED') {
      response.status(403).json({
        error: 'Your application was rejected',
        code: 'ACCOUNT_REJECTED',
        applicationStatus: 'REJECTED',
        ...(user.applicationRejectionReason ? { reason: user.applicationRejectionReason } : {}),
      })
      return
    }
    if (!['ACTIVE', 'APPROVED'].includes(user.accountStatus)) {
      response.status(403).json({
        error: 'This account is not active',
        code: `ACCOUNT_${user.accountStatus}`,
      })
      return
    }

    response.json({
      user: serializeUser(user),
      token: signAccessToken(user.id, process.env.JWT_SECRET),
      tokenType: 'Bearer',
      expiresIn: 3600,
    })
  } catch (error) {
    next(error)
  }
})

app.use('/api/auth', authRouter)

const adminRouter = express.Router()
adminRouter.use(authenticate, allowRoles('AUTHORITY_ADMINISTRATOR'))

const applicationSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  address: true,
  requestedRole: true,
  accountStatus: true,
  applicationSubmittedAt: true,
  applicationReviewedAt: true,
  applicationReviewedById: true,
  applicationReviewedBy: { select: { id: true, name: true } },
  applicationRejectionReason: true,
}

adminRouter.get('/applications', async (request, response, next) => {
  const status = request.query.status || 'PENDING'
  if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    response.status(400).json({ error: 'status must be PENDING, APPROVED, or REJECTED' })
    return
  }
  try {
    const applications = await prisma.user.findMany({
      where: { requestedRole: { in: ['VOLUNTEER', 'SHELTER_MANAGER'] }, accountStatus: status },
      select: applicationSelect,
      orderBy: { applicationSubmittedAt: 'desc' },
    })
    response.json({
      applications: applications.map((application) => ({
        ...application,
        requestedRole: roleLabels[application.requestedRole],
        status: accountStatusLabels[application.accountStatus],
      })),
    })
  } catch (error) {
    next(error)
  }
})

adminRouter.get('/applications/:id', async (request, response, next) => {
  try {
    const application = await prisma.user.findFirst({
      where: {
        id: request.params.id,
        requestedRole: { in: ['VOLUNTEER', 'SHELTER_MANAGER'] },
      },
      select: applicationSelect,
    })
    if (!application) {
      response.status(404).json({ error: 'Application not found' })
      return
    }
    response.json({
      application: {
        ...application,
        requestedRole: roleLabels[application.requestedRole],
        status: accountStatusLabels[application.accountStatus],
      },
    })
  } catch (error) {
    next(error)
  }
})

adminRouter.post('/applications/:id/approve', async (request, response, next) => {
  try {
    const application = await prisma.user.findFirst({
      where: { id: request.params.id, accountStatus: 'PENDING' },
      select: { id: true, requestedRole: true },
    })
    if (!application || !['VOLUNTEER', 'SHELTER_MANAGER'].includes(application.requestedRole)) {
      response.status(404).json({ error: 'Pending application not found' })
      return
    }
    const updated = await prisma.user.updateMany({
      where: { id: application.id, accountStatus: 'PENDING', requestedRole: application.requestedRole },
      data: {
        role: application.requestedRole,
        accountStatus: 'APPROVED',
        applicationReviewedAt: new Date(),
        applicationReviewedById: request.authUser.id,
        applicationRejectionReason: null,
      },
    })
    if (updated.count !== 1) {
      response.status(409).json({ error: 'This application has already been reviewed' })
      return
    }
    const reviewed = await prisma.user.findUnique({ where: { id: application.id }, select: applicationSelect })
    response.json({
      application: {
        ...reviewed,
        requestedRole: roleLabels[reviewed.requestedRole],
        status: accountStatusLabels[reviewed.accountStatus],
      },
    })
  } catch (error) {
    next(error)
  }
})

adminRouter.post('/applications/:id/reject', async (request, response, next) => {
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : ''
  if (!reason || reason.length > 2000) {
    response.status(400).json({ error: 'A rejection reason of 1 to 2000 characters is required' })
    return
  }
  try {
    const updated = await prisma.user.updateMany({
      where: {
        id: request.params.id,
        accountStatus: 'PENDING',
        requestedRole: { in: ['VOLUNTEER', 'SHELTER_MANAGER'] },
      },
      data: {
        accountStatus: 'REJECTED',
        applicationReviewedAt: new Date(),
        applicationReviewedById: request.authUser.id,
        applicationRejectionReason: reason,
      },
    })
    if (updated.count !== 1) {
      response.status(404).json({ error: 'Pending application not found' })
      return
    }
    const reviewed = await prisma.user.findUnique({ where: { id: request.params.id }, select: applicationSelect })
    response.json({
      application: {
        ...reviewed,
        requestedRole: roleLabels[reviewed.requestedRole],
        status: accountStatusLabels[reviewed.accountStatus],
      },
    })
  } catch (error) {
    next(error)
  }
})

app.use('/api/admin', adminRouter)

app.get('/api/incidents', authenticate, incidentAccess, async (_request, response, next) => {
  try {
    const incidents = await prisma.incident.findMany({
      orderBy: { reportedAt: 'desc' },
      include: { reporter: { select: { id: true, name: true } } },
    })
    response.json({ incidents })
  } catch (error) {
    next(error)
  }
})

app.get('/api/incidents/:id', authenticate, incidentAccess, async (request, response, next) => {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: request.params.id },
      include: { reporter: { select: { id: true, name: true } } },
    })

    if (!incident) {
      response.status(404).json({ error: 'Incident not found' })
      return
    }

    response.json({ incident })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/incidents/:id/status', authenticate, allowRoles('AUTHORITY_ADMINISTRATOR'), async (request, response, next) => {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(request.params.id)) {
    response.status(400).json({ error: 'Invalid incident ID' })
    return
  }

  const body = request.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    response.status(400).json({ error: 'Request body must be a JSON object' })
    return
  }
  const unexpectedFields = Object.keys(body).filter((field) => field !== 'status')
  if (unexpectedFields.length > 0) {
    response.status(400).json({ error: `Unexpected field(s): ${unexpectedFields.join(', ')}` })
    return
  }
  if (typeof body.status !== 'string' || !Object.values(IncidentStatus).includes(body.status)) {
    response.status(400).json({ error: `status must be one of: ${Object.values(IncidentStatus).join(', ')}` })
    return
  }

  try {
    const incident = await prisma.incident.update({
      where: { id: request.params.id },
      data: { status: body.status },
      include: { reporter: { select: { id: true, name: true } } },
    })
    response.json({ incident })
  } catch (error) {
    if (error?.code === 'P2025') {
      response.status(404).json({ error: 'Incident not found' })
      return
    }
    next(error)
  }
})

app.post('/api/incidents', authenticate, incidentAccess, async (request, response, next) => {
  const body = request.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    response.status(400).json({ error: 'Request body must be a JSON object' })
    return
  }

  const unknownFields = Object.keys(body).filter((field) => !incidentFields.has(field))
  if (unknownFields.length > 0) {
    response.status(400).json({ error: `Unexpected field(s): ${unknownFields.join(', ')}` })
    return
  }

  const errors = []
  if (!incidentTypes.includes(body.type)) {
    errors.push(`type must be one of: ${incidentTypes.join(', ')}`)
  }
  if (typeof body.description !== 'string' || !body.description.trim() || body.description.length > 10000) {
    errors.push('description must be a non-empty string of at most 10000 characters')
  }
  if (typeof body.location !== 'string' || !body.location.trim() || body.location.length > 500) {
    errors.push('location must be a non-empty string of at most 500 characters')
  }
  if (!incidentSeverities.includes(body.severity)) {
    errors.push(`severity must be one of: ${incidentSeverities.join(', ')}`)
  }
  if (
    body.affected !== undefined &&
    (!Number.isInteger(body.affected) || body.affected < 0 || body.affected > 2147483647)
  ) {
    errors.push('affected must be a non-negative integer')
  }
  if (
    body.lat !== undefined &&
    (typeof body.lat !== 'number' || !Number.isFinite(body.lat) || body.lat < -90 || body.lat > 90)
  ) {
    errors.push('lat must be a number between -90 and 90')
  }
  if (
    body.lng !== undefined &&
    (typeof body.lng !== 'number' || !Number.isFinite(body.lng) || body.lng < -180 || body.lng > 180)
  ) {
    errors.push('lng must be a number between -180 and 180')
  }
  if ((body.lat === undefined) !== (body.lng === undefined)) {
    errors.push('lat and lng must be provided together')
  }

  if (errors.length > 0) {
    response.status(400).json({ error: 'Invalid incident input', details: errors })
    return
  }

  try {
    const incident = await prisma.incident.create({
      data: {
        type: body.type,
        description: body.description.trim(),
        location: body.location.trim(),
        lat: body.lat,
        lng: body.lng,
        severity: body.severity,
        affected: body.affected,
        reporterId: request.authUser.id,
      },
      include: { reporter: { select: { id: true, name: true } } },
    })
    response.status(201).json({ incident })
  } catch (error) {
    next(error)
  }
})

app.use((_request, response) => {
  response.status(404).json({ error: 'Not found' })
})

app.use((error, _request, response, _next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    response.status(400).json({ error: 'Invalid JSON request body' })
    return
  }

  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
    response.status(error.status).json({ error: 'Invalid request' })
    return
  }

  if (error?.code === 'P2003') {
    response.status(409).json({ error: 'Incident reporter could not be associated with a user' })
    return
  }

  console.error('Unhandled server error:', error?.code || error?.name || 'UnknownError')
  response.status(500).json({ error: 'Internal server error' })
})

const servers = []
if (!isProduction && !process.env.HOST) {
  servers.push(app.listen(port, '127.0.0.1'))
  servers.push(app.listen(port, '::1'))
} else {
  servers.push(app.listen(port, host))
}
servers[0].once('listening', () => {
  console.log(`ResQCloud backend listening on port ${port}`)
})
for (const server of servers) {
  server.once('error', (error) => {
    console.error(`ResQCloud backend failed to listen (${error.code || error.name || 'UnknownError'}).`)
    process.exitCode = 1
    void shutdown()
  })
}

const shutdown = async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
  await prisma.$disconnect()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
