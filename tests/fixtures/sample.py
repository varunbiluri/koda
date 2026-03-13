import os
from pathlib import Path
from typing import Optional, List

MAX_RETRIES = 3

class DataProcessor:
    """Processes data files from a directory."""

    def __init__(self, base_dir: str):
        self.base_dir = Path(base_dir)
        self.processed: List[str] = []

    def process_file(self, filename: str) -> Optional[dict]:
        """Process a single file and return its contents."""
        filepath = self.base_dir / filename
        if not filepath.exists():
            return None
        with open(filepath) as f:
            data = f.read()
        self.processed.append(filename)
        return {"name": filename, "content": data}

    def get_stats(self) -> dict:
        return {
            "total": len(self.processed),
            "base_dir": str(self.base_dir),
        }


def find_files(directory: str, extension: str = ".txt") -> List[str]:
    """Find all files with given extension in directory."""
    result = []
    for root, dirs, files in os.walk(directory):
        for f in files:
            if f.endswith(extension):
                result.append(os.path.join(root, f))
    return result


@property
def cached_result(self):
    return self._cache
