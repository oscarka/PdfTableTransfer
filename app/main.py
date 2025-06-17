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
            # 兜底1：如果所有列名都为空，则用首行内容作为表头
            if all(str(col).strip() == '' for col in df.columns):
                logging.warning(f"/reprocess: columns全空，自动用首行内容作为表头")
                if len(df) > 1:
                    df.columns = df.iloc[0].tolist()
                    df = df.iloc[1:].reset_index(drop=True)
            # 兜底2：只要有空或重复列名，自动生成唯一列名
            if len(set(df.columns)) < len(df.columns) or any(str(col).strip() == '' for col in df.columns):
                logging.warning(f"/reprocess: 列名有空或重复，自动生成唯一列名")
                df.columns = [col if str(col).strip() else f'列{i+1}' for i, col in enumerate(df.columns)]
                seen = {}
                new_cols = []
                for col in df.columns:
                    if col in seen:
                        seen[col] += 1
                        new_cols.append(f"{col}_{seen[col]}")
                    else:
                        seen[col] = 1
                        new_cols.append(col)
                df.columns = new_cols
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

@app.post("/copy_header")
async def copy_header(data: dict = Body(...)):
    """
    复制某页表头到另一页表格。
    参数：fileName, fromPageIndex, toPageIndex, restoreFirstRow
    """
    file_name = data.get("fileName")
    from_page = data.get("fromPageIndex")
    to_page = data.get("toPageIndex")
    restore_first_row = data.get("restoreFirstRow", False)
    if not file_name or not from_page or not to_page:
        raise HTTPException(status_code=400, detail="缺少参数")
    pdf_path = os.path.join(UPLOAD_DIR, file_name)
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="文件未找到")
    try:
        doc = PyPDFium2Document(pdf_path)
        # 提取来源页表头
        from_tables = detector.extract(doc[from_page - 1])
        if not from_tables:
            raise HTTPException(status_code=404, detail="来源页未检测到表格")
        from_ft = formatter.extract(from_tables[0])
        from_df = from_ft.df()
        header = list(from_df.columns)
        # 提取目标页表格
        to_tables = detector.extract(doc[to_page - 1])
        if not to_tables:
            raise HTTPException(status_code=404, detail="目标页未检测到表格")
        to_ft = formatter.extract(to_tables[0])
        to_df = to_ft.df()
        # 记录当前表头内容（这个才是"原本被当作表头的那一行"）
        original_header_content = list(to_df.columns) if len(to_df.columns) > 0 else None
        print("[copy_header调试] 当前表头内容:", original_header_content)
        # 用来源页表头替换目标页表格的列名
        if len(header) == len(to_df.columns):
            to_df.columns = header
        else:
            # 列数不一致时，补齐或截断
            to_df.columns = header[:len(to_df.columns)] + [f"列{i+1}" for i in range(len(header), len(to_df.columns))]
        # 如果需要恢复首行为数据
        if restore_first_row and original_header_content is not None:
            # 把原本的表头内容作为第一行数据插入
            row = (original_header_content + [""] * len(to_df.columns))[:len(to_df.columns)]
            print("[copy_header调试] 把原表头内容作为第一行插入:", row)
            to_df = pd.concat([pd.DataFrame([row], columns=to_df.columns), to_df.reset_index(drop=True)], ignore_index=True)
        # 返回修正后的表格数据
        html_table = to_df.fillna("").to_html()
        img = to_ft.image()
        img_buffer = io.BytesIO()
        img.save(img_buffer, format='PNG')
        img_str = base64.b64encode(img_buffer.getvalue()).decode('utf-8')
        doc.close()
        return {
            "html_table": html_table,
            "image": f"data:image/png;base64,{img_str}",
            "data": to_df.to_dict(orient='records'),
            "pageIndex": to_page,
            "fileName": file_name,
            "columns": list(to_df.columns)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.middleware("http")
async def log_requests(request: Request, call_next):
    logging.warning(f"[middleware] 收到请求: {request.method} {request.url.path}")
    response = await call_next(request)
    return response 