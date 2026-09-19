# Plan for historical demo-media removal

The prior `src/assets/demo.gif` was removed from the current tree after inspection found a personalised browser profile in its visible content. No history was rewritten.

If the maintainers decide historical removal is necessary, perform it in a separate fresh clone with a reviewed, narrowly scoped path filter for only `src/assets/demo.gif`. First notify collaborators and preserve a backup reference. A history rewrite changes commit IDs, invalidates existing clones and forks, requires contributors to rebase or re-clone, and may affect tags, pull-request links, release provenance, and mirrors. Review every rewritten ref before force-pushing. Do not run this plan without explicit maintainer approval and coordinated remote access.
