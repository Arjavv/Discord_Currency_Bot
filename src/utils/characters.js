/**
 * characters.js
 * Config file for character drops.
 * Weights determine spawn probability relative to each other (total sum: 200).
 */
const CHARACTER_SPAWNS = [
  // --- COMMON (Tiers: 100 - 150) ---
  // --- COMMON (Tiers: 300 - 500) ---
  {
    id: 'common_soul',
    name: 'Nova Blossom Soul',
    tier: 'COMMON',
    value: 300,
    weight: 100, // Common spawn probability
    imagePath: './src/assets/common_soul.png',
    attachmentName: 'common_soul.png',
    color: '#ec4899', // Pink
    embedTitle: '✦ A COMMON SOUL HAS DESCENDED ✦',
    embedDescription: 'Nova Blossom Soul has appeared! Tier: COMMON\n\nA beautiful cherry blossom spirit has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'COMMON SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Nova Blossom Soul 🌸\n\n✦ The common soul has chosen its master.`
  },
  {
    id: 'common_girl2',
    name: 'Neon Frost Soul',
    tier: 'COMMON',
    value: 500,
    weight: 100, // Common spawn probability
    imagePath: './src/assets/common_girl2.png',
    attachmentName: 'common_girl2.png',
    color: '#06b6d4', // Cyan
    embedTitle: '✦ A COMMON SOUL HAS DESCENDED ✦',
    embedDescription: 'Neon Frost Soul has appeared! Tier: COMMON\n\nA gorgeous frost spirit with glowing silver-blue hair has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'COMMON SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Neon Frost Soul ❄️\n\n✦ The common soul has chosen its master.`
  },

  // --- UNCOMMON (Tiers: 1200 - 1800) ---
  {
    id: 'uncommon_soul',
    name: 'Solar Flare Soul',
    tier: 'UNCOMMON',
    value: 1200,
    weight: 50, // Uncommon spawn probability
    imagePath: './src/assets/uncommon_soul.png',
    attachmentName: 'uncommon_soul.png',
    color: '#f97316', // Orange
    embedTitle: '✦ AN UNCOMMON SOUL HAS DESCENDED ✦',
    embedDescription: 'Solar Flare Soul has appeared! Tier: UNCOMMON\n\nA stunning sun spirit with burning orange-gold hair has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'UNCOMMON SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Solar Flare Soul ☀️\n\n✦ The uncommon soul has chosen its master.`
  },
  {
    id: 'uncommon_girl2',
    name: 'Deep Abyss Soul',
    tier: 'UNCOMMON',
    value: 1800,
    weight: 50, // Uncommon spawn probability
    imagePath: './src/assets/uncommon_girl2.png',
    attachmentName: 'uncommon_girl2.png',
    color: '#3b82f6', // Blue
    embedTitle: '✦ AN UNCOMMON SOUL HAS DESCENDED ✦',
    embedDescription: 'Deep Abyss Soul has appeared! Tier: UNCOMMON\n\nA beautiful deep sea mermaid spirit with bioluminescent scales has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'UNCOMMON SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Deep Abyss Soul 🌊\n\n✦ The uncommon soul has chosen its master.`
  },

  // --- RARE (Tiers: 4000 - 5500) ---
  {
    id: 'rare_soul',
    name: 'Spectral Storm Soul',
    tier: 'RARE',
    value: 4000,
    weight: 25, // Rare spawn probability
    imagePath: './src/assets/rare_soul.png',
    attachmentName: 'rare_soul.png',
    color: '#8b5cf6', // Violet
    embedTitle: '✦ A RARE SOUL HAS DESCENDED ✦',
    embedDescription: 'Spectral Storm Soul has appeared! Tier: RARE\n\nA gorgeous lightning spirit with crackling violet electricity has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'RARE SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Spectral Storm Soul ⚡\n\n✦ The rare soul has chosen its master.`
  },
  {
    id: 'rare_girl2',
    name: 'Verdant Luster Soul',
    tier: 'RARE',
    value: 5500,
    weight: 25, // Rare spawn probability
    imagePath: './src/assets/rare_girl2.png',
    attachmentName: 'rare_girl2.png',
    color: '#10b981', // Emerald green
    embedTitle: '✦ A RARE SOUL HAS DESCENDED ✦',
    embedDescription: 'Verdant Luster Soul has appeared! Tier: RARE\n\nA beautiful emerald forest spirit with a leaf crown has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'RARE SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Verdant Luster Soul 🌿\n\n✦ The rare soul has chosen its master.`
  },

  // --- EPIC / MYTHIC (Tiers: 12000 - 25000) ---
  {
    id: 'epic_girl2',
    name: 'Astral Eclipse Soul',
    tier: 'EPIC',
    value: 12000,
    weight: 10, // Epic spawn probability
    imagePath: './src/assets/epic_girl2.png',
    attachmentName: 'epic_girl2.png',
    color: '#6366f1', // Indigo
    embedTitle: '✦ AN EPIC SOUL HAS DESCENDED ✦',
    embedDescription: 'Astral Eclipse Soul has appeared! Tier: EPIC\n\nA mysterious dark celestial spirit surrounded by an eclipsing ring has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'EPIC SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Astral Eclipse Soul 🔮\n\n✦ The epic soul has chosen its master.`
  },
  {
    id: 'mythic_soul',
    name: 'Celestial Empress Soul',
    tier: 'MYTHIC',
    value: 25000,
    weight: 5, // Mythic spawn probability (low priority)
    imagePath: './src/assets/mythic_soul.png',
    attachmentName: 'mythic_soul.png',
    color: '#fbbf24', // Gold
    embedTitle: '✦ A MYTHIC SOUL HAS DESCENDED ✦',
    embedDescription: 'Celestial Empress Soul has appeared! Tier: MYTHIC\n\nA magnificent golden-winged celestial queen of divine light has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'MYTHIC SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Celestial Empress Soul 👑\n\n✦ The mythic soul has chosen its master.`
  },

  // --- DIVINE (Tiers: 40000 - 50000) ---
  {
    id: 'divine_soul',
    name: 'Divine Soul',
    tier: 'DIVINE',
    value: 100000,
    weight: 1, // Divine spawn probability (rarest spawn chance)
    imagePath: './src/assets/divine_soul_purple.png',
    attachmentName: 'divine_soul_purple.png',
    color: '#a855f7', // Purple
    embedTitle: '✦ A DIVINE SOUL HAS DESCENDED ✦',
    embedDescription: 'Divine Soul has appeared! Tier: DIVINE\n\nA beautiful purple-haired divine soul with cat ears has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'DIVINE SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Divine Soul 💜\n\n✦ The divine soul has chosen its master.`
  },
  {
    id: 'kimi_kitsune',
    name: 'Kimi Kitsune',
    tier: 'DIVINE',
    value: 100000,
    weight: 1, // Divine spawn probability (rarest spawn chance)
    imagePath: './src/assets/kimi_cyber_kitsune.png',
    attachmentName: 'kimi_cyber_kitsune.png',
    color: '#ff00aa', // Hot pink / neon-pink
    embedTitle: '✦ A DIVINE CYBER-KITSUNE HAS DESCENDED ✦',
    embedDescription: 'Kimi Kitsune has appeared! Tier: DIVINE\n\nA beautiful cyber-kitsune girl with glowing fox ears and neon pink accents has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'DIVINE KITSUNE CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Kimi Kitsune 🌸🦊\n\n✦ The cyber-kitsune has chosen its master.`
  },
  {
    id: 'divine_girl2',
    name: 'Infinity Void Soul',
    tier: 'DIVINE',
    value: 50000,
    weight: 1, // Divine spawn probability (rarest spawn chance)
    imagePath: './src/assets/divine_girl2.png',
    attachmentName: 'divine_girl2.png',
    color: '#db2777', // Deep pink
    embedTitle: '✦ A DIVINE SOUL HAS DESCENDED ✦',
    embedDescription: 'Infinity Void Soul has appeared! Tier: DIVINE\n\nAn iridescent dark-matter goddess from the edge of the universe has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'DIVINE SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Infinity Void Soul ✨\n\n✦ The divine soul has chosen its master.`
  },
  // --- CUTE CATS ---
  {
    id: 'cat_wink',
    name: 'Winky Glasses Cat',
    tier: 'UNCOMMON',
    value: 400,
    weight: 25,
    imagePath: './src/assets/wink_cat.png',
    attachmentName: 'wink_cat.png',
    color: '#3b82f6',
    embedTitle: '✦ AN UNCOMMON CAT HAS DESCENDED ✦',
    embedDescription: 'Winky Glasses Cat has appeared! Tier: UNCOMMON\n\nA silly winking cat with red glasses has entered this realm...\n\nType soul to claim it!',
    claimTitle: 'UNCOMMON CAT CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Winky Glasses Cat 😜\n\n✦ The winking glasses cat has chosen its master.`
  },
  {
    id: 'cat_derp',
    name: 'Shocked Cat',
    tier: 'COMMON',
    value: 150,
    weight: 50,
    imagePath: './src/assets/derp_cat.png',
    attachmentName: 'derp_cat.png',
    color: '#4ade80',
    embedTitle: '✦ A COMMON CAT HAS DESCENDED ✦',
    embedDescription: 'Shocked Cat has appeared! Tier: COMMON\n\nA surprised shocked cat has entered this realm...\n\nType soul to claim it!',
    claimTitle: 'COMMON CAT CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Shocked Cat 🙀\n\n✦ The shocked cat has chosen its master.`
  },
  {
    id: 'cat_smug',
    name: 'Smug Orange Cat',
    tier: 'RARE',
    value: 900,
    weight: 15,
    imagePath: './src/assets/smug_cat.png',
    attachmentName: 'smug_cat.png',
    color: '#f97316',
    embedTitle: '✦ A RARE CAT HAS DESCENDED ✦',
    embedDescription: 'Smug Orange Cat has appeared! Tier: RARE\n\nA cool orange tabby has entered this realm...\n\nType soul to claim it!',
    claimTitle: 'RARE CAT CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Smug Orange Cat 😏\n\n✦ The smug orange cat has chosen its master.`
  },
  {
    id: 'cat_heart',
    name: 'Heart Kitten',
    tier: 'DIVINE',
    value: 3000,
    weight: 2,
    imagePath: './src/assets/heart_cat.png',
    attachmentName: 'heart_cat.png',
    color: '#fbbf24',
    embedTitle: '✦ A DIVINE KITTEN HAS DESCENDED ✦',
    embedDescription: 'Heart Kitten has appeared! Tier: DIVINE\n\nAn incredibly cute fluffy kitten holding a heart has entered this realm...\n\nType soul to claim it!',
    claimTitle: 'DIVINE KITTEN CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Heart Kitten ❤️\n\n✦ The lovely kitten has chosen its master.`
  },
  {
    id: 'cat_angel',
    name: 'Fancy Angel Cat',
    tier: 'EPIC',
    value: 1800,
    weight: 8,
    imagePath: './src/assets/angel_cat.png',
    attachmentName: 'angel_cat.png',
    color: '#db2777',
    embedTitle: '✦ AN EPIC ANGEL CAT HAS DESCENDED ✦',
    embedDescription: 'Fancy Angel Cat has appeared! Tier: EPIC\n\nA beautiful white cat wearing a fancy pink collar has entered this realm...\n\nType soul to claim it!',
    claimTitle: 'EPIC ANGEL CAT CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Fancy Angel Cat ✨\n\n✦ The fancy angel kitty has chosen its master.`
  },
  // --- LEGENDARY / FAMOUS ANIME & GAME BOSSES (VARYING VALUES) ---
  {
    id: 'boss_malenia',
    name: 'Malenia, Blade of Miquella',
    tier: 'MYTHIC',
    value: 35000,
    weight: 3,
    imagePath: './src/assets/boss_malenia.jpg',
    attachmentName: 'boss_malenia.jpg',
    color: '#d97706',
    embedTitle: '✦ A MYTHIC BOSS HAS DESCENDED ✦',
    embedDescription: 'Malenia, Blade of Miquella has appeared! Tier: MYTHIC\n\n"I am Malenia, Blade of Miquella, and I have never known defeat."\n\nType soul to claim her!',
    claimTitle: 'MYTHIC BOSS CLAIMED!',
    claimDescription: (userMention) => `${userMention} defeated Malenia, Blade of Miquella ⚔️\n\n✦ The Goddess of Rot has met her match.`
  },
  {
    id: 'ryomen_sukuna',
    name: 'Ryomen Sukuna',
    tier: 'MYTHIC',
    value: 32000,
    weight: 3,
    imagePath: './src/assets/ryomen_sukuna.png',
    attachmentName: 'ryomen_sukuna.png',
    color: '#8b0000',
    embedTitle: '✦ THE KING OF CURSES HAS DESCENDED ✦',
    embedDescription: 'Ryomen Sukuna has appeared! Tier: MYTHIC\n\n"I am the honored one. Bow before the King of Curses."\n\nType soul to claim him... if you dare!',
    claimTitle: 'MYTHIC SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} tamed Ryomen Sukuna 👑\n\n✦ The King of Curses acknowledges your worth.`
  },
  {
    id: 'boss_elden_beast',
    name: 'Elden Beast',
    tier: 'EPIC',
    value: 22000,
    weight: 6,
    imagePath: './src/assets/boss_elden_beast.png',
    attachmentName: 'boss_elden_beast.png',
    color: '#2563eb',
    embedTitle: '✦ AN EPIC BOSS HAS DESCENDED ✦',
    embedDescription: 'Elden Beast has appeared! Tier: EPIC\n\nThe vassal beast of the Greater Will has descended!\n\nType soul to claim it!',
    claimTitle: 'EPIC BOSS CLAIMED!',
    claimDescription: (userMention) => `${userMention} defeated the Elden Beast 💫\n\n✦ The Elden Ring has been restored.`
  },
  {
    id: 'boss_radahn',
    name: 'Starscourge Radahn',
    tier: 'EPIC',
    value: 18000,
    weight: 6,
    imagePath: './src/assets/boss_radahn.png',
    attachmentName: 'boss_radahn.png',
    color: '#dc2626',
    embedTitle: '✦ AN EPIC BOSS HAS DESCENDED ✦',
    embedDescription: 'Starscourge Radahn has appeared! Tier: EPIC\n\nThe conqueror of the stars has arrived!\n\nType soul to claim him!',
    claimTitle: 'EPIC BOSS CLAIMED!',
    claimDescription: (userMention) => `${userMention} defeated Starscourge Radahn ☄️\n\n✦ The Starscourge has fallen.`
  },
  {
    id: 'raiden_shogun',
    name: 'Raiden Shogun',
    tier: 'EPIC',
    value: 15000,
    weight: 8,
    imagePath: './src/assets/raiden_shogun.png',
    attachmentName: 'raiden_shogun.png',
    color: '#7c3aed',
    embedTitle: '✦ THE ELECTRO ARCHON HAS DESCENDED ✦',
    embedDescription: 'Raiden Shogun has appeared! Tier: EPIC\n\n"Eternity. That is what I seek, for Inazuma and its people."\n\nType soul to claim her!',
    claimTitle: 'EPIC SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} earned the Shogun\'s favor ⚡\n\n✦ The Electro Archon has granted you her eternal grace.`
  },
  {
    id: 'makima_csm',
    name: 'Makima',
    tier: 'EPIC',
    value: 13500,
    weight: 8,
    imagePath: './src/assets/makima_csm.png',
    attachmentName: 'makima_csm.png',
    color: '#c0392b',
    embedTitle: '✦ THE CONTROL DEVIL HAS DESCENDED ✦',
    embedDescription: 'Makima has appeared! Tier: EPIC\n\nThe mysterious and all-controlling Public Safety Devil Hunter has arrived...\n\nType soul to claim her!',
    claimTitle: 'EPIC SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} was chosen by Makima 🔴\n\n✦ The Control Devil has her eye on you now.`
  },
  {
    id: 'guts_berserk',
    name: 'Guts, the Black Swordsman',
    tier: 'RARE',
    value: 8500,
    weight: 15,
    imagePath: './src/assets/guts_berserk.png',
    attachmentName: 'guts_berserk.png',
    color: '#1a1a1a',
    embedTitle: '✦ THE BLACK SWORDSMAN HAS DESCENDED ✦',
    embedDescription: 'Guts has appeared! Tier: RARE\n\n"You\'re a puny human, aren\'t you? I\'ll have to try harder."\n\nType soul to claim him!',
    claimTitle: 'RARE SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} earned Guts\' respect ⚔️\n\n✦ The Black Swordsman walks beside you now.`
  },
  {
    id: 'roronoa_zoro',
    name: 'Roronoa Zoro',
    tier: 'RARE',
    value: 7500,
    weight: 15,
    imagePath: './src/assets/roronoa_zoro.jpg',
    attachmentName: 'roronoa_zoro.jpg',
    color: '#2d6a2d',
    embedTitle: '✦ A RARE SOUL HAS DESCENDED ✦',
    embedDescription: 'Roronoa Zoro has appeared! Tier: RARE\n\n"I\'m going to be the greatest swordsman in the world!"\n\nType soul to claim him!',
    claimTitle: 'RARE SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} recruited Roronoa Zoro ⚔️\n\n✦ The three-sword master has pledged his blade.`
  },
  {
    id: 'dante_dmc',
    name: 'Dante',
    tier: 'RARE',
    value: 6000,
    weight: 15,
    imagePath: './src/assets/dante_dmc.png',
    attachmentName: 'dante_dmc.png',
    color: '#c0392b',
    embedTitle: '✦ THE SON OF SPARDA HAS DESCENDED ✦',
    embedDescription: 'Dante has appeared! Tier: RARE\n\n"I\'m a devil hunter. I\'m also a demon... sort of."\n\nType soul to claim him!',
    claimTitle: 'RARE SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} recruited Dante 🗡️\n\n✦ The legendary devil hunter fights by your side.`
  },
  {
    id: 'ben_tennyson',
    name: 'Ben Tennyson',
    tier: 'UNCOMMON',
    value: 3200,
    weight: 25,
    imagePath: './src/assets/ben_tennyson.png',
    attachmentName: 'ben_tennyson.png',
    color: '#16a34a',
    embedTitle: '✦ THE HERO OF HEROES HAS DESCENDED ✦',
    embedDescription: 'Ben Tennyson has appeared! Tier: UNCOMMON\n\n"It\'s hero time!"\n\nType soul to claim him!',
    claimTitle: 'UNCOMMON SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} teamed up with Ben Tennyson 🟢\n\n✦ The wielder of the Omnitrix has chosen you as a partner.`
  },
  {
    id: 'ada_wong',
    name: 'Ada Wong',
    tier: 'UNCOMMON',
    value: 2800,
    weight: 30,
    imagePath: './src/assets/ada_wong.png',
    attachmentName: 'ada_wong.png',
    color: '#8b0000',
    embedTitle: '✦ AN UNCOMMON SOUL HAS DESCENDED ✦',
    embedDescription: 'Ada Wong has appeared! Tier: UNCOMMON\n\nThe elusive spy and master of deception has entered this realm...\n\nType soul to claim her!',
    claimTitle: 'UNCOMMON SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} caught Ada Wong 🕵️\n\n✦ The mysterious spy has decided to stay... for now.`
  },
  {
    id: 'leon_kennedy',
    name: 'Leon S. Kennedy',
    tier: 'UNCOMMON',
    value: 2400,
    weight: 30,
    imagePath: './src/assets/leon_kennedy.png',
    attachmentName: 'leon_kennedy.png',
    color: '#1e3a5f',
    embedTitle: '✦ AN UNCOMMON SOUL HAS DESCENDED ✦',
    embedDescription: 'Leon S. Kennedy has appeared! Tier: UNCOMMON\n\n"The only thing that can stop a bad guy with a gun is a good guy with a gun."\n\nType soul to claim him!',
    claimTitle: 'UNCOMMON SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} recruited Leon S. Kennedy 🔫\n\n✦ The legendary government agent has chosen his partner.`
  },
  {
    id: 'rangiku_matsumoto',
    name: 'Rangiku Matsumoto',
    tier: 'COMMON',
    value: 950,
    weight: 60,
    imagePath: './src/assets/rangiku_matsumoto.png',
    attachmentName: 'rangiku_matsumoto.png',
    color: '#e8a020',
    embedTitle: '✦ A COMMON SOUL HAS DESCENDED ✦',
    embedDescription: 'Rangiku Matsumoto has appeared! Tier: COMMON\n\nThe Lieutenant of Squad 10 and wielder of Haineko has graced this realm...\n\nType soul to claim her!',
    claimTitle: 'COMMON SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} caught Rangiku Matsumoto 🌸\n\n✦ The Soul Society\'s finest lieutenant has chosen you.`
  },

  // --- NEW FAMOUS ANIME & GAME CHARACTERS (VARYING VALUES) ---
  {
    id: 'dbz_goku',
    name: 'Goku',
    tier: 'DIVINE',
    value: 80000,
    weight: 1, // Extremely rare
    imagePath: './src/assets/dbz_goku.png',
    attachmentName: 'dbz_goku.png',
    color: '#f97316', // Orange
    embedTitle: '✦ A DIVINE SAIYAN HAS DESCENDED ✦',
    embedDescription: 'Goku has appeared! Tier: DIVINE\n\n"I am the hope of the universe. I am the answer to all living things that cry out for peace!"\n\nType soul to claim him!',
    claimTitle: 'DIVINE WARRIOR CLAIMED!',
    claimDescription: (userMention) => `${userMention} teamed up with Goku 💥\n\n✦ The legendary Saiyan warrior respects your spirit.`
  },
  {
    id: 'op_luffy',
    name: 'Monkey D. Luffy',
    tier: 'MYTHIC',
    value: 30000,
    weight: 4,
    imagePath: './src/assets/op_luffy.png',
    attachmentName: 'op_luffy.png',
    color: '#ef4444', // Red
    embedTitle: '✦ A MYTHIC PIRATE HAS DESCENDED ✦',
    embedDescription: 'Monkey D. Luffy has appeared! Tier: MYTHIC\n\n"I\'m gonna be the Pirate King!"\n\nType soul to claim him!',
    claimTitle: 'MYTHIC SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} recruited Monkey D. Luffy 🍖\n\n✦ The Future Pirate King joins your crew.`
  },
  {
    id: 'gow_kratos',
    name: 'Kratos',
    tier: 'MYTHIC',
    value: 28000,
    weight: 4,
    imagePath: './src/assets/gow_kratos.png',
    attachmentName: 'gow_kratos.png',
    color: '#dc2626', // Deep Red
    embedTitle: '✦ A MYTHIC GOD OF WAR HAS DESCENDED ✦',
    embedDescription: 'Kratos has appeared! Tier: MYTHIC\n\n"Boy! Read this."\n\nType soul to claim him!',
    claimTitle: 'MYTHIC BOSS CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Kratos 🪓\n\n✦ The God of War acknowledges your strength.`
  },
  {
    id: 'ut_sans',
    name: 'Sans',
    tier: 'RARE',
    value: 9000,
    weight: 15,
    imagePath: './src/assets/ut_sans.png',
    attachmentName: 'ut_sans.png',
    color: '#3b82f6', // Light Blue
    embedTitle: '✦ A RARE SKELETON HAS DESCENDED ✦',
    embedDescription: 'Sans has appeared! Tier: RARE\n\n"you\'re gonna have a bad time."\n\nType soul to claim him!',
    claimTitle: 'RARE SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} befriended Sans 💀\n\n✦ Sans decided to hang out with you.`
  },
  {
    id: 'mc_steve',
    name: 'Steve',
    tier: 'UNCOMMON',
    value: 2200,
    weight: 40,
    imagePath: './src/assets/mc_steve.png',
    attachmentName: 'mc_steve.png',
    color: '#06b6d4', // Teal
    embedTitle: '✦ AN UNCOMMON BLOCK-BUILDER HAS DESCENDED ✦',
    embedDescription: 'Steve has appeared! Tier: UNCOMMON\n\nThe legendary builder from Minecraft has stepped into this realm...\n\nType soul to claim him!',
    claimTitle: 'UNCOMMON SOUL CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Steve ⛏️\n\n✦ Steve crafted a bond with you.`
  },
  {
    id: 'pk_pikachu',
    name: 'Pikachu',
    tier: 'COMMON',
    value: 600,
    weight: 80,
    imagePath: './src/assets/pk_pikachu.png',
    attachmentName: 'pk_pikachu.png',
    color: '#fbbf24', // Yellow
    embedTitle: '✦ A COMMON MONSTER HAS DESCENDED ✦',
    embedDescription: 'Pikachu has appeared! Tier: COMMON\n\n"Pika-chuuuu!"\n\nType soul to claim it!',
    claimTitle: 'COMMON MONSTER CLAIMED!',
    claimDescription: (userMention) => `${userMention} captured Pikachu ⚡\n\n✦ Pikachu has chosen you as its trainer.`
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
