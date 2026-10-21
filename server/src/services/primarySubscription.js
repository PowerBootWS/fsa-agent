// The ONE live subscription the platform shows a student (req.user.class_code,
// active_paper, ...). A student can hold several at once — 4th Class papers are
// prepaid study aids a program student keeps alongside 3rd or 2nd Class, and 4A +
// 4B together — so "which one" must be deterministic, never an arbitrary JOIN row:
//   1. the class they picked in the class switcher (platform_users.selected_class_code),
//   2. otherwise the highest class held (2nd > 3rd > 4th), 4A before 4B.
// `u` is the platform_users alias in the calling query. Use as:
//   FROM platform_users u LEFT JOIN LATERAL (${primarySubscriptionLateral('u')}) s ON true
function primarySubscriptionLateral(u) {
  return `
    SELECT ps.* FROM subscriptions ps
     WHERE ps.user_id = ${u}.id AND ps.status = 'active'
       AND (ps.cancel_at IS NULL OR ps.cancel_at > NOW())
     ORDER BY (ps.class_code = ${u}.selected_class_code) DESC NULLS LAST,
              CASE ps.class_code WHEN 'second' THEN 3 WHEN 'third' THEN 2 ELSE 1 END DESC,
              ps.class_code, ps.id
     LIMIT 1`;
}

module.exports = { primarySubscriptionLateral };
