"""
Tutor Agent - Primary user interaction agent
All conversational responses are LLM-generated via OpenRouter.
No scripted fallback — requires a valid OPENROUTER_API_KEY.
"""
import os
import re
import requests
from agents import tutor_prompt


# ---------------------------------------------------------------------------
# PROFANITY FILTER — DISABLED 2026-08-19 (owner decision, Russ).
#
# The gate no longer produces any user-facing response. It never warns and it
# never ends a session. Rationale: it caused more harm than good (see the
# Katrina 2026-08-18 incident below), and a paying student swearing at the
# tutor is a signal that something is frustrating them, not a discipline
# problem — we want to look at WHY, not shut the session down.
#
# The word list and regex are kept intact so a future "flag it quietly for the
# owner" feature has something to build on. To re-enable the warn/stop
# behaviour, set TUTOR_PROFANITY_FILTER=1 in /home/debian/.env and restart
# ai-service. Default is OFF.
# ---------------------------------------------------------------------------
PROFANITY_FILTER_ENABLED = os.getenv('TUTOR_PROFANITY_FILTER', '0') == '1'


# Profanity word list — retained for future flagging, not currently enforced.
#
# MUST be matched on whole words only. These were previously matched as bare
# substrings, which fired on ordinary Power Engineering vocabulary: 'ass'
# matched br-ASS-, m-ASS-, cl-ASS-, gl-ASS-, g-ASS-es, comp-ASS-; 'crap'
# matched s-CRAP-; 'cock' matched pea-COCK-, -COCK-pit. A student pasting
# "600 kg of brass is mixed with 400 kg of aluminum" got a profanity warning,
# and pasting it a second time ended her session (reported 2026-08-18).
# 'cock' is deliberately NOT in this list: gauge cocks, try cocks, drain cocks
# and pet cocks are standard boiler fittings and core 2nd Class vocabulary.
PROFANITY_WORDS = [
    'fuck', 'shit', 'bullshit', 'horseshit', 'ass', 'asshole', 'dumbass',
    'jackass', 'bitch', 'bastard', 'crap', 'dick', 'pussy', 'cunt',
    'whore', 'slut', 'retard',
]

# Whole-word match, tolerating common suffixes (asses, bitching, shitty) but
# never matching a profanity that sits inside a longer, innocent word.
PROFANITY_RE = re.compile(
    r'\b(?:'
    + '|'.join(
        # Allow the usual doubled final consonant (shit -> shitty, shitting).
        f'{re.escape(w)}{re.escape(w[-1])}?(?:e?s|ed|ing|er|y|hole)?'
        for w in PROFANITY_WORDS
    )
    + r')\b',
    re.IGNORECASE,
)

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

        # Full untruncated transcript for durable persistence (separate from
        # the rolling LLM-context window above, which is deliberately capped).
        state.setdefault('full_transcript', [])
        state['full_transcript'].append({'role': 'user', 'content': user_message})
        state['full_transcript'].append({'role': 'assistant', 'content': response_text})

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
        """Strip artefacts that the LLM occasionally appends and normalise LaTeX delimiters."""
        import re
        # Remove standalone 'undefined' / 'null' leaked from template context.
        text = re.sub(r'\bundefined\b', '', text)
        text = re.sub(r'\bnull\b', '', text)

        # Normalise alternate delimiter styles (\[...\] and \(...\)).
        text = re.sub(r'\\\[([\s\S]*?)\\\]', r'$$\1$$', text)
        text = re.sub(r'\\\((.*?)\\\)', r'$\1$', text)

        # Collapse 3+ consecutive $ (e.g. $$expr$$$ double-wrap artefact) to $$.
        text = re.sub(r'\${3,}', '$$', text)

        # Strip inner $ delimiters from inside $$...$$ blocks.
        # Models sometimes wrap a command as $\cmd$ and then wrap that again in $$...$$,
        # producing $$t = $\frac{...}$$$.  Remove the inner $ signs.
        def _strip_inner(m):
            return '$$' + m.group(1).replace('$', '') + '$$'
        text = re.sub(r'\$\$([\s\S]*?)\$\$', _strip_inner, text)

        # Wrap bare LaTeX commands, but only in prose segments outside $...$ / $$...$$.
        _math_span = re.compile(r'(\$\$[\s\S]*?\$\$|\$[^$]+?\$)')
        _bare_cmd = re.compile(
            r'(\\(?:frac|sqrt|sum|int|prod|lim|infty|partial|cdot|times|div|pm|'
            r'leq|geq|neq|approx|propto|Delta|alpha|beta|gamma|theta|lambda|mu|pi|sigma|omega)'
            r'(?:\{[^}]*\})*)'
        )
        parts = _math_span.split(text)
        for i in range(0, len(parts), 2):
            parts[i] = _bare_cmd.sub(r'$\1$', parts[i])
        text = ''.join(parts)

        # Collapse extra whitespace left by removal steps.
        text = re.sub(r'  +', ' ', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

    def _check_profanity(self, user_message, state):
        """
        Profanity gate. DISABLED by default (see PROFANITY_FILTER_ENABLED).

        When disabled this always returns None, so the student's message goes
        straight to the tutor like any other message — no warning, no session
        end, no state mutation.

        When enabled: first offence warning, second offence stop.
        """
        if not PROFANITY_FILTER_ENABLED:
            return None

        profanity_count = state.get('profanity_count', 0)

        if PROFANITY_RE.search(user_message or ''):
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
