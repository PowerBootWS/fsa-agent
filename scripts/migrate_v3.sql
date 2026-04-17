-- FSA Agent Schema Migration v3
-- Fixes: user_progress types, adds lesson_code column, seeds real lesson and questions
-- Run against fsa-postgres container: docker exec fsa-postgres psql -U postgres -d fsa_agent -f /tmp/migrate_v3.sql

-- ============================================================
-- Step 1: Fix user_progress column types (schema was not fully migrated)
-- ============================================================

-- Fix attempts: INTEGER -> JSONB
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='user_progress' AND column_name='attempts' AND data_type='integer'
  ) THEN
    ALTER TABLE user_progress
      ALTER COLUMN attempts TYPE JSONB USING
        CASE
          WHEN attempts IS NULL OR attempts = 0 THEN '{}'::jsonb
          ELSE jsonb_build_object('legacy_count', attempts)
        END;
  END IF;
END $$;

-- Fix complexity_level: VARCHAR -> INTEGER
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='user_progress' AND column_name='complexity_level' AND data_type='character varying'
  ) THEN
    ALTER TABLE user_progress
      ALTER COLUMN complexity_level TYPE INTEGER USING
        CASE complexity_level
          WHEN 'easy'   THEN 1
          WHEN 'medium' THEN 3
          WHEN 'hard'   THEN 5
          ELSE 3
        END;
    ALTER TABLE user_progress ALTER COLUMN complexity_level SET DEFAULT 3;
  END IF;
END $$;

-- Ensure struggles is JSONB (may already be correct)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='user_progress' AND column_name='struggles' AND data_type='text'
  ) THEN
    ALTER TABLE user_progress
      ALTER COLUMN struggles TYPE JSONB USING
        CASE
          WHEN struggles IS NULL OR struggles = '' THEN '[]'::jsonb
          ELSE to_jsonb(string_to_array(struggles, ','))
        END;
  END IF;
END $$;

-- Add understanding_level and current_section if missing
ALTER TABLE user_progress
  ADD COLUMN IF NOT EXISTS understanding_level VARCHAR(50) DEFAULT 'good',
  ADD COLUMN IF NOT EXISTS current_section INTEGER DEFAULT 0;

-- ============================================================
-- Step 2: Add lesson_code column to lessons table
-- Format: {course}-{chapter}-{objective}  e.g. '2A1-1-1'
-- This is the string sent via iframe query param as lessonId
-- ============================================================

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS lesson_code VARCHAR(20) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_lessons_code ON lessons(lesson_code);

-- ============================================================
-- Step 3: Add lesson_code and chapter references to questions and user_progress
-- ============================================================

ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS lesson_code VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_questions_code ON questions(lesson_code);

-- Add lesson_code to user_progress for query convenience
ALTER TABLE user_progress
  ADD COLUMN IF NOT EXISTS lesson_code VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_user_progress_code ON user_progress(lesson_code);

-- ============================================================
-- Step 4: Replace placeholder lesson with real lesson 2A1-1-1
-- ============================================================

-- Remove the placeholder lesson and its dependencies first
DELETE FROM questions WHERE lesson_id = 1;
DELETE FROM user_progress WHERE lesson_id = 1;
DELETE FROM chat_history WHERE lesson_id = 1;
DELETE FROM lessons WHERE id = 1;

-- Reset the sequence so id=1 gets reused cleanly
SELECT setval('lessons_id_seq', 1, false);

-- Insert the real first lesson
INSERT INTO lessons (id, lesson_code, title, summary, narration_text, key_points, practice_questions)
VALUES (
  1,
  '2A1-1-1',
  '2A1 Chapter 1 Objective 1: Thickness and Pressure Limits',
  'Calculate minimum required wall thickness and maximum allowable working pressure for cylindrical pressure components (tubes, pipes, drums) using ASME Section I and VIII code formulas.',
  -- narration_text will be populated via n8n workflow; placeholder provided here
  'Section Heading: Thickness and Pressure Limits

In boiler and pressure piping work, two closely linked questions come up over and over: (1) how thick does a cylindrical component have to be to safely contain the pressure, and (2) for a given wall thickness, what is the highest pressure you are allowed to operate at.

The objective here is to relate design pressure to required minimum wall thickness, or to relate a known thickness back to the maximum allowable working pressure. In practice, this is how an engineer or inspector confirms that a selected pipe or tube schedule is adequate, or how a plant determines the pressure limit for an older component after thickness loss from corrosion or erosion.

The scope is specifically ferrous (steel) tubing and similar cylindrical components up to and including 127 mm outside diameter.

Section Heading: Shell Thickness Pressure Limits

Equation (1.1): t = PD/(2S + P) + 0.005D + e

Equation (1.1) is used when you know the intended working pressure (P), the size (D), and the allowable material strength term (S), and you need the minimum required wall thickness (t). The main fraction represents the pressure loading that must be resisted by the metal.

Equation (1.2): P = S[(2t - 0.01D - 2e)/(D - (t - 0.005D - e))]

Equation (1.2) rearranges the same relationship to solve for maximum allowable working pressure (P) when the available thickness (t) is known. This is used during fitness-for-service checks when inspections find wall thinning.

Section Heading: Thin Cylinder Pressure Formulas

For ASME Section VIII cylinders where t < 0.5R or P < 0.385SE:
Circumferential stress (hoop): t = PR/(SE - 0.6P) or P = SEt/(R + 0.6t)
Longitudinal stress (axial): t = PR/(2SE - 0.4P) or P = 2SEt/(R + 0.4t)

Section Heading: Thick Wall Pressure Design

When t > 0.5R or P > 0.385SE, use thick-wall formulas:
t = R(Z^0.5 - 1) where Z = (SE + P)/(SE - P)',

  '[
    {"title": "Equation 1.1 — Minimum Wall Thickness", "content": "$$t = \\frac{PD}{2S + P} + 0.005D + e$$\nUse when P and D are known; solve for required thickness t. Valid for cylindrical components up to 127 mm O.D. (ASME Section I)."},
    {"title": "Equation 1.2 — Maximum Allowable Working Pressure", "content": "$$P = S\\left[\\frac{2t - 0.01D - 2e}{D - (t - 0.005D - e)}\\right]$$\nUse when t is known from inspection; solve for MAWP. Applies to same size range as Eq. 1.1."},
    {"title": "Key Variables", "content": "$P$ = design pressure (MPa) · $D$ = outside diameter (mm) · $S$ = allowable stress at design temperature (MPa) · $t$ = wall thickness (mm) · $e$ = joint efficiency factor (0 for strength-welded)"},
    {"title": "Thin vs. Thick Wall Selection", "content": "Thin-wall (Eq. 1.3–1.6): use when $t < 0.5R$ or $P < 0.385SE$\nThick-wall (Eq. 1.7–1.10): required when $t > 0.5R$ or $P > 0.385SE$"}
  ]',
  '[]'
)
ON CONFLICT (id) DO UPDATE SET
  lesson_code = EXCLUDED.lesson_code,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  narration_text = EXCLUDED.narration_text,
  key_points = EXCLUDED.key_points;

-- Reset sequence past 1
SELECT setval('lessons_id_seq', 1, true);

-- ============================================================
-- Step 5: Seed questions for lesson 2A1-1-1
-- ============================================================

INSERT INTO questions (lesson_id, lesson_code, chapter_id, course_id, question_text, options, correct_answer, explanation, difficulty, topic, question_type)
VALUES

-- Objective practice questions (max 2 shown per session)
(1, '2A1-1-1', '2A1-1', '2A1',
 'The 0.005D term in Equation 1.1 accounts for which of the following?',
 '["Manufacturing tolerance allowance", "Corrosion allowance for service life", "Safety factor applied to material stress", "Weld joint efficiency reduction"]',
 0,
 'The 0.005D term is a manufacturing tolerance — it adds a fixed fraction of the diameter on top of the basic pressure-resisting thickness to ensure the delivered tube consistently meets or exceeds the minimum wall.',
 1, 'thickness_formula', 'objective_practice'),

(1, '2A1-1-1', '2A1-1', '2A1',
 'Which equation do you use to find the maximum allowable working pressure of a tube with a known wall thickness?',
 '["Equation 1.1 — it gives you t, which you then convert", "Equation 1.2 — it solves directly for P given t", "Either equation gives the same result", "You need a separate ASME table for MAWP"]',
 1,
 'Equation 1.2 is the rearrangement of Equation 1.1 that solves for P directly. It is the standard approach for fitness-for-service checks where you measure remaining wall thickness and need to determine the safe operating pressure.',
 1, 'equation_selection', 'objective_practice'),

(1, '2A1-1-1', '2A1-1', '2A1',
 'If the allowable stress S increases while P and D remain constant, what happens to the required minimum wall thickness t in Equation 1.1?',
 '["Required thickness increases — higher stress means more material needed", "Required thickness decreases — a stronger material can carry more stress with less metal", "Required thickness is unchanged — S does not appear in the thickness term", "Required thickness doubles"]',
 1,
 'A higher allowable stress S means the material can safely carry more load per unit area. With P and D fixed, the denominator (2S + P) increases while the numerator (PD) stays constant, so the fraction decreases — meaning less thickness is required.',
 2, 'stress_relationship', 'objective_practice'),

(1, '2A1-1-1', '2A1-1', '2A1',
 'A tube has an outside diameter of 70 mm and a design pressure of 4 MPa. The allowable stress at operating temperature is 88.3 MPa and the tube is strength-welded (e = 0). Which formula applies?',
 '["Equation 1.2, because P > 4 MPa", "Equation 1.1, because the tube O.D. is within the 127 mm scope limit", "Equation 1.3 (thin-wall circumferential), because the pressure is below 0.385SE", "Equation 1.7 (thick-wall), because the tube is small diameter"]',
 1,
 'Equation 1.1 applies to cylindrical components up to and including 127 mm O.D. under ASME Section I. At 70 mm O.D., this tube is within scope. Equation 1.3 applies to ASME Section VIII vessels, not Section I boiler tubing.',
 2, 'equation_selection', 'objective_practice'),

(1, '2A1-1-1', '2A1-1', '2A1',
 'When checking whether to use the thin-wall or thick-wall formula for an ASME Section VIII vessel, which condition triggers the thick-wall equations?',
 '["t < 0.5R or P < 0.385SE", "t > 0.5R or P > 0.385SE", "t > 10 mm regardless of radius", "P > 690 kPa gauge"]',
 1,
 'The thick-wall equations (1.7–1.10) must be used when t > 0.5R (wall is large compared to radius) or P > 0.385SE. Below these limits, the thin-wall equations (1.3–1.6) give accurate results.',
 2, 'thin_vs_thick', 'objective_practice'),

-- Chapter quiz questions (drawn at end of chapter, with other objectives mixed in)
(1, '2A1-1-1', '2A1-1', '2A1',
 'A superheater tube is 75 mm O.D. with a minimum wall thickness of 4.75 mm. It is strength-welded (e = 0) and operates at 400°C with an allowable stress of 102 MPa. What is the approximate MAWP?',
 '["8,750 kPa", "12,640 kPa", "15,200 kPa", "10,200 kPa"]',
 1,
 'Using Equation 1.2: P = 102 × [(2×4.75 − 0.01×75 − 0)/(75 − (4.75 − 0.005×75 − 0))] = 102 × [8.75/70.625] = 12.64 MPa = 12,640 kPa.',
 3, 'mawp_calculation', 'chapter_quiz'),

(1, '2A1-1-1', '2A1-1', '2A1',
 'A boiler tube (SA-192 carbon steel) is 70 mm O.D. at 350°C with MAWP = 4000 kPa and S = 88.3 MPa. The tube is strength-welded. What is the minimum required wall thickness?',
 '["1.2 mm", "1.9 mm", "2.5 mm", "3.1 mm"]',
 1,
 'Using Equation 1.1: t = (4 × 70)/(2×88.3 + 4) + 0.005×70 + 0 = 280/180.6 + 0.35 = 1.55 + 0.35 = 1.9 mm.',
 3, 'thickness_calculation', 'chapter_quiz'),

(1, '2A1-1-1', '2A1-1', '2A1',
 'A vertical boiler shell (SA-515-60) has an inside diameter of 2440 mm, design pressure 690 kPa at 230°C, corrosion allowance 3 mm, joint efficiency 0.85, and allowable stress 138 MPa. What is the required shell thickness?',
 '["7.2 mm", "10.2 mm", "13.5 mm", "8.8 mm"]',
 1,
 'First confirm thin-wall applies: 0.385SE = 45.16 MPa > 0.69 MPa. Use Eq. 1.3 with corroded radius 1223 mm: t = (0.69 × 1223)/(138×0.85 − 0.6×0.69) + 3 = 843.87/116.886 + 3 = 7.22 + 3 = 10.22 mm.',
 4, 'shell_thickness', 'chapter_quiz')

ON CONFLICT DO NOTHING;

-- ============================================================
-- Step 6: Add unique constraint to user_progress (required for ON CONFLICT upsert)
-- ============================================================

ALTER TABLE user_progress
  ADD CONSTRAINT IF NOT EXISTS uq_user_progress_user_lesson UNIQUE (user_email, lesson_id);

-- Add lesson_code column to lessons table if not present
ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS lesson_code VARCHAR(20) UNIQUE;

-- ============================================================
-- Verification
-- ============================================================
SELECT lesson_code, title FROM lessons ORDER BY lesson_code;
SELECT COUNT(*) AS total_questions, question_type FROM questions GROUP BY question_type;
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'user_progress' AND column_name IN ('attempts','struggles','complexity_level')
  ORDER BY column_name;
