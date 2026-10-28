"""PromptVault — AI image prompt & PNG metadata manager.

Quick use as a library::

    from promptvault import read_metadata, Library, Matrix

    meta = read_metadata("image.png")          # ParsedMeta(prompt, negative, params...)
    lib = Library("library.db"); lib.scan("outputs/")
    total, rows = lib.search('tag:"red hair" gen:comfyui')
    Matrix("a {cat|dog} in {snow|rain}").rows()
"""
from pathlib import Path

__version__ = "1.0.0"

from .db import Library, parse_query  # noqa: E402
from .export import export_rows  # noqa: E402
from .matrix import Matrix, MatrixError, MatrixSpec, expand, parse_template  # noqa: E402
from .parsers import ParsedMeta, parse_metadata  # noqa: E402
from .pngmeta import read_png_info, read_png_text, write_png_text  # noqa: E402
from .tokens import extract_loras, extract_tags  # noqa: E402


def read_metadata(path: str | Path) -> ParsedMeta:
    """Read and parse the metadata of a single PNG file."""
    return parse_metadata(read_png_text(path))


__all__ = [
    "Library", "Matrix", "MatrixError", "MatrixSpec", "ParsedMeta", "expand", "export_rows",
    "extract_loras", "extract_tags", "parse_metadata", "parse_query", "parse_template",
    "read_metadata", "read_png_info", "read_png_text", "write_png_text", "__version__",
]
