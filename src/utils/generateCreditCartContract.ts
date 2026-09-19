export function generateCreditCartContract(data: {
  memberName: string;
  category: "grocery" | "shopping";
  amount: number;
  termMonths: number;
  installmentCount: number;
  interestAmount: number;
  totalPayable: number;
  installmentAmount: number;
  startDate: string;
}) {
  const categoryLabel = data.category === "grocery" ? "Grocery" : "Department Store / Shopping Spree";

  return `
WEE LENDING COOPERATIVE
MARIMAR'S CREDIT CART AGREEMENT

Member Name: ${data.memberName}
Category: ${categoryLabel}
Purchase Amount: ₱${data.amount.toFixed(2)}
Term: ${data.termMonths} month(s) (${data.installmentCount} semi-monthly payments)

PAYMENT BREAKDOWN:
Down Payment: ₱0.00 (none required)
Interest (10% flat): ₱${data.interestAmount.toFixed(2)}
Total Payable: ₱${data.totalPayable.toFixed(2)}
Semi-Monthly Installment: ₱${data.installmentAmount.toFixed(2)} (due on the 15th and 30th of each month)

GRACE PERIOD:
Each installment has a 3 calendar day grace period after its due date,
with no penalty applied during this window.

LATE PAYMENT PENALTY:
Starting on the 4th day after the due date, a flat penalty of ₱100.00
will be applied per missed installment cycle.

The member agrees to pay each semi-monthly installment on or before its
due date, and understands that continued non-payment may result in
cooperative sanctions, account restriction, or additional charges.

By clicking "AGREE", the member confirms full understanding and
acceptance of the terms above.

Date Generated: ${data.startDate}
  `;
}