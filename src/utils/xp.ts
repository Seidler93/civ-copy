import type { PlayerDoc } from '../types/gameTypes';

export function xpForNextLevel(level: number) {
  return 100 + (level - 1) * 50;
}

export function applyXp(player: PlayerDoc, gainedXp: number): Pick<PlayerDoc, 'xp' | 'level' | 'talentPoints'> {
  let xp = player.xp + gainedXp;
  let level = player.level;
  let talentPoints = player.talentPoints;

  while (xp >= xpForNextLevel(level)) {
    xp -= xpForNextLevel(level);
    level += 1;
    talentPoints += 1;
  }

  return { xp, level, talentPoints };
}
