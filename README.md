# OPC Cockpit

OPC Cockpit 是一个先给个人使用、未来面向 AI-heavy 一人公司的操作系统。它的目标不是再做一个普通待办、知识库或仪表盘，而是把任务、日历、项目、知识、调研、Playbook/Skill 和 AI Agent 工作流连接成一个每日可执行的驾驶舱。

一句话定义：

> 把一个人的注意力、记忆、执行力、AI 能力和公司运营状态接成一个闭环。

## 当前定位

- 第一阶段：个人自用。
- 目标用户：AI-heavy 的一人公司、独立开发者、solo founder、咨询顾问、内容/产品型个体。
- 长期方向：一人公司的超级人体系统，让一个人像一个小团队一样运转。

## 已实现：驾驶舱首页 + 任务看板

AI Agent 是一等公民工作者：AI 领任务、汇报进度、提交审核，人在驾驶舱里验收。

```bash
npm install
npm run build
npm start        # http://localhost:5175
```

两个入口，一份数据（`data/opc.db`，SQLite）：

- **Web 应用**（左侧导航切换模块）：
  - **驾驶舱首页**（`#/`）：执行入口。今日读数（进行中/待审核/待领取/逾期/今日完成）、待你处理（一键验收、逾期告警）、下一步建议、进行中战场（带最新进度）、AI 领取队列、运行日志。
  - **任务看板**（`#/board`）：五列（待规划 / 待领取 / 进行中 / 待审核 / 已完成）、拖拽换列、任务详情抽屉、搜索与过滤、右侧运行日志实时滚动。
- **`opc` CLI**（给 AI 和终端用）：

```bash
./opc add "任务标题" -d "描述" -p P1 --project cockpit   # 建任务
./opc list -s todo                                      # 看可领取的
./opc claim --model claude-fable-5                      # 领取优先级最高的任务（Agent 上报模型名）
./opc progress T-3 "进展说明"                            # 汇报进度
./opc done T-3 -m "交付摘要"                             # Agent 完成 → 进入待审核
./opc show T-3                                          # 详情 + 全部动态
./opc move T-3 todo                                     # 改状态（移回 todo 自动释放认领）
```

关键机制：

- **领取语义**：`claim` = 认领 + 进入「进行中」，有冲突检测（别人领的抢不走）。
- **审核台雏形**：AI `done` 默认进「待审核」，人在看板点「验收通过」才算完成——所有自动化可确认。
- **活动日志**：谁、何时、做了什么全部入账，看板右侧实时可见。
- **身份识别**：Claude Code 会话自动识别为 `claude`，多 Agent 用 `--as` 区分；领取时记录工具名（自动识别）和模型名（`--model` 上报），看板卡片、抽屉、运行日志都能看到是哪个 AI 在干活。

AI 的详细工作协议见 [CLAUDE.md](CLAUDE.md)。开发模式 `npm run dev`（前端热更新在 :5173）。

## 核心文档

- [产品讨论整理](docs/product-brief.md)
- [调研模块设计](docs/research-module.md)
- [MVP 路线](docs/mvp-roadmap.md)

