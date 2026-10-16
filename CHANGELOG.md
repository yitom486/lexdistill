# Changelog

All notable changes to LexDistill are documented here. Release notes are reused by the GitHub Release workflow.

## [0.1.2] - 2026-09-08

### Changed

- fix(desktop): reliably launch packaged gateway
- feat(shred): 教材拆行入库+四路写回即拆
- feat(layout): 版式信号接入标题分类
- feat(structure): mini模型标题分类分流+存档

## [0.1.1] - 2026-09-08

### Changed

- fix(desktop): use dynamic gateway ports and expose updater
- feat(db): v14教材shred表结构
- ci(release): publish stable Linux bundles
- ci(release): refresh platform runners and AppImage setup

## [0.1.0] - 2026-09-08

The first public desktop release of LexDistill.

### Added

- Japanese, English, and Korean learning tracks with a learner profile and daily goals.
- Japanese kana studio with hiragana/katakana practice, romaji input, confusion-aware repetition, and AI tutoring context.
- Adaptive practice, multi-dimensional grading, mistake sprints, learner radar, FSRS spaced repetition, and card drafting.
- Reading, writing, listening, pitch-accent, textbook, dictionary, and Anki workflows.
- AI tutoring through the provider-agnostic Agent Gateway with WebSocket streaming and offline fallbacks.
- TTS voice preferences, optional neural voice providers, and on-demand licensed offline dictionary packages.
- Tauri desktop packaging for Windows, macOS, and Linux with a local Gateway sidecar.
- Signed GitHub Releases with automatic update checks and updater artifacts.

### Data safety

- Learning data is stored in the application data directory, separate from the installed application bundle.
- Updates replace the application bundle only; user profiles, study records, cards, mistakes, preferences, and databases are retained.
- Database migrations are additive and the desktop settings panel provides a database backup action.
