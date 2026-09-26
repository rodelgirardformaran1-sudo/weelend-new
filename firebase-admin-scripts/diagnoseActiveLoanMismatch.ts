import * as admin from "firebase-admin";
import * as path from "path";

const serviceAccountPath = path.join(process.cwd(), "serviceAccountKey.json");
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
db.settings({ preferRest: true });

async function diagnose() {
  console.log("===========================================");
  console.log("🔍 Diagnostic: activeLoans status consistency");
  console.log("===========================================");

  const loansSnap = await db.collection("activeLoans").get();
  console.log(`Fetched ${loansSnap.docs.length} loan docs. Fetching schedules in parallel...`);

  const loanInfos = await Promise.all(
    loansSnap.docs.map(async (loanDoc) => {
      const loan = loanDoc.data();
      const scheduleSnap = await db
        .collection("activeLoans")
        .doc(loanDoc.id)
        .collection("schedule")
        .get();

      const scheduleItems = scheduleSnap.docs.map((d) => d.data());
      const totalItems = scheduleItems.length;
      const unpaidItems = scheduleItems.filter(
        (s: any) => s.status !== "voided" && (!s.paid || s.partial)
      ).length;

      return {
        userId: loan.userId,
        loanId: loanDoc.id,
        status: loan.status ?? "unknown",
        remainingBalance: loan.remainingBalance ?? null,
        principal: loan.principal ?? loan.amountBorrowed ?? loan.amount ?? null,
        totalScheduleItems: totalItems,
        unpaidScheduleItems: unpaidItems,
      };
    })
  );

  console.log("Schedules fetched. Grouping by user...");

  const byUser: Record<string, any[]> = {};
  for (const info of loanInfos) {
    if (!info.userId) continue;
    if (!byUser[info.userId]) byUser[info.userId] = [];
    byUser[info.userId].push(info);
  }

  let flaggedCount = 0;
  const flaggedUserIds: string[] = [];

  for (const userId of Object.keys(byUser)) {
    const loans = byUser[userId];

    const hasActiveStatus = loans.some((l) => l.status === "active");
    const hasCompletedStatus = loans.some((l) => l.status === "completed");
    const anyActiveButFullyPaid = loans.some(
      (l) => l.status === "active" && l.totalScheduleItems > 0 && l.unpaidScheduleItems === 0
    );
    const multipleLoans = loans.length > 1;

    const isFlagged =
      anyActiveButFullyPaid || (hasActiveStatus && hasCompletedStatus) || multipleLoans;

    if (!isFlagged) continue;

    flaggedCount++;
    flaggedUserIds.push(userId);
  }

  console.log(`Fetching names for ${flaggedUserIds.length} flagged users...`);

  const userNames = await Promise.all(
    flaggedUserIds.map(async (uid) => {
      const userSnap = await db.collection("users").doc(uid).get();
      const userData = userSnap.exists ? userSnap.data() : null;
      return [uid, userData?.fullName || uid] as const;
    })
  );
  const nameMap = new Map(userNames);

  for (const userId of flaggedUserIds) {
    console.log(`\n🚩 ${nameMap.get(userId)} (${userId})`);
    byUser[userId].forEach((l) => {
      console.log(
        `   loan ${l.loanId}  status=${l.status}  principal=${l.principal}  remainingBalance=${l.remainingBalance}  schedule: ${l.totalScheduleItems} total / ${l.unpaidScheduleItems} unpaid`
      );
    });
  }

  console.log(`\n===========================================`);
  console.log(`Total users scanned: ${Object.keys(byUser).length}`);
  console.log(`Flagged (inconsistent) users: ${flaggedCount}`);
  console.log("🎉 Diagnostic complete (nothing was written).");
  process.exit(0);
}

diagnose().catch((err) => {
  console.error("❌ Diagnostic failed:", err);
  process.exit(1);
});
