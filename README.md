## Chat Application

### Overview
- **ingest service**: Exposes an HTTP API to ingest and read messages
- **worker service**: Runs on a fixed interval in the background to process messages (assigns sentiment)

### Run with Docker Compose
- Ensure Docker is installed and running
- From the project root, build and start all services:

```bash
docker-compose up --build
```

- The ingest API will be available on port 3000

### Test the API
Use the following commands in a separate terminal after services are up:

```bash
curl -X POST http://0.0.0.0:3000/v1/messages \
  -H 'Content-Type: application/json' \
  -d '{
        "userId":"u_123",
        "message":"Hello from Ani!",
        "metadata": {"source":"web"}
      }'

curl 'http://0.0.0.0:3000/v1/messages?userId=u_123'
```

### Notes
- The worker runs automatically alongside the ingest service and processes messages in the background on a schedule
- To stop services: Ctrl+C, then optionally remove containers with `docker-compose down` 