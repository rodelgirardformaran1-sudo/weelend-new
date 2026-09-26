import * as admin from "firebase-admin";
import * as path from "path";

// --------------------------------------------------
// 🔐 SERVICE ACCOUNT SETUP
// --------------------------------------------------
const serviceAccountPath = path.join(
  process.cwd(),
  "serviceAccountKey.json"
);

console.log("Resolved serviceAccountPath:", serviceAccountPath);

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// --------------------------------------------------
// 🧮 SAFE FINANCIAL RECONCILIATION
// --------------------------------------------------
async function reconcileFinancialSummary() {
  console.log("===========================================");
  console.log("🚀 Starting SAFE financial reconciliation");
  console.log("===========================================");

  let totalShareCapital = 0;
  let totalActivePrincipalOutstanding = 0;

  let totalPrincipalCollected = 0;
  let totalInterestCollected = 0;
  let totalLateFeesCollected = 0;
  let totalPaymentsCollected = 0;

  try {
    // ================================
    // 👥 USERS → SHARE CAPITAL
    // ================================
    console.log("📥 Reading users...");
    const usersSnap = await db.collection("users").get();

    usersSnap.forEach((doc) => {
      const u = doc.data();
      const share = Number(u.shareBalance ?? 0);
      if (share > 0) {
        totalShareCapital += share;
      }
    });

    console.log(`✅ Total Share Capital: ₱${totalShareCapital.toLocaleString()}`);

    // ================================
    // 💳 ACTIVE LOANS → OUTSTANDING PRINCIPAL
    // ================================
    console.log("📥 Reading active loans...");
    const activeLoansSnap = await db.collection("activeLoans").get();

    activeLoansSnap.forEach((doc) => {
      const loan = doc.data();
      const remaining = Number(loan.remainingBalance ?? 0);

      if (remaining > 0) {
        totalActivePrincipalOutstanding += remaining;
      }
    });

    console.log(
      `✅ Total Active Principal Outstanding: ₱${totalActivePrincipalOutstanding.toLocaleString()}`
    );

    // ================================
    // 💸 PAYMENTS → COLLECTION TOTALS
    // ================================
    console.log("📥 Reading payments...");
    const paymentsSnap = await db.collection("payments").get();

    paymentsSnap.forEach((doc) => {
      const p = doc.data();

      const principal = Number(p.principalPaid ?? 0);
      const interest  = Number(p.interestPaid ?? 0);
      const lateFee   = Number(p.lateFeePaid ?? 0);
      const totalPaid = Number(p.totalPaid ?? 0);

      totalPrincipalCollected += principal;
      totalInterestCollected  += interest;
      totalLateFeesCollected  += lateFee;
      totalPaymentsCollected  += totalPaid;
    });

    console.log(`✅ Principal Collected: ₱${totalPrincipalCollected.toLocaleString()}`);
    console.log(`✅ Interest Collected: ₱${totalInterestCollected.toLocaleString()}`);
    console.log(`✅ Late Fees Collected: ₱${totalLateFeesCollected.toLocaleString()}`);
    console.log(`✅ Total Payments Collected: ₱${totalPaymentsCollected.toLocaleString()}`);

    // ================================
    // 🏦 PROFIT → POOLS + TRUST FUND
    // ================================

    const profit = totalInterestCollected + totalLateFeesCollected;

    const trustFundBalance = profit * 0.10;
    const remainingProfit  = profit - trustFundBalance;

    const capitalPool = remainingProfit * 0.70;
    const effortPool  = remainingProfit * 0.30;

    console.log("-------------------------------------------");
    console.log(`📈 Profit: ₱${profit.toLocaleString()}`);
    console.log(`🛡️ Trust Fund (10%): ₱${trustFundBalance.toLocaleString()}`);
    console.log(`🏦 Capital Pool (70%): ₱${capitalPool.toLocaleString()}`);
    console.log(`🔥 Effort Pool (30%): ₱${effortPool.toLocaleString()}`);
    console.log("-------------------------------------------");

    // ================================
    // ✍️ WRITE TO FIRESTORE (SAFE)
    // ================================
    const ref = db
      .collection("coopFinancialSummary")
      .doc("current_state");

    await ref.set(
      {
        totalShareCapital,
        totalActivePrincipal: totalActivePrincipalOutstanding,

        totalPrincipalCollected,
        totalInterestCollected,
        totalLateFeesCollected,
        totalPaymentsCollected,

        profit,
        trustFundBalance,
        capitalPool,
        effortPool,

        reconciledAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log("✅ coopFinancialSummary snapshot fields updated safely.");
  } catch (err) {
    console.error("❌ Reconciliation failed:", err);
    process.exit(1);
  }

  console.log("🎉 Reconciliation complete.");
  process.exit(0);
}

// --------------------------------------------------
reconcileFinancialSummary();