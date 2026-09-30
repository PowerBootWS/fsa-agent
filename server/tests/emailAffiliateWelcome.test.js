jest.mock('fsa-common', () => ({ email: { sendEmail: jest.fn() } }));
const { email: common } = require('fsa-common');
const { sendAffiliateWelcome } = require('../src/services/email');

it('escapes HTML in the first name and includes the referral link', async () => {
  await sendAffiliateWelcome('x@example.com', '<b>Sam</b>', 'SAM1234');
  const msg = common.sendEmail.mock.calls[0][0];
  expect(msg.html).toContain('&lt;b&gt;Sam&lt;/b&gt;');
  expect(msg.html).not.toContain('<b>Sam</b>');
  expect(msg.text).toContain('https://fullsteamahead.ca/?am_id=SAM1234');
  expect(msg.text).toContain('https://fullsteamahead.ca/affiliate-dashboard');
  expect(msg.html).toContain('enrolls in the 2nd or 3rd Class course through it');
  expect(msg.text).toContain('enrolls in the 2nd or 3rd Class course through it');
  expect(msg.html + msg.text + msg.subject).not.toMatch(/—|tailor/i);
});
