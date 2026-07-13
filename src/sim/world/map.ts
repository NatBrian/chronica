import { Biome } from '../../shared/types';

/** All per-tile planes for the island. ~10 planes × N² bytes. */
export interface WorldMap {
  size: number;
  elevation: Uint8Array;    // 0 deep ocean .. 255 peak
  waterFlux: Uint16Array;   // hydrology accumulation
  temperature: Uint8Array;
  moisture: Uint8Array;
  biome: Uint8Array;
  fertility: Uint8Array;    // farming yield driver
  forest: Uint8Array;       // wood stock, regrows slowly
  ore: Uint16Array;         // vein amount, depletes (02 §Resources)
  fish: Uint8Array;
  game: Uint8Array;         // huntable animals
  flags: Uint8Array;        // bit 0: river, bit 1: road, bit 2: farm plot, bit 3: burned
  crop: Uint8Array;         // farm plot growth stage 0 fallow .. 200 ripe (M2)
  riverCount: number;
}

export const SEA_LEVEL = 90;
export const MOUNTAIN_LEVEL = 200;

export const TileFlag = { River: 1, Road: 2, Farm: 4, Burned: 8 } as const;

export function allocMap(size: number): WorldMap {
  const n = size * size;
  return {
    size,
    elevation: new Uint8Array(n),
    waterFlux: new Uint16Array(n),
    temperature: new Uint8Array(n),
    moisture: new Uint8Array(n),
    biome: new Uint8Array(n),
    fertility: new Uint8Array(n),
    forest: new Uint8Array(n),
    ore: new Uint16Array(n),
    fish: new Uint8Array(n),
    game: new Uint8Array(n),
    flags: new Uint8Array(n),
    crop: new Uint8Array(n),
    riverCount: 0,
  };
}

export function isLand(map: WorldMap, i: number): boolean {
  const b = map.biome[i];
  return b !== Biome.DeepOcean && b !== Biome.Ocean && b !== Biome.Lake;
}

export function isPassable(map: WorldMap, i: number): boolean {
  const b = map.biome[i];
  return isLand(map, i) && b !== Biome.Mountain;
}

/** Terrain movement cost ×10 (integer). 10 = normal. */
export function moveCost(map: WorldMap, i: number): number {
  if (map.flags[i] & TileFlag.Road) return 6;
  switch (map.biome[i]) {
    case Biome.Grassland: case Biome.Beach: case Biome.Steppe: return 10;
    case Biome.Forest: return 14;
    case Biome.DarkForest: return 20;
    case Biome.Hills: return 16;
    case Biome.Swamp: return 24;
    case Biome.Snow: return 18;
    default: return 10;
  }
}
