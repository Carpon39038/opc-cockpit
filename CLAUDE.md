# OPC Cockpit

一人公司驾驶舱。当前已实现：驾驶舱首页 + 任务看板（Web UI + `opc` CLI + SQLite），AI Agent 是一等公民工作者。

## 命令

- `npm run dev` — 开发模式（API :5175 + Vite :5173，改前端访问 5173）
- `npm run build` — 构建 server/CLI/前端（改完代码必须重新 build，`./opc` 跑的是 dist）
- `npm start` — 生产模式，单进程跑在 http://localhost:5175

## 结构

- `src/shared/` — 类型、SQLite（node:sqlite，零原生依赖）、任务操作逻辑（server 与 CLI 共用）
- `src/server/` — Hono API + 伺服看板静态文件
- `src/cli/` — `opc` 命令行
- `web/src/` — React UI，hash 路由：`#/` 驾驶舱首页（pages/Home）、`#/board` 任务看板（pages/Board）、`#/projects` 项目中心（pages/Projects）；App.tsx 持有共享状态（轮询/抽屉/新建弹窗），新模块加页面 + NavRail 项即可
- 数据在 `data/opc.db`（gitignored），可用 `OPC_DB` 环境变量指定

## 任务看板协议（AI 必读）

你在这个仓库工作时，用 `./opc` 领取和反馈任务。身份自动识别为 `claude`（多 Agent 场景用 `--as <名字>` 区分）。

**工作循环：**

```bash
./opc list -s todo        # 看有什么可领（或 ./opc next 看下一个）
./opc claim --model <你的模型ID>        # 领取优先级最高的任务（会打印完整描述和历史动态）
./opc claim T-3 --model <你的模型ID>    # 或领取指定任务
./opc progress T-3 "完成了 schema 设计，开始写 API"   # 干活期间随时汇报
./opc done T-3 -m "交付摘要：改了哪些文件、怎么验证的"  # 提交 → 进入「待审核」等用户确认
```

**规则：**

1. 领取时上报身份：`--model` 传你自己的真实模型 ID（如 `claude-fable-5`，从你的系统提示可知；`ANTHROPIC_MODEL` 环境变量可能是代理配置，不可信）。工具名自动识别（claude-code / cursor / codex 等），特殊环境用 `--tool` 覆盖。
2. 领取前先读任务描述和动态（`opc show T-3`），那是你的上下文包。
3. 进度汇报写实质内容（做了什么、产出在哪、卡在哪），不要写"正在进行中"。描述和评论支持 Markdown（列表/代码块/表格/任务清单），看板上会渲染。
4. `done` 必须带 `-m` 交付摘要。Agent 完成默认进「待审核」，用户在看板上验收；不要用 `--skip-review`，除非用户明确说过。
5. 做不了/不该你做的任务：`opc comment T-3 "原因"` 然后 `opc move T-3 todo` 释放（移回 todo 会自动解除认领并清空工具/模型记录）。
6. 发现新工作可以 `opc add "标题" -d "描述" --project xxx --model <你的模型ID>` 登记，而不是顺手做掉。加 `--model` 会记录创建者（模型·工具，如 `claude-fable-5 · claude-code`），让看板能区分是谁建的任务；工具名自动识别。不带 `--project` 会从当前 git 仓库自动识别项目名（worktree 解析到主仓库名），项目自动建档。
7. 项目是一等实体：`opc projects` 看全局，`opc project <名>` 看详情。完成大块工作后顺手更新项目状态：`opc project <名> --next "下一步" [--blockers "阻塞"]`，让项目卡片始终反映真实进展。
8. 程序化读取加 `--json`。

用户在看板 UI（http://localhost:5175）上看到你的一切操作——运行日志实时滚动。
