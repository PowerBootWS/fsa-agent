/** Per-user feature switches (lesson tutor redesign, slice 4). */
const { featuresFor } = require('../src/config/features');

const saved = process.env.TUTOR_V2_EMAILS;
afterEach(() => {
  if (saved === undefined) delete process.env.TUTOR_V2_EMAILS;
  else process.env.TUTOR_V2_EMAILS = saved;
});

describe('featuresFor', () => {
  it('is off for everyone when the list is unset or empty', () => {
    delete process.env.TUTOR_V2_EMAILS;
    expect(featuresFor('russ@fullsteamahead.ca').tutor_v2).toBe(false);
    process.env.TUTOR_V2_EMAILS = ' , ';
    expect(featuresFor('russ@fullsteamahead.ca').tutor_v2).toBe(false);
  });

  it('turns on for listed emails only, ignoring case and spaces', () => {
    process.env.TUTOR_V2_EMAILS = 'Russ@FullSteamAhead.ca, a@b.ca';
    expect(featuresFor(' russ@fullsteamahead.ca ').tutor_v2).toBe(true);
    expect(featuresFor('other@b.ca').tutor_v2).toBe(false);
    expect(featuresFor('').tutor_v2).toBe(false);
  });

  it('turns on for everyone with *', () => {
    process.env.TUTOR_V2_EMAILS = '*';
    expect(featuresFor('anyone@example.com').tutor_v2).toBe(true);
  });
});
