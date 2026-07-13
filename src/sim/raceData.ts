// THE race data table (04 §Engine fairness): all race asymmetry lives here.
// Engine code is identical per faction; no code branches per race, ever.
import { Race, Biome } from '../shared/types';

export interface RaceStats {
  breedChanceNum: number;     // pregnancy odds numerator (per eligible check, /1000)
  farmSkill: number;          // ×100 work multiplier
  forestYield: number;
  mineSkill: number;
  craftSkill: number;
  combat: number;             // base attack
  defense: number;
  maxAgeYears: number;
  adultAtYears: number;
  elderAtYears: number;
  angerGain: number;          // grudge accumulation ×100
  forgiveRate: number;        // grudge decay ×100
  homeBiomes: Biome[];        // race bonus terrain (bonuses apply here only)
  aggression: number;         // culture baseline 0..255
  piety: number;
  wanderlust: number;
  raidAffinity: number;       // raid-EV weighting ×100
}

export const RACE_TABLE: Record<Race, RaceStats> = {
  [Race.Human]: {
    breedChanceNum: 17, farmSkill: 130, forestYield: 90, mineSkill: 90, craftSkill: 100,
    combat: 10, defense: 10, maxAgeYears: 75, adultAtYears: 14, elderAtYears: 50,
    angerGain: 100, forgiveRate: 100,
    homeBiomes: [Biome.Grassland, Biome.Beach], aggression: 110, piety: 100, wanderlust: 140,
    raidAffinity: 60,
  },
  [Race.Elf]: {
    breedChanceNum: 9, farmSkill: 95, forestYield: 150, mineSkill: 70, craftSkill: 110,
    combat: 12, defense: 9, maxAgeYears: 140, adultAtYears: 20, elderAtYears: 100,
    angerGain: 55, forgiveRate: 40,
    homeBiomes: [Biome.Forest, Biome.DarkForest], aggression: 70, piety: 120, wanderlust: 60,
    raidAffinity: 30,
  },
  [Race.Dwarf]: {
    breedChanceNum: 12, farmSkill: 65, forestYield: 80, mineSkill: 170, craftSkill: 160,
    combat: 11, defense: 14, maxAgeYears: 110, adultAtYears: 18, elderAtYears: 75,
    angerGain: 90, forgiveRate: 70,
    homeBiomes: [Biome.Hills, Biome.Mountain], aggression: 95, piety: 110, wanderlust: 70,
    raidAffinity: 45,
  },
  [Race.Orc]: {
    breedChanceNum: 22, farmSkill: 75, forestYield: 85, mineSkill: 100, craftSkill: 70,
    combat: 14, defense: 10, maxAgeYears: 60, adultAtYears: 12, elderAtYears: 40,
    angerGain: 160, forgiveRate: 130,
    homeBiomes: [Biome.Steppe, Biome.Hills], aggression: 180, piety: 90, wanderlust: 120,
    raidAffinity: 150,
  },
};
