# 八爪鱼 RPA 触发器 → 日程仪表盘

抓取八爪鱼 RPA 企业管理台的机器人触发器，按机器人整理执行时刻表，并生成本地可视化仪表盘。

## 一键更新

**双击 `E:\bazhuayu_crawler\update.bat`**，自动执行三步：

```
1. 抓取      crawler.py    登录并拉取全部触发器 → output/triggers_normalized.csv
2. 整理      organize.py   按机器人整理时刻表 → output/schedule_all.md / .xlsx / .csv
3. 仪表盘    dashboard.py  生成 ECharts 可视化 → output/dashboard.html
```

产出：
- `output\dashboard.html` —— **日程仪表盘**（浏览器打开）
  - 每周视图：周一~周日 × 时刻，展示每天/每周循环任务
  - 每月视图：当月有任务的日期 × 时刻，展示每月循环任务
  - 同一时刻同一应用合并为横向长条；按应用配色、格内显示应用短名
  - 筛选：视图（每周/每月）、机器人（全部/所有硕晞/所有宝实/单台）、状态（启用/停用/全部）
  - 红色十字线 = 当前时刻与今天（10 秒刷新）
- `output\schedule_all.md / .xlsx` —— 表格形式时刻表（Excel 每机器人一个 Sheet）

## 手动执行

```bash
python crawler.py --config config.json --out output
python organize.py --input output\triggers_normalized.csv --out output
python dashboard.py --input output\triggers_normalized.csv --out output
```

## 配置（config.json）

| 字段 | 说明 |
|---|---|
| `account.username / password` | 八爪鱼 RPA 登录邮箱/手机号 + 密码（自动登录，会话缓存到 output\session.json） |
| `enterprise_id` | 指定企业 ID（留空自动选第一个非个人账号的企业） |
| `cookie` | 备用：浏览器登录后 F12 → `document.cookie` 填入 |
| `include_robots` | 只保留名称以这些前缀开头的机器人（如 `["A","B"]`） |
| `exclude_robots` | 排除名称含这些关键词的机器人（如 `["白桦"]`） |
