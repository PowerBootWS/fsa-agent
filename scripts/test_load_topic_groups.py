from collections import defaultdict

from load_topic_groups import DEFAULT_CSV, parse_topic_groups, validate

IN_SCOPE = ['2A1', '2A2', '2A3', '2B1', '2B2', '2B3', '3A1', '3A2', '3B1', '3B2']


def _by_paper(groups):
    out = defaultdict(list)
    for g in groups:
        out[g.paper_code].append(g)
    return out


def test_2b1_has_six_groups_summing_100():
    groups = _by_paper(parse_topic_groups(DEFAULT_CSV, ['2B1']))['2B1']
    assert len(groups) == 6
    assert sum(g.exam_questions for g in groups) == 100


def test_2b1_steam_turbines():
    g = _by_paper(parse_topic_groups(DEFAULT_CSV, ['2B1']))['2B1'][0]
    assert g.display_name == 'Steam Turbines & Condensers'
    assert g.topic_key == 'steam-turbines-condensers'
    assert g.exam_questions == 30
    assert g.chapter_ids == ['2B1-1', '2B1-2', '2B1-3', '2B1-4']
    assert g.sort_order == 0


def test_quoted_cluster_names_parse():
    by_paper = _by_paper(parse_topic_groups(DEFAULT_CSV, IN_SCOPE))
    assert sorted(by_paper) == sorted(IN_SCOPE)
    for paper, groups in by_paper.items():
        assert sum(g.exam_questions for g in groups) == 100, paper


def test_zero_question_rows_kept():
    groups = _by_paper(parse_topic_groups(DEFAULT_CSV, ['3A1']))['3A1']
    math = [g for g in groups if g.display_name == 'Math foundations']
    assert len(math) == 1 and math[0].exam_questions == 0


def test_out_of_scope_classes_skipped():
    papers = {g.paper_code for g in parse_topic_groups(DEFAULT_CSV, IN_SCOPE)}
    assert '5th' not in papers and '1B4' not in papers


def test_validate_flags_unmapped_chapter():
    groups = parse_topic_groups(DEFAULT_CSV, ['2B1'])
    db_chapters = {'2B1': {f'2B1-{n}' for n in range(1, 13)}}
    errors = validate(groups, db_chapters)
    assert any('2B1-12' in e for e in errors)
    db_chapters = {'2B1': {f'2B1-{n}' for n in range(1, 12)}}
    assert validate(groups, db_chapters) == []
