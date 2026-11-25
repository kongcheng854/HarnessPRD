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

当前项目保存在当前浏览器的 localStorage。生成期间刷新会回到对应审核页，可以重新生成。优化失败时保留已有文档。点击完成页的“重新开始”会重置当前项目。后端根据请求中的历史消息续聊，无需数据库。
