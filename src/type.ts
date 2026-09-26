export interface AddressInfo {
  street: string;   // House/Unit No., Street, Purok/Sitio
  barangay: string;
  city: string;
  province: string;
  zip: string;
}

export interface EmergencyContactInfo {
  name: string;
  relationship: string;
  phone: string;
}

// ✅ ID VERIFICATION (KYC) — shared shape used by both a member's own
// one-time profile verification and a security guarantor's verification.
export type VerificationStatus =
  | "not_started"
  | "pending_review"
  | "approved"
  | "rejected";

export interface IdentityVerification {
  status: VerificationStatus;
  selfieUrl?: string;          // live camera capture only
  selfieWithIdUrl?: string;    // live camera capture only
  govIdFrontUrl?: string;      // gallery/file upload
  govIdBackUrl?: string;       // gallery/file upload (optional)
  submittedAt?: any;
  reviewedAt?: any;
  reviewedBy?: string;         // admin uid
  rejectionReason?: string;
}

// ✅ SECURITY GUARANTOR (backup/emergency contact for loans & Easy
// Installment purchases over ₱10,000). Separate from the existing
// "effort pool" guarantorId mechanism — this is about having a verified,
// reachable family member on record in case the borrower defaults or is
// unreachable, not about splitting savings effort.
export type SecurityGuarantorInviteStatus =
  | "invited"            // borrower submitted guarantor info; invite pending
  | "account_created"    // guarantor activated the invite and created an account
  | "verification_pending" // guarantor account exists, verification not yet approved
  | "verified"            // guarantor identity verification approved
  | "rejected";

export type SecurityGuarantorRequestType = "loan" | "easyInstallment" | "creditCart";

export interface SecurityGuarantorInvite {
  id: string;
  borrowerUid: string;
  requestType: SecurityGuarantorRequestType;
  requestId: string;           // id of the loanRequest / paSwipeRequest / creditCartRequest this invite is for

  // Info entered by the borrower at request time
  guarantorName: string;
  guarantorRelationship: string;
  guarantorPhone: string;
  guarantorEmail: string;
  guarantorHomeAddress: AddressInfo;

  inviteCode: string;          // opaque token used in the activation link
  status: SecurityGuarantorInviteStatus;

  linkedUid?: string;          // set once the guarantor activates their account
  identityVerification?: IdentityVerification;

  createdAt: any;
  updatedAt: any;
}

// ✅ LOAN/PURCHASE AGREEMENT — persisted proof that the requester actively
// read and accepted the terms (checkbox-gated) at the moment they submitted
// a Coop Loan, MLF Easy Installment, or Marimar's Credit Cart request. This
// is the evidentiary record referenced if a user later fails to comply with
// their repayment obligations — it is written once, at request time, and
// never edited afterward.
export type AgreementProductType = "coopLoan" | "easyInstallment" | "creditCart";

export interface AgreementAcceptance {
  agreementVersion: string;          // e.g. "2026-09-23-v1" — bump when the agreement wording changes
  productType: AgreementProductType;
  termsSnapshot: Record<string, any>; // the exact computed terms shown to the user (amount, interest, schedule, etc.)
  agreementText?: string;             // the exact liability/responsibility wording shown at acceptance, verbatim
  acceptedAt: any;                    // Firestore server timestamp, set at acceptance

  // ⚠️ Set ONLY on records stamped by the one-time admin "Backfill Legacy
  // Agreements" tool, for requests that predate the in-app checkbox flow.
  // These are NOT a live user confirmation — isLegacyBackfill: true is the
  // honest flag that distinguishes them from a real checkbox acceptance.
  isLegacyBackfill?: boolean;
  backfilledBy?: string; // admin uid who ran the backfill
}

export interface UserProfile {
  id: string;
  uid: string;
  email: string;

  firstName: string;
  lastName: string;
  fullName: string;

  role: string;
  status: string;

  createdAt: any;
  updatedAt: any;

  shareBalance?: number;
  loanBalance?: number;
  loanLimit?: number;
  approvedAt?: any;
  monthlyShareCommitment?: number;
  creditScore?: number; // 0-100, defaults to DEFAULT_CREDIT_SCORE (100) when unset — see services/creditEngine.ts

  // ✅ OFFBOARDING — member/borrower marked as having left the coop.
  // Absent or "active" = normal. "inactive" = departed; their loan (if
  // any) may carry isUncollected/excludeFromDividends flags — see
  // markUserInactive() in loanService.ts.
  membershipStatus?: "active" | "inactive";
  inactiveAt?: any;
  inactivatedBy?: string;
  inactiveReason?: string | null;

  // ✅ NEW PROFILE FIELDS
  phoneNumber?: string;
  address?: string;       // legacy freeform address (Edit Profile textarea)
  photoURL?: string;
  theme?: string;

  // ✅ SIGNUP FORM ADDITIONS (kept separate from the legacy fields above
  // so Edit Profile's freeform "address" string can never clobber this
  // structured shape, or vice versa)
  middleName?: string;
  homeAddress?: AddressInfo;
  emergencyContact?: EmergencyContactInfo;

  // ✅ ONE-TIME PROFILE-LEVEL ID VERIFICATION (KYC)
  // Completed once by the member; reused across coop loans, Easy
  // Installment purchases, and Pa-benta seller applications.
  identityVerification?: IdentityVerification;
}