import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { calcPaSwipePricing } from "../utils/paSwipeCalc";

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
};

export async function createPaSwipeRequest(input: CreateRequestInput) {
  const { userId, userRole, product, termMonths } = input;

  const pricing = calcPaSwipePricing({
    srp: product.srp,
    termMonths,
    downpaymentRate: product.downpaymentRate,
  });

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

    downpaymentConfirmed: false, // ✅ set true by admin upon approval, once cash is actually received

    status: "pending" as const,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  return addDoc(collection(db, "paSwipeRequests"), payload);
}