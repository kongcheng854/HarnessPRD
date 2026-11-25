# HarnessPRD

中文产品需求工作台。填写表单后与 AI 产品经理对话，依次生成和审核 PRD、接口文档与开发提示词，最后下载三个 Markdown 文件。文档支持手动编辑与按意见进行 AI 优化。

## 本地运行

使用 Python 3.10+、Node.js 22.12+。在仓库根目录打开 PowerShell。

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt
Copy-Item backend/.env.example backend/.env
```

在 `backend/.env` 填入 Anthropic 密钥并选择账户可用的模型。使用 OpenAI 时，将 `DEFAULT_LLM_PROVIDER` 改为 `openai`，同时设置 `OPENAI_API_KEY` 和 `DEFAULT_LLM_MODEL`。修改配置后重启后端。

```powershell
backend/.venv/Scripts/python -m backend.main
```

另开终端启动前端。

```powershell
cd frontend
npm install
npm run dev
```

打开 http://localhost:5173 。后端健康检查位于 http://localhost:8000/health ，交互式接口文档位于 http://localhost:8000/docs 。前端构建命令为 `npm run build`。

## 会话恢复

根路径保留原有浏览器草稿。打开 `/v2` 可新建 SQLite 方案，从结构化表单或已有 PRD 开始。首次开始澄清或进入 PRD 审核时创建记录，地址自动切换到 `/v2/方案ID`。首次保存时依据 PRD 一级标题、产品名称或方案 ID 命名，之后编辑正文会保留原方案标题。

打开 `/v2/list` 可继续编辑或删除方案。编辑中的变更默认在停顿一秒后保存，点击“我的方案”或“结束当前任务”会先提交待保存的变更。结束任务会打开新工作台，已有记录仍在列表中。生成中刷新将回到对应审核页。

后端启动时自动创建 `backend/sessions.sqlite3`。使用 `SESSION_DB_PATH` 可指定其他数据库文件。连接同一后端的浏览器共享方案列表。
