#!/usr/bin/env python3
"""Rebuild data/catalog.json from the public sources. See godex/catalog_build.py for what it reads.

    python tools/build_catalog.py            # download (or reuse cached) sources, write data/catalog.json
    python tools/build_catalog.py --refresh  # force a fresh download
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from godex.catalog_build import main  # noqa: E402

main()
