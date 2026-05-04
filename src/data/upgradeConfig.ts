export const BASE_SUPPLIES_PER_TURN = 20;
export const BUILD_BASE_COST = 60;
export const BUILD_TRENCH_COST = 20;

export const UPGRADE_CONFIG = {
  barracks: [
    { level: 1, name: 'Outpost', unlocks: ['gunman', 'recon', 'builder'] },
    { level: 2, name: 'Armory', cost: 55, unlocks: ['sniper', 'antiVehicle', 'medic'] },
    { level: 3, name: 'Vehicle Bay', cost: 90, unlocks: ['tank'] },
    { level: 4, name: 'Command Post', cost: 130, unlocks: [] },
    { level: 5, name: 'Fire Command', cost: 180, unlocks: ['lightArtillery', 'smokeArtillery', 'siegeArtillery'] },
  ],
  unitQuality: [
    { level: 1, bonus: 0, cost: 0 },
    { level: 2, bonus: 1, cost: 70 },
    { level: 3, bonus: 2, cost: 110 },
  ],
  baseDefense: [
    { level: 1, bonus: 5, cost: 0 },
    { level: 2, bonus: 9, cost: 55 },
    { level: 3, bonus: 14, cost: 90 },
    { level: 4, bonus: 20, cost: 135 },
    { level: 5, bonus: 28, cost: 190 },
  ],
  baseOffense: [
    { level: 1, name: 'Watch Post', range: 0, damage: 0, cost: 0 },
    { level: 2, name: 'Sentry Nest', range: 1, damage: 1, cost: 65 },
    { level: 3, name: 'Ammo Cache', range: 1, damage: 1, cost: 45 },
    { level: 4, name: 'Overwatch Platform', range: 2, damage: 1, cost: 60 },
    { level: 5, name: 'Overwatch Tower', range: 2, damage: 2, cost: 80 },
  ],
};
