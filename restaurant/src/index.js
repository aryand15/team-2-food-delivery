const express = require("express");

const app = express();
const PORT = process.env.PORT || 3003;

// Middleware
app.use(express.json());

// Routes
const restaurantRoutes = require("./routes/restaurants");
app.use("/restaurants", restaurantRoutes);

// Root route
app.get("/", (req, res) => {
  res.json({ message: "Restaurant Service is running" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Restaurant Service listening on port ${PORT}`);
});