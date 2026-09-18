// src/utils/paSwipeCalc.ts

export const TERM_OPTIONS = [3, 6, 9, 12] as const;

export const interestMap: Record<number, number> = {
  3: 0.10,
  6: 0.20,
  9: 0.30,
  12: 0.40,
};

export const DOWNPAYMENT_OPTIONS = [0.10, 0.20] as const;
export const DEFAULT_DOWNPAYMENT_RATE = 0.20; // used for older items that predate this option
export const GRACE_DAYS = 3;
export const DAILY_LATE_RATE = 0.001; // 0.1% per day
export const LATE_FEE_CAP_RATE = 0.10; // max 10% of the overdue installment
export const REPOSSESSION_DAYS = 30;

export type CalcInput = {
  srp: number;
  termMonths: number;
  downpaymentRate?: number; // 0.10 or 0.20 — defaults to 0.20 if not given
};

export type PricingResult = {
  srp: number;
  termMonths: number;
  installmentCount: number;
  interestRate: number;
  downpaymentRate: number;
  downpayment: number;
  interest: number;
  remainingBalance: number;
  installmentAmount: number; // per semi-monthly payment
};
/**
 * Core Pa-Swipe pricing — MLF Easy Installments (v3 formula)
 *
 * Downpayment = SRP × 20%
 * Interest = SRP × tier rate (10/20/30/40% based on term)
 * Remaining Balance = (SRP - Downpayment) + Interest
 * Installments = termMonths × 2 (semi-monthly, 15th/30th)
 */
export function calcPaSwipePricing(input: CalcInput): PricingResult {
  const srp = Number(input.srp || 0);
  const term = Number(input.termMonths || 12);
  const downpaymentRate = Number(input.downpaymentRate ?? DEFAULT_DOWNPAYMENT_RATE);

  const rate = interestMap[term] ?? interestMap[12];
  const installmentCount = term * 2;

  const downpayment = Math.round(srp * downpaymentRate * 100) / 100;
  const interest = Math.round(srp * rate * 100) / 100;

  const remainingBalance =
    Math.round(((srp - downpayment) + interest) * 100) / 100;

  const installmentAmount =
    installmentCount > 0
      ? Math.round((remainingBalance / installmentCount) * 100) / 100
      : 0;

  return {
    srp,
    termMonths: term,
    installmentCount,
    interestRate: rate,
    downpaymentRate,
    downpayment,
    interest,
    remainingBalance,
    installmentAmount,
  };
}

/**
 * Late fee calculation for an overdue installment.
 *
 * - Grace period: 3 calendar days after due date, zero penalty.
 * - Day 4 onward: 0.1% per day, counted from the END of the grace
 *   period (i.e. Day 4 late = 1 day charged, Day 5 = 2 days charged, etc.)
 * - Capped at 10% of the overdue installment amount.
 *
 * @param installmentAmount the overdue installment's amount
 * @param daysLate total calendar days past the due date (0 = due today, 1 = one day late, etc.)
 */
export function computeLateFee(installmentAmount: number, daysLate: number): number {
  if (daysLate <= GRACE_DAYS) return 0;

  const chargeableDays = daysLate - GRACE_DAYS;
  const rawFee = installmentAmount * DAILY_LATE_RATE * chargeableDays;
  const cap = installmentAmount * LATE_FEE_CAP_RATE;

  return Math.round(Math.min(rawFee, cap) * 100) / 100;
}

/**
 * Should this installment be flagged for repossession?
 * True once an installment is more than 30 consecutive days overdue.
 */
export function isRepossessionDue(daysLate: number): boolean {
  return daysLate > REPOSSESSION_DAYS;
}

/**
 * Helper: calculate calendar days between a due date and "today" (or a given reference date).
 */
export function daysPastDue(dueDate: Date, referenceDate: Date = new Date()): number {
  const due = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
  const ref = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const diffMs = ref.getTime() - due.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}