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
  const lastHoverSoundAtRef = useRef(0);
  const lastPressSoundAtRef = useRef(0);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    defaultAudioRef.current = new Audio(DEFAULT_BUTTON_CLICK_SOUND_PATH);
    secondaryAudioRef.current = new Audio(SECONDARY_BUTTON_CLICK_SOUND_PATH);

    function playSound(sourceAudio: HTMLAudioElement | null, volumeMultiplier: number) {
      const sound = sourceAudio?.cloneNode(true) as HTMLAudioElement | null;
      if (!sound) return;
      sound.volume = volumeMultiplier * volumeRef.current;
      sound.play().catch(() => {
        // The file may not be present yet, or the browser may reject audio before interaction.
      });
    }

    function playButtonSound(button: HTMLButtonElement, volumeMultiplier: number, forceDefault = false) {
      if (!button || button.disabled || button.dataset.silentClick === 'true') return;
      playSound(forceDefault ? defaultAudioRef.current : button.classList.contains('secondary') ? secondaryAudioRef.current : defaultAudioRef.current, volumeMultiplier);
    }

    function buttonFromEvent(event: Event) {
      const target = event.target as HTMLElement | null;
      const closestButton = target?.closest('button') as HTMLButtonElement | null;
      if (closestButton) return closestButton;
      return event
        .composedPath()
        .find((item): item is HTMLButtonElement => item instanceof HTMLButtonElement) ?? null;
    }

    function handleClick(event: MouseEvent) {
      const button = buttonFromEvent(event);
      if (!button) return;
      const now = Date.now();
      if (now - lastPressSoundAtRef.current < 80) return;
      lastPressSoundAtRef.current = now;
      playButtonSound(button, button.classList.contains('secondary') ? 0.34 : 0.36);
    }

    function handleButtonHover(event: Event) {
      const target = event.target as HTMLElement | null;
      const button = buttonFromEvent(event);
      if (!button && !target?.closest('.tab-level-badge')) return;
      const now = Date.now();
      if (now - lastHoverSoundAtRef.current < 80) return;
      lastHoverSoundAtRef.current = now;
      if (button) {
        playButtonSound(button, 0.44, true);
      } else {
        playSound(defaultAudioRef.current, 0.44);
      }
    }

    document.addEventListener('click', handleClick, true);
    document.addEventListener('pointerdown', handleClick, true);
    document.addEventListener('mouseover', handleButtonHover, true);
    document.addEventListener('pointerover', handleButtonHover, true);
    document.addEventListener('focusin', handleButtonHover, true);
    return () => {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('pointerdown', handleClick, true);
      document.removeEventListener('mouseover', handleButtonHover, true);
      document.removeEventListener('pointerover', handleButtonHover, true);
      document.removeEventListener('focusin', handleButtonHover, true);
      defaultAudioRef.current = null;
      secondaryAudioRef.current = null;
    };
  }, []);

  return null;
}
