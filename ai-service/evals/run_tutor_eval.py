"""Run the tutor numeric-reasoning eval across candidate models.

    PYTHONPATH=/app python3 evals/run_tutor_eval.py [--models a,b] [--out results.json]

Scores are deterministic (see evals/scoring.py). Cost comes from OpenRouter's
own `usage` block on each response, not from an estimate.
"""
import argparse
import json
import sys
import time
from collections import defaultdict

from agents.researcher import Researcher
from agents.tutor import TutorAgent
from evals import scoring
from evals.cases import CASES


DEFAULT_MODELS = [
    'deepseek/deepseek-v4-flash',      # incumbent
    'deepseek/deepseek-v4-pro',
    'anthropic/claude-haiku-4.5',
    'anthropic/claude-sonnet-5',
]

LESSON_CODE = '2A2-1-1'


def run_case(model, case, lesson_context, attempts=2):
    """One tutor turn. Returns the scored result with call count, tool use and tokens."""
    for attempt in range(attempts):
        agent = TutorAgent()
        agent.model = model
        seen = {'calls': 0, 'expressions': [], 'prompt_tokens': 0, 'completion_tokens': 0}
        original = agent.session.post

        def spy(url, json=None, **kwargs):
            seen['calls'] += 1
            for message in json['messages']:
                if message.get('role') == 'tool':
                    try:
                        payload = __import__('json').loads(message['content'])
                    except Exception:
                        continue
                    entry = (payload.get('expression'),
                             payload.get('result', payload.get('error')))
                    if entry not in seen['expressions']:
                        seen['expressions'].append(entry)
            response = original(url, json=json, **kwargs)
            try:
                usage = response.json().get('usage') or {}
                seen['prompt_tokens'] += usage.get('prompt_tokens', 0)
                seen['completion_tokens'] += usage.get('completion_tokens', 0)
            except Exception:
                pass
            return response

        agent.session.post = spy
        try:
            reply = agent.respond(case.message, lesson_context, None, {}, 'Katrina')['response']
        except Exception as exc:                       # transient upstream failure
            if attempt + 1 < attempts:
                time.sleep(3)
                continue
            reply = f'ERROR: {exc}'

        result = scoring.score(
            case, reply, calls=seen['calls'],
            expressions=[f'{e} = {r}' for e, r in seen['expressions']])
        result['model'] = model
        result['prompt_tokens'] = seen['prompt_tokens']
        result['completion_tokens'] = seen['completion_tokens']
        result['used_calculator'] = bool(seen['expressions'])
        result['note'] = case.note
        return result


def summarise(results):
    """Per-model totals plus a per-category breakdown."""
    by_model = defaultdict(list)
    for r in results:
        by_model[r['model']].append(r)

    summary = {}
    for model, rows in by_model.items():
        categories = defaultdict(lambda: [0, 0])
        for r in rows:
            categories[r['category']][1] += 1
            if r['passed']:
                categories[r['category']][0] += 1
        summary[model] = {
            'passed': sum(1 for r in rows if r['passed']),
            'total': len(rows),
            'avg_api_calls': round(sum(r['calls'] for r in rows) / max(len(rows), 1), 2),
            'calculator_used_pct': round(
                100 * sum(1 for r in rows if r['used_calculator']) / max(len(rows), 1)),
            'prompt_tokens': sum(r['prompt_tokens'] for r in rows),
            'completion_tokens': sum(r['completion_tokens'] for r in rows),
            'categories': {k: f'{v[0]}/{v[1]}' for k, v in sorted(categories.items())},
        }
    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--models', default=','.join(DEFAULT_MODELS))
    parser.add_argument('--out', default='/tmp/tutor_eval_results.json')
    args = parser.parse_args()

    models = [m.strip() for m in args.models.split(',') if m.strip()]
    lesson_context = Researcher().get_lesson_context(LESSON_CODE)

    results = []
    for model in models:
        print(f'\n=== {model} ===', flush=True)
        for case in CASES:
            result = run_case(model, case, lesson_context)
            results.append(result)
            mark = 'PASS' if result['passed'] else 'FAIL'
            print(f'  [{mark}] {case.id:24s} calls={result["calls"]} '
                  f'{"; ".join(result["failures"])}', flush=True)

    summary = summarise(results)
    with open(args.out, 'w') as fh:
        json.dump({'summary': summary, 'results': results}, fh, indent=2)

    print('\n' + '=' * 78)
    for model, s in summary.items():
        print(f"{model:32s} {s['passed']}/{s['total']}  "
              f"calls/turn {s['avg_api_calls']}  tool {s['calculator_used_pct']}%  "
              f"tok {s['prompt_tokens']}/{s['completion_tokens']}")
        print('    ' + '  '.join(f'{k} {v}' for k, v in s['categories'].items()))
    print(f'\nfull results: {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
