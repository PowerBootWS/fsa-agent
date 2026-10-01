# Final fix wave report

1. Modal re-check: `checkedThisLoad` reset on non-ok response and on fetch error (AnnouncementModal.jsx). Test: "re-checks on the next mount after a 401". RED: failed before fix; GREEN after.
2. `keepalive: true` added to shared `post()`. Test: "sends the seen POST with keepalive". RED: `expected undefined to be true`; GREEN.
3. Dateless re-publish keeps stored window: validateAnnouncement returns `starts_at_given`/`ends_at_given`; upsert DO UPDATE uses CASE on them and RETURNs stored starts_at/ends_at; publishFromFile counts eligibility using the stored starts_at. Tests (announcementsPublish.test.js): copy-only keeps dates, stays ended after --end-now, explicit dates update. RED: first two failed pre-fix (third passed, as it should); GREEN.
   - Adjusted existing upsert test: `toEqual({id,inserted:false})` -> `toMatchObject` because upsert now also returns starts_at/ends_at. Not a behaviour-reset assertion.
4. cta_url regex now `^\/(?![\/\\])`; case `/\evil.example` added to CTA test. RED then GREEN.
5. parseId `/^\d{1,9}$/`; test id 12345678901234567890 -> 404 on seen. RED (500) then GREEN.
6. CSS: `max-height: calc(100dvh - 32px);` added after the vh line.

Commands: server `npm test -- announcements`: RED 4 failed/34 passed; GREEN 38/38. Client `npx vitest run`: RED 2 failed (new tests); GREEN 100/100 (14 files).
Note: one full-client run showed a one-off failure in "the close button and Escape also record dismissed" (findBy timeout under load); passed on 3 isolated reruns and the next full run.
Client build not run. server/node_modules untracked, not committed.
