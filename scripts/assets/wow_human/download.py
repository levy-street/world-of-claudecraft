"""Fetch the pinned Workshop archives and extract model data, never execute addon Lua."""
import hashlib
import json
import lzma
import pathlib
import struct
import urllib.parse
import urllib.request

PACKS = {
    'male': ('1338373603', 'b9d51de5879af57545b9ab87580bbaa19972af10584ac2c348fe37ce210df058'),
    'female': ('1335166463', '6a8facb4cc2c5a907d1af1bf0b3c356aeb1e5aa4e6dc302b64f8a07af4e533f4'),
}


def extract(data, directory):
    data = lzma.decompress(data, memlimit=256 * 1024 * 1024)
    if data[:5] != b'GMAD\x03' or len(data) > 64 * 1024 * 1024:
        raise ValueError('Unsupported or oversized GMA')
    offset = 21

    def string():
        nonlocal offset
        end = data.index(0, offset)
        value = data[offset:end].decode('utf-8')
        offset = end + 1
        return value

    while string():
        pass
    for _ in range(3):
        string()
    offset += 4
    entries = []
    while True:
        number, = struct.unpack_from('<I', data, offset)
        offset += 4
        if not number:
            break
        name = string()
        size, _crc = struct.unpack_from('<QI', data, offset)
        offset += 12
        target = (directory / name).resolve()
        if not target.is_relative_to(directory.resolve()):
            raise ValueError('Unsafe archive path')
        entries.append((target, size))
    for target, size in entries:
        if offset + size > len(data):
            raise ValueError('Truncated archive')
        if target.suffix in ('.mdl', '.ani'):
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data[offset:offset + size])
        offset += size


if __name__ == '__main__':
    root = pathlib.Path('tmp/wow_human')
    root.mkdir(parents=True, exist_ok=True)
    for fit, (item, expected) in PACKS.items():
        body = urllib.parse.urlencode({'itemcount': 1, 'publishedfileids[0]': item}).encode()
        with urllib.request.urlopen('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', body, timeout=30) as response:
            meta = json.load(response)['response']['publishedfiledetails'][0]
        url = urllib.parse.urlparse(meta['file_url'])
        if meta['result'] != 1 or url.scheme != 'https' or url.hostname != 'cdn.steamusercontent.com':
            raise ValueError('Unexpected Steam download response')
        with urllib.request.urlopen(meta['file_url'], timeout=60) as response:
            archive = response.read(16 * 1024 * 1024)
        if hashlib.sha256(archive).hexdigest() != expected:
            raise ValueError(f'{fit}: Workshop content changed; review before repinning')
        (root / f'{fit}.gma').write_bytes(archive)
        extract(archive, root / fit)
        print(f'{fit}: verified and extracted Workshop item {item}')
