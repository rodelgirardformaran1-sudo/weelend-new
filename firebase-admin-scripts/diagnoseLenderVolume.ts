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
// 🔍 DIAGNOSTIC: List every loan grouped by guarantor
// (READ-ONLY — does not write anything)
// --------------------------------------------------
async function diagnoseLenderVolume() {
  console.log("===========================================");
  console.log("🔍 Diagnostic: loans grouped by guarantor");
  console.log("===========================================");

  const loansSnap = await db.collection("activeLoans").get();

  const byGuarantor: Record<string, { loanId: string; borrower: string; principal: number; status: string }[]> = {};

  loansSnap.forEach((doc) => {
    const loan = doc.data();
    const guarantorId = loan.guarantorId;
    const principal = Number(loan.principal ?? 0);

    if (!guarantorId) return;
    if (principal <= 0) return;

    if (!byGuarantor[guarantorId]) byGuarantor[guarantorId] = [];
    byGuarantor[guarantorId].push({
      loanId: doc.id,
      borrower: loan.borrowerName ?? "Unknown",
      principal,
      status: loan.status ?? "unknown",
    });
  });

  for (const uid of Object.keys(byGuarantor)) {
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() : null;
    const name = userData?.fullName || uid;

    console.log(`\n👤 ${name} (${uid})`);
    let total = 0;
    byGuarantor[uid].forEach((l) => {
      console.log(`   ${l.loanId}  ${l.borrower.padEnd(30)} ₱${l.principal.toLocaleString()}  [${l.status}]`);
      total += l.principal;
    });
    console.log(`   TOTAL: ₱${total.toLocaleString()}`);
  }

  console.log("\n🎉 Diagnostic complete (nothing was written).");
  process.exit(0);
}

diagnoseLenderVolume();
