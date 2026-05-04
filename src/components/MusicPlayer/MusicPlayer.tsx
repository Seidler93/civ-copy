import { useEffect, useRef, useState } from 'react';

const MUSIC_TRACKS = ['/audio/background.mp3', '/audio/background2.mp3', '/audio/background3.mp3', '/audio/background4.mp3'];

interface MusicPlayerProps {
  volume: number;
}

export default function MusicPlayer({ volume }: MusicPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const resumePlaybackRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [trackIndex, setTrackIndex] = useState(0);
  const [failedTracks, setFailedTracks] = useState<number[]>([]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
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

  function randomNextTrackIndex(failedTrackIndexes = failedTracks) {
    const playableTracks = MUSIC_TRACKS.map((_, index) => index).filter((index) => !failedTrackIndexes.includes(index));
    const nextChoices = playableTracks.length > 1 ? playableTracks.filter((index) => index !== trackIndex) : playableTracks;
    if (nextChoices.length === 0) return trackIndex;
    return nextChoices[Math.floor(Math.random() * nextChoices.length)];
  }

  function advanceTrack(shouldKeepPlaying: boolean, failedTrackIndexes = failedTracks) {
    jumpToTrack(randomNextTrackIndex(failedTrackIndexes), shouldKeepPlaying);
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
    advanceTrack(true);
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
      <button
        className="secondary icon-control-button music-toggle-button"
        disabled={hasError}
        onClick={toggleMusic}
        aria-label={hasError ? 'No music file' : isPlaying ? 'Pause music' : 'Play music'}
        title={hasError ? 'No music file' : isPlaying ? 'Pause music' : 'Play music'}
      >
        <span className={isPlaying ? 'pause-icon' : 'play-icon'} aria-hidden="true" />
      </button>
      <button
        className="secondary icon-control-button skip-song-button"
        disabled={hasError}
        onClick={skipSong}
        aria-label="Skip song"
        title="Skip song"
      >
        <span className="skip-icon" aria-hidden="true" />
      </button>
    </div>
  );
}
