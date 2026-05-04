import type { UnitTypeId } from '../types/gameTypes';

export interface ArtillerySquadConfig {
  id: string;
  name: string;
  unitTypeId: UnitTypeId;
  cost: number;
  ability: string;
  description: string;
}

export const ARTILLERY_UNLOCK_BARRACKS_LEVEL = 5;

export const ARTILLERY_SQUADS: ArtillerySquadConfig[] = [
  {
    id: 'lightBarrage',
    name: 'Light Barrage',
    unitTypeId: 'lightArtillery',
    cost: 35,
    ability: '+2 attack when shelling enemy squads. Fires every other round.',
    description: 'Mobile light guns for softening enemy squads at long range.',
  },
  {
    id: 'smokeScreen',
    name: 'Smoke Screen',
    unitTypeId: 'smokeArtillery',
    cost: 30,
    ability: 'Enemy defense response is reduced by 15%.',
    description: 'Smoke shells disrupt defenders and make return fire less effective.',
  },
  {
    id: 'siegeShelling',
    name: 'Siege Shelling',
    unitTypeId: 'siegeArtillery',
    cost: 55,
    ability: '+4 attack against bases, trenches, or fortified units.',
    description: 'Heavy guns built to crack bases and prepared positions.',
  },
];
