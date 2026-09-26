// =======================================================
// LOAN / PURCHASE AGREEMENT ACCEPTANCE MODAL
// =======================================================
// Shared, reusable "proof of agreement" step for any WeeLend lending
// product (Coop Loan, MLF Easy Installment, Marimar's Credit Cart).
// Pa-benta is excluded — it's a plain marketplace with no interest/lending
// mechanics.
//
// This module owns:
//   1. The canonical, versioned agreement/liability text (mirrors the
//      "⚖️ Membership & Responsibility" / "⚖️ Your Responsibility" wording
//      already shown in the Information tabs, so the two stay consistent).
//   2. A promise-based, dynamically-built modal (same pattern as
//      guarantorInfoModal.ts's promptForSecurityGuarantorInfo) for flows
//      that don't already have their own static agreement modal in the
//      DOM — currently MLF Easy Installment (shop.ts) and Marimar's
//      Credit Cart (creditCart.ts).
//   3. buildAgreementAcceptance() — the single place that stamps out the
//      persisted AgreementAcceptance record, so every flow (including the
//      Coop Loan flows, which use their own existing static modal in
//      index.html) produces the exact same shape.
//
// IMPORTANT: This module never writes to Firestore itself. It only builds
// the AgreementAcceptance object; the calling request-service function
// (requestLoan / createPaSwipeRequest / createCreditCartRequest) persists
// it onto the request document at creation time, as the immutable proof.

import type { AgreementAcceptance, AgreementProductType } from "../type";
import { serverTimestamp } from "firebase/firestore";

// Bump this string whenever the agreement wording below changes materially
// — old acceptances keep whatever version was in effect when they were
// signed, so a wording change never silently rewrites history.
// No longer used by any live flow as of the per-product expansion below
// (Coop Loan, MLF Easy Installment, and Marimar's Credit Cart each now
// have their own dedicated agreement + version) — kept only so
// getAgreementLiabilityHtml/PlainText below still compile and remain
// available if ever needed again.
export const AGREEMENT_VERSION = "2026-09-23-v1";

// Each product now has its own full, structured, promissory-note-style
// agreement (see the getXAgreementHtml/PlainText functions below) and its
// own version string, so a wording change to one product's agreement
// never silently reinterprets another product's already-signed records.
export const COOP_LOAN_AGREEMENT_VERSION = "2026-09-23-v2-coop-loan";
export const EASY_INSTALLMENT_AGREEMENT_VERSION = "2026-09-23-v2-easy-installment";
export const CREDIT_CART_AGREEMENT_VERSION = "2026-09-23-v2-credit-cart";

/**
 * Shared liability/responsibility clause, shown inside every agreement
 * modal. Kept in sync with the "⚖️ Membership & Responsibility" /
 * "⚖️ Your Responsibility" sections of the Information tabs.
 */
export function getAgreementLiabilityHtml(): string {
  return `
    <div class="agreement-liability-box" style="margin-top:12px; padding:12px; border-radius:10px; background:#fff7f0; border:1px solid #f0c7a0;">
      <h4 style="margin:0 0 8px 0;">⚖️ Your Responsibility</h4>
      <p style="margin:0 0 8px 0;">
        By submitting this request, you agree to repay it in full, on schedule.
      </p>
      <p style="margin:0 0 8px 0;">
        Philippine law does not imprison anyone for failing to pay a debt
        (1987 Constitution, Art. III, Sec. 20) — this is a civil, not a
        criminal, matter. Still, this agreement means accepting real
        consequences for not honoring it:
      </p>
      <ul style="margin:0 0 8px 0; padding-left:20px;">
        <li>Your balance remains a debt owed to the cooperative and its members — it does not disappear.</li>
        <li>Missed or incomplete payments directly reduce your future credit limit and loan eligibility.</li>
        <li>If applicable, your share contributions may be applied against any unpaid balance.</li>
        <li>The cooperative may pursue any lawful civil remedy available to recover what's owed.</li>
      </ul>
      <p style="margin:0; opacity:.7; font-size:12px;">
        This is a plain-language summary, not a substitute for a formal
        agreement reviewed by legal counsel.
      </p>
    </div>
  `;
}

/**
 * Plain-text twin of getAgreementLiabilityHtml() — same wording, no
 * markup. This is the exact text that gets stamped into every persisted
 * AgreementAcceptance record (see buildAgreementAcceptance below), so
 * admin can later see precisely what the person was shown, verbatim —
 * not just a reference to "whatever the current version says." If this
 * wording is ever edited, bump AGREEMENT_VERSION above so old records
 * stay tied to the text that was actually in effect when they were
 * signed, rather than silently inheriting the new wording.
 */
export function getAgreementLiabilityPlainText(): string {
  return [
    "⚖️ Your Responsibility",
    "",
    "By submitting this request, you agree to repay it in full, on schedule.",
    "",
    "Philippine law does not imprison anyone for failing to pay a debt (1987 Constitution, Art. III, Sec. 20) — this is a civil, not a criminal, matter. Still, this agreement means accepting real consequences for not honoring it:",
    "",
    "- Your balance remains a debt owed to the cooperative and its members — it does not disappear.",
    "- Missed or incomplete payments directly reduce your future credit limit and loan eligibility.",
    "- If applicable, your share contributions may be applied against any unpaid balance.",
    "- The cooperative may pursue any lawful civil remedy available to recover what's owed.",
    "",
    "This is a plain-language summary, not a substitute for a formal agreement reviewed by legal counsel.",
  ].join("\n");
}

/**
 * COOP LOAN — full, structured, promissory-note-style agreement. This is
 * what a member/borrower actually reads and agrees to when requesting a
 * Coop Loan (shown in the static #loan-agreement-modal liability box in
 * index.html — keep that HTML in sync with this function's wording by
 * hand, since the Coop Loan modal is static markup rather than built from
 * this module at runtime).
 *
 * This is meant to actually document the loan relationship for legal
 * purposes, not just summarize it — but it is still a plain-language
 * statement drafted for this app, not a substitute for a contract drafted
 * or reviewed by a lawyer admitted to practice in the Philippines. Have
 * counsel review this wording before relying on it in an actual dispute.
 */
export function getCoopLoanAgreementHtml(): string {
  return `
    <div class="agreement-liability-box" style="margin-top:12px; padding:12px; border-radius:10px; background:#fff7f0; border:1px solid #f0c7a0;">
      <h4 style="margin:0 0 8px 0;">📜 Cooperative Loan Agreement — Terms and Conditions</h4>
      <p style="margin:0 0 8px 0;">
        This is a binding agreement between you (<strong>"the Borrower"</strong>) and
        <strong>WEE LENDING COOPERATIVE</strong> (<strong>"the Cooperative"</strong>). By checking
        "I Agree" and submitting this loan request, you are entering into this
        agreement, in accordance with Republic Act No. 9520 (the Philippine
        Cooperative Code of 2008) and the Cooperative's by-laws.
      </p>

      <h5 style="margin:10px 0 4px 0;">1. Loan and Interest</h5>
      <p style="margin:0 0 8px 0;">
        You are requesting the loan amount, term, and payment schedule shown
        above. Interest accrues at 10% per month on the outstanding
        principal, on a simple (non-compounding) basis, for the full agreed
        term.
      </p>

      <h5 style="margin:10px 0 4px 0;">2. Repayment</h5>
      <p style="margin:0 0 8px 0;">
        You agree to repay the loan in full — principal plus interest —
        according to the payment schedule shown above, without need of
        further demand from the Cooperative.
      </p>

      <h5 style="margin:10px 0 4px 0;">3. Late Payment</h5>
      <p style="margin:0 0 8px 0;">
        Any installment not paid on its due date is subject to a late fee of
        3% of the overdue amount. If an installment remains unpaid for more
        than 15 days past its due date, the late fee increases to 5%.
      </p>

      <h5 style="margin:10px 0 4px 0;">4. If You Do Not Pay</h5>
      <p style="margin:0 0 8px 0;">
        Philippine law does not imprison anyone for failing to pay a debt
        (1987 Constitution, Art. III, Sec. 20) — this is a civil, not a
        criminal, matter. Still, non-payment has real, binding consequences:
      </p>
      <ul style="margin:0 0 8px 0; padding-left:20px;">
        <li>Your outstanding balance remains a debt owed to the Cooperative and its members. It does not disappear, is not forgiven, and continues to accrue as described above until paid.</li>
        <li>Your share capital contributions, if any, may be applied against any unpaid balance before any other use.</li>
        <li>Missed or incomplete payments directly and immediately reduce your future credit limit and loan eligibility with the Cooperative.</li>
        <li>If you leave the Cooperative with an unpaid balance, that balance remains collectible and is not extinguished by your departure.</li>
        <li>The Cooperative may pursue any lawful civil remedy available to it to recover what is owed, including but not limited to formal demand, offset against your share capital, referral to a collection process, or civil action.</li>
      </ul>

      <h5 style="margin:10px 0 4px 0;">5. Your Consent and Data</h5>
      <p style="margin:0 0 8px 0;">
        By submitting this request, you consent to the Cooperative's
        collection, verification, and use of the personal and
        identification information you have provided, for purposes of loan
        processing, credit evaluation, and enforcement of this agreement, in
        accordance with the Data Privacy Act of 2012 (Republic Act No.
        10173).
      </p>

      <h5 style="margin:10px 0 4px 0;">6. How You Agree</h5>
      <p style="margin:0 0 8px 0;">
        Your acceptance is given electronically, by checking the box below
        and submitting this request. Under the Electronic Commerce Act of
        2000 (Republic Act No. 8792), this electronic acceptance has the
        same legal effect, validity, and enforceability as a signature on
        paper. The exact terms shown to you at the moment of acceptance are
        recorded and kept on file as proof of this agreement.
      </p>

      <h5 style="margin:10px 0 4px 0;">7. Severability</h5>
      <p style="margin:0 0 8px 0;">
        If any provision of this agreement is found invalid or
        unenforceable, the rest of the agreement remains in full force and
        effect.
      </p>

      <h5 style="margin:10px 0 4px 0;">8. Governing Law</h5>
      <p style="margin:0 0 8px 0;">
        This agreement is governed by the laws of the Republic of the
        Philippines, including the Philippine Cooperative Code of 2008 (RA
        9520) and the Civil Code of the Philippines, and by the
        Cooperative's by-laws and duly approved policies.
      </p>

      <p style="margin:0; opacity:.7; font-size:12px;">
        This is a plain-language statement of your rights and obligations,
        not a substitute for a formal contract reviewed by legal counsel. A
        separate, fully detailed contract document is generated and made
        available to you once your loan is approved.
      </p>
    </div>
  `;
}

/**
 * Plain-text twin of getCoopLoanAgreementHtml() — same wording, no markup.
 * This is what gets stamped verbatim into every Coop Loan
 * AgreementAcceptance record. If this wording is ever edited, bump
 * COOP_LOAN_AGREEMENT_VERSION above (and keep the HTML box in
 * index.html's #loan-agreement-modal in sync by hand).
 */
export function getCoopLoanAgreementPlainText(): string {
  return [
    "COOPERATIVE LOAN AGREEMENT — TERMS AND CONDITIONS",
    "",
    'This is a binding agreement between you ("the Borrower") and WEE LENDING COOPERATIVE ("the Cooperative"). By checking "I Agree" and submitting this loan request, you are entering into this agreement, in accordance with Republic Act No. 9520 (the Philippine Cooperative Code of 2008) and the Cooperative\'s by-laws.',
    "",
    "1. LOAN AND INTEREST",
    "You are requesting the loan amount, term, and payment schedule shown above. Interest accrues at 10% per month on the outstanding principal, on a simple (non-compounding) basis, for the full agreed term.",
    "",
    "2. REPAYMENT",
    "You agree to repay the loan in full — principal plus interest — according to the payment schedule shown above, without need of further demand from the Cooperative.",
    "",
    "3. LATE PAYMENT",
    "Any installment not paid on its due date is subject to a late fee of 3% of the overdue amount. If an installment remains unpaid for more than 15 days past its due date, the late fee increases to 5%.",
    "",
    "4. IF YOU DO NOT PAY",
    "Philippine law does not imprison anyone for failing to pay a debt (1987 Constitution, Art. III, Sec. 20) — this is a civil, not a criminal, matter. Still, non-payment has real, binding consequences:",
    "- Your outstanding balance remains a debt owed to the Cooperative and its members. It does not disappear, is not forgiven, and continues to accrue as described above until paid.",
    "- Your share capital contributions, if any, may be applied against any unpaid balance before any other use.",
    "- Missed or incomplete payments directly and immediately reduce your future credit limit and loan eligibility with the Cooperative.",
    "- If you leave the Cooperative with an unpaid balance, that balance remains collectible and is not extinguished by your departure.",
    "- The Cooperative may pursue any lawful civil remedy available to it to recover what is owed, including but not limited to formal demand, offset against your share capital, referral to a collection process, or civil action.",
    "",
    "5. YOUR CONSENT AND DATA",
    "By submitting this request, you consent to the Cooperative's collection, verification, and use of the personal and identification information you have provided, for purposes of loan processing, credit evaluation, and enforcement of this agreement, in accordance with the Data Privacy Act of 2012 (Republic Act No. 10173).",
    "",
    "6. HOW YOU AGREE",
    "Your acceptance is given electronically, by checking the box below and submitting this request. Under the Electronic Commerce Act of 2000 (Republic Act No. 8792), this electronic acceptance has the same legal effect, validity, and enforceability as a signature on paper. The exact terms shown to you at the moment of acceptance are recorded and kept on file as proof of this agreement.",
    "",
    "7. SEVERABILITY",
    "If any provision of this agreement is found invalid or unenforceable, the rest of the agreement remains in full force and effect.",
    "",
    "8. GOVERNING LAW",
    "This agreement is governed by the laws of the Republic of the Philippines, including the Philippine Cooperative Code of 2008 (RA 9520) and the Civil Code of the Philippines, and by the Cooperative's by-laws and duly approved policies.",
    "",
    "This is a plain-language statement of your rights and obligations, not a substitute for a formal contract reviewed by legal counsel. A separate, fully detailed contract document is generated and made available to you once your loan is approved.",
  ].join("\n");
}

/**
 * MLF EASY INSTALLMENT — full, structured, promissory-note-style
 * agreement, shown inside the on-demand modal built by
 * promptForAgreementAcceptance() (shop.ts). Mirrors the actual pricing
 * mechanics used by calcPaSwipePricing() / generatePaSwipeContract():
 * a downpayment, a flat interest amount computed on SRP, the remaining
 * balance financed over semi-monthly installments, a 3-day grace period,
 * then a 0.1%/day late fee (capped at 10% of the overdue installment),
 * and repossession risk after 30 consecutive days unpaid.
 *
 * Not a substitute for a contract reviewed by a lawyer admitted to
 * practice in the Philippines — have counsel review this wording before
 * relying on it in an actual dispute.
 */
export function getEasyInstallmentAgreementHtml(): string {
  return `
    <div class="agreement-liability-box" style="margin-top:12px; padding:12px; border-radius:10px; background:#fff7f0; border:1px solid #f0c7a0; max-height:320px; overflow-y:auto;">
      <h4 style="margin:0 0 8px 0;">📜 MLF Easy Installment Agreement — Terms and Conditions</h4>
      <p style="margin:0 0 8px 0;">
        This is a binding agreement between you (<strong>"the Member"</strong>) and
        <strong>WEE LENDING COOPERATIVE</strong> (<strong>"the Cooperative"</strong>). By checking
        "I agree" and submitting this request, you are entering into this
        agreement, in accordance with Republic Act No. 9520 (the Philippine
        Cooperative Code of 2008) and the Cooperative's by-laws.
      </p>

      <h5 style="margin:10px 0 4px 0;">1. Item, Downpayment, and Interest</h5>
      <p style="margin:0 0 8px 0;">
        You are requesting the item, downpayment, and interest amount shown
        above. The downpayment is due upon approval. Interest is a flat
        amount computed once on the item's suggested retail price (SRP), not
        a recurring monthly charge.
      </p>

      <h5 style="margin:10px 0 4px 0;">2. Repayment</h5>
      <p style="margin:0 0 8px 0;">
        The remaining balance shown above is repaid through semi-monthly
        installments, due on the 15th and 30th of each month, until the
        remaining balance is paid in full.
      </p>

      <h5 style="margin:10px 0 4px 0;">3. Grace Period and Late Payment</h5>
      <p style="margin:0 0 8px 0;">
        Each installment has a 3 calendar-day grace period after its due
        date, with no penalty during that window. Starting on the 4th day
        after the due date, a late fee of 0.1% per day applies to the
        overdue installment amount, capped at a maximum of 10% of that
        overdue installment per billing cycle.
      </p>

      <h5 style="margin:10px 0 4px 0;">4. Default and Repossession</h5>
      <p style="margin:0 0 8px 0;">
        Ownership of the item remains with the Cooperative until the full
        remaining balance is paid. If any installment remains unpaid for
        more than 30 consecutive days past its due date, this account will
        be flagged for repossession of the item.
      </p>

      <h5 style="margin:10px 0 4px 0;">5. If You Do Not Pay</h5>
      <p style="margin:0 0 8px 0;">
        Philippine law does not imprison anyone for failing to pay a debt
        (1987 Constitution, Art. III, Sec. 20) — this is a civil, not a
        criminal, matter. Still, non-payment has real, binding consequences:
      </p>
      <ul style="margin:0 0 8px 0; padding-left:20px;">
        <li>Your outstanding balance remains a debt owed to the Cooperative and its members until paid in full or the item is repossessed.</li>
        <li>Missed or incomplete payments directly and immediately reduce your future credit limit and loan eligibility with the Cooperative.</li>
        <li>Your share capital contributions, if any, may be applied against any unpaid balance before any other use.</li>
        <li>The Cooperative may pursue any lawful civil remedy available to it to recover what is owed, including but not limited to formal demand, repossession, account restriction, or civil action.</li>
      </ul>

      <h5 style="margin:10px 0 4px 0;">6. Your Consent and Data</h5>
      <p style="margin:0 0 8px 0;">
        By submitting this request, you consent to the Cooperative's
        collection, verification, and use of the personal and
        identification information you have provided, for purposes of
        request processing, credit evaluation, and enforcement of this
        agreement, in accordance with the Data Privacy Act of 2012
        (Republic Act No. 10173).
      </p>

      <h5 style="margin:10px 0 4px 0;">7. How You Agree</h5>
      <p style="margin:0 0 8px 0;">
        Your acceptance is given electronically, by checking the box below
        and submitting this request. Under the Electronic Commerce Act of
        2000 (Republic Act No. 8792), this electronic acceptance has the
        same legal effect, validity, and enforceability as a signature on
        paper. The exact terms shown to you at the moment of acceptance are
        recorded and kept on file as proof of this agreement.
      </p>

      <h5 style="margin:10px 0 4px 0;">8. Severability and Governing Law</h5>
      <p style="margin:0 0 8px 0;">
        If any provision of this agreement is found invalid or
        unenforceable, the rest remains in full force and effect. This
        agreement is governed by the laws of the Republic of the
        Philippines, including the Philippine Cooperative Code of 2008 (RA
        9520) and the Civil Code of the Philippines, and by the
        Cooperative's by-laws and duly approved policies.
      </p>

      <p style="margin:0; opacity:.7; font-size:12px;">
        This is a plain-language statement of your rights and obligations,
        not a substitute for a formal contract reviewed by legal counsel. A
        separate, fully detailed contract document is generated and made
        available to you once your request is approved.
      </p>
    </div>
  `;
}

/**
 * Plain-text twin of getEasyInstallmentAgreementHtml() — same wording, no
 * markup. Stamped verbatim into every MLF Easy Installment
 * AgreementAcceptance record. If this wording is ever edited, bump
 * EASY_INSTALLMENT_AGREEMENT_VERSION above.
 */
export function getEasyInstallmentAgreementPlainText(): string {
  return [
    "MLF EASY INSTALLMENT AGREEMENT — TERMS AND CONDITIONS",
    "",
    'This is a binding agreement between you ("the Member") and WEE LENDING COOPERATIVE ("the Cooperative"). By checking "I agree" and submitting this request, you are entering into this agreement, in accordance with Republic Act No. 9520 (the Philippine Cooperative Code of 2008) and the Cooperative\'s by-laws.',
    "",
    "1. ITEM, DOWNPAYMENT, AND INTEREST",
    "You are requesting the item, downpayment, and interest amount shown above. The downpayment is due upon approval. Interest is a flat amount computed once on the item's suggested retail price (SRP), not a recurring monthly charge.",
    "",
    "2. REPAYMENT",
    "The remaining balance shown above is repaid through semi-monthly installments, due on the 15th and 30th of each month, until the remaining balance is paid in full.",
    "",
    "3. GRACE PERIOD AND LATE PAYMENT",
    "Each installment has a 3 calendar-day grace period after its due date, with no penalty during that window. Starting on the 4th day after the due date, a late fee of 0.1% per day applies to the overdue installment amount, capped at a maximum of 10% of that overdue installment per billing cycle.",
    "",
    "4. DEFAULT AND REPOSSESSION",
    "Ownership of the item remains with the Cooperative until the full remaining balance is paid. If any installment remains unpaid for more than 30 consecutive days past its due date, this account will be flagged for repossession of the item.",
    "",
    "5. IF YOU DO NOT PAY",
    "Philippine law does not imprison anyone for failing to pay a debt (1987 Constitution, Art. III, Sec. 20) — this is a civil, not a criminal, matter. Still, non-payment has real, binding consequences:",
    "- Your outstanding balance remains a debt owed to the Cooperative and its members until paid in full or the item is repossessed.",
    "- Missed or incomplete payments directly and immediately reduce your future credit limit and loan eligibility with the Cooperative.",
    "- Your share capital contributions, if any, may be applied against any unpaid balance before any other use.",
    "- The Cooperative may pursue any lawful civil remedy available to it to recover what is owed, including but not limited to formal demand, repossession, account restriction, or civil action.",
    "",
    "6. YOUR CONSENT AND DATA",
    "By submitting this request, you consent to the Cooperative's collection, verification, and use of the personal and identification information you have provided, for purposes of request processing, credit evaluation, and enforcement of this agreement, in accordance with the Data Privacy Act of 2012 (Republic Act No. 10173).",
    "",
    "7. HOW YOU AGREE",
    "Your acceptance is given electronically, by checking the box below and submitting this request. Under the Electronic Commerce Act of 2000 (Republic Act No. 8792), this electronic acceptance has the same legal effect, validity, and enforceability as a signature on paper. The exact terms shown to you at the moment of acceptance are recorded and kept on file as proof of this agreement.",
    "",
    "8. SEVERABILITY AND GOVERNING LAW",
    "If any provision of this agreement is found invalid or unenforceable, the rest remains in full force and effect. This agreement is governed by the laws of the Republic of the Philippines, including the Philippine Cooperative Code of 2008 (RA 9520) and the Civil Code of the Philippines, and by the Cooperative's by-laws and duly approved policies.",
    "",
    "This is a plain-language statement of your rights and obligations, not a substitute for a formal contract reviewed by legal counsel. A separate, fully detailed contract document is generated and made available to you once your request is approved.",
  ].join("\n");
}

/**
 * MARIMAR'S CREDIT CART — full, structured, promissory-note-style
 * agreement, shown inside the on-demand modal built by
 * promptForAgreementAcceptance() (creditCart.ts). Mirrors the actual
 * pricing mechanics used by calcCreditCartPricing() /
 * generateCreditCartContract(): no downpayment, a flat 10% interest
 * charge on the requested amount, semi-monthly installments, a 3-day
 * grace period, then a flat ₱100 penalty per missed installment cycle.
 *
 * Not a substitute for a contract reviewed by a lawyer admitted to
 * practice in the Philippines — have counsel review this wording before
 * relying on it in an actual dispute.
 */
export function getCreditCartAgreementHtml(): string {
  return `
    <div class="agreement-liability-box" style="margin-top:12px; padding:12px; border-radius:10px; background:#fff7f0; border:1px solid #f0c7a0; max-height:320px; overflow-y:auto;">
      <h4 style="margin:0 0 8px 0;">📜 Marimar's Credit Cart Agreement — Terms and Conditions</h4>
      <p style="margin:0 0 8px 0;">
        This is a binding agreement between you (<strong>"the Member"</strong>) and
        <strong>WEE LENDING COOPERATIVE</strong> (<strong>"the Cooperative"</strong>). By checking
        "I agree" and submitting this request, you are entering into this
        agreement, in accordance with Republic Act No. 9520 (the Philippine
        Cooperative Code of 2008) and the Cooperative's by-laws.
      </p>

      <h5 style="margin:10px 0 4px 0;">1. Amount and Interest</h5>
      <p style="margin:0 0 8px 0;">
        You are requesting the purchase amount and category shown above. No
        downpayment is required. Interest is a flat 10% of the requested
        amount, computed once, not a recurring monthly charge.
      </p>

      <h5 style="margin:10px 0 4px 0;">2. Repayment</h5>
      <p style="margin:0 0 8px 0;">
        The total payable shown above (amount plus interest) is repaid
        through semi-monthly installments, due on the 15th and 30th of each
        month, until fully paid.
      </p>

      <h5 style="margin:10px 0 4px 0;">3. Grace Period and Late Payment</h5>
      <p style="margin:0 0 8px 0;">
        Each installment has a 3 calendar-day grace period after its due
        date, with no penalty during that window. Starting on the 4th day
        after the due date, a flat penalty of ₱100.00 applies per missed
        installment cycle.
      </p>

      <h5 style="margin:10px 0 4px 0;">4. If You Do Not Pay</h5>
      <p style="margin:0 0 8px 0;">
        Philippine law does not imprison anyone for failing to pay a debt
        (1987 Constitution, Art. III, Sec. 20) — this is a civil, not a
        criminal, matter. Still, non-payment has real, binding consequences:
      </p>
      <ul style="margin:0 0 8px 0; padding-left:20px;">
        <li>Your outstanding balance remains a debt owed to the Cooperative and its members — it does not disappear.</li>
        <li>Missed or incomplete payments directly and immediately reduce your future credit limit and loan eligibility with the Cooperative.</li>
        <li>Your share capital contributions, if any, may be applied against any unpaid balance before any other use.</li>
        <li>The Cooperative may pursue any lawful civil remedy available to it to recover what is owed, including but not limited to formal demand, account restriction, or civil action.</li>
      </ul>

      <h5 style="margin:10px 0 4px 0;">5. Your Consent and Data</h5>
      <p style="margin:0 0 8px 0;">
        By submitting this request, you consent to the Cooperative's
        collection, verification, and use of the personal and
        identification information you have provided, for purposes of
        request processing, credit evaluation, and enforcement of this
        agreement, in accordance with the Data Privacy Act of 2012
        (Republic Act No. 10173).
      </p>

      <h5 style="margin:10px 0 4px 0;">6. How You Agree</h5>
      <p style="margin:0 0 8px 0;">
        Your acceptance is given electronically, by checking the box below
        and submitting this request. Under the Electronic Commerce Act of
        2000 (Republic Act No. 8792), this electronic acceptance has the
        same legal effect, validity, and enforceability as a signature on
        paper. The exact terms shown to you at the moment of acceptance are
        recorded and kept on file as proof of this agreement.
      </p>

      <h5 style="margin:10px 0 4px 0;">7. Severability and Governing Law</h5>
      <p style="margin:0 0 8px 0;">
        If any provision of this agreement is found invalid or
        unenforceable, the rest remains in full force and effect. This
        agreement is governed by the laws of the Republic of the
        Philippines, including the Philippine Cooperative Code of 2008 (RA
        9520) and the Civil Code of the Philippines, and by the
        Cooperative's by-laws and duly approved policies.
      </p>

      <p style="margin:0; opacity:.7; font-size:12px;">
        This is a plain-language statement of your rights and obligations,
        not a substitute for a formal contract reviewed by legal counsel. A
        separate, fully detailed contract document is generated and made
        available to you once your request is approved.
      </p>
    </div>
  `;
}

/**
 * Plain-text twin of getCreditCartAgreementHtml() — same wording, no
 * markup. Stamped verbatim into every Marimar's Credit Cart
 * AgreementAcceptance record. If this wording is ever edited, bump
 * CREDIT_CART_AGREEMENT_VERSION above.
 */
export function getCreditCartAgreementPlainText(): string {
  return [
    "MARIMAR'S CREDIT CART AGREEMENT — TERMS AND CONDITIONS",
    "",
    'This is a binding agreement between you ("the Member") and WEE LENDING COOPERATIVE ("the Cooperative"). By checking "I agree" and submitting this request, you are entering into this agreement, in accordance with Republic Act No. 9520 (the Philippine Cooperative Code of 2008) and the Cooperative\'s by-laws.',
    "",
    "1. AMOUNT AND INTEREST",
    "You are requesting the purchase amount and category shown above. No downpayment is required. Interest is a flat 10% of the requested amount, computed once, not a recurring monthly charge.",
    "",
    "2. REPAYMENT",
    "The total payable shown above (amount plus interest) is repaid through semi-monthly installments, due on the 15th and 30th of each month, until fully paid.",
    "",
    "3. GRACE PERIOD AND LATE PAYMENT",
    "Each installment has a 3 calendar-day grace period after its due date, with no penalty during that window. Starting on the 4th day after the due date, a flat penalty of ₱100.00 applies per missed installment cycle.",
    "",
    "4. IF YOU DO NOT PAY",
    "Philippine law does not imprison anyone for failing to pay a debt (1987 Constitution, Art. III, Sec. 20) — this is a civil, not a criminal, matter. Still, non-payment has real, binding consequences:",
    "- Your outstanding balance remains a debt owed to the Cooperative and its members — it does not disappear.",
    "- Missed or incomplete payments directly and immediately reduce your future credit limit and loan eligibility with the Cooperative.",
    "- Your share capital contributions, if any, may be applied against any unpaid balance before any other use.",
    "- The Cooperative may pursue any lawful civil remedy available to it to recover what is owed, including but not limited to formal demand, account restriction, or civil action.",
    "",
    "5. YOUR CONSENT AND DATA",
    "By submitting this request, you consent to the Cooperative's collection, verification, and use of the personal and identification information you have provided, for purposes of request processing, credit evaluation, and enforcement of this agreement, in accordance with the Data Privacy Act of 2012 (Republic Act No. 10173).",
    "",
    "6. HOW YOU AGREE",
    "Your acceptance is given electronically, by checking the box below and submitting this request. Under the Electronic Commerce Act of 2000 (Republic Act No. 8792), this electronic acceptance has the same legal effect, validity, and enforceability as a signature on paper. The exact terms shown to you at the moment of acceptance are recorded and kept on file as proof of this agreement.",
    "",
    "7. SEVERABILITY AND GOVERNING LAW",
    "If any provision of this agreement is found invalid or unenforceable, the rest remains in full force and effect. This agreement is governed by the laws of the Republic of the Philippines, including the Philippine Cooperative Code of 2008 (RA 9520) and the Civil Code of the Philippines, and by the Cooperative's by-laws and duly approved policies.",
    "",
    "This is a plain-language statement of your rights and obligations, not a substitute for a formal contract reviewed by legal counsel. A separate, fully detailed contract document is generated and made available to you once your request is approved.",
  ].join("\n");
}

/**
 * Looks up the right full agreement (HTML or plain text) for a given
 * product type. Every live flow (buildAgreementAcceptance,
 * promptForAgreementAcceptance) goes through these two, so adding a new
 * product's detailed agreement later only means adding one branch here.
 */
function getProductAgreementHtml(productType: AgreementProductType): string {
  if (productType === "coopLoan") return getCoopLoanAgreementHtml();
  if (productType === "easyInstallment") return getEasyInstallmentAgreementHtml();
  return getCreditCartAgreementHtml();
}

function getProductAgreementPlainText(productType: AgreementProductType): string {
  if (productType === "coopLoan") return getCoopLoanAgreementPlainText();
  if (productType === "easyInstallment") return getEasyInstallmentAgreementPlainText();
  return getCreditCartAgreementPlainText();
}

function getProductAgreementVersion(productType: AgreementProductType): string {
  if (productType === "coopLoan") return COOP_LOAN_AGREEMENT_VERSION;
  if (productType === "easyInstallment") return EASY_INSTALLMENT_AGREEMENT_VERSION;
  return CREDIT_CART_AGREEMENT_VERSION;
}

/**
 * Builds the persisted AgreementAcceptance record. Called only once the
 * user has actually checked the "I agree" box and confirmed — never
 * speculatively. Always stamps the exact agreement text the person was
 * shown (agreementText), not just a version number, so it's recoverable
 * verbatim even if the wording changes later.
 *
 * Every product now gets its own full, structured, promissory-note-style
 * agreement (see getProductAgreementPlainText above).
 */
export function buildAgreementAcceptance(
  productType: AgreementProductType,
  termsSnapshot: Record<string, any>
): AgreementAcceptance {
  return {
    agreementVersion: getProductAgreementVersion(productType),
    productType,
    termsSnapshot,
    agreementText: getProductAgreementPlainText(productType),
    acceptedAt: serverTimestamp(),
  };
}

/**
 * For flows with NO existing static agreement modal in the DOM (MLF Easy
 * Installment, Marimar's Credit Cart). Builds a modal on demand showing
 * the given terms summary + the liability clause + a required checkbox,
 * and resolves with the built AgreementAcceptance record, or null if the
 * person cancels or never checks the box.
 */
export function promptForAgreementAcceptance(
  productType: AgreementProductType,
  title: string,
  summaryHtml: string,
  termsSnapshot: Record<string, any>
): Promise<AgreementAcceptance | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal active";
    overlay.style.zIndex = "10600";
    overlay.innerHTML = `
      <div class="modal-content">
        <h3>📄 ${title}</h3>
        <div id="lam-summary" class="agreement-box">${summaryHtml}</div>
        ${getProductAgreementHtml(productType)}
        <label style="display:flex; gap:8px; align-items:flex-start; margin-top:12px; cursor:pointer;">
          <input type="checkbox" id="lam-checkbox" style="margin-top:3px;" />
          <span>I have read and understood the terms and responsibility above, and I agree to them.</span>
        </label>
        <p id="lam-error" style="color:#ff6b6b; display:none; margin-top:6px;"></p>
        <div class="modal-actions" style="margin-top:12px;">
          <button type="button" id="lam-cancel-btn">Cancel</button>
          <button type="button" id="lam-confirm-btn" class="primary" disabled>I Agree & Submit</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const checkbox = overlay.querySelector("#lam-checkbox") as HTMLInputElement;
    const confirmBtn = overlay.querySelector("#lam-confirm-btn") as HTMLButtonElement;
    const errorEl = overlay.querySelector("#lam-error") as HTMLElement;

    function cleanup() {
      overlay.remove();
    }

    checkbox.addEventListener("change", () => {
      confirmBtn.disabled = !checkbox.checked;
      if (checkbox.checked) errorEl.style.display = "none";
    });

    overlay.querySelector("#lam-cancel-btn")?.addEventListener("click", () => {
      cleanup();
      resolve(null);
    });

    confirmBtn.addEventListener("click", () => {
      if (!checkbox.checked) {
        errorEl.textContent = "⚠️ Please check the box to confirm you agree before submitting.";
        errorEl.style.display = "block";
        return;
      }
      const acceptance = buildAgreementAcceptance(productType, termsSnapshot);
      cleanup();
      resolve(acceptance);
    });
  });
}
