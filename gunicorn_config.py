import os

# Configuration Gunicorn pour Render
bind = f"0.0.0.0:{os.environ.get('PORT', 5000)}"
workers = 2
worker_class = "sync"
worker_connections = 1000
keepalive = 2

# Logging
loglevel = "info"
accesslog = "-"
errorlog = "-"

# Performance
preload_app = True
max_requests = 1000
max_requests_jitter = 100

# Timeouts
timeout = 120
graceful_timeout = 30