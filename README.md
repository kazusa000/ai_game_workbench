# AI Game Workbench

AI Game Workbench 是一个本地优先的 AI 游戏素材工作台。当前主要用于生成、处理和导出 2D 角色动画素材，适合先在本机启动网页使用，再按需要接入自己的 AI API key。

项目目前包含两个主要模块：

- 模块 01：高清 2D 角色制作
- 模块 02：像素角色制作

本项目不内置任何私人 API key。普通用户启动后进入网页，在「API 设置」里选择服务商并填写自己的 key 即可使用。

## 当前能力

### 模块 01：高清 2D 角色制作

模块 01 面向高清 2D 角色动画流程，支持：

- 一键生成基础角色素材
- 角色基准模板生成和上传
- 步行、待机、跑步、跳跃、攻击 1 流程
- 图片生成和视频生成分步处理
- 步行、待机、跑步、攻击、跳跃分别保存模型设置
- 攻击 1 支持起始帧、中间帧和视频生成
- 视频生成后抽帧、绿幕抠图、循环处理
- 角色预览
- Godot 导出
- 模块设置页统一管理提示词、参考图、模型、处理参数

当前模型策略：

- 图片模型：APIMart GPT-Image-2、OpenRouter GPT-Image-2、Nano Banana 2、本地 GPT Image 2 等按服务商配置显示
- 视频模型：Seedance 2.0
- APIMart 的 Seedance 1.0 Pro Quality 可用于步行、跑步、跳跃，但攻击 1 不允许选择该模型

### 模块 02：像素角色制作

模块 02 面向像素角色素材，支持：

- 角色基准模板/待机
- 步行图
- 一键处理
- 像素角色预览
- 模块设置页管理参考图、提示词、模型、处理参数
- 固定角色规格处理：64 x 128，角色高度 96px
- 绿幕抠图、切格、居中、输出透明帧

## 推荐使用方式

### 方式一：下载便携压缩包

如果你只是想使用工具，推荐下载已经打好的便携压缩包。

解压后优先双击根目录启动脚本：

```text
Start AI Game Workbench.bat
```

这个脚本使用相对路径调用真正的启动器，移动到别人的电脑或不同目录后也能正常启动。
也可以直接运行：

```text
tools\launcher\release\AiGameWorkbenchLauncher.exe
```

启动器会自动：

1. 启动本地 API 服务
2. 启动网页前端
3. 启动 Cloudflare Quick Tunnel
4. 等待公网地址可用
5. 打开浏览器进入工作台

终端窗口需要保持打开。关闭终端或按 `Ctrl+C` 会停止后端、前端和 Cloudflare tunnel。

### 方式二：源码开发启动

先安装依赖：

```bash
npm install
```

启动整套工作台：

```bash
npm run dev:workbench
```

单独启动：

```bash
npm run dev:server
npm run dev:web
```

默认地址：

- API 服务：`http://127.0.0.1:8787`
- 网页前端：Vite 启动后会在终端输出地址，通常是 `http://127.0.0.1:5173`

## API 设置

进入网页首页后，打开「API Settings / API 设置」。

目前用户侧主要选择一个服务商：

- APIMart
- OpenRouter

选择服务商后填写该服务商的 API key 并保存。后续模块里的模型下拉只会显示当前服务商可用的模型，以及无需 key 的本地模型。

API key 存在浏览器本地 `localStorage`，不会写进源码。

## Cloudflare Quick Tunnel

视频模型通常需要能被云端访问的 HTTPS 图片地址。工作台启动时会自动创建 Cloudflare Quick Tunnel，把本地素材服务临时暴露成一个 `https://xxxx.trycloudflare.com` 地址。

启动脚本查找 `cloudflared.exe` 的顺序：

1. 环境变量 `CLOUDFLARED_PATH`
2. `tools/cloudflared/cloudflared.exe`
3. `tools/cloudflared.exe`
4. `apps/server/storage/runtime/cloudflared/cloudflared.exe`

如果都找不到，脚本会自动下载 Cloudflare Quick Tunnel runtime。

如果便携包里已经带了 `tools\cloudflared\cloudflared.exe`，第一次启动时就不需要再下载 cloudflared。

不启动公网 tunnel：

```powershell
tools\launcher\release\AiGameWorkbenchLauncher.exe -NoTunnel
```

仅检查启动条件：

```powershell
tools\launcher\release\AiGameWorkbenchLauncher.exe -Check -NoTunnel
```

## 目录说明

```text
apps/server        Fastify API 服务、素材存储、AI/provider 调用、图片/视频处理
apps/web           React + Vite 前端
packages/core      共享类型、模型配置、纯逻辑工具
presets            默认提示词、默认参考图和模块配置
scripts            启动和测试脚本
tools/launcher     Windows 启动器源码和 release exe
```

运行时生成内容主要在：

```text
apps/server/storage
```

这里会保存：

- 用户创建的角色文件夹
- 上传图片
- AI 返回图片和视频
- 抽帧结果
- 导出结果
- provider 设置和运行配置
- Cloudflare tunnel 配置

`apps/server/storage` 是运行数据。生成过的角色、图片、视频和导出结果都会在这里。

## presets 说明

`presets` 是默认配置和默认素材位置。

用户在网页端覆盖提示词或参考图时，应覆盖到当前项目使用的 presets 位置。这样开源压缩包里可以直接带完整默认 presets，用户也能在本地替换成自己的版本。

不要把 API key 放进 presets。

## 环境变量

普通用户使用网页 API 设置即可，不一定需要 `.env`。

开发或服务端 fallback 可复制 `.env.example` 为 `.env`：

```text
OPENROUTER_API_KEY=
OPENAI_COMPATIBLE_BASE_URL=
OPENAI_COMPATIBLE_API_KEY=
ADMIN_SETTINGS_TOKEN=
PUBLIC_ASSET_BASE_URL=http://localhost:8787/assets
FFMPEG_PATH=ffmpeg
STORAGE_DIR=./storage
PRESETS_DIR=./presets
PORT=8787
```

说明：

- 相对 `STORAGE_DIR` 会从 `apps/server` 解析，所以默认 `./storage` 实际是 `apps/server/storage`
- 相对 `PRESETS_DIR` 会从仓库根目录解析，默认是 `./presets`
- `PUBLIC_ASSET_BASE_URL` 通常由启动脚本写入 Cloudflare tunnel 地址，不需要手动填
- `.env` 不要提交

## 常用命令

```bash
npm test
npm run typecheck
npm run build
npm run dev:workbench
npm run dev:server
npm run dev:web
npm run test:launcher
npm run test:workbench-startup
```

按工作区运行：

```bash
npm run test -w apps/server
npm run test -w apps/web
npm run test -w packages/core
npm run typecheck -w apps/server
npm run typecheck -w apps/web
npm run typecheck -w packages/core
```

## 已知限制

- 当前仍是本地工作台，不是多用户在线 SaaS
- API key 保存在浏览器本地，适合个人本机使用
- Cloudflare Quick Tunnel 是临时公网地址，每次启动可能变化
- AI 生成质量取决于所选模型、服务商、账号权限和提示词
- 视频模型需要公网 HTTPS 图片 URL，本地 `127.0.0.1` 图片只能网页预览，云端模型无法直接访问
