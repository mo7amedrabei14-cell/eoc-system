FROM python:3.9
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY ai_radar.py .
CMD ["python", "ai_radar.py"]