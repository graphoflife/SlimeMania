// Logical (pixel) resolution of the game. Everything is drawn at this size
// and scaled up with nearest-neighbour filtering for the pixel look.
export const W = 216;
export const H = 384;
// On screens taller than 9:16 the view extends upwards by up to this much (gameplay is unchanged).
export const MAX_EXTRA = 120;

// Radii of big / medium / small slimes. 3 children have the same area as the parent.
export const SLIME_R = [26, 15, 9];

// Chain belt & gun
export const SPROCKET_R = 6;
export const CHAIN_Y = 361;                    // sprocket centre line
export const CHAIN_TOP = CHAIN_Y - SPROCKET_R; // top run of the chain, the gun rides on it
export const SPROCKET_LX = 12;
export const SPROCKET_RX = 204;
export const GUN_HALF = 13;
export const GUN_MIN_X = SPROCKET_LX + GUN_HALF + 3;
export const GUN_MAX_X = SPROCKET_RX - GUN_HALF - 3;
export const MUZZLE_Y = 331;
export const GUN_MAX_SPEED = 240;
export const GUN_ACCEL = 2200;
export const SLOT_OFFSETS = [0, -7, 7];        // barrel x-offset of each equipped weapon slot
export const MAX_EQUIPPED = 3;

// A slime whose centre reaches this line has reached the bottom: level lost.
export const LOSE_Y = 324;
