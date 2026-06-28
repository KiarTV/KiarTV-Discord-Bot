export const VALID_MAPS = [
  "The Island",
  "The Center",
  "Scorched Earth",
  "Ragnarok",
  "Aberration",
  "Extinction",
  "Valguero",
  "Genesis: Part 1",
  "Crystal Isles",
  "Genesis: Part 2",
  "Lost Island",
  "Fjordur",
] as const;

export const VALID_SERVERS = ["INX", "Fusion", "Mesa"] as const;

export const MAX_MESSAGES = 50;

/** Discord's upload limit; skip video files larger than this */
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
