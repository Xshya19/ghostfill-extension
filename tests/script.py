
with open('new.md', 'r', encoding='utf-8', errors='ignore') as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1
for i, line in enumerate(lines):
    if line.strip().startswith('\\\'):
        if start_idx == -1:
            start_idx = i
        else:
            end_idx = i
            break

if start_idx != -1 and end_idx != -1:
    code_lines = lines[start_idx+1:end_idx]
    code = ''.join(code_lines)
    code = code.replace('<p>GhostFill v{version} • Local AI • No API keys needed</p>', '<p>GhostFill v{version}</p>')
    with open('src/options/OptionsApp.tsx', 'w', encoding='utf-8') as f:
        f.write(code)
    print('Done')
else:
    print('Could not find fences', start_idx, end_idx)

