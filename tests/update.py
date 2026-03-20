import re

with open("new.md", "r", encoding="utf-8") as f:
    lines = f.readlines()

code = ""
in_code = False
for line in lines:
    if line.strip().startswith("```"):
        in_code = not in_code
        continue
    if in_code:
        code += line

code = code.replace("<p>GhostFill v{version} • Local AI • No API keys needed</p>", "<p>GhostFill v{version}</p>")

if code.strip() != "":
    with open("src/options/OptionsApp.tsx", "w", encoding="utf-8") as f:
        f.write(code)
    print("Done writing to OptionsApp.tsx")
else:
    print("No code found")
