"""
Entry point for the packaged backend executable.
Runs uvicorn programmatically so PyInstaller can bundle it.
"""
import os
import sys

# When running as a PyInstaller bundle, add the bundle dir to path
# so that main.py and models.py etc. are importable
if getattr(sys, 'frozen', False):
    bundle_dir = sys._MEIPASS  # type: ignore
    os.chdir(bundle_dir)
    sys.path.insert(0, bundle_dir)

import uvicorn

if __name__ == '__main__':
    uvicorn.run(
        'main:app',
        host='127.0.0.1',
        port=8000,
        log_level='warning',
    )
