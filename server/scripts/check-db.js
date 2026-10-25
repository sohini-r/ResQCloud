import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.ts'

if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('REPLACE_WITH_LOCAL_PASSWORD')) {
  console.error('Set your local PostgreSQL password in server/.env before running the database check. Do not share the password.')
  process.exit(1)
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

try {
  await prisma.$queryRaw`SELECT 1`
  console.log('Prisma connected successfully to the configured PostgreSQL database.')
} catch (error) {
  const code = typeof error?.code === 'string' ? ` (code: ${error.code})` : ''
  console.error(`Prisma could not connect to PostgreSQL${code}. Check that the server is running and DATABASE_URL in server/.env contains the correct local credentials.`)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
