#!/usr/bin/env python3
"""One small cached Overpass query. Never used by the offline viewer."""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[2]


def download(config, query):
    """Prefer the system TLS stack on macOS; enforce the byte cap ourselves too."""
    if shutil.which('curl'):
        with tempfile.TemporaryDirectory(prefix='jaipur-overpass-') as tmp:
            output = pathlib.Path(tmp)/'response.json'
            command = ['curl', '--fail', '--silent', '--show-error', '--proto', '=https',
                       '--max-time', str(config['timeoutSeconds']),
                       '--max-filesize', str(config['maxDownloadBytes']),
                       '--user-agent', config['userAgent'], '--data-urlencode', 'data='+query,
                       '--output', str(output), config['overpassEndpoint']]
            result = subprocess.run(command, capture_output=True, text=True)
            if result.returncode:
                if result.returncode == 63:
                    raise ValueError('Response exceeds configured byte limit')
                raise OSError('curl failed: '+result.stderr.strip())
            if output.stat().st_size > config['maxDownloadBytes']:
                raise ValueError('Response exceeds configured byte limit')
            return output.read_bytes(), 'curl'
    request = urllib.request.Request(config['overpassEndpoint'],
        data=urllib.parse.urlencode({'data': query}).encode(),
        headers={'User-Agent': config['userAgent'], 'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(request, timeout=config['timeoutSeconds']) as response:
        content_length = int(response.headers.get('Content-Length', '0'))
        if content_length > config['maxDownloadBytes']:
            raise ValueError('Response exceeds configured byte limit')
        chunks, total = [], 0
        while True:
            chunk = response.read(min(65536, config['maxDownloadBytes']-total+1))
            if not chunk:
                break
            total += len(chunk)
            if total > config['maxDownloadBytes']:
                raise ValueError('Response exceeds configured byte limit')
            chunks.append(chunk)
    return b''.join(chunks), 'urllib'


def query_for_bbox(bbox):
    west, south, east, north = bbox
    return ('[out:json][timeout:80][maxsize:67108864];\n'
            'nwr[~"^(building|building:part|highway|landuse|leisure|natural|waterway|railway|tourism|historic|amenity|place)$"~"."]'
            f'({south},{west},{north},{east});\nout body geom;\n')


def fetch(config, destination, refresh=False):
    bbox = config['bbox']
    west, south, east, north = bbox
    if not (-180 < west < east < 180 and -85 < south < north < 85):
        raise ValueError('Invalid WGS84 bbox')
    if (east-west)*(north-south) > config['maxBboxSquareDegrees']:
        raise ValueError('Public Overpass limit exceeded. Clip a local PBF for expansion.')
    query = query_for_bbox(bbox)
    query_hash = hashlib.sha256(query.encode()).hexdigest()
    provenance = destination.with_suffix('.provenance.json')
    if destination.exists() and not refresh:
        if not provenance.exists():
            raise ValueError('Cache lacks provenance: use --refresh explicitly or a local input.')
        meta = json.loads(provenance.read_text())
        if meta['queryHash'] != query_hash:
            raise ValueError('BBox/query differs from cache. Use a different output or --refresh explicitly.')
        if hashlib.sha256(destination.read_bytes()).hexdigest() != meta['sha256']:
            raise ValueError('Cached source hash does not match provenance.')
        print(f'Using verified cached data: {destination}')
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    attempts = min(3, max(1, config.get('maxAttempts', 3)))
    for attempt in range(attempts):
        try:
            raw, transport = download(config, query)
            result = json.loads(raw)
            if 'remark' in result:
                raise ValueError('Overpass returned incomplete/error result: '+result['remark'])
            if not result.get('elements'):
                raise ValueError('Overpass returned no features; refusing to cache an empty pilot')
            destination.with_suffix('.json.partial').write_bytes(raw)
            destination.with_suffix('.json.partial').replace(destination)
            meta = {
                'source': 'OpenStreetMap contributors', 'license': 'ODbL-1.0',
                'licenseUrl': 'https://www.openstreetmap.org/copyright',
                'endpoint': config['overpassEndpoint'], 'bbox': bbox, 'query': query,
                'queryHash': query_hash, 'sha256': hashlib.sha256(raw).hexdigest(),
                'downloadedAt': datetime.now(timezone.utc).isoformat(), 'bytes': len(raw),
                'osmTimestamp': result.get('osm3s', {}).get('timestamp_osm_base'),
                'elements': len(result['elements']), 'attempts': attempt+1, 'transport': transport,
            }
            provenance.write_text(json.dumps(meta, indent=2)+'\n')
            print(json.dumps(meta, indent=2))
            return
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            if attempt+1 == attempts:
                raise
            delay = 10*(2**attempt)
            if isinstance(error, urllib.error.HTTPError) and error.code not in (429, 500, 502, 503, 504):
                raise
            print(f'Attempt {attempt+1}/{attempts} failed: {error}; retry in {delay}s', file=sys.stderr, flush=True)
            time.sleep(delay)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=pathlib.Path, default=ROOT/'config/data.json')
    parser.add_argument('--output', type=pathlib.Path, default=ROOT/'data/raw/pilot.overpass.json')
    parser.add_argument('--refresh', action='store_true', help='Explicitly replace the cached bounded request')
    args = parser.parse_args()
    fetch(json.loads(args.config.read_text()), args.output, args.refresh)


if __name__ == '__main__':
    main()
