
import { db } from "../firebaseConfig";
import {
  doc,
  updateDoc,
  collection,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";

/**
 * 💸 SAVE LOAN PAYMENT + UPDATE REMAINING BALANCE
 */
export async function recordLoanPayment(
  loanId: string,
  userId: string,
  amount: number,
  method: string,
  currentBalance: number,
  adminId: string
) {
  // ❗ Validate critical inputs first
  if (!loanId) throw new Error("Missing loanId");
  if (!userId) throw new Error("Missing userId");
  if (!adminId) throw new Error("Missing adminId");
  if (isNaN(amount) || amount <= 0) throw new Error("Invalid payment amount");

  // ⚙️ Calculate new balance (never allow negative)
  const newBalance = Math.max(currentBalance - amount, 0);
  const completed = newBalance === 0;

  // 1️⃣ Add repayment record inside loan
  const repaymentRef = await addDoc(
    collection(db, `activeLoans/${loanId}/repayments`),
    {
      userId,
      amount,
      method,
      datePaid: serverTimestamp(),
      remainingBalance: newBalance,
      adminCollector: adminId,
      status: completed ? "completed" : "partial",
    }
  );

  // 2️⃣ Update loan main document
  await updateDoc(doc(db, "activeLoans", loanId), {
    remainingBalance: newBalance,
    status: completed ? "completed" : "active",
  });

  return {
    repaymentId: repaymentRef.id,
    newBalance,
    isCompleted: completed,
  };
}
