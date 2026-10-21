import random
from collections import Counter

from option_order import shuffle_options


def test_correct_text_is_preserved_and_positions_spread():
    rng = random.Random(1)
    positions = Counter()
    for _ in range(4000):
        opts, ans = shuffle_options(['right', 'w1', 'w2', 'w3'], 0, rng=rng)
        assert opts[ans] == 'right'
        assert sorted(opts) == sorted(['right', 'w1', 'w2', 'w3'])
        positions[ans] += 1
    assert all(800 < positions[i] < 1200 for i in range(4)), positions


def test_position_dependent_questions_are_left_alone():
    opts = ['Pumps', 'Valves', 'Both A and B', 'Neither']
    assert shuffle_options(opts, 2) == (opts, 2)
    assert shuffle_options(['x', 'y', 'z', 'All of the above'], 3) == (['x', 'y', 'z', 'All of the above'], 3)
    assert shuffle_options(['1', '2', '3', '4'], 1, explanation='Option B is the only one that...') == (['1', '2', '3', '4'], 1)


def test_malformed_input_is_returned_unchanged():
    assert shuffle_options([], 0) == ([], 0)
    assert shuffle_options(['a', 'b'], 5) == (['a', 'b'], 5)
