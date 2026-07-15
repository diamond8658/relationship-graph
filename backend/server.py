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
    # The Tauri shell picks a free port at launch and passes it via this env
    # var so it doesn't have to fight over a fixed port with a previous
    # crashed instance. Defaults to 8000 for running this file directly
    # outside of Tauri.
    port = int(os.environ.get('BACKEND_PORT', '8000'))
    uvicorn.run(
        app,  # pass the app object directly, not the string 'main:app'
        host='127.0.0.1',
        port=port,
        log_level='warning',
    )
