//! Keep the floating transport from taking focus on arrival. If the user
//! interacted with it, return to the preceding app on dismissal instead of
//! letting AppKit promote Voicebox's main window.
use objc::{class, msg_send, runtime::Object, sel, sel_impl};
use std::sync::Mutex;
use tauri::WebviewWindow;

static PREVIOUS_APP: Mutex<Option<i32>> = Mutex::new(None);

pub(crate) fn frontmost_pid() -> Option<i32> {
    unsafe {
        let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        let app: *mut Object = msg_send![workspace, frontmostApplication];
        if app.is_null() {
            return None;
        }
        Some(msg_send![app, processIdentifier])
    }
}

/// Must run on the AppKit main thread. Unlike Tauri show(), this does not
/// call makeKeyAndOrderFront, so normal keyboard focus remains untouched.
pub fn show(window: &WebviewWindow) {
    let current = frontmost_pid().filter(|pid| *pid != std::process::id() as i32);
    if !window.is_visible().unwrap_or(false) || current.is_some() {
        *PREVIOUS_APP.lock().unwrap() = current;
    }
    if let Ok(raw) = window.ns_window() {
        unsafe {
            let _: () = msg_send![raw as *mut Object, orderFrontRegardless];
        }
    }
}

pub fn dismiss_target(window: &WebviewWindow) -> Option<i32> {
    let previous = PREVIOUS_APP.lock().unwrap().take();
    if window.is_focused().unwrap_or(false) && frontmost_pid() == Some(std::process::id() as i32) {
        previous
    } else {
        None
    }
}
