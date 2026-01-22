'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import {
  investmentHoldingSchema,
  investmentTransactionSchema,
  type InvestmentHoldingInput,
  type InvestmentTransactionInput,
} from '@/lib/validations';

// ==================== HOLDINGS ====================
export async function getHoldings() {
  try {
    const holdings = await prisma.investmentHolding.findMany({
      include: {
        account: true,
        transactions: {
          orderBy: { date: 'desc' },
          take: 5,
        },
      },
      orderBy: { symbol: 'asc' },
    });

    // Calculate market value and gains for each holding
    const enrichedHoldings = holdings.map(holding => ({
      ...holding,
      marketValue: holding.quantity * holding.lastPrice,
      totalCost: holding.quantity * holding.avgCostBasis,
      gain: (holding.quantity * holding.lastPrice) - (holding.quantity * holding.avgCostBasis),
      gainPercent: holding.avgCostBasis > 0
        ? ((holding.lastPrice - holding.avgCostBasis) / holding.avgCostBasis) * 100
        : 0,
    }));

    return enrichedHoldings;
  } catch (error) {
    console.error('Error fetching holdings:', error);
    throw new Error('Failed to fetch holdings');
  }
}

export async function createHolding(data: InvestmentHoldingInput) {
  try {
    const validated = investmentHoldingSchema.parse(data);

    const holding = await prisma.investmentHolding.create({
      data: validated,
    });

    revalidatePath('/investments');
    return { success: true, data: holding };
  } catch (error) {
    console.error('Error creating holding:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create holding' };
  }
}

export async function updateHolding(id: string, data: InvestmentHoldingInput) {
  try {
    const validated = investmentHoldingSchema.parse(data);

    const holding = await prisma.investmentHolding.update({
      where: { id },
      data: validated,
    });

    revalidatePath('/investments');
    return { success: true, data: holding };
  } catch (error) {
    console.error('Error updating holding:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update holding' };
  }
}

export async function updateLastPrice(id: string, lastPrice: number) {
  try {
    const holding = await prisma.investmentHolding.update({
      where: { id },
      data: { lastPrice },
    });

    revalidatePath('/investments');
    return { success: true, data: holding };
  } catch (error) {
    console.error('Error updating price:', error);
    return { success: false, error: 'Failed to update price' };
  }
}

export async function deleteHolding(id: string) {
  try {
    await prisma.investmentHolding.delete({
      where: { id },
    });

    revalidatePath('/investments');
    return { success: true };
  } catch (error) {
    console.error('Error deleting holding:', error);
    return { success: false, error: 'Failed to delete holding' };
  }
}

// ==================== TRANSACTIONS ====================
export async function getInvestmentTransactions() {
  try {
    const transactions = await prisma.investmentTransaction.findMany({
      include: {
        account: true,
        holding: true,
      },
      orderBy: { date: 'desc' },
    });

    return transactions;
  } catch (error) {
    console.error('Error fetching investment transactions:', error);
    throw new Error('Failed to fetch investment transactions');
  }
}

export async function createInvestmentTransaction(data: InvestmentTransactionInput) {
  try {
    const validated = investmentTransactionSchema.parse(data);

    // For BUY transactions, update or create holding
    if (validated.type === 'BUY' && validated.symbol && validated.quantity && validated.price) {
      const existingHolding = await prisma.investmentHolding.findFirst({
        where: {
          symbol: validated.symbol,
          accountId: validated.accountId,
        },
      });

      if (existingHolding) {
        // Update existing holding
        const newQuantity = existingHolding.quantity + validated.quantity;
        const newTotalCost = (existingHolding.quantity * existingHolding.avgCostBasis) + (validated.quantity * validated.price);
        const newAvgCost = newTotalCost / newQuantity;

        await prisma.investmentHolding.update({
          where: { id: existingHolding.id },
          data: {
            quantity: newQuantity,
            avgCostBasis: newAvgCost,
            lastPrice: validated.price,
          },
        });

        // Create transaction
        const transaction = await prisma.investmentTransaction.create({
          data: {
            ...validated,
            holdingId: existingHolding.id,
          },
        });

        revalidatePath('/investments');
        return { success: true, data: transaction };
      } else {
        // Create new holding
        const holding = await prisma.investmentHolding.create({
          data: {
            symbol: validated.symbol,
            name: validated.notes || validated.symbol,
            quantity: validated.quantity,
            avgCostBasis: validated.price,
            lastPrice: validated.price,
            accountId: validated.accountId,
          },
        });

        // Create transaction
        const transaction = await prisma.investmentTransaction.create({
          data: {
            ...validated,
            holdingId: holding.id,
          },
        });

        revalidatePath('/investments');
        return { success: true, data: transaction };
      }
    }

    // For SELL transactions
    if (validated.type === 'SELL' && validated.symbol && validated.quantity && validated.price) {
      const holding = await prisma.investmentHolding.findFirst({
        where: {
          symbol: validated.symbol,
          accountId: validated.accountId,
        },
      });

      if (!holding) {
        return { success: false, error: 'Holding not found' };
      }

      if (holding.quantity < validated.quantity) {
        return { success: false, error: 'Insufficient quantity' };
      }

      // Update holding quantity
      const newQuantity = holding.quantity - validated.quantity;
      if (newQuantity === 0) {
        // Delete holding if fully sold
        await prisma.investmentHolding.delete({ where: { id: holding.id } });
      } else {
        await prisma.investmentHolding.update({
          where: { id: holding.id },
          data: { quantity: newQuantity, lastPrice: validated.price },
        });
      }

      // Create transaction
      const transaction = await prisma.investmentTransaction.create({
        data: {
          ...validated,
          holdingId: holding.id,
        },
      });

      revalidatePath('/investments');
      return { success: true, data: transaction };
    }

    // For other transaction types (CONTRIBUTION, WITHDRAWAL, DIVIDEND)
    const transaction = await prisma.investmentTransaction.create({
      data: validated,
    });

    revalidatePath('/investments');
    return { success: true, data: transaction };
  } catch (error) {
    console.error('Error creating investment transaction:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create transaction' };
  }
}

export async function deleteInvestmentTransaction(id: string) {
  try {
    await prisma.investmentTransaction.delete({
      where: { id },
    });

    revalidatePath('/investments');
    return { success: true };
  } catch (error) {
    console.error('Error deleting investment transaction:', error);
    return { success: false, error: 'Failed to delete transaction' };
  }
}

// ==================== HELPERS ====================
export async function getInvestmentAccounts() {
  const accounts = await prisma.account.findMany({
    where: { type: 'INVESTMENT' },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  return accounts;
}

// ==================== STATS ====================
export async function getInvestmentStats() {
  try {
    const holdings = await getHoldings();
    
    const totalMarketValue = holdings.reduce((sum, h) => sum + h.marketValue, 0);
    const totalCost = holdings.reduce((sum, h) => sum + h.totalCost, 0);
    const totalGain = totalMarketValue - totalCost;
    const totalGainPercent = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

    // Get transaction history for chart
    const transactions = await prisma.investmentTransaction.findMany({
      where: {
        type: { in: ['BUY', 'CONTRIBUTION'] },
      },
      orderBy: { date: 'asc' },
      select: {
        date: true,
        amount: true,
      },
    });

    // Group by month
    const monthlyContributions: { [key: string]: number } = {};
    transactions.forEach(tx => {
      const monthKey = tx.date.toISOString().substring(0, 7); // YYYY-MM
      monthlyContributions[monthKey] = (monthlyContributions[monthKey] || 0) + tx.amount;
    });

    const contributionHistory = Object.entries(monthlyContributions)
      .map(([month, amount]) => ({ month, amount }))
      .slice(-12); // Last 12 months

    return {
      totalMarketValue,
      totalCost,
      totalGain,
      totalGainPercent,
      holdingsCount: holdings.length,
      contributionHistory,
    };
  } catch (error) {
    console.error('Error fetching investment stats:', error);
    throw new Error('Failed to fetch investment stats');
  }
}
