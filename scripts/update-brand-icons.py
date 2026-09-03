"""
Script to generate 100% complete, uncropped brand logo and extension icon assets for GhostFill.
Ensures the entire character (hood, face, winking expression, hands, yellow email envelope,
blue lock, and ghostly tails) is fully preserved with zero cropping.
"""

import os
from PIL import Image

def process_and_generate_icons(source_path, workspace_root):
    print(f"Loading source image: {source_path}")
    img = Image.open(source_path).convert("RGBA")
    
    # 1. 100% Complete Full Character (Zero Cropping)
    bbox = img.getbbox()
    full_character = img.crop(bbox)
    w, h = full_character.size
    print(f"Full character bounds: {w}x{h}")
    
    # Scale to fill 1024x1024 square canvas edge-to-edge
    scale = 1024 / max(w, h)
    nw, nh = int(w * scale), int(h * scale)
    res_full = full_character.resize((nw, nw), Image.Resampling.LANCZOS) if nw == nh else full_character.resize((nw, nh), Image.Resampling.LANCZOS)
    
    master = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    master.paste(res_full, ((1024 - nw) // 2, (1024 - nh) // 2), res_full)
    print(f"Master Canvas: 1024x1024, full character: {nw}x{nh}")
    
    # Also create 768x768 master for logo.png (webpack-friendly size)
    master_768 = master.resize((768, 768), Image.Resampling.LANCZOS)
    
    # Target files to write
    targets = {
        # Full high-res logo used in UI (popup, options, readme)
        os.path.join(workspace_root, "src", "assets", "logo.png"): (768, 768),
        os.path.join(workspace_root, "src", "assets", "logo_full.png"): (1024, 1024),
        os.path.join(workspace_root, "src", "frontend", "popup", "assets", "ghost-logo.png"): (768, 768),
        os.path.join(workspace_root, "src", "assets", "icons", "icon.png"): (512, 512),
        
        # Chrome Extension icons in public/
        os.path.join(workspace_root, "public", "assets", "icons", "icon128.png"): (128, 128),
        os.path.join(workspace_root, "public", "assets", "icons", "icon48.png"): (48, 48),
        os.path.join(workspace_root, "public", "assets", "icons", "icon32.png"): (32, 32),
        os.path.join(workspace_root, "public", "assets", "icons", "icon16.png"): (16, 16),
        
        # Chrome Extension icons in src/
        os.path.join(workspace_root, "src", "assets", "icons", "icon128.png"): (128, 128),
        os.path.join(workspace_root, "src", "assets", "icons", "icon48.png"): (48, 48),
        os.path.join(workspace_root, "src", "assets", "icons", "icon32.png"): (32, 32),
        os.path.join(workspace_root, "src", "assets", "icons", "icon16.png"): (16, 16),
    }
    
    for path, (size_w, size_h) in targets.items():
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if (size_w, size_h) == (1024, 1024):
            icon_img = master
        elif (size_w, size_h) == (768, 768):
            icon_img = master_768
        else:
            icon_img = master.resize((size_w, size_h), Image.Resampling.LANCZOS)
        
        icon_img.save(path, "PNG", optimize=True)
        print(f" Saved (100% full character): {os.path.relpath(path, workspace_root)} ({size_w}x{size_h})")

if __name__ == "__main__":
    workspace = r"c:\Users\Aayush\Documents\ghostfill-extension-main"
    source = r"c:\Users\Aayush\.gemini\antigravity-ide\brain\cc95bd0b-3857-455c-982a-5dbaff7486de\scratch\cutout_test.png"
    process_and_generate_icons(source, workspace)
