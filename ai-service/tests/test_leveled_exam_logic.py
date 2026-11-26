"""Leveled exam engine: pure logic (Plan 3, Task 2)."""
import math

from agents.leveled_exam import (CONFIG, LEVEL_NAMES, MINUTES_PER_QUESTION, free_mix, holding_back, next_level,
                                 predicted_pct, slot_counts, time_limit_seconds, verdict)

WEIGHTS = [15, 15, 10, 9, 9, 8, 7, 7, 6, 5, 5, 4]
GROUPS = [{"topic_key": f"t{i}", "exam_questions": w, "sort_order": i} for i, w in enumerate(WEIGHTS)]


def test_level_names_and_config():
    assert LEVEL_NAMES == {1: "Foundation", 2: "Core", 3: "Exam-Level", 4: "Max"}
    assert CONFIG["up_pct"] == 0.80 and CONFIG["down_pct"] == 0.50 and CONFIG["pass_pct"] == 65


def test_slot_counts_100_is_the_exact_mix_and_skips_zero_weight():
    groups = GROUPS + [{"topic_key": "zero", "exam_questions": 0, "sort_order": 99}]
    out = slot_counts(groups, 100, True)
    assert out == {g["topic_key"]: g["exam_questions"] for g in GROUPS}


def test_slot_counts_50_sums_to_50_and_alternates():
    up = slot_counts(GROUPS, 50, True)
    down = slot_counts(GROUPS, 50, False)
    for out in (up, down):
        assert sum(out.values()) == 50
        for g in GROUPS:
            assert out[g["topic_key"]] in (math.floor(g["exam_questions"] / 2), math.ceil(g["exam_questions"] / 2))
    first_odd = next(g["topic_key"] for g in GROUPS if g["exam_questions"] % 2)
    assert up[first_odd] != down[first_odd]


def test_free_mix():
    assert free_mix(10) == {2: 3, 3: 4, 4: 3}
    for n in (0, 1, 2, 7, 15):
        assert sum(free_mix(n).values()) == n


def test_next_level():
    assert next_level(2, 8, 10, None) == 3
    assert next_level(2, 4, 10, None) == 1
    assert next_level(2, 5, 10, None) == 2
    assert next_level(1, 0, 10, None) == 1
    assert next_level(4, 10, 10, None) == 4
    assert next_level(2, 3, 4, (5, 5)) == 3
    assert next_level(2, 3, 4, None) == 2


def test_predicted_pct():
    one = [{"topic_key": "a", "exam_questions": 100, "sort_order": 0}]
    assert predicted_pct({"a": {"level": 4, "correct": 10, "total": 10}}, one) == 100.0
    two = [{"topic_key": "a", "exam_questions": 60, "sort_order": 0},
           {"topic_key": "b", "exam_questions": 40, "sort_order": 1}]
    topics = {"a": {"level": 3, "correct": 5, "total": 10}, "b": {"level": 3, "correct": 4, "total": 4}}
    assert predicted_pct(topics, two) == 70.0
    assert predicted_pct({"a": {"level": 2, "correct": 0, "total": 0}, "b": {"level": 3, "correct": 0, "total": 0}}, two) == 0.0
    # one step below level 3 costs level_step
    assert predicted_pct({"a": {"level": 2, "correct": 5, "total": 10}}, one) == 40.0


def test_verdict_bands_and_most_at_max():
    groups = [{"topic_key": "a", "exam_questions": 70, "sort_order": 0},
              {"topic_key": "b", "exam_questions": 30, "sort_order": 1}]
    band, msg = verdict(85, {"a": 4, "b": 4}, groups)
    assert band == "ready" and msg == "You're ready — you're handling questions harder than the real exam."
    assert verdict(85, {"a": 4, "b": 3}, groups)[0] == "solid"          # only 70% of weight at Max
    assert verdict(85, {"a": 4, "b": 2}, groups)[0] == "solid"
    assert verdict(59.9, {"a": 2, "b": 2}, groups) == ("fail", "If you wrote this paper today, you'd likely fail.")
    assert verdict(60, {"a": 2, "b": 2}, groups) == ("close", "You could pass, but it would be close.")
    assert verdict(70, {"a": 2, "b": 2}, groups) == ("solid", "You have a solid grasp and would likely pass comfortably.")
    g3 = groups + [{"topic_key": "c", "exam_questions": 0, "sort_order": 2}]
    assert verdict(90, {"a": 4, "b": 4, "c": 1}, g3)[0] == "ready"      # zero-weight topics don't count


def test_holding_back_lowest_level_then_weight():
    groups = [{"topic_key": "a", "exam_questions": 10, "sort_order": 0},
              {"topic_key": "b", "exam_questions": 30, "sort_order": 1},
              {"topic_key": "c", "exam_questions": 20, "sort_order": 2},
              {"topic_key": "d", "exam_questions": 40, "sort_order": 3}]
    assert holding_back({"a": 1, "b": 1, "c": 2, "d": 4}, groups, n=3) == ["b", "a", "c"]
    assert holding_back({"a": 4, "b": 4, "c": 4, "d": 4}, groups) == []


def test_predicted_pct_uses_the_level_actually_served():
    one = [{"topic_key": "a", "exam_questions": 100, "sort_order": 0}]
    # student at level 2, but fallback served level-3 questions on average
    assert predicted_pct({"a": {"level": 2, "served_level": 3.0, "correct": 5, "total": 10}}, one) == 50.0


def test_time_limit_minutes_per_level():
    assert MINUTES_PER_QUESTION == {1: 1.5, 2: 1.5, 3: 2, 4: 4}
    assert time_limit_seconds([1, 2, 3, 4]) == 9 * 60
    assert time_limit_seconds([3] * 50) == 100 * 60
    assert time_limit_seconds([4] * 30 + [2] * 20) == 150 * 60


def test_time_limit_rounds_up_to_a_whole_minute():
    assert time_limit_seconds([1, 1, 1]) == 5 * 60
    assert time_limit_seconds([]) == 0
