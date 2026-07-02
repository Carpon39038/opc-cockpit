# OPC Cockpit

一人公司驾驶舱。当前已实现：任务看板（Web UI + `opc` CLI + SQLite），AI Agent 是一等公民工作者。

## 命令

- `npm run dev` — 开发模式（API :5175 + Vite :5173，改前端访问 5173）
- `npm run build` — 构建 server/CLI/前端（改完代码必须重新 build，`./opc` 跑的是 dist）
- `npm start` — 生产模式，单进程跑在 http://localhost:5175

## 结构

- `src/shared/` — 类型、SQLite（node:sqlite，零原生依赖）、任务操作逻辑（server 与 CLI 共用）
- `src/server/` — Hono API + 伺服看板静态文件
- `src/cli/` — `opc` 命令行
- `web/src/` — React 看板 UI（手写 CSS，驾驶舱风格）
- 数据在 `data/opc.db`（gitignored），可用 `OPC_DB` 环境变量指定

## 任务看板协议（AI 必读）

你在这个仓库工作时，用 `./opc` 领取和反馈任务。身份自动识别为 `claude`（多 Agent 场景用 `--as <名字>` 区分）。

**工作循环：**

```bash
./opc list -s todo        # 看有什么可领（或 ./opc next 看下一个）
./opc claim               # 领取优先级最高的任务（会打印完整描述和历史动态）
./opc claim T-3           # 或领取指定任务
./opc progress T-3 "完成了 schema 设计，开始写 API"   # 干活期间随时汇报
./opc done T-3 -m "交付摘要：改了哪些文件、怎么验证的"  # 提交 → 进入「待审核」等用户确认
```

**规则：**

1. 领取前先读任务描述和动态（`opc show T-3`），那是你的上下文包。
2. 进度汇报写实质内容（做了什么、产出在哪、卡在哪），不要写"正在进行中"。
3. `done` 必须带 `-m` 交付摘要。Agent 完成默认进「待审核」，用户在看板上验收；不要用 `--skip-review`，除非用户明确说过。
4. 做不了/不该你做的任务：`opc comment T-3 "原因"` 然后 `opc move T-3 todo` 释放（移回 todo 会自动解除认领）。
5. 发现新工作可以 `opc add "标题" -d "描述" --project xxx` 登记，而不是顺手做掉。
6. 程序化读取加 `--json`。

用户在看板 UI（http://localhost:5175）上看到你的一切操作——运行日志实时滚动。
