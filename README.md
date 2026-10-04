# 陨石样本编目台（sologsb-1125 / gbmeteorite）

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21825>

停止（镜像保留）：

```bash
docker compose down
```

## 项目简介

面向陨石收藏者与标本室的纯前端单页应用：把样本、发现记录、切片制样与检测数值整理成本地可检索档案。
核心动作是登记样本与发现地坐标、挂接切片、录入电子探针数值并给出分类建议。

- 纯前端 SPA：**无后端、无数据库服务、无外部 API**
- 所有数据保存在浏览器本地：业务数据走 **IndexedDB（Dexie，库名 `gbmeteorite-db`）**，表单草稿走 **localStorage**
- 容器无状态，不挂载任何命名卷；换浏览器即换档案库

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript 5.7 |
| 构建 | Vite 6（`build` 脚本为 `tsc -b && vite build`，类型检查零错误） |
| UI 组件库 | MUI（@mui/material 6 + @mui/icons-material） |
| 状态管理 | Zustand（`sampleStore` 业务数据 / `uiStore` 筛选与提示） |
| 路由 | React Router 6（BrowserRouter + nginx `try_files` 兜底） |
| 本地存储 | Dexie 4（IndexedDB）+ localStorage（草稿） |
| 部署 | 多阶段 Dockerfile：node:20-alpine 构建 → nginx:alpine 托管 |

## 核心页面

| 路由 | 说明 | 消费模型 |
| --- | --- | --- |
| `/` | 样本总览：卡片流 + 分类/化学群/重量区间筛选与排序，缺坐标或缺切片显示角标 | MeteoriteSample |
| `/samples/new` | 样本登记：编号生成、分类化学群、重量、存放位置，可补录发现地坐标并即时校验；实时柜架占用 | MeteoriteSample、FindRecord |
| `/samples/:id` | 样本详情：基本信息 + 发现地摘要 + 切片列表 + 分析记录，可就地新增 | 四个模型 |
| `/sections` | 切片库：按厚度与矿物占比筛选，回跳样本，批量标注质量 | ThinSection、MeteoriteSample |
| `/analysis` | 分析检测：录入 Fa / Fs / Ni / 铁纹石带宽，实时分类建议与阈值命中说明 | AnalysisRecord、MeteoriteSample |
| `/locations` | 发现地分布：SVG 网格按经纬度打点、按分类着色、点选弹出样本清单 | FindRecord、MeteoriteSample |
| `/sync` | 离线样本包对账：导入/导出样本包、冲突裁决、失败包重试、柜架占用 | 四个模型 + ConflictRecord / ImportFailure |
| `/sync/conflicts/:id` | 冲突裁决：左右对比本机与包内两条记录，二选一落档 | ConflictRecord + 四个模型 |

## 数据模型（`src/types/` 独立文件）

- `types/sample.ts` — **MeteoriteSample**：id、样本编号、总重量 g、分类、化学群、风化等级 W0–W4、发现/坠落、存放位置、**版本戳 version / 在档状态 status / 分类建议快照 adviceSnapshot / 柜架占用快照 occupancySnapshot**
- `types/find.ts` — **FindRecord**：id、关联样本、地名、国家地区、经纬度、坐标来源（GPS/文献）、发现环境、发现者、**sampleVersion（跟随样本版本）/ status**
- `types/section.ts` — **ThinSection**：id、切片编号、关联样本、厚度 μm、制样方式、矿物占比、显微照片清单、**sampleVersion**
- `types/analysis.ts` — **AnalysisRecord**：id、关联样本或切片、方法、橄榄石 Fa、辉石 Fs、Ni wt%、铁纹石带宽 mm、检测日期、**sampleVersion**
- `types/sync.ts` — **SamplePackage / ConflictRecord / ImportFailure**：离线样本包、冲突单、失败包

## 目录结构

```
sologsb-1125/
├── docker-compose.yml
├── .env / .env.example
├── README.md
└── frontend/
    ├── Dockerfile          # 多阶段：node:20-alpine → nginx:alpine
    ├── nginx.conf          # try_files + gzip
    ├── index.html
    ├── package.json
    ├── tsconfig*.json
    ├── vite.config.ts
    ├── public/favicon.svg
    └── src/
        ├── types/{sample,find,section,analysis,sync}.ts
        ├── db/index.ts                 # Dexie 封装与 v1→v4 升级迁移
        ├── stores/{sampleStore,uiStore}.ts
        ├── components/common/{SampleCard,Badge,FieldGroup,EmptyState,CoordinatePicker,OccupancyPanel,AppShell}.tsx
        ├── hooks/{useSampleFilter,useLocalDraft,useRegionStats}.ts
        ├── pages/{Overview,New,Detail,Sections,Analysis,Locations,Sync,ConflictDetail}.tsx
        ├── router/index.tsx
        └── utils/{classify,format,geo,capacity,package,reconcile,session,syncBus}.ts
```

## 数据存储说明

- **库名**：`gbmeteorite-db`；表：`samples`、`finds`、`sections`、`analysis`、`conflicts`、`importFailures`
- **版本迁移**：
  - v1 建 `samples` / `finds` / `sections`
  - v2 新增 `analysis` 表并加 `sampleId` 索引
  - v3 为 `samples` 补 `updatedAt` 字段并按 id 回填旧记录
  - v4 离线样本包对账：`samples` 补 `version/status/conflictId`，新增 `conflicts` / `importFailures`；**旧数据没有版本戳的按初次入库补齐**（样本 version=1、status=active，find/section/analysis 补 sampleVersion=1）
- **草稿**：`/samples/new` 与 `/analysis` 的表单草稿写入 localStorage（键前缀 `gbmeteorite:draft:`），切页自动恢复，提交后清理；冲突裁决选择草稿键为 `gbmeteorite:conflict-draft:<id>`
- 首次打开会灌入 3 份演示样本、2 条发现记录、2 张切片与 2 条检测记录，便于直接体验筛选与打点

### 离线样本包对账规则（`/sync`，`src/utils/reconcile.ts`）

样本包为 JSON（`format = gbmeteorite-package`，子记录以 `refId` 指向包内样本）。按**样本编号 + 版本戳**对账：

1. **单边新增直接并库**：样本、发现地、切片、分析一并入库；切片按切片编号、分析按方法+日期+数值自然键去重，**本机刚补的切片与分析不会被跳过，也不会被覆盖**。
2. **同编号且重量 / 发现地 / 存放位置不一致**：本机在档与包内副本**都转为 `pending` 待裁决**，写一条 `ConflictRecord`；裁决前两条样本（含切片、分析、发现地）**不出现在样本总览与发现地地图**，也不占柜架。
3. **切片与分析跟随所属样本版本戳**（`sampleVersion`）。样本**重量一变**，版本戳 +1，`adviceSnapshot`（分类建议）与 `occupancySnapshot`（柜架占用）**立即失效重算**，子记录版本戳跟随。
4. **容量校验**（`STORAGE_CAPACITY`：A 柜 10000 g / B 柜 12000 g / 干燥器 2000 g / 外借不计）：入库、改放、裁决落位前校验；**容量不足拒绝入库并保留原柜位**，失败条目写入 `importFailures`，可改放柜位后**修正重试**；整包非法记 `invalid-package`。
5. **并发裁决**：裁决在单个 Dexie 事务内读冲突单状态，已 resolved 即抛 `ConflictStaleError`；**两个标签页同时确认同一冲突时，后确认的一页保留裁决草稿（localStorage）并提示重载，不覆盖先确认结果**。跨页通过 BroadcastChannel（隐私环境降级 storage 事件）刷新。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `gbmeteorite` | Compose 项目名与容器名前缀 |
| `FRONTEND_PORT` | `21825` | 宿主端口，映射到容器 80 |
