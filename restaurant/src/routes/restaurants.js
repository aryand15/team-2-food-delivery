const express = require("express");
const router = express.Router();

// Temp endpoint
router.get("/", (req, res) => {
  res.json([
    {
      id: 1,
      name: "Sample Restaurant",
      cuisine: "Test Cuisine",
      is_open: true
    }
  ]);
});

module.exports = router;