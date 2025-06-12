# ---- 前端构建 ----
FROM node:18 AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- 后端构建 ----
FROM python:3.11-slim AS backend
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/
# 拷贝前端build产物到后端静态目录
COPY --from=frontend /app/frontend/build ./frontend/build

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"] 