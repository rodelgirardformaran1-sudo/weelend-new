export type CreditCartCategory = "grocery" | "shopping";

export const CREDIT_CART_TERMS: Record<CreditCartCategory, { termMonths: number; installmentCount: number }> = {
  grocery: { termMonths: 1, installmentCount: 2 },
  shopping: { termMonths: 3, installmentCount: 6 },
};

export const CREDIT_CART_INTEREST_RATE = 0.10; // flat, same for both categories
export const GRACE_DAYS = 3;
export const FLAT_LATE_FEE = 100; // ₱100 per missed cycle, not per day

export type CreditCartCalcInput = {
  amount: number;
  category: CreditCartCategory;
};

export type CreditCartPricingResult = {
  amount: number;
  category: CreditCartCategory;
  termMonths: number;
  installmentCount: number;
  interestRate: number;
  interestAmount: number;
  totalPayable: number;
  installmentAmount: number;
};

export function calcCreditCartPricing(input: CreditCartCalcInput): CreditCartPricingResult {
  const amount = Number(input.amount || 0);
  const { termMonths, installmentCount } = CREDIT_CART_TERMS[input.category];

  const interestAmount = Math.round(amount * CREDIT_CART_INTEREST_RATE * 100) / 100;
  const totalPayable = Math.round((amount + interestAmount) * 100) / 100;
  const installmentAmount =
    installmentCount > 0 ? Math.round((totalPayable / installmentCount) * 100) / 100 : 0;

  return {
    amount,
    category: input.category,
    termMonths,
    installmentCount,
    interestRate: CREDIT_CART_INTEREST_RATE,
    interestAmount,
    totalPayable,
    installmentAmount,
  };
}

export function daysPastDue(dueDate: Date, referenceDate: Date = new Date()): number {
  const due = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
  const ref = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  return Math.floor((ref.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
}

// Flat penalty — unlike MLF, doesn't escalate per day, just triggers once past grace period
export function computeCreditCartLateFee(daysLate: number): number {
  if (daysLate <= GRACE_DAYS) return 0;
  return FLAT_LATE_FEE;
}