# Talents 2.0 class design lab

This standalone page is a review companion for the Hunter, Shaman, and Priest design work planned
after PR #2163. It makes the nine specialization identities, baseline rotations, action ownership,
and six talent rows easier to compare on desktop and mobile.

The prototype is not game code and does not define mechanics or tuning. The class design documents,
specialization PRDs, and implementation plan remain authoritative.

## Open the prototype

Open `index.html` directly in a browser. No build, package installation, server, or game data is
required.

From the repository worktree root on macOS:

```sh
open prototypes/talents-v028/index.html
```

The prototype currently exists only in the local `feature/v028-owned-class-spells` worktree. It has
not been committed, pushed, deployed, or assigned a public URL. After the branch is pushed, reviewers
can check out the branch and open the file locally. A one-click Discord link requires a separate static
deployment or PR preview.

The page deliberately has no runtime dependency on the game. That keeps design review separate from
the gameplay implementation and lets approved mechanics land as small, spec-owned PR slices.

## Review questions

- Does every specialization have a clear fantasy and repeatable baseline loop?
- Are shared class actions and specialization-exclusive actions assigned correctly?
- Do the talent rows provide meaningful utility without adding too many mobile buttons?
- Can each choice be understood without relying on animation, color, or precise cursor placement?
- Which mechanics need PBE tuning rather than redesign before implementation?

## Authoritative documents

- `docs/design/hunter-v028-class-design.md`
- `docs/design/shaman-v028-class-design.md`
- `docs/design/priest-v028-class-design.md`
- `docs/prd/owned-class-spells-v028-implementation.md`
- `docs/prd/owned-class-spells-v028-review-guide.md`
