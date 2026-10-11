import { Prisma, PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaFingerprint?: string
}

/** Changes when the generated client shape changes (models / enums). */
function clientFingerprint() {
  const enums =
    Prisma.dmmf?.datamodel?.enums
      ?.map((e) => `${e.name}:${e.values.map((v) => v.name).join(',')}`)
      .join('|') ?? ''
  const models = Object.keys(Prisma.ModelName ?? {}).sort().join(',')
  return `${models}::${enums}`
}

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })
}

function getPrismaClient() {
  const fingerprint = clientFingerprint()
  const existing = globalForPrisma.prisma

  if (existing && globalForPrisma.prismaFingerprint === fingerprint) {
    return existing
  }

  if (existing) {
    void existing.$disconnect().catch(() => {})
  }

  const client = createPrismaClient()
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = client
    globalForPrisma.prismaFingerprint = fingerprint
  }
  return client
}

export const prisma = getPrismaClient()
