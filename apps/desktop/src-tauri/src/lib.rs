use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(windows)]
mod windows_job;
#[cfg(windows)]
use windows_job::JobObject;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

/// 学习 Studio 桌面壳命令（P4-B 平台能力 Rust 侧）。
/// 与 `apps/web/src/platform/tauri-capabilities.ts` 经 `window.__TAURI__.core.invoke` 对接。
/// 命令名与 TS 侧 `tauriInvoke(cmd, ...)` 字符串严格一致。

/// 用系统浏览器打开外链，避免在 WebView 内跳转。
#[tauri::command]
async fn platform_open_external_url(_app: tauri::AppHandle, url: String) -> Result<(), String> {
    tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| format!("打开外链失败：{e}"))
}

/// 写入系统剪贴板。
#[tauri::command]
async fn platform_clipboard_write_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    app.clipboard()
        .write_text(text)
        .map_err(|e| format!("写入剪贴板失败：{e}"))
}

/// 弹出保存对话框并把文本内容写入用户选择的路径。
#[tauri::command]
async fn platform_save_text_file(
    app: tauri::AppHandle,
    filename: String,
    content: String,
    _mime_type: String,
) -> Result<(), String> {
    let path = app
        .dialog()
        .file()
        .set_file_name(&filename)
        .add_filter("文件", &[get_extension(&filename)])
        .blocking_save_file()
        .ok_or_else(|| "未选择保存路径".to_string())?;

    match path {
        tauri_plugin_dialog::FilePath::Path(p) => {
            std::fs::write(p, content).map_err(|e| format!("写入文件失败：{e}"))
        }
        tauri_plugin_dialog::FilePath::Url(_) => Err("保存路径无效：非本地文件路径".to_string()),
    }
}

fn get_extension(filename: &str) -> &str {
    filename
        .rsplit_once('.')
        .map(|(_, ext)| ext)
        .unwrap_or("txt")
}

/// 弹出原生文件选择对话框，选择一个本地文件并返回其绝对物理路径。
#[tauri::command]
async fn platform_pick_file(
    app: tauri::AppHandle,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file();
    let exts: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    if !extensions.is_empty() {
        builder = builder.add_filter(&filter_name, &exts);
    }
    let res = builder.blocking_pick_file();
    match res {
        Some(tauri_plugin_dialog::FilePath::Path(p)) => Ok(Some(p.to_string_lossy().to_string())),
        Some(tauri_plugin_dialog::FilePath::Url(u)) => Ok(Some(u.to_string())),
        None => Ok(None),
    }
}

/// 窗口控制命令（沉浸式无边框自定义顶栏）。
#[tauri::command]
async fn platform_window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| format!("最小化窗口失败：{e}"))
}

#[tauri::command]
async fn platform_window_toggle_maximize(window: tauri::Window) -> Result<bool, String> {
    let is_max = window
        .is_maximized()
        .map_err(|e| format!("检查窗口最大化状态失败：{e}"))?;
    if is_max {
        window.unmaximize().map_err(|e| format!("还原窗口失败：{e}"))?;
        Ok(false)
    } else {
        window.maximize().map_err(|e| format!("最大化窗口失败：{e}"))?;
        Ok(true)
    }
}

#[tauri::command]
async fn platform_window_is_maximized(window: tauri::Window) -> Result<bool, String> {
    window
        .is_maximized()
        .map_err(|e| format!("获取最大化状态失败：{e}"))
}

#[tauri::command]
async fn platform_window_close(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| format!("关闭窗口失败：{e}"))
}


// ---------------------------------------------------------------------------
// P4-B：Agent Gateway sidecar 生命周期与数据库备份
// 网关以编译产物 sidecar 随壳启动（`bun scripts/build-sidecar.ts` 产出
// `binaries/lexdistill-gateway-<target-triple>`），库路径指向系统应用数据目录，
// 重启后学习数据保留；前端在启动时读取本次进程协商出的本机端口。
// ---------------------------------------------------------------------------

/// 网关 SQLite 库路径：系统应用数据目录（重启保留、卸载清理，区别于仓库根开发库）。
fn gateway_db_path(app: &AppHandle) -> std::path::PathBuf {
    let app_data = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let legacy_db = app_data.join("lexdistill.db");
    let new_db = app_data.join("lexdistill.db");
    if !new_db.exists() && legacy_db.exists() {
        let _ = std::fs::copy(&legacy_db, &new_db);
        let _ = std::fs::copy(
            app_data.join("lexdistill.db-wal"),
            app_data.join("lexdistill.db-wal"),
        );
        let _ = std::fs::copy(
            app_data.join("lexdistill.db-shm"),
            app_data.join("lexdistill.db-shm"),
        );
    }
    new_db
}

/// sidecar 子进程句柄：保活至应用退出（Tauri 退出时自动回收）。
/// Windows 下同时持有 Job Object，直到 Child 完成关闭流程后再释放。
struct GatewaySidecar {
    child: std::sync::Mutex<Option<Child>>,
    #[cfg(windows)]
    job: std::sync::Mutex<Option<JobObject>>,
}

impl GatewaySidecar {
    const GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(1_500);
    const FORCE_REAP_TIMEOUT: Duration = Duration::from_millis(750);
    const REAP_POLL_INTERVAL: Duration = Duration::from_millis(20);

    #[cfg(any(not(windows), test))]
    fn new(child: Child) -> Self {
        Self {
            child: std::sync::Mutex::new(Some(child)),
            #[cfg(windows)]
            job: std::sync::Mutex::new(None),
        }
    }

    #[cfg(windows)]
    fn new_with_job(child: Child, job: JobObject) -> Self {
        Self {
            child: std::sync::Mutex::new(Some(child)),
            job: std::sync::Mutex::new(Some(job)),
        }
    }

    /// 停止 sidecar；重复调用安全，窗口关闭和应用析构可以同时兜底。
    fn shutdown(&self) {
        let child = match self.child.lock() {
            Ok(mut guard) => guard.take(),
            Err(_) => None,
        };

        let Some(mut child) = child else {
            return;
        };

        Self::shutdown_child(&mut child);
        drop(child);
        #[cfg(windows)]
        self.release_job();
    }

    fn shutdown_child(child: &mut Child) {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {}
            Err(error) => {
                eprintln!("[sidecar] 检查网关退出状态失败：{error}");
            }
        }

        if let Some(stdin) = child.stdin.as_mut() {
            if let Err(error) = stdin.write_all(b"shutdown\n").and_then(|_| stdin.flush()) {
                eprintln!("[sidecar] 写入网关优雅关闭命令失败：{error}");
                Self::force_stop(child);
                return;
            }
        } else {
            eprintln!("[sidecar] 网关 stdin 不可用，进入强制回收");
            Self::force_stop(child);
            return;
        }

        if Self::wait_for_graceful_exit(child) {
            return;
        }

        eprintln!(
            "[sidecar] 网关未在 {:?} 内优雅退出，进入强制回收",
            Self::GRACEFUL_SHUTDOWN_TIMEOUT
        );
        Self::force_stop(child);
    }

    #[cfg(windows)]
    fn release_job(&self) {
        if let Ok(mut guard) = self.job.lock() {
            let _ = guard.take();
        }
    }

    fn wait_for_graceful_exit(child: &mut Child) -> bool {
        let deadline = Instant::now() + Self::GRACEFUL_SHUTDOWN_TIMEOUT;
        loop {
            match child.try_wait() {
                Ok(Some(_)) => return true,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Self::REAP_POLL_INTERVAL);
                }
                Ok(None) => return false,
                Err(error) => {
                    eprintln!("[sidecar] 等待网关优雅退出失败：{error}");
                    return false;
                }
            }
        }
    }

    fn force_stop(child: &mut Child) {
        // Gateway 可能在 graceful wait 返回后刚好自然退出；再次检查确保不对
        // 已退出的子进程调用 kill。force-reap 仍限制在固定窗口内，避免关闭卡住。
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {}
            Err(error) => {
                eprintln!("[sidecar] 检查网关退出状态失败：{error}");
            }
        }

        if let Err(error) = child.kill() {
            eprintln!("[sidecar] 强制停止网关失败：{error}");
        }
        Self::wait_for_exit(child);
    }

    fn wait_for_exit(child: &mut Child) {
        let deadline = Instant::now() + Self::FORCE_REAP_TIMEOUT;
        loop {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Self::REAP_POLL_INTERVAL);
                }
                Ok(None) => {
                    eprintln!(
                        "[sidecar] 网关未在 {:?} 内退出，放弃等待以避免阻塞桌面关闭",
                        Self::FORCE_REAP_TIMEOUT
                    );
                    return;
                }
                Err(error) => {
                    eprintln!("[sidecar] 回收网关进程失败：{error}");
                    return;
                }
            }
        }
    }
}

impl Drop for GatewaySidecar {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct GatewayPort(std::sync::Mutex<u16>);

#[derive(Debug, Serialize)]
struct GatewayConnection {
    port: u16,
    http_url: String,
    ws_url: String,
}

/// 选择一个本机临时端口：由操作系统分配，并明确避开 15000 及以下端口。
/// 端口只绑定到本机，Gateway 不对外网卡暴露。
fn pick_gateway_port() -> Result<u16, String> {
    for _ in 0..32 {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", 0)) {
            if let Ok(address) = listener.local_addr() {
                if address.port() > 15_000 {
                    return Ok(address.port());
                }
            }
        }
    }
    Err("无法分配大于 15000 的本机临时端口，请关闭冲突应用后重试。".to_string())
}

#[tauri::command]
fn gateway_connection(state: State<'_, GatewayPort>) -> Result<GatewayConnection, String> {
    let port = *state
        .0
        .lock()
        .map_err(|_| "网关端口状态暂时不可用，请重启应用后重试。".to_string())?;
    Ok(GatewayConnection {
        port,
        http_url: format!("http://localhost:{port}"),
        ws_url: format!("ws://localhost:{port}/ws"),
    })
}

fn gateway_sidecar_path(app: &AppHandle) -> Result<PathBuf, String> {
    let filename = if cfg!(windows) {
        "lexdistill-gateway.exe"
    } else {
        "lexdistill-gateway"
    };
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join(filename));
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(filename));
    }
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| format!("网关 sidecar 不存在：{filename}"))
}

/// Dev 网关入口解析（纯函数，可单测）：
/// 仓库根/apps/gateway/src/sidecar.ts 存在即返回 bun 启动参数和工作目录。
/// 与生产同入口，网关改动即时生效，不再依赖预编译 sidecar 包的新鲜度
///（曾实测跑着 9/08 老包调新路由 404）。
fn dev_gateway_entry(repo_root: &std::path::Path) -> Option<(PathBuf, Vec<String>, PathBuf)> {
    let entry = PathBuf::from("apps")
        .join("gateway")
        .join("src")
        .join("sidecar.ts");
    if !repo_root.join(&entry).is_file() {
        return None;
    }
    Some((
        PathBuf::from("bun"),
        vec!["--watch".to_string(), entry.to_string_lossy().to_string()],
        repo_root.to_path_buf(),
    ))
}

/// Debug 桌面构建默认从仓库源码启动 Gateway；Release 默认走预编译 sidecar。
/// LEXDISTILL_GATEWAY_BUN=0 可在 Debug 下强制测试 sidecar；=1 可显式强制源码模式。
fn dev_gateway_command() -> Option<(PathBuf, Vec<String>, PathBuf)> {
    let use_source = match std::env::var("LEXDISTILL_GATEWAY_BUN")
        .or_else(|_| std::env::var("STUDY_STUDIO_GATEWAY_BUN"))
        .as_deref()
    {
        Ok("1") => true,
        Ok("0") => false,
        _ => cfg!(debug_assertions),
    };
    if !use_source {
        return None;
    }
    // dev 下 current_exe = <root>/apps/desktop/src-tauri/target/debug/<exe>，上溯 6 级到仓库根。
    let root = std::env::current_exe()
        .ok()?
        .ancestors()
        .nth(6)?
        .to_path_buf();
    dev_gateway_entry(&root)
}

/// 拉起网关 sidecar；二进制缺失或启动失败只打日志，不阻塞壳启动
///（离线模式下前端走本地降级，见 `useGateway`）。
fn spawn_gateway_sidecar(app: &AppHandle, port: u16) {
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        eprintln!("[sidecar] 创建应用数据目录失败：{e}");
    }
    let db_path = gateway_db_path(app);

    let sidecar_path = match gateway_sidecar_path(app) {
        Ok(path) => path,
        Err(e) => {
            eprintln!("[sidecar] {e}（请重新安装完整安装包）");
            return;
        }
    };
    // Dev 覆盖：从仓库根运行 bun --watch，确保源码位于 Bun 的项目目录内。
    // 生产与默认走预编译包（program= sidecar 二进制，无额外参数）。
    let (program, extra_args, working_dir) = match dev_gateway_command() {
        Some((program, args, working_dir)) => {
            println!("[sidecar] dev 模式：经 bun 现场拉起源码 sidecar（改动即时生效）");
            (program, args, Some(working_dir))
        }
        None => (sidecar_path.clone(), Vec::new(), None),
    };
    let pdf_runtime_dir = match &working_dir {
        Some(root) => root.join("apps/desktop/src-tauri/resources/pdf-runtime"),
        None => match app.path().resource_dir() {
            Ok(dir) => dir.join("pdf-runtime"),
            Err(error) => {
                eprintln!("[sidecar] 无法定位随应用安装的 PDF 组件：{error}");
                return;
            }
        },
    };
    let mut command = Command::new(&program);
    if let Some(dir) = working_dir {
        command.current_dir(dir);
    }
    command
        .args(&extra_args)
        .env("LEXDISTILL_DB", &db_path)
        .env("STUDY_STUDIO_DB", &db_path)
        .env("LEXDISTILL_PDF_RUNTIME_DIR", &pdf_runtime_dir)
        .env("STUDY_STUDIO_PDF_RUNTIME_DIR", &pdf_runtime_dir)
        .env("GATEWAY_PORT", port.to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW); // 后台 sidecar 不创建控制台窗口
    match command.spawn() {
        Ok(mut child) => {
            println!(
                "[sidecar] 网关已拉起（端口={}，库路径={}，程序={}{})",
                port,
                db_path.display(),
                program.display(),
                if extra_args.is_empty() {
                    String::new()
                } else {
                    format!(" {}", extra_args.join(" "))
                }
            );
            #[cfg(windows)]
            let job = match JobObject::attach_to_process(child.as_raw_handle()) {
                Ok(job) => job,
                Err(error) => {
                    eprintln!(
                        "[sidecar] 网关 Job Object 绑定失败：{error}；未受进程树治理，立即终止并回收"
                    );
                    reap_unprotected_child(child);
                    return;
                }
            };
            if let Some(stdout) = child.stdout.take() {
                std::thread::spawn(move || {
                    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                        println!("[gateway] {line}");
                    }
                });
            }
            if let Some(stderr) = child.stderr.take() {
                std::thread::spawn(move || {
                    for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                        eprintln!("[gateway] {line}");
                    }
                });
            }
            #[cfg(windows)]
            app.manage(GatewaySidecar::new_with_job(child, job));
            #[cfg(not(windows))]
            app.manage(GatewaySidecar::new(child));
        }
        Err(e) => {
            eprintln!(
                "[sidecar] 网关启动失败：{e}（程序={}，前端将以降级离线模式运行）",
                program.display()
            );
        }
    }
}

#[cfg(windows)]
fn reap_unprotected_child(mut child: Child) {
    if let Err(error) = child.kill() {
        eprintln!("[sidecar] 回收未受 Job Object 保护的网关失败：{error}");
    }
    if let Err(error) = child.wait() {
        eprintln!("[sidecar] 等待未受保护网关退出失败：{error}");
    }
}

/// 备份学习数据库：把当前库文件（含 WAL/SHM 伴生文件）复制到用户选择的目录。
/// 恢复即把备份文件放回应用数据目录并重启应用；schema 迁移为加法自愈
///（CREATE TABLE IF NOT EXISTS + 容错 ALTER），旧库可直接打开。
#[tauri::command]
async fn platform_backup_database(app: AppHandle) -> Result<String, String> {
    let src = gateway_db_path(&app);
    if !src.exists() {
        return Err("学习数据库尚不存在，请先在应用内产生学习记录后再备份。".to_string());
    }
    let dest = app
        .dialog()
        .file()
        .set_file_name("lexdistill-backup.db")
        .add_filter("SQLite 数据库", &["db"])
        .blocking_save_file()
        .ok_or_else(|| "未选择保存路径".to_string())?;
    let dest_path = match dest {
        tauri_plugin_dialog::FilePath::Path(p) => p,
        tauri_plugin_dialog::FilePath::Url(_) => {
            return Err("保存路径无效：非本地文件路径".to_string())
        }
    };
    // 主库 + WAL/SHM 伴生文件一起复制，保证热备份一致性
    let mut copied = 0;
    for suffix in ["", "-wal", "-shm"] {
        let from = if suffix.is_empty() {
            src.clone()
        } else {
            src.with_extension(format!("db{suffix}"))
        };
        if !from.exists() {
            continue;
        }
        let to = if suffix.is_empty() {
            dest_path.clone()
        } else {
            dest_path.with_extension(format!("db{suffix}"))
        };
        std::fs::copy(&from, &to).map_err(|e| format!("备份失败：{e}"))?;
        copied += 1;
    }
    if copied == 0 {
        return Err("学习数据库尚不存在，请先在应用内产生学习记录后再备份。".to_string());
    }
    Ok(dest_path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                if let Some(sidecar) = window.app_handle().try_state::<GatewaySidecar>() {
                    sidecar.shutdown();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            platform_open_external_url,
            platform_clipboard_write_text,
            platform_save_text_file,
            platform_backup_database,
            gateway_connection,
            platform_pick_file,
            platform_window_minimize,
            platform_window_toggle_maximize,
            platform_window_is_maximized,
            platform_window_close,
        ])
        .setup(|app| {
            let port = match pick_gateway_port() {
                Ok(port) => port,
                Err(message) => {
                    eprintln!("[sidecar] {message}");
                    return Ok(());
                }
            };
            app.manage(GatewayPort(std::sync::Mutex::new(port)));
            spawn_gateway_sidecar(app.handle(), port);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running LexDistill desktop application");
}

#[cfg(test)]
mod tests {
    use super::dev_gateway_entry;
    use super::GatewaySidecar;
    use std::io::Read;
    use std::process::{Child, Command};

    fn spawn_long_lived_child() -> Child {
        #[cfg(windows)]
        {
            Command::new("cmd")
                .args(["/C", "ping", "127.0.0.1", "-n", "6"])
                .spawn()
                .expect("spawn test child")
        }

        #[cfg(not(windows))]
        {
            Command::new("sh")
                .args(["-c", "sleep 5"])
                .spawn()
                .expect("spawn test child")
        }
    }

    fn spawn_graceful_child() -> Child {
        #[cfg(windows)]
        {
            Command::new("cmd")
                .args(["/C", "set /p line= & echo graceful"])
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .spawn()
                .expect("spawn graceful test child")
        }

        #[cfg(not(windows))]
        {
            Command::new("sh")
                .args([
                    "-c",
                    "IFS= read -r line; printf graceful",
                    "lexdistill-graceful-test",
                ])
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .spawn()
                .expect("spawn graceful test child")
        }
    }

    #[test]
    fn shutdown_is_idempotent_and_reaps_the_owned_child() {
        let sidecar = GatewaySidecar::new(spawn_long_lived_child());

        sidecar.shutdown();
        sidecar.shutdown();

        assert!(sidecar.child.lock().expect("sidecar lock").is_none());
    }

    #[test]
    fn shutdown_does_not_wait_for_a_child_that_already_exited() {
        let mut child = Command::new(if cfg!(windows) { "cmd" } else { "true" });
        #[cfg(windows)]
        let child = child.args(["/C", "exit", "0"]);
        let mut child = child.spawn().expect("spawn exited test child");
        let _ = child.wait();

        let sidecar = GatewaySidecar::new(child);
        sidecar.shutdown();

        assert!(sidecar.child.lock().expect("sidecar lock").is_none());
    }

    #[test]
    fn dev_gateway_entry_resolves_bun_sidecar_only_when_present() {
        // 仓库根不存在 sidecar.ts → None（生产路径不受影响）。
        assert!(dev_gateway_entry(std::path::Path::new("/nonexistent-root-xyz")).is_none());
        // 用当前仓库真实布局断言（本文件即在 apps/desktop/src-tauri/src 下）。
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest
            .ancestors()
            .nth(3)
            .expect("src-tauri 上溯 3 级应为仓库根");
        let (program, args, working_dir) =
            dev_gateway_entry(repo_root).expect("仓库应含 apps/gateway/src/sidecar.ts");
        assert_eq!(program.to_string_lossy(), "bun");
        assert_eq!(args.len(), 2);
        assert_eq!(args[0], "--watch");
        let expected_entry = std::path::Path::new("apps")
            .join("gateway")
            .join("src")
            .join("sidecar.ts");
        assert_eq!(std::path::Path::new(&args[1]), expected_entry);
        assert_eq!(working_dir, repo_root);
    }

    #[test]
    fn shutdown_uses_graceful_stdin_before_kill_fallback() {
        let mut child = spawn_graceful_child();
        let mut stdout = child.stdout.take().expect("graceful child stdout");
        let output_reader = std::thread::spawn(move || {
            let mut output = String::new();
            stdout
                .read_to_string(&mut output)
                .expect("read graceful child stdout");
            output
        });
        let sidecar = GatewaySidecar::new(child);

        sidecar.shutdown();

        assert_eq!(
            output_reader.join().expect("join stdout reader").trim(),
            "graceful"
        );
    }
}
