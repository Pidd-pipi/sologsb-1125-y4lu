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
| `/samples/new` | 样本登记：编号生成、分类化学群、重量、存放位置，可补录发现地坐标并即时校验 | MeteoriteSample、FindRecord |
| `/samples/:id` | 样本详情：基本信息 + 发现地摘要 + 切片列表 + 分析记录，可就地新增/改重量 | 四个模型 |
| `/sections` | 切片库：按厚度与矿物占比筛选，回跳样本，批量标注质量 | ThinSection、MeteoriteSample |
| `/analysis` | 分析检测：录入 Fa / Fs / Ni / 铁纹石带宽，实时分类建议与阈值命中说明 | AnalysisRecord、MeteoriteSample |
| `/locations` | 发现地分布：SVG 网格按经纬度打点、按分类着色、点选弹出样本清单 | FindRecord、MeteoriteSample |
| `/sync` | 离线样本包对账：导入/导出样本包、冲突裁决、失败包改柜位重量重试、柜架占用 | 全部模型 + Conflict/ImportBatch |

## 数据模型（`src/types/` 独立文件）

- `types/sample.ts` — **MeteoriteSample**：id、样本编号、总重量 g、分类、化学群、风化等级 W0–W4、发现/坠落、存放位置、**版本戳 version**、待裁决标记 pendingConflict/conflictId
- `types/find.ts` — **FindRecord**：id、关联样本、地名、国家地区、经纬度、坐标来源（GPS/文献）、发现环境、发现者、**跟随版本 sampleVersion**
- `types/section.ts` — **ThinSection**：id、切片编号、关联样本、厚度 μm、制样方式、矿物占比、显微照片清单、**跟随版本 sampleVersion**
- `types/analysis.ts` — **AnalysisRecord**：id、关联样本或切片、方法、橄榄石 Fa、辉石 Fs、Ni wt%、铁纹石带宽 mm、检测日期、**跟随版本 sampleVersion**
- `types/sync.ts` — **SamplePackage / ConflictRecord / ImportBatch**：离线样本包、对账冲突单、失败包（含合并计划类型）

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
        ├── components/common/{SampleCard,Badge,FieldGroup,EmptyState,CoordinatePicker,AppShell}.tsx
        ├── hooks/{useSampleFilter,useLocalDraft,useRegionStats}.ts
        ├── pages/{Overview,New,Detail,Sections,Analysis,Locations,Sync}.tsx
        ├── router/index.tsx
        ├── scripts/check-{sync,store,migration}.ts  # 对账/存储/迁移逻辑检查（fake-indexeddb）
        └── utils/{classify,format,geo,sync,occupancy,advice,station}.ts
```

## 数据存储说明

- **库名**：`gbmeteorite-db`；表：`samples`、`finds`、`sections`、`analysis`、`conflicts`、`importBatches`
- **版本迁移**：
  - v1 建 `samples` / `finds` / `sections`
  - v2 新增 `analysis` 表并加 `sampleId` 索引
  - v3 为 `samples` 补 `updatedAt` 字段并按 id 回填旧记录
  - v4 离线对账：`samples` 加 `version/pendingConflict/conflictId` 索引，新增 `conflicts`（冲突单）与 `importBatches`（失败包）；**旧数据没有版本戳的按初次入库统一补 version=1 / sampleVersion=1**
- **版本戳规则**：样本重量（及分类实质字段）一变 `version` 单调 +1；切片 / 分析 / 发现地带 `sampleVersion` 跟随所属样本。重量变更后旧版本上的切片与分析在 UI 立即标记「旧版本·待重算」，分类建议始终按当前值实时重算，柜架占用即时重算
- **离线包对账**（`/sync`，`utils/sync.ts` 纯函数 + `sampleStore` 事务执行）：
  - 按「样本编号 + 版本戳」对账：**单边新增直接并库**（子记录跨机 id 重签、按自然键去重，本机刚补的切片/分析不会被跳过）
  - 同编号同版本戳：保留本机，仅补本机没有的切片/分析/发现地；版本戳不同但重量/发现地/柜位一致：跟进高版本（fast-forward）
  - **同编号重量、发现地或存放位置不一致：两条都挂 pendingConflict 待裁决，样本总览与发现地地图暂不显示**，裁决通过方恢复
  - **柜架容量**（cabinet-a 20kg / cabinet-b 15kg / desiccator 5kg / loan-out 不限，见 `STORAGE_CAPACITY_GRAMS`）：容量不足时整包拒绝入库并保留原柜位，失败包落 `importBatches`，可逐份改柜位/重量或重新上传后重试
  - **并发裁决**：事务内复核冲突状态，两个标签页同时确认时后确认页抛 `StaleConflictError`，**保留页面草稿、提示重载，不覆盖先确认结果**；BroadcastChannel（`gbmeteorite-catalog`）跨页同步
  - 导出（`kind=gbmeteorite-sample-package`）不含待裁决副本
- **草稿**：`/samples/new` 与 `/analysis` 的表单草稿写入 localStorage（键前缀 `gbmeteorite:draft:`），切页自动恢复，提交后清理；`/sync` 失败包修正与裁决草稿同样在页面保留
- 首次打开会灌入 3 份演示样本、2 条发现记录、2 张切片与 2 条检测记录，便于直接体验筛选与打点
- **逻辑自检**（无需浏览器，fake-indexeddb）：`npm run check:sync`（对账纯逻辑 20 项）、`npm run check:store`（事务/容量/并发裁决 37 项）、`npm run check:migration`（v3→v4 补戳迁移 9 项）

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `gbmeteorite` | Compose 项目名与容器名前缀 |
| `FRONTEND_PORT` | `21825` | 宿主端口，映射到容器 80 |
