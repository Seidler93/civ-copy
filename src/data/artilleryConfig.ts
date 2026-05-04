export interface ArtilleryStrikeConfig {
  id: string;
  name: string;
  cost: number;
  description: string;
}

export const ARTILLERY_UNLOCK_BARRACKS_LEVEL = 4;

export const ARTILLERY_STRIKES: ArtilleryStrikeConfig[] = [
  {
    id: 'lightBarrage',
    name: 'Light Barrage',
    cost: 35,
    description: 'A cheap strike option intended for softening a single unit.',
  },
  {
    id: 'smokeScreen',
    name: 'Smoke Screen',
    cost: 30,
    description: 'A tactical strike option intended for reducing enemy combat effectiveness.',
  },
  {
    id: 'siegeShelling',
    name: 'Siege Shelling',
    cost: 55,
    description: 'A heavier strike option intended for pressuring bases and fortified positions.',
  },
];
