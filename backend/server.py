"""
Entry point for the packaged backend executable.
Runs uvicorn programmatically so PyInstaller can bundle it.
"""
import os
import sys
import uvicorn

# When running as a PyInstaller bundle, set working dir to temp dir
if getattr(sys, 'frozen', False):
    os.chdir(os.path.dirname(sys.executable))

if __name__ == '__main__':
    uvicorn.run(
        'main:app',
        host='127.0.0.1',
        port=8000,
        log_level='error',
    )
