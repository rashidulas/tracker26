import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })
}

function getPrismaClient() {
  const existing = globalForPrisma.prisma
  // After schema changes (e.g. new models), a hot-reloaded process can keep a
  // stale PrismaClient on globalThis that is missing delegates like `friend`.
  if (existing && 'friend' in existing && 'friendEntry' in existing) {
    return existing
  }

  const client = createPrismaClient()
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = client
  }
  return client
}

export const prisma = getPrismaClient()
