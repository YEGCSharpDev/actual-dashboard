FROM python:3.11-slim

# Install Node.js and npm for Actual CLI
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (this caches the layer so future builds are instant)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application and sidecar code
COPY app.py data.py transforms.py actual-helper.js package.json package-lock.json .

# Install sidecar dependencies (P0-Z: use npm ci for immutable builds)
RUN npm ci

# Expose the default Streamlit port
EXPOSE 8501

# Add a healthcheck using native Python so we don't need to install curl
HEALTHCHECK CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8501/_stcore/health')" || exit 1

# Start the Streamlit server
ENTRYPOINT ["streamlit", "run", "app.py", "--server.port=8501", "--server.address=0.0.0.0"]
