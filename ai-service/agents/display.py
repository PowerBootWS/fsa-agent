"""
Display Agent - Content management agent
Manages the top section of Tab 2 (summaries, snippets, practice questions)
Listens to Orchestrator directives
"""


class DisplayAgent:
    def __init__(self):
        self.current_display = {}

    def determine_update(self, state, tutor_response, lesson_context):
        """
        Determine what should be displayed in the top section

        Args:
            state: Current conversation state from Orchestrator
            tutor_response: The tutor's response (to understand context)
            lesson_context: Lesson data

        Returns:
            dict: Content to display or None
        """
        key = f"{state.get('user', 'default')}:{state.get('lesson_id', 'default')}"

        # Check conversation flow for display triggers
        response_lower = tutor_response.lower()

        # Show summary on start
        if 'welcome' in response_lower or 'start' in response_lower:
            return self._create_display('summary', lesson_context)

        # Show practice question when tutor introduces one
        if 'practice question' in response_lower or 'question' in response_lower:
            return self._create_display('question', lesson_context, state)

        # Show hint when tutor gives one
        if 'hint' in response_lower or 'remember' in response_lower:
            return self._create_display('hint', lesson_context)

        # Show key point when referenced
        if 'key point' in response_lower or 'important' in response_lower:
            return self._create_display('key_point', lesson_context)

        # Default: show summary if nothing else
        current = self.current_display.get(key, {}).get('type')
        if not current:
            return self._create_display('summary', lesson_context)

        return None

    def _create_display(self, display_type, lesson_context, state=None):
        """Create display content based on type"""

        if display_type == 'summary':
            return {
                'type': 'summary',
                'title': 'Lesson Overview',
                'content': lesson_context.get('summary', 'No summary available.'),
            }

        if display_type == 'question':
            # Get question based on complexity level
            questions = lesson_context.get('practice_questions', [])
            complexity = state.get('complexity_level', 3) if state else 3

            # Filter by complexity
            suitable_questions = [
                q for q in questions
                if q.get('difficulty', 3) <= complexity
            ]

            if suitable_questions:
                q = suitable_questions[0]
                return {
                    'type': 'question',
                    'title': 'Practice Question',
                    'question': q.get('question', ''),
                    'options': q.get('options', []),
                    'topic': q.get('topic', ''),
                }

            return {
                'type': 'message',
                'content': 'Great progress! Try applying what you learned.',
            }

        if display_type == 'hint':
            key_points = lesson_context.get('key_points', [])
            if key_points:
                return {
                    'type': 'hint',
                    'title': 'Key Concept',
                    'content': key_points[0].get('content', ''),
                }

        if display_type == 'key_point':
            key_points = lesson_context.get('key_points', [])
            if key_points:
                # Get a different point than last time
                idx = len(key_points) % len(key_points)
                return {
                    'type': 'key_point',
                    'title': key_points[idx].get('title', 'Important Point'),
                    'content': key_points[idx].get('content', ''),
                }

        return {
            'type': 'message',
            'content': 'Continue working through the lesson.',
        }

    def get_current_display(self, user, lesson_id):
        """Get current display state"""
        key = f"{user}:{lesson_id}"
        return self.current_display.get(key, {})