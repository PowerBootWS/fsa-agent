const express = require('express');
const router = express.Router();
const db = require('../services/database');

// Detect mode from lessonId — mirrors validate.js logic
function detectMode(id) {
  if (/^[A-Z0-9]{2,5}-\d{1,3}-\d{1,3}$/i.test(id) || /^\d+$/.test(id) || /^[0-9a-f-]{36}$/i.test(id)) return 'lesson';
  if (/^[A-Z0-9]{2,5}-\d{1,3}$/i.test(id)) return 'chapter_quiz';
  if (/^[A-Z0-9]{2,5}$/i.test(id)) return 'practice_exam';
  return 'lesson';
}

// Get lesson data by ID (returns synthetic context for quiz/exam modes)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const mode = detectMode(id);

    if (mode === 'chapter_quiz') {
      // Parse paper and chapter from e.g. '2B1-1'
      const [paper, chapter] = id.split('-');
      return res.json({
        id,
        lesson_code: id,
        mode: 'chapter_quiz',
        title: `${paper} — Chapter ${chapter} Quiz`,
        summary: `End-of-chapter quiz for ${paper}, Chapter ${chapter}.`,
        narration_text: '',
        key_points: [],
        practice_questions: [],
        video_transcript: '',
        paper,
        chapter,
      });
    }

    if (mode === 'practice_exam') {
      return res.json({
        id,
        lesson_code: id,
        mode: 'practice_exam',
        title: `${id} Practice Exam`,
        summary: `Adaptive practice exam for ${id}.`,
        narration_text: '',
        key_points: [],
        practice_questions: [],
        video_transcript: '',
        paper: id,
      });
    }

    const lesson = await db.getLesson(id);
    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    res.json({ ...lesson, mode: 'lesson' });
  } catch (error) {
    console.error('Error fetching lesson:', error);
    res.status(500).json({ error: 'Failed to fetch lesson' });
  }
});

// Get ordered lesson chunks for transcript view
router.get('/:id/chunks', async (req, res) => {
  try {
    const { id } = req.params;
    const chunks = await db.getLessonChunks(id);
    res.json(chunks);
  } catch (error) {
    console.error('Error fetching lesson chunks:', error);
    res.status(500).json({ error: 'Failed to fetch lesson chunks' });
  }
});

module.exports = router;