# OPC Cockpit

一人公司驾驶舱。当前已实现：驾驶舱首页 + 任务看板 + 知识库 + 调研（Web UI + `opc` CLI + SQLite），AI Agent 是一等公民工作者。

## 命令

- `npm run dev` — 开发模式（API :5177 + Vite :5173，改前端访问 5173；5177 避开常驻正式服的 5175）
- `npm run build` — 构建 server/CLI/前端（改完代码必须重新 build，`./opc` 跑的是 dist）
- `npm start` — 生产模式，单进程跑在 http://localhost:5175

## 结构

- `src/shared/` — 类型、SQLite（node:sqlite，零原生依赖）、任务操作逻辑（server 与 CLI 共用）
- `src/server/` — Hono API + 伺服看板静态文件
- `src/cli/` — `opc` 命令行
- `web/src/` — React UI，hash 路由：`#/` 驾驶舱首页（pages/Home）、`#/board` 任务看板（pages/Board）、`#/projects` 项目中心（pages/Projects）、`#/kb` 知识库（pages/Knowledge）、`#/research` 调研（pages/Research）；App.tsx 持有共享状态（轮询/抽屉/新建弹窗），新模块加页面 + NavRail 项即可
- 数据在 `data/opc.db`（gitignored），可用 `OPC_DB` 环境变量指定；调研截图等附件存同目录的 `files/`，server 经 `/files/<文件名>` 伺服

## 任务看板协议（AI 必读）

你在这个仓库工作时，用 `./opc` 领取和反馈任务。身份自动识别为 `claude`（多 Agent 场景用 `--as <名字>` 区分）。

**工作循环：**

```bash
./opc list -s todo        # 看有什么可领（或 ./opc next 看下一个）
./opc claim --model <你的模型ID>        # 自动领取：优先当前项目、本项目无可领则全局按优先级兜底（会打印完整描述和历史动态）
./opc claim T-3 --model <你的模型ID>    # 或领取指定任务
./opc progress T-3 "完成了 schema 设计，开始写 API"   # 干活期间随时汇报
./opc attach T-3 /tmp/preview.png --label "改版后效果" --model <你的模型ID>   # 挂附件图（设计图/预览图/截图；--url 挂网络图，不带参数列出，--rm <id> 删）
./opc done T-3 -m "交付摘要：改了哪些文件、怎么验证的"  # 提交 → 进入「待审核」等用户确认
```

**前置依赖（多 Agent 并发的护栏）：** 任务可以声明前置任务，全部前置 `done`（用户验收过）之前不可领取——`claim`/`next` 自动跳过被阻塞任务，指定领取会被拒并列出未完成前置。这让多个 Agent 可以安全并发：有先后关系的任务串行，无关任务各领各的。

```bash
./opc add "写 API" --after T-10        # 建任务时声明前置（逗号分隔多个）
./opc dep T-12                         # 查看依赖：前置任务 + 后续任务
./opc dep T-12 --on T-10 --rm T-9      # 添加/移除前置（自动拒绝成环）
./opc done T-10 -m "…"                 # 完成后会提示解锁了哪些后续任务
```

**规则：**

1. 领取时上报身份：`--model` 传你自己的真实模型 ID（如 `claude-fable-5`，从你的系统提示可知；`ANTHROPIC_MODEL` 环境变量可能是代理配置，不可信）。工具名自动识别（claude-code / cursor / codex 等），特殊环境用 `--tool` 覆盖。
2. 领取前先读任务描述和动态（`opc show T-3`），那是你的上下文包。
3. 进度汇报写实质内容（做了什么、产出在哪、卡在哪），不要写"正在进行中"。描述和评论支持 Markdown（列表/代码块/表格/任务清单），看板上会渲染。改 UI/出图的任务，交付前用 `opc attach` 挂预览截图，用户在看板上直接看图验收；领任务时先 `opc show` 看有没有已挂的设计图（那是视觉验收标准）。
4. `done` 必须带 `-m` 交付摘要。Agent 完成默认进「待审核」，用户在看板上验收；不要用 `--skip-review`，除非用户明确说过。
5. 做不了/不该你做的任务：`opc comment T-3 "原因"` 然后 `opc move T-3 todo` 释放（移回 todo 会自动解除认领并清空工具/模型记录）。
6. 发现新工作可以 `opc add "标题" -d "描述" --project xxx --model <你的模型ID>` 登记，而不是顺手做掉。加 `--model` 会记录创建者（模型·工具，如 `claude-fable-5 · claude-code`），让看板能区分是谁建的任务；工具名自动识别。不带 `--project` 会从当前 git 仓库自动识别项目名（worktree 解析到主仓库名），项目自动建档。
7. 把大工作拆成多个任务时**必须标依赖**：B 用到 A 的产出、或 B 和 A 改同一块代码，就 `--after T-A`；互不相干的任务不要标，留给其他 Agent 并行领取。你被 claim 拒绝（任务被阻塞）时不要硬做，换 `./opc claim` 自动领别的。
8. 项目是一等实体：`opc projects` 看全局，`opc project <名>` 看详情。完成大块工作后顺手更新项目状态：`opc project <名> --next "下一步" [--blockers "阻塞"]`，让项目卡片始终反映真实进展。
9. 程序化读取加 `--json`。

## 知识库协议（AI 必读）

知识库沉淀执行中的经验，`opc claim` / `opc show` 会自动带出同项目 + 通用的相关知识——那是前人（包括过去的你）踩过的坑，动手前先扫一眼，命中了用 `opc kb show K-3` 看全文。

三类条目：`issue` 未决问题、`knowledge` 搜到的资料/结论、`pitfall` 踩过并有结论的坑。

```bash
./opc kb add "vite 代理 ws 断连不会自动重连" -d "现象/原因/解法…" --type pitfall --task T-3 --model <你的模型ID>
./opc kb add "node:sqlite 自带 FTS5 但中文分词不可用" --type knowledge --url https://... --global
./opc kb search 代理          # 全文搜索；kb list / kb show / kb edit / kb rm 同理
```

**什么值得记：** 非显而易见的问题及其解法（下次还会遇到）、搜了半天才找到的关键资料（带 `--url`）、试错才发现的约束或陷阱。显而易见的、只对当前任务有意义的不要记。
**怎么记：** 标题一句话说清；正文写现象 → 原因 → 解法（支持 Markdown）；跨项目通用的加 `--global`，否则默认挂当前项目；正在做任务时加 `--task T-x` 关联（会在任务动态留痕）；AI 记录时带 `--model`。`issue` 解决后用 `opc kb edit K-x --type pitfall -d "补充结论"` 转成坑。

## 调研协议（AI 必读）

调研模块（`opc research`，别名 `rs`）是把不确定问题变成可执行判断的工作台：**研究问题 → 资料池（链接/截图/摘要）→ 结论 → 沉淀到知识库**。接到调研类任务（找参考、竞品对比、方案比较…）时用它承载过程，而不是只在任务评论里贴长文。

```bash
./opc research add "绚丽特效塔防参考" -d "找 10 个以上…每个记录链接/截图/爽点" --task T-3 --model <你的模型ID>
./opc research show R-1                # 领任务后先看研究问题和已有资料（那是验收标准）
./opc research item R-1 "Kingdom Rush" --url https://... --image-url https://.../header.jpg \
    -d "**爽点**：弹道拖尾+命中爆闪…" --tags 塔防 --rating 4 --model <你的模型ID>
./opc research item R-1 "本地截图" --image /tmp/shot.png -d "…"   # 浏览器截的图走本地文件
./opc research conclude R-1 -m "## 总结\n…"    # 收集完写综合结论 → 状态「已有结论」
./opc research distill R-1                     # 结论沉淀为知识库条目并归档（值得长期复用时）
./opc research list / edit / edit-item / rm-item / rm             # 其余同 kb 直觉
```

**怎么用好：** 一张资料卡 = 一个对象（游戏/文章/方案），标题写名字，`-d` 写摘要和分析（支持 Markdown），链接和截图尽量都带；`--rating` 标出最值得参考的（distill 时 4 星以上进精选）；一次调研里多类对象用 `--tags` 分组（如 `塔防` / `幸存者like`）。研究问题里写了数量要求（如「10 个以上」）就按要求凑满再收口。截图优先 `--image-url` 抓官方图；自己截图存本地再 `--image`。**图和游戏必须对上**——不确定的宁可不带图。

用户在看板 UI（http://localhost:5175）上看到你的一切操作——运行日志实时滚动。
