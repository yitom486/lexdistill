# PDF fixture 生成器（测试资产，非产品代码）

本目录脚本用于生成 `../` 下的测试 PDF（git 追踪的二进制 fixture）。
重跑必须字节一致（CI  diff 干净），靠 `gen-common.ts` 固定 CreationDate/ModDate/trailer ID 实现。

## 依赖（devDependencies，apps/gateway）

- `pdf-lib`：PDF 组装 + CJK 子集嵌入
- `fontkit@1.x`：子集化后端（注意：2.x API 对不上，`encodeStream` 缺失，必须锁 1.x；
  另须 `Buffer.from(...)` 喂字体，裸 Uint8Array 会 `Unknown font format`）

## 字体

`NotoSansJP.ttf`（fontsource 日文子集，OFL 授权，来源：
`https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-jp@latest/japanese-400-normal.ttf`）。
子集嵌入后单个 fixture 仅 ~16KB，字体本体 2.3MB 随仓库走（`.gitattributes` 已钉 `*.ttf binary`）。

## 用法（apps/gateway 下）

```sh
bun src/modules/library/__tests__/fixtures/gen/gen-rich-textbook.ts
bun src/modules/library/__tests__/fixtures/gen/gen-scanned-shapes.ts
bun src/modules/library/__tests__/fixtures/gen/gen-scanned-lesson-dialect.ts
```

## fixtures 一览

| 文件 | 页 | 覆盖 |
|---|---|---|
| `smoke-native-2lessons.pdf` | 2 | 外部输入（output/ 拷贝）：无文本层（转曲）→ thin-page OCR 回填 |
| `rich-textbook-toc-review.pdf` | 5 | 本脚本生成：TOC（点线/J1/J2前置/復習/付録）+ 第1課（含前言）+ 第2課 + 復習A + 付録 |
| `scanned-shapes-no-text.pdf` | 1 | 本脚本生成：纯形状无字页 → OCR 路由 + 零产出友好失败 |
| `scanned-lesson-dialect.pdf` | 3 | 本脚本生成：无文字层扫描课结构（第1課/会話/自撰对话/練習A噪声/第2課/復習A42，全页位图 + fontkit 光栅化）→ 本地 OCR 切课 |

改了生成器必须重跑 + 跑 tag 验证（apps/gateway 下）：

```sh
bun test pdf-import --path-ignore-patterns "**/dist/**"
```

注意：`bun test` 加 filter 会绕过 bunfig 的 pathIgnorePatterns，把 `tsc -b` 吐的
stale dist 编译副本也跑一遍（且 dist 里没有 fixture 会 ENOENT 误报）。
上面命令显式忽略 dist；或先删 `apps/gateway/dist`（gitignored 的 tsc 残留）。
