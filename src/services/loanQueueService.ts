// src/services/loanQueueService.ts
//
// Two different ways of getting at "the loan-request queue":
//
//  - getLoanRequestQueue() lists EVERY pending request and ranks them —
//    only admin can call this, because Firestore's security rules only
//    let admin `list` across other people's loanRequests docs. It's kept
//    here for any admin-side reuse, but adminDashboard.ts currently has
//    its own inline copy of this same ranking (loadLoanRequestsUI).
//
//  - getQueuePositionForBorrower()/getQueuePositionsForGuarantor() are
//    for ORDINARY members — they can only read loanRequests docs where
//    they're the userId or guarantorId (security rules), so they can
//    never list the whole collection to compute their own rank. Instead
//    they read a `queuePosition`/`queueSize` field that admin's page
//    already wrote onto the document the last time it loaded the Loan
//    Requests tab (see writeQueuePositionsToRequests, called from
//    adminDashboard.ts loadLoanRequestsUI). That keeps these two
//    functions scoped queries the security rules actually allow.

import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { getTotalFunds } from "./adminService";
import { DEFAULT_CREDIT_SCORE, computeEffectivePriority } from "./creditEngine";
import { getSharePrepaymentStatus } from "./fiscalShareSchedule";
import type { LoanRequest } from "./loanService";

export interface QueuedLoanRequest {
  id: string;
  request: LoanRequest;
  effectivePriority: number;
  requestedAtMs: number;
  isFundable: boolean;
  position: number; // 1-indexed rank in the full pending queue
}

/**
 * Admin-only: returns every pending loan request, ranked the same way
 * the admin dashboard ranks them (highest effectivePriority first, FIFO
 * tiebreak). Throws "permission-denied" if called as a non-admin.
 */
export async function getLoanRequestQueue(): Promise<QueuedLoanRequest[]> {
  const q = query(collection(db, "loanRequests"), where("status", "==", "pending"));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return [];

  const availableFunds = await getTotalFunds();

  const withPriority = await Promise.all(
    snapshot.docs.map(async (loanDoc) => {
      const loan = loanDoc.data() as LoanRequest;

      const hasAccount = loan.hasAccount !== false && !!loan.userId;

      // ⚡ Fetch the profile once, hand it to getSharePrepaymentStatus() so
      // a cache hit (see fiscalShareSchedule.ts) skips a second read of
      // the same doc plus the memberShareReceipts query entirely.
      const borrowerSnap = hasAccount ? await getDoc(doc(db, "users", loan.userId)) : null;
      const borrowerProfile = borrowerSnap && borrowerSnap.exists() ? (borrowerSnap.data() as any) : null;
      const shareStatus = hasAccount
        ? await getSharePrepaymentStatus(loan.userId, new Date(), borrowerProfile)
        : ({ behindBy: 0 } as any);
      const creditScore = Number(borrowerProfile?.creditScore ?? DEFAULT_CREDIT_SCORE);
      const effectivePriority = computeEffectivePriority(creditScore, shareStatus.behindBy);
      const requestedAtMs = (loan.requestedAt as any)?.toMillis ? (loan.requestedAt as any).toMillis() : 0;
      const isFundable = Number(loan.amount ?? 0) <= availableFunds;

      return { id: loanDoc.id, request: loan, effectivePriority, requestedAtMs, isFundable };
    })
  );

  withPriority.sort((a, b) => {
    if (b.effectivePriority !== a.effectivePriority) return b.effectivePriority - a.effectivePriority;
    return a.requestedAtMs - b.requestedAtMs;
  });

  return withPriority.map((item, idx) => ({ ...item, position: idx + 1 }));
}

function toQueuedLoanRequest(id: string, request: LoanRequest): QueuedLoanRequest {
  return {
    id,
    request,
    effectivePriority: 0, // not recomputed client-side for a member — position/queueSize below are what's shown
    requestedAtMs: (request.requestedAt as any)?.toMillis ? (request.requestedAt as any).toMillis() : 0,
    isFundable: false,
    position: request.queuePosition ?? 0,
  };
}

/**
 * This borrower's own pending request + its queue position, or null if
 * they have none pending. Scoped to `userId == this user`, which the
 * security rules allow anyone signed in to read. `position` reflects
 * whatever admin's page last computed and saved — it can lag slightly
 * behind the true live ranking until admin next opens Loan Requests.
 */
export async function getQueuePositionForBorrower(userId: string): Promise<QueuedLoanRequest | null> {
  const q = query(
    collection(db, "loanRequests"),
    where("status", "==", "pending"),
    where("userId", "==", userId)
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  const docSnap = snapshot.docs[0];
  return toQueuedLoanRequest(docSnap.id, docSnap.data() as LoanRequest);
}

/**
 * Every pending request this user is the (effort-pool) guarantor for,
 * with its saved queue position. Scoped to `guarantorId == this user`,
 * same reasoning as above.
 */
export async function getQueuePositionsForGuarantor(guarantorUserId: string): Promise<QueuedLoanRequest[]> {
  const q = query(
    collection(db, "loanRequests"),
    where("status", "==", "pending"),
    where("guarantorId", "==", guarantorUserId)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => toQueuedLoanRequest(d.id, d.data() as LoanRequest));
}
