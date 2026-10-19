//! The game owns the lifetime of the app; controls can be hidden and shown without a new webview.

use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WindowEvent};

use crate::error::{CommandError, CommandResult};

#[tauri::command]
pub fn show_controls(app: AppHandle) -> CommandResult<()> {
    let controls = app
        .get_webview_window("controls")
        .ok_or_else(|| CommandError::new("Controls window is unavailable"))?;
    controls.unminimize()?;
    controls.show()?;
    controls.set_focus()?;
    app.emit_to("controls", "controls:shown", ())?;
    Ok(())
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
            decisions.set_focus()?;
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
            let _ = window
                .app_handle()
                .emit_to("controls", "controls:hidden", ());
            let _ = window.hide();
        }
        ("decisions", WindowEvent::CloseRequested { api, .. }) => {
            api.prevent_close();
            let _ = window.hide();
            let _ = window.app_handle().emit_to("main", "decisions:closed", ());
            let _ = window
                .app_handle()
                .emit_to("main", "decisions:visible", false);
        }
        ("decisions", WindowEvent::Resized(_) | WindowEvent::Focused(_)) => {
            if let (Ok(visible), Ok(minimized)) = (window.is_visible(), window.is_minimized()) {
                let _ =
                    window
                        .app_handle()
                        .emit_to("main", "decisions:visible", visible && !minimized);
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

/// All sizes are logical, including window decorations and monitor work area offsets.
fn layout(width: f64, height: f64, frame_width: f64, frame_height: f64) -> Layout {
    let margin = 16.0;
    let gap = 12.0;
    let available = (width - margin * 2.0 - frame_width).max(1.0);
    let game_width = 640.0_f64.min(available);
    let controls_width = 320.0_f64.min(available);
    let decisions_width = 360.0_f64.min(available);
    let game_x = ((width - game_width - frame_width) / 2.0).max(0.0);
    let controls_x = (game_x - gap - controls_width - frame_width)
        .max(margin)
        .min((width - controls_width - frame_width).max(0.0));
    let decisions_x = (game_x + game_width + frame_width + gap)
        .min((width - decisions_width - frame_width - margin).max(0.0));
    let height = (height - margin * 2.0 - frame_height).max(1.0).min(720.0);
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

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let game = app.get_webview_window("main").expect("main window missing");
    let controls = app
        .get_webview_window("controls")
        .expect("controls window missing");
    let decisions = app
        .get_webview_window("decisions")
        .expect("decisions window missing");
    if let Some(monitor) = game.current_monitor()?.or(game.primary_monitor()?) {
        let scale = monitor.scale_factor();
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
        for (window, width) in [
            (&game, placement.game_width),
            (&controls, placement.controls_width),
            (&decisions, placement.decisions_width),
        ] {
            window.set_min_size(Some(LogicalSize::new(
                width,
                480.0_f64.min(placement.height),
            )))?;
        }
        game.set_size(LogicalSize::new(placement.game_width, placement.height))?;
        controls.set_size(LogicalSize::new(placement.controls_width, placement.height))?;
        game.set_position(LogicalPosition::new(x + placement.game_x, y + placement.y))?;
        controls.set_position(LogicalPosition::new(
            x + placement.controls_x,
            y + placement.y,
        ))?;
        decisions.set_size(LogicalSize::new(
            placement.decisions_width,
            placement.height,
        ))?;
        decisions.set_position(LogicalPosition::new(
            x + placement.decisions_x,
            y + placement.y,
        ))?;
    }
    game.show()?;
    game.set_focus()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_compact_windows_on_each_side_of_the_centered_game() {
        let p = layout(1440.0, 900.0, 8.0, 32.0);
        assert_eq!(p.game_width, 640.0);
        assert_eq!(p.controls_width, 320.0);
        assert_eq!(p.decisions_width, 360.0);
        assert_eq!(p.height, 720.0);
        assert!(p.controls_x + p.controls_width + 8.0 <= p.game_x);
        assert!(p.controls_x + p.controls_width + 8.0 <= 1440.0);
    }

    #[test]
    fn shrinks_the_game_to_the_monitor_work_area() {
        let p = layout(1180.0, 728.0, 8.0, 32.0);
        assert_eq!(p.game_width, 640.0);
        assert_eq!(p.height, 664.0);
        assert!(p.controls_x + p.controls_width + 8.0 <= 1180.0);
    }

    #[test]
    fn overlaps_on_narrow_displays_instead_of_hiding_the_controls_offscreen() {
        let p = layout(800.0, 600.0, 8.0, 32.0);
        assert_eq!(p.game_width, 640.0);
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
