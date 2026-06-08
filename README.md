<div align="center">

# 🖥️ ECS Desk

**A desktop app for AWS ECS, similar to Lens for Kubernetes.**

See clusters, services, tasks, logs, and metrics on one screen.
Exec into containers and deploy in one click.

[![CI](https://github.com/sanjeepan23/ecs-desk/actions/workflows/ci.yml/badge.svg)](https://github.com/sanjeepan23/ecs-desk/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-0.1.0-informational)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-1.88%2B-B7410E?logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white)

![Overview](docs/screenshots/overview.png)

</div>

> [!NOTE]
> "ECS Desk" is a working name. The screenshots show the example data that `pnpm dev` uses. They do not show a real AWS account.

## ✨ Features

| | Feature | What it does |
| --- | --- | --- |
| 🗺️ | **One view for each region** | See clusters, services, and tasks in a resource tree. The overview shows the services that need attention. |
| 🔍 | **Service details** | See rollout progress, events, tasks, logs, metrics, and the task definition on one page. |
| 📜 | **Live logs** | Tail CloudWatch Logs for a service. Filter by level, search lines, pause, and load earlier lines. |
| 📈 | **Metrics** | See CPU and memory charts from CloudWatch for 1 h, 6 h, 24 h, or 7 d. |
| ⚡ | **Actions** | Scale a service, force a new deployment, roll back, and stop tasks. |
| 💻 | **Exec** | Open a shell in a running container with ECS Exec. |
| 🛑 | **Stopped tasks** | Group stopped tasks by cause, for example out of memory or failed health checks. |
| 🚀 | **Deploy watch** | Follow a rollout and get a desktop notification when it ends or fails. |
| 🌍 | **All accounts** | Scan every AWS profile and region, and list the services that are not healthy. |
| ⌨️ | **Command palette** | Press `⌘K` to go to any cluster, service, or task. |
| 🌗 | **Themes** | Use the light theme, the dark theme, or follow the system. |

## 📸 Screenshots

