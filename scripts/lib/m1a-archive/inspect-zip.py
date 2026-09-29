"""Bounded, offline ZIP inspection. Original bytes in; private JSON text out.

No extraction or writes. Run by Node with python -I -S and a stripped environment.
All refusals are fixed codes; exception strings and offending bytes are never emitted.
"""

import io
import json
import re
import stat
import struct
import sys
import zipfile
import zlib

LIMIT = 64 * 1024 * 1024
OUTPUT_LIMIT = 2 * LIMIT + 2 * 1024 * 1024
UNSUPPORTED_SUFFIX = re.compile(r"\.(zip|gz|bz2|xz|7z|rar|tar|tgz|jar|war|docx|xlsx|pptx|pdf|png|jpe?g|exe|dll)$", re.I)


def refuse():
    raise ValueError("M1A_ZIP_REFUSED")


def safe_name(name):
    if not name or len(name) > 1024 or re.search(r'[^\x20-\x7e]|[\\%:*?"<>|]', name):
        refuse()
    path = name[:-1] if name.endswith("/") else name
    for part in path.split("/"):
        if (not part or len(part) > 255 or part in (".", "..") or part.endswith((".", " "))
                or re.match(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)", part, re.I)):
            refuse()
    return path.lower()


def strict_text(data):
    value = data.decode("utf-8", errors="strict")
    if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", value):
        refuse()
    return value


def check_deflate(archive, start, info, inspected):
    # ZipExtFile clamps plaintext to ZipInfo.file_size. Verify the complete
    # compressed stream with bounded zlib output so a forged size/CRC cannot
    # conceal a suffix. zipfile supplies the payload offset after parsing headers.
    archive.fp.seek(start)
    decoder = zlib.decompressobj(-15)
    left = info.compress_size
    count = 0
    while left:
        chunk = archive.fp.read(min(64 * 1024, left))
        if not chunk:
            refuse()
        left -= len(chunk)
        decoded = decoder.decompress(chunk, min(64 * 1024, info.file_size - count + 1))
        while True:
            if count + len(decoded) > info.file_size or decoded != inspected[count:count + len(decoded)]:
                refuse()
            count += len(decoded)
            if decoder.unused_data:
                refuse()
            if not decoder.unconsumed_tail:
                break
            decoded = decoder.decompress(decoder.unconsumed_tail, min(64 * 1024, info.file_size - count + 1))
    if not decoder.eof or count != info.file_size:
        refuse()


def inspect(raw, budget, entry_budget):
    with zipfile.ZipFile(io.BytesIO(raw), "r") as archive:
        infos = archive.infolist()
        if len(infos) > entry_budget:
            refuse()
        # Refuse self-extracting/prefixed ZIPs and appended content. Parsing of
        # members, headers, CRCs and decompression is owned by zipfile, not us.
        end_length = 22 + len(archive.comment)
        if len(raw) < end_length or raw[-end_length:-end_length + 4] != b"PK\x05\x06":
            refuse()
        if infos and min(info.header_offset for info in infos) != 0:
            refuse()
        if not infos and len(raw) != end_length:
            refuse()
        comment = strict_text(archive.comment)
        names = {}
        spellings = {}
        declared = 0
        for info in infos:
            # orig_filename precedes zipfile's NUL truncation/normalization.
            key = safe_name(info.orig_filename)
            if info.orig_filename != info.filename or key in names:
                refuse()
            names[key] = info.is_dir()
            parts = info.orig_filename.rstrip("/").split("/")
            for i in range(1, len(parts) + 1):
                name = "/".join(parts[:i])
                if name.lower() in spellings and spellings[name.lower()] != name:
                    refuse()
                spellings[name.lower()] = name
            mode = (info.external_attr >> 16) & 0xffff
            kind = stat.S_IFMT(mode)
            if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or (kind == stat.S_IFDIR) != info.is_dir() and kind != 0:
                refuse()
            if (info.flag_bits & ~(2 | 4 | 8 | 2048)
                    or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                    or info.compress_type == zipfile.ZIP_STORED and info.flag_bits & (2 | 4)):
                refuse()
            # Unreviewed binary extra-field formats are not an inspection channel.
            if info.extra or info.file_size < 0 or info.file_size > LIMIT or info.compress_size < 0 or info.compress_size > LIMIT:
                refuse()
            if info.is_dir() and info.file_size != 0:
                refuse()
            if UNSUPPORTED_SUFFIX.search(info.filename):
                refuse()
            declared += info.file_size
            if declared > budget:
                refuse()
        for name in names:
            parts = name.split("/")
            if any(names.get("/".join(parts[:i])) is False for i in range(1, len(parts))):
                refuse()
        entries = []
        inflated = 0
        local_order = sorted(infos, key=lambda info: info.header_offset)
        next_offsets = {info.header_offset: local_order[i + 1].header_offset if i + 1 < len(local_order) else archive.start_dir
                        for i, info in enumerate(local_order)}
        for info in infos:
            data = bytearray()
            with archive.open(info, "r") as source:
                payload_start = archive.fp.tell()
                if payload_start != info.header_offset + 30 + len(info.orig_filename.encode("ascii")):
                    refuse()
                # Offsets come from zipfile's parsed directory/local header. Only
                # the standard optional data descriptor may occupy this gap.
                payload_end = payload_start + info.compress_size
                next_offset = next_offsets[info.header_offset]
                gap = next_offset - payload_end
                if info.flag_bits & 8:
                    if gap not in (12, 16):
                        refuse()
                    descriptor = struct.pack("<III", info.CRC, info.compress_size, info.file_size)
                    if gap == 16:
                        descriptor = b"PK\x07\x08" + descriptor
                    if raw[payload_end:next_offset] != descriptor:
                        refuse()
                elif gap != 0:
                    refuse()
                while True:
                    chunk = source.read(min(64 * 1024, budget - inflated + 1))
                    if not chunk:
                        break
                    inflated += len(chunk)
                    if inflated > budget or len(data) + len(chunk) > LIMIT or len(data) + len(chunk) > info.file_size:
                        refuse()
                    data.extend(chunk)
            if len(data) != info.file_size:
                refuse()
            if info.compress_type == zipfile.ZIP_DEFLATED:
                check_deflate(archive, payload_start, info, data)
            elif info.compress_size != info.file_size:
                refuse()
            # Magic detection complements suffix checks; strict UTF-8 rejects
            # unsupported binary payloads even when they masquerade as logs.
            if zipfile.is_zipfile(io.BytesIO(data)) or data[:4] in (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"):
                refuse()
            if data[:5] == b"%PDF-":
                refuse()
            if data[:2] == b"\x1f\x8b" or data[:3] == b"BZh" or data[:6] == b"\xfd7zXZ\x00" or data[:4] == b"Rar!" or data[:6] == b"7z\xbc\xaf\x27\x1c" or data[257:262] == b"ustar":
                refuse()
            entries.append({"name": info.orig_filename, "text": strict_text(data), "comment": strict_text(info.comment)})
        return {"entries": entries, "inflatedBytes": inflated, "comment": comment}


def main():
    if len(sys.argv) != 3 or any(not re.fullmatch(r"[0-9]+", value) for value in sys.argv[1:]):
        refuse()
    budget = int(sys.argv[1])
    entry_budget = int(sys.argv[2])
    if budget < 0 or budget > LIMIT or entry_budget < 0 or entry_budget > 4096:
        refuse()
    raw = sys.stdin.buffer.read(LIMIT + 1)
    if not raw or len(raw) > LIMIT:
        refuse()
    output = json.dumps(inspect(raw, budget, entry_budget), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(output) > OUTPUT_LIMIT:
        refuse()
    sys.stdout.buffer.write(output)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.stderr.write("M1A_ZIP_REFUSED\n")
        sys.exit(1)
