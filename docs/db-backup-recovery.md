# 整库备份与恢复演练手册（P5-1）

> 范围：SQLite 文件快照导出（`repo.exportDatabaseSnapshot`）＋手工恢复演练。
> 不含：自动恢复、VACUUM、云同步（均不在本批）。

## 1. 备份语义

- `exportDatabaseSnapshot(targetPath)`：WAL 检查点 → 主库文件拷贝 →
  只读打开校验（`integrity_check`＋migrations 表）→ 同目录 tmp 经原子
  rename 落盘。源库只读不锁业务；目标已存在则原子覆盖。
- 忙时行为：检查点遇忙返回可重试错误（`E_DB_BUSY`，`retryable: true`），
  不产生半成品。
- 非目标：内存库（`:memory:`）拒绝；损坏源拒绝；非法路径在任何 IO 前拒绝。

## 2. 桌面集成契约（owner 侧，待接线）

- 保存对话框确认 → 调 `repo.exportDatabaseSnapshot(targetPath)`；
  用户取消 → **不调用**（零副作用由“非法路径先验”保证，单测锁定）。
- 覆盖确认由 UI 负责；网关侧允许原子覆盖。
- 进度：拷贝为单次系统调用，无进度回调；大库（>500MB）建议在空闲时执行。

## 3. 恢复演练（手工步骤）

1. 停网关：确认 3000/8080 无监听（`bun run dev:clean` 只读列出），
   备份文件先单独再做一次 `integrity_check`（`sqlite3 backup.db
   "PRAGMA integrity_check;"` 须回 `ok`）。
2. 隔离恢复（禁直接覆盖生产库）：把备份拷到临时路径，以
   `STUDY_STUDIO_DB=<tmp>` 启动网关，确认 `/api/health` 200 且
   `bootId` 变化；抽查文档／卡片／计划三类读口。
3. 迁移重放：旧备份启动即自动 `runMigrations`（幂等）；观察启动日志
   无 migration 报错；`schema_migrations` 版本连续。
4. 种子校验：启动后内置课程行数与线上一致（doctor 相关规则 PASS）。
5. 切回：停网关 → 原子替换生产库文件 → 重启 → 复验 2。
6. 回滚：替换前对生产库同样做一次快照；恢复失败用该快照重复 2–5。

## 4. 已知限制

- 快照是检查点时刻一致性，不含检查点后 WAL 增量（秒级窗口）。
- 恢复为全库替换，无表级合并；多端写场景先停服再恢复。
