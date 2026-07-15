// Prevents an extra console window from popping up on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Port the backend is actually running on, chosen at launch. Exposed to the
/// frontend via the `get_backend_port` command below instead of both sides
/// hardcoding the same magic number (which is how the port ended up
/// duplicated across Rust, Python, and two different places in the frontend
/// in the first place).
struct BackendPort(u16);

/// Ask the OS for a currently-free port by binding to port 0, then release it
/// immediately so the backend sidecar can bind it instead. There's an
/// inherent, unavoidable TOCTOU race here — something else could grab the
/// port in the gap between us releasing it and the sidecar binding it — but
/// for a single-user local desktop app pulling from the whole ephemeral port
/// range, the odds of that are negligible in practice.
///
/// This also mostly retires the old kill_stray_backend() step: a previous
/// crashed launch would have been using a different random port, so it's no
/// longer in the way of this launch at all (it becomes an idle leftover
/// process rather than something blocking startup).
fn find_free_port() -> Option<u16> {
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|listener| listener.local_addr().ok())
        .map(|addr| addr.port())
}

/// Poll the backend's /health endpoint on `port` until it returns 200, or
/// give up after `retries` attempts. Deliberately hand-rolls a minimal
/// HTTP/1.1 GET over a raw TcpStream instead of pulling in an HTTP client
/// crate (reqwest, etc.) — keeps the Rust binary smaller, which was the
/// whole point of leaving Electron. A raw TCP-connect check isn't enough on
/// its own: it would report "ready" the moment *anything* accepts a
/// connection on the port, not necessarily our own backend.
fn check_backend_health(port: u16) -> bool {
    use std::io::{Read, Write};

    let addr = format!("127.0.0.1:{port}");
    let Ok(addr) = addr.parse() else { return false };

    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(300)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));

    let request =
        format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut buf = [0u8; 64];
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => {
            let response = String::from_utf8_lossy(&buf[..n]);
            response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
        }
        _ => false,
    }
}

fn wait_for_backend(port: u16, retries: u32, delay: Duration) -> bool {
    for _ in 0..retries {
        if check_backend_health(port) {
            return true;
        }
        std::thread::sleep(delay);
    }
    false
}

/// Exposed to the frontend so it can build its API base URL at runtime
/// instead of hardcoding a port. Only meaningful inside the Tauri shell —
/// the frontend falls back to a fixed default when run as a plain web page
/// (`npm run dev` in a browser tab, no Tauri present).
#[tauri::command]
fn get_backend_port(state: tauri::State<BackendPort>) -> u16 {
    state.0
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_backend_port])
        .setup(|app| {
            let port = find_free_port().unwrap_or(8000);
            app.manage(BackendPort(port));

            let sidecar_command = app
                .shell()
                .sidecar("relationship-graph-backend")
                .expect("failed to create sidecar command (externalBin misconfigured)")
                .env("BACKEND_PORT", port.to_string());

            let (mut rx, child) = match sidecar_command.spawn() {
                Ok(pair) => pair,
                Err(e) => {
                    app.dialog()
                        .message(format!(
                            "Failed to start the backend process.\n\n\
                             Error: {e}\n\n\
                             The application may not have installed correctly. \
                             Try restarting; if this keeps happening, check that \
                             your antivirus isn't blocking the backend executable."
                        ))
                        .kind(MessageDialogKind::Error)
                        .title("Relationship Graph — Startup Error")
                        .blocking_show();
                    std::process::exit(1);
                }
            };

            app.manage(Mutex::new(Some(child)));

            // Forward backend stdout/stderr into this process's logs so
            // `cargo tauri dev` still shows uvicorn output during development.
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            print!("[backend] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprint!("[backend] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(payload) => {
                            eprintln!("[backend] exited with {:?}", payload.code);
                        }
                        _ => {}
                    }
                }
            });

            // The splash window is already visible (declared in tauri.conf.json).
            // Poll for the backend to actually accept connections on a background
            // thread before revealing the real window — otherwise the frontend
            // renders a "cannot connect to backend" error on first paint if
            // uvicorn hasn't finished starting yet.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                // 60 * 500ms = 30s. On Windows, a first-run PyInstaller binary
                // can get held up for 10-20+ seconds by antivirus/Defender
                // scanning an unrecognized .exe.
                let ready = wait_for_backend(port, 60, Duration::from_millis(500));

                if let Some(splash) = handle.get_webview_window("splash") {
                    let _ = splash.close();
                }

                if ready {
                    if let Some(main) = handle.get_webview_window("main") {
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                } else {
                    // Don't leave the sidecar running in the background if
                    // we're about to give up and exit — an orphaned backend
                    // process is a worse outcome than an abrupt exit here.
                    // std::process::exit() skips destructors, so this has to
                    // happen explicitly rather than relying on Drop.
                    if let Some(state) = handle.try_state::<Mutex<Option<CommandChild>>>() {
                        if let Some(child) = state.lock().unwrap().take() {
                            let _ = child.kill();
                        }
                    }

                    handle
                        .dialog()
                        .message(
                            "The backend server did not start in time.\n\n\
                             Try restarting the application. If this keeps happening, \
                             check that your antivirus is not blocking the backend process.",
                        )
                        .kind(MessageDialogKind::Error)
                        .title("Relationship Graph — Could Not Start")
                        .blocking_show();
                    std::process::exit(1);
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Only the main window's close should tear down the backend — the
            // splash window closes itself long before the user can interact
            // with it, and we don't want that to kill the sidecar prematurely.
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window
                    .app_handle()
                    .try_state::<Mutex<Option<CommandChild>>>()
                {
                    if let Some(child) = state.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
