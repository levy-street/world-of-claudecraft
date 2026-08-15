# Security Policy

We take the security of World of ClaudeCraft seriously, and we appreciate the work
of everyone who helps keep players and self-hosters safe.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
pull requests, or Discord.** Public disclosure before a fix is available puts
players and people running their own servers at risk.

Instead, report privately using one of these channels:

- **Email (preferred).** Write to tony@levystreet.com with "Security" in the
  subject. This reaches the maintainers directly.
- **Discord.** Send a private message to a member of the **Levy St**, **Admin**,
  or **Devs** group on the
  [community Discord](https://discord.com/invite/worldofclaudecraft) and ask for a secure way to
  share the details.

Please include as much as you can:

- What the issue is and the kind of impact you think it has.
- Steps to reproduce, or a proof of concept.
- Affected area and any relevant versions or commits.

### Areas we care most about

- Authentication, session and API tokens, and third-party sign-in.
- Server authority and anti-cheat: anything that lets a client decide an outcome
  the server is supposed to own, or reach state it should not see.
- Privilege boundaries: the admin dashboard, moderation tooling, and dev commands.
- Account data, payment and wallet flows, and anything that exposes another
  player's private information.
- Self-hosting defaults that would leave someone else's server exposed.

## What to expect

- We'll acknowledge your report as quickly as we can, normally within a few days.
- We'll keep you updated as we investigate and work on a fix.
- Once a fix is released, we're glad to credit you for the discovery, unless you'd
  prefer to stay anonymous.

We ask that you give us a reasonable amount of time to release a fix before any
public disclosure, and that you avoid accessing or modifying other people's data,
degrading the service, or running tests against the live multiplayer servers
without permission.

## Supported versions

World of ClaudeCraft is under active development and is currently pre-1.0. Fixes
land on the active `release/vX.Y.Z` branch, which merges into `main` when that
version ships, so the supported targets are the most recent release and the
current release branch. Older releases do not receive backports. If you run a
self-hosted server, please keep it up to date.

Thank you for helping keep the community safe.
