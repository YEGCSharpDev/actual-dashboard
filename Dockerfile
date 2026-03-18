FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (this caches the layer so future builds are instant)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code
COPY app.py data.py transforms.py .

# Expose the default Streamlit port
EXPOSE 8501

# Add a healthcheck using native Python so we don't need to install curl
HEALTHCHECK CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8501/_stcore/health')" || exit 1

# Start the Streamlit server
ENTRYPOINT ["streamlit", "run", "app.py", "--server.port=8501", "--server.address=0.0.0.0"]