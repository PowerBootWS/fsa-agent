const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  database: process.env.POSTGRES_DB || 'fsa_agent',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD,
});

module.exports = async function requireAuth(req, res, next) {
  const token = req.cookies?.fsa_session;
  if (!token) return res.status(401).json({ error: 'You have been signed out because another device logged in.' });

  try {
    const result = await pool.query(
      `SELECT pu.id, pu.email, pu.first_name, pu.last_name, pu.current_session_token,
              s.class_code, s.status, s.active_paper, s.last_paper_switch_at, s.id as subscription_id
       FROM platform_users pu
       JOIN subscriptions s ON s.user_id = pu.id AND s.status = 'active'
       WHERE pu.current_session_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'You have been signed out because another device logged in.' });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    console.error('requireAuth error:', err);
    return res.status(500).json({ error: 'Authentication error' });
  }
};
