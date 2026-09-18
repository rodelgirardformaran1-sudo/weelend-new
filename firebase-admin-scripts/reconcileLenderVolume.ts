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
// 🧮 RECONCILE LENDER VOLUME (per-guarantor)
// --------------------------------------------------
async function reconcileLenderVolume() {
  console.log("===========================================");
  console.log("🚀 Starting lenderVolume reconciliation");
  console.log("===========================================");

  try {
    console.log("📥 Reading activeLoans...");
    const loansSnap = await db.collection("activeLoans").get();

    const totalsByGuarantor: Record<string, number> = {};

    loansSnap.forEach((doc) => {
      const loan = doc.data();
      const guarantorId = loan.guarantorId;
      const principal = Number(loan.principal ?? 0);

      if (!guarantorId) return;
      if (principal <= 0) return;

      totalsByGuarantor[guarantorId] =
        (totalsByGuarantor[guarantorId] ?? 0) + principal;
    });

    console.log(`✅ Found ${Object.keys(totalsByGuarantor).length} distinct guarantors`);

    console.log("-------------------------------------------");
    console.log("📊 COMPUTED LENDER VOLUME PER GUARANTOR:");
    console.log("-------------------------------------------");

    const guarantorIds = Object.keys(totalsByGuarantor);

    for (const uid of guarantorIds) {
      const userSnap = await db.collection("users").doc(uid).get();
      const userData = userSnap.exists ? userSnap.data() : null;
      const name = userData?.fullName || userData?.email || uid;
      const currentValue = userData?.lenderVolume ?? "N/A";

      console.log(
        `${name.padEnd(30)} computed: ₱${totalsByGuarantor[uid].toLocaleString()}` +
        `   (current Firestore value: ${currentValue})`
      );
    }

    console.log("-------------------------------------------");
    console.log("✍️ Writing corrected lenderVolume to each guarantor...");

    const batch = db.batch();

    for (const uid of guarantorIds) {
      const userRef = db.collection("users").doc(uid);
      batch.set(
        userRef,
        { lenderVolume: totalsByGuarantor[uid] },
        { merge: true }
      );
    }

    await batch.commit();

    console.log("✅ lenderVolume updated for all guarantors.");
  } catch (err) {
    console.error("❌ Reconciliation failed:", err);
    process.exit(1);
  }

  console.log("🎉 Lender volume reconciliation complete.");
  process.exit(0);
}

// --------------------------------------------------
reconcileLenderVolume();