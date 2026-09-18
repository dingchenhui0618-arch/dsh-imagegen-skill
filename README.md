# dsh-imagegen-skill

Bundled **imagegen** skill for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): one `dsh plugin add` puts image generation and image editing in every session's skill catalog — no copying files into `$DSH_HOME/skills` by hand.

```sh
dsh plugin --profile web add dsh-imagegen-skill
```

After a restart the agent can load the skill with the `skill` tool (or you can invoke it with `/imagegen`), and it will generate or edit raster images through the CLI that ships with this package.

## What it does

The skill teaches the agent to drive `scripts/image_gen.py` — a small `openai`-SDK CLI — against any OpenAI-compatible endpoint that serves GPT Image:

- `generate` — text to image, including transparent-background cutouts
- `edit` — one or more reference images in, one image out (image-to-image, chain edits)
- `generate-batch` — many jobs from a JSONL file, only when you explicitly ask for CLI/API/model control

Artifacts land in the project (`output/imagegen/` by default), never in a temp directory, and never overwrite an existing asset unless you ask.

## Configuration

| Variable | Meaning |
|---|---|
| `OPENAI_API_KEY` | Credential for your endpoint. Required for real calls. |
| `OPENAI_BASE_URL` | Base URL of an OpenAI-compatible `/v1` root. Leave unset for `api.openai.com`. |

Any relay works as long as it exposes `/v1/images/generations`: the official API, an Azure-style gateway, a company proxy, or a local relay in front of a ChatGPT subscription. Billing follows whatever that endpoint charges — a subscription relay spends subscription quota, not API credit, and surfaces exhaustion as `429 usage_limit_reached` with `resets_in_seconds` in the body.

`--dry-run` validates arguments and the real output path with no key, no network, and no cost.

## Requirement

On Windows the `python` on `PATH` is often the Microsoft Store placeholder with no real interpreter. Install [`uv`](https://docs.astral.sh/uv/) and let the skill load dependencies per run:

```powershell
$env:OPENAI_BASE_URL = "https://api.openai.com/v1"
$env:OPENAI_API_KEY  = "<your key>"
uv run --quiet --with openai python scripts/image_gen.py generate --prompt "a small red dot on white" --size 1024x1024 --out out.png
```

Distribution requires `dsh plugin add` to reach npm or GitHub; nothing else is needed, because this package ships plain JavaScript and no build step.

## Layout

```
package.json          dsh.bundle.patch -> cordis.patch.yml (inserts this plugin into the web composition)
cordis.patch.yml      the insert row
src/index.js          Cordis plugin: registers the bundled skill on ctx.skills
skills/imagegen/
  SKILL.md            the instructions the model loads
  scripts/            image_gen.py, remove_chroma_key.py
  references/         CLI, API, prompting and sample-prompt notes
  assets/             skill icons
test/                 contract tests for the provider
```

`src/index.js` registers a provider on the skill registry (`ctx.skills.registerProvider`) with `resourceBase` pointing at `skills/imagegen/`, so relative paths in `SKILL.md` resolve against the installed copy wherever `node_modules` happens to be.

## Install from a local checkout

```sh
dsh plugin --profile web add D:\Projects\dsh-imagegen-skill
dsh plugin --profile web list
```

## Uninstall

```sh
dsh plugin --profile web remove dsh-imagegen-skill
```

## Note on shadowing a hand-installed copy

A hand-installed `$DSH_HOME/skills/imagegen` and this package both register a skill named `imagegen`. The packaged provider uses the standard packaged rank (600) and the filesystem user root ranks lower (400), so the packaged copy wins and the registry logs a notice about the ignored duplicate. Keep one of the two: if you install this package, remove the hand-copied directory (or the reverse).

## Attribution and license

Apache-2.0. The reference documents, the assets, and the Python scripts under `skills/imagegen/` come from the Codex `imagegen` system skill; `SKILL.md` and the Cordis provider are this repository's work. See [NOTICE](NOTICE) for the full provenance statement, and [LICENSE](LICENSE) for the license text.

> Installing any dsh plugin runs third-party code with your own permissions. This one is a skill provider: it reads files inside its own package and registers a catalog entry. It makes no network request of its own — the skill only runs `scripts/image_gen.py` when an agent or a user actually asks for an image.
