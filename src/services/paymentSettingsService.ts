// src/services/paymentSettingsService.ts

import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";

export interface PaymentMethod {
  type: "gcash" | "bank";
  label: string;
  name: string;
  number: string;
  bankName?: string;
  qrUrl?: string;
}

export async function getPaymentMethods(): Promise<PaymentMethod[]> {
  const ref = doc(db, "paymentSettings", "main");
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    console.warn("⚠️ paymentSettings/main not found");
    return [];
  }

  const data = snap.data();
  return data.methods || [];
}
