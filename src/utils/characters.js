/**
 * characters.js
 * Config file for character drops.
 * Weights determine spawn probability relative to each other (total sum: 200).
 */
const CHARACTER_SPAWNS = [
  // --- COMMON (Tiers: 100 - 150) ---
  {
    id: 'common_soul',
    name: 'Blossom Soul',
    tier: 'COMMON',
    value: 100,
    weight: 50, // 25% spawn chance
    imagePath: './src/assets/common_soul.png',
    attachmentName: 'common_soul.png',
    color: '#ec4899', // Pink
    embedTitle: '✦ A COMMON SOUL HAS DESCENDED ✦',
    embedDescription: 'Blossom Soul has appeared! Tier: COMMON\n\nA rare presence has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'COMMON SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Blossom Soul 💚\n\n✦ The common soul has chosen its master.`
  },
  {
    id: 'common_girl2',
    name: 'Sakura Soul',
    tier: 'COMMON',
    value: 150,
    weight: 50, // 25% spawn chance
    imagePath: './src/assets/common_girl2.png',
    attachmentName: 'common_girl2.png',
    color: '#fda4af', // Rose pink
    embedTitle: '✦ A COMMON SOUL HAS DESCENDED ✦',
    embedDescription: 'Sakura Soul has appeared! Tier: COMMON\n\nA rare presence has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'COMMON SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Sakura Soul 🌸\n\n✦ The common soul has chosen its master.`
  },

  // --- UNCOMMON (Tiers: 300 - 350) ---
  {
    id: 'uncommon_soul',
    name: 'Azure Soul',
    tier: 'UNCOMMON',
    value: 300,
    weight: 25, // 12.5% spawn chance
    imagePath: './src/assets/uncommon_soul.png',
    attachmentName: 'uncommon_soul.png',
    color: '#3b82f6', // Blue
    embedTitle: '✦ AN UNCOMMON SOUL HAS DESCENDED ✦',
    embedDescription: 'Azure Soul has appeared! Tier: UNCOMMON\n\nA rare presence has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'UNCOMMON SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Azure Soul 💙\n\n✦ The uncommon soul has chosen its master.`
  },
  {
    id: 'uncommon_girl2',
    name: 'Ocean Soul',
    tier: 'UNCOMMON',
    value: 350,
    weight: 25, // 12.5% spawn chance
    imagePath: './src/assets/uncommon_girl2.png',
    attachmentName: 'uncommon_girl2.png',
    color: '#06b6d4', // Cyan
    embedTitle: '✦ AN UNCOMMON SOUL HAS DESCENDED ✦',
    embedDescription: 'Ocean Soul has appeared! Tier: UNCOMMON\n\nA rare presence has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'UNCOMMON SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Ocean Soul 🌊\n\n✦ The uncommon soul has chosen its master.`
  },

  // --- RARE (Tiers: 500 - 550) ---
  {
    id: 'rare_soul',
    name: 'Ember Soul',
    tier: 'RARE',
    value: 500,
    weight: 15, // 7.5% spawn chance
    imagePath: './src/assets/rare_soul.png',
    attachmentName: 'rare_soul.png',
    color: '#f97316', // Orange
    embedTitle: '✦ A RARE SOUL HAS DESCENDED ✦',
    embedDescription: 'Ember Soul has appeared! Tier: RARE\n\nA rare presence has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'RARE SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Ember Soul ❤️\n\n✦ The rare soul has chosen its master.`
  },
  {
    id: 'rare_girl2',
    name: 'Spark Soul',
    tier: 'RARE',
    value: 550,
    weight: 15, // 7.5% spawn chance
    imagePath: './src/assets/rare_girl2.png',
    attachmentName: 'rare_girl2.png',
    color: '#f43f5e', // Rose red
    embedTitle: '✦ A RARE SOUL HAS DESCENDED ✦',
    embedDescription: 'Spark Soul has appeared! Tier: RARE\n\nA rare presence has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'RARE SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Spark Soul 🔥\n\n✦ The rare soul has chosen its master.`
  },

  // --- EPIC / MYTHIC (Tiers: 700 - 750) ---
  {
    id: 'mythic_soul',
    name: 'Goddess Soul',
    tier: 'MYTHIC',
    value: 700,
    weight: 8, // 4% spawn chance
    imagePath: './src/assets/mythic_soul.png',
    attachmentName: 'mythic_soul.png',
    color: '#fbbf24', // Gold
    embedTitle: '✦ A MYTHIC SOUL HAS DESCENDED ✦',
    embedDescription: 'Goddess Soul has appeared! Tier: MYTHIC\n\nA rare presence has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'MYTHIC SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Goddess Soul 💛\n\n✦ The mythic soul has chosen its master.`
  },
  {
    id: 'epic_girl2',
    name: 'Twilight Soul',
    tier: 'EPIC',
    value: 750,
    weight: 8, // 4% spawn chance
    imagePath: './src/assets/epic_girl2.png',
    attachmentName: 'epic_girl2.png',
    color: '#db2777', // Deep pink
    embedTitle: '✦ AN EPIC SOUL HAS DESCENDED ✦',
    embedDescription: 'Twilight Soul has appeared! Tier: EPIC\n\nA rare presence has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'EPIC SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Twilight Soul 🦇\n\n✦ The epic soul has chosen its master.`
  },

  // --- DIVINE (Tier: 1000) ---
  {
    id: 'divine_soul',
    name: 'Divine Soul',
    tier: 'DIVINE',
    value: 1000,
    weight: 2, // 1% spawn chance (most rare, highest value!)
    imagePath: './src/assets/divine_soul_purple.png',
    attachmentName: 'divine_soul_purple.png',
    color: '#a855f7', // Purple
    embedTitle: '✦ A DIVINE SOUL HAS DESCENDED ✦',
    embedDescription: 'Divine Soul has appeared! Tier: DIVINE\n\nA rare presence has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'DIVINE SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Divine Soul 💜\n\n✦ The divine soul has chosen its master.`
  },
  {
    id: 'divine_girl2',
    name: 'Celestia Soul',
    tier: 'DIVINE',
    value: 1000,
    weight: 2, // 1% spawn chance (most rare, highest value!)
    imagePath: './src/assets/divine_girl2.png',
    attachmentName: 'divine_girl2.png',
    color: '#6366f1', // Indigo
    embedTitle: '✦ A DIVINE SOUL HAS DESCENDED ✦',
    embedDescription: 'Celestia Soul has appeared! Tier: DIVINE\n\nA rare presence has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'DIVINE SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Celestia Soul ✨\n\n✦ The divine soul has chosen its master.`
  },
  // --- CUTE CATS ---
  {
    id: 'cat_wink',
    name: 'Winky Cat',
    tier: 'COMMON',
    value: 150,
    weight: 50,
    imagePath: './src/assets/wink_cat.png',
    attachmentName: 'wink_cat.png',
    color: '#4ade80',
    embedTitle: '✦ A CUTE CAT HAS DESCENDED ✦',
    embedDescription: 'Winky Cat has appeared! Tier: COMMON\n\nA silly winking cat has entered this realm...\n\nType soul to claim it!',
    claimTitle: 'CUTE CAT CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Winky Cat 😜\n\n✦ The winking cat has chosen its master.`
  },
  {
    id: 'cat_derp',
    name: 'Derp Cat',
    tier: 'UNCOMMON',
    value: 400,
    weight: 25,
    imagePath: './src/assets/derp_cat.png',
    attachmentName: 'derp_cat.png',
    color: '#3b82f6',
    embedTitle: '✦ AN UNCOMMON CAT HAS DESCENDED ✦',
    embedDescription: 'Derp Cat has appeared! Tier: UNCOMMON\n\nA surprised shocked cat has entered this realm...\n\nType soul to claim it!',
    claimTitle: 'UNCOMMON CAT CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Derp Cat 🙀\n\n✦ The shocked cat has chosen its master.`
  },
  {
    id: 'cat_smug',
    name: 'Smug Cat',
    tier: 'RARE',
    value: 900,
    weight: 15,
    imagePath: './src/assets/smug_cat.png',
    attachmentName: 'smug_cat.png',
    color: '#f97316',
    embedTitle: '✦ A RARE CAT HAS DESCENDED ✦',
    embedDescription: 'Smug Cat has appeared! Tier: RARE\n\nA cool orange tabby has entered this realm...\n\nType soul to claim it!',
    claimTitle: 'RARE CAT CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Smug Cat 😏\n\n✦ The smug cat has chosen its master.`
  },
  {
    id: 'cat_heart',
    name: 'Heart Kitten',
    tier: 'EPIC',
    value: 1800,
    weight: 8,
    imagePath: './src/assets/heart_cat.png',
    attachmentName: 'heart_cat.png',
    color: '#db2777',
    embedTitle: '✦ AN EPIC KITTEN HAS DESCENDED ✦',
    embedDescription: 'Heart Kitten has appeared! Tier: EPIC\n\nA loving standing kitten has entered this realm...\n\nType soul to claim it!',
    claimTitle: 'EPIC KITTEN CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Heart Kitten ❤️\n\n✦ The lovely kitten has chosen its master.`
  },
  {
    id: 'cat_angel',
    name: 'Angel Cat',
    tier: 'DIVINE',
    value: 3000,
    weight: 2,
    imagePath: './src/assets/angel_cat.png',
    attachmentName: 'angel_cat.png',
    color: '#fbbf24',
    embedTitle: '✦ A DIVINE ANGEL CAT HAS DESCENDED ✦',
    embedDescription: 'Angel Cat has appeared! Tier: DIVINE\n\nA holy celestial angel cat has entered this realm...\n\nType soul to claim it!',
    claimTitle: 'DIVINE ANGEL CAT CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Angel Cat ✨\n\n✦ The celestial angel kitty has chosen its master.`
  },
  // --- LEGENDARY ELDEN RING BOSSES ---
  {
    id: 'boss_malenia',
    name: 'Malenia, Blade of Miquella',
    tier: 'LEGENDARY',
    value: 5000,
    weight: 1,
    imagePath: './src/assets/boss_malenia.png',
    attachmentName: 'boss_malenia.png',
    color: '#d97706',
    embedTitle: '✦ A LEGENDARY BOSS HAS DESCENDED ✦',
    embedDescription: 'Malenia, Blade of Miquella has appeared! Tier: LEGENDARY\n\n"I am Malenia, Blade of Miquella, and I have never known defeat."\n\nType soul to claim her!',
    claimTitle: 'LEGENDARY BOSS CLAIMED!',
    claimDescription: (userMention) => `${userMention} defeated Malenia, Blade of Miquella ⚔️\n\n✦ The Goddess of Rot has met her match.`
  },
  {
    id: 'boss_radahn',
    name: 'Starscourge Radahn',
    tier: 'LEGENDARY',
    value: 5000,
    weight: 1,
    imagePath: './src/assets/boss_radahn.png',
    attachmentName: 'boss_radahn.png',
    color: '#dc2626',
    embedTitle: '✦ A LEGENDARY BOSS HAS DESCENDED ✦',
    embedDescription: 'Starscourge Radahn has appeared! Tier: LEGENDARY\n\nThe conqueror of the stars has arrived!\n\nType soul to claim him!',
    claimTitle: 'LEGENDARY BOSS CLAIMED!',
    claimDescription: (userMention) => `${userMention} defeated Starscourge Radahn ☄️\n\n✦ The Starscourge has fallen.`
  },
  {
    id: 'boss_elden_beast',
    name: 'Elden Beast',
    tier: 'LEGENDARY',
    value: 5000,
    weight: 1,
    imagePath: './src/assets/boss_elden_beast.png',
    attachmentName: 'boss_elden_beast.png',
    color: '#2563eb',
    embedTitle: '✦ A LEGENDARY BOSS HAS DESCENDED ✦',
    embedDescription: 'Elden Beast has appeared! Tier: LEGENDARY\n\nThe vassal beast of the Greater Will has descended!\n\nType soul to claim it!',
    claimTitle: 'LEGENDARY BOSS CLAIMED!',
    claimDescription: (userMention) => `${userMention} defeated the Elden Beast 💫\n\n✦ The Elden Ring has been restored.`
  }
];

const fs = require('fs');
const path = require('path');

const defaultSpawns = [...CHARACTER_SPAWNS]; // Make a copy of defaults
const customPath = path.join(__dirname, 'custom_characters.json');
const customWeightsPath = path.join(__dirname, 'custom_weights.json');
const customWeights = {};

function reloadCustomWeights() {
  try {
    for (const key in customWeights) {
      delete customWeights[key];
    }
    if (fs.existsSync(customWeightsPath)) {
      const loaded = JSON.parse(fs.readFileSync(customWeightsPath, 'utf8'));
      Object.assign(customWeights, loaded);
    }
  } catch (e) {
    console.error('Failed to load custom weights:', e);
  }
}

function applyCustomWeights() {
  for (const char of CHARACTER_SPAWNS) {
    if (customWeights[char.id] !== undefined) {
      char.weight = customWeights[char.id];
    }
  }
}

function reloadCustomCharacters() {
  try {
    CHARACTER_SPAWNS.length = 0;
    CHARACTER_SPAWNS.push(...defaultSpawns);

    if (fs.existsSync(customPath)) {
      const customSpawns = JSON.parse(fs.readFileSync(customPath, 'utf8'));
      CHARACTER_SPAWNS.push(...customSpawns);
    }

    applyCustomWeights();
  } catch (e) {
    console.error('Failed to load custom characters:', e);
  }
}
const disabledPath = path.join(__dirname, 'disabled_drops.json');
const disabledIds = [];

function reloadDisabledDrops() {
  try {
    disabledIds.length = 0;
    if (fs.existsSync(disabledPath)) {
      const loaded = JSON.parse(fs.readFileSync(disabledPath, 'utf8'));
      disabledIds.push(...loaded);
    }
  } catch (e) {
    console.error('Failed to load disabled drops:', e);
  }
}

// Initial loads
reloadCustomWeights();
reloadCustomCharacters();
reloadDisabledDrops();

/**
 * Returns a random character spawn based on their weights.
 */
function getRandomCharacter() {
  const activeSpawns = CHARACTER_SPAWNS.filter(c => !disabledIds.includes(c.id));
  if (activeSpawns.length === 0) {
    return CHARACTER_SPAWNS[0]; // fallback
  }

  const totalWeight = activeSpawns.reduce((acc, c) => acc + c.weight, 0);
  let random = Math.random() * totalWeight;
  for (const char of activeSpawns) {
    if (random < char.weight) {
      return char;
    }
    random -= char.weight;
  }
  return activeSpawns[0];
}

module.exports = {
  CHARACTER_SPAWNS,
  getRandomCharacter,
  reloadCustomCharacters,
  disabledIds,
  reloadDisabledDrops,
  reloadCustomWeights
};
