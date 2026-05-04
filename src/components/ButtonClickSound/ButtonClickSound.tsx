import { useEffect, useRef } from 'react';

const DEFAULT_BUTTON_CLICK_SOUND_PATH = '/audio/default-button-click.wav';
const SECONDARY_BUTTON_CLICK_SOUND_PATH = '/audio/secondary-button-click.wav';

export default function ButtonClickSound() {
  const defaultAudioRef = useRef<HTMLAudioElement | null>(null);
  const secondaryAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    defaultAudioRef.current = new Audio(DEFAULT_BUTTON_CLICK_SOUND_PATH);
    defaultAudioRef.current.volume = 0.36;
    secondaryAudioRef.current = new Audio(SECONDARY_BUTTON_CLICK_SOUND_PATH);
    secondaryAudioRef.current.volume = 0.34;

    function handleClick(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const button = target?.closest('button');
      if (!button || button.disabled || button.dataset.silentClick === 'true') return;

      const source = button.classList.contains('secondary') ? secondaryAudioRef.current : defaultAudioRef.current;
      const sound = source?.cloneNode(true) as HTMLAudioElement | null;
      if (!sound) return;
      sound.volume = source?.volume ?? 0.36;
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
