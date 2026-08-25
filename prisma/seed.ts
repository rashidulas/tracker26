import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // Seed Categories
  const categoriesData = [
    // Income Categories
    { name: 'Salary', type: 'INCOME' as const, color: '#10b981', icon: '💼' },
    { name: 'Freelance', type: 'INCOME' as const, color: '#3b82f6', icon: '💻' },
    { name: 'Investments', type: 'INCOME' as const, color: '#8b5cf6', icon: '📈' },
    { name: 'Other Income', type: 'INCOME' as const, color: '#14b8a6', icon: '💰' },
    
    // Expense Categories
    { name: 'Groceries', type: 'EXPENSE' as const, color: '#ef4444', icon: '🛒' },
    { name: 'Dining Out', type: 'EXPENSE' as const, color: '#f97316', icon: '🍽️' },
    { name: 'Transportation', type: 'EXPENSE' as const, color: '#eab308', icon: '🚗' },
    { name: 'Utilities', type: 'EXPENSE' as const, color: '#06b6d4', icon: '💡' },
    { name: 'Rent/Mortgage', type: 'EXPENSE' as const, color: '#6366f1', icon: '🏠' },
    { name: 'Healthcare', type: 'EXPENSE' as const, color: '#ec4899', icon: '🏥' },
    { name: 'Entertainment', type: 'EXPENSE' as const, color: '#f43f5e', icon: '🎬' },
    { name: 'Shopping', type: 'EXPENSE' as const, color: '#a855f7', icon: '🛍️' },
    { name: 'Travel', type: 'EXPENSE' as const, color: '#0ea5e9', icon: '✈️' },
    { name: 'Education', type: 'EXPENSE' as const, color: '#84cc16', icon: '📚' },
    { name: 'Insurance', type: 'EXPENSE' as const, color: '#22c55e', icon: '🛡️' },
    { name: 'Other Expenses', type: 'EXPENSE' as const, color: '#64748b', icon: '📝' },
  ]

  console.log('Creating categories...')
  for (const category of categoriesData) {
    await prisma.category.create({
      data: category,
    })
  }
  console.log(`✅ Created ${categoriesData.length} categories`)

  // Seed Accounts
  const accountsData = [
    { name: 'Main Checking', type: 'CHECKING' as const, institution: 'Chase Bank', startingBalance: 5000 },
    { name: 'Savings Account', type: 'SAVINGS' as const, institution: 'Chase Bank', startingBalance: 15000 },
    { name: 'Cash Wallet', type: 'CASH' as const, startingBalance: 200 },
    { name: 'Credit Card', type: 'CREDIT_CARD' as const, institution: 'Chase Sapphire', startingBalance: 0 },
    { name: 'Investment Account', type: 'INVESTMENT' as const, institution: 'Vanguard', startingBalance: 25000 },
  ]

  console.log('Creating accounts...')
  for (const account of accountsData) {
    await prisma.account.create({
      data: account,
    })
  }
  console.log(`✅ Created ${accountsData.length} accounts`)

  // Seed a sample goal
  console.log('Creating sample goal...')
  await prisma.goal.create({
    data: {
      name: 'Emergency Fund',
      targetAmount: 10000,
      dueDate: new Date('2026-12-31'),
    },
  })
  console.log('✅ Created sample goal')

  console.log('🎉 Seeding completed!')
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
