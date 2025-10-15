const express = require("express");
const app = express();

const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  res.send("WeeLend backend is running successfully on Cloud Run!");
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});

