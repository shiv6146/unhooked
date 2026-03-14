#!/usr/bin/env python3
"""
Generate simple placeholder icons for ScrollSage extension.
Requires: pip install pillow
"""

import os

from PIL import Image, ImageDraw, ImageFont


def create_icon(size, output_path):
    """Create a simple icon with gradient background and scroll symbol."""
    # Create image with transparent background
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Draw gradient background (blue to purple)
    for y in range(size):
        # Calculate color for this row
        ratio = y / size
        r = int(59 + (139 - 59) * ratio)  # 59 -> 139
        g = int(130 + (92 - 130) * ratio)  # 130 -> 92
        b = int(246 + (246 - 246) * ratio)  # 246 -> 246

        draw.rectangle([(0, y), (size, y + 1)], fill=(r, g, b, 255))

    # Make it rounded
    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    corner_radius = size // 4
    mask_draw.rounded_rectangle([(0, 0), (size, size)], radius=corner_radius, fill=255)

    # Apply rounded corners
    output = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    output.paste(img, (0, 0), mask)

    # Draw scroll emoji or symbol
    try:
        # Try to load a font
        if size >= 48:
            font_size = size // 2
        else:
            font_size = size // 2

        # Try different font locations
        font_paths = [
            "/System/Library/Fonts/Apple Color Emoji.ttc",  # macOS
            "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",  # Linux
            "C:\\Windows\\Fonts\\seguiemj.ttf",  # Windows
        ]

        font = None
        for font_path in font_paths:
            if os.path.exists(font_path):
                try:
                    font = ImageFont.truetype(font_path, font_size)
                    break
                except Exception as e:
                    print(f"Failed to load font from {font_path}: {e}")

        if font is None:
            # Fallback to default font
            font = ImageFont.load_default()

        # Draw scroll emoji
        text = "📜"

        # Get text bounding box
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]

        # Center the text
        x = (size - text_width) // 2
        y = (size - text_height) // 2 - bbox[1]

        draw = ImageDraw.Draw(output)
        draw.text((x, y), text, font=font, embedded_color=True)

    except Exception as e:
        print(f"Warning: Could not add emoji to icon: {e}")
        # Draw a simple "S" instead
        draw = ImageDraw.Draw(output)
        font_size = size // 2
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
        except Exception as e:
            font = ImageFont.load_default()

        text = "S"
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        x = (size - text_width) // 2
        y = (size - text_height) // 2 - bbox[1]

        draw.text((x, y), text, fill=(255, 255, 255, 255), font=font)

    # Save
    output.save(output_path, "PNG")
    print(f"Created: {output_path} ({size}x{size})")


def main():
    """Generate all icon sizes."""
    script_dir = os.path.dirname(os.path.abspath(__file__))

    sizes = [16, 32, 48, 128]

    for size in sizes:
        output_path = os.path.join(script_dir, f"icon{size}.png")
        create_icon(size, output_path)

    print("\n✅ All icons generated successfully!")
    print("\nIcon files created:")
    for size in sizes:
        print(f"  - icon{size}.png")


if __name__ == "__main__":
    try:
        main()
    except ImportError:
        print("Error: Pillow is not installed.")
        print("Please install it with: pip install pillow")
        exit(1)
    except Exception as e:
        print(f"Error generating icons: {e}")
        exit(1)
