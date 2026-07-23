// Papers offered per class_code. Single source of truth for both the authenticated
// paper-picker (routes/platform.js) and the unauthenticated diagnostic-quiz sampler
// (routes/diagnostic.js), which previously duplicated the second/third arrays
// independently.
const PAPERS_BY_CLASS = {
  second: ['2A1', '2A2', '2A3', '2B1', '2B2', '2B3'],
  third: ['3A1', '3A2', '3B1', '3B2'],
  fourth_a: ['4A'],
  fourth_b: ['4B'],
};

// 4th Class is sold as two independently-purchasable papers rather than one
// combined product -- every place that used to check `class_code === 'fourth'`
// needs to recognize either of these instead of one fixed string.
const FOURTH_CLASS_CODES = ['fourth_a', 'fourth_b'];

module.exports = { PAPERS_BY_CLASS, FOURTH_CLASS_CODES };
