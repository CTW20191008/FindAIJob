FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY static ./static
COPY profile ./profile
COPY docs ./docs

# 若有根目录 Markdown 笔记，构建前放在仓库根下由下面一行打包；当前笔记在 docs/ 已足够
COPY run.py .

EXPOSE 8848
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8848"]
