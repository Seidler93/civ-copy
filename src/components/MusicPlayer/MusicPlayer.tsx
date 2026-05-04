import { useEffect, useRef, useState } from 'react';

const MUSIC_SRC = '/audio/background.mp3';

export default function MusicPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('musicVolume') ?? '0.35'));
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
    localStorage.setItem('musicVolume', String(volume));
  }, [volume]);

  async function toggleMusic() {
    const audio = audioRef.current;
    if (!audio || hasError) return;

    if (audio.paused) {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }

  return (
    <div className="music-player">
      <audio
        ref={audioRef}
        src={MUSIC_SRC}
        loop
        preload="auto"
        onEnded={() => setIsPlaying(false)}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onError={() => setHasError(true)}
      />
      <button className="secondary" disabled={hasError} onClick={toggleMusic}>
        {hasError ? 'No Music File' : isPlaying ? 'Pause Music' : 'Play Music'}
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
