import bcrypt from 'bcrypt'
import dotenv from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.ts'

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true })

const adminLockId = 724681039

export function readInitialAdminCredentials(environment = process.env) {
  const credentials = [1, 2, 3].map((number) => ({
    name: typeof environment[`INITIAL_ADMIN_${number}_NAME`] === 'string'
      ? environment[`INITIAL_ADMIN_${number}_NAME`].trim()
      : '',
    email: typeof environment[`INITIAL_ADMIN_${number}_EMAIL`] === 'string'
      ? environment[`INITIAL_ADMIN_${number}_EMAIL`].trim().toLowerCase()
      : '',
    password: environment[`INITIAL_ADMIN_${number}_PASSWORD`],
  }))
  if (credentials.some(({ name, email, password }) =>
    !name || name.length > 100 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
    name.startsWith('REPLACE_') || email.endsWith('@example.invalid') ||
    typeof password !== 'string' ||
    password.startsWith('REPLACE_') ||
    password.length < 12 || Buffer.byteLength(password, 'utf8') > 72
  )) {
    throw new Error('Configure INITIAL_ADMIN_1..3_NAME, EMAIL, and PASSWORD with valid values in the local environment.')
  }
  if (new Set(credentials.map(({ email }) => email)).size !== 3) {
    throw new Error('The three initial administrator email addresses must be unique.')
  }
  return credentials
}

export async function provisionInitialAdmins(prisma, environment = process.env) {
  const credentials = readInitialAdminCredentials(environment)
  const prepared = await Promise.all(credentials.map(async (admin) => ({
    ...admin,
    passwordHash: await bcrypt.hash(admin.password, 12),
  })))

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${adminLockId})::text AS locked`
    const emails = prepared.map(({ email }) => email)
    const existingAdmins = await transaction.user.findMany({
      where: { role: 'AUTHORITY_ADMINISTRATOR' },
      select: { id: true, email: true, accountStatus: true },
    })
    if (existingAdmins.length > 3 || existingAdmins.some(({ email }) => !emails.includes(email))) {
      throw new Error('The database already contains administrator accounts outside this three-account setup; no accounts were changed.')
    }

    const existingByEmail = await transaction.user.findMany({
      where: { email: { in: emails } },
      select: { id: true, email: true, role: true, accountStatus: true },
    })
    const existingMap = new Map(existingByEmail.map((user) => [user.email, user]))
    for (const admin of prepared) {
      const existing = existingMap.get(admin.email)
      if (existing && (existing.role !== 'AUTHORITY_ADMINISTRATOR' || existing.accountStatus !== 'ACTIVE')) {
        throw new Error('An initial administrator email is already assigned to a different or inactive account; no accounts were changed.')
      }
    }

    let created = 0
    for (const admin of prepared) {
      if (existingMap.has(admin.email)) continue
      await transaction.user.create({
        data: {
          name: admin.name,
          email: admin.email,
          passwordHash: admin.passwordHash,
          role: 'AUTHORITY_ADMINISTRATOR',
          accountStatus: 'ACTIVE',
        },
      })
      created += 1
    }

    const administratorCount = await transaction.user.count({ where: { role: 'AUTHORITY_ADMINISTRATOR' } })
    if (administratorCount !== 3) {
      throw new Error('Initial setup must result in exactly three administrator accounts; transaction rolled back.')
    }
    return { created, total: administratorCount }
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('REPLACE_WITH_LOCAL_PASSWORD')) {
    console.error('Configure DATABASE_URL in server/.env before provisioning administrators.')
    process.exitCode = 1
  } else {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
    try {
      const result = await provisionInitialAdmins(prisma)
      console.log(`Initial administrator setup complete. Created ${result.created}; total configured: ${result.total}.`)
    } catch (error) {
      console.error(`Initial administrator setup failed: ${error.message}`)
      process.exitCode = 1
    } finally {
      await prisma.$disconnect()
    }
  }
}
