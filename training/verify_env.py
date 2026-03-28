import sys
import os

print(f"Python Version: {sys.version}")
print(f"CWD: {os.getcwd()}")

try:
    import torch
    print(f"✅ Torch Version: {torch.__version__}")
    print(f"✅ CUDA Available: {torch.cuda.is_available()}")
except ImportError:
    print("❌ Torch NOT found in this environment.")
    print("Run: pip install -r requirements.txt")

try:
    import sentinel_brain_v2
    print("✅ sentinel_brain_v2 importable")
except ImportError:
    print("❌ sentinel_brain_v2 NOT found in path.")
