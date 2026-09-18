export function generatePaSwipeContract(data: {
  memberName: string;
  productName: string;
  srp: number;
  termMonths: number;
  downpaymentRate: number;
  downpayment: number;
  interestRate: number;
  interestAmount: number;
  remainingBalance: number;
  installmentAmount: number;
  installmentCount: number;
  startDate: string;
}) {
  const interestPercent = data.interestRate * 100;

  return `
WEE LENDING COOPERATIVE
MLF EASY INSTALLMENTS AGREEMENT

Member Name: ${data.memberName}
Product: ${data.productName}
Suggested Retail Price (SRP): ₱${data.srp.toFixed(2)}
Term: ${data.termMonths} months (${data.installmentCount} semi-monthly payments)

PAYMENT BREAKDOWN:
Downpayment (${(data.downpaymentRate * 100).toFixed(0)}% of SRP, due upon approval): ₱${data.downpayment.toFixed(2)}
Interest Rate: ${interestPercent}% of SRP
Interest Amount: ₱${data.interestAmount.toFixed(2)}
Remaining Balance: ₱${data.remainingBalance.toFixed(2)}
Semi-Monthly Installment: ₱${data.installmentAmount.toFixed(2)} (due on the 15th and 30th of each month)

GRACE PERIOD:
Each installment has a 3 calendar day grace period after its due date,
with no penalty applied during this window.

LATE PAYMENT PENALTY:
Starting on the 4th day after the due date, a late fee of 0.1% per day
will be applied to the overdue installment amount, counted from the end
of the grace period (i.e., the 4th day late = 1 day charged).

Late Fee Formula:
Overdue Installment × 0.1% × (Days Late − 3) = Late Fee

This late fee is capped at a maximum of 10% of the overdue installment
amount per billing cycle.

DEFAULT AND REPOSSESSION:
If any installment remains unpaid for more than 30 consecutive days past
its due date, this account will be flagged for repossession. Ownership
of the item remains with the seller/cooperative until the full remaining
balance is paid in full.

The member agrees to pay each semi-monthly installment on or before its
due date, and understands that continued non-payment may result in
repossession of the item, cooperative sanctions, account restriction,
or additional charges.

By clicking "AGREE", the member confirms full understanding and
acceptance of the terms above.

Date Generated: ${data.startDate}
  `;
}