#!/usr/bin/env python3
"""Offline oracle refresh: only stdlib + installed 7zz/7z, never chm-kit.

Run from the repository root: python3 test/conformance/refresh-oracles.py
Inputs are pinned here. This does not download or execute CHM/installer content.
"""
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1] / "fixtures" / "upstream-chm"
MSPACK = "https://github.com/kyz/libmspack/blob/55d501976171397ccd5d5a7a1ca7da065b1d9a06/libmspack/"
PYCHM = "https://github.com/dottedmag/pychm/blob/9db50a881aa19649da100e5168d45401ee8f694b/"
INNO = "https://github.com/jrsoftware/issrc/blob/2527da77ff7983514f535d19391a748c5d898336/"
PUTTY = "https://git.tartarus.org/?p=simon/putty.git;a=commit;h=d2c178c49a0ae6fa9ef75ca84fb3c9d0d675ea85"
SEVEN = "https://github.com/ip7z/7zip/tree/5b39dc76f1bc82f941d5c800ab9f34407a06b53a"
# Documentation/license evidence, NOT a known build commit for the release CHM.
FPC_DOC = "https://raw.githubusercontent.com/fpc/FPCDocumentation/28a887047f9fa593dff284cb35b938cdb2f86268/"
FPC_DOWNLOAD = "https://downloads.freepascal.org/fpc/dist/3.2.2/docs/doc-chm.zip"

NORMAL = [
    ("putty-0.83.chm", "3508241b8284fa643a69e6cbbde1a8273748c0d9ad4312be70cb90f26a474ac3", "MIT", "LICENSE.putty", PUTTY, "https://the.earth.li/~sgtatham/putty/0.83/putty.chm"),
    ("7zip-23.01.chm", "20c7b0dc8b584975803f3d8dde90bad423cc16c0adde5b33899428fcf61e485e", "LGPL-2.1-or-later", "LICENSE.7zip", SEVEN, "https://7-zip.org/a/7z2301-x64.exe"),
    ("inno-myprog.chm", "fc47e3f35ce2f2db1ad85dc320200424c406a3c7cb9c17fb5fd91af865644021", "LicenseRef-Inno-Setup", "LICENSE.issrc", INNO + "Examples/MyProg.chm", None),
    ("pychm-combined.chm", "be9cd285629743fd8a37575c503e15dcb70df816b39ceb0ca9d5739d9acebbee", "GPL-2.0-or-later", "LICENSE.pychm", PYCHM + "tests/integration/combined.chm", None),
    ("pychm-combined2.chm", "b8eb69234bab5e63123562a338b89f96cdfc6608c6d8cebab4b064b6bd8fcb35", "GPL-2.0-or-later", "LICENSE.pychm", PYCHM + "tests/integration/combined2.chm", None),
    ("fpc-3.2.2-fpdoc.chm", "20d3d4932ae7cca2fa1efa033e9c4e63780788fedc96e9134c53c6f9a9d2c552", "LGPL-2.0-or-later", "LICENSE.fpc-fpdoc.tex", None, FPC_DOWNLOAD),
]
MALFORMED = [
    ("cve-2015-4467-reset-interval-zero.chm.xor", "f3caf03196f16ce774ea09899dd879dee7a25661ed7019bf907f5fdf5ac72c05"),
    ("cve-2015-4468-namelen-bounds.chm", "3e4cb920c16e25993e2ad920f95723e64b1d724bd27cd2c6d701ea6f7ac76bdb"),
    ("cve-2015-4469-namelen-bounds.chm", "11b61822837a22791a93f32eaeb3d3a5f118e01b6c8d8fc86cb7948b9a689e72"),
    ("cve-2015-4472-namelen-bounds.chm", "40e8e5cc000ce9fb40dc458cb1390f920a516513af040ad7eab54fe8a0f592d3"),
    ("cve-2017-6419-lzx-negative-spaninfo.chm", "0d7e37ceb9619ded8d17229948a483a65bc7a507935420e8558cf0df2d081b48"),
    ("cve-2018-14679-off-by-one.chm", "7fe9e6380251e93feeda14d5713f916e069f452b7f88fb3c0c0a9c93dee812c2"),
    ("cve-2018-14680-blank-filenames.chm", "72e3dff81a9d409bb8ec0673fe429c150ccf3569dba35f7ed942aa8375a9148c"),
    ("cve-2018-14682-unicode-u100.chm", "cbd759f14a837b41754bdb193ccfea1200504e60356e2903724f15d0dd750605"),
    ("cve-2019-1010305-name-overread.chm", "816149b5998620e589fd8e1f2bfd7667e3feac3f9e43799bbd2553f23cfb69de"),
    ("encints-32bit-both.chm", "6f93c7087beff90799fe7bd2ce8aea803aa26b6d330d147fd6cde8cd9a393c65"),
    ("encints-64bit-both.chm", "b051ff57e9eadc497227c228d68944dfed66a27797d05fc1d457488bade8bae2"),
]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encint(data, pos):
    value = 0
    for _ in range(10):
        byte = data[pos]
        pos += 1
        value = (value << 7) | (byte & 127)
        if byte < 128:
            return value, pos
    raise ValueError("unbounded ENCINT")


def structure(data):
    """Independent fixed-layout observation, NOT a decompression oracle."""
    version, = struct.unpack_from("<I", data, 4)
    directory, length = struct.unpack_from("<QQ", data, 0x48)
    base = struct.unpack_from("<Q", data, 0x58)[0] if version == 3 else directory + length
    header_length, = struct.unpack_from("<I", data, directory + 8)
    chunk_size, = struct.unpack_from("<I", data, directory + 16)
    entries = {}
    for offset in range(directory + header_length, directory + length, chunk_size):
        block = data[offset:offset + chunk_size]
        if block[:4] != b"PMGL":
            continue
        free, = struct.unpack_from("<I", block, 4)
        pos, end = 20, chunk_size - free
        while pos < end:
            size, pos = encint(block, pos)
            name = block[pos:pos + size].decode("utf8")
            pos += size
            section, pos = encint(block, pos)
            start, pos = encint(block, pos)
            size, pos = encint(block, pos)
            entries[name] = {"section": section, "offset": start, "length": size}
    control = next(e for n, e in entries.items() if n.endswith("/ControlData"))
    reset = next(e for n, e in entries.items() if n.endswith("/ResetTable"))
    content = next(e for n, e in entries.items() if n.endswith("/Content"))
    c = base + control["offset"]
    r = base + reset["offset"]
    cv, ri, window = struct.unpack_from("<III", data, c + 8)
    factor = 32768 if cv == 2 else 1
    reset_entries = struct.unpack_from("<I", data, r + 4)[0]
    uncompressed = struct.unpack_from("<Q", data, r + 16)[0]
    frames = (uncompressed + 32767) // 32768
    terminal = None
    if reset_entries == frames + 1 and frames > 0:
        entry_size, table_offset = struct.unpack_from("<II", data, r + 8)
        assert entry_size == 8
        terminal = struct.unpack_from("<Q", data, r + table_offset + frames * entry_size)[0]
        assert terminal == content["length"] == struct.unpack_from("<Q", data, r + 24)[0]
    else:
        assert reset_entries == frames
    start = base + content["offset"]
    intel = bool(struct.unpack_from("<H", data, start)[0] & 0x8000)
    first_type = (struct.unpack_from("<H", data, start + (4 if intel else 0))[0] >> 12) & 7
    return entries, {"firstLzxBlockType": first_type, "intelHeader": intel, "itsfVersion": version, "languageId": struct.unpack_from("<I", data, 20)[0], "directoryOffset": directory, "dataOffset": base, "controlVersion": cv, "resetInterval": ri * factor, "windowSize": window * factor, "frameCount": frames, "resetTableEntryCount": reset_entries, "terminalResetOffset": terminal, "resetGroups": (uncompressed + ri * factor - 1) // (ri * factor), "uncompressedLength": uncompressed, "contentOffset": base + content["offset"]}


def run(tool, args):
    return subprocess.run([tool, *args], check=True, capture_output=True, timeout=20).stdout


def main():
    tool = shutil.which("7zz") or shutil.which("7z")
    if not tool:
        raise SystemExit("Install trusted 7zz/7z; do not generate expectations using chm-kit")
    version = next(x for x in run(tool, ["i"]).decode().splitlines() if "Copyright" in x)
    manifest = {"schemaVersion": 1, "oracle": {"tool": version, "commands": ["7zz t <archive>", "7zz x -y -o<temporary-directory> <archive>"], "generator": "test/conformance/refresh-oracles.py", "chmKitUsed": False}, "licenses": [], "archives": []}
    licenses = [
        ("LICENSE.putty", "c18aac5045fd30bff639b07884be44cb8c68eef16efe8c5e18deda1f58cacdfb", "https://the.earth.li/~sgtatham/putty/0.83/putty-0.83.tar.gz (putty-0.83/LICENCE; SHA256 718777c13d63d0dff91fe03162bc2a05b4dfc8b0827634cd60b51cefdff631c6)"),
        ("LICENSE.7zip", "f037e7689f86a12a3f5f836dc73004547c089e4a2017687e5e0b803a19e3888b", "https://7-zip.org/a/7z2301-x64.exe (License.txt)"),
        ("LICENSE.issrc", "2e5346868c2a18434489824e11d65c3031620f792fefc415d05f19cd441abf5c", INNO + "license.txt"),
        ("LICENSE.pychm", "ee8ad0da4000f87a54b135a35c2148f318cba67dbba018753b2010db4c652fff", PYCHM + "LICENSE"),
        ("COPYING.pychm", "669cd20e1d23a23737c7d50e22fc80053ccd94e624920479f8618b0606b022fe", PYCHM + "COPYING"),
        ("LICENSE.libmspack", "a190dc9c8043755d90f8b0a75fa66b9e42d4af4c980bf5ddc633f0124db3cee7", MSPACK + "COPYING.LIB"),
        ("LICENSE.fpc-fpdoc.tex", "8fc7482db36e31f6eddaf9591a8f5c8e177f0682acbef3ad24ab65597d34d142", FPC_DOC + "fpdoc.tex"),
        ("COPYING.LIB.fpc", "cc535c21133c895b56b374c8a1dc1eb948d99003ed2b47372069456b62f42b24", "https://www.gnu.org/licenses/old-licenses/lgpl-2.0.txt"),
        ("READMECHM.fpc.txt", "a2b52f400573914509bc56a64946f2586fbb1193fdb0532b001785c455b1d687", FPC_DOWNLOAD + " (help/readmechm.txt)"),
    ]
    for name, sha, url in licenses:
        assert digest((ROOT / name).read_bytes()) == sha, name
        manifest["licenses"].append({"file": name, "sha256": sha, "sourceUrl": url})
    for name, sha, license_id, license_file, commit, download in NORMAL:
        data = (ROOT / name).read_bytes()
        assert digest(data) == sha, name
        entries, observed = structure(data)
        run(tool, ["t", str(ROOT / name)])
        files = []
        with tempfile.TemporaryDirectory(prefix=".oracle-", dir=ROOT) as temp:
            run(tool, ["x", "-y", "-o" + temp, str(ROOT / name)])
            expected_root = ROOT / "expected" / name.removesuffix(".chm")
            if expected_root.exists():
                shutil.rmtree(expected_root)
            for path in sorted(Path(temp).rglob("*")):
                assert not path.is_symlink()
                if not path.is_file():
                    continue
                relative = path.relative_to(temp)
                content = path.read_bytes()
                assert len(content) <= 4 * 1024 * 1024
                dest = expected_root / relative
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(content)
                entry_name = "/" + relative.as_posix()
                assert entry_name in entries, entry_name
                files.append({"name": entry_name, "expectedFile": dest.relative_to(ROOT).as_posix(), "length": len(content), "sha256": digest(content), **entries[entry_name]})
        item = {"file": name, "kind": "normal", "length": len(data), "sha256": sha, "license": license_id, "licenseFile": license_file, "sourceCommitUrl": commit, "downloadUrl": download, "modified": False, "observed": observed, "files": files}
        if download is None:
            item["gitBlobSha1"] = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if name.startswith("7zip"):
            item["container"] = {"sha256": "26cb6e9f56333682122fafe79dbcdfd51e9f47cc7217dccd29ac6fc33b5598cd", "length": 1589510, "member": "7-zip.chm", "executed": False, "retained": False}
        if name.startswith("fpc-"):
            item["container"] = {"sha256": "cb9ebc5f333653e6c22bdbcf92ea3390f485db330d5cf9377281af0ed367ab53", "member": "help/fpdoc.chm", "executed": False, "retained": False}
            item["documentationSourceUrl"] = FPC_DOC + "fpdoc.tex"
            item["documentationSourceArchiveUrl"] = "https://github.com/fpc/FPCDocumentation/archive/28a887047f9fa593dff284cb35b938cdb2f86268.tar.gz"
            item["binaryBuildCommit"] = None
            item["provenanceNote"] = "Official 3.2.2 distribution member; exact binary build commit is unknown. Documentation source commit is license/source evidence only, not a reproducible-build claim."
            item["itsfGuidPair"] = data[0x18:0x38].hex()
            item["producer"] = {"resource": "/_#_README_#_", "text": "This archive was not made by the MS HTML Help Workshop(r)(tm) program, but by Free Pascal's chm package 3.3.1.\r\n"}
        manifest["archives"].append(item)
        print(name, observed, "oracle files", len(files))
    for name, sha in MALFORMED:
        data = (ROOT / name).read_bytes()
        assert digest(data) == sha, name
        manifest["archives"].append({"file": name, "kind": "malformed", "length": len(data), "sha256": sha, "gitBlobSha1": hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest(), "license": "LGPL-2.1-or-later", "licenseFile": "LICENSE.libmspack", "sourceCommitUrl": MSPACK + "test/test_files/chmd/" + name, "modified": False, "xorInMemory": name.endswith(".xor"), "files": []})
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    sums = []
    for path in sorted(ROOT.rglob("*")):
        if path.is_file() and path.name not in ("SHA256SUMS", "README.md"):
            sums.append(digest(path.read_bytes()) + "  " + path.relative_to(ROOT).as_posix())
    (ROOT / "SHA256SUMS").write_text("\n".join(sums) + "\n")


if __name__ == "__main__":
    main()
