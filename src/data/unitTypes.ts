import type { UnitInstance, UnitTypeConfig, UnitTypeId } from '../types/gameTypes';

export const UNIT_LEVEL_COST_STEP = 5;

export const UNIT_TYPES: Record<UnitTypeId, UnitTypeConfig> = {
  gunman: {
    id: 'gunman',
    name: 'Rifleman',
    cost: 10,
    space: 5,
    attack: 2,
    defense: 2,
    description: 'Cheap balanced infantry, shown as one Rifleman squad.',
  },
  recon: {
    id: 'recon',
    name: 'Recon',
    cost: 15,
    space: 5,
    attack: 1,
    defense: 1,
    description: 'Fast scouting squad with extended vision for clearing fog of war.',
  },
  sniper: {
    id: 'sniper',
    name: 'Sniper',
    cost: 20,
    space: 10,
    attack: 4,
    defense: 1,
    description: 'High attack and low defense, with an attacking bonus and 1 extra tile of range when operating solo.',
  },
  tank: {
    id: 'tank',
    name: 'Tank',
    cost: 40,
    space: 20,
    attack: 5,
    defense: 5,
    description: 'Expensive armor that is strong against Gunmen.',
  },
  antiVehicle: {
    id: 'antiVehicle',
    name: 'Anti-Vehicle',
    cost: 25,
    space: 10,
    attack: 3,
    defense: 3,
    description: 'Counters Tanks with a strong attack bonus and can place anti-tank mines.',
  },
  medic: {
    id: 'medic',
    name: 'Medic',
    cost: 25,
    space: 10,
    attack: 1,
    defense: 2,
    description: 'Support squad that heals its unit at round end or can spend the turn for a stronger heal.',
  },
  builder: {
    id: 'builder',
    name: 'Logistics',
    cost: 20,
    space: 10,
    attack: 1,
    defense: 1,
    description: 'Solo support squad. L1 builds bases, L2 digs trenches, and L3 can scavenge supplies.',
  },
  artillery: {
    id: 'artillery',
    name: 'Artillery',
    cost: 125,
    space: 20,
    attack: 6,
    defense: 1,
    description: 'Long-range squad that must operate solo and can attack targets up to 6 spaces away.',
  },
  lightArtillery: {
    id: 'lightArtillery',
    name: 'Light Barrage',
    cost: 100,
    space: 20,
    attack: 5,
    defense: 1,
    description: 'Solo artillery squad. Reliable anti-unit shelling with a bonus when firing at squads.',
  },
  smokeArtillery: {
    id: 'smokeArtillery',
    name: 'Smoke Screen',
    cost: 85,
    space: 20,
    attack: 3,
    defense: 1,
    description: 'Solo artillery squad. Smoke shells disrupt defenders and reduce their combat response.',
  },
  siegeArtillery: {
    id: 'siegeArtillery',
    name: 'Siege Shelling',
    cost: 145,
    space: 20,
    attack: 7,
    defense: 1,
    description: 'Solo artillery squad. Heavy shells are strongest against bases and fortified positions.',
  },
};

export function unitCostForLevel(unitTypeId: UnitTypeId, level = 1) {
  return UNIT_TYPES[unitTypeId].cost + Math.max(0, level - 1) * UNIT_LEVEL_COST_STEP;
}

export function unitCostForInstance(unit: UnitInstance) {
  return unitCostForLevel(unit.typeId, Math.max(unit.level ?? 1, unit.qualityLevel ?? 1));
}
