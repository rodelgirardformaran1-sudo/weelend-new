// index.js
const express = require("express");
const app = express();

// middleware to handle JSON
app.use(express.json());

// Root route
app.get("/", (req, res) => {
  res.send("WeeLend backend is running successfully on Cloud Run!");
});

// Example API routes
app.get("/api/members", (req, res) => {
  res.json([{ id: 1, name: "Juan Dela Cruz" }, { id: 2, name: "Maria Santos" }]);
});

app.get("/api/loans", (req, res) => {
  res.json([{ loanId: "L001", borrower: "Juan Dela Cruz", amount: 5000 }]);
});

app.get("/api/payments", (req, res) => {
  res.json([{ paymentId: "P001", loanId: "L001", amountPaid: 1000 }]);
});

// Listen on the port Cloud Run provides
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
