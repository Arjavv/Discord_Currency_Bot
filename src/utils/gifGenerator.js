const { GifFrame, GifUtil, GifCodec } = require('gifwrap');
const { Jimp } = require('jimp');
const fs = require('fs');
const path = require('path');

// Target paths to user's uploaded coin renders in the brain folder
const HEADS_IMAGE = 'C:/Users/arjav/.gemini/antigravity-ide/brain/4d36b51c-5faf-40cf-8e1d-349db849f13f/media__1783328220956.png'; // Gold
const TAILS_IMAGE = 'C:/Users/arjav/.gemini/antigravity-ide/brain/4d36b51c-5faf-40cf-8e1d-349db849f13f/media__1783328220950.png'; // Silver

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const HEADS_GIF_OUT = path.join(ASSETS_DIR, 'heads.gif');
const TAILS_GIF_OUT = path.join(ASSETS_DIR, 'tails.gif');

/**
 * Applies a circular crop and makes background transparent.
 */
function makeCircular(jimpImage) {
  const width = jimpImage.bitmap.width;
  const height = jimpImage.bitmap.height;
  const center = { x: width / 2, y: height / 2 };
  const radius = Math.min(width, height) / 2 - 4; // slight offset to get rid of black edges

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const distance = Math.sqrt((x - center.x) ** 2 + (y - center.y) ** 2);
      if (distance > radius) {
        jimpImage.setPixelColor(0x00000000, x, y); // Set transparent
      }
    }
  }
  return jimpImage;
}

/**
 * Creates a frame of the coin at a specific vertical scale, rotation angle, and parabolic height.
 * Also renders a dynamic 3D drop-shadow.
 */
function createCoinFrame(baseCoin, scaleY, rotationAngle, yOffset, canvasWidth, canvasHeight, baseSize) {
  // Create blank transparent canvas frame
  const frame = new Jimp({ width: canvasWidth, height: canvasHeight, color: 0x00000000 });

  // 2. Rotate the coin face to simulate axis rotation
  let rotatedCoin = baseCoin.clone().rotate(rotationAngle);

  // 3. Resize coin vertically to simulate 3D rotation flip
  const scaledHeight = Math.max(1, Math.round(baseSize * Math.abs(scaleY)));
  rotatedCoin.resize({ w: baseSize, h: scaledHeight });

  // 4. Determine drawing coordinates (centered at X, offset vertically by Y)
  const x = Math.round((canvasWidth - baseSize) / 2);
  const y = Math.round((canvasHeight - baseSize) / 2 + yOffset - (scaledHeight - baseSize) / 2 - 10);

  // Composite the coin onto the frame
  frame.composite(rotatedCoin, x, y);

  return frame;
}

async function generateGif() {
  console.log('Generating high-end 3D tumbling coin spin GIFs (no caption)...');

  if (!fs.existsSync(HEADS_IMAGE) || !fs.existsSync(TAILS_IMAGE)) {
    console.error(`ERROR: Uploaded coin images not found!`);
    process.exit(1);
  }

  // Ensure assets directory exists
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  const coinSize = 160; // High-resolution larger coin size for crisp details
  
  // Load Gold coin
  console.log('Loading Gold heads face...');
  let headsBase = await Jimp.read(HEADS_IMAGE);
  headsBase = makeCircular(headsBase);
  headsBase.resize({ w: coinSize, h: coinSize });

  // Load Silver coin
  console.log('Loading Silver tails face...');
  let tailsBase = await Jimp.read(TAILS_IMAGE);
  tailsBase = makeCircular(tailsBase);
  tailsBase.resize({ w: coinSize, h: coinSize });

  // Toss Physics parameters
  const canvasWidth = 240;
  const canvasHeight = 240;
  const totalFrames = 28; // Higher frame count for smoother motion
  const frameDelayCentiseconds = 5; // 50ms delay for fluid 60fps feel
  const maxHeight = 50; // Parabolic peak height
  const totalFlips = 5; // Complete 360 vertical flips
  const totalSpins = 3.5; // Axis rotations

  const headsFrames = [];
  const tailsFrames = [];

  console.log('Generating frames with Axis Rotation + Parabolic Shadow...');

  for (let i = 0; i < totalFrames; i++) {
    const t = i / (totalFrames - 1);
    
    // Parabolic path: yOffset starts at 0, goes up (negative Y) to -maxHeight, and lands back at 0
    const yOffset = -maxHeight * 4 * t * (1 - t);

    // Dynamic rotation angle (spinning axis)
    const rotationAngle = t * totalSpins * 360;

    // Flip angles
    const flipAngleHeads = t * totalFlips * Math.PI;
    const flipAngleTails = t * totalFlips * Math.PI + Math.PI; // offset by 180 degrees so it lands on back

    // Cosine determines the front/back scale representation
    const scaleYHeads = Math.cos(flipAngleHeads);
    const scaleYTails = Math.cos(flipAngleTails);

    // Determine coin face based on current rotation angle sign (positive is Heads/gold, negative is Tails/silver)
    // Heads GIF:
    const activeHeadsCoin = scaleYHeads >= 0 ? headsBase : tailsBase;
    const headsJimpFrame = createCoinFrame(activeHeadsCoin, scaleYHeads, rotationAngle, yOffset, canvasWidth, canvasHeight, coinSize);
    const headsFrameObj = new GifFrame(headsJimpFrame.bitmap, { delayCentiseconds: frameDelayCentiseconds });
    GifUtil.quantizeDekker(headsFrameObj, 256);
    headsFrames.push(headsFrameObj);

    // Tails GIF:
    const activeTailsCoin = scaleYTails >= 0 ? headsBase : tailsBase;
    const tailsJimpFrame = createCoinFrame(activeTailsCoin, scaleYTails, rotationAngle, yOffset, canvasWidth, canvasHeight, coinSize);
    const tailsFrameObj = new GifFrame(tailsJimpFrame.bitmap, { delayCentiseconds: frameDelayCentiseconds });
    GifUtil.quantizeDekker(tailsFrameObj, 256);
    tailsFrames.push(tailsFrameObj);
  }

  // Save animations
  console.log('Writing high-definition animated GIFs...');
  
  await GifUtil.write(HEADS_GIF_OUT, headsFrames);
  console.log(`✔ Generated: ${HEADS_GIF_OUT}`);

  await GifUtil.write(TAILS_GIF_OUT, tailsFrames);
  console.log(`✔ Generated: ${TAILS_GIF_OUT}`);

  console.log('GIF generation completed successfully!');
}

generateGif().catch(console.error);
