const { Jimp, loadFont } = require('jimp');
const path = require('path');
const fs = require('fs');

/**
 * Converts a hex color string (e.g. '#fda4af') to a Jimp hex number.
 */
function hexToColor(hexStr) {
  if (!hexStr) return 0xd4af37ff; // default gold
  const clean = hexStr.replace('#', '');
  return parseInt(clean + 'ff', 16);
}

/**
 * Helper to draw a filled rectangle with border.
 */
function drawRect(image, x, y, w, h, fillColor, borderColor, borderWidth = 2) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (dx < borderWidth || dx >= w - borderWidth || dy < borderWidth || dy >= h - borderWidth) {
        if (borderColor !== undefined) {
          image.setPixelColor(borderColor, px, py);
        }
      } else {
        if (fillColor !== undefined) {
          image.setPixelColor(fillColor, px, py);
        }
      }
    }
  }
}

/**
 * Renders the single collectible flex showcase graphic as a PNG buffer.
 * @param {string} username - Player's Discord username
 * @param {Object} character - Character/Collectible details
 * @param {string} dropPercentage - Formatted drop chance percentage
 * @param {string} currencyName - Guild's currency name
 * @returns {Promise<Buffer>}
 */
async function renderFlexImage(username, character, dropPercentage, currencyName, isCollectible = false) {
  const width = 600;
  const height = 250;
  
  // 1. Create canvas
  const canvas = new Jimp({ width, height, color: 0x1d120cff }); // Very dark brown
  
  const tierColor = hexToColor(character.color);
  
  // Draw outer card border colored by rarity/tier
  drawRect(canvas, 0, 0, width, height, undefined, tierColor, 4);
  
  // Draw character image box
  drawRect(canvas, 28, 43, 164, 164, 0x2c1f17ff, tierColor, 2);
  
  // 2. Load character image
  if (character.imagePath) {
    const resolvedImgPath = path.resolve(path.join(__dirname, '..', '..'), character.imagePath);
    if (fs.existsSync(resolvedImgPath)) {
      try {
        const charImg = await Jimp.read(resolvedImgPath);
        charImg.resize({ w: 160, h: 160 });
        canvas.composite(charImg, 30, 45);
      } catch (imgErr) {
        console.error(`Failed to read character image at ${resolvedImgPath}:`, imgErr);
      }
    }
  }
  
  // 3. Load Fonts
  const font32Path = path.join(__dirname, '..', '..', 'node_modules', '@jimp', 'plugin-print', 'dist', 'fonts', 'open-sans', 'open-sans-32-white', 'open-sans-32-white.fnt');
  const font16Path = path.join(__dirname, '..', '..', 'node_modules', '@jimp', 'plugin-print', 'dist', 'fonts', 'open-sans', 'open-sans-16-white', 'open-sans-16-white.fnt');
  
  const font32 = await loadFont(font32Path);
  const font16 = await loadFont(font16Path);
  
  // 4. Draw Header / Character Name
  canvas.print({
    font: font32,
    x: 220,
    y: 35,
    text: character.name,
    maxWidth: 350
  });
  
  // 5. Draw Info Labels
  canvas.print({
    font: font16,
    x: 220,
    y: 105,
    text: `Tier: ${character.tier}`
  });
  
  const valueLabelText = isCollectible
    ? `Value: ${character.value} ${currencyName} (Rare)`
    : `Value: ${character.value} ${currencyName}`;

  canvas.print({
    font: font16,
    x: 220,
    y: 130,
    text: valueLabelText
  });
  
  canvas.print({
    font: font16,
    x: 220,
    y: 155,
    text: `Drop Chance: ${dropPercentage}%`
  });
  
  canvas.print({
    font: font16,
    x: 220,
    y: 185,
    text: `Flexed by: ${username}`
  });
  
  return await canvas.getBuffer('image/png');
}

module.exports = {
  renderFlexImage
};
