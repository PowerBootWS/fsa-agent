// client-v2/src/components/NavigationHeader.jsx
import { useState, useEffect, useRef } from 'react';

export function NavigationHeader({
  courseOutline,
  activeLessonCode,
  onNavigate,
  prevChapter,
  nextChapter,
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const parts = activeLessonCode ? activeLessonCode.split('-') : [];
  const currentChapterNum = parts.length >= 2 ? parseInt(parts[1], 10) : 1;
  const currentChapter = courseOutline?.chapters?.find(
    c => c.chapter_num === currentChapterNum
  ) || null;

  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') setDropdownOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  function handleChapterNav(chapter) {
    if (!chapter?.objectives?.length || chapter.locked) return;
    onNavigate(chapter.objectives[0].lesson_code);
    setDropdownOpen(false);
  }

  return (
    <div className="nav-header">
      {/* Row 1: Chapter navigation */}
      <div className="nav-chapter-row">
        <button
          className="nav-chapter-arrow"
          onClick={() => handleChapterNav(prevChapter)}
          disabled={!prevChapter}
          title="Previous chapter"
        >
          ←
        </button>

        <span className="nav-chapter-label">
          {currentChapter?.label || `Chapter ${currentChapterNum}`}
        </span>

        <div className="nav-dropdown-wrap" ref={dropdownRef}>
          <button
            className="nav-chapters-btn"
            onClick={() => setDropdownOpen(o => !o)}
          >
            All Chapters ▼
          </button>
          {dropdownOpen && (
            <div className="nav-chapters-dropdown">
              {courseOutline?.chapters?.map(chapter => (
                <button
                  key={chapter.chapter_num}
                  className={`nav-dropdown-chapter${chapter.chapter_num === currentChapterNum ? ' active' : ''}${chapter.locked ? ' locked' : ''}`}
                  onClick={() => handleChapterNav(chapter)}
                  disabled={chapter.locked}
                  title={chapter.locked ? 'Complete previous chapter quiz to unlock' : undefined}
                >
                  {chapter.locked ? '🔒 ' : ''}{chapter.chapter_num}. {chapter.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          className="nav-chapter-arrow"
          onClick={() => handleChapterNav(nextChapter)}
          disabled={!nextChapter || nextChapter.locked}
          title={nextChapter?.locked ? 'Complete this chapter\'s quiz to unlock' : 'Next chapter'}
        >
          →
        </button>
      </div>

      {/* Row 2: Objective pills */}
      <div className="nav-objective-row">
        {currentChapter?.objectives?.map(obj => {
          const isActive = obj.lesson_code === activeLessonCode;
          return (
            <button
              key={obj.lesson_code}
              className={`nav-obj-pill${isActive ? ' active' : ''}${obj.locked ? ' locked' : ''}`}
              onClick={() => !isActive && !obj.locked && onNavigate(obj.lesson_code)}
              disabled={isActive || obj.locked}
              title={obj.locked ? 'Complete previous objective to unlock' : obj.title}
            >
              {obj.locked ? '🔒' : `Obj ${obj.objective_num}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
