"""Restore Scan Bridge .sbpart volumes using bounded memory. MIT License.

Usage: python merge-parts.py RECEIVED_FOLDER --output restored-file.zip
       python merge-parts.py first.sbpart second.sbpart ...
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import tempfile
import shutil

MAGIC=b'SCANBRIDGE-PART-1\n'
PART_SIZE=8*1024*1024
DIRECT_SIZE=8*1024*1024
BLOCK=1024*1024

def read_header(path):
    with path.open('rb') as stream:
        if stream.read(len(MAGIC))!=MAGIC:
            raise ValueError(f'Not a Scan Bridge volume: {path.name}')
        size=stream.read(4)
        if len(size)!=4:
            raise ValueError(f'Truncated header: {path.name}')
        length=struct.unpack('<I',size)[0]
        if not 2<=length<=16384:
            raise ValueError(f'Invalid header size: {path.name}')
        h=json.loads(stream.read(length).decode('utf-8'))
        offset=stream.tell()
    if not isinstance(h,dict):
        raise ValueError('Invalid volume metadata')
    name=h.get('name')
    if not isinstance(name,str) or not name or name in ('.','..') or re.search(r'[\\/\x00-\x1f:]',name):
        raise ValueError('Unsafe output filename')
    keys=('totalBytes','partIndex','partCount','partSize','offset','bytes')
    if any(type(h.get(k)) is not int or not 0<=h[k]<=2**53-1 for k in keys):
        raise ValueError('Invalid volume numbers')
    count=(h['totalBytes']+PART_SIZE-1)//PART_SIZE
    if (h.get('format')!='scanbridge-part-1' or h['totalBytes']<=DIRECT_SIZE
        or h['partSize']!=PART_SIZE or h['partCount']!=count or not 1<=h['partIndex']<=count
        or h['offset']!=(h['partIndex']-1)*PART_SIZE
        or h['bytes']!=min(PART_SIZE,h['totalBytes']-h['offset'])
        or path.stat().st_size-offset!=h['bytes']
        or not all(re.fullmatch('[a-f0-9]{64}',str(h.get(k,''))) for k in ('sha256','wholeSha256'))):
        raise ValueError(f'Invalid volume metadata: {path.name}')
    return path,h,offset

def restore(paths,output=None):
    if not paths:
        raise ValueError('No .sbpart files selected')
    parts=[read_header(Path(p)) for p in paths]
    first=parts[0][1]
    indexes=set()
    for path,h,offset in parts:
        if any(h[k]!=first[k] for k in ('name','totalBytes','wholeSha256','partCount','partSize')):
            raise ValueError('Volumes belong to different files')
        if h['partIndex'] in indexes:
            raise ValueError(f'Duplicate volume: {h["partIndex"]}')
        indexes.add(h['partIndex'])
    if len(parts)!=first['partCount']:
        missing=[]
        for i in range(1,first['partCount']+1):
            if i not in indexes:
                missing.append(i)
            if len(missing)==20:
                break
        raise ValueError(f'Missing volumes: {missing[:20]}')
    destination=Path(output or first['name']).resolve()
    if destination.exists():
        raise FileExistsError(f'Output already exists: {destination}')
    whole=hashlib.sha256()
    temp=None
    try:
        with tempfile.NamedTemporaryFile(prefix='.scanbridge-',dir=destination.parent,delete=False) as writer:
            temp=Path(writer.name)
            for path,h,offset in sorted(parts,key=lambda p:p[1]['partIndex']):
                chunk_hash=hashlib.sha256()
                with path.open('rb') as source:
                    source.seek(offset)
                    while block:=source.read(BLOCK):
                        chunk_hash.update(block);whole.update(block);writer.write(block)
                if chunk_hash.hexdigest()!=h['sha256']:
                    raise ValueError(f'Checksum failed for volume {h["partIndex"]}')
        if whole.hexdigest()!=first['wholeSha256']:
            raise ValueError('Whole-file checksum failed')
        # Link commits without overwriting an output created during restoration.
        try:
            os.link(temp,destination)
        except OSError as error:
            if destination.exists():
                raise FileExistsError(f'Output already exists: {destination}') from error
            # FAT/exFAT and some mounted filesystems do not support hard links.
            created=False
            try:
                with destination.open('xb') as target,temp.open('rb') as source:
                    created=True
                    shutil.copyfileobj(source,target,BLOCK)
            except BaseException:
                if created:
                    destination.unlink(missing_ok=True)
                raise
        print(f'Restored: {destination}\nSHA-256: {whole.hexdigest()}')
        return destination
    finally:
        if temp is not None and temp.exists():
            temp.unlink()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('inputs',nargs='+',type=Path)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    paths=[]
    for path in args.inputs:
        paths.extend(sorted(path.glob('*.sbpart')) if path.is_dir() else [path])
    try:restore(paths,args.output)
    except (ValueError,OSError,KeyError,UnicodeError,json.JSONDecodeError) as error:
        parser.exit(1,f'{error}\n')

if __name__=='__main__':main()
