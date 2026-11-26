"""Leveled practice exam: pure logic (backlog #147, Plan 3).

Every sitting keeps the paper's typical topic mix (exam_topic_groups.exam_questions per
100 questions); what adapts is the difficulty level served in each topic. Nothing here
touches the database or the LLM. Design:
docs/superpowers/specs/2026-11-17-leveled-practice-exams-design.md, sections 4-6.
"""
import math

LEVEL_NAMES = {1: 'Foundation', 2: 'Core', 3: 'Exam-Level', 4: 'Max'}

# Tunable after the pilot.
CONFIG = {
    'up_pct': 0.80,        # at or above: up one level
    'down_pct': 0.50,      # below: down one level
    'min_questions': 5,    # fewer in a sitting: judge on the last two sittings combined
    'level_step': 0.10,    # predicted level-3 accuracy shift per level away from 3
    'pass_pct': 65,
    'start_level': 2,
    'free_mix': (0.30, 0.40, 0.30),   # free exam: levels 2, 3, 4
    'ready_weight': 0.75,  # share of exam weight that must be at Max for "ready"
}

# Timed sittings: the clock is the sum of these over the questions actually served, so a
# student at Max in many topics gets more time (Max questions are harder than the real exam).
MINUTES_PER_QUESTION = {1: 1.5, 2: 1.5, 3: 2, 4: 4}


def time_limit_seconds(levels: list) -> int:
    """Time limit for a sitting from each served question's level, rounded up to a whole minute."""
    return math.ceil(sum(MINUTES_PER_QUESTION[lv] for lv in levels)) * 60


VERDICTS = {
    'fail': "If you wrote this paper today, you'd likely fail.",
    'close': 'You could pass, but it would be close.',
    'solid': 'You have a solid grasp and would likely pass comfortably.',
    'ready': "You're ready — you're handling questions harder than the real exam.",
}


def _weighted(groups: list) -> list:
    return sorted((g for g in groups if g['exam_questions'] > 0), key=lambda g: g['sort_order'])


def slot_counts(groups: list, length: int, round_up_first: bool) -> dict:
    """Questions per topic for a sitting. 100 = the typical mix exactly; 50 = each topic
    halved, odd halves rounded up and down alternately (so the total is exactly 50),
    starting with up when round_up_first. The caller flips round_up_first between sittings."""
    out = {}
    up = round_up_first
    for g in _weighted(groups):
        n = g['exam_questions']
        if length == 100:
            out[g['topic_key']] = n
        elif n % 2:
            out[g['topic_key']] = math.ceil(n / 2) if up else n // 2
            up = not up
        else:
            out[g['topic_key']] = n // 2
    return out


def free_mix(n: int) -> dict:
    """Free exam (no history): a topic's n slots split 30/40/30 over levels 2/3/Max,
    largest remainder, ties to level 3."""
    shares = dict(zip((2, 3, 4), CONFIG['free_mix']))
    out = {lv: math.floor(n * s) for lv, s in shares.items()}
    left = n - sum(out.values())
    order = sorted(shares, key=lambda lv: (-(n * shares[lv] - out[lv]), lv != 3))
    for lv in order[:left]:
        out[lv] += 1
    return out


def next_level(level: int, correct: int, total: int, prev) -> int:
    """Level after a completed sitting. prev = (correct, total) of the same topic in the
    previous completed sitting, used only when this sitting had too few questions."""
    if total < CONFIG['min_questions']:
        if not prev:
            return level
        correct, total = correct + prev[0], total + prev[1]
    if total <= 0:
        return level
    acc = correct / total
    if acc >= CONFIG['up_pct']:
        return min(4, level + 1)
    if acc < CONFIG['down_pct']:
        return max(1, level - 1)
    return level


def predicted_pct(topics: dict, groups: list) -> float:
    """Estimated real-exam score: each topic's accuracy at the level served, shifted to
    level 3 by level_step per level, weighted by the topic's exam share."""
    weight = total = 0.0
    for g in _weighted(groups):
        t = topics.get(g['topic_key'])
        if not t:
            continue
        acc = t['correct'] / t['total'] if t['total'] else 0.0
        served = t.get('served_level', t['level'])
        adj = min(1.0, max(0.0, acc + CONFIG['level_step'] * (served - 3)))
        total += adj * g['exam_questions']
        weight += g['exam_questions']
    return round(100 * total / weight, 1) if weight else 0.0


def _most_at_max(levels: dict, groups: list) -> bool:
    w = _weighted(groups)
    all_w = sum(g['exam_questions'] for g in w)
    at_max = sum(g['exam_questions'] for g in w if levels.get(g['topic_key'], 0) >= 4)
    none_low = all(levels.get(g['topic_key'], 0) >= 3 for g in w)
    return bool(all_w) and at_max / all_w >= CONFIG['ready_weight'] and none_low


def verdict(pred: float, levels: dict, groups: list) -> tuple:
    if pred < 60:
        band = 'fail'
    elif pred < 70:
        band = 'close'
    elif pred >= 80 and _most_at_max(levels, groups):
        band = 'ready'
    else:
        band = 'solid'
    return band, VERDICTS[band]


def holding_back(levels: dict, groups: list, n: int = 3) -> list:
    """Topics below Max holding the verdict back: lowest level first, then biggest exam share."""
    below = [g for g in _weighted(groups) if levels.get(g['topic_key'], CONFIG['start_level']) < 4]
    below.sort(key=lambda g: (levels.get(g['topic_key'], CONFIG['start_level']), -g['exam_questions']))
    return [g['topic_key'] for g in below[:n]]
