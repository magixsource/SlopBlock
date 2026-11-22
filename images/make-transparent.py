import struct, zlib, sys
from collections import deque

SRC, DST = sys.argv[1], sys.argv[2]

def read_png(path):
    d = open(path, 'rb').read()
    pos = 8
    idat = b''
    w = h = ct = bd = 0
    while pos < len(d):
        n = struct.unpack('>I', d[pos:pos+4])[0]
        typ = d[pos+4:pos+8]
        data = d[pos+8:pos+8+n]
        pos += 12 + n
        if typ == b'IHDR':
            w, h, bd, ct = struct.unpack('>IIBB', data[:10])
        elif typ == b'IDAT':
            idat += data
    assert bd == 8 and ct == 6, (bd, ct)
    raw = zlib.decompress(idat)
    bpp = 4
    stride = w * bpp
    rows = []
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        ft = raw[p]; p += 1
        line = bytearray(raw[p:p+stride]); p += stride
        if ft == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i-bpp]) & 255
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif ft == 3:
            for i in range(stride):
                a = line[i-bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif ft == 4:
            for i in range(stride):
                a = line[i-bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i-bpp] if i >= bpp else 0
                pp = a + b - c
                pa, pb, pc = abs(pp-a), abs(pp-b), abs(pp-c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        rows.append(line)
        prev = line
    return w, h, rows

def write_png(path, w, h, rows):
    raw = b''.join(b'\x00' + bytes(r) for r in rows)
    def chunk(t, data):
        return struct.pack('>I', len(data)) + t + data + struct.pack('>I', zlib.crc32(t + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    open(path, 'wb').write(png)

w, h, rows = read_png(SRC)
RED = (211, 47, 47)

# 从四边泛洪：接近白色的背景像素标记为透明
outside = bytearray(w*h)
q = deque()
def is_white(x, y):
    i = x*4
    return rows[y][i] >= 235 and rows[y][i+1] >= 235 and rows[y][i+2] >= 235

for x in range(w):
    for y in (0, h-1):
        if is_white(x, y) and not outside[y*w+x]:
            outside[y*w+x] = 1; q.append((x, y))
for y in range(h):
    for x in (0, w-1):
        if is_white(x, y) and not outside[y*w+x]:
            outside[y*w+x] = 1; q.append((x, y))

while q:
    x, y = q.popleft()
    for nx, ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
        if 0 <= nx < w and 0 <= ny < h and not outside[ny*w+nx] and is_white(nx, ny):
            outside[ny*w+nx] = 1
            q.append((nx, ny))

# 抗锯齿边缘：与透明区相邻的粉白像素按 G 通道估算 alpha，并改成纯红，避免白边
for y in range(h):
    row = rows[y]
    for x in range(w):
        idx = y*w + x
        if outside[idx]:
            row[x*4+3] = 0
            continue
        adjacent = False
        for nx, ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
            if 0 <= nx < w and 0 <= ny < h and outside[ny*w+nx]:
                adjacent = True; break
        if adjacent:
            g = row[x*4+1]
            if g > RED[1]:
                alpha = int(round((255 - g) / (255 - RED[1]) * 255))
                row[x*4: x*4+4] = bytes([RED[0], RED[1], RED[2], alpha])

write_png(DST, w, h, rows)
print('wrote', DST, 'transparent pixels:', sum(outside))
