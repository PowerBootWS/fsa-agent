// Papers offered per class_code. Single source of truth for both the authenticated
// paper-picker (routes/platform.js) and the unauthenticated diagnostic-quiz sampler
// (routes/diagnostic.js), which previously duplicated the second/third arrays
// independently.
const PAPERS_BY_CLASS = {
  second: ['2A1', '2A2', '2A3', '2B1', '2B2', '2B3'],
  third: ['3A1', '3A2', '3B1', '3B2'],
  fourth: ['4A', '4B'],
};

module.exports = { PAPERS_BY_CLASS };
