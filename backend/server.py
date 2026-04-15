"""
Entry point for the packaged backend executable.
Runs uvicorn programmatically so PyInstaller can bundle it.
"""
import os
import sys

# When running as a PyInstaller bundle, _MEIPASS contains all bundled files.
# We add it to sys.path and chdir to it so that imports work correctly.
if getattr(sys, 'frozen', False):
    bundle_dir = sys._MEIPASS  # type: ignore
    os.chdir(bundle_dir)
    sys.path.insert(0, bundle_dir)

# Import app directly rather than using a string reference —
# uvicorn's string-based import ('main:app') can fail inside a PyInstaller
# bundle because the module finder doesn't see bundled .pyc files the same way.
from main import app  # noqa: E402
import uvicorn

if __name__ == '__main__':
    uvicorn.run(
        app,  # pass the app object directly, not the string 'main:app'
        host='127.0.0.1',
        port=8000,
        log_level='warning',
    )
