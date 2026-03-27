"""
Researcher Agent - Data retrieval agent
Queries PostgreSQL for lesson content and user progress
"""
import os
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
        """Get database connection"""
        return psycopg2.connect(**self.db_config, cursor_factory=RealDictCursor)

    def get_lesson_context(self, lesson_id):
        """
        Fetch lesson content from database

        Returns dict with:
        - title: Lesson title
        - summary: Lesson summary
        - key_points: Array of key points
        - practice_questions: Array of practice questions
        - video_transcript: Full transcript
        """
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute(
                """
                SELECT id, title, video_transcript, summary, key_points, practice_questions
                FROM lessons
                WHERE id = %s
                """,
                (lesson_id,)
            )

            result = cursor.fetchone()
            cursor.close()
            conn.close()

            if not result:
                return {
                    'title': 'Unknown Lesson',
                    'summary': 'Lesson not found',
                    'key_points': [],
                    'practice_questions': [],
                    'video_transcript': '',
                }

            # Parse JSONB fields
            return {
                'id': str(result['id']),
                'title': result['title'],
                'summary': result['summary'],
                'key_points': result['key_points'] or [],
                'practice_questions': result['practice_questions'] or [],
                'video_transcript': result['video_transcript'] or '',
            }

        except Exception as e:
            print(f"Error fetching lesson: {e}")
            return {
                'title': 'Error',
                'summary': 'Failed to load lesson',
                'key_points': [],
                'practice_questions': [],
                'video_transcript': '',
            }

    def get_user_progress(self, user_email, lesson_id):
        """Fetch user progress for a lesson"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            cursor.execute(
                """
                SELECT score, struggles, attempts, complexity_level, completed
                FROM user_progress
                WHERE user_email = %s AND lesson_id = %s
                """,
                (user_email, lesson_id)
            )

            result = cursor.fetchone()
            cursor.close()
            conn.close()

            if not result:
                return None

            return {
                'score': result['score'],
                'struggles': result['struggles'] or [],
                'attempts': result['attempts'] or {},
                'complexity_level': result['complexity_level'] or 3,
                'completed': result['completed'],
            }

        except Exception as e:
            print(f"Error fetching progress: {e}")
            return None

    def get_practice_questions(self, lesson_id, complexity_level=3, exclude_topics=None):
        """Get practice questions filtered by complexity and topics"""
        try:
            conn = self._get_connection()
            cursor = conn.cursor()

            # Get questions at or below current complexity level
            cursor.execute(
                """
                SELECT question, options, correct_answer, explanation, topic, difficulty
                FROM practice_questions
                WHERE lesson_id = %s AND difficulty <= %s
                ORDER BY difficulty DESC
                """,
                (lesson_id, complexity_level)
            )

            results = cursor.fetchall()
            cursor.close()
            conn.close()

            questions = []
            for row in results:
                if exclude_topics and row['topic'] in exclude_topics:
                    continue
                questions.append({
                    'question': row['question'],
                    'options': row['options'],
                    'correct_answer': row['correct_answer'],
                    'explanation': row['explanation'],
                    'topic': row['topic'],
                    'difficulty': row['difficulty'],
                })

            return questions

        except Exception as e:
            print(f"Error fetching questions: {e}")
            return []