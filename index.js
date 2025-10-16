// index.js
const express = require("express");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");

// Initialize Firebase Admin (uses default credentials on Cloud Run)
try {
  admin.initializeApp();
} catch (e) {
  // already initialized in HMR or multiple reloads
}

const db = admin.firestore();
const app = express();
app.use(bodyParser.json());

// Basic root
app.get("/", (req, res) => {
  res.send("WeeLend backend is running and connected to Firestore.");
});

/**
 * MEMBERS
 * GET /api/members           - list members (limited)
 * GET /api/members/:id       - get single member doc
 * POST /api/members          - create member
 * PUT /api/members/:id       - update member
 * DELETE /api/members/:id    - delete member
 */

// List members (with optional ?limit= and ?role=)
app.get("/api/members", async (req, res) => {
  try {
    let q = db.collection("users").where("role", "==", "member");
    if (req.query.role) q = db.collection("users").where("role", "==", req.query.role);
    if (req.query.limit) q = q.limit(parseInt(req.query.limit, 10));
    const snap = await q.get();
    const members = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(members);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed-list-members", details: err.message });
  }
});

app.get("/api/members/:id", async (req, res) => {
  try {
    const doc = await db.collection("users").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "not-found" });
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/members", async (req, res) => {
  try {
    // expect body: { name, email, role: "member", profileImageUrl, shares: {...} }
    const payload = req.body;
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    // default role if not provided
    payload.role = payload.role || "member";
    const docRef = await db.collection("users").add(payload);
    const doc = await docRef.get();
    res.status(201).json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/members/:id", async (req, res) => {
  try {
    const updates = req.body;
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await db.collection("users").doc(req.params.id).update(updates);
    const doc = await db.collection("users").doc(req.params.id).get();
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/members/:id", async (req, res) => {
  try {
    await db.collection("users").doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * LOANS
 * GET /api/loans
 * POST /api/loans  - create loan (must include borrowerId & loan data)
 */
app.get("/api/loans", async (req, res) => {
  try {
    const snap = await db.collection("loans").get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/loans", async (req, res) => {
  try {
    const payload = req.body; // expect borrowerId, loanAmount, interestRate, repaymentSchedule (array) ...
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    payload.loanStatus = payload.loanStatus || "pending";
    payload.totalPaid = payload.totalPaid || 0;
    const docRef = await db.collection("loans").add(payload);
    const doc = await docRef.get();
    res.status(201).json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PAYMENTS
 * POST /api/payments - register a payment for a loan
 */
app.post("/api/payments", async (req, res) => {
  try {
    const payload = req.body; // expect: borrowerId, loanId, amountPaid, interestPaidAmount, lateFeePaidAmount, repaymentScheduleItemId
    payload.paymentDate = admin.firestore.FieldValue.serverTimestamp();
    payload.status = "pending";
    const pRef = await db.collection("payments").add(payload);

    // trigger: update loan aggregates (simple example)
    // NOTE: your cloud function does more robust transaction logic; here we do a simple update
    const loanRef = db.collection("loans").doc(payload.loanId);
    await db.runTransaction(async (tx) => {
      const loanDoc = await tx.get(loanRef);
      if (!loanDoc.exists) throw new Error("loan-not-found");
      const loan = loanDoc.data();
      const newTotalPaid = (loan.totalPaid || 0) + (payload.amountPaid || 0);
      tx.update(loanRef, { totalPaid: newTotalPaid });
    });

    res.status(201).json({ id: pRef.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`WeeLend API listening on port ${PORT}`);
});
