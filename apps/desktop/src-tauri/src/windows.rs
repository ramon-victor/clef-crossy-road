//! The game owns the lifetime of the app; controls can be hidden and shown without a new webview.

use std::sync::OnceLock;

use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow,
    WindowEvent,
};

use crate::error::{CommandError, CommandResult};

#[derive(Default)]
pub struct WindowLayout {
    pixel_ratio: OnceLock<f64>,
}

impl WindowLayout {
    pub fn pixel_ratio(&self) -> f64 {
        *self.pixel_ratio.get().unwrap_or(&1.0)
    }
}

#[tauri::command]
pub fn show_controls(app: AppHandle) -> CommandResult<()> {
    let controls = app
        .get_webview_window("controls")
        .ok_or_else(|| CommandError::new("Controls window is unavailable"))?;
    controls.unminimize()?;
    controls.show()?;
    // Foreground activation is advisory; the OS may deny it while another app is active.
    let _ = controls.set_focus();
    app.emit_to("controls", "controls:shown", ())?;
    app.emit_to("main", "controls:visible", true)?;
    Ok(())
}

fn hide_controls(app: &AppHandle) -> CommandResult<()> {
    let controls = app
        .get_webview_window("controls")
        .ok_or_else(|| CommandError::new("Controls window is unavailable"))?;
    app.emit_to("controls", "controls:hidden", ())?;
    controls.hide()?;
    app.emit_to("main", "controls:visible", false)?;
    Ok(())
}

#[tauri::command]
pub fn toggle_controls(app: AppHandle) -> CommandResult<()> {
    let controls = app
        .get_webview_window("controls")
        .ok_or_else(|| CommandError::new("Controls window is unavailable"))?;
    if controls.is_visible()? && !controls.is_minimized()? {
        hide_controls(&app)
    } else {
        show_controls(app)
    }
}

#[tauri::command]
pub fn set_decisions_visible(app: AppHandle, visible: bool, focus: bool) -> CommandResult<()> {
    let decisions = app
        .get_webview_window("decisions")
        .ok_or_else(|| CommandError::new("Decisions window is unavailable"))?;
    if visible {
        decisions.unminimize()?;
        decisions.show()?;
        if focus {
            let _ = decisions.set_focus();
        }
        app.emit_to("decisions", "decisions:shown", ())?;
    } else {
        decisions.hide()?;
    }
    app.emit_to("main", "decisions:visible", visible)?;
    Ok(())
}

pub fn on_event(window: &tauri::Window, event: &WindowEvent) {
    match (window.label(), event) {
        ("main", WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed) => {
            window.app_handle().exit(0);
        }
        ("controls", WindowEvent::CloseRequested { api, .. }) => {
            api.prevent_close();
            let _ = hide_controls(window.app_handle());
        }
        ("decisions", WindowEvent::CloseRequested { api, .. }) => {
            api.prevent_close();
            let _ = window.hide();
            let _ = window.app_handle().emit_to("main", "decisions:closed", ());
            let _ = window
                .app_handle()
                .emit_to("main", "decisions:visible", false);
        }
        ("controls" | "decisions", WindowEvent::Resized(_) | WindowEvent::Focused(_)) => {
            if let (Ok(visible), Ok(minimized)) = (window.is_visible(), window.is_minimized()) {
                let _ = window.app_handle().emit_to(
                    "main",
                    &format!("{}:visible", window.label()),
                    visible && !minimized,
                );
            }
        }
        ("main", WindowEvent::Resized(_) | WindowEvent::Focused(_)) => {
            if let Ok(minimized) = window.is_minimized() {
                let _ = window
                    .app_handle()
                    .emit_to("main", "game:minimized", minimized);
            }
        }
        _ => {}
    }
}

#[derive(Debug)]
struct Layout {
    game_width: f64,
    controls_width: f64,
    decisions_width: f64,
    decisions_x: f64,
    height: f64,
    game_x: f64,
    controls_x: f64,
    y: f64,
}

/// All dimensions are CSS pixels; the webview's pixel ratio supplies physical window sizes.
fn layout(width: f64, height: f64, frame_width: f64, frame_height: f64) -> Layout {
    let margin = 16.0;
    let gap = 12.0;
    let available = (width - margin * 2.0 - frame_width).max(1.0);
    let height = (height - margin * 2.0 - frame_height).max(1.0).min(800.0);
    let game_width = (height * 440.0 / 800.0).clamp(360.0, 440.0).min(available);
    let controls_width = 320.0_f64.min(available);
    let decisions_width = 360.0_f64.min(available);
    let game_x = ((width - game_width - frame_width) / 2.0).max(0.0);
    let controls_x = (game_x - gap - controls_width - frame_width)
        .max(margin)
        .min((width - controls_width - frame_width).max(0.0));
    let decisions_x = (game_x + game_width + frame_width + gap)
        .min((width - decisions_width - frame_width - margin).max(0.0));
    Layout {
        decisions_width,
        decisions_x,
        game_width,
        controls_width,
        height,
        game_x,
        controls_x,
        y: margin.min((height / 2.0).max(0.0)),
    }
}

/// Persist resize limits in native logical units so Windows can rescale them on WM_DPICHANGED.
/// XWayland may have a different CSS scale, so first account for that ratio.
pub fn minimum_size_for_css(
    width: f64,
    height: f64,
    pixel_ratio: f64,
    native_scale: f64,
) -> LogicalSize<f64> {
    let css_to_native = pixel_ratio / native_scale;
    LogicalSize::new(width * css_to_native, height * css_to_native)
}

fn place_windows(app: &AppHandle, game: &WebviewWindow, pixel_ratio: f64) -> CommandResult<()> {
    let controls = app
        .get_webview_window("controls")
        .ok_or_else(|| CommandError::new("Controls window is unavailable"))?;
    let decisions = app
        .get_webview_window("decisions")
        .ok_or_else(|| CommandError::new("Decisions window is unavailable"))?;
    let monitor = match game.current_monitor()? {
        Some(monitor) => Some(monitor),
        None => game.primary_monitor()?,
    };
    if let Some(monitor) = monitor {
        let scale = pixel_ratio;
        let area = monitor.work_area();
        let inner = game.inner_size()?;
        let outer = game.outer_size()?;
        let frame_width = f64::from(outer.width.saturating_sub(inner.width)) / scale;
        let frame_height = f64::from(outer.height.saturating_sub(inner.height)) / scale;
        let placement = layout(
            f64::from(area.size.width) / scale,
            f64::from(area.size.height) / scale,
            frame_width,
            frame_height,
        );
        let x = f64::from(area.position.x) / scale;
        let y = f64::from(area.position.y) / scale;
        for (window, width, minimum_width, offset_x) in [
            (game, placement.game_width, 360.0_f64, placement.game_x),
            (&controls, placement.controls_width, 320.0, placement.controls_x),
            (&decisions, placement.decisions_width, 360.0, placement.decisions_x),
        ] {
            window.set_min_size(Some(minimum_size_for_css(
                minimum_width.min(width),
                640.0_f64.min(placement.height),
                scale,
                window.scale_factor()?,
            )))?;
            window.set_size(PhysicalSize::new(width * scale, placement.height * scale))?;
            window.set_position(PhysicalPosition::new(
                (x + offset_x) * scale,
                (y + placement.y) * scale,
            ))?;
        }
    }
    Ok(())
}

fn show_with_layout_fallback(
    placement: CommandResult<()>,
    show: impl FnOnce() -> CommandResult<()>,
) -> CommandResult<()> {
    if let Err(error) = placement {
        eprintln!("Initial window placement unavailable; using system defaults: {error:?}");
    }
    show()
}

/// Report CSS scale before the first show. Placement/focus failures must not block UI startup.
#[tauri::command]
pub fn show_game(
    app: AppHandle,
    state: State<'_, WindowLayout>,
    pixel_ratio: f64,
) -> CommandResult<()> {
    if !pixel_ratio.is_finite() || pixel_ratio <= 0.0 {
        return Err(CommandError::new("Invalid window pixel ratio"));
    }
    if state.pixel_ratio.get().is_some() {
        return Ok(());
    }
    let game = app
        .get_webview_window("main")
        .ok_or_else(|| CommandError::new("Game window is unavailable"))?;
    show_with_layout_fallback(place_windows(&app, &game, pixel_ratio), || {
        game.show()?;
        let _ = game.set_focus();
        Ok(())
    })?;
    let _ = state.pixel_ratio.set(pixel_ratio);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shows_the_game_even_when_the_window_manager_rejects_placement() {
        let shown = std::cell::Cell::new(false);
        let result = show_with_layout_fallback(
            Err(CommandError::new("Window placement is not supported")),
            || {
                shown.set(true);
                Ok(())
            },
        );
        assert!(result.is_ok());
        assert!(shown.get());
    }

    #[test]
    fn reports_an_actual_show_failure_even_when_placement_succeeded() {
        let result = show_with_layout_fallback(Ok(()), || {
            Err(CommandError::new("Window is no longer available"))
        });
        assert!(result.is_err());
    }

    #[test]
    fn minimum_sizes_follow_windows_dpi_changes_in_both_directions() {
        for (width, source_scale, destination_scale) in [
            (360.0, 2.0, 1.0),
            (320.0, 1.0, 2.0),
            (360.0, 1.25, 1.5),
        ] {
            let minimum = minimum_size_for_css(width, 640.0, source_scale, source_scale);
            assert_eq!(
                minimum.to_physical::<u32>(destination_scale),
                PhysicalSize::new(
                    (width * destination_scale).round() as u32,
                    (640.0 * destination_scale).round() as u32,
                )
            );
        }
    }

    #[test]
    fn preserves_css_minimums_when_webkit_and_gtk_disagree_on_scale() {
        let minimum = minimum_size_for_css(360.0, 640.0, 1.6, 1.0);
        assert_eq!(minimum.to_physical::<u32>(1.0), PhysicalSize::new(576, 1024));
        assert_eq!(minimum.to_physical::<u32>(2.0), PhysicalSize::new(1152, 2048));
    }

    #[test]
    fn opens_compact_windows_on_each_side_of_the_centered_game() {
        let p = layout(1440.0, 900.0, 8.0, 32.0);
        assert_eq!(p.game_width, 440.0);
        assert_eq!(p.controls_width, 320.0);
        assert_eq!(p.decisions_width, 360.0);
        assert_eq!(p.height, 800.0);
        assert!(p.height > p.game_width * 1.7);
        assert!(p.controls_x + p.controls_width + 8.0 <= p.game_x);
        assert!(p.controls_x + p.controls_width + 8.0 <= 1440.0);
        assert!(p.game_x + p.game_width + 8.0 < p.decisions_x);
    }

    #[test]
    fn shrinks_the_game_to_the_monitor_work_area() {
        let p = layout(1180.0, 728.0, 8.0, 32.0);
        assert_eq!(p.game_width, 365.2);
        assert_eq!(p.height, 664.0);
        assert!(p.controls_x + p.controls_width + 8.0 <= 1180.0);
    }

    #[test]
    fn overlaps_on_narrow_displays_instead_of_hiding_the_controls_offscreen() {
        let p = layout(800.0, 600.0, 8.0, 32.0);
        assert_eq!(p.game_width, 360.0);
        assert_eq!(p.controls_width, 320.0);
        assert!(p.controls_x + p.controls_width + 8.0 <= 800.0);
        assert!(p.controls_x < p.game_x + p.game_width);
    }

    #[test]
    fn decisions_stay_inside_the_work_area_at_normal_and_scaled_sizes() {
        // 1366x768 and a 1920x1080 screen at 150%, excluding taskbar space.
        for (width, height) in [(1366.0, 728.0), (1280.0, 680.0), (1920.0, 1040.0)] {
            let p = layout(width, height, 8.0, 32.0);
            assert_eq!(p.decisions_width, 360.0);
            assert!(p.decisions_x >= 0.0);
            assert!(p.decisions_x + p.decisions_width + 8.0 <= width);
            assert!(p.y + p.height + 32.0 <= height);
        }
    }

    #[test]
    fn fits_each_window_even_when_scaling_leaves_less_than_the_usual_minimum() {
        for (width, height) in [(600.0, 440.0), (320.0, 360.0), (960.0, 500.0)] {
            let p = layout(width, height, 8.0, 32.0);
            for (x, w) in [
                (p.game_x, p.game_width),
                (p.controls_x, p.controls_width),
                (p.decisions_x, p.decisions_width),
            ] {
                assert!(x >= 0.0);
                assert!(x + w + 8.0 <= width);
            }
            assert!(p.y + p.height + 32.0 <= height);
        }
    }
}
