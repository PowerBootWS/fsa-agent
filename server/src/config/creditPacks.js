// Single source of truth for the three purchasable credit packs. priceIdEnvVar names the
// env var holding the real Stripe Price ID (created in Task 8) -- resolved at request time,
// not at module load, matching how other routes in this file read env vars per-request.
const CREDIT_PACKS = {
  spark: { priceIdEnvVar: 'STRIPE_PRICE_SPARK_ID', credits: 1, displayName: 'Spark', priceLabel: '$19' },
  full_steam: { priceIdEnvVar: 'STRIPE_PRICE_FULL_STEAM_ID', credits: 5, displayName: 'Full Steam', priceLabel: '$39' },
  locomotive: { priceIdEnvVar: 'STRIPE_PRICE_LOCOMOTIVE_ID', credits: 10, displayName: 'Locomotive', priceLabel: '$69' },
};

// Fixed display order (object key order isn't guaranteed sorted, so callers use this list).
const PACK_ORDER = ['spark', 'full_steam', 'locomotive'];

module.exports = { CREDIT_PACKS, PACK_ORDER };
