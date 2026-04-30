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

# Max chat history entries to include in each prompt (20 = 10 exchanges rolling window)
MAX_HISTORY_ENTRIES = 20


class TutorAgent:
    def __init__(self):
        self.api_key = os.getenv('OPENROUTER_API_KEY')
        self.model = os.getenv('OPENROUTER_MODEL', 'deepseek/deepseek-v4-flash')
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
        # Sanitize history to remove any 'undefined' artefacts stored in prior turns
        import re
        raw_history = state.get('chat_history', [])[-MAX_HISTORY_ENTRIES:]
        history = [
            {**entry, 'content': re.sub(r'\bundefined\b|\bnull\b', '', entry.get('content', '')).strip()}
            for entry in raw_history
        ]
        messages = history + [{'role': 'user', 'content': user_message}]

        # Call the LLM
        response_text = self._sanitize_response(self._call_api(system_prompt, messages))

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

    def _sanitize_response(self, text):
        """Strip artefacts that the LLM occasionally appends (e.g. literal 'undefined').
        Also normalise LaTeX delimiters to KaTeX-compatible $...$ / $$...$$ format.
        """
        import re
        # Remove any standalone occurrence of 'undefined', 'null', or 'None' that leaked
        # from template context — these appear as isolated words, often at the end.
        # Match them at end-of-string, or surrounded by whitespace/punctuation.
        text = re.sub(r'\bundefined\b', '', text)
        text = re.sub(r'\bnull\b', '', text)
        # Normalise LaTeX delimiters: \[...\] → $$...$$ and \(...\) → $...$
        # Some models use these despite being instructed to use $ notation.
        text = re.sub(r'\\\[([\s\S]*?)\\\]', r'$$\1$$', text)
        text = re.sub(r'\\\((.*?)\\\)', r'$\1$', text)
        # Wrap bare LaTeX commands that appear outside any $ delimiter.
        # Matches a \command{...} sequence (possibly chained: \frac{a}{b}) not already
        # preceded by a $ on the same line.
        text = re.sub(
            r'(?<!\$)(\\(?:frac|sqrt|sum|int|prod|lim|infty|partial|cdot|times|div|pm|'
            r'leq|geq|neq|approx|propto|Delta|alpha|beta|gamma|theta|lambda|mu|pi|sigma|omega)'
            r'(?:\{[^}]*\})*)',
            r'$\1$',
            text
        )
        # Collapse double spaces/newlines left by removal
        text = re.sub(r'  +', ' ', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

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
