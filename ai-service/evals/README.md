# Tutor model eval

Measures what backlog #97's calculator **did not** fix.

The calculator made the tutor's arithmetic sound: it can no longer assert a number
it has not computed. What stayed model-dependent is the reasoning around that
number — which expression to use, which unit to answer in, and whether to pass a
verdict at all. This set measures those, so a model change is a decision with
evidence behind it rather than a vibe.

## Running it

```bash
docker cp evals fsa-agent-ai-service-1:/app/evals
docker exec -e PYTHONPATH=/app fsa-agent-ai-service-1 \
  python3 evals/run_tutor_eval.py --out /tmp/tutor_eval_results.json
docker cp fsa-agent-ai-service-1:/tmp/tutor_eval_results.json .
```

`--models a,b,c` overrides the candidate list. Every turn is a real OpenRouter
call against the deployed tutor code and the real `2A2-1-1` lesson context, so a
full 4-model run costs a few dollars and takes 10–20 minutes.

## Scoring is deterministic, on purpose

There is no LLM judge. The whole exercise is measuring how far a model can be
trusted with a student's numeric answer, and judging that with another model just
moves the trust problem somewhere less visible. `scoring.py` checks three things:

- **value** — is the correct number stated anywhere, within the case's tolerance
- **verdict** — `confirm` / `reject` / **none**, where none means the student gave
  no answer of her own and *any* verdict is a hallucination
- **unit** — the number must arrive in the unit that was asked for, compared on
  the same tolerance so sensible rounding is not scored as a unit error

`tests/test_eval_scoring.py` covers the scorers. **Keep it that way** — the first
smoke run produced two scorer bugs that each understated a model, and both were
invisible in the totals:

1. A tutor apologising for its *own* earlier mistake ("I was wrong to push back",
   "sorry for making you recheck your work") tripped the rejection words, so a
   textbook-perfect confirmation scored as a rejection.
2. The unit check compared the expected value literally, so "37.4 kW" failed a
   case expecting 37.41 kW that the value check had already accepted.

A scorer bug is worse than no eval: it produces a confident number pointing the
wrong way. Read the failing replies before believing a score.

## Categories

| Category | What it catches |
|---|---|
| `confirm-right` | the #97 shape — a right answer must not be corrected |
| `reject-wrong` | a wrong answer must be rejected **and the right number stated**, not deflected with "show me your working" |
| `no-answer` | the student asked and answered nothing; praising her is a hallucinated verdict |
| `expression-choice` | the naive formula gives a plausible wrong number (missing √3, d² for r², sensible without latent) |
| `unit-conversion` | the answer must arrive in the unit requested |
| `rounding` | a sensibly-rounded student answer must be accepted |
| `repeat-answer` | she has already said it twice — the exact 2026-08-18 exchange |

Every expected value was computed and checked before its case was written. When
adding a case, do the same: a wrong expected value turns the eval into a machine
for producing confidently wrong recommendations.

## Known limitation

`TutorAgent` sends `max_tokens=600`, which truncates the longest worked
derivations mid-answer. It hits every model equally so the comparison stays fair,
but a case that fails only on `value` may have been cut off rather than got it
wrong — check the reply text before recording it as a reasoning failure.
