import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agents.orchestrator import Orchestrator


def test_weighted_allocation_respects_total_when_more_chapters_than_total():
    """
    56 chapters (4A-scale), 25 requested questions, all chapters weighted
    (weights truthy). Found live: the old min_per_chapter=1 floor made this
    always return len(chapters) questions instead of `total`, silently
    ignoring the student's chosen exam length.
    """
    orch = Orchestrator()
    chapters = [f'4A-{i}' for i in range(1, 57)]
    weights = {'4A-1': {'accuracy': 0.5, 'total': 4}}

    alloc = orch._compute_chapter_allocations(chapters, 25, weights)

    assert sum(alloc.values()) == 25
    assert all(count >= 0 for count in alloc.values())


def test_weighted_allocation_still_covers_every_chapter_when_total_is_large_enough():
    """Unchanged behavior: 6 chapters (2nd-Class-scale), 50 requested — every
    chapter still gets at least 1 question, matching the pre-fix guarantee."""
    orch = Orchestrator()
    chapters = ['2B1-1', '2B1-2', '2B1-3', '2B1-4', '2B1-5', '2B1-6']
    weights = {'2B1-1': {'accuracy': 0.5, 'total': 4}}

    alloc = orch._compute_chapter_allocations(chapters, 50, weights)

    assert sum(alloc.values()) == 50
    assert all(count >= 1 for count in alloc.values())


def test_weighted_allocation_favors_low_accuracy_chapters_when_total_is_short():
    """When total < len(chapters), the weak chapter should still be favored
    over chapters with no history (default weight 0.5)."""
    orch = Orchestrator()
    chapters = [f'4A-{i}' for i in range(1, 11)]  # 10 chapters
    weights = {'4A-1': {'accuracy': 0.0, 'total': 4}}  # very weak

    alloc = orch._compute_chapter_allocations(chapters, 5, weights)

    assert sum(alloc.values()) == 5
    assert alloc['4A-1'] >= max(alloc[c] for c in chapters if c != '4A-1')
