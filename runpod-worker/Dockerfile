FROM pytorch/pytorch:2.2.0-cuda12.1-cudnn8-runtime

ENV PYTHONUNBUFFERED=1
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update -qq && apt-get install -y -qq \
    libgl1 libglib2.0-0 git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY handler.py .
COPY preload.py .

# /runpod-volume is the default network volume mount on RunPod serverless.
# Override MODEL_CACHE if you mount the volume at a different path.
ENV MODEL_CACHE=/runpod-volume/models

CMD ["python", "handler.py"]
