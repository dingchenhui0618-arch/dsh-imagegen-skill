# 安全模型 / Security model

这份文档说明 **dsh-imagegen-skill** 信任什么、会不会联网、你装了之后 agent 多出了什么能力。
它从实现里读出来：`src/index.js`（skill provider）、`skills/imagegen/SKILL.md`（模型读到的指令）、
`skills/imagegen/scripts/image_gen.py` 与 `remove_chroma_key.py`（真正干活的 CLI）、
`test/provider.test.mjs`（契约测试）。**如果文档和代码不一致，以代码为准。**

> 一句话：**这个包自己不发任何请求、不写任何文件**——它只是把一个 skill 注册进
> `ctx.skills`。但那个 skill 教模型用你的 shell 去跑 `image_gen.py`，
> 而那个 CLI 会**带着你的 `OPENAI_API_KEY` 访问你配置的端点，并把图片写到你给的路径**。
> 边界不在这个包上，在「模型能执行命令」这件事上。

## 信任边界

| 半边 | 跑在哪 | 做什么 |
| --- | --- | --- |
| Cordis 插件 `src/index.js` | DSH 宿主进程 | `ctx.skills.registerProvider(...)` 注册一个 provider：`list()` 返回一条候选，`get()` 读自己包里的 `SKILL.md` 并剥掉 YAML frontmatter。仅此而已。 |
| 模型可见内容 `skills/imagegen/SKILL.md` | 模型上下文 | 指令：用 `scripts/image_gen.py`、先 `--dry-run`、产物写 `output/imagegen/`、不许悄悄降级模型、不许批量未经确认。 |
| CLI `scripts/image_gen.py` | 你的 shell（agent 的 execute 工具） | 读 `OPENAI_API_KEY` / `OPENAI_BASE_URL`，调 `/v1/images/generations`（或 edit 端点），把 `b64_json` 解码落盘。 |

**视为不可信输入的：**

- **提示词**：来自用户与模型，经 `--prompt` / `--prompt-file` / JSONL 批量文件；
- **端点返回**：`data[*].b64_json` 被 `base64.b64decode` 后**直接写到 `--out` 指定的路径**，
  只做了大小检查（单张上限 50 MB）；
- **参考图 / mask**：`--image`、`--mask` 由调用方给的路径读取（`edit` 模式）；
- **环境变量**：`OPENAI_API_KEY`、`OPENAI_BASE_URL`——SDK 自己读，脚本只判断有没有设置；
- **批量清单**：`generate-batch` 的 JSONL，最多 500 个 job（`MAX_BATCH_JOBS`）。

## 鉴权与权限现状（照实写）

- **本包不提供任何鉴权面**：没有路由、没有工具、没有 IPC。它注册的是一条 skill 目录条目
  （`invocation: { modelInvocable: true, userInvocable: true }`，rank 600）。
- **真实权限 = 你的 shell 权限**。skill 被加载后，模型会（在你或它自己决定的时候）执行
  `python scripts/image_gen.py ...`；这一步和你在终端里手敲没有区别——同样的读写权限、
  同样的网络出口。**装任何 DSH 插件都是在跑第三方代码，这个包至少把「它到底做什么」写在明处。**
- **凭据只有一处**：`OPENAI_API_KEY` 环境变量。脚本从不打印它的值——`_ensure_api_key` 只输出
  「OPENAI_API_KEY is set.」到 stderr；仓库里没有 key、没有 `.env`、没有内嵌端点
  （`NOTICE` 也承诺了这一点，SKILL.md / README 里的端点都是占位符）。
- **端点由你定**：`OPENAI_BASE_URL` 指哪，提示词就发到哪。官方 API、Azure 风格网关、
  公司代理、本地中继都行——**隐私策略跟着那个端点走，不跟着这个包走**。

## 数据与副作用

- **本包（Node 侧）**：读 `skills/imagegen/SKILL.md` 一个文件；不写、不联网、不读环境变量。
- **CLI（模型调用时）**：`--dry-run` 只校验参数与真实输出路径，**不需要 key、不联网、不花钱**；
  真跑时向端点发一次生成请求，把图片写进 `--out`（默认 `output/imagegen/output.png`），
  `--downscale-*` 会再派生一张 `-web` 后缀的副本；`generate-batch` 按 `--out-dir` 落多张。
- **`remove_chroma_key.py`**：用 PIL 读入 `--input`、写 `--out`，纯本地图像处理，不联网。
- **运行时依赖**：SKILL.md 教的是 `uv run --quiet --with openai python ...`——
  这会**从 PyPI 下载 `openai` 包**（第一次跑）。不想让它联网取包，就先把依赖装进环境。
- **遥测**：无。

## 已知限制（真实取舍，不是 bug）

1. **它不沙箱化模型**：真正执行命令的是宿主，不是这个包。模型能不能跑 `image_gen.py`、
   能不能写到别的路径，取决于宿主的权限与审批设置。
2. **输出路径不设根目录**：`--out` / `--out-dir` 照用调用方给的路径（相对路径相对当前目录）。
   它能写到你的用户有权限写的任何地方——这是 CLI 工具的正常语义，不是漏洞，但值得知道。
3. **花费跟着端点**：订阅中继花的是订阅额度（`429 usage_limit_reached` 不等于配置错误）；
   官方 API 花的是 API 余额。`generate-batch` 最多 500 个 job 一口气花。
4. **端点看不见**：脚本不校验 TLS、不校验证书、不限制 schema 之外的行为——它相信
   `OPENAI_BASE_URL` 指向的东西。指到一个不可信的代理，提示词与返回图都可能被记录/替换。
5. **提示词里的东西会出去**：图片描述、参考图会发给端点；不要让 agent 把凭据或私有文档
   当提示词塞进去。
6. **许可与肖像**：生成的图属于谁、能不能商用、像不像真人——由端点条款和你所在司法辖区决定，
   本项目不做任何保证。
7. **`SKILL.md` 的「不要修改脚本」只是指令**，没有技术约束；模型仍可能改它或绕开它写一次性脚本。
8. **Windows 上 `python` 常是 Microsoft Store 占位符**，必须用 `uv`（SKILL.md 写明了）。
9. **skill 同名遮蔽**：手装的 `$DSH_HOME/skills/imagegen` 与这个包同名，packaged rank 600
   会盖过用户目录的 400；留着两份只会得到一条忽略提示，别两份都留。

## 明确不算漏洞的

- 加载 skill 之后 agent 能生成图、并把图写进项目目录（这就是功能）；
- `--dry-run` 之外真的花钱（见限制第 3 条）；
- 端点收到了你的提示词（见限制第 4、5 条）；
- 生成内容不合意或有版权/肖像争议（见限制第 6 条）；
- 仓库里没有 key：`NOTICE` 与 `test/provider.test.mjs` 都盯着这一点。

## 报告漏洞

用 GitHub 的私密渠道：<https://github.com/dingchenhui0618-arch/dsh-imagegen-skill/security/advisories/new>

个人项目，**不承诺响应时限**。属于上游（Codex imagegen skill / `image_gen.py`）的问题，
也欢迎报到这里，我会判断是否同步回上游。请不要把还在生效的问题直接发到公开 issue 里。

## 支持范围

只维护最新版 `0.1.x`（`package.json` 为 `0.1.0`）。没有发布到 npm，
所以「最新版」= 默认分支 `main` 的最新提交。
