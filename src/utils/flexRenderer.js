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
 * Helper to round canvas corners of the card.
 */
function roundCanvasCorners(jimpImage, radius = 24) {
  const width = jimpImage.bitmap.width;
  const height = jimpImage.bitmap.height;
  
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let deletePixel = false;
      // Top-Left
      if (x < radius && y < radius) {
        if (Math.sqrt((radius - x) ** 2 + (radius - y) ** 2) > radius) deletePixel = true;
      }
      // Top-Right
      else if (x >= width - radius && y < radius) {
        if (Math.sqrt((x - (width - radius)) ** 2 + (radius - y) ** 2) > radius) deletePixel = true;
      }
      // Bottom-Left
      else if (x < radius && y >= height - radius) {
        if (Math.sqrt((radius - x) ** 2 + (y - (height - radius)) ** 2) > radius) deletePixel = true;
      }
      // Bottom-Right
      else if (x >= width - radius && y >= height - radius) {
        if (Math.sqrt((x - (width - radius)) ** 2 + (y - (height - radius)) ** 2) > radius) deletePixel = true;
      }
      
      if (deletePixel) {
        jimpImage.setPixelColor(0x00000000, x, y);
      }
    }
  }
  return jimpImage;
}

/**
 * Renders the single collectible flex showcase graphic as a PNG buffer (Top Trumps style - Dark Theme).
 */
async function renderFlexImage(username, character, dropPercentage, currencyName, isCollectible = false) {
  const width = 400;
  const height = 600;
  
  // 1. Create canvas with Premium Dark Brown background
  const canvas = new Jimp({ width, height, color: 0x1d120cff });
  
  const tierColor = hexToColor(character.color);
  
  // Draw outer rectangular border inset by 12px, colored by character tier
  drawRect(canvas, 12, 12, width - 24, height - 24, undefined, tierColor, 2);
  
  // Draw Tier Flag on top left
  drawRect(canvas, 24, 24, 60, 42, tierColor, tierColor, 2);
  
  // Draw character image slot box
  drawRect(canvas, 24, 80, 352, 240, 0x2c1f17ff, tierColor, 2);
  
  // 2. Load character image
  if (character.imagePath) {
    const resolvedImgPath = path.resolve(path.join(__dirname, '..', '..'), character.imagePath);
    if (fs.existsSync(resolvedImgPath)) {
      try {
        const charImg = await Jimp.read(resolvedImgPath);
        
        // Remove solid white background if present (e.g. color-keying out white pixels)
        const threshold = 240;
        for (let x = 0; x < charImg.bitmap.width; x++) {
          for (let y = 0; y < charImg.bitmap.height; y++) {
            const idx = (charImg.bitmap.width * y + x) * 4;
            const r = charImg.bitmap.data[idx];
            const g = charImg.bitmap.data[idx + 1];
            const b = charImg.bitmap.data[idx + 2];
            if (r > threshold && g > threshold && b > threshold) {
              charImg.bitmap.data[idx + 3] = 0; // alpha = 0 (transparent)
            }
          }
        }

        // Resize to fit image box perfectly inside borders
        charImg.resize({ w: 348, h: 236 });
        canvas.composite(charImg, 26, 82);
      } catch (imgErr) {
        console.error(`Failed to read character image at ${resolvedImgPath}:`, imgErr);
      }
    }
  }
  
  // 3. Load White Fonts for Dark Theme
  const font32Path = path.join(__dirname, '..', '..', 'node_modules', '@jimp', 'plugin-print', 'dist', 'fonts', 'open-sans', 'open-sans-32-white', 'open-sans-32-white.fnt');
  const font16Path = path.join(__dirname, '..', '..', 'node_modules', '@jimp', 'plugin-print', 'dist', 'fonts', 'open-sans', 'open-sans-16-white', 'open-sans-16-white.fnt');
  
  const font32 = await loadFont(font32Path);
  const font16 = await loadFont(font16Path);
  
  // Generate stats deterministically based on character ID
  let hash = 0;
  const strId = character.id || '';
  for (let i = 0; i < strId.length; i++) {
    hash = strId.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const getVal = (salt, min = 40, max = 95) => {
    return Math.abs((hash + salt) % (max - min + 1)) + min;
  };
  
  const multiplier = character.tier === 'DIVINE' ? 1.25 : character.tier === 'MYTHIC' ? 1.15 : character.tier === 'EPIC' ? 1.05 : 1.0;
  
  const str = Math.min(99, Math.round(getVal(1, 40, 95) * multiplier));
  const def = Math.min(99, Math.round(getVal(2, 40, 95) * multiplier));
  const spd = Math.min(99, Math.round(getVal(3, 40, 95) * multiplier));
  const mag = Math.min(99, Math.round(getVal(4, 40, 95) * multiplier));
  const totalPower = str + def + spd + mag;

  // 4. Draw Header Character Name (in white font)
  canvas.print({
    font: font32,
    x: 94,
    y: 22,
    text: character.name,
    maxWidth: 200
  });
  
  // Draw card owner/info on the top right
  canvas.print({
    font: font16,
    x: 300,
    y: 35,
    text: `FLEX`,
    maxWidth: 76,
    alignmentX: 'right'
  });
  
  // 5. Draw Stats Separator Lines (colored by tier color)
  const drawLine = (y) => {
    for (let lx = 24; lx < 376; lx++) {
      canvas.setPixelColor(tierColor, lx, y);
    }
  };

  drawLine(335);
  drawLine(375);
  drawLine(415);
  drawLine(455);
  drawLine(495);
  drawLine(535);
  drawLine(575);

  const printStatRow = (label, val, y) => {
    canvas.print({
      font: font16,
      x: 30,
      y,
      text: label
    });
    canvas.print({
      font: font16,
      x: 220,
      y,
      text: String(val),
      maxWidth: 150,
      alignmentX: 'right'
    });
  };

  printStatRow("Strength (STR):", str, 345);
  printStatRow("Defense (DEF):", def, 385);
  printStatRow("Speed (SPD):", spd, 425);
  printStatRow("Magic (MAG):", mag, 465);
  printStatRow("Total Power:", totalPower, 505);
  printStatRow("Worth (Value):", isCollectible ? `${character.value} (Rare)` : `${character.value} ${currencyName}`, 545);

  // Round the corners of the canvas
  roundCanvasCorners(canvas, 24);
  
  return await canvas.getBuffer('image/png');
}

module.exports = {
  renderFlexImage
};
