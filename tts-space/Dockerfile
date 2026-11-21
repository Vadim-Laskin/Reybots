FROM python:3.10-slim

RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir fastapi uvicorn numpy omegaconf pyyaml

WORKDIR /app
ENV TORCH_HOME=/app/cache HOME=/app
COPY app.py .
# модель скачивается один раз при сборке, а не при каждом пробуждении
RUN python -c "import torch; torch.hub.load(repo_or_dir='snakers4/silero-models', model='silero_tts', language='ru', speaker='v4_ru', trust_repo=True)" \
 && chmod -R 777 /app

EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
