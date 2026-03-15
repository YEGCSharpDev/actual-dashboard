FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (this caches the layer so future builds are instant)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code
COPY app.py .

# Expose the default Streamlit port
EXPOSE 8501

# Add a healthcheck so Docker knows the app is actually running
HEALTHCHECK CMD curl --fail http://localhost:8501/_stcore/health || exit 1

# Start the Streamlit server
ENTRYPOINT ["streamlit", "run", "app.py", "--server.port=8501", "--server.address=0.0.0.0"]