mod actions;
mod analysis;
mod aws;
mod cache;
mod convert;
mod deploywatch;
mod ecs;
mod error;
mod exec;
mod fleet;
mod logs;
mod metrics;
mod models;
mod ops;
mod poller;
mod profiles;
mod state;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build(),
                )?;
            }
            let state = state::AppState::new(app.handle())?;
            app.manage(state);
            poller::spawn(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cache::get_settings,
            cache::update_settings,
            profiles::list_profiles,
            profiles::set_read_only,
            profiles::sso_login,
            profiles::whoami,
            ecs::list_clusters,
            ecs::list_services,
            ecs::get_service,
            ecs::list_tasks,
            ecs::get_task,
            ecs::get_task_definition,
            ecs::list_task_definition_revisions,
            poller::set_focus,
            poller::poll_status,
            poller::refresh_now,
            actions::force_deploy,
            actions::scale_service,
            actions::rollback_service,
            actions::stop_task,
            logs::resolve_log_targets,
            logs::start_log_tail,
            logs::stop_log_tail,
            logs::search_logs,
            metrics::get_metrics,
            exec::exec_check,
            exec::exec_start,
            exec::exec_write,
            exec::exec_resize,
            exec::exec_stop,
            analysis::analyze_stopped_tasks,
            deploywatch::watch_deployment,
            deploywatch::list_watches,
            deploywatch::unwatch,
            fleet::fleet_scan,
            fleet::fleet_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
