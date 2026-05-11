-- audit_standalone.sql
-- Finds questions with lesson-referencing language that may not be stand-alone.
-- Run against fsa-postgres container:
--   docker exec fsa-postgres psql -U postgres -d fsa_agent -f /tmp/audit_standalone.sql

-- ============================================================
-- Primary patterns: definite lesson-referencing language
-- ============================================================

SELECT 'PRIMARY: lesson references' AS category,
       id, lesson_code, course_id, question_type, standalone,
       question_text
FROM questions
WHERE question_text ILIKE '%in the lesson%'
   OR question_text ILIKE '%in this lesson%'
   OR question_text ILIKE '%the lesson explains%'
   OR question_text ILIKE '%the lesson describes%'
   OR question_text ILIKE '%the lesson states%'
   OR question_text ILIKE '%the lesson covers%'
   OR question_text ILIKE '%the lesson teaches%'
   OR question_text ILIKE '%according to the lesson%'
   OR question_text ILIKE '%as discussed in the lesson%'
   OR question_text ILIKE '%as shown in the lesson%'
   OR question_text ILIKE '%from the lesson%'
   OR question_text ILIKE '%based on the lesson%'
   OR question_text ILIKE '%in the video%'
   OR question_text ILIKE '%in the lecture%'
   OR question_text ILIKE '%this objective%'
   OR question_text ILIKE '%the previous objective%'
   OR question_text ILIKE '%the previous lesson%'
   OR question_text ILIKE '%in the transcript%'
ORDER BY course_id, lesson_code, id;

-- ============================================================
-- Secondary: equation references (may be OK with context)
-- ============================================================

SELECT 'SECONDARY: equation references' AS category,
       id, lesson_code, course_id, question_type, standalone,
       question_text
FROM questions
WHERE question_text ~* 'equation\s+\d+\.\d+'
ORDER BY course_id, lesson_code, id;

-- ============================================================
-- Summary counts
-- ============================================================

SELECT 'Total questions' AS metric, COUNT(*)::text AS value FROM questions
UNION ALL
SELECT '  standalone = TRUE', COUNT(*)::text FROM questions WHERE standalone = TRUE
UNION ALL
SELECT '  standalone = FALSE', COUNT(*)::text FROM questions WHERE standalone = FALSE
UNION ALL
SELECT '  lesson references found', COUNT(*)::text FROM questions WHERE
   question_text ILIKE '%in the lesson%'
   OR question_text ILIKE '%in this lesson%'
   OR question_text ILIKE '%the lesson explains%'
   OR question_text ILIKE '%the lesson describes%'
   OR question_text ILIKE '%the lesson states%'
   OR question_text ILIKE '%the lesson covers%'
   OR question_text ILIKE '%the lesson teaches%'
   OR question_text ILIKE '%according to the lesson%'
   OR question_text ILIKE '%as discussed in the lesson%'
   OR question_text ILIKE '%as shown in the lesson%'
   OR question_text ILIKE '%from the lesson%'
   OR question_text ILIKE '%based on the lesson%'
   OR question_text ILIKE '%in the video%'
   OR question_text ILIKE '%in the lecture%'
   OR question_text ILIKE '%this objective%'
   OR question_text ILIKE '%the previous objective%'
   OR question_text ILIKE '%the previous lesson%'
   OR question_text ILIKE '%in the transcript%'
UNION ALL
SELECT '  equation references', COUNT(*)::text FROM questions
WHERE question_text ~* 'equation\s+\d+\.\d+';
