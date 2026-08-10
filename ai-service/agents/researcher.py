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

    # Tables that can hold a student's real first name, in order of authority.
    # `platform_users` is the self-hosted platform's system of record; `users`
    # is the legacy pre-migration table that most current students have no row
    # in at all. Querying `users` alone meant those students fell through to
    # the email-derived fallback and got greeted by their email prefix — which
    # for kromanoff@ is a SURNAME ("Hi Kromanoff"). Fixed 2026-08-10.
    _NAME_SOURCE_TABLES = ('platform_users', 'users')

    def get_user_by_email(self, email):
        """
        Fetch a student's first name by email.

        Looks in platform_users first, then the legacy users table, and only
        derives a name from the email address as a last resort.
        """
        if not email:
            return {'first_name': 'there', 'email': email}

        for table in self._NAME_SOURCE_TABLES:
            try:
                conn = self._get_connection()
                cursor = conn.cursor()
                # Table name is interpolated from a module-level literal tuple,
                # never from user input — no injection surface here.
                cursor.execute(
                    f'SELECT first_name, email FROM {table} WHERE LOWER(email) = LOWER(%s)',
                    (email,)
                )
                result = cursor.fetchone()
                cursor.close()
                conn.close()

                if result:
                    # Guard against NULL/blank first_name stored in DB
                    stored_name = result['first_name']
                    if stored_name and str(stored_name).strip():
                        return {'first_name': str(stored_name).strip(), 'email': result['email']}
                    # Name is NULL/empty — try the next source
            except Exception as e:
                print(f'Researcher.get_user_by_email({table}) error: {e}')

        # Last resort: derive name from email (e.g. john.doe@example.com → John)
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
                      complexity_level, outcome=None, session_notes=None, completed=None):
        """
        Upsert user progress to the database.
        lesson_id can be a lesson_code string or numeric id.
        Uses ON CONFLICT to merge rather than replace existing data.
        completed is one-way (None leaves it alone, True sets it) — a later
        session that hasn't re-hit the completion threshold yet must not flip
        an already-completed objective back to incomplete.
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
                     complexity_level, outcome, session_notes, completed, last_accessed)
                VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s, %s, NOW())
                ON CONFLICT (user_email, lesson_id) DO UPDATE SET
                    lesson_code      = COALESCE(EXCLUDED.lesson_code, user_progress.lesson_code),
                    score            = EXCLUDED.score,
                    struggles        = EXCLUDED.struggles,
                    attempts         = EXCLUDED.attempts,
                    complexity_level = EXCLUDED.complexity_level,
                    outcome          = COALESCE(EXCLUDED.outcome, user_progress.outcome),
                    session_notes    = COALESCE(EXCLUDED.session_notes, user_progress.session_notes),
                    completed        = COALESCE(EXCLUDED.completed, user_progress.completed),
                    last_accessed    = NOW()
                """,
                (user_email, db_id, lesson_code, score, safe_struggles, safe_attempts,
                 safe_complexity, outcome, session_notes, completed)
            )
            conn.commit()
            cursor.close()
            conn.close()
            return True

        except Exception as e:
            print(f'Researcher.save_progress error: {e}')
            return False

    def save_chat_history(self, user_email, lesson_id, messages):
        """
        Upsert the full session transcript to the chat_history table.
        One row per (user_email, lesson_id) — each call replaces the prior
        snapshot with the current full transcript, same checkpoint pattern
        as save_progress.
        """
        try:
            db_id = self._resolve_lesson_db_id(lesson_id)
            if db_id is None:
                print(f'Researcher.save_chat_history: lesson not found for {lesson_id}')
                return False

            safe_messages = messages if isinstance(messages, str) else json.dumps(messages or [])

            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO chat_history (user_email, lesson_id, messages)
                VALUES (%s, %s, %s::jsonb)
                ON CONFLICT (user_email, lesson_id) DO UPDATE SET
                    messages = EXCLUDED.messages
                """,
                (user_email, db_id, safe_messages)
            )
            conn.commit()
            cursor.close()
            conn.close()
            return True

        except Exception as e:
            print(f'Researcher.save_chat_history error: {e}')
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

    # Words that carry no retrieval signal — stripped before building a tsquery.
    _FTS_STOPWORDS = {
        'the', 'and', 'how', 'why', 'what', 'does', 'can', 'you', 'are',
        'for', 'this', 'that', 'with', 'from', 'explain', 'tell', 'about',
        'more', 'detail', 'please', 'work', 'works', 'would', 'like',
        'mean', 'means', 'remind', 'again', 'was', 'were', 'has', 'have',
    }

    def _build_or_tsquery(self, context_hint):
        """
        Turn a natural-language phrase into an OR-joined tsquery string.

        OR rather than AND: "explain how a safety valve works" should match
        chunks about any of its key terms, ranked by relevance.
        plainto_tsquery would AND every word and almost always miss.

        Returns None when there is nothing worth searching for.
        """
        if not context_hint:
            return None
        import re
        words = re.findall(r'[a-z0-9]{3,}', str(context_hint).lower())
        terms = [w for w in dict.fromkeys(words) if w not in self._FTS_STOPWORDS]
        if not terms:
            return None
        return ' | '.join(terms)

    def search_library(self, context_hint, exclude_lesson_code=None, limit=3):
        """
        Full-text search lesson_chunks across the ENTIRE library — every paper,
        every certification level — not just the student's current course.

        This is the research step behind cross-paper tutoring. A lesson often
        *references* a concept that is formally taught in an earlier chapter or
        a different paper; when the student asks about one of those, the
        in-lesson chunks cannot answer it. Rather than have the tutor deflect,
        the researcher goes and finds the material and hands it over.

        Results are capped at one chunk per lesson so three hits mean three
        different sources rather than three slides from the same deck.

        Returns chunk dicts in the get_relevant_chunks shape, plus
        'lesson_code' and 'lesson_title' so the tutor can cite where a topic
        is actually taught.
        """
        tsquery = self._build_or_tsquery(context_hint)
        if not tsquery:
            return []
        try:
            conn = self._get_connection()
            cur = conn.cursor()
            cur.execute(
                """
                SELECT c.lesson_code, c.slide_number, c.title, c.body,
                       c.narration, c.source_content,
                       l.title AS lesson_title,
                       ts_rank(
                           to_tsvector('english',
                               coalesce(c.title,'') || ' ' ||
                               coalesce(c.body,'') || ' ' ||
                               coalesce(c.narration,'')),
                           to_tsquery('english', %s)
                       ) AS rank
                FROM lesson_chunks c
                LEFT JOIN lessons l ON l.lesson_code = c.lesson_code
                WHERE to_tsvector('english',
                          coalesce(c.title,'') || ' ' ||
                          coalesce(c.body,'') || ' ' ||
                          coalesce(c.narration,''))
                      @@ to_tsquery('english', %s)
                  AND (%s::varchar IS NULL OR c.lesson_code <> %s)
                ORDER BY rank DESC
                LIMIT %s
                """,
                (tsquery, tsquery, exclude_lesson_code, exclude_lesson_code, limit * 6)
            )
            rows = cur.fetchall()
            cur.close()
            conn.close()

            results = []
            seen_lessons = set()
            for r in rows:
                code = r['lesson_code']
                if code in seen_lessons:
                    continue
                seen_lessons.add(code)
                results.append({
                    'lesson_code': code,
                    'lesson_title': r['lesson_title'] or '',
                    'slide_number': r['slide_number'],
                    'title': r['title'] or '',
                    'body': r['body'] or '',
                    'narration': r['narration'] or '',
                    'source_content': r['source_content'] or '',
                })
                if len(results) >= limit:
                    break
            return results
        except Exception as e:
            print(f'Researcher.search_library error: {e}')
            return []

    def get_course_chunks(self, course_id, context_hint, limit=4):
        """
        Full-text search lesson_chunks across an ENTIRE course (all lessons
        whose lesson_code starts with the course code, e.g. '2B1-%'). Used for
        post-exam follow-up questions, where there is no single active lesson.
        Returns the same chunk dict shape as get_relevant_chunks.
        """
        tsquery = self._build_or_tsquery(context_hint)
        if not tsquery:
            return []
        try:
            conn = self._get_connection()
            cur = conn.cursor()
            cur.execute(
                """
                SELECT slide_number, title, body, narration, source_content,
                       ts_rank(
                           to_tsvector('english',
                               coalesce(title,'') || ' ' ||
                               coalesce(body,'') || ' ' ||
                               coalesce(narration,'')),
                           to_tsquery('english', %s)
                       ) AS rank
                FROM lesson_chunks
                WHERE lesson_code LIKE %s
                  AND to_tsvector('english',
                          coalesce(title,'') || ' ' ||
                          coalesce(body,'') || ' ' ||
                          coalesce(narration,''))
                      @@ to_tsquery('english', %s)
                ORDER BY rank DESC
                LIMIT %s
                """,
                (tsquery, f'{course_id}-%', tsquery, limit)
            )
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
            print(f'Researcher.get_course_chunks error: {e}')
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

            # Question bank starts at difficulty 2; clamp so complexity_level=1
            # doesn't produce an empty result set.
            effective_difficulty = max(complexity_level, 2)

            exclude_clause = ''
            params = [str(lesson_id), effective_difficulty, question_type, limit]

            if exclude_ids:
                placeholders = ','.join(['%s'] * len(exclude_ids))
                exclude_clause = f'AND id NOT IN ({placeholders})'
                params = [str(lesson_id), effective_difficulty, question_type] + list(exclude_ids) + [limit]

            cursor.execute(
                f"""
                SELECT id, question_text, options, correct_answer, explanation,
                       difficulty, topic, question_type, step_data
                FROM questions
                WHERE {lesson_filter}
                  AND difficulty <= %s
                  AND question_type = %s
                  AND options IS NOT NULL
                  AND jsonb_array_length(options) > 0
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

    def record_response(self, user_email, question_id, session_type,
                        course_id, chapter_id, correct):
        """
        Persist a single question response for progress tracking.
        Silently ignores errors (non-critical path).
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO question_responses
                    (user_email, question_id, session_type, course_id, chapter_id, correct)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (user_email, question_id, session_type, course_id, chapter_id, bool(correct))
            )
            conn.commit()
            cursor.close()
            conn.close()
        except Exception as e:
            print(f'Researcher.record_response error (non-fatal): {e}')

    def save_last_debrief(self, user_email, course_id, debrief):
        """
        Persist the most recent completed-exam debrief (full results + tutor
        summary) so the lobby "Review most recent results" button and page
        refreshes can restore it even after the AI service restarts.
        One row per (user, course) — upserted on each completed exam.
        Silently ignores errors (non-critical path).
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO exam_last_debrief (user_email, course_id, debrief, updated_at)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (user_email, course_id)
                DO UPDATE SET debrief = EXCLUDED.debrief, updated_at = NOW()
                """,
                (user_email, course_id, json.dumps(debrief))
            )
            conn.commit()
            cursor.close()
            conn.close()
        except Exception as e:
            print(f'Researcher.save_last_debrief error (non-fatal): {e}')

    def get_last_debrief(self, user_email, course_id):
        """
        Return the persisted {tutor_response, display_update} debrief for the
        most recent completed exam, or None when there isn't one.
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT debrief FROM exam_last_debrief
                WHERE user_email = %s AND course_id = %s
                """,
                (user_email, course_id)
            )
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            if not row:
                return None
            debrief = row['debrief']
            # psycopg2 returns jsonb as a parsed dict, but guard for str.
            return json.loads(debrief) if isinstance(debrief, str) else debrief
        except Exception as e:
            print(f'Researcher.get_last_debrief error (non-fatal): {e}')
            return None

    def get_chapter_weights(self, user_email, course_id):
        """
        Return per-chapter accuracy for a user in a course.
        { chapter_id: {'accuracy': float, 'total': int} }
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT chapter_id,
                       AVG(correct::int)::float AS accuracy,
                       COUNT(*)::int             AS total
                FROM question_responses
                WHERE user_email = %s
                  AND course_id  = %s
                  AND chapter_id IS NOT NULL
                GROUP BY chapter_id
                """,
                (user_email, course_id)
            )
            rows = cursor.fetchall()
            cursor.close()
            conn.close()
            return {r['chapter_id']: {'accuracy': r['accuracy'], 'total': r['total']} for r in rows}
        except Exception as e:
            print(f'Researcher.get_chapter_weights error: {e}')
            return {}

    def get_exam_questions(self, course_id, limit=50, weights=None, exclude_ids=None):
        """
        Fetch questions for the adaptive practice exam.
        Draws from both objective_practice and chapter_quiz pools.
        If weights provided: chapters with lower accuracy get proportionally more questions.
        weights: { chapter_id: {'accuracy': float, 'total': int} }
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Get all distinct chapters for this course
            cursor.execute(
                """
                SELECT DISTINCT chapter_id FROM questions
                WHERE course_id = %s AND chapter_id IS NOT NULL
                  AND standalone = TRUE
                  AND options IS NOT NULL AND jsonb_array_length(options) > 0
                ORDER BY chapter_id
                """,
                (course_id,)
            )
            chapters = [r['chapter_id'] for r in cursor.fetchall()]

            if not chapters:
                cursor.close()
                conn.close()
                return []

            # Compute per-chapter allocation
            allocations = self._compute_chapter_allocations(chapters, limit, weights)

            all_questions = []
            excluded = list(exclude_ids) if exclude_ids else []

            for chapter_id, count in allocations.items():
                if count <= 0:
                    continue
                ex_clause = ''
                params = [course_id, chapter_id]
                if excluded:
                    placeholders = ','.join(['%s'] * len(excluded))
                    ex_clause = f'AND id NOT IN ({placeholders})'
                    params += excluded

                params.append(count)
                cursor.execute(
                    f"""
                    SELECT id, question_text, options, correct_answer, explanation,
                           difficulty, topic, question_type, chapter_id, course_id, lesson_code
                    FROM questions
                    WHERE course_id = %s
                      AND chapter_id = %s
                      AND standalone = TRUE
                      AND options IS NOT NULL
                      AND jsonb_array_length(options) > 0
                      {ex_clause}
                    ORDER BY RANDOM()
                    LIMIT %s
                    """,
                    params
                )
                rows = cursor.fetchall()
                all_questions.extend(rows)
                excluded += [r['id'] for r in rows]

            cursor.close()
            conn.close()

            # Shuffle so chapter blocks aren't presented in order
            import random
            random.shuffle(all_questions)

            return [
                {
                    'id': r['id'],
                    'question_text': r['question_text'],
                    'options': r['options'],
                    'correct_answer': r['correct_answer'],
                    'explanation': r['explanation'] or '',
                    'difficulty': r['difficulty'],
                    'topic': r['topic'] or '',
                    'question_type': r['question_type'],
                    'chapter_id': r['chapter_id'],
                    'course_id': r['course_id'],
                    'lesson_code': r['lesson_code'] or '',
                }
                for r in all_questions
            ]

        except Exception as e:
            print(f'Researcher.get_exam_questions error: {e}')
            return []

    def _compute_chapter_allocations(self, chapters, total, weights):
        """
        Distribute `total` questions across chapters.
        Chapters with lower accuracy get more questions.
        chapters without prior data get equal share.
        Returns { chapter_id: count }
        """
        import math

        if not weights:
            # No prior data — uniform distribution
            base = total // len(chapters)
            remainder = total % len(chapters)
            alloc = {c: base for c in chapters}
            for i, c in enumerate(chapters):
                if i < remainder:
                    alloc[c] += 1
            return alloc

        # Weight = 1 - accuracy (so low accuracy → high weight)
        # Chapters with no data get weight = 0.5 (middle of the road)
        raw_weights = {}
        for c in chapters:
            if c in weights:
                raw_weights[c] = 1.0 - weights[c]['accuracy']
            else:
                raw_weights[c] = 0.5  # unknown → neutral

        total_weight = sum(raw_weights.values())
        if total_weight == 0:
            total_weight = 1.0

        # Ensure each chapter gets at least 1 question, proportionally distribute rest
        # -- but only when there are enough requested questions to cover every
        # chapter. 4th Class papers have 55-56 chapters, more than the smallest
        # exam-count option (25); forcing 1-per-chapter regardless of `total`
        # meant a 25/50-question exam always silently returned 55/56 questions
        # instead once any chapter-accuracy weighting existed (i.e. for any
        # returning student, not just their very first exam). 2nd/3rd Class
        # papers all have fewer chapters than 25, so this never triggered there.
        min_per_chapter = 1 if total >= len(chapters) else 0
        reserved = min_per_chapter * len(chapters)
        distributable = max(0, total - reserved)

        alloc = {c: min_per_chapter for c in chapters}
        for c in chapters:
            extra = round(distributable * raw_weights[c] / total_weight)
            alloc[c] += extra

        # Adjust rounding errors
        current_total = sum(alloc.values())
        diff = total - current_total
        if diff != 0:
            # Add/remove from highest-weighted chapter
            sorted_chapters = sorted(chapters, key=lambda c: raw_weights[c], reverse=True)
            for c in sorted_chapters:
                if diff == 0:
                    break
                if diff > 0:
                    alloc[c] += 1
                    diff -= 1
                elif diff < 0 and alloc[c] > min_per_chapter:
                    alloc[c] -= 1
                    diff += 1

        return alloc

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
                WHERE chapter_id = %s
                  AND question_type IN ('chapter_quiz', 'objective_practice')
                  AND standalone = TRUE
                  AND options IS NOT NULL AND jsonb_array_length(options) > 0
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

    def get_questions_by_ids(self, ids):
        """
        Fetch lesson_code, topic, explanation for a list of question IDs.
        Fallback used when exam_results are missing enrichment fields.
        Returns dict keyed by question id: {id: {lesson_code, topic, explanation}}
        """
        if not ids:
            return {}
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, lesson_code, topic, explanation
                FROM questions
                WHERE id = ANY(%s)
                """,
                (list(ids),)
            )
            rows = cursor.fetchall()
            cursor.close()
            conn.close()
            return {
                row['id']: {
                    'lesson_code': row['lesson_code'] or '',
                    'topic': row['topic'] or '',
                    'explanation': row['explanation'] or '',
                }
                for row in rows
            }
        except Exception as e:
            print(f'Researcher.get_questions_by_ids error: {e}')
            return {}

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
