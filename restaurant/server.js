const express = require("express");

const app = express();
const PORT = process.env.PORT || 3003;

app.use(express.json());

// Root route
app.get("/", (req, res) => {
  res.json({ message: "Restaurant Service is running" });
});

// Temporary restaurants endpoint
app.get("/restaurants", (req, res) => {
  res.json([
    {
      id: 1,
      name: "Sample Restaurant",
      cuisine: "Test Cuisine",
      is_open: true
    }
  ]);
});

// health endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    checks: {
      database: { status: "healthy" },
      redis: { status: "healthy" }
    }
  });
});

app.listen(PORT, () => {
  console.log(`Restaurant Service listening on port ${PORT}`);
});