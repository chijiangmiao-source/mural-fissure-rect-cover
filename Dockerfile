# syntax=docker/dockerfile:1

# ---- 依赖层 ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- 构建层（类型检查 + 产物） ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- 一次性验收服务：类型检查 + Vitest（含全部 4×4 图样穷举交叉验证）+ Playwright 真实交互 ----
# 使用 Playwright 官方镜像，Chromium 及其系统依赖已预装（浏览器在 /ms-playwright，属主 pwuser）。
FROM mcr.microsoft.com/playwright:v1.49.1-jammy AS verify
# 浏览器已预装：禁止 npm 安装阶段重复下载/改写浏览器缓存目录，避免属主错乱
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_SKIP_BROWSER_GC=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# CJK 字体需要 root 安装；其余全部以镜像内非特权用户 pwuser 执行，
# 保证 /ms-playwright 缓存目录与 ~/.cache 对运行者可写。
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /app && chown pwuser:pwuser /app
USER pwuser
WORKDIR /app
COPY --chown=pwuser:pwuser package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY --chown=pwuser:pwuser . .
# 类型检查 → 全部单元/穷举测试 → 构建并用真实 Chromium 跑端到端交互；跑完即退出
CMD ["npm", "run", "verify"]

# ---- 发布层：纯静态文件由 nginx 提供，无业务后端 ----
FROM nginx:1.27-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
