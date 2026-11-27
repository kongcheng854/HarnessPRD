# HarnessPRD

HarnessPRD 是中文产品需求工作台。在 V2 工作台，你可以从需求访谈或已有 PRD 开始，确认需求基线，生成接口文档和开发提示词，最后将正文、版本来源与质量摘要一起导出为 ZIP。

## 本地运行

以下命令在仓库根目录的 PowerShell 中运行。本项目已在 Python 3.12 和 Node.js 24 上验证。

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

在 `backend/.env` 设置 `ANTHROPIC_API_KEY` 和账户可用的 `DEFAULT_LLM_MODEL`。使用 OpenAI 时，将 `DEFAULT_LLM_PROVIDER` 设为 `openai`，同时设置 `OPENAI_API_KEY` 和模型名。兼容服务可通过 `OPENAI_BASE_URL` 指定地址。修改配置后重启后端。

```powershell
backend/.venv/Scripts/python -m backend.main
```

另开终端启动前端。

```powershell
cd frontend
npm install
npm run dev
```

开发服务器默认使用前端端口 5173 和后端端口 8000。根路径提供使用浏览器草稿的原版工作台，新流程从 V2 入口开始。[打开 V2 工作台](http://localhost:5173/v2) · [后端健康检查](http://localhost:8000/health) · [交互式接口文档](http://localhost:8000/docs)

## 从需求到交付

1. **准备 PRD。** 选择「从零创建 PRD」，填写结构化表单，通过澄清对话补充需求，再核对摘要并生成 PRD。已有材料可从「导入已有素材」进入，支持单独导入 PRD，或同时导入 PRD 和接口文档。
2. **确认需求基线。** 在 PRD 审核页通读当前正文，点击「确认需求基线」。确认绑定当前版本和正文内容，解锁下游生成。手动修改并保存、另存新版本、恢复历史版本、重新生成 PRD 或完成 PRD 优化后，都需要重新确认。
3. **生成下游文档。** 可以先生成接口文档，再基于 PRD 和接口文档生成提示词，也可以直接从 PRD 生成提示词。每次生成接口文档或提示词都会对生成的非空正文做一次模型审查。审查发现问题或超时时，正文仍可编辑和导出，用户可以根据意见发起 AI 优化。
4. **导出交付包。** 在任一文档审核页点击「导出交付包」。方案中至少有一份非空正文即可下载，下游文档显示过期提示时也可导出。

## 如何阅读审核结果

| 审核页信息 | 检查内容 | 如何使用 |
| --- | --- | --- |
| 质量报告 | 对三类文档生成或优化后的最终正文执行结构规则，检查 PRD 章节、MVP 表格、接口分区、提示词章节等 | 查看分数和逐项结果。高严重性检查全部通过即为通过，总分按通过项占比计算。手改正文后旧报告失效 |
| 模型审查意见 | 接口文档侧重 MVP 覆盖、接口和字段依据、路径及响应约定。提示词侧重任务覆盖、术语一致性和每条提示词能否独立执行 | 展开对应版本的审查意见，查看问题所在章节及修改建议 |
| 上游版本变更 | 生成任务记录实际使用的 PRD 版本，提示词还记录所用接口文档或跳过接口的标记。上游升版或同版本正文变化都会触发提示 | 核对受影响的内容，或在确认当前 PRD 基线后重新生成 |

## 版本与会话恢复

每个 V2 方案有独立地址 `/v2/{id}`。编辑默认在停顿一秒后自动保存。手动编辑和 AI 优化会更新当前版本。如果希望保留修改前的正文，先在「版本历史」选择「保存为新版本」。历史版本可以预览和添加备注，恢复时会创建新的当前版本。

生成和优化任务由后端执行。刷新页面会重新连接进行中的任务，已结束的任务可恢复结果。后端重启会将中断的任务标记为失败，并恢复已保存的草稿。点击「我的方案」或「结束当前任务」会先提交待保存的编辑。[打开方案列表](http://localhost:5173/v2/list)

后端启动时自动创建 `backend/sessions.sqlite3`，也可通过 `SESSION_DB_PATH` 指定数据库文件。连接同一后端的浏览器共享方案列表。

## 交付包内容

下载文件名为 `{产品名}-delivery.zip`。压缩包按当前保存内容导出，只有非空文档才有对应的 Markdown 文件。

| 文件 | 内容 |
| --- | --- |
| `PRD.md`、`API-Docs.md`、`Prompts.md` | 需求、接口设计和开发提示词的当前正文 |
| `README.md` | 建议阅读顺序、版本和时间、未通过的检查与审查问题、上游变更提示 |
| `manifest.json` | 方案 ID、入口类型、导出时间及各文档版本。按已有记录包含 PRD 基线确认时间、`derived_from` 来源、`quality_gate` 和 `review` 摘要，以及 `stale_warnings` |

## 常用 V2 接口

| 方法和路径 | 用途 |
| --- | --- |
| `POST /api/session/{id}/confirm-baseline` | 提交当前 PRD 的 `version_id` 和 `content`，确认需求基线 |
| `POST /api/jobs` | 提交生成或优化任务。生成接口文档或提示词时，后端校验基线和提交的上游正文 |
| `GET /api/jobs/{job_id}/stream` | 通过 SSE 接收任务快照、正文增量、审查和完成事件 |
| `GET /api/session/{id}/documents/{doc_type}/versions` | 查询版本列表。追加 `/{version_id}` 可读取该版正文与元数据 |
| `GET /api/session/{id}/export` | 下载当前方案的 ZIP 交付包 |

## 固定案例评测

V2 结构化表单支持四个固定案例的一键回填与跳过澄清生成。案例来源、待核对项和覆盖率计算方式见[固定案例与覆盖率](evals/README.md)。

每个案例计划手动运行两轮。开跑时登记批次和 attempt，结束时用同次导出的 ZIP 核对输入、正文及上游版本。命令与失败归档示例见[平台手动采集指南](evals/COLLECTION.md)。

归档后，用 `check` 核对原稿，再用 `judge` 按冻结需求逐条评审。最新自动成绩保存在 `evals/reviews/<批次>.<attempt>.auto.json`，人工抽查另存为 `*.human.json`。评审模型配置、人工校准和可选的 LangSmith 发布见[离线评审指南](backend/evaluation/README.md)。

### 生成与阅读覆盖率报告

在仓库根目录运行以下 PowerShell 命令，将示例中的批次和 attempt ID 换成本地台账中的值。省略 `--attempt-id` 时汇总整个批次，重复指定该参数可选取同一轮的多次运行。报告从本地台账和自动成绩生成，可离线重复运行。

```powershell
backend/.venv/Scripts/python -m backend.evaluation report --collection-id manual-001 --stem manual-001-r1 --attempt-id approval-001-r1-a01 --attempt-id community-001-r1-a01
```

- **查看成绩**：打开 `evals/reports/<stem>.md` 查看逐包结果，或读取同名 `.json` 做分析。单包覆盖率等于完整覆盖的需求数除以适用需求总数。批次主指标 `mean_coverage` 对有成绩的包等权取平均。
- **核对分母**：逐条判定完整且有覆盖率的 `needs_review` 包计入均值。评审失败、缺少汇总或交付包不一致时，可在报告中查看排除原因。没有有效包时，Markdown 显示 `N/A`，JSON 保留 `null`。
- **追溯缺口**：硬冲突、部分覆盖和缺失需求按类别列出，可沿链接核对原稿引文和本次报告采用的自动评审记录。

## 本地验证

安装依赖后，在仓库根目录运行后端测试、前端测试和生产构建。

```powershell
backend/.venv/Scripts/python -m unittest discover -s backend/tests
node --test frontend/tests/*.test.mjs
npm --prefix frontend run build
```
