import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.ts'

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

const testEmail = 'resqcloud-db-smoke-test@localhost.invalid'
const testUserName = 'ResQCloud Database CRUD Smoke Test User'
const testIncidentDescription = 'RESQCLOUD_DB_CRUD_SMOKE_TEST_INCIDENT'
const testPasswordHash = 'smoke-test-hash-not-for-authentication'

if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('REPLACE_WITH_LOCAL_PASSWORD')) {
  console.error('Set your local PostgreSQL password in server/.env before running the database test. Do not share the password.')
  process.exit(1)
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
let user
let incident

try {
  user = await prisma.user.findUnique({ where: { email: testEmail } })
  if (user && user.name !== testUserName) {
    throw new Error('The test email belongs to a record without the expected test marker; no records were changed.')
  }

  if (!user) {
    user = await prisma.user.create({
      data: {
        name: testUserName,
        email: testEmail,
        passwordHash: testPasswordHash,
        role: 'CITIZEN',
      },
    })
  }
  console.log('Create/ensure test user: passed')

  const matchingIncidents = await prisma.incident.findMany({
    where: { description: testIncidentDescription },
  })
  if (matchingIncidents.length > 1) {
    throw new Error('Multiple incidents use the smoke-test marker; records were preserved for inspection.')
  }

  incident = matchingIncidents[0]
  if (incident && incident.reporterId !== user.id) {
    throw new Error('The smoke-test incident marker is associated with another user; records were preserved.')
  }

  if (!incident) {
    incident = await prisma.incident.create({
      data: {
        type: 'OTHER',
        description: testIncidentDescription,
        location: 'Smoke-test location (not a real incident)',
        severity: 'LOW',
        status: 'REPORTED',
        affected: 0,
        reporter: { connect: { id: user.id } },
      },
    })
  }
  console.log('Create/ensure test incident: passed')

  const [readUser, readIncident] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id } }),
    prisma.incident.findUnique({
      where: { id: incident.id },
      include: { reporter: true },
    }),
  ])

  if (!readUser || readUser.email !== testEmail || readUser.name !== testUserName) {
    throw new Error('Could not read back the expected smoke-test user; records were preserved.')
  }
  if (
    !readIncident ||
    readIncident.description !== testIncidentDescription ||
    readIncident.reporterId !== readUser.id ||
    readIncident.reporter.id !== readUser.id
  ) {
    throw new Error('Incident read-back or reporter relationship verification failed; records were preserved.')
  }

  console.log('Read test user and incident: passed')
  console.log('Reporter relationship verification: passed')

  await prisma.$transaction(async (transaction) => {
    const deletedIncident = await transaction.incident.deleteMany({
      where: {
        id: incident.id,
        description: testIncidentDescription,
        reporterId: user.id,
      },
    })
    if (deletedIncident.count !== 1) {
      throw new Error('Could not safely delete exactly the smoke-test incident.')
    }

    const deletedUser = await transaction.user.deleteMany({
      where: {
        id: user.id,
        email: testEmail,
        name: testUserName,
        incidents: { none: {} },
      },
    })
    if (deletedUser.count !== 1) {
      throw new Error('Could not safely delete exactly the smoke-test user.')
    }
  })

  console.log('Cleanup: passed')
} catch (error) {
  console.error(`Database CRUD smoke test failed: ${error.message}`)
  if (user?.id) {
    console.error(`Preserved smoke-test user ID for debugging: ${user.id}`)
  }
  if (incident?.id) {
    console.error(`Preserved smoke-test incident ID for debugging: ${incident.id}`)
  }
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
