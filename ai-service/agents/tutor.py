"""
Tutor Agent - Primary user interaction agent
All conversational responses are LLM-generated via OpenRouter.
No scripted fallback — requires a valid OPENROUTER_API_KEY.
"""
import json
import os
import re
import time

import requests

from agents import calculator, tutor_prompt


# ---------------------------------------------------------------------------
# CALCULATOR TOOL + VERIFY-BEFORE-JUDGE GUARD — backlog #97.
#
# The tutor used to pose free-form numeric problems in chat and grade them
# itself, with no ground truth anywhere in the loop. A 2A2 student answered a
# heat-energy problem correctly (5 kg x 4.187 kJ/kg.C x 60 C = 1256.1 kJ), gave
# 1256.1 four separate times, and was told each time she had "a small decimal
# error" — then in the same breath that the answer "should actually be 1256.1".
#
# Prompt hardening shipped 2026-08-19 and only lowered the rate. The model now
# gets a real calculator, and a guard catches the case it matters most: a reply
# that passes judgement on a number the student gave without having computed
# anything. That turn is re-run with the calculator forced.
#
# Set TUTOR_CALCULATOR=0 to disable without a rebuild.
# ---------------------------------------------------------------------------
CALCULATOR_ENABLED = os.getenv('TUTOR_CALCULATOR', '1') == '1'

# Whole-turn budget, forced re-run included. A model that only ever emits tool
# calls must still terminate, and a student is waiting on this turn.
MAX_API_CALLS_PER_TURN = 4

# Past this the turn has cost the student enough waiting; stop calling out and
# fall back rather than stacking another round-trip on a slow turn.
TURN_DEADLINE_SECONDS = 45

CALCULATOR_TOOL = {
    'type': 'function',
    'function': {
        'name': 'calculate',
        'description': (
            'Evaluate an arithmetic expression and return the exact result. You MUST '
            'call this before stating or judging any calculated number — never assert '
            'arithmetic you have not computed here. Accepts + - * / ** % and '
            'parentheses, plus sqrt, log (natural), ln, log10, exp, abs, round, sin, '
            'cos, tan, asin, acos, atan, radians, degrees, and the constants pi and e. '
            'Numbers only: no variables, no units. Convert units yourself and pass the '
            'bare arithmetic, e.g. 5 * 4.187 * 60 for 5 kg of water raised 60 C.'
        ),
        'parameters': {
            'type': 'object',
            'properties': {
                'expression': {
                    'type': 'string',
                    'description': 'The arithmetic to evaluate, e.g. "5 * 4.187 * 60".',
                },
            },
            'required': ['expression'],
        },
    },
}

# A standalone numeric value in the student's message. Deliberately not a bare
# \d, which would fire on lesson codes like 2A2-1-1 and on ordinary prose.
STUDENT_NUMBER_RE = re.compile(r'(?<![\w.-])\d+(?:[.,]\d+)?(?![\w-])')

# A reply passing judgement on a numeric answer. Both directions are here on
# purpose: confirming a wrong answer costs a student's trust exactly as much as
# rejecting a right one, and only the second half showed up in the 2026-08-18
# report.
NUMERIC_VERDICT_RE = re.compile(
    r"\b(?:"
    r"not quite|not right|isn'?t right|not correct|incorrect|"
    r"decimal error|rounding error|small error|slight error|"
    r"try again|check your|recheck|double.check|"
    r"very close|so close|almost there|"
    r"that'?s it|that'?s right|that'?s correct|exactly right|spot on|"
    r"well done|nice work|perfect|correct"
    r")\b",
    re.IGNORECASE,
)

# Used when a verdict has to be removed because nothing computed it. Asks for
# the working instead of asserting anything — the student is never told they are
# wrong on an uncomputed judgement.
UNVERIFIED_VERDICT_REPLACEMENT = (
    "Walk me through how you got that — show me the numbers you multiplied "
    "and I'll follow along with you."
)


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

        # Call the LLM. `student_gave_number` arms the verify-before-judge
        # guard: without a number from the student there is no numeric verdict
        # to police, and the turn stays a single API call.
        api_result = self._call_api(
            system_prompt, messages, student_gave_number=contains_number(user_message))
        response_text = self._sanitize_response(api_result['text'])

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

    def _call_api(self, system_prompt, messages, student_gave_number=False):
        """Run one tutor turn, giving the model a calculator it must use before
        judging any number.

        Returns {'text': str, 'calculated': bool}. Never raises: the caller is
        rendering a student's chat turn, and an exception here is a dead UI.
        """
        budget = _TurnBudget()
        conversation = [{'role': 'system', 'content': system_prompt}, *messages]

        text, calculated = self._run_tool_loop(conversation, budget)

        # The guard. Narrow on purpose: it fires only where #97 lived — the
        # student put a number in front of the tutor and the tutor passed
        # judgement on it without computing anything. Ordinary conversation,
        # and any turn the model already calculated, costs nothing extra.
        needs_verification = (
            CALCULATOR_ENABLED
            and student_gave_number
            and not calculated
            and NUMERIC_VERDICT_RE.search(text or '')
        )

        if needs_verification and budget.remaining and not budget.expired:
            forced_text, calculated = self._run_tool_loop(
                conversation, budget, force_calculator=True)
            if calculated:
                return {'text': forced_text, 'calculated': True}
            text = forced_text or text

        if needs_verification and not calculated:
            print('TutorAgent: stripped an uncomputed numeric verdict (#97 guard)')
            return {'text': _strip_numeric_verdict(text), 'calculated': False}

        return {'text': text, 'calculated': calculated}

    def _run_tool_loop(self, conversation, budget, force_calculator=False):
        """Call the model, service any calculator calls, return (text, calculated)."""
        messages = list(conversation)
        calculated = False

        while budget.remaining and not budget.expired:
            payload = {
                'model': self.model,
                'max_tokens': 600,
                'messages': messages,
            }
            if CALCULATOR_ENABLED:
                payload['tools'] = [CALCULATOR_TOOL]
                if force_calculator:
                    payload['tool_choice'] = {
                        'type': 'function', 'function': {'name': 'calculate'}}

            message = self._post(payload, budget)
            if isinstance(message, str):       # transport failure, already worded
                return message, calculated

            tool_calls = message.get('tool_calls') or []
            if not tool_calls:
                return (message.get('content') or '').strip(), calculated

            # Forcing applies to the first call only; once the model has the
            # number, let it write the reply instead of calculating forever.
            force_calculator = False
            messages = messages + [message] + [
                self._run_calculator(call) for call in tool_calls]
            calculated = True

        # Budget exhausted mid-tool-loop. The numbers are computed but no prose
        # came back; say something rather than rendering an empty turn.
        return ("Let me work through that with you — walk me through the numbers "
                "you used and I'll follow along."), calculated

    def _post(self, payload, budget):
        """One OpenRouter call. Returns the assistant message, or a wording on failure."""
        budget.spend()
        try:
            response = self.session.post(
                f'{self.base_url}/chat/completions',
                json=payload,
                timeout=30,
            )
            response.raise_for_status()
            return response.json()['choices'][0]['message']

        except requests.exceptions.Timeout:
            return "I'm taking a bit longer than usual to think — please try sending your message again."

        except requests.exceptions.ConnectionError:
            return "I'm having trouble connecting right now. Please try again in a moment."

        except Exception as e:
            print(f'TutorAgent API error: {e}')
            return "Something went wrong on my end. Please try again — I'll be right here."

    @staticmethod
    def _run_calculator(call):
        """Evaluate one tool call and shape the result as a tool message."""
        function = call.get('function') or {}
        try:
            arguments = json.loads(function.get('arguments') or '{}')
        except (ValueError, TypeError):
            arguments = {}

        if function.get('name') != 'calculate':
            result = {'ok': False, 'error': f"unknown tool {function.get('name')!r}"}
        else:
            result = calculator.evaluate(arguments.get('expression'))

        return {
            'role': 'tool',
            'tool_call_id': call.get('id'),
            'name': 'calculate',
            'content': json.dumps(result),
        }

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


class _TurnBudget:
    """Caps how much a single student turn may cost in API calls and wall clock."""

    def __init__(self, max_calls=None, deadline_seconds=None):
        self.max_calls = MAX_API_CALLS_PER_TURN if max_calls is None else max_calls
        self.deadline_seconds = (
            TURN_DEADLINE_SECONDS if deadline_seconds is None else deadline_seconds)
        self.calls = 0
        self.started = time.monotonic()

    def spend(self):
        self.calls += 1

    @property
    def remaining(self):
        return self.calls < self.max_calls

    @property
    def expired(self):
        return time.monotonic() - self.started > self.deadline_seconds


def contains_number(text):
    """True if the student put an actual numeric value in front of the tutor."""
    return bool(STUDENT_NUMBER_RE.search(text or ''))


def _strip_numeric_verdict(text):
    """Remove sentences that judge a number, keep the teaching, ask for the working.

    Reached only when the model asserted a verdict and the forced calculator
    pass still produced no computed number. The student gets a slightly evasive
    turn instead of a confident wrong accusation, which is the whole point of
    #97: a student who is right and is told she is wrong stops trusting the
    tutor on everything else.
    """
    sentences = re.split(r'(?<=[.!?])\s+', (text or '').strip())
    kept = [s for s in sentences if s and not NUMERIC_VERDICT_RE.search(s)]

    if not kept:
        return UNVERIFIED_VERDICT_REPLACEMENT

    return ' '.join(kept).strip() + ' ' + UNVERIFIED_VERDICT_REPLACEMENT
