-- fsa-agent database schema v2

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Lessons table
CREATE TABLE IF NOT EXISTS lessons (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    video_transcript TEXT,
    summary TEXT,
    narration_text TEXT,       -- Concatenated narration scripts per slide, in order (displayed on transcript tab)
    source_content TEXT,       -- Full original source content used to create slides; includes LaTeX (tutor reference)
    key_points JSONB,          -- Array of {title, content} — one entry per slide body
    practice_questions JSONB,  -- Legacy; new questions use the questions table
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Questions table (dedicated, replaces lessons.practice_questions for runtime use)
CREATE TABLE IF NOT EXISTS questions (
    id             SERIAL PRIMARY KEY,
    lesson_id      INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
    chapter_id     VARCHAR(50),
    course_id      VARCHAR(50),
    question_text  TEXT NOT NULL,
    options        JSONB NOT NULL,             -- Array of option strings
    correct_answer INTEGER NOT NULL,           -- Index into options array (0-based)
    explanation    TEXT,
    difficulty     INTEGER NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
    topic          VARCHAR(100),
    question_type  VARCHAR(30) NOT NULL DEFAULT 'objective_practice'
                     CHECK (question_type IN ('objective_practice', 'chapter_quiz')),
    step_data      JSONB,                      -- For staged multi-step problems
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Lesson chunks table (one row per slide — used for focused retrieval by researcher)
CREATE TABLE IF NOT EXISTS lesson_chunks (
    id             SERIAL PRIMARY KEY,
    lesson_code    VARCHAR(20) NOT NULL,
    slide_number   INTEGER NOT NULL,
    chunk_type     VARCHAR(30),
    title          TEXT,
    body           TEXT,       -- slide display text
    narration      TEXT,       -- narration script for this slide
    source_content TEXT,       -- full LaTeX source content for this slide
    CONSTRAINT uq_lesson_chunk UNIQUE (lesson_code, slide_number)
);

CREATE INDEX IF NOT EXISTS idx_chunks_lesson ON lesson_chunks(lesson_code);
CREATE INDEX IF NOT EXISTS idx_chunks_type   ON lesson_chunks(lesson_code, chunk_type);
CREATE INDEX IF NOT EXISTS idx_chunks_fts    ON lesson_chunks
    USING gin(to_tsvector('english',
        coalesce(title,'') || ' ' || coalesce(body,'') || ' ' || coalesce(narration,'')));

-- User progress table
CREATE TABLE IF NOT EXISTS user_progress (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    lesson_id INTEGER REFERENCES lessons(id),
    score INTEGER DEFAULT 0,
    struggles JSONB DEFAULT '[]',              -- Array of topic strings
    attempts JSONB DEFAULT '{}',               -- {question_id: {count, correct, last_answer}}
    complexity_level INTEGER DEFAULT 3,        -- 1-5 numeric scale
    understanding_level VARCHAR(50) DEFAULT 'good',
    current_section INTEGER DEFAULT 0,
    outcome VARCHAR(20) CHECK (outcome IN ('completed', 'skipped', 'struggled', 'strong') OR outcome IS NULL),
    session_notes TEXT,
    completed BOOLEAN DEFAULT FALSE,
    last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_lesson UNIQUE (user_email, lesson_id)
);

-- Chat history table
CREATE TABLE IF NOT EXISTS chat_history (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    lesson_id INTEGER REFERENCES lessons(id),
    messages JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email             ON users(email);
CREATE INDEX IF NOT EXISTS idx_user_progress_email     ON user_progress(user_email);
CREATE INDEX IF NOT EXISTS idx_user_progress_lesson    ON user_progress(lesson_id);
CREATE INDEX IF NOT EXISTS idx_user_progress_composite ON user_progress(user_email, lesson_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_email      ON chat_history(user_email);
CREATE INDEX IF NOT EXISTS idx_chat_history_lesson     ON chat_history(lesson_id);
CREATE INDEX IF NOT EXISTS idx_questions_lesson        ON questions(lesson_id);
CREATE INDEX IF NOT EXISTS idx_questions_chapter       ON questions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_questions_type          ON questions(question_type);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty    ON questions(difficulty);

-- ============================================================
-- Sample data
-- ============================================================

INSERT INTO users (email, first_name) VALUES
    ('test@example.com', 'John'),
    ('student@learn.ca', 'Sarah')
ON CONFLICT (email) DO NOTHING;

INSERT INTO lessons (title, summary, narration_text, key_points, practice_questions)
VALUES (
    '2A1 Chapter 1 Objective 1: Thickness and Pressure Limits',
    'Learn to calculate minimum required wall thickness and maximum allowable working pressure for cylindrical pressure components using ASME code formulas.',
    'Section Heading: Thickness and Pressure Limits

In boiler and pressure piping work, two closely linked questions come up over and over: (1) how thick does a cylindrical component have to be to safely contain the pressure, and (2) for a given wall thickness, what is the highest pressure you are allowed to operate at.

The objective here is to relate design pressure to required minimum wall thickness, or to relate a known thickness back to the maximum allowable working pressure. In practice, this is how an engineer or inspector confirms that a selected pipe or tube schedule is adequate, or how a plant determines the pressure limit for an older component after thickness loss from corrosion or erosion.

Section Heading: Shell Thickness Pressure Limits

Equation (1.1): t = PD/(2S + P) + 0.005D + e

Equation (1.1) is used when you know the intended working pressure (P), the size (D), and the allowable material strength term (S), and you need the minimum required wall thickness (t).

Equation (1.2): P = S[(2t - 0.01D - 2e)/(D - (t - 0.005D - e))]

Equation (1.2) rearranges the same relationship to solve for maximum allowable working pressure (P) when the available thickness (t) is known.',
    '[
        {"title": "Thickness Formula", "content": "Equation 1.1: $t = \\frac{PD}{2S + P} + 0.005D + e$ — use when you know P and need minimum wall thickness t"},
        {"title": "Pressure Formula", "content": "Equation 1.2: $P = S\\left[\\frac{2t - 0.01D - 2e}{D - (t - 0.005D - e)}\\right]$ — use when you know t and need maximum allowable working pressure"},
        {"title": "Key Variables", "content": "P = design pressure (MPa), D = outside diameter (mm), S = allowable stress (MPa), t = wall thickness (mm), e = joint efficiency factor"}
    ]',
    '[]'
)
ON CONFLICT DO NOTHING;

-- Seed questions for lesson 1 into the dedicated questions table
INSERT INTO questions (lesson_id, chapter_id, course_id, question_text, options, correct_answer, difficulty, topic, question_type)
VALUES
    (1, '1', '2A1',
     'What is the primary purpose of the 0.005D term in the thickness formula $t = PD/(2S+P) + 0.005D + e$?',
     '["Manufacturing tolerance allowance", "Corrosion allowance", "Safety factor multiplier", "Weld joint efficiency"]',
     0, 1, 'thickness_formula', 'objective_practice'),

    (1, '1', '2A1',
     'For cylindrical tubes, what is the maximum outside diameter covered by equations 1.1 and 1.2?',
     '["70 mm", "127 mm", "100 mm", "150 mm"]',
     1, 1, 'scope', 'objective_practice'),

    (1, '1', '2A1',
     'If the allowable stress S increases while P and D remain constant, what happens to the required wall thickness t?',
     '["Thickness increases", "Thickness decreases", "Thickness stays the same", "Thickness doubles"]',
     1, 2, 'stress_relationship', 'objective_practice'),

    (1, '1', '2A1',
     'You are checking an existing tube with known wall thickness. Which equation do you use to find its maximum allowable working pressure?',
     '["Equation 1.1 — solve for t", "Equation 1.2 — solve for P", "Either equation gives the same result", "Neither — you need a different code section"]',
     1, 2, 'equation_selection', 'objective_practice'),

    (1, '1', '2A1',
     'In equation 1.1, what does increasing the design pressure P do to the required wall thickness t (assuming D and S stay constant)?',
     '["Required thickness decreases", "Required thickness increases", "No effect on thickness", "Thickness becomes negative"]',
     1, 1, 'pressure_relationship', 'objective_practice')
ON CONFLICT DO NOTHING;
