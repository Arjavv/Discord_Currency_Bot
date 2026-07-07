/**
 * characters.js
 * Config file for character drops.
 * Weights determine spawn probability relative to each other (e.g. 100 is base).
 */
const CHARACTER_SPAWNS = [
  {
    id: 'divine_soul',
    name: 'Divine Soul',
    tier: 'DIVINE',
    value: 700,
    weight: 100, // spawn weight (currently 100% since it's the only one)
    imagePath: './src/assets/divine_soul_purple.png',
    attachmentName: 'divine_soul_purple.png',
    color: '#a855f7', // Deep purple
    embedTitle: '✦ A DIVINE SOUL HAS DESCENDED ✦',
    embedDescription: 'Divine Soul has appeared! 👑 Tier: DIVINE\n\nA rare presence has entered this realm...\n\nType soul to claim her!',
    claimTitle: '👑 DIVINE SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Divine Soul 💜\n\n✦ The divine soul has chosen its master.`
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
