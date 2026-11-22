"""Сервис озвучки для Мурзика на Silero TTS (русский, v4). Для Hugging Face Space (SDK: Gradio)."""
import hmac
import io
import os
import re
import wave

import gradio as gr
import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

torch.set_num_threads(max(1, os.cpu_count() or 2))
SAMPLE_RATE = 24000
VOICES = {"aidar", "baya", "kseniya", "xenia", "eugene"}
TOKEN = os.environ.get("TTS_TOKEN", "")

model, _ = torch.hub.load(
    repo_or_dir="snakers4/silero-models", model="silero_tts", language="ru", speaker="v4_ru", trust_repo=True
)
model.to(torch.device("cpu"))

# Если на Space включён ZeroGPU, ему нужна хотя бы одна @spaces.GPU-функция (мы GPU не используем)
try:
    import spaces

    @spaces.GPU
    def _gpu_stub():
        return 1
except Exception:
    pass

app = FastAPI()


class Req(BaseModel):
    text: str
    speaker: str = "xenia"


def clean(text: str) -> str:
    text = re.sub(r"[^0-9А-Яа-яЁё\s.,!?;:\-—()«»\"']", " ", text)
    return re.sub(r"\s+", " ", text).strip()[:400]


@app.post("/tts")
def tts(req: Req, x_token: str = Header(default="")):
    if not TOKEN or not hmac.compare_digest(x_token, TOKEN):
        raise HTTPException(status_code=401, detail="bad token")
    text = clean(req.text)
    if not text:
        raise HTTPException(status_code=400, detail="empty text")
    speaker = req.speaker if req.speaker in VOICES else "xenia"
    audio = model.apply_tts(text=text, speaker=speaker, sample_rate=SAMPLE_RATE, put_accent=True, put_yo=True)
    pcm = (np.clip(audio.numpy(), -1.0, 1.0) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    return Response(content=buf.getvalue(), media_type="audio/wav")


# Gradio нужен только для того, чтобы Space считался рабочим; сама озвучка идёт через /tts
with gr.Blocks() as demo:
    gr.Markdown("Murzik TTS работает.")
app = gr.mount_gradio_app(app, demo, path="/")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
