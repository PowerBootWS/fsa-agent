// fsa-agent/client-v2/src/hooks/useAudio.js
import { useRef, useState, useEffect, useCallback } from 'react';

/**
 * Manages an HTML5 Audio element for a given src URL.
 * Returns { audioRef, playing, ended, muted, toggleMute, play, pause, currentTimeMs }
 * `ended` is true once the current src has played to the end, until it plays
 * again or the src changes (lesson autoplay advances on it).
 */
const ALLOWED_RATES = [1, 1.25, 1.5];

function initialRate() {
  try {
    const v = parseFloat(localStorage.getItem('fsa_narration_rate'));
    return ALLOWED_RATES.includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

export function useAudio(src) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(initialRate);

  // Create audio element once
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    audio.addEventListener('play', () => { setPlaying(true); setEnded(false); });
    audio.addEventListener('pause', () => setPlaying(false));
    audio.addEventListener('ended', () => { setPlaying(false); setEnded(true); });
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
    setEnded(false);
  }, [src]);

  // Sync muted state to element
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  // Sync playback rate to element (re-applied on src change — a new src resets it)
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate, src]);

  const setPlaybackRate = useCallback((rate) => {
    const r = ALLOWED_RATES.includes(rate) ? rate : 1;
    setPlaybackRateState(r);
    try { localStorage.setItem('fsa_narration_rate', String(r)); } catch { /* ignore */ }
  }, []);

  const play = useCallback(() => {
    if (audioRef.current && !muted) {
      audioRef.current.play().catch(() => {});
    }
  }, [muted]);

  const pause = useCallback(() => {
    if (audioRef.current) audioRef.current.pause();
  }, []);

  const toggleMute = useCallback(() => setMuted(m => !m), []);

  return { audioRef, playing, ended, muted, toggleMute, play, pause, currentTimeMs, playbackRate, setPlaybackRate };
}
