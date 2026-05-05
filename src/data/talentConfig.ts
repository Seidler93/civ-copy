import type { TalentId } from '../types/gameTypes';

export type TalentBranch = 'attack' | 'defense' | 'progress';

export interface TalentConfig {
  id: TalentId;
  branch: TalentBranch;
  name: string;
  description: string;
  perRank: string;
  maxRanks: number;
}

export const TALENT_CONFIG: TalentConfig[] = [
  {
    id: 'attackTraining',
    branch: 'attack',
    name: 'Attack Training',
    description: 'Improves every unit attack.',
    perRank: '+5% attack power',
    maxRanks: 5,
  },
  {
    id: 'coordinatedAssault',
    branch: 'attack',
    name: 'Coordinated Assault',
    description: 'Improves the adjacent friendly unit support buff.',
    perRank: '+2% adjacent support attack',
    maxRanks: 5,
  },
  {
    id: 'defensiveDrills',
    branch: 'defense',
    name: 'Defensive Drills',
    description: 'Improves unit defense in combat.',
    perRank: '+5% defense power',
    maxRanks: 5,
  },
  {
    id: 'baseFortification',
    branch: 'defense',
    name: 'Base Fortification',
    description: 'Adds extra defense whenever your bases are attacked.',
    perRank: '+1 base defense',
    maxRanks: 5,
  },
  {
    id: 'sentryNetwork',
    branch: 'defense',
    name: 'Sentry Network',
    description: 'Extends the radius of your base sentries.',
    perRank: '+1 sentry radius',
    maxRanks: 3,
  },
  {
    id: 'logistics',
    branch: 'progress',
    name: 'Engineering',
    description: 'Increases supplies earned from each base.',
    perRank: '+5 supplies per base',
    maxRanks: 5,
  },
  {
    id: 'quartermaster',
    branch: 'progress',
    name: 'Quartermaster',
    description: 'Reduces recruiting and upgrade costs.',
    perRank: '-5% costs',
    maxRanks: 5,
  },
  {
    id: 'mobilization',
    branch: 'progress',
    name: 'Mobilization',
    description: 'Lets units move farther each turn.',
    perRank: '+1 movement',
    maxRanks: 3,
  },
];

export function talentById(talentId: TalentId) {
  return TALENT_CONFIG.find((talent) => talent.id === talentId);
}

export function previousTalentInBranch(talentId: TalentId) {
  const talentIndex = TALENT_CONFIG.findIndex((talent) => talent.id === talentId);
  if (talentIndex < 0) return undefined;
  const talent = TALENT_CONFIG[talentIndex];
  return TALENT_CONFIG.slice(0, talentIndex)
    .filter((candidate) => candidate.branch === talent.branch)
    .at(-1);
}
