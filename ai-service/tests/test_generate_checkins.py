"""Pure helpers of scripts/generate_checkins.py (lesson tutor redesign, slice 3)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from generate_checkins import checkin_segments, validate_card, build_messages


def test_segments_mirror_the_player_checkpoint_positions():
    # Player shows a checkpoint on arriving at index 4, 8, 12 (CHECKPOINT_INTERVAL=4).
    assert checkin_segments(list(range(13))) == [(0, 3), (4, 7), (8, 11)]
    assert checkin_segments(list(range(9))) == [(0, 3), (4, 7)]


def test_no_segments_for_objectives_too_short_to_reach_a_checkpoint():
    assert checkin_segments(list(range(4))) == []
    assert checkin_segments([]) == []


def test_valid_card_is_tidied():
    card, reason = validate_card('```json\n{"recap_points": ["Stays carry load — not the plate.", "Pitch is measured centre to centre."], '
                                 '"exercise_prompt": "Want to try a few quick questions on stays?"}\n```')
    assert reason is None
    assert card['recap_points'][0] == 'Stays carry load, not the plate.'


def test_rejects_bad_cards():
    assert validate_card('nothing')[1] == 'no JSON object'
    assert validate_card('{"recap_points": ["one"], "exercise_prompt": "x"}')[1] == '1 recap points'
    assert validate_card('{"recap_points": ["a" , "' + 'b' * 300 + '"], "exercise_prompt": "x"}')[1] == 'recap point too long'
    assert validate_card('{"recap_points": ["汽轮机", "b"], "exercise_prompt": "x"}')[1] == 'non-English output'
    assert validate_card('{"recap_points": ["a", "b"], "exercise_prompt": ""}')[1] == 'bad exercise prompt'


def test_prompt_holds_only_the_segment_slides_in_full():
    slides = [{'slide_number': i, 'title': f'T{i}', 'body': f'body {i}', 'narration': f'narr {i}'} for i in range(9)]
    user = build_messages('Objective', slides, 4, 7)[1]['content']
    assert 'body 5' in user and 'narr 7' in user
    assert 'body 2' not in user and 'body 8' not in user
    assert 'T2' in user  # earlier slides listed by title only
