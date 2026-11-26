"""Leveled practice exam: one sitting, start to results (backlog #147, Plan 3).

The orchestrator calls start() when a leveled sitting begins and finish() when it ends
(all answered or time up). Selection, level movement and the verdict come from
agents/leveled_exam.py; the database from agents/leveled_store.py.
"""
import random

from agents.leveled_exam import (LEVEL_NAMES, free_mix, holding_back, next_level, predicted_pct,
                                 slot_counts, time_limit_seconds, verdict)


def start(store, user: str, paper: str, length: int, lead_magnet: bool) -> tuple:
    """(questions in serving order, meta). Every question carries topic_key and exam_level.
    meta = {sitting_id, levels, groups, length, time_limit_s, max_count}."""
    groups = store.topic_groups(paper)
    levels = {g['topic_key']: 2 for g in groups if g['exam_questions'] > 0} if lead_magnet \
        else store.levels(user, paper)
    round_up = store.next_round_up_first(user, paper)
    counts = slot_counts(groups, length, round_up)
    avoid = set() if lead_magnet else store.recent_ids(user, paper)
    taken, questions = set(), []
    for g in groups:
        n = counts.get(g['topic_key'], 0)
        if not n:
            continue
        plan = free_mix(n) if lead_magnet else {levels[g['topic_key']]: n}
        for lv, k in plan.items():
            if not k:
                continue
            qs, _notes = store.pick(paper, g, lv, k, avoid, taken)
            taken.update(q['id'] for q in qs)
            questions.extend(qs)
    if not questions:
        return [], None
    random.shuffle(questions)
    sitting_id = store.start_sitting(user, paper, length, lead_magnet, round_up, [q['id'] for q in questions])
    served = [q['exam_level'] for q in questions]
    return questions, {'sitting_id': sitting_id, 'levels': levels,
                       'groups': [dict(g, chapter_ids=list(g['chapter_ids'])) for g in groups], 'length': length,
                       'time_limit_s': time_limit_seconds(served), 'max_count': served.count(4)}


def topic_results(questions: list, results: list, levels: dict) -> dict:
    """Per topic: the student's level, the mean level actually served, correct, total and answered.
    Every served question counts toward the score (an unanswered one is wrong); only answered
    ones move a level, so running out of time never drops one."""
    correct = {r['question_id']: r['correct'] for r in results}
    answered = {r['question_id'] for r in results if r.get('selected_index') is not None}
    out = {}
    for q in questions:
        t = out.setdefault(q['topic_key'], {'level': levels.get(q['topic_key'], 2), 'served': [],
                                            'correct': 0, 'total': 0, 'answered': 0})
        t['served'].append(q.get('exam_level') or t['level'])
        t['total'] += 1
        t['answered'] += 1 if q['id'] in answered else 0
        t['correct'] += 1 if correct.get(q['id']) else 0
    for t in out.values():
        t['served_level'] = round(sum(t.pop('served')) / t['total'], 2)
    return out


def finish(store, user: str, paper: str, meta: dict, questions: list, results: list,
           status: str, attempt_id, lead_magnet: bool) -> dict:
    """Moves levels (not for the free exam), records the sitting, returns the results-screen
    block: {topics, predicted_pct, band, message, holding_back, pass_pct}."""
    groups, levels = meta['groups'], meta['levels']
    topics = topic_results(questions, results, levels)
    if lead_magnet:
        new_levels = {k: next_level(2, t['correct'], t['answered'], None) for k, t in topics.items()}
    else:
        prev = store.last_topics(user, paper) or {}
        new_levels = {k: (next_level(t['level'], t['correct'], t['answered'],
                                     (prev[k]['correct'], prev[k].get('answered', prev[k]['total'])) if k in prev else None)
                          if t['answered'] else t['level'])
                      for k, t in topics.items()}
        store.save_levels(user, paper, new_levels)
    pred = predicted_pct(topics, groups)
    band, message = verdict(pred, {k: t['level'] for k, t in topics.items()}, groups)
    changes = {k: [topics[k]['level'], v] for k, v in new_levels.items() if v != topics[k]['level']}
    store.finish_sitting(meta['sitting_id'], status, attempt_id, topics, changes, pred, band)
    names = {g['topic_key']: g['display_name'] for g in groups}
    rows = []
    for g in groups:
        k = g['topic_key']
        if k not in topics:
            continue
        t = topics[k]
        # Free exam: no level history, so show the level the student would start at.
        shown = new_levels[k] if lead_magnet else t['level']
        rows.append({'topic_key': k, 'name': g['display_name'], 'weight': g['exam_questions'],
                     'level': shown, 'level_name': LEVEL_NAMES[shown],
                     'new_level': new_levels[k], 'new_level_name': LEVEL_NAMES[new_levels[k]],
                     'correct': t['correct'], 'total': t['total']})
    return {'topics': rows, 'predicted_pct': pred, 'band': band, 'message': message,
            'holding_back': [names[k] for k in holding_back(new_levels, groups)], 'pass_pct': 65,
            'lead_magnet': bool(lead_magnet)}


def timing_summary(meta: dict, results: list, total: int) -> dict:
    """Timed sitting: the limit, how long the student took (their clock at the last answer) and
    how far they had got when the limit passed. Answers after the limit still count elsewhere."""
    limit = meta['time_limit_s']
    times = [r.get('elapsed_s') for r in results if r.get('elapsed_s') is not None]
    taken = times[-1] if times else None
    in_time = [r for r in results if r.get('elapsed_s') is not None and r['elapsed_s'] <= limit
               and r.get('selected_index') is not None]
    return {'limit_s': limit, 'max_count': meta['max_count'], 'taken_s': taken,
            'over_s': max(0, taken - limit) if taken is not None else None,
            'answered_in_time': len(in_time), 'correct_in_time': sum(1 for r in in_time if r['correct']),
            'total': total}


def debrief_prompt(first_name: str, paper: str, leveled: dict) -> str:
    """The tutor's spoken debrief for a leveled sitting: topics and levels, no chapters."""
    lines = []
    for t in leveled['topics']:
        if leveled.get('lead_magnet'):
            lines.append(f"- {t['name']}: {t['correct']}/{t['total']}; they would start at {t['level_name']}")
            continue
        change = (f", moving to {t['new_level_name']}" if t['new_level'] != t['level'] else '')
        lines.append(f"- {t['name']}: {t['correct']}/{t['total']} at {t['level_name']}{change}")
    hold = ', '.join(leveled['holding_back']) or 'none'
    timing = leveled.get('timing') or {}
    time_line = ''
    if timing.get('taken_s') is not None:
        lim, took = round(timing['limit_s'] / 60), round(timing['taken_s'] / 60)
        extra = (f" (it included extra time for {timing['max_count']} Max questions)" if timing['max_count'] else '')
        over = (f"{round(timing['over_s'] / 60)} min over the limit; by the limit they had answered "
                f"{timing['answered_in_time']} of {timing['total']}" if timing['over_s'] else 'within the limit')
        time_line = (f"Timed sitting: {lim} min allowed{extra}; they took {took} min, {over}. Understanding comes "
                     f"first: every answer, including any after the limit, counts toward their levels. If they "
                     f"went over, mention it briefly and reassure them that speed comes once the material is "
                     f"solid.\n")
    if leveled.get('lead_magnet'):
        ask = ("This was the free practice exam. Explain what the result means, name the topics holding them "
               "back, and invite them to sign up to build those topics up level by level with lessons and an AI tutor.")
    else:
        ask = ("Explain what the result means, celebrate any topic that moved up, name the topics holding them "
               "back and what to work on next, and invite them to ask about any question.")
    return (
        f"{first_name} just finished a {paper} practice exam that follows the typical real-exam topic mix. "
        f"Each topic is served at the student's own level (Foundation, Core, Exam-Level, Max; Exam-Level is a "
        f"typical real exam question).\n"
        f"Results by topic:\n" + '\n'.join(lines) + "\n"
        f"Predicted real-exam score: {leveled['predicted_pct']}% (pass mark 65%). "
        f"Verdict shown on screen: \"{leveled['message']}\"\nTopics holding them back: {hold}.\n"
        f"{time_line}"
        f"{ask} Talk about topics, never chapters. Do not promise a pass or quote the exact structure of "
        f"the SOPEEC exam."
    )
