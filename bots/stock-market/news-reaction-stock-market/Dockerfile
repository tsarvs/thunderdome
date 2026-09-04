FROM python:3.12-alpine
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY thunderdome_bot_sdk.py bot.py ./
ENTRYPOINT ["python3", "bot.py"]
