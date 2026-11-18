/** Read-side helpers for savings goals (no database access). */

export type GoalProgressInput = {
  targetAmount: number;
  contributions: { amount: number; transactionId?: string | null }[];
};

/**
 * Saved so far and progress toward the target. Transfers and earmarks both
 * count: either way the money is set aside for the goal.
 */
export function goalProgress<T extends GoalProgressInput>(goal: T) {
  const totalContributions = goal.contributions.reduce((sum, c) => sum + c.amount, 0);
  const transferred = goal.contributions
    .filter((c) => c.transactionId)
    .reduce((sum, c) => sum + c.amount, 0);
  const progress = goal.targetAmount > 0 ? (totalContributions / goal.targetAmount) * 100 : 0;
  return {
    ...goal,
    totalContributions,
    transferred,
    earmarked: totalContributions - transferred,
    remaining: Math.max(0, goal.targetAmount - totalContributions),
    progress: Math.min(progress, 100),
  };
}
