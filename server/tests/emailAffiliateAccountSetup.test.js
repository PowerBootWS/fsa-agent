jest.mock('fsa-common', () => ({ email: { sendEmail: jest.fn() } }));
const { email: common } = require('fsa-common');
const { sendAffiliateAccountSetup } = require('../src/services/email');

beforeEach(() => common.sendEmail.mockClear());

it('sends the setup link that lands on the referrals page', async () => {
  await sendAffiliateAccountSetup('x@example.com', 'Sam', 'tok-123');
  const msg = common.sendEmail.mock.calls[0][0];
  expect(msg.to).toBe('x@example.com');
  expect(msg.subject).toBe('Your referral dashboard has moved');
  const link = 'https://learn.fullsteamahead.ca/setup?token=tok-123&next=%2Faffiliate';
  expect(msg.text).toContain(link);
  expect(msg.html).toContain(`href="${link.replace(/&/g, '&amp;')}"`);
  expect(msg.html).toContain('Set Up My Account');
  expect(msg.text).toMatch(/^Hi Sam,/);
  expect(msg.text).toContain('open Referrals in the menu');
  expect(msg.text).toContain('This link expires in 48 hours.');
  expect(msg.from).toBe('Olivia | Full Steam Ahead <support@fullsteamahead.ca>');
});

it('greets "Hi there," when there is no first name', async () => {
  await sendAffiliateAccountSetup('x@example.com', '', 'tok');
  const msg = common.sendEmail.mock.calls[0][0];
  expect(msg.text).toMatch(/^Hi there,/);
  expect(msg.html).toContain('<p>Hi there,</p>');
});

it('escapes the name in html and uses no em dash anywhere', async () => {
  await sendAffiliateAccountSetup('x@example.com', '<b>Sam</b>', 'tok');
  const msg = common.sendEmail.mock.calls[0][0];
  expect(msg.html).toContain('&lt;b&gt;Sam&lt;/b&gt;');
  expect(msg.html).not.toContain('<b>Sam</b>');
  expect(msg.html + msg.text + msg.subject).not.toContain('—');
});

it('signs once, with the support@ signature and no "Russ" sign-off line', async () => {
  await sendAffiliateAccountSetup('x@example.com', 'Sam', 'tok');
  const msg = common.sendEmail.mock.calls[0][0];
  expect(msg.text.split('\n').map((l) => l.trim())).not.toContain('Russ');
  expect(msg.html).not.toContain('<p>Russ</p>');
  for (const body of [msg.text, msg.html]) {
    expect(body.split('Warm regards,')).toHaveLength(2);
    expect(body.split('Customer Support Agent')).toHaveLength(2);
  }
});
