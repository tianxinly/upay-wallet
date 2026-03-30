const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const png2icons = require('png2icons');

const root = path.resolve(__dirname, '..');
const resources = path.join(root, 'resources');
const svgPath = path.join(resources, 'icon.svg');

const sizes = [1024, 512, 256, 128, 64, 48, 32, 24, 16];

async function renderPngs(svgBuffer) {
  for (const size of sizes) {
    const outPath = path.join(resources, `icon-${size}.png`);
    await sharp(svgBuffer, { density: 512 })
      .resize(size, size)
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(outPath);
  }
  fs.copyFileSync(
    path.join(resources, 'icon-512.png'),
    path.join(resources, 'icon.png')
  );
}

function buildIcnsAndIco() {
  const basePng = fs.readFileSync(path.join(resources, 'icon-1024.png'));
  const icnsBuffer = png2icons.createICNS(
    basePng,
    png2icons.RESIZE_BICUBIC,
    0
  );
  if (!icnsBuffer) {
    throw new Error('Failed to generate ICNS (png2icons returned null).');
  }
  fs.writeFileSync(path.join(resources, 'icon.icns'), icnsBuffer);

  const icoBuffer = png2icons.createICO(
    basePng,
    png2icons.RESIZE_BICUBIC,
    0,
    true,
    true
  );
  if (!icoBuffer) {
    throw new Error('Failed to generate ICO (png2icons returned null).');
  }
  fs.writeFileSync(path.join(resources, 'icon.ico'), icoBuffer);
}

async function main() {
  if (!fs.existsSync(svgPath)) {
    throw new Error(`SVG not found: ${svgPath}`);
  }
  const svgBuffer = fs.readFileSync(svgPath);
  await renderPngs(svgBuffer);
  buildIcnsAndIco();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
