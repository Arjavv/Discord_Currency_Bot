const { Jimp, loadFont } = require('jimp');
const path = require('path');
const fs = require('fs');

/**
 * Helper to crop a Jimp image to be circular.
 */
function makeCircular(jimpImage) {
  const width = jimpImage.bitmap.width;
  const height = jimpImage.bitmap.height;
  const center = { x: width / 2, y: height / 2 };
  const radius = Math.min(width, height) / 2 - 2;

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const distance = Math.sqrt((x - center.x) ** 2 + (y - center.y) ** 2);
      if (distance > radius) {
        jimpImage.setPixelColor(0x00000000, x, y);
      }
    }
  }
  return jimpImage;
}

/**
 * Helper to draw a circle ring border.
 */
function drawRing(image, cx, cy, radius, borderWidth, color) {
  const rOuter = radius;
  const rInner = radius - borderWidth;
  for (let y = -rOuter; y <= rOuter; y++) {
    for (let x = -rOuter; x <= rOuter; x++) {
      const distSq = x * x + y * y;
      if (distSq <= rOuter * rOuter && distSq >= rInner * rInner) {
        image.setPixelColor(color, cx + x, cy + y);
      }
    }
  }
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
 * Converts a hex color string (e.g. '#fda4af') to a Jimp hex number.
 */
function hexToColor(hexStr) {
  if (!hexStr) return 0xd4af37ff; // default gold
  const clean = hexStr.replace('#', '');
  return parseInt(clean + 'ff', 16);
}

/**
 * Renders the inventory graphic as a PNG buffer.
 * @param {string} username - Player's Discord username
 * @param {string|null} avatarUrl - Player's avatar URL
 * @param {Array} items - List of inventory items { name, tier, quantity, color, imagePath }
 * @param {number} totalCaught - Sum of all caught character quantities
 * @returns {Promise<Buffer>}
 */
async function renderInventoryImage(username, avatarUrl, items, totalCaught) {
  const width = 800;
  
  // Calculate dynamic rows (6 columns max)
  const columns = 6;
  const slotSize = 90;
  const spacing = 15;
  const rows = Math.max(1, Math.ceil(items.length / columns));
  
  const gridHeight = rows * slotSize + (rows - 1) * spacing;
  const height = 130 + gridHeight + 30; // 130 header, grid, 30 padding bottom
  
  // 1. Create canvas
  const canvas = new Jimp({ width, height, color: 0x1d120cff }); // Very dark brown
  
  // Draw outer golden frame border
  const goldColor = 0xd4af37ff;
  drawRect(canvas, 0, 0, width, height, undefined, goldColor, 4);
  
  // 2. Fetch and draw circular avatar
  let avatarImg = null;
  if (avatarUrl) {
    try {
      const res = await fetch(avatarUrl);
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        avatarImg = await Jimp.read(buffer);
        avatarImg.resize({ w: 80, h: 80 });
        avatarImg = makeCircular(avatarImg);
      }
    } catch (err) {
      console.error('Failed to load avatar for inventory render:', err);
    }
  }
  
  if (avatarImg) {
    canvas.composite(avatarImg, 40, 25);
    drawRing(canvas, 80, 65, 42, 3, goldColor);
  } else {
    // Fallback circular placeholder
    drawRing(canvas, 80, 65, 42, 3, goldColor);
  }
  
  // 3. Load Fonts
  const font32Path = path.join(__dirname, '..', '..', 'node_modules', '@jimp', 'plugin-print', 'dist', 'fonts', 'open-sans', 'open-sans-32-white', 'open-sans-32-white.fnt');
  const font16Path = path.join(__dirname, '..', '..', 'node_modules', '@jimp', 'plugin-print', 'dist', 'fonts', 'open-sans', 'open-sans-16-white', 'open-sans-16-white.fnt');
  
  const font32 = await loadFont(font32Path);
  const font16 = await loadFont(font16Path);
  
  // 4. Draw Header Text
  canvas.print({
    font: font32,
    x: 140,
    y: 32,
    text: `${username}'s Inventory`
  });
  
  canvas.print({
    font: font16,
    x: 140,
    y: 72,
    text: `Caught: ${totalCaught} Soul${totalCaught === 1 ? '' : 's'}`
  });
  
  // 5. Draw Item Grid
  if (items.length === 0) {
    // Show empty state text
    canvas.print({
      font: font16,
      x: 140,
      y: 160,
      text: "Your inventory is currently empty!\nSpawns will appear randomly in chat. Type 'soul' to catch them."
    });
  } else {
    // Draw slots
    const startX = Math.round((width - (columns * slotSize + (columns - 1) * spacing)) / 2);
    const startY = 130;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const col = i % columns;
      const row = Math.floor(i / columns);
      
      const slotX = startX + col * (slotSize + spacing);
      const slotY = startY + row * (slotSize + spacing);
      
      // Determine slot border color based on character tier (e.g. green for Common, blue for Uncommon)
      const slotBorderColor = hexToColor(item.color);
      
      // Draw slot box (lighter brown fill)
      drawRect(canvas, slotX, slotY, slotSize, slotSize, 0x2c1f17ff, slotBorderColor, 2);
      
      // Load character image
      if (item.imagePath) {
        const resolvedImgPath = path.resolve(path.join(__dirname, '..', '..'), item.imagePath);
        if (fs.existsSync(resolvedImgPath)) {
          try {
            const charImg = await Jimp.read(resolvedImgPath);
            charImg.resize({ w: 76, h: 76 });
            canvas.composite(charImg, slotX + 7, slotY + 7);
          } catch (imgErr) {
            console.error(`Failed to read character image at ${resolvedImgPath}:`, imgErr);
          }
        }
      }
      
      // Draw quantity badge background
      // Badge width: 32, height: 18 at bottom right corner
      const badgeX = slotX + slotSize - 34;
      const badgeY = slotY + slotSize - 22;
      drawRect(canvas, badgeX, badgeY, 32, 18, 0x1d120cff, goldColor, 1);
      
      // Print quantity text (e.g. x3)
      // Slight adjustments to center text
      canvas.print({
        font: font16,
        x: badgeX + 4,
        y: badgeY - 1,
        text: `x${item.quantity}`
      });
    }
  }
  
  // 6. Return PNG buffer
  return await canvas.getBuffer('image/png');
}

module.exports = {
  renderInventoryImage
};
