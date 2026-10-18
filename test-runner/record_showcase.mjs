import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const BROWSER_EDITION_ROOT = path.join(REPO_ROOT, 'browser-edition');
const DEMOS_DIR = path.join(REPO_ROOT, 'demos/latest');
const GALLERY_DIR = path.join(DEMOS_DIR, 'gallery');

// Dynamically import Playwright
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const fallbackPlaywright = path.resolve(REPO_ROOT, '../sm3/node_modules/playwright/index.mjs');
  ({ chromium } = await import(fallbackPlaywright));
}

// 1. Static HTTP Server for browser-edition
function startServer(port = 8769) {
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
  };

  const server = http.createServer((req, res) => {
    const rawPath = req.url.split('?')[0];
    let filePath = path.join(BROWSER_EDITION_ROOT, rawPath === '/' ? 'index.html' : rawPath);

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      fs.createReadStream(filePath).pipe(res);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`[HTTP] Serving Robot Motion Studio from ${BROWSER_EDITION_ROOT} on http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

// 2. Interactive Cursor Helper
async function injectCursor(page) {
  await page.evaluate(() => {
    if (document.getElementById('demo-cursor')) return;
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    c.style.position = 'fixed';
    c.style.top = '0';
    c.style.left = '0';
    c.style.width = '18px';
    c.style.height = '18px';
    c.style.borderRadius = '50%';
    c.style.backgroundColor = 'rgba(56, 189, 248, 0.75)';
    c.style.border = '2px solid #ffffff';
    c.style.boxShadow = '0 0 12px rgba(56, 189, 248, 0.9)';
    c.style.pointerEvents = 'none';
    c.style.zIndex = '9999999';
    c.style.transform = 'translate(-50%, -50%)';
    c.style.transition = 'width 0.12s ease, height 0.12s ease, background-color 0.12s ease';
    document.body.appendChild(c);
    window.__setCursor = (x, y) => {
      c.style.left = `${x}px`;
      c.style.top = `${y}px`;
    };
  });
}

async function smoothMove(page, targetX, targetY, steps = 18, delayMs = 15) {
  await page.mouse.move(targetX, targetY, { steps });
  await page.evaluate(({ x, y }) => window.__setCursor?.(x, y), { x: targetX, y: targetY });
  if (delayMs > 0) await page.waitForTimeout(delayMs);
}

async function smoothClick(page, selectorOrBox, steps = 16) {
  let targetX, targetY;
  if (typeof selectorOrBox === 'string') {
    const el = page.locator(selectorOrBox).first();
    const box = await el.boundingBox();
    if (!box) {
      console.warn(`[WARN] Element ${selectorOrBox} not visible for click`);
      return;
    }
    targetX = box.x + box.width / 2;
    targetY = box.y + box.height / 2;
  } else if (selectorOrBox && typeof selectorOrBox.boundingBox === 'function') {
    const box = await selectorOrBox.boundingBox();
    if (!box) {
      console.warn(`[WARN] Element handle not visible for click`);
      return;
    }
    targetX = box.x + box.width / 2;
    targetY = box.y + box.height / 2;
  } else {
    targetX = selectorOrBox.x;
    targetY = selectorOrBox.y;
  }

  await smoothMove(page, targetX, targetY, steps);
  await page.evaluate(() => {
    const c = document.getElementById('demo-cursor');
    if (c) {
      c.style.width = '13px';
      c.style.height = '13px';
      c.style.backgroundColor = 'rgba(244, 63, 94, 0.9)';
    }
  });
  await page.waitForTimeout(100);
  await page.mouse.click(targetX, targetY);
  await page.evaluate(() => {
    const c = document.getElementById('demo-cursor');
    if (c) {
      c.style.width = '18px';
      c.style.height = '18px';
      c.style.backgroundColor = 'rgba(56, 189, 248, 0.75)';
    }
  });
  await page.waitForTimeout(200);
}

// 3. WebP Thumbnail Generator
async function generateWebPThumbnail(browser, sourcePngPath, outWebPPath) {
  console.log(`[Thumbnail] Generating WebP from ${sourcePngPath}...`);
  const page = await browser.newPage();
  const pngDataUrl = `data:image/png;base64,${fs.readFileSync(sourcePngPath).toString('base64')}`;

  const webpBase64 = await page.evaluate(async (dataUrl) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 384;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const webpData = canvas.toDataURL('image/webp', 0.88);
        resolve(webpData.split(',')[1]);
      };
      img.src = dataUrl;
    });
  }, pngDataUrl);

  fs.writeFileSync(outWebPPath, Buffer.from(webpBase64, 'base64'));
  await page.close();
  console.log(`[Thumbnail] Saved WebP (${fs.statSync(outWebPPath).size} bytes) to ${outWebPPath}`);
}

async function main() {
  fs.mkdirSync(GALLERY_DIR, { recursive: true });
  const server = await startServer(8769);

  const tempVideoDir = path.join(DEMOS_DIR, 'temp_raw_video');
  fs.mkdirSync(tempVideoDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2, // Hi-DPI crystal clear screenshots
    recordVideo: {
      dir: tempVideoDir,
      size: { width: 1280, height: 720 },
    },
  });

  const page = await context.newPage();
  const startTime = Date.now();

  try {
    console.log('[Recording] Navigating to http://127.0.0.1:8769/ ...');
    await page.goto('http://127.0.0.1:8769/', { waitUntil: 'networkidle' });

    // Wait for the app to initialize the sql.js database and seed the DoorDurabilityRig
    await page.waitForFunction(() => {
      const brand = document.getElementById('brandName');
      return brand && brand.textContent && brand.textContent.trim().length > 0 && !brand.textContent.includes('No robot');
    }, { timeout: 15000 });

    await injectCursor(page);
    await page.evaluate(() => window.__setCursor?.(640, 360));
    await page.waitForTimeout(500);

    // -------------------------------------------------------------------
    // Beat 1: Forward Kinematics Simulator & Door Rig Interaction (0.0s - 7.5s)
    // -------------------------------------------------------------------
    console.log('[1/6] Navigating to Simulator View...');
    await smoothClick(page, 'button[data-view="simulator"]');
    await page.waitForSelector('#simSeqList');
    await page.waitForTimeout(400);

    // Select the first sequence (door_cycle) to mount the canvas
    console.log('  -> Selecting sequence door_cycle in simulator list...');
    await smoothClick(page, '#simSeqList .list-group-item');
    await page.waitForSelector('#simCanvas');
    await page.waitForTimeout(500);

    // Click Play button to animate door_cycle
    console.log('  -> Triggering kinematic simulation playback...');
    await smoothClick(page, 'button[data-act="play"]');

    // Wait for the arm to reach, grip, and pull open the door (reaches door_open at ~2.5s)
    await page.waitForTimeout(2500);

    // Track gripper and open door handle with cursor
    await smoothMove(page, 790, 340, 20);
    await page.waitForTimeout(600);

    const still1 = path.join(GALLERY_DIR, '01-canvas-simulator-door-cycle.png');
    await page.screenshot({ path: still1 });
    console.log(`  -> Saved ${path.basename(still1)}`);

    // Let the return stroke execute
    await page.waitForTimeout(1600);

    // -------------------------------------------------------------------
    // Beat 2: Visual Timeline Trajectory Editor (7.5s - 13.5s)
    // -------------------------------------------------------------------
    console.log('[2/6] Navigating to Timeline Editor...');
    await smoothClick(page, 'button[data-view="timeline"]');
    await page.waitForSelector('#view-timeline');
    await page.waitForTimeout(800);

    // If needed, select sequence in timeline list
    const tlItem = page.locator('#tlSeqList .list-group-item').first();
    if (await tlItem.isVisible()) {
      await smoothClick(page, tlItem);
      await page.waitForTimeout(500);
    }

    // Move cursor across steps and easing curve tags
    await smoothMove(page, 520, 280, 20);
    await page.waitForTimeout(600);
    await smoothMove(page, 740, 280, 18);
    await page.waitForTimeout(600);

    const still2 = path.join(GALLERY_DIR, '02-timeline-trajectory-editor.png');
    await page.screenshot({ path: still2 });
    console.log(`  -> Saved ${path.basename(still2)}`);

    // Click play/scrub on timeline
    const tlPlayBtn = page.locator('#view-timeline button[data-act="play"], #view-timeline .btn-primary').first();
    if (await tlPlayBtn.isVisible()) {
      await smoothClick(page, tlPlayBtn);
      await page.waitForTimeout(1400);
    }

    // -------------------------------------------------------------------
    // Beat 3: Pose Management & Joint Angle Scrubbers (13.5s - 18.5s)
    // -------------------------------------------------------------------
    console.log('[3/6] Navigating to Poses View & Opening Pose Editor...');
    await smoothClick(page, 'button[data-view="poses"]');
    await page.waitForSelector('#poseList');
    await page.waitForTimeout(600);

    // Click edit on grip_handle pose
    const editGripBtn = page.locator('#poseList button[data-act="edit"]').nth(2);
    if (await editGripBtn.isVisible()) {
      await smoothClick(page, editGripBtn);
    } else {
      await smoothClick(page, '#poseList button[data-act="edit"]').first();
    }
    await page.waitForSelector('.modal.show');
    await page.waitForTimeout(700);

    // Move cursor across joint target inputs
    await smoothMove(page, 720, 360, 16);
    await page.waitForTimeout(500);
    await smoothMove(page, 720, 420, 16);
    await page.waitForTimeout(600);

    const still3 = path.join(GALLERY_DIR, '03-joint-pose-scrubbers.png');
    await page.screenshot({ path: still3 });
    console.log(`  -> Saved ${path.basename(still3)}`);

    // Close modal
    await smoothClick(page, '.modal.show .btn-close, .modal.show .btn-secondary');
    await page.waitForTimeout(600);

    // -------------------------------------------------------------------
    // Beat 4: Multi-Robot Switcher & 6-DOF PickPlaceArm (18.5s - 23.5s)
    // -------------------------------------------------------------------
    console.log('[4/6] Switching Robot to 6-DOF PickPlaceArm...');
    await smoothClick(page, '#robotSwitcherBtn');
    await page.waitForSelector('#robotSwitcherMenu.show');
    await page.waitForTimeout(400);

    // Click PickPlaceArm in dropdown
    const pickPlaceItem = page.locator('#robotSwitcherMenu button[data-act="switch"]:has-text("PickPlaceArm")');
    await smoothClick(page, pickPlaceItem);
    await page.waitForTimeout(800);

    // Switch to Configuration view
    await smoothClick(page, 'button[data-view="configuration"]');
    await page.waitForSelector('#view-configuration');
    await page.waitForTimeout(600);

    // Move cursor over 6-DOF servos table
    await smoothMove(page, 560, 310, 18);
    await page.waitForTimeout(600);

    const still4 = path.join(GALLERY_DIR, '04-pick-place-6dof-kinematics.png');
    await page.screenshot({ path: still4 });
    console.log(`  -> Saved ${path.basename(still4)}`);
    await page.waitForTimeout(800);

    // -------------------------------------------------------------------
    // Beat 5: Resolved Motion Document Preview (23.5s - 27.5s)
    // -------------------------------------------------------------------
    console.log('[5/6] Inspecting Motion Preview & Resolved Keyframes...');
    await smoothClick(page, 'button[data-view="preview"]');
    await page.waitForSelector('#pvSeqList');
    await page.waitForTimeout(400);

    // Select the first sequence if not selected
    const pvItem = page.locator('#pvSeqList .list-group-item').first();
    if (await pvItem.isVisible()) {
      await smoothClick(page, pvItem);
      await page.waitForTimeout(600);
    }

    await page.waitForSelector('#pvPane');
    // Move cursor down through keyframe targets
    await smoothMove(page, 640, 380, 18);
    await page.waitForTimeout(600);

    const still5 = path.join(GALLERY_DIR, '05-motion-document-preview.png');
    await page.screenshot({ path: still5 });
    console.log(`  -> Saved ${path.basename(still5)}`);
    await page.waitForTimeout(800);

    // -------------------------------------------------------------------
    // Beat 6: Schema v2 JSON & Arduino Export (27.5s - 30.5s)
    // -------------------------------------------------------------------
    console.log('[6/6] Opening Export View with Schema v2 Payload...');
    await smoothClick(page, 'button[data-view="export"]');
    await page.waitForSelector('#exportCodeBlock');
    await page.waitForTimeout(700);

    // Hover code preview and download button
    await smoothMove(page, 850, 320, 18);
    await page.waitForTimeout(500);

    const still6 = path.join(GALLERY_DIR, '06-schema2-arduino-export.png');
    await page.screenshot({ path: still6 });
    console.log(`  -> Saved ${path.basename(still6)}`);

    // -------------------------------------------------------------------
    // Final Steady Hold to Reach ~30.5s Recording Target
    // -------------------------------------------------------------------
    const elapsedMs = Date.now() - startTime;
    const remainingMs = 30500 - elapsedMs;
    if (remainingMs > 0) {
      console.log(`[Hold] Holding final state for ${(remainingMs / 1000).toFixed(1)}s to complete 30.5s recording...`);
      await page.waitForTimeout(remainingMs);
    }
  } catch (err) {
    console.error('[PLAYWRIGHT ERROR IN TRY]', err);
    throw err;
  } finally {
    const videoObj = page.video();
    await context.close();
    await browser.close();
    server.close();

    // Video path resolution
    const rawVideoPath = await videoObj.path();
    console.log(`[Video] Raw recording saved at: ${rawVideoPath}`);

    const finalWebM = path.join(DEMOS_DIR, 'demo.webm');
    const ffmpegMac = path.resolve(process.env.HOME, 'Library/Caches/ms-playwright/ffmpeg-1013/ffmpeg-mac');

    if (fs.existsSync(ffmpegMac)) {
      console.log(`[FFmpeg] Transcoding video with VP9 to exact 30.5s duration...`);
      await new Promise((resolve, reject) => {
        const proc = spawn(ffmpegMac, [
          '-y',
          '-i', rawVideoPath,
          '-t', '30.5',
          '-c:v', 'libvpx-vp9',
          '-b:v', '850k',
          '-crf', '30',
          '-an',
          finalWebM,
        ], { stdio: 'inherit' });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg exited with code ${code}`));
        });
      });
    } else {
      console.log(`[Video] Moving raw WebM to ${finalWebM}...`);
      fs.copyFileSync(rawVideoPath, finalWebM);
    }

    // Clean up temp dir
    try {
      fs.rmSync(tempVideoDir, { recursive: true, force: true });
    } catch (_) {}

    // Generate thumbnail webp from primary card poster: 01-canvas-simulator-door-cycle.png
    const sourceStill = path.join(GALLERY_DIR, '01-canvas-simulator-door-cycle.png');
    if (fs.existsSync(sourceStill)) {
      const helperBrowser = await chromium.launch({ headless: true });
      try {
        const cardThumbWebP = path.join(DEMOS_DIR, 'thumb.webp');
        await generateWebPThumbnail(helperBrowser, sourceStill, cardThumbWebP);

        // Copy thumbnail into netfix / beta-livive-net / livive-net thumbnails directories
        const rootThumb = path.resolve(REPO_ROOT, '../thumbnails/robot-motion-studio.webp');
        const betaThumb = path.resolve(REPO_ROOT, '../beta-livive-net/thumbnails/robot-motion-studio.webp');
        const liviveThumb = path.resolve(REPO_ROOT, '../livive-net/thumbnails/robot-motion-studio.webp');

        for (const tPath of [rootThumb, betaThumb, liviveThumb]) {
          if (fs.existsSync(path.dirname(tPath))) {
            fs.copyFileSync(cardThumbWebP, tPath);
            console.log(`[Thumbnail] Copied to ${tPath}`);
          }
        }
      } finally {
        await helperBrowser.close();
      }
    }

    console.log('[SUCCESS] All Robot Motion Studio showcase assets captured!');
    console.log(`  - Video: ${finalWebM} (${fs.statSync(finalWebM).size} bytes)`);
    for (const f of fs.readdirSync(GALLERY_DIR).sort()) {
      const p = path.join(GALLERY_DIR, f);
      console.log(`  - Gallery: ${f} (${fs.statSync(p).size} bytes)`);
    }
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
