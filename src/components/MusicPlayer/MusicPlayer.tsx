import { useEffect, useRef, useState } from 'react';

const MAX_BACKGROUND_TRACKS = 12;
const MUSIC_TRACKS = Array.from({ length: MAX_BACKGROUND_TRACKS }, (_, index) =>
  index === 0 ? '/audio/background.mp3' : `/audio/background${index + 1}.mp3`,
);

export default function MusicPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const resumePlaybackRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('musicVolume') ?? '0.35'));
  const [hasError, setHasError] = useState(false);
  const [trackIndex, setTrackIndex] = useState(0);
  const [failedTracks, setFailedTracks] = useState<number[]>([]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
    localStorage.setItem('musicVolume', String(volume));
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.load();
    if (!resumePlaybackRef.current || hasError) return;

    void audio.play().catch(() => {
      setIsPlaying(false);
    });
  }, [trackIndex, hasError]);

  function jumpToTrack(nextIndex: number, shouldKeepPlaying: boolean) {
    resumePlaybackRef.current = shouldKeepPlaying;
    setHasError(false);
    setTrackIndex(nextIndex);
  }

  function advanceTrack(shouldKeepPlaying: boolean) {
    const nextIndex = (trackIndex + 1) % MUSIC_TRACKS.length;
    jumpToTrack(nextIndex, shouldKeepPlaying);
  }

  async function toggleMusic() {
    const audio = audioRef.current;
    if (!audio || hasError) return;

    if (audio.paused) {
      try {
        await audio.play();
        resumePlaybackRef.current = true;
        setIsPlaying(true);
      } catch {
        resumePlaybackRef.current = false;
        setIsPlaying(false);
      }
    } else {
      audio.pause();
      resumePlaybackRef.current = false;
      setIsPlaying(false);
    }
  }

  function skipSong() {
    if (hasError) return;
    advanceTrack(isPlaying);
  }

  function handleTrackEnded() {
    advanceTrack(isPlaying);
  }

  function handleTrackError() {
    const nextFailedTracks = failedTracks.includes(trackIndex)
      ? failedTracks
      : [...failedTracks, trackIndex];

    if (nextFailedTracks.length >= MUSIC_TRACKS.length) {
      resumePlaybackRef.current = false;
      setHasError(true);
      setIsPlaying(false);
      return;
    }

    setFailedTracks(nextFailedTracks);
    advanceTrack(resumePlaybackRef.current || isPlaying);
  }

  function handleTrackLoaded() {
    setFailedTracks((current) => current.filter((index) => index !== trackIndex));
    setHasError(false);
  }

  return (
    <div className="music-player">
      <audio
        ref={audioRef}
        src={MUSIC_TRACKS[trackIndex]}
        preload="auto"
        onEnded={handleTrackEnded}
        onLoadedData={handleTrackLoaded}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onError={handleTrackError}
      />
      <button className="secondary" disabled={hasError} onClick={toggleMusic}>
        {hasError ? 'No Music File' : isPlaying ? 'Pause Music' : 'Play Music'}
      </button>
      <button className="secondary" disabled={hasError} onClick={skipSong}>
        Skip Song
      </button>
      <label className="volume-control">
        Volume
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
        />
      </label>
    </div>
  );
}
