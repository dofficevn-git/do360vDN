FROM python:3.12-slim
WORKDIR /app
# WITH_OCR=1 để cài PaddleOCR (ảnh lớn, build lâu); mặc định chỉ đọc Excel/Word/PDF có lớp chữ
ARG WITH_OCR=0
COPY requirements.txt requirements-ocr.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
 && if [ "$WITH_OCR" = "1" ]; then apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/* && pip install --no-cache-dir -r requirements-ocr.txt; fi
COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
