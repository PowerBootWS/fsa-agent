jest.mock('fsa-common', () => ({ email: { sendEmail: jest.fn() } }));
const path = require('path');
const { parseArgs, splitName, filterSelection, applyPreflight } =
  require('../scripts/provision-affiliate-accounts');

describe('splitName', () => {
  it('takes the first word as first name and the rest as last name', () => {
    expect(splitName('  Sam  Lee Smith ')).toEqual({ first: 'Sam', last: 'Lee Smith' });
    expect(splitName('Sam')).toEqual({ first: 'Sam', last: '' });
  });
  it('gives empty strings for a missing name', () => {
    expect(splitName(null)).toEqual({ first: '', last: '' });
    expect(splitName('   ')).toEqual({ first: '', last: '' });
  });
});

describe('parseArgs + filterSelection', () => {
  const rows = [{ email: 'A@x.com' }, { email: 'b@x.com' }, { email: 'c@x.com' }];
  it('is a dry run by default and keeps everyone', () => {
    const opts = parseArgs([]);
    expect(opts.apply).toBe(false);
    expect(filterSelection(rows, opts)).toHaveLength(3);
  });
  it('--only restricts, case-insensitively', () => {
    expect(filterSelection(rows, parseArgs(['--only=a@X.com, c@x.com'])).map((r) => r.email))
      .toEqual(['A@x.com', 'c@x.com']);
  });
  it('--skip excludes, case-insensitively', () => {
    expect(filterSelection(rows, parseArgs(['--skip=B@x.com'])).map((r) => r.email))
      .toEqual(['A@x.com', 'c@x.com']);
  });
  it('refuses unknown arguments, so a typo of --apply never runs', () => {
    expect(() => parseArgs(['--aply'])).toThrow(/unknown argument/);
  });
  it('parses --resend and refuses it alongside --only/--skip', () => {
    expect(parseArgs(['--resend=A@x.com']).resend).toEqual(['a@x.com']);
    expect(() => parseArgs(['--resend=a@x.com', '--skip=b@x.com'])).toThrow();
  });
});

describe('applyPreflight', () => {
  const readable = __filename;
  it('passes on production with a readable key', () => {
    expect(applyPreflight({ SUPPORT_GMAIL_SA: readable }, 'fsa_agent')).toEqual([]);
  });
  it('refuses when SUPPORT_GMAIL_SA is unset or unreadable', () => {
    expect(applyPreflight({}, 'fsa_agent').join()).toMatch(/SUPPORT_GMAIL_SA is not set/);
    expect(applyPreflight({ SUPPORT_GMAIL_SA: path.join(__dirname, 'nope.json') }, 'fsa_agent').join())
      .toMatch(/not readable/);
  });
  it('requires EMAIL_REDIRECT_TO off production', () => {
    expect(applyPreflight({ SUPPORT_GMAIL_SA: readable }, 'fsa_agent_scratch').join())
      .toMatch(/EMAIL_REDIRECT_TO/);
    expect(applyPreflight({ SUPPORT_GMAIL_SA: readable, EMAIL_REDIRECT_TO: 'r@x.com' }, 'fsa_agent_scratch'))
      .toEqual([]);
  });
});
