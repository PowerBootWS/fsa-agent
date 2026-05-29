// fsa-agent/client-v2/src/hooks/useAudio.js
import { useRef, useState, useEffect, useCallback } from 'react';

/**
 * Manages an HTML5 Audio element for a given src URL.
 * Returns { audioRef, playing, muted, toggleMute, play, pause, currentTimeMs }
 */
export function useAudio(src) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);

  // Create audio element once
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    audio.addEventListener('play', () => setPlaying(true));
    audio.addEventListener('pause', () => setPlaying(false));
    audio.addEventListener('ended', () => setPlaying(false));
    audio.addEventListener('timeupdate', () => {
      setCurrentTimeMs(Math.floor(audio.currentTime * 1000));
    });
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, []);

  // Update src when it changes; reset playback state
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.src = src || '';
    setCurrentTimeMs(0);
    setPlaying(false);
  }, [src]);

  // Sync muted state to element
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  const play = useCallback(() => {
    if (audioRef.current && !muted) {
      audioRef.current.play().catch(() => {});
    }
  }, [muted]);

  const pause = useCallback(() => {
    if (audioRef.current) audioRef.current.pause();
  }, []);

  const toggleMute = useCallback(() => setMuted(m => !m), []);

  return { audioRef, playing, muted, toggleMute, play, pause, currentTimeMs };
}
