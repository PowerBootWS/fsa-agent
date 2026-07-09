const express = require('express');
const path = require('path');
const { pool } = require('../services/database');
const requireAuth = require('../middleware/requireAuth');
const credits = require('../services/credits');

const router = express.Router();

router.get('/credits', requireAuth, async (req, res) => {
  try {
    const balance = await credits.getBalance(req.user.id);
    return res.json({ balance });
  } catch (err) {
    console.error('GET /api/platform/credits error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
