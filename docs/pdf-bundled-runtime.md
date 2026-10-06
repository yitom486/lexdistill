# PDF 组件的构建与交付

PDF 解析包、对应平台原生绑定和 PDFium 随 Tauri 安装包交付。用户首次导入时不下载组件；运行时缺失或版本不匹配直接提示重新安装完整应用。

- `bun run build:sidecar` 在编译后端前准备 `apps/desktop/src-tauri/resources/pdf-runtime/`；下载地址、固定版本和摘要统一在 `pdf-artifacts.ts` 维护。下载、校验或加载失败会阻断构建。
- Tauri 的构建钩子执行后端构建和前端构建，并将上述目录映射到安装资源目录下的 `pdf-runtime/`。资源内保留 JS 包、原生绑定、PDFium 和版本清单。
- 桌面壳用 Tauri 的 `resource_dir()` 定位资源，将路径通过 `STUDY_STUDIO_PDF_RUNTIME_DIR` 传给后端；不依赖开发机绝对路径。
- 运行时只读加载安装资源。用户媒体和教材切片继续使用独立的可写数据目录 `STUDY_STUDIO_RUNTIME_DIR`，不会写入安装目录。

开发时可运行 `bun run --filter @study-studio/gateway pdf:prepare` 显式准备组件；桌面开发钩子也会执行准备。构建资源为生成产物，不提交到仓库。

原生测试前运行 `bun run --filter @study-studio/gateway pdf:prepare:test`，可用 `STUDY_STUDIO_TEST_RUNTIME_DIR` 指定测试拥有的目录。测试期间只读加载，不隐式联网、不使用用户生产缓存。下载错误、摘要校验、断网加载等行为使用受控响应测试；真实原生测试仍直接执行 PDF 解析和 PNG 渲染。

目前原有清单没有 macOS Intel 的构件登记，Linux ARM64 的 PDFium 摘要也尚未登记。这些平台会在构建准备阶段失败，不能作为已完成的交付目标。Windows x64、Linux x64、macOS ARM64 已有固定构件登记；各平台安装包仍需在干净环境验收。
