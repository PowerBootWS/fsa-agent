import { isFourthClassCode } from './fourthClass';

// Where a user goes after login, signup or password setup. Everyone lands on
// /home, except a 2nd/3rd Class student who hasn't picked a paper yet (the
// picker comes first) and an explicit, same-origin ?next= (e.g. /jobs/capture).
export function postLoginPath(user, next) {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
  if (user?.class_code && !isFourthClassCode(user.class_code) && !user.active_paper) {
    return '/select-paper';
  }
  return '/home';
}
