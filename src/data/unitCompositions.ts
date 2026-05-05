import type { UnitTypeId } from '../types/gameTypes';

export interface UnitCompositionConfig {
  id: string;
  name: string;
  units: UnitTypeId[];
  buffs: string[];
  notes: string[];
}

export const UNIT_COMPOSITIONS: UnitCompositionConfig[] = [
  {
    id: 'combined-arms',
    name: 'Combined Arms',
    units: ['gunman', 'tank', 'antiVehicle'],
    buffs: ['+10% attack and defense'],
    notes: ['Balanced armor push with tank pressure and anti-tank coverage.'],
  },
  {
    id: 'tank-hunters',
    name: 'Tank Hunters',
    units: ['gunman', 'antiVehicle'],
    buffs: ['+25% attack against units with Tanks'],
    notes: ['Cheap answer to armor-heavy units.'],
  },
  {
    id: 'entrenched-infantry',
    name: 'Entrenched Infantry',
    units: ['gunman', 'gunman'],
    buffs: ['+15% defense in trenches or base aura'],
    notes: ['Efficient defensive unit that gets stronger in prepared positions.'],
  },
];
