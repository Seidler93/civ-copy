export const BASE_SUPPLIES_PER_TURN = 20;
export const BUILD_BASE_COST = 60;

export const UPGRADE_CONFIG = {
  barracks: [
    { level: 1, name: 'Outpost', unlocks: ['gunman', 'recon', 'builder'] },
    { level: 2, name: 'Armory', cost: 55, unlocks: ['sniper', 'antiVehicle', 'medic'] },
    { level: 3, name: 'Vehicle Bay', cost: 90, unlocks: ['tank'] },
    { level: 4, name: 'Fire Command', cost: 130, unlocks: ['artillery'] },
  ],
  unitQuality: [
    { level: 1, bonus: 0, cost: 0 },
    { level: 2, bonus: 1, cost: 70 },
    { level: 3, bonus: 2, cost: 110 },
  ],
  baseDefense: [
    { level: 1, bonus: 2, cost: 0 },
    { level: 2, bonus: 4, cost: 50 },
    { level: 3, bonus: 7, cost: 85 },
  ],
  baseOffense: [
    { level: 1, name: 'Watch Post', range: 0, damage: 0, cost: 0 },
    { level: 2, name: 'Sentry Nest', range: 2, damage: 1, cost: 65 },
    { level: 3, name: 'Overwatch Tower', range: 3, damage: 2, cost: 105 },
  ],
};
