// Minimal MD5 (RFC 1321) implementation, byte-array based, UTF-8 aware.
// Verified against RFC test vectors and cross-checked with Python hashlib
// for the fnOS Authx signing string (see ../test_md5.js).
(function (global) {
  'use strict';
  var S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  var K = [];
  for (var ki = 0; ki < 64; ki++) {
    K[ki] = Math.floor(Math.abs(Math.sin(ki + 1)) * 4294967296) | 0;
  }
  function leftRotate(x, c) { return (x << c) | (x >>> (32 - c)); }
  function utf8Bytes(str) {
    var bytes = [];
    var enc = unescape(encodeURIComponent(str));
    for (var i = 0; i < enc.length; i++) bytes.push(enc.charCodeAt(i) & 0xff);
    return bytes;
  }
  function md5bytes(input) {
    var bytes = input.slice();
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    // 64-bit little-endian bit length (messages here are < 2^32 bits)
    var lo = bitLen >>> 0, hi = Math.floor(bitLen / 4294967296) >>> 0;
    for (var b = 0; b < 4; b++) bytes.push((lo >>> (8 * b)) & 0xff);
    for (var b2 = 0; b2 < 4; b2++) bytes.push((hi >>> (8 * b2)) & 0xff);

    var a0 = 0x67452301 | 0, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476 | 0;
    var M = new Array(16);
    for (var off = 0; off < bytes.length; off += 64) {
      for (var j = 0; j < 16; j++) {
        M[j] = bytes[off + j * 4] | (bytes[off + j * 4 + 1] << 8) |
               (bytes[off + j * 4 + 2] << 16) | (bytes[off + j * 4 + 3] << 24);
      }
      var A = a0, B = b0, C = c0, D = d0;
      for (var i = 0; i < 64; i++) {
        var F, g;
        if (i < 16)      { F = (B & C) | (~B & D);          g = i; }
        else if (i < 32) { F = (D & B) | (~D & C);          g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D;                   g = (3 * i + 5) % 16; }
        else             { F = C ^ (B | ~D);                g = (7 * i) % 16; }
        var tmp = D;
        D = C;
        C = B;
        B = (B + leftRotate((A + F + K[i] + M[g]) | 0, S[i])) | 0;
        A = tmp;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    function wordHex(w) {
      var out = '';
      for (var i = 0; i < 4; i++) {
        var byte = (w >>> (8 * i)) & 0xff;
        out += (byte < 16 ? '0' : '') + byte.toString(16);
      }
      return out;
    }
    return wordHex(a0) + wordHex(b0) + wordHex(c0) + wordHex(d0);
  }
  function md5(str) { return md5bytes(utf8Bytes(String(str))); }
  global.md5 = md5;
})(typeof window !== 'undefined' ? window : globalThis);
