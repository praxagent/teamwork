"""Browser CDP proxy — streams Chrome screenshots to the frontend."""

import asyncio
import json
import logging

import httpx
import websockets
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from teamwork.config import settings

router = APIRouter(prefix="/browser", tags=["browser"])
logger = logging.getLogger(__name__)


@router.get("/info")
async def browser_info():
    """Check whether Chrome is reachable on the sandbox."""
    url = f"http://{settings.chrome_cdp_host}:{settings.chrome_cdp_port}/json/version"
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(url, headers={"Host": f"127.0.0.1:{settings.chrome_cdp_port}"})
            data = resp.json()
            return {"available": True, "browser": data.get("Browser", "unknown")}
    except Exception as e:
        return {"available": False, "error": str(e)}


async def _discover_cdp_ws_url() -> str | None:
    """Return the CDP WebSocket debugger URL for the most relevant page target.

    Picks the *last* page target — Chrome appends new tabs/popups at the end,
    so this naturally follows auth popups and new windows.
    """
    url = f"http://{settings.chrome_cdp_host}:{settings.chrome_cdp_port}/json"
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(url, headers={"Host": f"127.0.0.1:{settings.chrome_cdp_port}"})
            targets = resp.json()
    except Exception:
        return None

    pages = [t for t in targets if t.get("type") == "page"]
    if not pages:
        return None

    # Prefer the last (most recently opened) page target
    page = pages[-1]
    ws_url: str = page["webSocketDebuggerUrl"]
    ws_url = ws_url.replace("localhost", settings.chrome_cdp_host)
    ws_url = ws_url.replace("127.0.0.1", settings.chrome_cdp_host)
    ws_url = ws_url.replace(":9222/", f":{settings.chrome_cdp_port}/")
    return ws_url


@router.websocket("/ws/{project_id}")
async def browser_websocket(
    websocket: WebSocket,
    project_id: str,
    width: int = Query(default=1280),
    height: int = Query(default=900),
    quality: int = Query(default=60),
    fps: int = Query(default=5),
):
    """Stream Chrome screenshots and relay input events via CDP."""
    await websocket.accept()

    cdp_ws_url = await _discover_cdp_ws_url()
    logger.info("CDP WS URL: %s", cdp_ws_url)
    if not cdp_ws_url:
        await websocket.send_json({"type": "error", "message": "Chrome not reachable"})
        await websocket.close()
        return

    cdp_msg_id = 0
    # Pending CDP responses keyed by message ID
    pending: dict[int, asyncio.Future] = {}

    try:
        cdp_ws = await websockets.connect(
            cdp_ws_url,
            max_size=10 * 1024 * 1024,
            additional_headers={"Host": f"127.0.0.1:{settings.chrome_cdp_port}"},
        )
        logger.info("CDP WebSocket connected")
    except Exception as e:
        logger.error("CDP connect failed: %s", e)
        await websocket.send_json({"type": "error", "message": f"CDP connect failed: {e}"})
        await websocket.close()
        return

    async def send_cdp(method: str, params: dict | None = None) -> int:
        nonlocal cdp_msg_id
        cdp_msg_id += 1
        mid = cdp_msg_id
        msg: dict = {"id": mid, "method": method}
        if params:
            msg["params"] = params
        await cdp_ws.send(json.dumps(msg))
        return mid

    async def send_cdp_and_wait(method: str, params: dict | None = None, timeout: float = 5) -> dict:
        mid = await send_cdp(method, params)
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        pending[mid] = fut
        try:
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            pending.pop(mid, None)
            return {}

    await websocket.send_json({"type": "status", "connected": True})

    # Enable page domain for navigation events
    await send_cdp("Page.enable")

    # Set viewport size
    await send_cdp("Emulation.setDeviceMetricsOverride", {
        "width": width,
        "height": height,
        "deviceScaleFactor": 1,
        "mobile": False,
    })

    stop_event = asyncio.Event()
    # Track the current CDP target ID so we can detect tab changes
    current_target_ws = cdp_ws_url

    # --- Task 1: Read CDP responses and dispatch ---
    async def read_cdp():
        try:
            async for raw in cdp_ws:
                data = json.loads(raw)
                # Dispatch responses to waiters
                mid = data.get("id")
                if mid and mid in pending:
                    pending.pop(mid).set_result(data)
                    continue
                # Handle events
                method = data.get("method")
                if method == "Page.frameNavigated":
                    url = data.get("params", {}).get("frame", {}).get("url", "")
                    try:
                        await websocket.send_json({"type": "navigated", "url": url})
                    except Exception:
                        break
        except (websockets.ConnectionClosed, WebSocketDisconnect):
            pass
        except Exception:
            logger.debug("read_cdp error", exc_info=True)
        finally:
            stop_event.set()

    # --- Task 2: Poll screenshots at target FPS ---
    async def screenshot_loop():
        interval = 1.0 / max(fps, 1)
        frame_count = 0
        while not stop_event.is_set():
            try:
                result = await send_cdp_and_wait("Page.captureScreenshot", {
                    "format": "jpeg",
                    "quality": quality,
                }, timeout=3)
                b64_data = result.get("result", {}).get("data")
                if b64_data:
                    frame_count += 1
                    if frame_count <= 2:
                        logger.info("Screenshot frame #%d, size=%d bytes", frame_count, len(b64_data))
                    await websocket.send_json({
                        "type": "frame",
                        "data": b64_data,
                        "metadata": {"deviceWidth": width, "deviceHeight": height},
                    })
            except (WebSocketDisconnect, websockets.ConnectionClosed):
                break
            except Exception:
                pass
            await asyncio.sleep(interval)
        stop_event.set()

    # --- Task 3: Read client input events ---
    async def read_client():
        while not stop_event.is_set():
            try:
                raw = await websocket.receive_text()
                msg = json.loads(raw)
                t = msg.get("type")
                logger.debug("Client msg: %s", t)

                if t == "mouse":
                    await send_cdp("Input.dispatchMouseEvent", {
                        "type": msg["event"],
                        "x": msg["x"],
                        "y": msg["y"],
                        "button": msg.get("button", "left"),
                        "clickCount": msg.get("clickCount", 0),
                        "modifiers": msg.get("modifiers", 0),
                    })
                elif t == "key":
                    await send_cdp("Input.dispatchKeyEvent", {
                        "type": msg["event"],
                        "key": msg.get("key", ""),
                        "code": msg.get("code", ""),
                        "text": msg.get("text", ""),
                        "modifiers": msg.get("modifiers", 0),
                        "windowsVirtualKeyCode": msg.get("windowsVirtualKeyCode", 0),
                    })
                elif t == "scroll":
                    await send_cdp("Input.dispatchMouseEvent", {
                        "type": "mouseWheel",
                        "x": msg["x"],
                        "y": msg["y"],
                        "deltaX": msg.get("deltaX", 0),
                        "deltaY": msg.get("deltaY", 0),
                        "modifiers": msg.get("modifiers", 0),
                    })
                elif t == "navigate":
                    url = msg.get("url", "")
                    logger.info("Navigate to: %s", url)
                    await send_cdp_and_wait("Page.navigate", {"url": url}, timeout=10)
                elif t == "clipboard_paste":
                    # Inject text from the user's local clipboard into the
                    # sandbox Chrome page via Input.insertText (works like a
                    # native paste — triggers input/change events correctly).
                    text = msg.get("text", "")
                    if text:
                        await send_cdp("Input.insertText", {"text": text})
                elif t == "clipboard_copy":
                    # Read the current selection from the sandbox Chrome and
                    # send it back so the frontend can write it to the user's
                    # local clipboard.
                    result = await send_cdp_and_wait(
                        "Runtime.evaluate",
                        {"expression": "window.getSelection()?.toString() || ''"},
                        timeout=3,
                    )
                    selected = result.get("result", {}).get("result", {}).get("value", "")
                    try:
                        await websocket.send_json({"type": "clipboard_content", "text": selected})
                    except Exception:
                        pass
                elif t == "eval":
                    expr = msg.get("expression", "")
                    await send_cdp("Runtime.evaluate", {"expression": expr})
                else:
                    logger.warning("Unknown client msg type: %s", t)
            except WebSocketDisconnect:
                break
            except Exception:
                logger.exception("read_client error")
                break
        stop_event.set()

    # --- Task 4: Detect new tabs/popups and reconnect CDP ---
    async def tab_watcher():
        """Periodically check if a new tab has opened (e.g. OAuth popup).
        If so, reconnect the CDP WebSocket to the newest tab so screenshots
        and input follow the popup."""
        nonlocal cdp_ws, cdp_msg_id, current_target_ws
        while not stop_event.is_set():
            await asyncio.sleep(2)
            try:
                new_ws_url = await _discover_cdp_ws_url()
                if new_ws_url and new_ws_url != current_target_ws:
                    logger.info("Tab change detected: %s -> %s", current_target_ws, new_ws_url)
                    # Close old connection
                    try:
                        await cdp_ws.close()
                    except Exception:
                        pass
                    # Connect to new target
                    cdp_ws = await websockets.connect(
                        new_ws_url,
                        max_size=10 * 1024 * 1024,
                        additional_headers={"Host": f"127.0.0.1:{settings.chrome_cdp_port}"},
                    )
                    current_target_ws = new_ws_url
                    cdp_msg_id = 0
                    pending.clear()
                    # Re-enable Page events on new target
                    await send_cdp("Page.enable")
                    await send_cdp("Emulation.setDeviceMetricsOverride", {
                        "width": width, "height": height,
                        "deviceScaleFactor": 1, "mobile": False,
                    })
                    logger.info("Reconnected CDP to new tab")
                    # Restart the CDP reader for the new connection
                    # (the old read_cdp will exit on ConnectionClosed)
            except Exception:
                logger.debug("tab_watcher error", exc_info=True)

    cdp_task = asyncio.create_task(read_cdp())
    screenshot_task = asyncio.create_task(screenshot_loop())
    client_task = asyncio.create_task(read_client())
    tab_task = asyncio.create_task(tab_watcher())

    try:
        done, remaining = await asyncio.wait(
            [cdp_task, screenshot_task, client_task, tab_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        stop_event.set()
        for task in remaining:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    finally:
        try:
            await cdp_ws.close()
        except Exception:
            pass
