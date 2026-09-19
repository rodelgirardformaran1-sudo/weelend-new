import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { calcCreditCartPricing, type CreditCartCategory } from "../utils/creditCartCalc";

type CreateCreditCartRequestInput = {
  userId: string;
  userRole: "member" | "borrower";
  category: CreditCartCategory;
  amount: number;
};

export async function createCreditCartRequest(input: CreateCreditCartRequestInput) {
  const { userId, userRole, category, amount } = input;
  const pricing = calcCreditCartPricing({ amount, category });

  return addDoc(collection(db, "creditCartRequests"), {
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
  });
}