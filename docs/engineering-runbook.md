# 工程运行手册（F0-1a）

> 执行纪律文档：门禁有效的前提是执行环境干净。本手册把历次偶发失败的
> 教训固化为流程，不涉及产品逻辑变更。

## 1. live-dev 互斥（AGENTS §7.4）

- 用户 live-dev（`bun --watch`／Vite HMR／`bun tauri dev`）运行时，
  保存 `apps/*/src/**` 必先声明（watch 重载掐流），分批小步保存，
  任务报告写明保存时间窗。
- `tsc -b` emit、`dist` 触碰不触发重载（已证伪杀流说），但仍建议错峰。
- Agent 常驻命令（test:all、E2E、探针）跑完确认进程退出，禁 detached runner。

## 2. 门禁执行顺序（固定）

1. scoped 相关单测 → 2. `bunx tsc -b --force` → 3. `git diff --check` →
   4. `bun run test:all`（全程 tee 留日志）→ 5. web build → 6. frozen。
2. 失败捕获：`tee <log> | Select-String -Pattern '^\(fail\)'`，首轮失败名
   必须落盘，禁止“重跑绿了就不管”——未捕获名的失败沿观测项记录。
3. 偶发单失败（首跑挂、重跑绿）处理：先查同期 live-dev 是否在跑、
   再看 Windows 文件锁／PDF native 耗时，最后才怀疑用例本身。

## 3. 孤儿进程检查（收尾必做）

- `tasklist /FI "IMAGENAME eq bun.exe"` 核对：只剩已知 live-dev 即正常；
  无名常驻、CPU 累计异常即孤儿，按 AGENTS §7 一键清理流程处理，
  **禁止盲 kill**（先对端口＋命令行＋启动时间）。
- 临时探针脚本跑完即删；Temp 日志注明批次前缀（如 `p31-`）。

## 4. 基线核对流程（实现批次前后各一次）

1. `git log --oneline -1` 记 HEAD；
2. `git status --porcelain` 与 owner 集（8M＋`domain/` 单文件＋`output/`）逐项比对，
   多一行即停；
3. 常驻进程列表记录；
4. 计划卡回写（gitignored `.plan/`，实现零改动也须留痕）。
