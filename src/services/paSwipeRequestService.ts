import { collection, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { calcPaSwipePricing } from "../utils/paSwipeCalc";
import { resolveAffiliateCode } from "./affiliateService";
import type { AgreementAcceptance } from "../type";
import {
  createGuarantorInvite,
  requiresSecurityGuarantor,
  SECURITY_GUARANTOR_THRESHOLD,
  type GuarantorInfoInput,
} from "./securityGuarantorService";

type CreateRequestInput = {
  userId: string;
  userRole: "member" | "borrower";
  product: {
    id: string;
    title: string;
    category: string;
    imageUrl: string;
    srp: number;
    downpaymentRate?: number;
  };
  termMonths: 3 | 6 | 9 | 12;
  affiliateCode?: string; // optional referral code entered by the buyer
  // 🛡️ Required whenever product.srp exceeds SECURITY_GUARANTOR_THRESHOLD
  // (₱10,000) — same rule as coop loans, separate mechanism.
  securityGuarantorInfo?: GuarantorInfoInput;
  // 📄 Persisted proof the buyer read and agreed to the terms — required.
  agreementAcceptance: AgreementAcceptance;
};

export async function createPaSwipeRequest(input: CreateRequestInput) {
  const { userId, userRole, product, termMonths, affiliateCode, securityGuarantorInfo, agreementAcceptance } = input;

  if (!agreementAcceptance) {
    throw new Error("Agreement acceptance is required to submit this request.");
  }

  // 🛡️ Security guarantor required over ₱10,000
  if (requiresSecurityGuarantor(product.srp) && !securityGuarantorInfo) {
    throw new Error(
      `A security guarantor is required for purchases over ₱${SECURITY_GUARANTOR_THRESHOLD.toLocaleString()}.`
    );
  }

  const pricing = calcPaSwipePricing({
    srp: product.srp,
    termMonths,
    downpaymentRate: product.downpaymentRate,
  });

  // ✅ Resolve referral code (MLF Easy Installment affiliate program only).
  // Self-referral is blocked here — a buyer can't use their own code.
  let affiliateId: string | null = null;
  let affiliateName: string | null = null;

  if (affiliateCode && affiliateCode.trim()) {
    const affiliate = await resolveAffiliateCode(affiliateCode);
    if (affiliate && affiliate.affiliateId !== userId) {
      affiliateId = affiliate.affiliateId;
      affiliateName = affiliate.affiliateName;
    }
    // Invalid/unapproved code or self-referral: silently ignored,
    // request still proceeds without a referral attached.
  }

  // 🛡️ paSwipeRequests can only be updated by admin after creation
  // (anti-tampering, intentional Firestore rule). So when a security
  // guarantor invite is needed, pre-generate the request's doc ID, create
  // the invite first (it only stores requestId as a plain string — doesn't
  // require the request doc to exist yet), then write the request ONCE
  // with securityGuarantorInviteId already included, instead of
  // create-then-update.
  const requestRef = doc(collection(db, "paSwipeRequests"));

  let securityGuarantorInviteId: string | null = null;

  if (securityGuarantorInfo) {
    securityGuarantorInviteId = await createGuarantorInvite(
      userId,
      "easyInstallment",
      requestRef.id,
      securityGuarantorInfo
    );
  }

  const payload = {
    userId,
    userRole,
    productId: product.id,

    productSnapshot: {
      title: product.title,
      category: product.category,
      imageUrl: product.imageUrl,
      srp: product.srp,
    },

    termMonths: pricing.termMonths,
    installmentCount: pricing.installmentCount,
    interestRate: pricing.interestRate,
    downpaymentRate: pricing.downpaymentRate,
    downpayment: pricing.downpayment,
    interestAmount: pricing.interest,
    remainingBalance: pricing.remainingBalance,
    installmentAmount: pricing.installmentAmount,

    affiliateId,
    affiliateName,

    downpaymentConfirmed: false, // ✅ set true by admin upon approval, once cash is actually received

    status: "pending" as const,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    securityGuarantorInviteId,
    agreementAcceptance,
  };

  await setDoc(requestRef, payload);

  return { ref: requestRef, securityGuarantorInviteId };
}