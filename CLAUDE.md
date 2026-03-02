## Obsidian Vault
Location: /Users/zliu/MyDocuments/obsidian-project
When I ask about my notes, use bash to search and read files from this directory.
Example: find /Users/zliu/MyDocuments/obsidian-project -name "*.md" | head -20

## Publish
When the user says "publish", "发布", or "publish to npm", run:
```bash
./scripts/publish.sh        # default: patch
./scripts/publish.sh minor  # minor bump
./scripts/publish.sh major  # major bump
```
Use `patch` unless the user specifies otherwise. The script handles build, test, version bump, and npm publish.
