"""Launch Time2 and persist saves independently from the browser port."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock, Timer
from urllib.parse import urlparse
import argparse
import json
import re
import webbrowser


PROJECT_DIR = Path(__file__).resolve().parent
SAVE_FILE = PROJECT_DIR / "save-data.json"
PORT_FILE = PROJECT_DIR / ".time2-port"
PREFERRED_PORT = 8127
SAVE_LOCK = Lock()
LIFECYCLE_LOCK = Lock()
LIFECYCLE_TIMER = None
LIFECYCLE_GENERATION = 0
AUTO_STOPPED = False
LEGACY_ITEM_FLAG_NUMBERS = (2, 3, 5, 10, 42, 64, 65, 66, 67, 68, 74, 75, 76, 80, 81, 82, 83, 84, 85, 90)


def cancel_pending_shutdown() -> None:
    """Keep the server alive when a game tab is active (including after reload)."""
    global LIFECYCLE_TIMER, LIFECYCLE_GENERATION
    with LIFECYCLE_LOCK:
        LIFECYCLE_GENERATION += 1
        if LIFECYCLE_TIMER is not None:
            LIFECYCLE_TIMER.cancel()
            LIFECYCLE_TIMER = None


def schedule_shutdown(server: ThreadingHTTPServer) -> None:
    """Stop shortly after the game tab closes, unless another tab reports activity."""
    global LIFECYCLE_TIMER, LIFECYCLE_GENERATION, AUTO_STOPPED
    with LIFECYCLE_LOCK:
        LIFECYCLE_GENERATION += 1
        generation = LIFECYCLE_GENERATION
        if LIFECYCLE_TIMER is not None:
            LIFECYCLE_TIMER.cancel()

        def shutdown_if_still_closed() -> None:
            global LIFECYCLE_TIMER, AUTO_STOPPED
            with LIFECYCLE_LOCK:
                if generation != LIFECYCLE_GENERATION:
                    return
                LIFECYCLE_TIMER = None
                AUTO_STOPPED = True
            print("\n  Game tab closed. Stopping the Time2 server.")
            server.shutdown()

        LIFECYCLE_TIMER = Timer(15.0, shutdown_if_still_closed)
        LIFECYCLE_TIMER.daemon = True
        LIFECYCLE_TIMER.start()


def migrate_item_flags(saves: list) -> bool:
    """Copy legacy f-item ownership into the independent i-flag save area."""
    changed = False
    for record in saves:
        if not isinstance(record, dict) or not isinstance(record.get("state"), dict):
            continue
        state = record["state"]
        if isinstance(state.get("itemFlags"), list):
            continue
        legacy_flags = state.get("flags")
        if not isinstance(legacy_flags, list):
            continue
        item_flags = [0] * 100
        for number in LEGACY_ITEM_FLAG_NUMBERS:
            if number < len(legacy_flags) and legacy_flags[number]:
                item_flags[number] = 1
        state["itemFlags"] = item_flags
        state["itemFlagSchemaVersion"] = 3
        acquisition_order = state.get("itemAcquisitionOrder")
        if isinstance(acquisition_order, list):
            state["itemAcquisitionOrder"] = [
                ["i" + entry[0][1:], entry[1]]
                if isinstance(entry, list) and len(entry) == 2 and isinstance(entry[0], str)
                and re.fullmatch(r"f\d{1,2}", entry[0], re.IGNORECASE)
                and int(entry[0][1:]) in LEGACY_ITEM_FLAG_NUMBERS
                else entry
                for entry in acquisition_order
            ]
        changed = True
    return changed


def read_saves() -> list:
    try:
        data = json.loads(SAVE_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return (data + [None] * 60)[:60]
    except (OSError, json.JSONDecodeError):
        pass
    return [None] * 60


def write_saves(saves: list) -> None:
    temporary = SAVE_FILE.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(saves[:60], ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temporary.replace(SAVE_FILE)


def read_install_port() -> int:
    """Keep each extracted copy on its own browser origin."""
    try:
        port = int(PORT_FILE.read_text(encoding="ascii").strip())
        if 1024 <= port <= 65535:
            return port
    except (OSError, ValueError):
        pass
    # Preserve the original development installation and its browser data.
    return PREFERRED_PORT if SAVE_FILE.exists() else 0


def write_install_port(port: int) -> None:
    try:
        PORT_FILE.write_text(str(port), encoding="ascii")
    except OSError:
        pass


class Time2Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PROJECT_DIR), **kwargs)

    def end_headers(self):
        request_path = urlparse(self.path).path.lower()
        uncached_audio = (
            request_path.startswith("/voice/")
            or request_path.startswith("/se/")
        ) and request_path.endswith(".mp3")
        if uncached_audio:
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def send_json(self, value, status=200):
        payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if urlparse(self.path).path == "/api/saves":
            with SAVE_LOCK:
                self.send_json(read_saves())
            return
        super().do_GET()

    def do_POST(self):
        request_path = urlparse(self.path).path
        if request_path == "/api/lifecycle/ping":
            cancel_pending_shutdown()
            self.send_json({"ok": True})
            return
        if request_path == "/api/lifecycle/close":
            schedule_shutdown(self.server)
            self.send_json({"ok": True})
            return
        match = re.fullmatch(r"/api/saves/(\d+)", request_path)
        if not match:
            self.send_error(404)
            return
        slot = int(match.group(1))
        if not 1 <= slot <= 60:
            self.send_json({"error": "invalid slot"}, 400)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            record = json.loads(self.rfile.read(length).decode("utf-8"))
            with SAVE_LOCK:
                saves = read_saves()
                saves[slot - 1] = record
                write_saves(saves)
            self.send_json({"ok": True})
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError, OSError):
            self.send_json({"error": "save failed"}, 400)


def main() -> None:
    parser = argparse.ArgumentParser(description="Time2 local server")
    parser.add_argument("--port", type=int, help="Use a specific port to recover old browser saves")
    args = parser.parse_args()
    with SAVE_LOCK:
        existing_saves = read_saves()
        if migrate_item_flags(existing_saves):
            write_saves(existing_saves)
    requested_port = args.port if args.port is not None else read_install_port()
    try:
        server = ThreadingHTTPServer(("127.0.0.1", requested_port), Time2Handler)
    except OSError:
        if args.port:
            raise
        server = ThreadingHTTPServer(("127.0.0.1", 0), Time2Handler)
        print(f"  Port {requested_port} is in use; using a new available port.")

    port = server.server_address[1]
    if args.port is None:
        write_install_port(port)
    url = f"http://127.0.0.1:{port}/"
    print()
    print("  Time2 server is running.")
    print(f"  {url}")
    print("  Saves are stored in save-data.json.")
    print("  Press Ctrl+C to stop the server.")
    print()
    Timer(0.5, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server stopped.")
    finally:
        cancel_pending_shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
