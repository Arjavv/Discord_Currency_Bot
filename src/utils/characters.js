/**
 * characters.js
 * Config file for character drops.
 * Weights determine spawn probability relative to each other (total sum: 100).
 */
const CHARACTER_SPAWNS = [
  {
    id: 'common_soul',
    name: 'Blossom Soul',
    tier: 'COMMON',
    value: 100,
    weight: 50, // 50% spawn chance
    imagePath: './src/assets/common_soul.png',
    attachmentName: 'common_soul.png',
    color: '#ec4899', // Pink
    embedTitle: '✦ A COMMON SOUL HAS DESCENDED ✦',
    embedDescription: 'Blossom Soul has appeared! 👑 Tier: COMMON\n\nA rare presence has entered this realm...\n\nType soul to claim her!',
    claimTitle: '👑 COMMON SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Blossom Soul 💚\n\n✦ The common soul has chosen its master.`
  },
  {
    id: 'uncommon_soul',
    name: 'Azure Soul',
    tier: 'UNCOMMON',
    value: 300,
    weight: 25, // 25% spawn chance
    imagePath: './src/assets/uncommon_soul.png',
    attachmentName: 'uncommon_soul.png',
    color: '#3b82f6', // Blue
    embedTitle: '✦ AN UNCOMMON SOUL HAS DESCENDED ✦',
    embedDescription: 'Azure Soul has appeared! 👑 Tier: UNCOMMON\n\nA rare presence has entered this realm...\n\nType soul to claim her!',
    claimTitle: '👑 UNCOMMON SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Azure Soul 💙\n\n✦ The uncommon soul has chosen its master.`
  },
  {
    id: 'rare_soul',
    name: 'Ember Soul',
    tier: 'RARE',
    value: 500,
    weight: 15, // 15% spawn chance
    imagePath: './src/assets/rare_soul.png',
    attachmentName: 'rare_soul.png',
    color: '#f97316', // Orange
    embedTitle: '✦ A RARE SOUL HAS DESCENDED ✦',
    embedDescription: 'Ember Soul has appeared! 👑 Tier: RARE\n\nA rare presence has entered this realm...\n\nType soul to claim her!',
    claimTitle: '👑 RARE SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Ember Soul ❤️\n\n✦ The rare soul has chosen its master.`
  },
  {
    id: 'divine_soul',
    name: 'Divine Soul',
    tier: 'DIVINE',
    value: 700,
    weight: 8, // 8% spawn chance
    imagePath: './src/assets/divine_soul_purple.png',
    attachmentName: 'divine_soul_purple.png',
    color: '#a855f7', // Purple
    embedTitle: '✦ A DIVINE SOUL HAS DESCENDED ✦',
    embedDescription: 'Divine Soul has appeared! 👑 Tier: DIVINE\n\nA rare presence has entered this realm...\n\nType soul to claim her!',
    claimTitle: '👑 DIVINE SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Divine Soul 💜\n\n✦ The divine soul has chosen its master.`
  },
  {
    id: 'mythic_soul',
    name: 'Goddess Soul',
    tier: 'MYTHIC',
    value: 1000,
    weight: 2, // 2% spawn chance (most rare, most beautiful)
    imagePath: './src/assets/mythic_soul.png',
    attachmentName: 'mythic_soul.png',
    color: '#fbbf24', // Gold
    embedTitle: '✦ A MYTHIC SOUL HAS DESCENDED ✦',
    embedDescription: 'Goddess Soul has appeared! 👑 Tier: MYTHIC\n\nA rare presence has entered this realm...\n\nType soul to claim her!',
    claimTitle: '👑 MYTHIC SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Goddess Soul 💛\n\n✦ The mythic soul has chosen its master.`
  }
];

/**
 * Returns a random character spawn based on their weights.
 */
function getRandomCharacter() {
  const totalWeight = CHARACTER_SPAWNS.reduce((acc, c) => acc + c.weight, 0);
  let random = Math.random() * totalWeight;
  for (const char of CHARACTER_SPAWNS) {
    if (random < char.weight) {
      return char;
    }
    random -= char.weight;
  }
  return CHARACTER_SPAWNS[0]; // fallback
}

module.exports = {
  CHARACTER_SPAWNS,
  getRandomCharacter
};
