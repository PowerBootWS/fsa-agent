"""
Database inserter for FSA lesson content import.

Handles upserts to the lessons and questions tables.
Uses the same environment variables as the ai-service.
"""

import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor


def get_connection():
    return psycopg2.connect(
        host=os.getenv('POSTGRES_HOST', 'localhost'),
        port=os.getenv('POSTGRES_PORT', '5432'),
        database=os.getenv('POSTGRES_DB', 'fsa_agent'),
        user=os.getenv('POSTGRES_USER', 'postgres'),
        password=os.getenv('POSTGRES_PASSWORD'),
        cursor_factory=RealDictCursor,
    )


def upsert_lesson(lesson_code, title, key_points, narration_text=None, dry_run=False):
    """
    Update (or insert) a lesson row identified by lesson_code.

    Args:
        lesson_code: e.g. '2A1-1-1'
        title: lesson title string
        key_points: list of {title, content} dicts
        narration_text: optional narration text (skip if None)
        dry_run: if True, print SQL instead of executing

    Returns:
        integer lesson id, or None on dry_run
    """
    safe_key_points = json.dumps(key_points)
    if dry_run:
        print(f'[DRY RUN] upsert_lesson: lesson_code={lesson_code!r} title={title!r}')
        print(f'  key_points ({len(key_points)} items): {safe_key_points[:200]}...')
        if narration_text:
            print(f'  narration_text ({len(narration_text)} chars): {narration_text[:100]}...')
        return None

    conn = get_connection()
    try:
        cur = conn.cursor()

        if narration_text is not None:
            cur.execute(
                """
                INSERT INTO lessons (lesson_code, title, key_points, narration_text)
                VALUES (%s, %s, %s::jsonb, %s)
                ON CONFLICT (lesson_code) DO UPDATE SET
                    title          = EXCLUDED.title,
                    key_points     = EXCLUDED.key_points,
                    narration_text = EXCLUDED.narration_text
                RETURNING id
                """,
                (lesson_code, title, safe_key_points, narration_text)
            )
        else:
            cur.execute(
                """
                INSERT INTO lessons (lesson_code, title, key_points)
                VALUES (%s, %s, %s::jsonb)
                ON CONFLICT (lesson_code) DO UPDATE SET
                    title      = EXCLUDED.title,
                    key_points = EXCLUDED.key_points
                RETURNING id
                """,
                (lesson_code, title, safe_key_points)
            )

        row = cur.fetchone()
        conn.commit()
        return row['id']
    finally:
        conn.close()


def insert_worked_problem(lesson_code, chapter_id, course_id, worked_problem, dry_run=False):
    """
    Insert a worked problem as a question row with step_data JSONB.

    Skips insert if a question with the same lesson_code and question_text already exists.

    Args:
        lesson_code: e.g. '2A1-1-1'
        chapter_id: e.g. '2A1-1'
        course_id: e.g. '2A1'
        worked_problem: dict from gdrive_parser._build_step_data()
        dry_run: if True, print SQL instead of executing

    Returns:
        integer question id, or None on dry_run / skip
    """
    question_text = worked_problem.get('question_text', '')
    step_data = worked_problem.get('step_data', {})
    problem_title = worked_problem.get('problem_title', 'Worked Problem')
    step_count = len(step_data.get('steps', []))

    safe_step_data = json.dumps(step_data)
    # Worked problems have no single correct_answer (they're multi-step)
    # We use -1 as a sentinel to indicate "evaluated by LLM"
    correct_answer = -1
    difficulty = 3  # default; can be tuned later

    if dry_run:
        print(f'[DRY RUN] insert_worked_problem: lesson_code={lesson_code!r}')
        print(f'  problem_title={problem_title!r}')
        print(f'  question_text={question_text[:120]!r}')
        print(f'  step_count={step_count}')
        print(f'  step_data={safe_step_data[:300]}...')
        return None

    # Resolve lesson_id from lesson_code
    conn = get_connection()
    try:
        cur = conn.cursor()

        cur.execute('SELECT id FROM lessons WHERE lesson_code = %s', (lesson_code,))
        row = cur.fetchone()
        if not row:
            print(f'WARNING: lesson_code {lesson_code!r} not found in DB — skipping question insert')
            return None
        lesson_id = row['id']

        # Check for duplicate
        cur.execute(
            'SELECT id FROM questions WHERE lesson_code = %s AND question_text = %s',
            (lesson_code, question_text)
        )
        existing = cur.fetchone()
        if existing:
            print(f'  Skipping duplicate question for lesson {lesson_code}: {question_text[:60]!r}')
            return existing['id']

        cur.execute(
            """
            INSERT INTO questions
                (lesson_id, lesson_code, chapter_id, course_id,
                 question_text, options, correct_answer, explanation,
                 difficulty, topic, question_type, step_data)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s::jsonb)
            RETURNING id
            """,
            (
                lesson_id, lesson_code, chapter_id, course_id,
                question_text,
                json.dumps([]),   # options: empty for multi-step problems
                correct_answer,
                None,             # explanation: generated by tutor LLM
                difficulty,
                problem_title,    # topic = problem title
                'objective_practice',
                safe_step_data,
            )
        )
        new_row = cur.fetchone()
        conn.commit()
        return new_row['id']
    finally:
        conn.close()


def insert_question(lesson_code, chapter_id, course_id, q, dry_run=False):
    """
    Insert a single AI-generated MCQ into the questions table.

    Skips if a question with the same lesson_code and question_text already exists.

    Args:
        lesson_code: e.g. '2A1-1-1'
        chapter_id:  e.g. '2A1-1'
        course_id:   e.g. '2A1'
        q: dict with keys:
            question_text   str
            options         list[str]  (4 items)
            correct_answer  int        (0-based index)
            explanation     str
            difficulty      int        (1-5)
            topic           str
            question_type   str        ('objective_practice' or 'chapter_quiz')
        dry_run: if True, print instead of executing

    Returns:
        integer question id, or None on dry_run / skip
    """
    question_text = q.get('question_text', '').strip()
    options = q.get('options', [])
    correct_answer = int(q.get('correct_answer', 0))
    explanation = q.get('explanation', '')
    difficulty = int(q.get('difficulty', 3))
    topic = q.get('topic', '')
    question_type = q.get('question_type', 'objective_practice')

    if dry_run:
        print(f'[DRY RUN] insert_question: lesson_code={lesson_code!r} type={question_type!r} difficulty={difficulty}')
        print(f'  Q: {question_text[:120]!r}')
        for i, opt in enumerate(options):
            marker = '*' if i == correct_answer else ' '
            print(f'  {marker} {i}: {opt[:80]!r}')
        if explanation:
            print(f'  Explanation: {explanation[:100]!r}')
        return None

    conn = get_connection()
    try:
        cur = conn.cursor()

        # Resolve lesson_id — lesson row must exist before inserting questions
        cur.execute('SELECT id FROM lessons WHERE lesson_code = %s', (lesson_code,))
        row = cur.fetchone()
        if not row:
            print(f'WARNING: lesson_code {lesson_code!r} not found in lessons table — skipping')
            return None
        lesson_id = row['id']

        # Deduplicate by question_text
        cur.execute(
            'SELECT id FROM questions WHERE lesson_code = %s AND question_text = %s',
            (lesson_code, question_text)
        )
        existing = cur.fetchone()
        if existing:
            return existing['id']

        cur.execute(
            """
            INSERT INTO questions
                (lesson_id, lesson_code, chapter_id, course_id,
                 question_text, options, correct_answer, explanation,
                 difficulty, topic, question_type)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                lesson_id, lesson_code, chapter_id, course_id,
                question_text,
                json.dumps(options),
                correct_answer,
                explanation,
                difficulty,
                topic,
                question_type,
            )
        )
        new_row = cur.fetchone()
        conn.commit()
        return new_row['id']
    finally:
        conn.close()


def get_question_count(lesson_code):
    """Return current question count for a lesson_code."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute('SELECT COUNT(*) AS cnt FROM questions WHERE lesson_code = %s', (lesson_code,))
        row = cur.fetchone()
        return row['cnt'] if row else 0
    finally:
        conn.close()
