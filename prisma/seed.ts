import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // Seed Categories
  const categoriesData = [
    // Income Categories
    { name: 'Salary', type: 'INCOME', color: '#10b981', icon: '💼' },
    { name: 'Freelance', type: 'INCOME', color: '#3b82f6', icon: '💻' },
    { name: 'Investments', type: 'INCOME', color: '#8b5cf6', icon: '📈' },
    { name: 'Other Income', type: 'INCOME', color: '#14b8a6', icon: '💰' },
    
    // Expense Categories
    { name: 'Groceries', type: 'EXPENSE', color: '#ef4444', icon: '🛒' },
    { name: 'Dining Out', type: 'EXPENSE', color: '#f97316', icon: '🍽️' },
    { name: 'Transportation', type: 'EXPENSE', color: '#eab308', icon: '🚗' },
    { name: 'Utilities', type: 'EXPENSE', color: '#06b6d4', icon: '💡' },
    { name: 'Rent/Mortgage', type: 'EXPENSE', color: '#6366f1', icon: '🏠' },
    { name: 'Healthcare', type: 'EXPENSE', color: '#ec4899', icon: '🏥' },
    { name: 'Entertainment', type: 'EXPENSE', color: '#f43f5e', icon: '🎬' },
    { name: 'Shopping', type: 'EXPENSE', color: '#a855f7', icon: '🛍️' },
    { name: 'Travel', type: 'EXPENSE', color: '#0ea5e9', icon: '✈️' },
    { name: 'Education', type: 'EXPENSE', color: '#84cc16', icon: '📚' },
    { name: 'Insurance', type: 'EXPENSE', color: '#22c55e', icon: '🛡️' },
    { name: 'Other Expenses', type: 'EXPENSE', color: '#64748b', icon: '📝' },
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
    { name: 'Main Checking', type: 'CHECKING', institution: 'Chase Bank', startingBalance: 5000 },
    { name: 'Savings Account', type: 'SAVINGS', institution: 'Chase Bank', startingBalance: 15000 },
    { name: 'Cash Wallet', type: 'CASH', startingBalance: 200 },
    { name: 'Credit Card', type: 'CREDIT_CARD', institution: 'Chase Sapphire', startingBalance: 0 },
    { name: 'Investment Account', type: 'INVESTMENT', institution: 'Vanguard', startingBalance: 25000 },
  ]

  console.log('Creating accounts...')
  for (const account of accountsData) {
    await prisma.account.create({
      data: account,
    })
  }
  console.log(`✅ Created ${accountsData.length} accounts`)

  // Seed a sample debt
  console.log('Creating sample debt...')
  await prisma.debt.create({
    data: {
      name: 'Student Loan',
      type: 'STUDENT_LOAN',
      currentBalance: 15000,
      apr: 4.5,
      minPayment: 250,
      dueDay: 15,
    },
  })
  console.log('✅ Created sample debt')

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
