-- fsa-agent database schema

-- Lessons table
CREATE TABLE IF NOT EXISTS lessons (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    video_transcript TEXT,
    summary TEXT,
    key_points JSONB,
    practice_questions JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User progress table
CREATE TABLE IF NOT EXISTS user_progress (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    lesson_id INTEGER REFERENCES lessons(id),
    score INTEGER DEFAULT 0,
    struggles TEXT,
    attempts INTEGER DEFAULT 0,
    complexity_level VARCHAR(50) DEFAULT 'medium',
    completed BOOLEAN DEFAULT FALSE,
    last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chat history table
CREATE TABLE IF NOT EXISTS chat_history (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    lesson_id INTEGER REFERENCES lessons(id),
    messages JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_progress_email ON user_progress(user_email);
CREATE INDEX IF NOT EXISTS idx_user_progress_lesson ON user_progress(lesson_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_email ON chat_history(user_email);
CREATE INDEX IF NOT EXISTS idx_chat_history_lesson ON chat_history(lesson_id);

-- Insert sample lesson
INSERT INTO lessons (title, video_transcript, summary, key_points, practice_questions)
VALUES (
    'Introduction to Power Engineering',
    'Welcome to the Power Engineering course...',
    'This course covers the fundamentals of power engineering for Canadian certification.',
    '["Power systems basics", "Electrical generation", "Transmission and distribution"]',
    '[{"question": "What is the primary role of a power engineer?", "options": ["Generate power", "Maintain power systems", "Design power plants", "All of the above"], "answer": 3}]'
);