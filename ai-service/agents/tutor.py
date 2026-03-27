"""
Tutor Agent - Primary user interaction agent
Handles conversation, feedback, guidance, and active learning
"""
import os


class TutorAgent:
    def __init__(self):
        self.anthropic_api_key = os.getenv('ANTHROPIC_API_KEY')

    def respond(self, user_message, lesson_context, progress, state):
        """
        Generate tutor response with feedback and guidance

        Args:
            user_message: The user's input
            lesson_context: Lesson data from Researcher
            progress: User's progress data
            state: Current conversation state from Orchestrator

        Returns:
            str: Tutoring response
        """
        # Extract relevant context
        key_points = lesson_context.get('key_points', [])
        practice_questions = lesson_context.get('practice_questions', [])
        summary = lesson_context.get('summary', '')

        complexity_level = state.get('complexity_level', 3)

        # Simple response logic - in production would use Anthropic API
        # For now, generates contextual responses based on lesson content

        response = self._generate_response(
            user_message=user_message,
            key_points=key_points,
            practice_questions=practice_questions,
            summary=summary,
            complexity_level=complexity_level,
            state=state
        )

        return response

    def _generate_response(self, user_message, key_points, practice_questions, summary, complexity_level, state):
        """Generate contextual tutoring response"""

        # Check if user is asking a question vs attempting practice
        user_lower = user_message.lower()

        # Greeting
        if any(word in user_lower for word in ['hello', 'hi', 'hey', 'start']):
            return f"Welcome! I'm your tutor for this lesson. {summary} Let's learn together. Would you like to start with a practice question?"

        # Help request
        if 'help' in user_lower or 'hint' in user_lower:
            # Provide hint from key points
            if key_points:
                hint = key_points[0].get('content', 'Review the lesson material carefully.')
                return f"Here's a hint: {hint}"
            return "Let me guide you through this. Let's break it down step by step."

        # Check if responding to a practice question
        if 'question' in state or any(q.get('question', '').lower()[:50] in user_lower for q in practice_questions):
            return self._evaluate_answer(user_lower, practice_questions, key_points, state)

        # Default - encourage engagement
        if len(user_message) < 20:
            return "Tell me more about what you're thinking. What's your current understanding?"

        # Provide response referencing lesson content
        response_parts = []

        if key_points:
            # Reference a relevant key point
            relevant_point = key_points[min(complexity_level - 1, len(key_points) - 1)]
            response_parts.append(f"Remember, {relevant_point.get('content', '')}")

        response_parts.append("Based on that, what's your next step?")

        return " ".join(response_parts)

    def _evaluate_answer(self, user_answer, practice_questions, key_points, state):
        """Evaluate user answer and provide feedback"""

        for q in practice_questions:
            correct = q.get('correct_answer', '').lower()
            if correct in user_answer:
                # Correct answer
                return "Excellent! You're right. " + self._get_encouragement() + " Ready for the next one?"

            # Check if close (partial match)
            if any(word in user_answer for word in correct.split()[:2] if len(word) > 3):
                return "You're close! " + self._get_hint(q, key_points)

        # Wrong or unclear
        if key_points:
            hint = key_points[0].get('content', '')
            return f"You're on the right track. Remember, {hint}. Based on that, which option would you pick now?"

        return "Let's try this together. What does the lesson say about this concept?"

    def _get_hint(self, question, key_points):
        """Get a contextual hint"""
        topic = question.get('topic', '')
        for point in key_points:
            if point.get('topic') == topic:
                return f"Hint: {point.get('content', '')}"
        return "Think about the key concepts we covered."

    def _get_encouragement(self):
        """Get random encouragement"""
        encouragements = [
            "Great job working through that!",
            "You've got this!",
            "That's the right thinking!",
            "Excellent reasoning!",
            "You're grasping these concepts well!",
        ]
        return encouragements[hash(user_answer) % len(encouragements)]