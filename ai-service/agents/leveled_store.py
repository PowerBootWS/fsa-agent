"""Leveled practice exam: database access (backlog #147, Plan 3).

Which engine a sitting uses, the topic groups, students' topic levels, question selection
with level fallback, and the leveled_exam_sittings record (migration 040). Pure logic lives
in agents/leveled_exam.py.
"""
import json
import logging
import os
import random

from agents.leveled_exam import CONFIG

log = logging.getLogger(__name__)

_POOL = ("standalone AND exam_level IS NOT NULL AND options IS NOT NULL "
         "AND jsonb_array_length(options) > 0")


def leveled_papers() -> set:
    return {p.strip() for p in os.getenv('LEVELED_PAPERS', '').split(',') if p.strip()}


class LeveledStore:
    def __init__(self, researcher):
        self.researcher = researcher

    def _q(self, sql, params=(), one=False, write=False):
        conn = self.researcher._get_connection()
        try:
            cur = conn.cursor()
            cur.execute(sql, params)
            rows = cur.fetchall() if cur.description else None
            if write:
                conn.commit()
            if rows is None:
                return None
            return (rows[0] if rows else None) if one else rows
        finally:
            conn.close()

    # --- engine and groups ------------------------------------------------------------------

    def engine_for(self, email: str, paper: str, lead_magnet: bool) -> str:
        if paper not in leveled_papers():
            return 'adaptive'
        if lead_magnet:
            return 'leveled'
        row = self._q('SELECT exam_engine FROM platform_users WHERE lower(email) = lower(%s)', (email,), one=True)
        return 'adaptive' if row and row['exam_engine'] == 'adaptive' else 'leveled'

    def topic_groups(self, paper: str) -> list:
        return [dict(r) for r in self._q(
            "SELECT topic_key, display_name, exam_questions, chapter_ids, sort_order FROM exam_topic_groups "
            "WHERE paper_code = %s ORDER BY sort_order", (paper,))]

    # --- levels -----------------------------------------------------------------------------

    def levels(self, email: str, paper: str) -> dict:
        have = {r['topic_key']: r['level'] for r in self._q(
            'SELECT topic_key, level FROM student_topic_levels WHERE user_email = %s AND paper_code = %s',
            (email, paper))}
        return {g['topic_key']: have.get(g['topic_key'], CONFIG['start_level'])
                for g in self.topic_groups(paper) if g['exam_questions'] > 0}

    def save_levels(self, email: str, paper: str, levels: dict) -> None:
        for topic, level in levels.items():
            self._q("""INSERT INTO student_topic_levels (user_email, paper_code, topic_key, level, updated_at)
                       VALUES (%s, %s, %s, %s, now())
                       ON CONFLICT (user_email, paper_code, topic_key)
                       DO UPDATE SET level = EXCLUDED.level, updated_at = now()""",
                    (email, paper, topic, int(level)), write=True)

    # --- selection --------------------------------------------------------------------------

    def recent_ids(self, email: str, paper: str, sittings: int = 3) -> set:
        rows = self._q("""SELECT question_ids FROM leveled_exam_sittings WHERE user_email = %s AND paper_code = %s
                          ORDER BY started_at DESC, id DESC LIMIT %s""", (email, paper, sittings))
        return {i for r in rows for i in (r['question_ids'] or [])}

    def pick(self, paper: str, group: dict, level: int, n: int, avoid: set, taken: set) -> tuple:
        """n questions for one topic: its level first, then level-1, level+1, then any level;
        within each, questions not in avoid before the rest. Never returns ids in taken."""
        rows = self._q(
            f"""SELECT id, question_text, options, correct_answer, explanation, difficulty, topic, question_type,
                       chapter_id, course_id, lesson_code, exam_level
                  FROM questions WHERE course_id = %s AND chapter_id = ANY(%s) AND {_POOL}""",
            (paper, list(group['chapter_ids'])))
        tiers = [level, level - 1, level + 1]

        def rank(r):
            lv = r['exam_level']
            return (tiers.index(lv) if lv in tiers else 3, r['id'] in avoid, random.random())

        chosen = sorted((dict(r) for r in rows if r['id'] not in taken), key=rank)[:n]
        notes = []
        for lv in sorted({q['exam_level'] for q in chosen if q['exam_level'] != level}):
            k = sum(1 for q in chosen if q['exam_level'] == lv)
            notes.append(f"{paper} {group['topic_key']}: {k} from level {lv} (wanted level {level})")
        if len(chosen) < n:
            notes.append(f"{paper} {group['topic_key']}: only {len(chosen)} of {n} available")
        for note in notes:
            log.warning('leveled pick fallback: %s', note)
        for q in chosen:
            q['topic_key'] = group['topic_key']
        return chosen, notes

    # --- sittings ---------------------------------------------------------------------------

    def next_round_up_first(self, email: str, paper: str) -> bool:
        row = self._q("""SELECT round_up_first FROM leveled_exam_sittings WHERE user_email = %s AND paper_code = %s
                         ORDER BY started_at DESC, id DESC LIMIT 1""", (email, paper), one=True)
        return True if row is None else not row['round_up_first']

    def last_topics(self, email: str, paper: str):
        row = self._q("""SELECT topics FROM leveled_exam_sittings WHERE user_email = %s AND paper_code = %s
                           AND status IN ('completed', 'timed_out') AND NOT lead_magnet
                         ORDER BY completed_at DESC, id DESC LIMIT 1""", (email, paper), one=True)
        return row['topics'] if row else None

    def start_sitting(self, email, paper, length, lead_magnet, round_up_first, question_ids) -> int:
        row = self._q("""INSERT INTO leveled_exam_sittings (user_email, paper_code, length, lead_magnet,
                                                            round_up_first, question_ids)
                         VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
                      (email, paper, length, bool(lead_magnet), bool(round_up_first), list(question_ids)),
                      one=True, write=True)
        return row['id']

    def finish_sitting(self, sitting_id, status, attempt_id, topics, level_changes, predicted_pct, verdict_band) -> None:
        self._q("""UPDATE leveled_exam_sittings
                      SET status = %s, attempt_id = %s, topics = %s, level_changes = %s, predicted_pct = %s,
                          verdict_band = %s, completed_at = now()
                    WHERE id = %s AND status = 'in_progress'""",
                (status, attempt_id, json.dumps(topics), json.dumps(level_changes), predicted_pct, verdict_band,
                 sitting_id), write=True)
