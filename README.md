

# 八爪鱼 RPA 触发器 & 运行记录仪表盘

抓取八爪鱼 RPA 企业管理台的机器人触发器和运行记录，本地可视化三张页面：

- **触发器日程**（`schedule.html`）：触发器每周/每月循环任务时刻表
- **运行记录**（`timeline.html`）：每台机器人的真实运行记录（手动 / 定时 / Webhook），排队与执行两段彩色区分
- **运行分析**（`analysis.html`）：概览指标、触发/状态分布、星期×小时热力图、各机器人排队与负载、失败看板

## 一键启动

**双击 `E:\bazhuayu_crawler\start_server.bat`**，自动完成三步并启动局域网服务器（端口 `8000`）：

```
1. 抓取      crawler.py    触发器 + 运行记录 → output/triggers_normalized.csv / runs_normalized.csv
2. 整理      organize.py   按机器人整理时刻表 → output/schedule_all.md / .xlsx / .csv
3. 仪表盘    dashboard.py  生成三张页面 → output/schedule.html / timeline.html / analysis.html
4. 局域网服务器 local_server.py  端口 8000（本机 http://localhost:8000 即可访问）
```

启动横幅会输出本机局域网 IP，其他电脑用 `http://<本机IP>:8000` 访问；关窗即停止。

## 三张页面

### 触发器日程 `schedule.html`
- 周视图 / 月视图切换
- 筛选：视图（每周/每月）、机器人（按名称前缀）、状态（启用/停用/全部）
- 按应用配色（12 色浅色调）
- 红色十字线 = 当前时刻（10 秒刷新）

### 运行记录 `timeline.html`
- **竖轴 = 机器人**（按 `include_robots` 过滤的机器人；同一机器人时间重叠的记录自动分多行泳道堆叠）
- **横轴 = 时间**，内容随时间缓慢左移
- **数据拆分**：每条记录按"排队（蓝）→ 执行（状态色）"两段彩色区分；同一机器人时间重叠的记录自动分多行泳道堆叠
- **时间窗口**：30 分钟 ~ 7 天
- **触发方式**：全部 / 手动 / 定时触发器 / Webhook
- **自动更新**：勾选后网页每 60 秒向服务器请求一次新数据（服务器 60 秒内去重，避免重复爬取）
- 滚轮：向下 = 向未来（最多到"现在"），向上 = 向过去
- 双击图表：恢复实时跟随
- 块颜色（浅色）：已完成绿、运行中橙、排队蓝、失败红、已停止灰
- 标题下小字：数据获取时间（精确到秒）

### 运行分析 analysis.html
- 概览指标卡：总运行数、成功率、失败数、运行中、平均排队/运行、最长单次、并发峰值
- 触发方式分布、状态分布 两个饼图
- 星期 × 小时 热力图（找出运行高峰时段）
- 各机器人平均排队时长条形图 + 机器人负载榜
- 失败记录看板，支持「导出失败记录 CSV」
- 自动更新开关；三页导航互通

## 数据更新机制（无需 Windows 任务计划）

服务器内置后台调度 + 网页触发混合模式：

| 调度 | 频率 | 内容 |
|---|---|---|
| 网页自动更新 | 每 60 秒（可选） | 网页勾选后向服务器请求 `/api/refresh`；服务器 60 秒内去重直接返回 |
| 每日完整更新 | 每天 12:00 | 抓取触发器、整理、生成三张页面 |

只需打开 `start_server.bat`，让浏览器保持页面打开即可持续自动更新运行记录。

## 手动执行

```bash
python crawler.py --config config.json --out output
python crawler.py --config config.json --out output --only-runs --days 7   # 仅快速刷新运行记录
python organize.py --input output\triggers_normalized.csv --out output
python dashboard.py --input output\triggers_normalized.csv --out output       # 同时生成三张页面
python dashboard.py --input output\triggers_normalized.csv --out output --only-gantt   # 仅重新生成时间轴与分析页
python local_server.py   # 仅启动服务器（不更新）
```

## 配置（`config.json`）

> ⚠️ `config.json` 含登录凭据，已在 `.gitignore` 中排除；首次使用请复制 `config.example.json` 为 `config.json` 并填入。

| 字段 | 说明 |
|---|---|
| `account.username / password` | 八爪鱼 RPA 登录邮箱/手机号 + 密码（自动登录，会话缓存到 `output/session.json`） |
| `cookie` | 备用：浏览器登录后 F12 → `document.cookie` 填入 |
| `enterprise_id` | 可选：指定企业 ID；留空则默认选账号下第一个非个人企业 |
| `include_robots` | 只保留名称以这些前缀开头的机器人（如 `["A", "B"]` 或 `["A🍩硕晞-", "B💎宝实-"]`） |
| `exclude_robots` | 排除名称含这些关键词的机器人（如 `["测试"]`） |

> **登录态过期自动恢复**：会话缓存到 `output/session.json`，过期后 `crawler.py` 会先验证缓存会话是否有效，失效则自动删除并改用 `account` 的账号密码重新登录（因此请务必在 `config.json` 中填好账号密码，而不仅依赖 cookie）。`local_server.py` 的 `/api/refresh` 在刷新失败时会如实返回 `ok=false`，网页顶部会提示"刷新失败，登录态可能已过期"。

## 项目结构

```
bazhuayu_crawler/
├── crawler.py              # 抓取触发器 + 运行记录
├── dashboard.py            # 生成三张页面
├── local_server.py         # 局域网 HTTP 服务器（端口 8000）
├── organize.py             # 按机器人整理时刻表
├── start_server.bat        # 一键：更新 + 启动服务器（双击）
├── config.example.json     # 配置模板
├── assets/echarts.min.js   # ECharts（内联，部署不需外网）
├── requirements.txt
└── output/                 # 抓取结果 + 仪表盘（git 忽略）
```