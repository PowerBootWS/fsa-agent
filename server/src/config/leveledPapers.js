// Papers where practice exams use the leveled engine (backlog #147). Env LEVELED_PAPERS,
// comma-separated; the ai-service reads the same variable to choose the engine.
function leveledPapers() {
  return new Set(String(process.env.LEVELED_PAPERS || '').split(',').map(s => s.trim()).filter(Boolean));
}

// 'leveled' when the paper is enabled and the student hasn't chosen the adaptive fallback.
function effectiveExamEngine(activePaper, examEngine) {
  return activePaper && leveledPapers().has(activePaper) && examEngine !== 'adaptive' ? 'leveled' : 'adaptive';
}

module.exports = { leveledPapers, effectiveExamEngine };
