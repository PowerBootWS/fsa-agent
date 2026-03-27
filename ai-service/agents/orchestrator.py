"""
Orchestrator - Central coordinator for the multi-agent system
Monitors conversation flow, directs agents, tracks progress and scoring
"""


class Orchestrator:
    def __init__(self):
        self.conversation_state = {}

    def process(self, user, lesson_id, message, lesson_context, progress, tutor, display):
        """
        Main entry point - coordinates the agent system

        Returns dict with:
        - tutor_response: message from Tutor Agent
        - display_update: content for top section (if any)
        - progress_update: scoring/progress data (if changed)
        """
        # Initialize conversation state
        state_key = f"{user}:{lesson_id}"
        if state_key not in self.conversation_state:
            self.conversation_state[state_key] = {
                'attempts': {},
                'struggles': [],
                'score': 100,
                'complexity_level': progress.get('complexity_level', 3) if progress else 3,
            }

        state = self.conversation_state[state_key]

        # Get tutor response
        tutor_response = tutor.respond(
            user_message=message,
            lesson_context=lesson_context,
            progress=progress,
            state=state
        )

        # Analyze response for progress tracking
        progress_update = self._track_progress(
            state=state,
            message=message,
            response=tutor_response,
            lesson_context=lesson_context
        )

        # Determine if display needs update
        display_update = display.determine_update(
            state=state,
            tutor_response=tutor_response,
            lesson_context=lesson_context
        )

        # Check if we should adjust complexity
        if progress_update:
            self._adjust_complexity(state)

        return {
            'tutor_response': tutor_response,
            'display_update': display_update,
            'progress_update': progress_update,
            'complexity_level': state['complexity_level'],
        }

    def _track_progress(self, state, message, response, lesson_context):
        """Track user progress and calculate score"""
        message_lower = message.lower()

        # Check for answer attempts (simple keyword-based detection)
        # In production, this would parse the actual answer format
        practice_questions = lesson_context.get('practice_questions', [])

        for q in practice_questions:
            q_text = q.get('question', '').lower()
            if q_text in message_lower:
                # User attempted a question
                q_id = q.get('id')
                if q_id not in state['attempts']:
                    state['attempts'][q_id] = {'count': 0, 'correct': False}

                state['attempts'][q_id]['count'] += 1

                # Check if answer is correct (simplified)
                correct_answer = q.get('correct_answer', '').lower()
                if correct_answer in message_lower:
                    state['attempts'][q_id]['correct'] = True
                    # Bonus for first try
                    if state['attempts'][q_id]['count'] == 1:
                        state['score'] = min(100, state['score'] + 10)
                else:
                    # Deduct for wrong answer
                    state['score'] = max(0, state['score'] - 5)

                    # Track struggle
                    topic = q.get('topic', 'general')
                    if topic not in state['struggles']:
                        state['struggles'].append(topic)

                return {
                    'score': state['score'],
                    'struggles': state['struggles'],
                    'attempts': state['attempts'],
                }

        return None

    def _adjust_complexity(self, state):
        """Adjust complexity level based on performance"""
        avg_attempts = 0
        if state['attempts']:
            total = sum(a['count'] for a in state['attempts'].values())
            avg_attempts = total / len(state['attempts'])

        # If mostly correct on first try, increase complexity
        correct_count = sum(1 for a in state['attempts'].values() if a['correct'])
        if state['attempts']:
            accuracy = correct_count / len(state['attempts'])

            if accuracy > 0.8 and avg_attempts < 1.5:
                state['complexity_level'] = min(5, state['complexity_level'] + 1)
            elif accuracy < 0.5 or avg_attempts > 2:
                state['complexity_level'] = max(1, state['complexity_level'] - 1)