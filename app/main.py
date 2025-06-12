import os
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["VECLIB_MAXIMUM_THREADS"] = "1"
os.environ["NUMEXPR_NUM_THREADS"] = "1"

import logging
logging.basicConfig(level=logging.INFO, force=True)

try:
    import torch
    torch.set_num_threads(1)
except ImportError:
    pass

from fastapi import FastAPI, UploadFile, File, HTTPException, Body, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
import os
import json
from typing import List, Union, Tuple
import pandas as pd
from PIL import Image
import io
import base64
import gmft
from gmft.pdf_bindings import PyPDFium2Document
from gmft.table_detection import CroppedTable, TableDetector
from gmft.table_function import TATRTableFormatter, TATRFormatConfig
import logging
from fastapi.staticfiles import StaticFiles

app = FastAPI()

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 创建上传文件目录
UPLOAD_DIR = "uploads"
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR)

# 初始化表格检测器
detector = TableDetector()
config = TATRFormatConfig()
formatter = TATRTableFormatter(config)

# 静态文件托管（/static，彻底分离API和前端资源）
if os.path.exists('frontend/build'):
    app.mount("/static", StaticFiles(directory="frontend/build", html=True), name="static")

@app.get("/")
def read_index():
    return FileResponse("frontend/build/index.html")

def process_pdf(pdf_path: str, file_name: str) -> List[dict]:
    try:
        doc = PyPDFium2Document(pdf_path)
        tables = []
        for page in doc:
            tables += detector.extract(page)
        
        results = []
        for idx, table in enumerate(tables):
            ft = formatter.extract(table)
            df = ft.df()
            
            # 转换图片为base64
            img = ft.image()
            img_buffer = io.BytesIO()
            img.save(img_buffer, format='PNG')
            img_str = base64.b64encode(img_buffer.getvalue()).decode('utf-8')
            
            # 转换DataFrame为HTML
            html_table = df.fillna("").to_html()
            
            results.append({
                "html_table": html_table,
                "image": f"data:image/png;base64,{img_str}",
                "data": df.to_dict(orient='records'),
                "pageIndex": getattr(table, 'page_index', idx + 1),
                "fileName": file_name
            })
        
        doc.close()
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/upload")
async def upload_file(request: Request, file: UploadFile = File(...)):
    logging.warning(f"/upload: 收到请求 method={request.method} headers={dict(request.headers)}")
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="只支持PDF文件")
    
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    try:
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
        
        results = process_pdf(file_path, file.filename)
        logging.warning(f"/upload: 共返回{len(results)}个表格")
        for idx, t in enumerate(results):
            cols = t.get('columns') or (t['data'][0].keys() if t['data'] else [])
            logging.warning(f"/upload: 表格{idx+1} columns={list(cols)}")
        return JSONResponse(content={"tables": results})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        pass

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.post("/reprocess")
async def reprocess_page(data: dict = Body(...)):
    logging.warning(f"收到/reprocess请求: {data}")
    file_name = data.get("fileName")
    page_index = data.get("pageIndex")
    if not file_name or not page_index:
        logging.error(f"参数缺失: fileName={file_name}, pageIndex={page_index}")
        raise HTTPException(status_code=400, detail="缺少文件名或页码")
    pdf_path = os.path.join(UPLOAD_DIR, file_name)
    if not os.path.exists(pdf_path):
        logging.error(f"文件未找到: {pdf_path}")
        raise HTTPException(status_code=404, detail="文件未找到")
    try:
        doc = PyPDFium2Document(pdf_path)
        page = doc[page_index - 1]
        tables = detector.extract(page)
        logging.warning(f"/reprocess: 检测到 {len(tables)} 个表格")
        results = []
        for idx, table in enumerate(tables):
            ft = formatter.extract(table)
            df = ft.df()
            # 兜底：如果所有列名都为空，则用首行内容作为表头
            if all(str(col).strip() == '' for col in df.columns):
                logging.warning(f"/reprocess: columns全空，自动用首行内容作为表头")
                if len(df) > 1:
                    df.columns = df.iloc[0].tolist()
                    df = df.iloc[1:].reset_index(drop=True)
            logging.warning(f"/reprocess: 表格{idx} shape={df.shape} columns={list(df.columns)} 前3行={df.head(3).to_dict(orient='records')}\n实际内容:\n{df.head(5)}")
            img = ft.image()
            img_buffer = io.BytesIO()
            img.save(img_buffer, format='PNG')
            img_str = base64.b64encode(img_buffer.getvalue()).decode('utf-8')
            html_table = df.fillna("").to_html()
            results.append({
                "html_table": html_table,
                "image": f"data:image/png;base64,{img_str}",
                "data": df.to_dict(orient='records'),
                "pageIndex": page_index,
                "fileName": file_name,
                "columns": list(df.columns)
            })
        doc.close()
        logging.warning(f"/reprocess处理完成，返回{len(results)}个表格，首个表格数据keys: {list(results[0].keys()) if results else '无'}")
        return results[0] if results else {}
    except Exception as e:
        logging.error(f"/reprocess处理异常: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.middleware("http")
async def log_requests(request: Request, call_next):
    logging.warning(f"[middleware] 收到请求: {request.method} {request.url.path}")
    response = await call_next(request)
    return response 