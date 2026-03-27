"""CLI entry point for running TeamWork standalone."""
import uvicorn

def main():
    uvicorn.run("teamwork.main:app", host="0.0.0.0", port=8000, reload=False)

if __name__ == "__main__":
    main()
