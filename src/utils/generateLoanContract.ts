// src/utils/generateLoanContract.ts
//
// Generates the full coop loan contract text — same pattern as
// generatePaSwipeContract.ts / generateCreditCartContract.ts, so all
// three WeeLend lending products have a real, persisted, downloadable
// contract document, not just the terms summary in the request record.

export function generateLoanContract(data: {
  memberName: string;
  amount: number;
  termsMonths: number;
  monthlyInterestRate: number; // e.g. 0.10
  totalInterest: number;
  totalPayable: number;
  paymentSchedule: string;
  startDate: string;
  purpose?: string | null; // the borrower's declared reason for the loan
  guarantorName?: string | null;
  securityGuarantor?: {
    name: string;
    relationship: string;
    phone: string;
  } | null; // present only when the loan exceeded ₱10,000 and required one
  note?: string | null; // e.g. an administrative-backfill disclosure line
}) {
  const interestPercent = data.monthlyInterestRate * 100;

  return `
WEE LENDING COOPERATIVE
COOPERATIVE LOAN AGREEMENT

Member/Borrower Name: ${data.memberName}
Loan Amount: ₱${data.amount.toFixed(2)}
Term: ${data.termsMonths} month(s)
Payment Schedule: ${data.paymentSchedule}
Purpose of Loan: ${data.purpose && data.purpose.trim() ? data.purpose : "Not specified"}
${data.guarantorName ? `Guarantor: ${data.guarantorName}\n` : ""}
PAYMENT BREAKDOWN:
Monthly Interest Rate: ${interestPercent}%
Total Interest (${data.termsMonths} months): ₱${data.totalInterest.toFixed(2)}
Total Payable: ₱${data.totalPayable.toFixed(2)}

LATE PAYMENT PENALTY:
A late fee of 3% applies to any overdue installment, escalating to 5%
once a payment remains unpaid for more than 15 days past its due date.

RESPONSIBILITY:
Philippine law does not imprison anyone for failing to pay a debt (1987
Constitution, Art. III, Sec. 20) — this is a civil, not a criminal,
matter. Still, this agreement carries real consequences for not honoring
it:
- The outstanding balance remains a debt owed to the cooperative and its
  members — it does not disappear.
- If the borrower leaves the cooperative with an unpaid loan, their share
  contributions (if any) are applied against that balance first; anything
  beyond that stays on record as a receivable.
- Missed or incomplete payments directly reduce future credit limit and
  loan eligibility.
- The cooperative may pursue any lawful civil remedy available to
  recover what's owed.

The borrower agrees to repay this loan in full, on schedule, and
understands that continued non-payment may result in cooperative
sanctions, loss of future eligibility, or civil collection action.
${
  data.securityGuarantor
    ? `
SECURITY GUARANTOR:
This loan exceeds ₱10,000, which requires a verified security guarantor
as a condition of approval. The security guarantor named below completed
identity verification and, in doing so, gave the cooperative permission
to contact them about this loan if the borrower cannot be reached —
functioning as a specific, verified emergency contact for this loan.
This role does not make the guarantor financially responsible for
repaying the loan.

Guarantor Name: ${data.securityGuarantor.name}
Relationship to Borrower: ${data.securityGuarantor.relationship}
Contact Number: ${data.securityGuarantor.phone}
`
    : ""
}
By checking "I have read and understood the terms and responsibility
above, and I agree to them" at the time of this loan request, the
borrower confirmed full understanding and acceptance of the terms above.

Date Generated: ${data.startDate}
${data.note ? `\n${data.note}\n` : ""}  `;
}
