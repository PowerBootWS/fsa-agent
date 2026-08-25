#!/usr/bin/env node
// fsa-agent/server/scripts/test-e2e-purchase.js
//
// Reusable regression check for the full Stripe credit-pack purchase path: signup -> test-mode
// Checkout -> real payment via Stripe's 4242 test card -> webhook delivery -> credit grant.
// Run with: npm run test:e2e-purchase (from server/)
//
// Requires STRIPE_TEST_SECRET_KEY, STRIPE_TEST_WEBHOOK_SECRET, STRIPE_TEST_PRICE_SPARK_ID, and
// ADMIN_API_KEY already set in /home/debian/.env, a deployed fsa-webhook-listener with the
// test-mode webhook endpoint registered in Stripe for checkout.session.completed, and that
// endpoint's enabled_events actually including checkout.session.completed (verified once by
// hand during initial setup -- Stripe does not warn you if it's misconfigured, the event is
// just silently never delivered). Runs against the live production app -- there is no
// separate dev/staging instance for this feature.

// Split config (env-split Step 8): shared layer first, then this project's own
// file, which wins. ADMIN_API_KEY and PLATFORM_BASE_URL both live in fsa-agent/.env.
// `override: true` is needed because dotenv keeps the first value it sees otherwise.
for (const path of ['/home/debian/.env.shared', '/home/debian/fsa-agent/.env']) {
  require('dotenv').config({ path, override: true });
}
const { chromium } = require('playwright');
const { execSync } = require('child_process');

const BASE_URL = process.env.PLATFORM_BASE_URL || 'https://learn.fullsteamahead.ca';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 15000;

async function getBalance(sessionCookie) {
  const res = await fetch(`${BASE_URL}/api/platform/credits`, { headers: { Cookie: sessionCookie } });
  if (!res.ok) throw new Error(`GET /credits failed: ${res.status}`);
  const data = await res.json();
  return data.balance;
}

async function main() {
  if (!ADMIN_API_KEY) throw new Error('ADMIN_API_KEY is not set');

  const email = `e2e-test-purchase-${Date.now()}@example.com`;
  console.log(`[1/6] Signing up disposable test account: ${email}`);
  const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'e2eTestPurchase1234', first_name: 'E2E', last_name: 'Test' }),
  });
  if (!signupRes.ok) throw new Error(`Signup failed: ${signupRes.status} ${await signupRes.text()}`);
  const setCookies = signupRes.headers.getSetCookie
    ? signupRes.headers.getSetCookie()
    : [signupRes.headers.get('set-cookie')];
  const sessionCookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  const { user } = await signupRes.json();
  console.log(`       user id ${user.id}`);

  let page;
  let browser;
  try {
    console.log('[2/6] Fetching starting credit balance');
    const startBalance = await getBalance(sessionCookie);
    console.log(`       starting balance: ${startBalance}`);

    console.log('[3/6] Creating test-mode checkout session');
    const checkoutRes = await fetch(`${BASE_URL}/api/admin/credits/test-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-api-key': ADMIN_API_KEY },
      body: JSON.stringify({ userId: user.id }),
    });
    if (!checkoutRes.ok) throw new Error(`test-checkout failed: ${checkoutRes.status} ${await checkoutRes.text()}`);
    const { url, sessionId } = await checkoutRes.json();
    console.log(`       session ${sessionId}`);

    console.log('[4/6] Completing payment with Stripe test card via a real browser');
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.goto(url);

    // Selectors below were discovered empirically against Stripe's actual hosted Checkout
    // page (2026-07-10) -- getByRole/getByLabel matched Stripe's own accessible names
    // directly, so these are reasonably stable, but Stripe can change their page at any time.
    // If this script starts failing here, re-run manually with headless: false (or inspect
    // the page.screenshot() taken on failure below) to find the new structure.
    await page.getByRole('textbox', { name: 'Card number' }).fill('4242424242424242');
    await page.getByRole('textbox', { name: 'Expiration' }).fill('12/34');
    await page.getByRole('textbox', { name: 'CVC' }).fill('123');
    await page.getByRole('textbox', { name: 'Cardholder name' }).fill('E2E Test');

    // The "I am an AI agent acting on behalf of someone else" checkbox is genuinely
    // applicable here -- this script really is an AI-agent-adjacent automated purchase.
    // Stripe's own actionability check flags this element as "outside the viewport" even
    // after scrolling (a page-layout quirk, not a real visibility problem), so it's clicked
    // directly via the DOM rather than through Playwright's normal click actionability gate.
    const aiAgentCheckbox = page.getByRole('checkbox', { name: /AI agent acting on behalf/i });
    await aiAgentCheckbox.evaluate((el) => {
      el.scrollIntoView({ block: 'center' });
      el.click();
    });

    await page.getByTestId('hosted-payment-submit-button').click();
    await page.waitForURL(/\/credits\?purchase=success/, { timeout: 20000 });
    console.log('       payment completed, redirected to success page');

    console.log('[5/6] Polling for credit grant');
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let endBalance = startBalance;
    while (Date.now() < deadline) {
      endBalance = await getBalance(sessionCookie);
      if (endBalance > startBalance) break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    console.log('[6/6] Cleaning up disposable test account');
    execSync(
      `docker exec fsa-postgres psql -U postgres -d fsa_agent -c "DELETE FROM login_events WHERE user_id = ${user.id};" -c "DELETE FROM platform_users WHERE id = ${user.id};"`,
      { stdio: 'inherit' }
    );

    if (endBalance <= startBalance) {
      console.error(`FAIL: balance did not increase (started ${startBalance}, ended ${endBalance}) within ${POLL_TIMEOUT_MS}ms`);
      process.exit(1);
    }
    console.log(`PASS: balance increased ${startBalance} -> ${endBalance}`);
  } catch (err) {
    if (page) await page.screenshot({ path: '/tmp/e2e-purchase-failure.png' }).catch(() => {});
    console.log('[6/6] Cleaning up disposable test account after failure');
    try {
      execSync(
        `docker exec fsa-postgres psql -U postgres -d fsa_agent -c "DELETE FROM login_events WHERE user_id = ${user.id};" -c "DELETE FROM platform_users WHERE id = ${user.id};"`,
        { stdio: 'inherit' }
      );
    } catch (cleanupErr) {
      console.error('Cleanup also failed:', cleanupErr.message);
    }
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
