// src/services/creditEngine.ts
//
// Pure calculation helpers for the credit score + credit limit engine.
// No Firestore reads/writes here — every caller is already inside its
// own Firestore transaction (loan repayment collection), which must do
// all reads before any writes, so these stay pure functions the caller
// wires into its own tx.get()/tx.update() calls.
//
// Two separate mechanisms, both driven by the same late/on-time signal
// from a coop loan installment payment:
//   - Credit SCORE: adjusts per installment, immediately — used to
//     rank/prioritize loan requests and the funds-waiting list.
//   - Credit LIMIT: adjusts only when a loan is fully paid off — a
//     clean payoff (no late installments) raises borrowing power, any
//     lateness lowers it back down toward (never below) the base.
//     Admin can still override the limit manually at any time via the
//     existing Credit Limits admin page — this engine only sets the
//     "default" trajectory.

export const DEFAULT_CREDIT_SCORE = 100;
export const MAX_CREDIT_SCORE = 100;
export const MIN_CREDIT_SCORE = 0;

// Below this, the member/borrower dashboards show a reminder nudging
// them to pay on time so their score (and their place in the loan
// request queue — see computeEffectivePriority) recovers.
export const CREDIT_SCORE_WARNING_THRESHOLD = 90;

const LATE_PENALTY_TIER1 = 5; // 3% late-fee tier (<15 days overdue)
const LATE_PENALTY_TIER2 = 10; // 5% late-fee tier (15+ days overdue)
const ON_TIME_RECOVERY = 2;

/** Per-installment score delta, based on the late-fee tier applied (0 = on-time). */
export function computeCreditScoreDelta(lateRate: number): number {
  if (lateRate >= 0.05) return -LATE_PENALTY_TIER2;
  if (lateRate > 0) return -LATE_PENALTY_TIER1;
  return ON_TIME_RECOVERY;
}

export function clampCreditScore(score: number): number {
  return Math.min(MAX_CREDIT_SCORE, Math.max(MIN_CREDIT_SCORE, score));
}

// ---- Credit limit (adjusts only at full loan payoff) ----

export const BASE_CREDIT_LIMIT: Record<"member" | "borrower", number> = {
  member: 20000,
  borrower: 5000,
};

const COMPLETION_BONUS = 5000;
const COMPLETION_PENALTY = 5000;

/**
 * currentLimit: the user's loanLimit right now.
 * role: "member" | "borrower" — determines the floor.
 * hadAnyLatePayment: whether ANY installment across the whole loan was late.
 */
export function computeCreditLimitAfterPayoff(
  currentLimit: number,
  role: "member" | "borrower",
  hadAnyLatePayment: boolean
): number {
  const base = BASE_CREDIT_LIMIT[role] ?? BASE_CREDIT_LIMIT.member;
  if (hadAnyLatePayment) {
    return Math.max(base, currentLimit - COMPLETION_PENALTY);
  }
  return currentLimit + COMPLETION_BONUS;
}

// ---- Effective priority (credit score + fiscal-year share schedule) ----
// Used to rank/flag new loan requests and the funds-waiting list. Being
// behind on the share prepayment schedule counts against a request the
// same way a low credit score does — both feed into one ranking number.

const SHARE_BEHIND_PENALTY_PER_SHARE = 5;

export function computeEffectivePriority(creditScore: number, sharesBehindBy: number): number {
  return creditScore - sharesBehindBy * SHARE_BEHIND_PENALTY_PER_SHARE;
}
