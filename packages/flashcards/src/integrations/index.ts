/**
 * C5 外部闪卡集成公共入口（服务端专用：含 Node-only 解析运行时）。
 * - AnkiConnect 协议客户端（桌面 Anki 本地插件接口，协议 v6）；
 * - endpoint 解析与收窄（仅本机回环，防 SSRF）。
 * - APKG 文件格式纯解析（已解包条目 → 笔记/模板/媒体引用）。
 * 纯传输/解析层：不连业务 SQLite、不新增迁移；用户设置、卡片/媒体读取、持久化、
 * HTTP 路由与 Tool 注册仍归 Gateway。
 */
export * from './anki-endpoint.js';
export * from './anki-connect.js';
export * from './apkg-parse.js';
