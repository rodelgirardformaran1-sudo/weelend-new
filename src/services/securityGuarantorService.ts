// src/services/securityGuarantorService.ts
//
// "Security guarantor" — a verified backup/emergency contact required on
// coop loans AND MLF Easy Installment purchases over ₱10,000. Separate
// from the existing "effort pool" guarantorId dropdown mechanism
// (loanRequests/activeLoans.guarantorId) — that one is unrelated and
// untouched by this file.
//
// Flow: borrower enters the guarantor's info at request time ->
// createGuarantorInvite() writes a pending invite whose *document ID*
// doubles as its activation code -> the guarantor opens the activation
// link, creates their own account, and completes selfie + selfie-with-ID
// + gov ID verification -> admin approves -> the request may be approved.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  updateDoc,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import type {
  AddressInfo,
  IdentityVerification,
  SecurityGuarantorInvite,
  SecurityGuarantorInviteStatus,
  SecurityGuarantorRequestType,
} from "../type";

const COLLECTION = "securityGuarantorInvites";

/** Coop loans AND Easy Installment purchases above this amount require a security guarantor. */
export const SECURITY_GUARANTOR_THRESHOLD = 10000;

export interface GuarantorInfoInput {
  name: string;
  relationship: string;
  phone: string;
  email: string;
  homeAddress: AddressInfo;
}

// =======================================================
// 🟣 BORROWER: create the invite at request time
// =======================================================
export async function createGuarantorInvite(
  borrowerUid: string,
  requestType: SecurityGuarantorRequestType,
  requestId: string,
  info: GuarantorInfoInput
): Promise<string> {
  const inviteRef = doc(collection(db, COLLECTION));

  await setDoc(inviteRef, {
    borrowerUid,
    requestType,
    requestId,
    guarantorName: info.name,
    guarantorRelationship: info.relationship,
    guarantorPhone: info.phone,
    guarantorEmail: info.email,
    guarantorHomeAddress: info.homeAddress,
    inviteCode: inviteRef.id,
    status: "invited" as SecurityGuarantorInviteStatus,
    linkedUid: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return inviteRef.id;
}

/** Builds the shareable activation link the borrower sends their guarantor. */
export function buildGuarantorActivationLink(inviteId: string): string {
  return `${window.location.origin}${window.location.pathname}?guarantorInvite=${inviteId}`;
}

// =======================================================
// 🔎 LOOKUPS
// =======================================================
export async function getGuarantorInvite(
  inviteId: string
): Promise<SecurityGuarantorInvite | null> {
  const snap = await getDoc(doc(db, COLLECTION, inviteId));
  return snap.exists()
    ? ({ id: snap.id, ...snap.data() } as SecurityGuarantorInvite)
    : null;
}

/** One request (loan or Easy Installment) has at most one invite. */
export async function getInviteForRequest(
  requestId: string
): Promise<SecurityGuarantorInvite | null> {
  const q = query(collection(db, COLLECTION), where("requestId", "==", requestId));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as SecurityGuarantorInvite;
}

export async function getInvitesLinkedToGuarantor(
  guarantorUid: string
): Promise<SecurityGuarantorInvite[]> {
  const q = query(collection(db, COLLECTION), where("linkedUid", "==", guarantorUid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as SecurityGuarantorInvite));
}

// =======================================================
// 🟢 GUARANTOR: claim invite + submit verification
// =======================================================

/** Called right after the guarantor's Firebase Auth account is created. */
export async function claimGuarantorInvite(
  inviteId: string,
  guarantorUid: string
): Promise<void> {
  await updateDoc(doc(db, COLLECTION, inviteId), {
    linkedUid: guarantorUid,
    status: "account_created" as SecurityGuarantorInviteStatus,
    updatedAt: serverTimestamp(),
  });
}

export async function submitGuarantorVerification(
  inviteId: string,
  photos: { selfieUrl: string; selfieWithIdUrl: string; govIdFrontUrl: string }
): Promise<void> {
  const verification: IdentityVerification = {
    status: "pending_review",
    ...photos,
    submittedAt: serverTimestamp(),
  };

  await updateDoc(doc(db, COLLECTION, inviteId), {
    identityVerification: verification,
    status: "verification_pending" as SecurityGuarantorInviteStatus,
    updatedAt: serverTimestamp(),
  });
}

// =======================================================
// 🔐 ADMIN: approve / reject guarantor verification
// =======================================================
export async function approveGuarantorVerification(
  inviteId: string,
  adminUid: string
): Promise<void> {
  const invite = await getGuarantorInvite(inviteId);
  if (!invite) throw new Error("Guarantor invite not found.");

  await updateDoc(doc(db, COLLECTION, inviteId), {
    status: "verified" as SecurityGuarantorInviteStatus,
    identityVerification: {
      ...(invite.identityVerification ?? {}),
      status: "approved",
      reviewedAt: serverTimestamp(),
      reviewedBy: adminUid,
      rejectionReason: null,
    },
    updatedAt: serverTimestamp(),
  });
}

export async function rejectGuarantorVerification(
  inviteId: string,
  adminUid: string,
  reason: string
): Promise<void> {
  const invite = await getGuarantorInvite(inviteId);
  if (!invite) throw new Error("Guarantor invite not found.");

  await updateDoc(doc(db, COLLECTION, inviteId), {
    // Stays on verification_pending so it keeps showing in admin review
    // once the guarantor resubmits.
    status: "verification_pending" as SecurityGuarantorInviteStatus,
    identityVerification: {
      ...(invite.identityVerification ?? {}),
      status: "rejected",
      rejectionReason: reason,
      reviewedAt: serverTimestamp(),
      reviewedBy: adminUid,
    },
    updatedAt: serverTimestamp(),
  });
}

// =======================================================
// 🧮 GATING HELPERS
// =======================================================

/** Does this request amount require a security guarantor at all? */
export function requiresSecurityGuarantor(amount: number): boolean {
  return amount > SECURITY_GUARANTOR_THRESHOLD;
}

/** A request can only be admin-approved once its guarantor is fully verified. */
export function isGuarantorFullyVerified(
  invite: SecurityGuarantorInvite | null
): boolean {
  return (
    !!invite &&
    invite.status === "verified" &&
    invite.identityVerification?.status === "approved"
  );
}

/** Short, human-readable status for admin screens. */
export function describeGuarantorStatus(invite: SecurityGuarantorInvite | null): string {
  if (!invite) return "⬜ No security guarantor on file";
  switch (invite.status) {
    case "invited":
      return "📨 Invite sent — guarantor hasn't created an account yet";
    case "account_created":
      return "🟡 Guarantor account created — verification not started";
    case "verification_pending":
      return invite.identityVerification?.status === "rejected"
        ? "❌ Guarantor verification rejected — waiting on resubmission"
        : "⏳ Guarantor verification pending admin review";
    case "verified":
      return "✅ Guarantor verified";
    case "rejected":
      return "❌ Guarantor rejected";
    default:
      return invite.status;
  }
}
