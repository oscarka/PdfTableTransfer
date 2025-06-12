# PDF表格提取器

这是一个用于从PDF文件中提取表格的Web应用程序。它使用FastAPI作为后端，React作为前端，并利用gmft库进行PDF表格提取。

## 功能特点

- 支持PDF文件上传
- 自动检测和提取PDF中的表格
- 同时显示表格的图片和HTML格式
- 响应式设计，支持移动端访问
- 实时处理反馈

## 技术栈

### 后端
- FastAPI
- gmft
- pandas
- Pillow

### 前端
- React
- Ant Design
- Axios

## 安装和运行

### 后端

1. 创建虚拟环境：
```bash
python -m venv venv
source venv/bin/activate  # Linux/Mac
# 或
.\venv\Scripts\activate  # Windows
```

2. 安装依赖：
```bash
pip install -r requirements.txt
```

3. 运行后端服务：
```bash
uvicorn app.main:app --reload
```

### 前端

1. 进入前端目录：
```bash
cd frontend
```

2. 安装依赖：
```bash
npm install
```

3. 运行开发服务器：
```bash
npm start
```

## 部署

### Railway部署

1. 创建Railway账号并连接GitHub仓库
2. 在Railway中创建新项目
3. 配置环境变量
4. 部署项目

## 使用说明

1. 打开应用首页
2. 点击"选择PDF文件"按钮
3. 选择要处理的PDF文件
4. 等待处理完成
5. 查看提取的表格结果

## 注意事项

- 仅支持PDF文件格式
- 建议PDF文件大小不超过10MB
- 确保PDF文件中的表格清晰可识别

## 许可证

MIT 