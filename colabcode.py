!pip install gmft -q

!pip show gmft

### setup

from IPython.display import display, HTML
from PIL import Image
import io
import base64

def display_html_and_image(html_content, pil_image):
    # Convert the PIL image to a base64 string to embed it directly in the HTML
    img_buffer = io.BytesIO()
    pil_image.save(img_buffer, format='PNG')  # You can change the format if needed
    img_data = base64.b64encode(img_buffer.getvalue()).decode('utf-8')
    img_base64 = f"data:image/png;base64,{img_data}"

    # HTML content to display the image and HTML side by side
    html = f"""
    <style>
    table, th, td {{
        border: 1px solid #A9A9A9 !important;
        border-collapse: collapse;
    }}
    th, td {{
        padding: 2px !important;
        text-align: left;
    }}
    </style>
    <div style="display: flex; align-items: center;">
        <div style="flex: 1; padding-right: 10px;">
            {html_content}
        </div>
        <div style="flex: 1;">
            <img src="{img_base64}" alt="PIL Image" style="max-width: 100%;"/>
        </div>
    </div>
    """

    # Display the HTML and image
    display(HTML(html))

## knowyourpdf

import gmft

from gmft.pdf_bindings import PyPDFium2Document
from gmft.auto import CroppedTable, TableDetector

detector = TableDetector()

from gmft.auto import AutoTableFormatter
from gmft.auto import AutoFormatConfig

config = AutoFormatConfig()
config.semantic_spanning_cells = True # [Experimental] better spanning cells
config.enable_multi_header = True # multi-indices
formatter = AutoTableFormatter(config)

def ingest_pdf(pdf_path) -> list[CroppedTable]:
    doc = PyPDFium2Document(pdf_path)

    tables = []
    for page in doc:
        tables += detector.extract(page)
    return tables, doc


import time
import json
_total_detect_time = 0
_total_detect_num = 0
_total_format_time = 0
_total_format_num = 0

results = []
images = []
dfs = []
for paper in ['2021 income by payer detail.pdf']:
    start = time.time()
    tables, doc = ingest_pdf('./samples/' + paper)
    num_pages = len(doc)
    end_detect = time.time()
    formatted_tables = []
    for i, table in enumerate(tables):
        ft = formatter.extract(table)
        # with open(f'{paper[:-4]}_{i}.info', 'w') as f:
            # f.write(json.dumps(ft.to_dict()))
        try:
            dfs.append(ft.df())
        except Exception as e:
            print(e)
            dfs.append(None)
        formatted_tables.append(ft)
        # cache images, because closing document will prevent image access
        images.append(ft.image())
    end_format = time.time()


    doc.close()
    results += formatted_tables
    print(f"Paper: {paper}\nDetect time: {end_detect - start:.3f}s for {num_pages} pages")
    print(f"Format time: {end_format - end_detect:.3f}s for {len(tables)} tables\n")
    _total_detect_time += end_detect - start
    _total_detect_num += num_pages
    _total_format_time += end_format - end_detect
    _total_format_num += len(tables)
print(f"Macro: {_total_detect_time/_total_detect_num:.3f} s/page and {_total_format_time/_total_format_num:.3f} s/table.")
print(f"Total: {(_total_detect_time+_total_format_num)/(_total_detect_num)} s/page")

from IPython.display import display, Markdown
import pandas as pd
import os

prev_doc = None
for df, img, ft in zip(dfs, images, results):
    with pd.option_context('display.max_rows', 500, "display.multi_sparse", False):
        if ft.page.filename != prev_doc:
            prev_doc = ft.page.filename
            display(Markdown('---'))
            display(Markdown(f'### {ft.page.filename}'))

        if df is not None:
            html = df.fillna("").to_html()
        else:
            html = "Failed to extract table"
        display_html_and_image(html, img)
        display(Markdown('---'))

from IPython.display import display, Markdown
import pandas as pd
import os

prev_doc = None
md_lines = []

for df, img, ft in zip(dfs, images, results):
    with pd.option_context('display.max_rows', 500, "display.multi_sparse", False):
        if ft.page.filename != prev_doc:
            prev_doc = ft.page.filename
            display(Markdown('---'))
            display(Markdown(f'### {ft.page.filename}'))
            md_lines.append("\n---\n")
            md_lines.append(f"### {ft.page.filename}\n")

        if df is not None:
            html = df.fillna("").to_html()
            md_table = df.fillna("").to_markdown(index=False)
            md_lines.append(md_table + "\n")
        else:
            html = "Failed to extract table"
            md_lines.append("Failed to extract table\n")

        display_html_and_image(html, img)
        display(Markdown('---'))
        md_lines.append("\n---\n")

# 写入 Markdown 文件
with open("/content/extracted_tables.md", "w", encoding="utf-8") as f:
    f.writelines(md_lines)

print("✅ Markdown 文件已保存为: /content/extracted_tables.md")
