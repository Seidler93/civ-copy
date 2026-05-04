import { useEffect, useRef } from 'react';

const DEFAULT_BUTTON_CLICK_SOUND_PATH = '/audio/default-button-click.wav';
const SECONDARY_BUTTON_CLICK_SOUND_PATH = '/audio/secondary-button-click.wav';

interface ButtonClickSoundProps {
  volume: number;
}

export default function ButtonClickSound({ volume }: ButtonClickSoundProps) {
  const defaultAudioRef = useRef<HTMLAudioElement | null>(null);
  const secondaryAudioRef = useRef<HTMLAudioElement | null>(null);
  const volumeRef = useRef(volume);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    defaultAudioRef.current = new Audio(DEFAULT_BUTTON_CLICK_SOUND_PATH);
    secondaryAudioRef.current = new Audio(SECONDARY_BUTTON_CLICK_SOUND_PATH);

    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const button = target?.closest('button');
      if (!button || button.disabled || button.dataset.silentClick === 'true') return;

      const source = button.classList.contains('secondary') ? secondaryAudioRef.current : defaultAudioRef.current;
      const sound = source?.cloneNode(true) as HTMLAudioElement | null;
      if (!sound) return;
      sound.volume = (button.classList.contains('secondary') ? 0.34 : 0.36) * volumeRef.current;
      sound.play().catch(() => {
        // The file may not be present yet, or the browser may reject audio before interaction.
      });
    }

    document.addEventListener('click', handleClick, true);
    return () => {
      document.removeEventListener('click', handleClick, true);
      defaultAudioRef.current = null;
      secondaryAudioRef.current = null;
    };
  }, []);

  return null;
}
