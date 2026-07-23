const { PAPERS_BY_CLASS } = require('../src/config/papersForClass');

describe('PAPERS_BY_CLASS config', () => {
  it('lists all six 2nd Class papers', () => {
    expect(PAPERS_BY_CLASS.second).toEqual(['2A1', '2A2', '2A3', '2B1', '2B2', '2B3']);
  });

  it('lists all four 3rd Class papers', () => {
    expect(PAPERS_BY_CLASS.third).toEqual(['3A1', '3A2', '3B1', '3B2']);
  });

  it('lists the 4A paper for fourth_a', () => {
    expect(PAPERS_BY_CLASS.fourth_a).toEqual(['4A']);
  });

  it('lists the 4B paper for fourth_b', () => {
    expect(PAPERS_BY_CLASS.fourth_b).toEqual(['4B']);
  });
});
