import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import { apply, CANDIDATE, inject, name, provider } from "../src/index.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_DIR = join(PACKAGE_ROOT, "skills", "imagegen");

/** A stub ctx that records what the plugin registers, without the real registry. */
function stubCtx() {
  const registrations = [];
  return {
    registrations,
    skills: {
      registerProvider(create) {
        const control = { signal: new AbortController().signal, invalidate() {} };
        const created = create(control);
        registrations.push(created);
        return () => {};
      },
    },
  };
}

test("plugin exports the cordis contract", () => {
  assert.equal(name, "imagegen-skill");
  assert.deepEqual(inject, ["skills"]);
  assert.equal(typeof apply, "function");
});

test("apply registers exactly one provider on ctx.skills", () => {
  const ctx = stubCtx();
  apply(ctx);
  assert.equal(ctx.registrations.length, 1);
  assert.equal(ctx.registrations[0], provider);
});

test("apply fails loudly without the skill registry", () => {
  assert.throws(() => apply({}), /skill registry/);
  assert.throws(() => apply({ skills: {} }), /skill registry/);
});

test("candidate satisfies every field the registry validates", () => {
  // Mirrors validateCandidate() in @deepseek-ai/dsh-skill.
  assert.match(CANDIDATE.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(CANDIDATE.name, "imagegen");
  assert.equal(typeof CANDIDATE.description, "string");
  assert.ok(CANDIDATE.description.length > 0);
  assert.equal(typeof CANDIDATE.invocation.modelInvocable, "boolean");
  assert.equal(typeof CANDIDATE.invocation.userInvocable, "boolean");
  assert.equal(typeof CANDIDATE.source, "string");
  assert.equal(CANDIDATE.provider, provider.name);
  assert.ok(Number.isFinite(CANDIDATE.rank));
  assert.equal(CANDIDATE.rank, 600, "packaged providers use the standard packaged rank");
  assert.equal(CANDIDATE.resourceBase.kind, "directory");
});

test("list() returns the bundled candidate", async () => {
  const candidates = await provider.list();
  assert.deepEqual(candidates, [CANDIDATE]);
});

test("get() returns a definition the registry accepts", async () => {
  const definition = await provider.get(CANDIDATE);
  assert.equal(definition.name, "imagegen");
  assert.equal(definition.description, CANDIDATE.description);
  assert.equal(typeof definition.content, "string");
  assert.ok(definition.content.length > 0);
  assert.equal(definition.provider, provider.name);
  assert.equal(typeof definition.source, "string");
});

test("the served body drops the YAML frontmatter", async () => {
  const { content } = await provider.get(CANDIDATE);
  assert.ok(!content.startsWith("---"), "frontmatter must not reach the model");
  assert.ok(!/\ndescription: "Generate or edit raster images/.test(content));
  assert.match(content, /^# Image Generation Skill/);
});

test("the served body keeps the instructions the model needs", async () => {
  const { content } = await provider.get(CANDIDATE);
  assert.match(content, /scripts\/image_gen\.py/);
  assert.match(content, /OPENAI_BASE_URL/);
  assert.match(content, /--dry-run/);
  assert.match(content, /references\/prompting\.md/);
});

test("the served body leaks no machine-specific endpoints", async () => {
  const { content } = await provider.get(CANDIDATE);
  assert.doesNotMatch(content, /127\.0\.0\.1/);
  assert.doesNotMatch(content, /localhost/i);
  assert.doesNotMatch(content, /[A-Za-z]:\\Users\\/);
});

test("the server root matches SKILL.md, so reloads serve the live file", async () => {
  const fromDisk = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8");
  const { content } = await provider.get(CANDIDATE);
  assert.ok(fromDisk.endsWith(content), "provider must serve SKILL.md's body");
  assert.equal(fileURLToPath(CANDIDATE.locator), join(SKILL_DIR, "SKILL.md"));
});

test("every resource SKILL.md points at is shipped", () => {
  for (const relative of [
    "scripts/image_gen.py",
    "scripts/remove_chroma_key.py",
    "references/cli.md",
    "references/image-api.md",
    "references/prompting.md",
    "references/sample-prompts.md",
    "assets/imagegen-small.svg",
    "assets/imagegen.png",
  ]) {
    assert.ok(existsSync(join(SKILL_DIR, relative)), `missing ${relative}`);
  }
});

test("package.json wires the bundle patch the dsh profile needs", () => {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
  assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
  assert.ok(pkg.files.includes("skills"), "the skill payload must be published");
  assert.equal(pkg.license, "Apache-2.0");
  assert.equal(pkg.dependencies, undefined, "no runtime dependencies");
});

test("cordis.patch.yml inserts this package by its published name", () => {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
  const patch = readFileSync(join(PACKAGE_ROOT, "cordis.patch.yml"), "utf8");
  assert.match(patch, new RegExp(`name: ${pkg.name}`));
});

test("the served body is stable across calls", async () => {
  const [a, b] = await Promise.all([provider.get(CANDIDATE), provider.get(CANDIDATE)]);
  assert.equal(a.content, b.content);
  const direct = await readFile(join(SKILL_DIR, "SKILL.md"), "utf8");
  assert.ok(direct.length > a.content.length, "the on-disk file keeps its frontmatter");
});
