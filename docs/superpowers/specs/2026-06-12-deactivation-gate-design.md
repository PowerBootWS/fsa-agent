# Scoped Deactivation + Confirmation Gate — Design

**Date:** 2026-06-12
**Status:** Approved, implementing
**Repos touched:** `fsa-agent` (server), `fsa-webhook-listener`

## Problem

A paying customer (Shane Lush) lost LMS access while still holding an active, paid
Stripe subscription. Root cause: the Stripe `customer.subscription.deleted` →
`fsa-webhook-listener` → `fsa-agent /api/platform/deactivate-user` flow deactivates by
**user/email**, not by the cancelled subscription, and never checks whether the user
still has another active subscription. Shane had **two Stripe customer objects under one
email** (a duplicate signup); cancelling the duplicate's trial deactivated his real,
active subscription.

## Goals

1. **Root fix** — never deactivate a user who still has an active subscription anywhere
   under their email.
2. **Temporary safety gate** — until the LMS transition is stable, no automated
   deactivation flips a customer to inactive without the operator's confirmation.

Non-goal (YAGNI): a persistent pending-deactivation queue table + dedicated confirm
endpoint. The notification email is the record; the existing admin endpoint is the
confirm action. Revisit only if churn volume makes email-tracking unwieldy.

## Part A — Root-cause fix

### `fsa-webhook-listener/src/handlers/stripe.js` (`customer.subscription.deleted`)
Before calling `deactivate-user`:
1. Resolve **all** Stripe customer IDs for the cancelled customer's email
   (`stripe.customers.search({ query: "email:'<email>'" })`) — email-scoped, because
   duplicate customer objects exist.
2. Across those customers, list subscriptions and collect any with status `active`,
   `trialing`, or `past_due`, excluding the just-deleted `subscription.id`.
3. **If any remain** → log and **skip**: do NOT call `deactivate-user`, do NOT remove
   GHL access tags. The customer keeps access.
4. **If none remain** → proceed as today, additionally passing
   `stripe_subscription_id: subscription.id` in the `deactivate-user` payload, and remove
   GHL tags.

### `fsa-agent /api/platform/deactivate-user`
- Accept optional `stripe_subscription_id`; record it on the affected row for traceability.
- Defence-in-depth: the immediate-deactivation UPDATE already scopes to the user's active
  rows; webhook-listener guarantees no other active sub remains by the time we get here.

## Part B — Confirmation gate

Env flag **`DEACTIVATION_REQUIRES_CONFIRMATION`** (default **`true`**). Review recipient
**`DEACTIVATION_REVIEW_EMAIL`** (default `sysadmin@powerboot.ca`).

When the flag is on:
- **Immediate path** (`/deactivate-user`, no future `cancel_at`): do NOT flip status.
  Send a review email (customer name, email, subscription id, reason) and return
  `{ ok: true, pending: true }`. Customer stays active.
- **Grace-period set** (`cancel_at` in the future): unchanged — only sets `cancel_at`,
  pulls no access, so it is not gated.
- **Grace-period expiry** (`/expire-grace-periods`, daily cron): do NOT flip the expired
  rows. Email a digest of who is due and leave them active. (Low churn → at most a small
  daily re-nag until confirmed; acceptable for a temporary gate.)

**Confirming a deactivation:** the operator replies / tells the agent, who finalizes via
the existing `POST /api/admin/subscription` `{ action: 'deactivate' }` endpoint
(`x-admin-api-key`). No new table or endpoint.

**Turning the gate off later:** set `DEACTIVATION_REQUIRES_CONFIRMATION=false`. The
corrected, now-scoped auto-deactivation resumes.

## New email function

`fsa-agent/server/src/services/email.js` → `sendDeactivationReview({ items })` where
`items` is one or more `{ name, email, stripeSubscriptionId, reason }`. Sends to
`DEACTIVATION_REVIEW_EMAIL`. Used for both the immediate single-customer case and the
grace-expiry digest.

## Deploy

1. `fsa-agent`: no schema change required (`stripe_subscription_id` column already exists).
2. Add env vars to `/home/debian/.env`: `DEACTIVATION_REQUIRES_CONFIRMATION=true`,
   `DEACTIVATION_REVIEW_EMAIL=sysadmin@powerboot.ca`.
3. Rebuild + redeploy `fsa-agent` `api` container.
4. Redeploy `fsa-webhook-listener`.

## Verification

- Unit-level: webhook handler skips deactivation when a second active sub exists for the
  email; calls deactivate-user only when none remain.
- Gate: with flag on, `/deactivate-user` returns `pending: true` and leaves status active;
  a review email is sent.
- Regression: the Shane scenario (two customers, one cancelled) no longer deactivates.
