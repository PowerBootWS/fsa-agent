import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.orchestrator import Orchestrator
from agents.researcher import Researcher


def make_researcher():
    r = Researcher.__new__(Researcher)
    r.db_config = {}
    return r


# `_compute_chapter_allocations` exists twice — Orchestrator's copy only feeds
# the debrief's "next exam preview" (display-only); Researcher's copy is the
# one `get_exam_questions` actually calls to build a real exam's question set.
# Both had the identical bug and both need identical coverage, or a fix to one
# silently leaves the other (the one that matters for real exams) broken —
# exactly what happened on the first pass at this fix.
ALLOCATORS = [
    ('orchestrator', lambda: Orchestrator()),
    ('researcher', make_researcher),
]


def test_weighted_allocation_respects_total_when_more_chapters_than_total():
    """
    56 chapters (4A-scale), 25 requested questions, all chapters weighted
    (weights truthy). Found live: the old min_per_chapter=1 floor made this
    always return len(chapters) questions instead of `total`, silently
    ignoring the student's chosen exam length.
    """
    chapters = [f'4A-{i}' for i in range(1, 57)]
    weights = {'4A-1': {'accuracy': 0.5, 'total': 4}}

    for name, make in ALLOCATORS:
        alloc = make()._compute_chapter_allocations(chapters, 25, weights)
        assert sum(alloc.values()) == 25, f'{name}: expected 25, got {sum(alloc.values())}'
        assert all(count >= 0 for count in alloc.values()), name


def test_weighted_allocation_still_covers_every_chapter_when_total_is_large_enough():
    """Unchanged behavior: 6 chapters (2nd-Class-scale), 50 requested — every
    chapter still gets at least 1 question, matching the pre-fix guarantee."""
    chapters = ['2B1-1', '2B1-2', '2B1-3', '2B1-4', '2B1-5', '2B1-6']
    weights = {'2B1-1': {'accuracy': 0.5, 'total': 4}}

    for name, make in ALLOCATORS:
        alloc = make()._compute_chapter_allocations(chapters, 50, weights)
        assert sum(alloc.values()) == 50, name
        assert all(count >= 1 for count in alloc.values()), name


def test_weighted_allocation_favors_low_accuracy_chapters_when_total_is_short():
    """When total < len(chapters), the weak chapter should still be favored
    over chapters with no history (default weight 0.5)."""
    chapters = [f'4A-{i}' for i in range(1, 11)]  # 10 chapters
    weights = {'4A-1': {'accuracy': 0.0, 'total': 4}}  # very weak

    for name, make in ALLOCATORS:
        alloc = make()._compute_chapter_allocations(chapters, 5, weights)
        assert sum(alloc.values()) == 5, name
        assert alloc['4A-1'] >= max(alloc[c] for c in chapters if c != '4A-1'), name
