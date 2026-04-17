"""
Researcher Agent - Data retrieval agent
Queries PostgreSQL for lesson content, questions, and user progress.
Also handles writing progress back to the database.
"""
import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor


class Researcher:
    def __init__(self):
        self.db_config = {
            'host': os.getenv('POSTGRES_HOST', 'localhost'),
            'port': os.getenv('POSTGRES_PORT', '5432'),
            'database': os.getenv('POSTGRES_DB', 'fsa_agent'),
            'user': os.getenv('POSTGRES_USER', 'postgres'),
            'password': os.getenv('POSTGRES_PASSWORD'),
        }

    def _get_connection(self):
        return psycopg2.connect(**self.db_config, cursor_factory=RealDictCursor)

    # ------------------------------------------------------------------
    # Lesson content
    # ------------------------------------------------------------------

    def _is_lesson_code(self, lesson_id):
        """Return True if lesson_id is a lesson_code string (e.g. '2A1-1-1'), not a numeric id."""
        return bool(lesson_id and not str(lesson_id).isdigit())

    def get_lesson_context(self, lesson_id):
        """
        Fetch lesson content from database.
        lesson_id can be a lesson_code string ('2A1-1-1') or a numeric integer id.

        Returns dict with:
        - id, lesson_code, title, summary, narration_text, key_points, practice_questions, video_transcript
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            if self._is_lesson_code(lesson_id):
                cursor.execute(
                    """
                    SELECT id, lesson_code, title, video_transcript, summary, narration_text,
                           key_points, practice_questions
                    FROM lessons WHERE lesson_code = %s
                    """,
                    (str(lesson_id),)
                )
            else:
                cursor.execute(
                    """
                    SELECT id, lesson_code, title, video_transcript, summary, narration_text,
                           key_points, practice_questions
                    FROM lessons WHERE id = %s
                    """,
                    (lesson_id,)
                )

            result = cursor.fetchone()
            cursor.close()
            conn.close()

            if not result:
                return {
                    'id': str(lesson_id), 'lesson_code': str(lesson_id),
                    'title': 'Unknown Lesson',
                    'summary': 'Lesson not found', 'narration_text': '',
                    'key_points': [], 'practice_questions': [], 'video_transcript': '',
                }

            return {
                'id': str(result['id']),
                'lesson_code': result['lesson_code'] or str(result['id']),
                'title': result['title'],
                'summary': result['summary'] or '',
                'narration_text': result['narration_text'] or '',
                'key_points': result['key_points'] or [],
                'practice_questions': result['practice_questions'] or [],
                'video_transcript': result['video_transcript'] or '',
            }

        except Exception as e:
            print(f'Researcher.get_lesson_context error: {e}')
            return {
                'id': str(lesson_id), 'title': 'Error', 'summary': 'Failed to load lesson',
                'narration_text': '', 'key_points': [], 'practice_questions': [], 'video_transcript': '',
            }

    # ------------------------------------------------------------------
    # User data
    # ------------------------------------------------------------------

    def get_user_by_email(self, email):
        """
        Fetch user first name by email.
        Falls back to deriving a name from the email address if user not found.
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute('SELECT first_name, email FROM users WHERE email = %s', (email,))
            result = cursor.fetchone()
            cursor.close()
            conn.close()

            if result:
                return {'first_name': result['first_name'], 'email': result['email']}

        except Exception as e:
            print(f'Researcher.get_user_by_email error: {e}')

        # Fallback: derive name from email (e.g. john.doe@example.com → John)
        first_name = email.split('@')[0].split('.')[0].title()
        return {'first_name': first_name, 'email': email}

    def _resolve_lesson_db_id(self, lesson_id):
        """
        Given a lesson_code string or numeric id, return the integer DB id.
        Returns None if not found.
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            if self._is_lesson_code(lesson_id):
                cursor.execute('SELECT id FROM lessons WHERE lesson_code = %s', (str(lesson_id),))
            else:
                cursor.execute('SELECT id FROM lessons WHERE id = %s', (lesson_id,))
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            return row['id'] if row else None
        except Exception as e:
            print(f'Researcher._resolve_lesson_db_id error: {e}')
            return None

    def get_user_progress(self, user_email, lesson_id):
        """
        Fetch user progress for a specific lesson.
        lesson_id can be a lesson_code string or numeric id.
        Returns None if no progress record exists yet.
        """
        try:
            db_id = self._resolve_lesson_db_id(lesson_id)
            if db_id is None:
                return None

            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT score, struggles, attempts, complexity_level, completed,
                       outcome, session_notes
                FROM user_progress
                WHERE user_email = %s AND lesson_id = %s
                """,
                (user_email, db_id)
            )
            result = cursor.fetchone()
            cursor.close()
            conn.close()

            if not result:
                return None

            return {
                'score': result['score'] or 0,
                'struggles': result['struggles'] or [],
                'attempts': result['attempts'] or {},
                'complexity_level': result['complexity_level'] or 3,
                'completed': result['completed'] or False,
                'outcome': result['outcome'],
                'session_notes': result['session_notes'],
            }

        except Exception as e:
            print(f'Researcher.get_user_progress error: {e}')
            return None

    def save_progress(self, user_email, lesson_id, score, struggles, attempts,
                      complexity_level, outcome=None, session_notes=None):
        """
        Upsert user progress to the database.
        lesson_id can be a lesson_code string or numeric id.
        Uses ON CONFLICT to merge rather than replace existing data.
        """
        try:
            db_id = self._resolve_lesson_db_id(lesson_id)
            if db_id is None:
                print(f'Researcher.save_progress: lesson not found for {lesson_id}')
                return False

            lesson_code = str(lesson_id) if self._is_lesson_code(lesson_id) else None

            # Ensure JSONB fields are serialized correctly
            safe_struggles = struggles if isinstance(struggles, str) else json.dumps(struggles or [])
            safe_attempts = attempts if isinstance(attempts, str) else json.dumps(attempts or {})
            safe_complexity = int(complexity_level) if complexity_level else 3

            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO user_progress
                    (user_email, lesson_id, lesson_code, score, struggles, attempts,
                     complexity_level, outcome, session_notes, last_accessed)
                VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s, NOW())
                ON CONFLICT (user_email, lesson_id) DO UPDATE SET
                    lesson_code      = COALESCE(EXCLUDED.lesson_code, user_progress.lesson_code),
                    score            = EXCLUDED.score,
                    struggles        = EXCLUDED.struggles,
                    attempts         = EXCLUDED.attempts,
                    complexity_level = EXCLUDED.complexity_level,
                    outcome          = COALESCE(EXCLUDED.outcome, user_progress.outcome),
                    session_notes    = COALESCE(EXCLUDED.session_notes, user_progress.session_notes),
                    last_accessed    = NOW()
                """,
                (user_email, db_id, lesson_code, score, safe_struggles, safe_attempts,
                 safe_complexity, outcome, session_notes)
            )
            conn.commit()
            cursor.close()
            conn.close()
            return True

        except Exception as e:
            print(f'Researcher.save_progress error: {e}')
            return False

    # ------------------------------------------------------------------
    # Chunk retrieval
    # ------------------------------------------------------------------

    def get_relevant_chunks(self, lesson_code, activity, context_hint=None, limit=4):
        """
        Return the most relevant lesson_chunks for the current tutoring activity.

        Strategy:
          - greeting / review_concepts: first N slides (lesson overview)
          - practice / staged_problem:  FTS on context_hint (question topic/text)
          - free_discussion:            FTS on context_hint (student's message)
          - fallback:                   first N slides

        Args:
            lesson_code:   e.g. '2A1-1-1'
            activity:      orchestrator activity string
            context_hint:  topic string or user message for FTS retrieval
            limit:         max chunks to return (default 4, ~1600 chars each)

        Returns:
            list of dicts with keys: slide_number, title, body, narration, source_content
        """
        try:
            conn = self._get_connection()
            cur = conn.cursor()

            if activity in ('greeting', 'review_concepts') or not context_hint:
                # Return the opening slides — they set the lesson context
                cur.execute(
                    """
                    SELECT slide_number, title, body, narration, source_content
                    FROM lesson_chunks
                    WHERE lesson_code = %s
                    ORDER BY slide_number ASC
                    LIMIT %s
                    """,
                    (lesson_code, limit)
                )
            else:
                # Full-text search within this lesson, fall back to first slides if no hits
                cur.execute(
                    """
                    SELECT slide_number, title, body, narration, source_content,
                           ts_rank(
                               to_tsvector('english',
                                   coalesce(title,'') || ' ' ||
                                   coalesce(body,'') || ' ' ||
                                   coalesce(narration,'')),
                               plainto_tsquery('english', %s)
                           ) AS rank
                    FROM lesson_chunks
                    WHERE lesson_code = %s
                      AND to_tsvector('english',
                              coalesce(title,'') || ' ' ||
                              coalesce(body,'') || ' ' ||
                              coalesce(narration,''))
                          @@ plainto_tsquery('english', %s)
                    ORDER BY rank DESC, slide_number ASC
                    LIMIT %s
                    """,
                    (context_hint, lesson_code, context_hint, limit)
                )
                rows = cur.fetchall()

                fts_slide_nums = [r['slide_number'] for r in rows]

                # If FTS returned fewer than limit, pad with opening slides
                if len(rows) < limit:
                    needed = limit - len(rows)
                    exclude = fts_slide_nums if fts_slide_nums else [-1]
                    placeholders = ','.join(['%s'] * len(exclude))
                    cur.execute(
                        f"""
                        SELECT slide_number, title, body, narration, source_content
                        FROM lesson_chunks
                        WHERE lesson_code = %s
                          AND slide_number NOT IN ({placeholders})
                        ORDER BY slide_number ASC
                        LIMIT %s
                        """,
                        [lesson_code] + exclude + [needed]
                    )
                    rows = list(rows) + list(cur.fetchall())

                cur.close()
                conn.close()
                # Sort final set by slide_number so context reads in order
                rows.sort(key=lambda r: r['slide_number'])
                return [
                    {
                        'slide_number': r['slide_number'],
                        'title': r['title'] or '',
                        'body': r['body'] or '',
                        'narration': r['narration'] or '',
                        'source_content': r['source_content'] or '',
                    }
                    for r in rows
                ]

            rows = cur.fetchall()
            cur.close()
            conn.close()
            return [
                {
                    'slide_number': r['slide_number'],
                    'title': r['title'] or '',
                    'body': r['body'] or '',
                    'narration': r['narration'] or '',
                    'source_content': r['source_content'] or '',
                }
                for r in rows
            ]

        except Exception as e:
            print(f'Researcher.get_relevant_chunks error: {e}')
            return []

    # ------------------------------------------------------------------
    # Questions
    # ------------------------------------------------------------------

    def get_questions(self, lesson_id, complexity_level=3,
                      question_type='objective_practice', limit=5, exclude_ids=None):
        """
        Fetch practice questions from the questions table.
        lesson_id can be a lesson_code string ('2A1-1-1') or numeric id.

        Args:
            lesson_id: lesson to fetch questions for
            complexity_level: maximum difficulty (1-5)
            question_type: 'objective_practice' or 'chapter_quiz'
            limit: max number of questions to return
            exclude_ids: list of question IDs already seen this session

        Returns:
            list of question dicts
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Use lesson_code column for string IDs; lesson_id FK for numeric
            if self._is_lesson_code(lesson_id):
                lesson_filter = 'lesson_code = %s'
            else:
                lesson_filter = 'lesson_id = %s'

            exclude_clause = ''
            params = [str(lesson_id), complexity_level, question_type, limit]

            if exclude_ids:
                placeholders = ','.join(['%s'] * len(exclude_ids))
                exclude_clause = f'AND id NOT IN ({placeholders})'
                params = [str(lesson_id), complexity_level, question_type] + list(exclude_ids) + [limit]

            cursor.execute(
                f"""
                SELECT id, question_text, options, correct_answer, explanation,
                       difficulty, topic, question_type, step_data
                FROM questions
                WHERE {lesson_filter}
                  AND difficulty <= %s
                  AND question_type = %s
                  {exclude_clause}
                ORDER BY difficulty DESC, RANDOM()
                LIMIT %s
                """,
                params
            )

            results = cursor.fetchall()
            cursor.close()
            conn.close()

            return [
                {
                    'id': row['id'],
                    'question_text': row['question_text'],
                    'options': row['options'],
                    'correct_answer': row['correct_answer'],
                    'explanation': row['explanation'] or '',
                    'difficulty': row['difficulty'],
                    'topic': row['topic'] or '',
                    'question_type': row['question_type'],
                    'step_data': row['step_data'],
                }
                for row in results
            ]

        except Exception as e:
            print(f'Researcher.get_questions error: {e}')
            return []

    def get_chapter_quiz_questions(self, chapter_id, limit=10):
        """
        Fetch randomized chapter quiz questions for the end-of-chapter assessment.
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, question_text, options, correct_answer, explanation,
                       difficulty, topic, step_data
                FROM questions
                WHERE chapter_id = %s AND question_type = 'chapter_quiz'
                ORDER BY RANDOM()
                LIMIT %s
                """,
                (chapter_id, limit)
            )
            results = cursor.fetchall()
            cursor.close()
            conn.close()

            return [
                {
                    'id': row['id'],
                    'question_text': row['question_text'],
                    'options': row['options'],
                    'correct_answer': row['correct_answer'],
                    'explanation': row['explanation'] or '',
                    'difficulty': row['difficulty'],
                    'topic': row['topic'] or '',
                    'step_data': row['step_data'],
                }
                for row in results
            ]

        except Exception as e:
            print(f'Researcher.get_chapter_quiz_questions error: {e}')
            return []

    # ------------------------------------------------------------------
    # Key point extraction (used for initial display)
    # ------------------------------------------------------------------

    def extract_key_points(self, lesson_context, max_points=5):
        """
        Extract key points from lesson context for the display section.
        Returns dict with seed_sentence and key_points list.
        """
        title = lesson_context.get('title', '')
        summary = lesson_context.get('summary', '')
        key_points = lesson_context.get('key_points', [])

        if key_points:
            extracted = []
            for kp in key_points[:max_points]:
                if isinstance(kp, dict):
                    extracted.append(kp.get('content', str(kp)))
                else:
                    extracted.append(str(kp))
            return {
                'seed_sentence': self._create_seed_sentence(title, summary),
                'key_points': extracted,
            }

        transcript = lesson_context.get('video_transcript', '')
        if transcript or summary:
            extracted = self._extract_from_text(transcript or summary, max_points)
            return {
                'seed_sentence': self._create_seed_sentence(title, summary),
                'key_points': extracted,
            }

        return {
            'seed_sentence': f'Welcome to {title}.',
            'key_points': ['Review the lesson material to understand the key concepts.'],
        }

    def _create_seed_sentence(self, title, summary):
        if summary:
            sentences = summary.split('.')
            if sentences and sentences[0].strip():
                return sentences[0].strip() + '.'
        return f'Welcome to {title}. This lesson covers essential concepts you\'ll need to master.'

    def _extract_from_text(self, text, max_points):
        if not text:
            return ['No content available.']
        sentences = text.split('. ')
        substantial = [s.strip() + '.' for s in sentences if len(s.strip()) > 30]
        return substantial[:max_points]
