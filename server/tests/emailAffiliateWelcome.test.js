jest.mock('fsa-common', () => ({ email: { sendEmail: jest.fn() } }));
const { email: common } = require('fsa-common');
const { sendAffiliateWelcome } = require('../src/services/email');

it('escapes HTML in the first name and includes the referral link', async () => {
  await sendAffiliateWelcome('x@example.com', '<b>Sam</b>', 'SAM1234');
  const msg = common.sendEmail.mock.calls[0][0];
  expect(msg.html).toContain('&lt;b&gt;Sam&lt;/b&gt;');
  expect(msg.html).not.toContain('<b>Sam</b>');
  expect(msg.text).toContain('https://fullsteamahead.ca/?am_id=SAM1234');
  expect(msg.text).toContain('https://learn.fullsteamahead.ca/affiliate');
  expect(msg.html).toContain('https://learn.fullsteamahead.ca/affiliate');
  expect(msg.text).toContain('Referrals page in your Full Steam Ahead account');
  expect(msg.html).toContain('enrolls in the 2nd or 3rd Class course through it');
  expect(msg.text).toContain('enrolls in the 2nd or 3rd Class course through it');
  expect(msg.html + msg.text + msg.subject).not.toMatch(/—|tailor/i);
});

it('signs customer mail as Olivia with the company footer, once', async () => {
  const { sendMagicLink, sendPasswordReset, sendPracticeExamCode } = require('../src/services/email');
  common.sendEmail.mockClear();
  await sendMagicLink('x@example.com', 'Sam', 'tok');
  await sendPasswordReset('x@example.com', 'Sam', 'tok');
  await sendPracticeExamCode('x@example.com', 'Sam', '123456');
  await sendAffiliateWelcome('x@example.com', 'Sam', 'SAM1234');
  for (const [msg] of common.sendEmail.mock.calls) {
    expect(msg.from).toBe('Olivia | Full Steam Ahead <support@fullsteamahead.ca>');
    for (const body of [msg.text, msg.html]) {
      expect(body).toMatch(/Warm regards,[\s\S]*Olivia[\s\S]*Customer Support Agent[\s\S]*Full Steam Ahead/);
      expect(body).toContain('PO Box 99900 EU 953 098 RPO SKYVIEW, EDMONTON, ALBERTA T5L2Y2');
      expect(body).toContain('+1-587-412-5264');
      expect(body.split('Customer Support Agent')).toHaveLength(2);
      expect(body).not.toContain('—');
    }
  }
});

it('leaves operator mail unsigned', async () => {
  const { sendOpsEmail } = require('../src/services/email');
  common.sendEmail.mockClear();
  await sendOpsEmail('ops@example.com', 'Report', 'numbers');
  expect(common.sendEmail.mock.calls[0][0].text).toBe('numbers');
});
