//! Linux display compatibility, applied before GTK and the HTTP client's worker threads start.

use std::ffi::OsString;

fn compatibility_defaults(
    read: impl Fn(&str) -> Option<OsString>,
) -> Vec<(&'static str, &'static str)> {
    let wayland = read("XDG_SESSION_TYPE").is_some_and(|value| value == "wayland")
        || read("WAYLAND_DISPLAY").is_some_and(|value| !value.is_empty());
    let x11_available = read("DISPLAY").is_some_and(|value| !value.is_empty());
    if !wayland || !x11_available || read("GDK_BACKEND").is_some() {
        return Vec::new();
    }

    // Fedora/KDE Wayland flickered with multiple visible webviews, including GTK title bars.
    // Prefer the tested XWayland path; GTK can still fall back if X11 cannot connect.
    let mut defaults = vec![("GDK_BACKEND", "x11,wayland")];
    if read("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        defaults.push(("WEBKIT_DISABLE_DMABUF_RENDERER", "1"));
    }
    defaults
}

pub fn configure_display() {
    for (key, value) in compatibility_defaults(|key| std::env::var_os(key)) {
        std::env::set_var(key, value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn defaults(values: &[(&str, &str)]) -> Vec<(&'static str, &'static str)> {
        compatibility_defaults(|key| {
            values
                .iter()
                .find(|(name, _)| *name == key)
                .map(|(_, value)| OsString::from(value))
        })
    }

    #[test]
    fn prefers_xwayland_and_disables_dmabuf_for_a_wayland_session_with_x11() {
        assert_eq!(
            defaults(&[("XDG_SESSION_TYPE", "wayland"), ("DISPLAY", ":0")]),
            vec![
                ("GDK_BACKEND", "x11,wayland"),
                ("WEBKIT_DISABLE_DMABUF_RENDERER", "1")
            ]
        );
    }

    #[test]
    fn recognizes_wayland_without_a_session_type() {
        assert_eq!(
            defaults(&[("WAYLAND_DISPLAY", "wayland-0"), ("DISPLAY", ":0")]).len(),
            2
        );
    }

    #[test]
    fn leaves_native_x11_and_sessions_without_x11_unchanged() {
        for values in [
            vec![("XDG_SESSION_TYPE", "x11"), ("DISPLAY", ":0")],
            vec![("XDG_SESSION_TYPE", "wayland")],
            vec![("WAYLAND_DISPLAY", "wayland-0"), ("DISPLAY", "")],
            vec![("WAYLAND_DISPLAY", ""), ("DISPLAY", ":0")],
            vec![],
        ] {
            assert!(defaults(&values).is_empty());
        }
    }

    #[test]
    fn respects_an_explicit_backend_even_when_empty_or_a_list() {
        for backend in ["wayland", "x11", "wayland,x11", ""] {
            assert!(defaults(&[
                ("XDG_SESSION_TYPE", "wayland"),
                ("DISPLAY", ":0"),
                ("GDK_BACKEND", backend)
            ])
            .is_empty());
        }
    }

    #[test]
    fn preserves_an_explicit_dmabuf_setting() {
        for dmabuf in ["0", "1", ""] {
            assert_eq!(
                defaults(&[
                    ("XDG_SESSION_TYPE", "wayland"),
                    ("DISPLAY", ":0"),
                    ("WEBKIT_DISABLE_DMABUF_RENDERER", dmabuf)
                ]),
                vec![("GDK_BACKEND", "x11,wayland")]
            );
        }
    }
}
