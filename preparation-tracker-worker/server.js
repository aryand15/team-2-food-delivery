const express = require("express");

const app = express();
const PORT = process.env.PORT || 3004;

app.use(express.json());

// root route 
app.get("/", (req, res) => {
  res.json({ message: "Preparation Tracker Worker is running" });
});

// placeholder health route 
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Worker is running"
  });
});

app.listen(PORT, () => {
  console.log(`Preparation Tracker Worker listening on port ${PORT}`);
});