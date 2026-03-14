# Icon Generation Guide for Unhooked

This guide helps you create the required icon files for the Unhooked Chrome extension.

## Required Icon Sizes

- `icon16.png` - 16x16 pixels (toolbar small)
- `icon32.png` - 32x32 pixels (toolbar standard)
- `icon48.png` - 48x48 pixels (extension management)
- `icon128.png` - 128x128 pixels (Chrome Web Store)

## Design Guidelines

### Visual Theme
- **Concept**: Scroll/document with sage/wisdom theme
- **Colors**: 
  - Primary: Blue gradient (#3b82f6 to #8b5cf6)
  - Background: Dark slate (#0f172a to #1e293b)
- **Style**: Modern, clean, minimalist
- **Icon Type**: Rounded corners, flat/gradient design

### Suggested Symbols
- 📜 Scroll/parchment
- 📖 Open book
- 🔄 Circular arrow (scrolling motion)
- 🤖 Robot/agent face
- 📊 Feed/stream lines

---

## Method 1: Quick PNG from Emoji (Fastest)

### Using ImageMagick (macOS/Linux)

```bash
# Install ImageMagick (if not installed)
# macOS: brew install imagemagick
# Ubuntu: sudo apt-get install imagemagick

# Generate icons from emoji
convert -background transparent -fill "#3b82f6" -font "Apple Color Emoji" \
        -pointsize 120 label:"📜" -resize 128x128 icon128.png

convert icon128.png -resize 48x48 icon48.png
convert icon128.png -resize 32x32 icon32.png
convert icon128.png -resize 16x16 icon16.png
```

### Using Node.js + Canvas

```bash
# Install dependencies
npm install canvas

# Create generate-icons.js:
node << 'EOF'
const { createCanvas } = require('canvas');
const fs = require('fs');

const sizes = [16, 32, 48, 128];
const emoji = '📜';

sizes.forEach(size => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Background (optional transparent)
  ctx.fillStyle = 'transparent';
  ctx.fillRect(0, 0, size, size);
  
  // Draw emoji
  ctx.font = `${size * 0.8}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2);
  
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(`icon${size}.png`, buffer);
  console.log(`Generated icon${size}.png`);
});
EOF
```

---

## Method 2: Online Icon Generators

### Recommended Tools

1. **Favicon.io** - https://favicon.io/
   - Go to "Text to Icon"
   - Type "SS" or "📜"
   - Choose blue gradient
   - Download and extract
   - Rename files to match required sizes

2. **Icon Kitchen** - https://icon.kitchen/
   - Upload base image or choose emoji
   - Generates all required sizes
   - Download as ZIP

3. **Real Favicon Generator** - https://realfavicongenerator.net/
   - Upload 128x128 base image
   - Customize per platform
   - Downloads package with all sizes

4. **Canva** - https://canva.com
   - Create 128x128 design
   - Export as PNG
   - Use online resizer for other sizes

---

## Method 3: Design Tools (Best Quality)

### Figma (Free, Web-based)

1. Go to https://figma.com
2. Create new file
3. Create 128x128 frame
4. Design your icon:
   ```
   - Add circle: 128x128, gradient fill
   - Add scroll emoji or vector shape
   - Add text "SS" if desired
   ```
5. Export as PNG at 1x, 2x, 3x
6. Rename and resize as needed

### Adobe Illustrator / Inkscape

1. Create 128x128 artboard
2. Design vector icon
3. Export as PNG:
   - 128x128 @ 1x
   - 48x48 @ 1x
   - 32x32 @ 1x
   - 16x16 @ 1x

### GIMP (Free, Cross-platform)

1. Create new image: 128x128
2. Add layers for icon design
3. Export as PNG
4. Use Image → Scale Image for smaller sizes

---

## Method 4: SVG to PNG Conversion

If you have an SVG icon:

```bash
# Using Inkscape CLI
inkscape icon.svg --export-filename=icon128.png --export-width=128 --export-height=128
inkscape icon.svg --export-filename=icon48.png --export-width=48 --export-height=48
inkscape icon.svg --export-filename=icon32.png --export-width=32 --export-height=32
inkscape icon.svg --export-filename=icon16.png --export-width=16 --export-height=16

# Using rsvg-convert
rsvg-convert -w 128 -h 128 icon.svg > icon128.png
rsvg-convert -w 48 -h 48 icon.svg > icon48.png
rsvg-convert -w 32 -h 32 icon.svg > icon32.png
rsvg-convert -w 16 -h 16 icon.svg > icon16.png
```

---

## Method 5: Simple Solid Color Icons

### Using Python + Pillow

```python
from PIL import Image, ImageDraw, ImageFont

sizes = [16, 32, 48, 128]
bg_color = (59, 130, 246)  # Blue
text_color = (255, 255, 255)  # White

for size in sizes:
    # Create image
    img = Image.new('RGB', (size, size), bg_color)
    draw = ImageDraw.Draw(img)
    
    # Draw circle
    margin = int(size * 0.1)
    draw.ellipse([margin, margin, size-margin, size-margin], 
                 fill=(139, 92, 246))  # Purple
    
    # Add text "SS"
    font_size = int(size * 0.4)
    try:
        font = ImageFont.truetype("Arial.ttf", font_size)
    except:
        font = ImageFont.load_default()
    
    text = "📜"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    x = (size - text_width) // 2
    y = (size - text_height) // 2
    
    draw.text((x, y), text, fill=text_color, font=font)
    
    # Save
    img.save(f'icon{size}.png')
    print(f'Generated icon{size}.png')
```

---

## Method 6: Download Icon Pack

### Free Icon Resources

1. **Flaticon** - https://www.flaticon.com/
   - Search "scroll icon" or "document icon"
   - Download PNG in multiple sizes
   - Free with attribution

2. **Icons8** - https://icons8.com/
   - Search "scroll" or "feed"
   - Download in required sizes
   - Free for personal use

3. **Noun Project** - https://thenounproject.com/
   - Search "scroll" or "agent"
   - Download and resize

4. **Material Icons** - https://fonts.google.com/icons
   - Search "feed" or "article"
   - Download SVG and convert to PNG

---

## Quick Template (Copy-Paste)

### Simple Gradient Icon with Emoji

Create `generate-simple-icons.sh`:

```bash
#!/bin/bash

# Requires ImageMagick
# Install: brew install imagemagick (macOS) or apt-get install imagemagick (Linux)

# Base colors
BG_START="#3b82f6"
BG_END="#8b5cf6"

# Create base 128x128 icon
convert -size 128x128 gradient:$BG_START-$BG_END \
        -gravity center -font "Arial" -pointsize 80 -fill white \
        -annotate +0+0 "📜" \
        icon128.png

# Resize for other sizes
convert icon128.png -resize 48x48 icon48.png
convert icon128.png -resize 32x32 icon32.png
convert icon128.png -resize 16x16 icon16.png

echo "✅ Icons generated successfully!"
ls -lh icon*.png
```

Make executable and run:
```bash
chmod +x generate-simple-icons.sh
./generate-simple-icons.sh
```

---

## Validation Checklist

After generating icons, verify:

- [ ] All 4 sizes exist (16, 32, 48, 128)
- [ ] Files are PNG format
- [ ] Files are not corrupt (open in image viewer)
- [ ] Transparent background (optional but recommended)
- [ ] Icon visible at all sizes
- [ ] Colors match extension theme
- [ ] No jagged edges (anti-aliased)
- [ ] File sizes reasonable (< 50KB each)

---

## Testing Icons

1. Replace placeholder files in `icons/` directory
2. Reload extension in Chrome
3. Check icon in:
   - Toolbar (16x16 or 32x32 depending on screen density)
   - Extensions page (48x48)
   - Chrome Web Store preview (128x128)

---

## Recommended: Professional Icon

For production, consider hiring a designer or using:
- **Fiverr**: $5-20 for custom icon set
- **99designs**: Icon design contest
- **Upwork**: Freelance icon designer

Provide:
- Extension name: Unhooked
- Theme: Automated scrolling, feeds, digestion
- Colors: Blue/purple gradient
- Style: Modern, minimal, flat

---

## Need Help?

If icons still not working:
1. Verify PNG format: `file icon16.png` (should say "PNG image data")
2. Check dimensions: `identify icon16.png` (should show correct size)
3. Test transparency: `identify -verbose icon16.png | grep Alpha`
4. Convert to proper format: `convert icon.png -type TrueColorAlpha icon-fixed.png`

---

**Once icons are generated, remove the `.placeholder` files and replace them with actual PNG files!**