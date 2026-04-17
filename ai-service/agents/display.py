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

        # Handle tutor_response as either string or dict
        if isinstance(tutor_response, dict):
            response_text = tutor_response.get('response', '')
        else:
            response_text = str(tutor_response) if tutor_response else ''

        # Check conversation flow for display triggers
        response_lower = response_text.lower()

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

    def create_initial_display(self, initial_context):
        """
        Create initial display when user first interacts

        Args:
            initial_context: Initial context from Researcher (includes seed_sentence and key_points)

        Returns:
            dict: Initial display content
        """
        # Build initial display with seed sentence and key points
        seed_sentence = initial_context.get('seed_sentence', 'Welcome to your lesson.')
        key_points = initial_context.get('key_points', [])

        # Format key points for display (extract_from_text returns strings)
        formatted_points = []
        for kp in key_points[:3]:  # Show first 3 key points
            if isinstance(kp, dict):
                formatted_points.append({
                    'title': kp.get('title', 'Key Point'),
                    'content': kp.get('content', ''),
                })
            else:
                formatted_points.append({
                    'title': 'Key Point',
                    'content': str(kp),
                })

        display_content = {
            'type': 'summary',
            'title': 'Lesson Overview',
            'content': seed_sentence,
            'key_points': formatted_points,
        }

        return display_content

    def create_question_display(self, question_data, question_index):
        """
        Create display content for a multiple choice question

        Args:
            question_data: Question dict with question, options, etc.
            question_index: Index of current question

        Returns:
            dict: Display content for the question
        """
        options = question_data.get('options', [])

        # Format options as A, B, C, D
        formatted_options = []
        for i, opt in enumerate(options):
            label = chr(65 + i)  # A, B, C, D
            formatted_options.append({
                'label': label,
                'text': opt
            })

        # Support both 'question_text' (questions table) and legacy 'question' field
        question_text = question_data.get('question_text') or question_data.get('question', '')

        return {
            'type': 'question',
            'title': f'Practice Question {question_index + 1}',
            'question': question_text,
            'options': formatted_options,
            'topic': question_data.get('topic', ''),
        }