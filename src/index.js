import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Packaged `imagegen` skill provider for DeepSeek Harness.
 *
 * Registers the bundled imagegen skill on the `ctx.skills` registry so every
 * session gets it in the model-facing catalog (`skill` tool) and in the `/`
 * menu, without the user copying anything into `$DSH_HOME/skills`.
 *
 * @module dsh-imagegen-skill
 */

const PROVIDER_NAME = "imagegen";
const SKILL_NAME = "imagegen";

const SKILL_DIR_URL = new URL("../skills/imagegen/", import.meta.url);
const SKILL_BODY_URL = new URL("SKILL.md", SKILL_DIR_URL);

/** Relative paths inside SKILL.md resolve against the bundled skill directory. */
const RESOURCE_BASE = {
  kind: "directory",
  path: fileURLToPath(SKILL_DIR_URL),
};

/**
 * Precedence rank for a packaged skill provider. Matches `BUNDLED_SKILL_RANK`
 * exported by `@deepseek-ai/dsh-skill`; the literal keeps this package
 * dependency-free, which is what lets it install with no build step.
 */
const PACKAGED_SKILL_RANK = 600;

const DESCRIPTION =
  "Generate or edit raster images when the task benefits from AI-created bitmap visuals such as photos, illustrations, textures, sprites, mockups, or transparent-background cutouts. Use when the agent should create a brand-new image, transform an existing image, or derive visual variants from references, and the output should be a bitmap asset rather than repo-native code or vector. Do not use when the task is better handled by editing existing SVG/vector/code-native assets, extending an established icon or logo system, or building the visual directly in HTML/CSS/canvas.";

const CANDIDATE = {
  name: SKILL_NAME,
  description: DESCRIPTION,
  invocation: { modelInvocable: true, userInvocable: true },
  provider: PROVIDER_NAME,
  source: "bundled",
  resourceBase: RESOURCE_BASE,
  rank: PACKAGED_SKILL_RANK,
  locator: SKILL_BODY_URL,
};

const provider = {
  name: PROVIDER_NAME,
  list() {
    return Promise.resolve([CANDIDATE]);
  },
  async get(candidate) {
    const body = await readFile(candidate.locator, "utf8");
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: RESOURCE_BASE,
      content: stripFrontmatter(body),
    };
  },
};

/**
 * The skill registry renders the body, so the YAML frontmatter belongs to the
 * on-disk copy only; leaving it in would show up verbatim in the model's
 * `<skill_content>` block.
 */
function stripFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return normalized;
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return normalized;
  const afterFence = normalized.indexOf("\n", end + 1);
  return afterFence === -1 ? "" : normalized.slice(afterFence + 1).replace(/^\n+/, "");
}

/** Cordis plugin name. */
export const name = "imagegen-skill";

/** The bundled provider is only useful next to the skill registry. */
export const inject = ["skills"];

/** Register the bundled `imagegen` skill provider on `ctx.skills`. */
export function apply(ctx) {
  if (typeof ctx.skills?.registerProvider !== "function") {
    throw new Error(
      "dsh-imagegen-skill requires the skill registry (@deepseek-ai/dsh-skill, service `skills`) in this composition",
    );
  }
  ctx.skills.registerProvider(() => provider);
}

export { provider, CANDIDATE };
