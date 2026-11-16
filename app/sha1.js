// Minimal SHA-1 implementation, UTF-8 aware. Verified against FIPS vectors
// and Node crypto (see ../test_md5.js). Used to derive the fnOS stream
// endpoint's client-id ("ip" field = SHA1(account) formatted as UUID,
// replicating fntv-electron's StringToUUID).
(function (global) {
  'use strict';
  function utf8Bytes(str) {
    var bytes = [];
    var enc = unescape(encodeURIComponent(str));
    for (var i = 0; i < enc.length; i++) bytes.push(enc.charCodeAt(i) & 0xff);
    return bytes;
  }
  function rotl(x, n) { return (x << n) | (x >>> (32 - n)); }
  function sha1(str) {
    var bytes = utf8Bytes(String(str));
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    var lo = bitLen >>> 0, hi = Math.floor(bitLen / 4294967296) >>> 0;
    var i, b;
    // SHA-1 length field: 64-bit big-endian bit length
    for (b = 3; b >= 0; b--) bytes.push((hi >>> (8 * b)) & 0xff);
    for (b = 3; b >= 0; b--) bytes.push((lo >>> (8 * b)) & 0xff);

    var h0 = 0x67452301 | 0, h1 = 0xEFCDAB89 | 0, h2 = 0x98BADCFE | 0, h3 = 0x10325476 | 0, h4 = 0xC3D2E1F0 | 0;
    var w = new Array(80);
    for (var off = 0; off < bytes.length; off += 64) {
      for (i = 0; i < 16; i++) {
        w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) |
               (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      }
      for (i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      var a = h0, bb = h1, c = h2, d = h3, e = h4;
      for (i = 0; i < 80; i++) {
        var f, k;
        if (i < 20)      { f = (bb & c) | (~bb & d);          k = 0x5A827999; }
        else if (i < 40) { f = bb ^ c ^ d;                    k = 0x6ED9EBA1; }
        else if (i < 60) { f = (bb & c) | (bb & d) | (c & d); k = 0x8F1BBCDC; }
        else             { f = bb ^ c ^ d;                    k = 0xCA62C1D6; }
        var tmp = (rotl(a, 5) + f + e + k + w[i]) | 0;
        e = d; d = c; c = rotl(bb, 30); bb = a; a = tmp;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    function hex(x) {
      var s = (x >>> 0).toString(16);
      while (s.length < 8) s = '0' + s;
      return s;
    }
    return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4);
  }
  function uuidFromString(s) {
    if (!s) return '00000000-0000-0000-0000-000000000000';
    var h = sha1(s).slice(0, 32);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  global.sha1 = sha1;
  global.uuidFromString = uuidFromString;
})(typeof window !== 'undefined' ? window : globalThis);
