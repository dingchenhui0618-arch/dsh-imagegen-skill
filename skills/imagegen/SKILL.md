---
name: "imagegen"
description: "Generate or edit raster images when the task benefits from AI-created bitmap visuals such as photos, illustrations, textures, sprites, mockups, or transparent-background cutouts. Use when the agent should create a brand-new image, transform an existing image, or derive visual variants from references, and the output should be a bitmap asset rather than repo-native code or vector. Do not use when the task is better handled by editing existing SVG/vector/code-native assets, extending an established icon or logo system, or building the visual directly in HTML/CSS/canvas."
---

# Image Generation Skill

Generates or edits images for the current project (for example website assets, game assets, UI mockups, product mockups, wireframes, logo design, photorealistic images, or infographics).

## Mode selection (DeepSeek Harness notes)

DeepSeek Harness has **no built-in `image_gen` tool**, so every mention of "built-in tool mode / 内置 image_gen" in the reference files is unavailable here. Always use the CLI.

- **CLI mode (the only path in DSH):** `scripts/image_gen.py`. It needs `OPENAI_API_KEY` and an OpenAI-compatible endpoint that serves a GPT Image model. When the endpoint is not `api.openai.com`, point `OPENAI_BASE_URL` at it (the `openai` SDK reads that variable itself).

Rules:

- Always go through the CLI. Never claim a built-in `image_gen` exists, and never write a one-off SDK script instead.
- Do not modify `scripts/image_gen.py`. If a capability is missing, ask the user first.
- Do not silently downgrade from `gpt-image-2` to `gpt-image-1.5`; ask first unless the user explicitly asked for the fallback.
- A user saying "batch" is not consent for the CLI's `generate-batch`. Only use `generate-batch` when the user explicitly asks for CLI/API/model control; otherwise run one `generate` at a time.
- Write artifacts inside the project, to `output/imagegen/` by default. Assets the project will use must not live only in a temp directory.
- Do not overwrite existing assets unless the user explicitly asks for a replacement; save a versioned sibling file instead, such as `hero-v2.png`.

### Running on Windows

On Windows the `python` on `PATH` is often the Microsoft Store placeholder, which has no real interpreter. Use `uv` to manage the interpreter and load dependencies per run with `--with`; do not modify `scripts/image_gen.py`.

Set the endpoint and key for your own deployment, then call the script that ships with this skill:

```powershell
$env:OPENAI_BASE_URL = "https://api.openai.com/v1"   # any OpenAI-compatible endpoint that serves GPT Image
$env:OPENAI_API_KEY  = "<your key>"
# <skill-dir> is the base directory reported in <skill_resources>;
# when the skill is installed from disk it is the directory containing this SKILL.md.
$scriptPath = Join-Path $env:SKILL_DIR "scripts\image_gen.py"
uv run --quiet --with openai python $scriptPath generate --prompt "..." --size 1024x1024 --quality low --out "<project>\output\imagegen\x.png"
```

- **Endpoint:** any host that relays `/v1/images/generations` to an OpenAI-compatible image backend works — the official API, an Azure/OpenAI-compatible gateway, a company proxy, or a local relay in front of a ChatGPT subscription. The script itself does not care which, as long as `OPENAI_BASE_URL` points at a `/v1` root.
- **Billing:** depends entirely on the endpoint you configure. A relay in front of a subscription consumes subscription quota rather than API credit.
- **Quota exhaustion:** when the upstream returns `429 usage_limit_reached` with `resets_in_seconds` in the body, that is quota exhaustion, **not** a configuration error. Tell the user how long the reset takes; do not retry in a loop.
- Validate arguments and the real output path first with `--dry-run`: it consumes no quota, needs no key, and needs no network.
- Shared prompt craft lives in `references/prompting.md` and `references/sample-prompts.md`.

### Troubleshooting

| Symptom | Meaning | What to do |
|---|---|---|
| `429 usage_limit_reached` | The endpoint's quota window is exhausted (a relay in front of a subscription typically uses a fixed window, not a sliding one) | Wait out `resets_in_seconds` from the response; **do not retry repeatedly**. When the endpoint pools several accounts, a retry may land on one that has already unlocked |
| `401 token_expired` | A pooled credential expired; this is transient, not a configuration error | Retry once; if it persists, isolate the endpoint with the raw curl below |
| Cannot tell whether the proxy or the script is at fault | — | Hit `/v1/images/generations` with a raw curl, bypassing the SDK |

Raw curl isolation (replace the endpoint and add an `Authorization` header if your endpoint requires one):

```powershell
$body = Join-Path $env:TEMP 'p.json'
[System.IO.File]::WriteAllText($body, '{"model":"gpt-image-2","prompt":"a small red dot on white","n":1,"size":"1024x1024"}', (New-Object System.Text.UTF8Encoding($false)))
curl.exe -s --max-time 90 -X POST "$env:OPENAI_BASE_URL/images/generations" -H "Content-Type: application/json" --data-binary "@$body" -o "$env:TEMP\r.json" -w "http=%{http_code}`n"
```

Decode `data[0].b64_json` from the response straight to disk:

```powershell
$j = Get-Content "$env:TEMP\r.json" -Raw | ConvertFrom-Json
[System.IO.File]::WriteAllBytes('D:\out.png', [System.Convert]::FromBase64String($j.data[0].b64_json))
```

Note: a request for `--size 1024x1024` may come back as `1536x1024`; trust the `size` field in the response body.

When writing retry scripts, avoid short variable names such as `$s`. PowerShell variable names are case-insensitive, so `$s` (seconds to wait) silently overwrites `$S` (script path), and the symptom is `python.exe: can't open file '<a number>'`.
