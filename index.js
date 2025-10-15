const functions = require("firebase-functions");
const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("WeeLend backend is running successfully!");
});

exports.api = functions.https.onRequest(app);
