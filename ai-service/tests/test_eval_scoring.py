"""Scorers for the tutor model eval.

These decide which model gets recommended, so a bug here is worse than no eval
at all. Scoring is deliberately deterministic — no LLM judge — because the whole
exercise is measuring how far a model can be trusted, and judging that with
another model just moves the trust problem.
"""
import pytest

from evals import scoring


class TestNumberExtraction:
    @pytest.mark.parametrize('text,expected', [
        ('1256.1 kJ', [1256.1]),
        ('That is 418,300 kJ', [418300.0]),
        (r'$Q = 418\,300 \text{ kJ}$', [418300.0]),
        (r'$54{,}000 = 594T_f$', [54000.0, 594.0]),
        ('about 90.9°C', [90.9]),
        ('no numbers here', []),
        ('**418.3 MJ**', [418.3]),
    ])
    def test_pulls_numbers_out_of_prose_and_latex(self, text, expected):
        assert scoring.extract_numbers(text) == pytest.approx(expected)

    def test_ignores_lesson_codes_and_ordinals(self):
        assert scoring.extract_numbers('2nd Class paper 2A2-1-1') == []


class TestStatesValue:
    def test_finds_the_value_anywhere_in_the_reply(self):
        assert scoring.states_value('I make it 1256.1 kJ', 1256.1)

    def test_tolerates_sensible_rounding(self):
        assert scoring.states_value('about 90.9 degrees', 90.909090)
        assert scoring.states_value('approximately 91°C', 90.909090, tolerance=0.005)

    def test_rejects_a_different_number(self):
        assert not scoring.states_value('I make it 1500 kJ', 1256.1)

    def test_absent_value_is_not_a_match(self):
        assert not scoring.states_value('Show me your working.', 1256.1)


class TestVerdictPolarity:
    @pytest.mark.parametrize('text', [
        "That's it, 1256.1 kJ.",
        'Exactly right, well done.',
        'Spot on.',
        'Correct — nice work.',
    ])
    def test_detects_confirmation(self, text):
        assert scoring.verdict_polarity(text) == 'confirm'

    @pytest.mark.parametrize('text', [
        'Not quite, the answer is 1256.1 kJ.',
        "That's not right.",
        'Not correct — try again.',
        'There is a small decimal error.',
    ])
    def test_detects_rejection(self, text):
        assert scoring.verdict_polarity(text) == 'reject'

    @pytest.mark.parametrize('text', [
        'Walk me through how you got that.',
        'The heat equation is Q = mcΔT. What did you multiply?',
        'Great to have you here. Shall we start with the concepts?',
    ])
    def test_no_verdict_is_none(self, text):
        assert scoring.verdict_polarity(text) is None

    def test_rejection_wins_when_both_appear(self):
        """'Not quite, but the formula is correct' is a rejection, not a confirmation."""
        assert scoring.verdict_polarity(
            'Not quite — though the formula you used is correct.') == 'reject'


class TestScoreCase:
    def _case(self, **kw):
        base = dict(id='t', category='c', message='m', expect_value=1256.1,
                    expect_verdict='confirm', unit=None)
        base.update(kw)
        return scoring.Case(**base)

    def test_confirming_a_right_answer_passes(self):
        result = scoring.score(self._case(), "That's it, 1256.1 kJ.", calls=2, expressions=[])
        assert result['passed'] is True
        assert result['failures'] == []

    def test_correcting_a_right_answer_fails(self):
        """The #97 shape: student is right and is told she is wrong."""
        result = scoring.score(
            self._case(), 'Not quite, there is a small decimal error.', calls=2, expressions=[])
        assert result['passed'] is False
        assert 'verdict' in ' '.join(result['failures'])

    def test_rejecting_without_stating_the_right_number_fails(self):
        result = scoring.score(
            self._case(expect_verdict='reject'),
            'Not quite — walk me through your working.', calls=2, expressions=[])
        assert result['passed'] is False
        assert any('value' in f for f in result['failures'])

    def test_a_verdict_where_none_was_invited_fails(self):
        """Student asked a question and gave no answer; praising it is a hallucination."""
        result = scoring.score(
            self._case(expect_verdict=None, expect_value=418.3),
            'That works out to 418.3 MJ. Exactly right!', calls=2, expressions=[])
        assert result['passed'] is False
        assert any('unsolicited' in f for f in result['failures'])

    def test_wrong_unit_fails(self):
        result = scoring.score(
            self._case(expect_value=418.3, unit='MJ', expect_verdict=None),
            'That is 418300 kJ.', calls=2, expressions=[])
        assert result['passed'] is False

    @pytest.mark.parametrize('reply,value,unit', [
        ('The efficiency is 77.67%', 77.67, '%'),
        ('That gives 2.22 kg/s of steam', 2.22, 'kg/s'),
        ('Force is about 58.9 kN', 58.9, 'kN'),
    ])
    def test_non_word_units_are_matched(self, reply, value, unit):
        """'%' and 'kg/s' end in non-word characters; a \\b anchor never matches them."""
        result = scoring.score(
            self._case(expect_value=value, unit=unit, expect_verdict=None),
            reply, calls=2, expressions=[])
        assert result['passed'] is True, result['failures']

    def test_right_unit_passes(self):
        result = scoring.score(
            self._case(expect_value=418.3, unit='MJ', expect_verdict=None),
            'That is 418,300 kJ, which is 418.3 MJ.', calls=2, expressions=[])
        assert result['passed'] is True


class TestScorerDoesNotMisreadSelfCorrection:
    """Found in the first eval smoke run: both bugs would have understated a model.

    1. A tutor apologising for its OWN earlier mistake ("I was wrong to push back",
       "I'm sorry for making you recheck your work") tripped the rejection words,
       so a textbook-perfect confirmation scored as a rejection.
    2. The unit check compared the rendered expected value literally, so a reply
       saying "37.4 kW" failed a case expecting 37.41 — even though the value
       check accepted it on tolerance.
    """

    @pytest.mark.parametrize('reply', [
        '**1256.1 kJ is exactly right.** I was wrong to push back on it, and I am sorry.',
        'I owe you an apology. You were absolutely right — 90.9 °C.',
        "You're right, and I'm sorry for making you recheck your work.",
    ])
    def test_apologising_for_its_own_error_is_a_confirmation(self, reply):
        assert scoring.verdict_polarity(reply) == 'confirm'

    def test_a_real_rejection_is_still_a_rejection(self):
        assert scoring.verdict_polarity(
            'Not quite — though the formula you used is correct.') == 'reject'

    @pytest.mark.parametrize('reply,value,unit', [
        ('the efficiency is **77.7%** (rounded)', 77.67, '%'),
        ('approximately **37.4 kW** (37,412 W)', 37.41, 'kW'),
    ])
    def test_unit_check_honours_the_same_tolerance_as_the_value_check(self, reply, value, unit):
        case = scoring.Case('t', 'c', 'm', expect_value=value, unit=unit,
                            expect_verdict=None, tolerance=0.02)
        result = scoring.score(case, reply, calls=1, expressions=[])
        assert result['passed'] is True, result['failures']

    def test_the_right_number_in_the_wrong_unit_still_fails(self):
        case = scoring.Case('t', 'c', 'm', expect_value=418.3, unit='MJ',
                            expect_verdict=None, tolerance=0.02)
        result = scoring.score(case, 'That is 418,300 kJ.', calls=1, expressions=[])
        assert result['passed'] is False


class TestRejectionPhrasingTheFirstRunMissed:
    """The full run scored reject-wrong at 1-3 of 4 across every model, which
    looked like a systemic model weakness and was mostly a scorer gap.

    Reading the replies: "I get about 90.9 °C, not 110 °C" and "that works out
    to 112,850 kJ, not 45,140" are textbook rejections. The scorer returned None
    for both, because its vocabulary had no contrastive forms in it. A model was
    being marked down for the clearest possible way of saying "you are wrong".
    """

    @pytest.mark.parametrize('reply', [
        'I get about **90.9 °C**, not 110 °C.',
        'That works out to **112,850 kJ**, not 45,140.',
        '50 kg x 2257 kJ/kg actually gives 112 850 kJ.',
        'The answer is 1256.1 kJ rather than 1500 kJ.',
    ])
    def test_contrastive_correction_is_a_rejection(self, reply):
        assert scoring.verdict_polarity(reply) == 'reject'

    def test_stating_both_numbers_is_a_rejection_whatever_the_wording(self):
        """Structural, not vocabulary: right number + the student's number = a correction."""
        case = scoring.Case('t', 'reject-wrong', 'm', expect_value=90.909,
                            student_value=110, expect_verdict='reject', tolerance=0.02)
        reply = 'Let us balance the heat. Brass gives up what aluminium takes on, so 90.9 °C — you had 110 °C.'
        result = scoring.score(case, reply, calls=2, expressions=[])
        assert result['passed'] is True, result['failures']

    def test_a_deflection_that_states_no_number_still_fails(self):
        """'Show me your working' is the behaviour the case exists to catch."""
        case = scoring.Case('t', 'reject-wrong', 'm', expect_value=90.909,
                            student_value=110, expect_verdict='reject', tolerance=0.02)
        result = scoring.score(
            case, 'Walk me through the numbers you used and I will follow along.',
            calls=2, expressions=[])
        assert result['passed'] is False

    @pytest.mark.parametrize('text,expected', [
        ('112 850 kJ', [112850.0]),
        ('54 000 = 594', [54000.0, 594.0]),
        ('5 kg and 60 C', [5.0, 60.0]),
    ])
    def test_space_separated_thousands_are_one_number(self, text, expected):
        assert scoring.extract_numbers(text) == pytest.approx(expected)
