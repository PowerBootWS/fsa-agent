const axios = require('axios');

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://ai-service:5000';

// Thin wrapper around the ai-service HTTP call so route tests can jest.mock this module
// directly instead of needing to intercept outbound HTTP.
async function requestTailoredDocuments(payload) {
  const response = await axios.post(`${PYTHON_SERVICE_URL}/agent/resume-tailor`, payload, {
    timeout: 90000,
  });
  return response.data;
}

module.exports = { requestTailoredDocuments };
