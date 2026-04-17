"""
Tutor Agent - Primary user interaction agent
All conversational responses are LLM-generated via OpenRouter.
No scripted fallback — requires a valid OPENROUTER_API_KEY.
"""
import os
import requests
from agents import tutor_prompt


# Profanity word list — checked before any API call
PROFANITY_WORDS = [
    'fuck', 'shit', 'ass', 'bitch', 'bastard', 'crap',
    'dick', 'cock', 'pussy', 'cunt', 'whore', 'slut', 'retard'
]

# Max chat history entries to include in each prompt (12 = 6 exchanges)
MAX_HISTORY_ENTRIES = 12


class TutorAgent:
    def __init__(self):
        self.api_key = os.getenv('OPENROUTER_API_KEY')
        self.model = os.getenv('OPENROUTER_MODEL', 'anthropic/claude-sonnet-4-6-20250515')
        self.base_url = 'https://openrouter.ai/api/v1'

        if not self.api_key:
            print('WARNING: OPENROUTER_API_KEY is not set. Tutor will not function.')

        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json',
            'HTTP-Referer': os.getenv('PARENT_DOMAIN', 'https://fsa-agent.local'),
            'X-Title': 'FSA Tutor Agent',
        })

    def respond(self, user_message, lesson_context, progress, state, first_name=None):
        """
        Generate a tutor response via the LLM.

        Args:
            user_message: The student's input text
            lesson_context: dict from researcher.get_lesson_context()
            progress: dict from researcher.get_user_progress() (may be None)
            state: dict from orchestrator conversation_state (mutated in place)
            first_name: student's first name

        Returns:
            dict with:
                - response: tutor response text (may contain Markdown and LaTeX)
                - action: optional action string ('warning' | 'stop' | None)
        """
        # Check profanity before anything else
        profanity_result = self._check_profanity(user_message, state)
        if profanity_result:
            return profanity_result

        # Build system prompt from current context
        system_prompt = tutor_prompt.build(lesson_context, progress, state, first_name)

        # Build messages list: rolling history + current message
        history = state.get('chat_history', [])[-MAX_HISTORY_ENTRIES:]
        messages = history + [{'role': 'user', 'content': user_message}]

        # Call the LLM
        response_text = self._call_api(system_prompt, messages)

        # Update rolling chat history in state (orchestrator owns state)
        if 'chat_history' not in state:
            state['chat_history'] = []
        state['chat_history'].append({'role': 'user', 'content': user_message})
        state['chat_history'].append({'role': 'assistant', 'content': response_text})
        # Trim to cap
        if len(state['chat_history']) > MAX_HISTORY_ENTRIES:
            state['chat_history'] = state['chat_history'][-MAX_HISTORY_ENTRIES:]

        return {'response': response_text}

    def _call_api(self, system_prompt, messages):
        """Call OpenRouter and return the response text."""
        try:
            response = self.session.post(
                f'{self.base_url}/chat/completions',
                json={
                    'model': self.model,
                    'max_tokens': 600,
                    'messages': [
                        {'role': 'system', 'content': system_prompt},
                        *messages,
                    ],
                },
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            return data['choices'][0]['message']['content']

        except requests.exceptions.Timeout:
            return "I'm taking a bit longer than usual to think — please try sending your message again."

        except requests.exceptions.ConnectionError:
            return "I'm having trouble connecting right now. Please try again in a moment."

        except Exception as e:
            print(f'TutorAgent API error: {e}')
            return "Something went wrong on my end. Please try again — I'll be right here."

    def _check_profanity(self, user_message, state):
        """
        Check for profanity. First offence: warning. Second: stop.
        Returns a dict on offence, None if clean.
        """
        user_lower = user_message.lower()
        profanity_count = state.get('profanity_count', 0)

        for word in PROFANITY_WORDS:
            if word in user_lower:
                if profanity_count == 0:
                    state['profanity_count'] = 1
                    return {
                        'response': (
                            "Let's keep our conversation focused and professional — "
                            "that's the kind of environment where the best learning happens. "
                            "Ready to continue with the lesson?"
                        ),
                        'action': 'warning',
                    }
                else:
                    return {
                        'response': (
                            "I need to end this session now due to continued inappropriate language. "
                            "Come back when you're ready to focus on your studies — "
                            "I'm here to help whenever you are."
                        ),
                        'action': 'stop',
                    }

        return None
