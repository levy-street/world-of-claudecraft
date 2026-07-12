import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

interface HookHandler {
  type: string;
  command: string;
  timeout: number;
}

interface HookConfig {
  hooks: Record<string, Array<{ hooks: HookHandler[] }>>;
}

describe('Codex project configuration', () => {
  it('keeps shared config model-neutral and bounded', () => {
    const config = read('.codex/config.toml');
    expect(config).toContain('#:schema https://developers.openai.com/codex/config-schema.json');
    expect(config).toContain('project_doc_fallback_filenames = ["CLAUDE.md"]');
    expect(config).toContain('project_doc_max_bytes = 65536');
    expect(config).toContain('max_threads = 6');
    expect(config).toContain('max_depth = 1');
    expect(config).not.toMatch(/^\s*model\s*=/m);
    expect(config).not.toMatch(/^\s*model_reasoning_effort\s*=/m);
    expect(config).not.toMatch(/^\s*(sandbox_mode|approval_policy|network_access)\s*=/m);
  });

  it('uses only short shared lifecycle hooks backed by tracked scripts', () => {
    const parsed = JSON.parse(read('.codex/hooks.json')) as HookConfig;
    expect(Object.keys(parsed.hooks).sort()).toEqual(['SessionStart', 'Stop']);
    const handlers = Object.values(parsed.hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks),
    );
    expect(handlers).toHaveLength(2);
    for (const handler of handlers) {
      expect(handler.type).toBe('command');
      expect(handler.timeout).toBeLessThanOrEqual(30);
      expect(handler.command).not.toMatch(/danger|sudo|curl|wget/i);
      const script = handler.command.match(/\.(claude|codex)\/hooks\/([\w.-]+\.sh)/);
      if (!script)
        throw new Error(`Hook command does not reference a tracked script: ${handler.command}`);
      expect(fs.existsSync(path.join(root, `.${script[1]}/hooks`, script[2]))).toBe(true);
    }
  });

  it('extends the stop gate to tracked and untracked Codex file types', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'woc-codex-hook-'));
    try {
      fs.mkdirSync(path.join(fixture, '.claude/hooks'), { recursive: true });
      fs.mkdirSync(path.join(fixture, '.codex/hooks'), { recursive: true });
      fs.mkdirSync(path.join(fixture, '.codex/agents'), { recursive: true });
      fs.mkdirSync(path.join(fixture, 'src'), { recursive: true });
      fs.copyFileSync(
        path.join(root, '.claude/hooks/qa-stop.sh'),
        path.join(fixture, '.claude/hooks/qa-stop.sh'),
      );
      fs.copyFileSync(
        path.join(root, '.codex/hooks/qa-stop.sh'),
        path.join(fixture, '.codex/hooks/qa-stop.sh'),
      );
      spawnSync('git', ['init', '--quiet', fixture], { encoding: 'utf8' });
      const agent = path.join(fixture, '.codex/agents/new.toml');
      fs.writeFileSync(agent, 'name = "clean"\n');

      const run = (active: boolean) =>
        spawnSync('bash', [path.join(fixture, '.codex/hooks/qa-stop.sh')], {
          cwd: fixture,
          input: JSON.stringify({ stop_hook_active: active }),
          encoding: 'utf8',
        });
      expect(run(false).stdout).toBe('');

      fs.writeFileSync(agent, `name = "bad ${String.fromCodePoint(0x2014)} copy"\n`);
      const blocked = run(false);
      expect(blocked.status).toBe(0);
      expect(JSON.parse(blocked.stdout)).toMatchObject({ decision: 'block' });

      fs.writeFileSync(agent, 'name = "clean"\n');
      fs.writeFileSync(path.join(fixture, 'src/helper.mts'), 'export const clean = true;\n');
      expect(spawnSync('git', ['add', '.'], { cwd: fixture, encoding: 'utf8' }).status).toBe(0);
      expect(
        spawnSync(
          'git',
          [
            '-c',
            'user.name=Codex Fixture',
            '-c',
            'user.email=codex-fixture@example.invalid',
            'commit',
            '--quiet',
            '-m',
            'fixture',
          ],
          { cwd: fixture, encoding: 'utf8' },
        ).status,
      ).toBe(0);
      fs.appendFileSync(path.join(fixture, 'src/helper.mts'), 'debugger;\n');
      const trackedBlocked = run(false);
      expect(trackedBlocked.status).toBe(0);
      expect(JSON.parse(trackedBlocked.stdout).reason).toContain('leftover debugger');
      expect(run(true).stdout).toBe('');
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('tracks shared Codex files while leaving local state ignored', () => {
    const ignore = read('.gitignore');
    expect(ignore).toContain('.codex/*');
    expect(ignore).toContain('!.codex/config.toml');
    expect(ignore).toContain('!.codex/hooks.json');
    expect(ignore).toContain('!.codex/agents/*.toml');
    expect(ignore).toContain('!.codex/hooks/*.sh');
    expect(ignore).not.toMatch(/^\.codex\/$/m);
  });
});

describe('Codex custom agents', () => {
  it('defines a unique model-inheriting read-only reviewer set', () => {
    const dir = path.join(root, '.codex/agents');
    const files = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith('.toml'))
      .sort();
    expect(files).toEqual([
      'woc_cross_platform.toml',
      'woc_docs_researcher.toml',
      'woc_frontend.toml',
      'woc_persistence.toml',
      'woc_release_malware.toml',
      'woc_security.toml',
      'woc_sim_architecture.toml',
      'woc_test_coverage.toml',
    ]);

    const names = new Set<string>();
    for (const file of files) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      const name = text.match(/^name = "([^"]+)"$/m)?.[1];
      if (!name) throw new Error(`${file} has no agent name`);
      expect(names.has(name), `${file} duplicates ${name}`).toBe(false);
      names.add(name);
      expect(text, file).toMatch(/^description = "[^"]+"$/m);
      expect(text, file).toContain('developer_instructions = """');
      expect(text, file).toContain('sandbox_mode = "read-only"');
      expect(text, file).not.toMatch(/^\s*model\s*=/m);
      expect(text, file).not.toMatch(/^\s*model_reasoning_effort\s*=/m);
      expect(text, file).not.toMatch(/^\s*(approval_policy|network_access)\s*=/m);
    }
  });
});

describe('Codex skills', () => {
  it('has exact discovery metadata and no generated placeholders', () => {
    const skillsDir = path.join(root, '.agents/skills');
    const skills = fs.readdirSync(skillsDir).sort();
    expect(skills).toEqual([
      'woc-codex-audit',
      'woc-extract-and-test',
      'woc-feature-plan',
      'woc-file-issue',
      'woc-qa',
      'woc-release-malware-audit',
      'woc-release-merge-audit',
      'woc-review-pr',
    ]);

    const descriptions = new Set<string>();
    for (const skill of skills) {
      const text = fs.readFileSync(path.join(skillsDir, skill, 'SKILL.md'), 'utf8');
      const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
      if (!frontmatter) throw new Error(`${skill} has no YAML frontmatter`);
      const keys = [...frontmatter.matchAll(/^([a-z_]+):/gm)].map((match) => match[1]);
      expect(keys, skill).toEqual(['name', 'description']);
      expect(frontmatter, skill).toContain(`name: ${skill}`);
      const description = frontmatter.match(/^description: "([^"]+)"$/m)?.[1];
      if (!description) throw new Error(`${skill} has no quoted description`);
      expect(descriptions.has(description), `${skill} repeats a description`).toBe(false);
      descriptions.add(description);
      expect(text, skill).not.toMatch(/\bTODO\b|Structuring This Skill/);

      const metadata = fs.readFileSync(path.join(skillsDir, skill, 'agents/openai.yaml'), 'utf8');
      expect(metadata, skill).toContain(`$${skill}`);
      expect(metadata, skill).toMatch(/allow_implicit_invocation: (true|false)/);
    }
  });
});

describe('Codex PR review automation', () => {
  it('isolates untrusted PR data and keeps credentials in separate least-privilege jobs', () => {
    const workflow = read('.github/workflows/pr-ai.yml');
    expect(workflow).toContain('uses: openai/codex-action@v1');
    expect(workflow).toContain(`openai-api-key: \${{ secrets.OPENAI_API_KEY }}`);
    expect(workflow).toContain('permission-profile: ":read-only"');
    expect(workflow).toContain('safety-strategy: "drop-sudo"');
    expect(workflow).toContain('path: review/untrusted/pr');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).not.toContain('CODEX_AUTH_JSON');
    expect(workflow).not.toContain('danger-full-access');
    expect(workflow).not.toContain('npm install -g @openai/codex');

    const reviewStart = workflow.indexOf('  codex-review:');
    const postStart = workflow.indexOf('  post-codex-review:');
    expect(reviewStart).toBeGreaterThan(0);
    expect(postStart).toBeGreaterThan(reviewStart);
    const reviewJob = workflow.slice(reviewStart, postStart);
    const actionStart = reviewJob.indexOf('uses: openai/codex-action@v1');
    expect(actionStart).toBeGreaterThan(0);
    expect(reviewJob.slice(actionStart)).not.toMatch(/^\s+- name:/m);
    expect(workflow.slice(postStart)).not.toContain('OPENAI_API_KEY');
  });

  it('has a valid fixed output schema and no obsolete credential-bearing runner', () => {
    const schema = JSON.parse(read('.github/codex/review-output.schema.json'));
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.findings.maxItems).toBe(20);
    expect(fs.existsSync(path.join(root, 'scripts/prepare_ai_review.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'scripts/post_ai_review.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'scripts/ai_review.mjs'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'scripts/ai_review_diff.mjs'))).toBe(false);
  });
});
