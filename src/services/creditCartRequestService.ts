import { collection, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { calcCreditCartPricing, type CreditCartCategory } from "../utils/creditCartCalc";
import type { AgreementAcceptance } from "../type";
import {
  createGuarantorInvite,
  requiresSecurityGuarantor,
  SECURITY_GUARANTOR_THRESHOLD,
  type GuarantorInfoInput,
} from "./securityGuarantorService";

type CreateCreditCartRequestInput = {
  userId: string;
  userRole: "member" | "borrower";
  category: CreditCartCategory;
  amount: number;
  // 🛡️ Required whenever amount exceeds SECURITY_GUARANTOR_THRESHOLD
  // (₱10,000) — same rule as coop loans and MLF Easy Installment.
  securityGuarantorInfo?: GuarantorInfoInput;
  // 📄 Persisted proof the buyer read and agreed to the terms — required.
  agreementAcceptance: AgreementAcceptance;
};

export async function createCreditCartRequest(input: CreateCreditCartRequestInput) {
  const { userId, userRole, category, amount, securityGuarantorInfo, agreementAcceptance } = input;

  if (!agreementAcceptance) {
    throw new Error("Agreement acceptance is required to submit this request.");
  }

  // 🛡️ Security guarantor required over ₱10,000
  if (requiresSecurityGuarantor(amount) && !securityGuarantorInfo) {
    throw new Error(
      `A security guarantor is required for purchases over ₱${SECURITY_GUARANTOR_THRESHOLD.toLocaleString()}.`
    );
  }

  const pricing = calcCreditCartPricing({ amount, category });

  // 🛡️ creditCartRequests can only be updated by admin after creation
  // (same anti-tampering rule as loanRequests/paSwipeRequests). Pre-generate
  // the request's doc ID, create the invite first, then write the request
  // ONCE with securityGuarantorInviteId already included.
  const requestRef = doc(collection(db, "creditCartRequests"));

  let securityGuarantorInviteId: string | null = null;

  if (securityGuarantorInfo) {
    securityGuarantorInviteId = await createGuarantorInvite(
      userId,
      "creditCart",
      requestRef.id,
      securityGuarantorInfo
    );
  }

  await setDoc(requestRef, {
    userId,
    userRole,
    category,
    amount,
    termMonths: pricing.termMonths,
    installmentCount: pricing.installmentCount,
    interestRate: pricing.interestRate,
    interestAmount: pricing.interestAmount,
    totalPayable: pricing.totalPayable,
    installmentAmount: pricing.installmentAmount,
    status: "pending" as const,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    securityGuarantorInviteId,
    agreementAcceptance,
  });

  return { ref: requestRef, securityGuarantorInviteId };
}
